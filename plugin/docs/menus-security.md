**English** · [简体中文](zh-CN/menus-security.md) · [日本語](ja/menus-security.md)

# Menus, instances, security levels and Developer Tools

Part of the application SDK documentation — start at [README](../README.md).

## 8. Application-specific menu bar

An app can declare menu-bar menus:

```json
"menus": [
  {
    "title": "File",
    "titleKey": "menuFile",
    "items": [
      { "label": "New", "labelKey": "menuNew", "command": "new", "shortcut": "⌥⌘N" },
      { "separator": true },
      { "label": "Delete", "command": "delete", "danger": true }
    ]
  }
]
```

### The application menu

Every app automatically gets the standard application menu under its bold name in the menu bar: **About** (name, version, description and permissions), **Settings…**, **Hide**, **Hide Others**, **Show All** and **Quit**. The host implements the window handling; an app does nothing for it.

**Settings…** — an app with a settings interface of its own declares `"settings": true` in the manifest and shows that interface when it receives the `settings` event:

```js
macos.on('settings', () => { settingsOpen = true; render(); });
```

Without `"settings": true`, Settings… opens System Settings ▸ Applications at the app's row (launch at startup, export, uninstall). The host does not generate per-app preferences: language choice, accent colour or anything else an app wants configurable is the app's to build.

Further entries of your own go in `appMenu` and arrive as ordinary menu commands:

```json
"appMenu": [ { "label": "Check for Updates…", "labelKey": "menuUpdates", "command": "updates" } ]
```

An app that is running without an icon in the Dock appears at the end of the applications there; the user keeps it by dragging that icon in among the others or with **Keep in Dock** in its context menu.

A hidden or minimised app keeps running (audio continues) and stays in the Dock with its indicator; clicking the Dock icon brings it back. The app is told through `visibilitychange`.

### Instances

An application has one window. Opening it again shows that window.

The user can allow more in Developer ▸ **Multiple Instances**: a master switch, a limit per application, and for each application whether it may be opened several times and whether the further windows share its storage. It is a user setting and cannot be requested by a package. When it is allowed, **New Window** appears in the application menu and in the context menu of the Dock icon.

Each instance is a separate runtime: its own sandbox, state and media player. `macos.storage` and `macos.files` are:

- **shared** (default) — every instance reads and writes the same pool. Instances are not told about each other's writes; an app that is meant to run this way should re-read what it needs rather than assume it is the only writer.
- **separate** — instance 1 uses the app's pool; instance *n* has a pool of its own, kept under that number, so the second window finds its own data again the next time it is opened.

`macos.context.instance` and `macos.context.sharedStorage` say which case applies. Uninstalling the application removes every pool.

The windows of one application can tell each other what changed:

```js
await macos.instances.broadcast({ type: 'note-updated', id });           // to every other window; resolves how many
macos.on('instancemessage', ({ from, message }) => {});                   // from: the sender's instance number
const windows = await macos.instances.list();                             // [{ instance, self, front, title, sharedStorage }]
```

System Settings ▸ **Storage** shows what each application occupies — the application itself plus its data and files — and lets the user erase an application's data as a whole (its windows are closed first; the next launch starts empty). Anything finer — removing unused files, clearing one kind of content — is the application's to offer in its own settings, as Music does. **Export Data…** there saves everything one application stored — the key/value storage of each pool and every stored file, with a `data.json` catalogue — as one archive, and **Import Data…** replaces the application's data with such an archive (it must come from the same application). Both are the system's and need nothing from the application.

**Which export belongs where.** Backing up, restoring or moving *everything* an application holds is the system's job (the two buttons above): do not build a "export all" of your own. An export of the application's own is for a *unit the user thinks in and hands to someone else or to another program* — one playlist with its songs, one book, one document — in a format that makes sense outside the application. Music exports and imports single playlists (`macos.archive`) and single songs (`macos.files.export`); for the whole library its settings point to System Settings ▸ Storage.

### App menus

When that app window becomes active, the desktop menu bar switches to the app's menus, and each item's `shortcut` is bound while the window stays active. Shortcuts are written `⇧⌘S`, `Cmd+Shift+S` or `Ctrl+S`; `⌘` also matches Ctrl. A shortcut needs at least one of ⌘ / Ctrl / ⌥, and combinations the browser reserves for itself (`⌘T`, `⌘W`, `⌘N`, …) can never be bound. Commands are delivered to the app sandbox:

```js
macos.on('menucommand', ({ command }) => {
  if (command === 'new') {
    // ...
  }
});
```

The app declares semantic commands; it does not manipulate the menu-bar DOM.

---

## 9. Strict security

Strict security is the default, and it is decided per application.

Developer Mode contains **Disable strict security**. The switch is off by default, and turning it on relaxes nothing by itself: it makes a **security level** selectable for each application (Settings → Developer → Application Security) — *Strict* or *Relaxed*. An application the user did not set to Relaxed stays strict. A package cannot ask for a level and an imported configuration cannot carry one.

A package that does not fit under strict security (too large, too many files) is refused. While the switch is on, the user is asked instead whether to install that one application relaxed.

In strict mode the host applies explicit limits:

- current application package format must be `macos-app-package-v3`;
- package JSON is limited to about 2.5 MB and 160 virtual files;
- entry HTML/CSS/JavaScript sizes are bounded;
- Web App HTML cannot carry executable `<script>` tags or inline `on...` handlers; code comes from `entry.script`;
- embedded `iframe`, `object`, `embed`, external `link` and `meta` content is removed;
- external HTTP/HTTPS resource references in package HTML/CSS are blocked;
- CSS `@import` is removed;
- package-authored `backdrop-filter` and `filter: blur(...)` are removed; use host/native materials instead;
- the strict sandbox page (`plugin/app-runtime-strict.html`) carries a Content-Security-Policy that allows no network connection of any kind and no nested frames, and loads images, fonts and media only from the `data:` / `blob:` URLs the host hands out for package assets. This is the actual boundary; it cannot be bypassed from script;
- as an early, readable error, direct `fetch`, XHR, WebSocket, EventSource, SharedWorker and `window.open` are also replaced with functions that throw; declared host APIs provide the permission boundary;
- `macos.fetch` cannot reach this machine or private network addresses;
- network request concurrency is limited;
- host API calls are limited to 240 per second per app (1 200 with strict security disabled); a `ui.batch` / coalesced `patch` counts once;
- workers may only be created from `blob:` scripts, and they inherit the same no-network policy;
- `setInterval` is clamped to at least one 16 ms frame and the number of active intervals is bounded;
- interval callbacks pause while the host is dragging a managed window or while the app is not visible;
- the sandbox cannot access the new-tab page DOM, another app's storage or `chrome.*` extension privileges;
- application crashes are isolated from the desktop shell.

For an application set to **Relaxed**, package/resource/code limits are relaxed and heavier CSS/external resources may be permitted. It still executes in the Manifest V3 sandbox and host APIs still require declared permissions. `macos.context.strictSecurity` tells an application which of the two it runs under.

Changing an application's level closes its windows; reopen it to launch under the new policy.

---

## Unrestricted applications

With strict security switched off (Developer ▸ **Disable strict security**), a further switch appears: **Unrestricted applications**. The user turns it on after two confirmations that spell out the consequences; it adds a third security level, *Unrestricted*, which the user then gives to applications one by one. It never applies to all of them, a package cannot ask for it, and an imported configuration cannot carry it.

For a selected application the host no longer enforces permission declarations (every API is available), the storage and file quotas, the size limits on files, responses and packages, the rate limit, the node limit, or the block on local and private network addresses. The application still runs in its sandboxed frame.

---

## Developer Tools

Developer Mode ▸ **Enable Developer Tools** adds a Developer Tools window ( menu, or the button beside the switch). Nothing is recorded while it is off.

| Panel | What it is for |
| --- | --- |
| *(launcher)* | While Developer Tools is on, a **Developer Tools** application appears in Launchpad (and in Finder ▸ Applications and Spotlight); it can be kept in the Dock like any other. |
| Applications | **Load from Folder…** installs an app straight from its source directory (the same package `plugin/tools/pack.py` writes, built in the page) and reloads it whenever a file changes — no packing or importing while you work. Folder access lasts while the page is open. **Pack Folder…** and **Export Package** write the installable `<id>.macos-app.json` — from a folder, checked the way installing it would be, or the package that is installed. Per application, **simulated conditions**: display language, light/dark appearance, window size (the manifest's minimum and default, and common sizes), display scale (75–200 %; the app is laid out in correspondingly fewer or more points and `devicePixelRatio` follows), refused permissions, offline (`macos.fetch` fails), full storage (`storage.set` and file storing fail). **Permission use**: each permission with how often it was used; unused and refused ones stand out. |
| Console | `macos.log` output, uncaught errors and crashes, every API call with arguments, result and duration, and (optionally) the events the host sends and system events. **Performance budget**: an interface update (`ui.*`) that took longer than one frame (16.7 ms) is marked, and so is an application that makes more than 90 API calls within a second. |
| Interface | The live node tree of a native app with ids, sizes and row counts against the node limit; pointing at a node highlights it in the window, clicking shows its properties. **Show layout bounds** outlines every node. |
| Storage | An application's key/value entries (editable as JSON) and stored files, per storage pool. |
| Record & Replay | Records the input events the host sends an application — control events, keys, menu commands, Spotlight results, status item and notification clicks — and plays them back at the original pace, ×4 or as fast as possible, optionally after reloading the application. Change the code, replay, and the app is back in the state you were working on. Recordings can be exported and imported as JSON. |
| System | Frame rate, long tasks, DOM size; every window with its state, order and resize rules; how often each desktop surface was redrawn or skipped; internal events and configuration saves. |
| Configuration | The normalised configuration as a tree, optionally only where it differs from the defaults; diagnostics export. |

**Slow-motion animations** (÷2, ÷4, ÷10) on the Developer page slows every animation — window flights, native transitions, CSS transitions — without changing what they do.
