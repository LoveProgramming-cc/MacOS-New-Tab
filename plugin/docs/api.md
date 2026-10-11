**English** · [简体中文](zh-CN/api.md) · [日本語](ja/api.md)

# Runtime API

Part of the application SDK documentation — start at [README](../README.md).

## 7. Runtime API

### Permissions

Declared in the manifest's `permissions` list and shown to the user in Settings → Applications.

| Permission | Unlocks |
| --- | --- |
| `storage` | `macos.storage` |
| `files` | `macos.files`, `macos.archive`, `macos.dialog.openFile` / `saveFile`, the `drop` event |
| `audio` | `macos.audio` |
| `network` | `macos.fetch`, remote `https://` image sources |
| `notifications` | `macos.notifications` |
| `clipboard` / `clipboardRead` | `macos.clipboard.writeText` / `readText` |
| `openExternal` | `macos.openExternal` |
| `menu` | `macos.menu` (host commands) |
| `statusItem` | `macos.statusItem` (an item in the menu bar) |
| `widgets` | the manifest's `widgets` and `macos.widgets` (widgets for the desktop and the widget centre) |
| `pointer` | `macos.window.trackPointer` (where the pointer is on the desktop) |
| `windows` | `macos.desktop` and `macos.window.attach` (where the Dock and the other windows are — never what is in them) |

`macos.ui`, `macos.window`, `macos.dialog.alert` / `confirm` / `prompt`, `macos.system`, `macos.i18n`, `macos.search` and `macos.log` need no permission.

The user can switch a declared permission off for one application (Settings → Applications). The calls it unlocks then reject with `Permission denied: <name>`, exactly as if it had not been declared — an app that treats its permissions as optional keeps working without the feature.

The host keeps a record of which permissions an application really used — how often, when last, and how often one was refused. The user sees it in Settings → Applications (**Permission use**) and in Developer Tools; a permission that is declared and never used shows as such.

The entry script receives:

```js
macos
root
```

Top-level `await` is supported.

`root` is the Web App DOM root. Native Apps should normally use `macos.ui` rather than manipulating `root`, because the visible Native App UI belongs to the host document.

### `macos.system`

```js
const info = await macos.system.getInfo();
```

Current information includes:

```js
{
  language: 'zh-CN',
  region: 'CN',
  theme: 'dark',
  systemTheme: 'dark',
  appVersion: '0.6.2',
  strictSecurity: true,
  devicePixelRatio: 2,
  reduceTransparency: false,
  transparentGlass: false,
  increaseContrast: false,
  reduceMotion: false,
  direction: 'ltr',            // 'rtl' when the layout is mirrored
  accentColor: '#0a84ff',      // the accent in effect for this app
  accentSetting: 'multicolor'  // system setting: 'multicolor' or a fixed colour name
}
```

The launch context (`macos.context`) additionally carries the instance this runtime is:

```js
{
  instance: 1,          // 1 for the app's ordinary window, 2… for further instances
  sharedStorage: true   // false: this instance has a storage pool of its own
}
```

Relevant events:

```js
macos.on('themechange', ({ theme, systemTheme }) => {});   // theme: what this window shows now
macos.on('languagechange', ({ language, direction }) => {});
macos.on('visibilitychange', ({ visible }) => {});
macos.on('hostdragchange', ({ active, kind }) => {});
macos.on('resize', ({ width, height }) => {});   // outer window size in CSS px (the laid-out size, unaffected by the minimise animation)
macos.on('focus', () => {});                     // window became the active window
macos.on('blur', () => {});
macos.on('close', () => {});                     // last event before the runtime is disposed
```

Apps doing Canvas/WebGL/custom animation should pause expensive work when `visible === false` or `hostdragchange.active === true`.

`macos.system.getStats()` tells an application where it stands against the host's budgets, so it can ease off before a call is refused:

```js
const stats = await macos.system.getStats();
// { apiCallsThisSecond, apiCallsLimit, apiCallsAdvised,     240 calls a second under strict security; aim below the advised 90
//   nodeCount, nodeLimit,                                    native UI nodes on screen
//   storageBytes, storageQuota, fileCount, fileBytes, fileQuota, securityLevel }   a limit of null means there is none
```

### `macos.i18n`

Declare package locales:

```json
"locales": {
  "en-US": "locales/en-US.json",
  "zh-CN": "locales/zh-CN.json",
  "ja-JP": "locales/ja-JP.json"
}
```

Then:

```js
macos.i18n.t('key', 'Fallback');
macos.i18n.language();
macos.i18n.direction();   // 'ltr' | 'rtl'
```

Native UI supports `textKey`, `labelKey` and `placeholderKey`, and host-generated application menus support `titleKey` and `labelKey`.

### `macos.storage` — permission `storage`

```js
await macos.storage.get('key');
await macos.storage.get();
await macos.storage.set('key', value);
await macos.storage.remove('key');
await macos.storage.clear();
```

Storage is namespaced per app and stored per key rather than rewriting one large application object for every small state change.

### `macos.fetch` — permission `network`

```js
const response = await macos.fetch('https://example.com/api', {
  method: 'GET',
  headers: { Accept: 'application/json' }
});
```

The host returns `ok`, `status`, `statusText`, `url`, `text`, and response headers. Pass `responseType: 'base64'` to receive `base64` instead of `text` for binary responses.

In strict mode requests to this machine and to private network addresses (`localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local, `*.local`) are refused.

### `macos.openExternal` — permission `openExternal`

```js
await macos.openExternal('https://example.com/');
```

Only HTTP/HTTPS URLs are accepted.

### `macos.openURL` and URL schemes — permission `openExternal`

Applications point at each other with URLs. An application names the schemes it answers to:

```json
"urlSchemes": ["notes"]
```

and anyone — another application, or the same one — opens such a link:

```js
await macos.openURL('notes://note/abc123?mode=edit');     // opens Notes (launching it if needed)

macos.on('openurl', ({ url, from }) => {                  // in Notes; from: the calling application's id
  const link = new URL(url);
  if (link.hostname === 'note') showNote(link.pathname.slice(1));
});
```

Up to four schemes of 2–32 lowercase letters, digits, `+`, `.`, `-`; the web's own (`http`, `mailto`, `file`, …) cannot be claimed. When two applications name the same scheme, the one installed first has it. A URL nobody answers to rejects, except `http(s)`, which opens in a new tab like `openExternal`. Music answers `music://song/<id>` and `music://playlist/<id>`, Books `books://book/<id>` — the ids are the ones they list for Spotlight.

### `macos.instances`

```js
const windows = await macos.instances.list();        // [{ instance, self, front, title, sharedStorage }]
await macos.instances.broadcast({ changed: 'library' });   // 'instancemessage' in the other windows
if (await macos.instances.canOpen()) await macos.instances.open();   // a further window of this application
```

Several windows of one application exist only where the user allowed them (Settings → Applications → the application → *Allow Multiple Windows*, with Developer Mode's multiple instances on). `canOpen()` says whether one more may be opened now; `open()` opens it and resolves `false` otherwise. An accessory without a Dock icon has no other place to offer this than its own menu — the pet's *One More Hoshino*.

**The browser's context menu** (Back, Reload, Inspect…) never opens over an application: the runtime cancels it everywhere except on text that is being edited, as the rest of the desktop does. Show your own with `macos.ui.showMenu`.

### `macos.clipboard` — permission `clipboard`

```js
await macos.clipboard.writeText('hello');
```

Reading needs the separate `clipboardRead` permission, and the browser may additionally ask the user:

```js
const text = await macos.clipboard.readText();
```

### `macos.window`

```js
await macos.window.setTitle('New title');
await macos.window.resize(700, 500);
await macos.window.minimize();
await macos.window.close();
await macos.window.center();
await macos.window.focus();
await macos.window.setAccentColor('red');   // see “Accent colour” in §4
await macos.window.setAppearance('dark');   // 'system' | 'light' | 'dark'; null returns to the manifest's window.appearance
const { left, top, width, height, maximized } = await macos.window.getBounds();
```

**Moving the window.** Any application can place its window; the host keeps it reachable (a frameless window wholly on the desktop, below the menu bar; any other with 80 px of it on screen).

```js
const frame = await macos.window.getFrame();
// { x, y, width, height, screen: { width, height, top /* menu bar */, bottom /* Dock top */, dock: { x, y, width, height } | null } }
await macos.window.moveTo(400, 300);                                     // at once
const end = await macos.window.moveTo(800, 300, { duration: 2000 });    // glides there ('linear' or easing: 'ease')
// end: the frame it arrived at, with clamped (it was kept on the desktop) and cancelled (a drag or another move took over)

petElement.addEventListener('pointerdown', (event) => {
  macos.window.beginDrag(event).then((frame) => { /* put down here; frame.clamped at an edge, frame.velocity for a throw */ });
});

macos.on('screenchange', ({ screen, frame, moved }) => {});   // the browser window changed size; moved: the host moved this window back on screen
```

`macos.context.launchReason` says why the application was started: `'autostart'` (the user switched on *Open with every new tab* for it) or `'user'`; `macos.context.autostart` is the same as a boolean. An application that starts with every new tab should stay out of the way then.

```js
macos.on('reopen', () => {});   // the user opened the application again (Dock, Launchpad, Spotlight) while it was running
```

`reopen` is how an application without an ordinary window — one that hid itself, a click-through one, an accessory in the menu bar — learns that it was asked for. It is not sent when the host opens the application to deliver something of its own (`widget`, `openurl`, `search`, `notificationclick`): those say what is wanted.

A frameless window can also be cut to the shape of what it draws — `macos.window.setShape(rects)`, see *Frameless, floating and accessory windows* in §4 — so clicks beside it go to the desktop — or, drawn in full, be told where it takes the pointer with `macos.window.setHitRegion(rects)`. `macos.window.setLevel('desktop' | 'normal' | 'floating')` moves it between layers.

`beginDrag` lets the user carry the window by whatever was pressed (a Web App's own surface — Native Apps with `titlebar: "hidden"` are dragged by their bare surfaces anyway). The application keeps receiving its own `pointermove` events meanwhile, to animate what it draws. It is the tool for frameless windows (`titlebar: "none"`, §4). The frame it resolves with also carries `velocity: { x, y }` — how fast the pointer was going when it let go, in px/s — for something that is thrown. A drag always ends: if the pointer is let go where the application's document no longer sees it (flicked off faster than the window follows, or beyond the window's shape), the host ends the drag and the promise resolves all the same. While the user carries a window, `moveTo` does nothing and resolves at once with `cancelled: true` — the hand wins.

**The pointer on the desktop** — permission `pointer`:

```js
await macos.window.trackPointer(true);
macos.on('pointerposition', ({ x, y, screenX, screenY }) => {});   // x, y relative to this window's top-left corner
await macos.window.trackPointer(false);
```

About 16 updates a second, only while the page is visible and only over the desktop and native windows — not over another Web App's own content. What the pointer does inside the application's own window it sees through ordinary DOM events.

`setAppearance()` is the application's own light / dark setting. The host remembers the choice with the application, so every window of it opens in that appearance from the first frame, and changes it with the system's cross-fade. `macos.context.appearance` (and `system.getInfo().appearance`) is the current choice, `theme` what is actually shown; a `themechange` event follows every change, whether the application or the system made it. The system offers no per-application appearance switch of its own: an application that wants one puts it in its settings, as Music and Books do, or in a menu, as Calculator does.

### `macos.desktop` — permission `windows`

Where things are on the desktop, for applications that live among the windows: weather that settles on them, a pet that stands on them.

```js
const layout = await macos.desktop.getLayout();
// { screen: { width, height, top, bottom, dock },
//   dock:   { x, y, width, height, radius } | null,
//   windows: [{ id, app, system, x, y, width, height, radius, level, frameless, z, own }],    front to back
//   widgets: [{ id, x, y, width, height, radius }] }                                           the widgets on the desktop

await macos.desktop.watch();                    // the same layout now, and 'desktopchange' from here on
macos.on('desktopchange', (layout) => {});
await macos.desktop.watch(false);
```

- Desktop CSS pixels, the same coordinates as `macos.window.getFrame()`. Only shown windows are listed; a minimised or hidden one is simply not there. `own` marks the application's own window, `system` a window of the system (Settings, Finder), `frameless` and `level` tell a pet or a full-desktop overlay from an ordinary window.
- Spotlight, while it is open, is listed with the windows (`system:spotlight`). The widgets on the desktop are listed apart: they lie under every window, so they are places to stand rather than things in the way — and a `widget:…` id cannot be attached to.
- **Places and sizes only.** No title, no content, nothing of what another application shows — and `app` is the id from that application's manifest, which is public anyway.
- `desktopchange` arrives at most once a frame while something moves (a drag, the zoom animation, the Dock growing under the pointer) and not at all while nothing does.

**Travelling with another window** (the same permission):

```js
await macos.window.attach(windowId, { edge: 'top' });   // an id from the layout, or 'dock'
await macos.window.attach(null);                        // let go
macos.on('detached', ({ reason, frame }) => {});        // the carrier closed ('closed') or was minimised / hidden ('hidden')
```

The host keeps this window where it is relative to the carrier's top (or bottom) edge and moves it in the same frame as the carrier, so nothing lags behind a drag. Moving by itself (`moveTo`, `beginDrag`) keeps the attachment and simply changes the place on the carrier. The usual limits still hold: a frameless window stays on the desktop, so it is left behind at the screen edge when its carrier goes further.

### `macos.apps` — applications that work together

Two applications can talk when **each names the other** under `peers` in its manifest:

```json
"peers": ["outside-weather"]
```

```js
const there = await macos.apps.send('outside-weather', { type: 'step', x, y });   // false: it is not running
macos.on('message', ({ from, message }) => {});
macos.on('peerchange', ({ id, running }) => {});        // a peer started or quit
const peers = await macos.apps.peers();                 // [{ id, running }]
```

No permission, and no way round the manifest: a message to an application that is not listed is refused, and nothing is delivered to an application that does not list the sender. A message is JSON, at most 16 KB, and is not kept — an application that is not running misses it (`send` resolves `false`), so say hello when you start and answer when a peer does. Up to eight peers.

The examples *Outside* and *Hoshino* are the model: the pet tells the weather where her feet are and the snow there is kicked up; the weather tells the pet what it is doing and she holds a hand out into it. Each works alone; together they are one scene.

### `macos.dialog`

```js
await macos.dialog.alert('Saved.', { title: 'Notes' });
const ok = await macos.dialog.confirm('Delete this note?', { confirmLabel: 'Delete', danger: true });
```

```js
const name = await macos.dialog.prompt('Name of the new playlist:', { value: 'Untitled' });   // null when cancelled
```

File access goes through the browser's own picker and download UI, so an app only ever sees a file the user chose for it. These calls need the `files` permission and must follow a user action (a click or key press):

```js
const file = await macos.dialog.openFile({ accept: '.txt,.md', as: 'text' });   // as: 'text' | 'dataUrl' | 'base64'
if (file) console.log(file.name, file.size, file.text);                       // null when cancelled
const several = await macos.dialog.openFile({ accept: 'image/*', multiple: true, as: 'dataUrl' });   // an array

// Large files: keep them host-side and receive ids instead of contents.
const songs = await macos.dialog.openFile({ accept: 'audio/*', multiple: true, store: true });
// -> [{ id, name, type, size, duration }]

await macos.dialog.saveFile({ name: 'note.txt', text: 'hello', mime: 'text/plain' });   // or base64: '...'
```

### `macos.files` — permission `files`

`macos.storage` is a small JSON store. Anything large — songs, photos, documents — goes into the app's file store instead. Files stay on the host side of the sandbox; the app holds only an id, shows images with `blob:<id>` sources and plays audio through `macos.audio`, so megabytes never have to cross into the app.

```js
const info = await macos.files.put({ text: 'hello', name: 'note.txt', type: 'text/plain' });   // or base64 / dataUrl
await macos.files.list();            // [{ id, name, type, size, created, duration?, width?, height? }]
await macos.files.info(id);
await macos.files.read(id, { as: 'text' });   // 'text' | 'base64' | 'dataUrl'; up to 8 MB in strict mode
await macos.files.export(id, 'copy.mp3');     // download to the user's disk
await macos.files.remove(id);
await macos.files.usage();           // { count, bytes, quota, maxFileBytes }
await macos.files.clear();
```

Files arrive in the store through `put()`, `openFile({ store: true })`, the `drop` event and `macos.archive.extract()`. Audio and video get a `duration`, images a `width` / `height`. Audio files are also read for tags: `tags` (`title`, `artist`, `album`, `albumArtist`, `track`, `year` — from ID3v2, MP4 and FLAC metadata) and `artworkId`, the id of the embedded cover art stored as a file of its own (use it as `blob:<artworkId>`). Limits: 2 GB per file in strict mode (4 GB otherwise), 64 GB per app. Video files get a poster frame as their `artworkId`. With `openFile({ store: true, multiple: true })` a file that cannot be stored is skipped and reported to the user by the host; the rest of the selection is still returned. Uninstalling an app deletes its files and its `macos.storage` data.

### `macos.archive` — permission `files`

```js
// One .zip from stored files and generated text. Downloads it, or keeps it with store: true.
await macos.archive.create({ name: 'Road Trip.zip', entries: [
  { path: 'playlist.json', text: JSON.stringify(manifest) },
  { path: 'songs/01.mp3', fileId }
] });

// Unpack a stored .zip. Small text entries come back inline, everything else as stored files.
const entries = await macos.archive.extract(zipFileId);   // [{ path, text } | { path, file: { id, … } }]
```

### `macos.audio` — permission `audio`

One host-side player per app, fed from the file store.

```js
await macos.audio.load(fileId);                 // starts playing; { autoplay: false, startAt: 30 } to change that
await macos.audio.pause(); await macos.audio.play(); await macos.audio.stop();
await macos.audio.pause({ fade: 0.45 });         // fade out, then stop; play({ fade }) fades back in (up to 5 s)
await macos.audio.load(nextId, { crossfade: 4 }); // what is playing fades out under the new file (up to 12 s)
await macos.audio.seek(42); await macos.audio.setVolume(0.6);
const { fileId: current, paused, currentTime, duration, volume } = await macos.audio.state();

macos.on('audio', ({ type, paused, ended, currentTime, duration }) => {
  // type: play, pause, timeupdate, ended, loadedmetadata, seeked, volumechange, error
});
```

Playback continues while the window is minimized and stops when it is closed.

```js
await macos.audio.setMetadata({ title, artist, album, artwork: 'blob:' + artworkId });
```

publishes now-playing information to the system media controls. Hardware media keys then arrive as `audio` events with `type: 'action'` and `action` set to `play`, `pause`, `nexttrack` or `previoustrack`.

**Fades.** The host does the ramps, so an application only says how long. With `crossfade`, `load()` starts the new file at once and lets the old one finish underneath it; from then on `state()` and the `audio` events describe the new file only (the old one never reports `ended`). To blend at the natural end of a song, load the next one when `duration - currentTime` drops to the crossfade length, as Music does. A paused player, `autoplay: false`, or nothing playing means a plain cut. While a pause is fading, `paused` is already `true`. Whether to fade at all is a setting the application offers its user.

**Subtitles.** A browser plays a video's picture and sound but not the text tracks stored in the file. The host reads them when the file is stored — mov_text and WebVTT tracks of MP4 / MOV, SRT, ASS / SSA and WebVTT tracks of Matroska / WebM — and shows them over a `video` node. `macos.files.info()` lists them as `subtitles: [{ language, label }]`.

```js
await macos.audio.load(fileId, {
  subtitles: [{ fileId: srtFileId, label: 'English' }],   // subtitle files the app stored for this video: .srt .vtt .ass .ssa .lrc
  subtitle: 0                                             // which track to show: index, or -1 for none (default 0)
});
const { subtitles, subtitle } = await macos.audio.state();  // [{ label, language }], index shown (-1: none)
await macos.audio.setSubtitle(1);                           // or -1
await macos.audio.addSubtitle({ fileId, label });           // add a stored subtitle file to what is playing, and show it
```

The host draws the subtitles itself, over the picture of the `video` node; how they look — text size, backing, top or bottom — is the user's setting (System Settings → Accessibility → Subtitles), not the application's. The tracks found in the file come first, then the files passed with `load()`. A long Matroska file is read through in the background; an `audio` event with `type: 'subtitles'` announces the tracks when they are ready.

### `macos.notifications` — permission `notifications`

```js
const id = await macos.notifications.show({ title: 'Timer', body: 'Time is up.', tag: 'timer' });
macos.on('notificationclick', ({ id, tag, action }) => {});   // action: '' for the notification itself

// With buttons (up to three; `destructive: true` draws the title in red):
macos.notifications.show({ title: 'Import finished', body: '12 songs added.', tag: 'import',
  actions: [{ id: 'show', title: 'Show' }, { id: 'undo', title: 'Undo', destructive: true }] });
```

Notifications are banners inside the new-tab desktop, not operating-system notifications. A banner goes away after a few seconds (`duration`, 2–15 s); the notification stays in **Notification Center** — the panel behind the menu bar clock, above the widgets — until the user opens or clears it, also after the tab is closed. A notification with a `tag` replaces the application's earlier one with that tag.

Opening a notification — or pressing one of its buttons — brings the application forward and sends `notificationclick`; `action` is the id of the button. A button is not a way to run code in the background: like the notification itself it opens the application, which then does the work. Buttons are shown on the banner (which stays while the pointer is on it) and in Notification Center. If the application is not running it is started first, and the event arrives once its script has run.

The user decides, per application, whether it may show notifications (Settings → Notifications); for one that may not, `show()` resolves with an empty id and nothing appears. With **Do Not Disturb** on, no banner is shown and the notification goes straight to Notification Center.

**Scheduled notifications** — for something that is due while the application is not running, or no new tab is open at all:

```js
await macos.notifications.schedule({ id: letter.id, at: letter.due, title: 'A paper plane has landed', body: '…', tag: `landed:${letter.id}` });
await macos.notifications.cancel(letter.id);    // cancel() without an id cancels all of them
const waiting = await macos.notifications.scheduled();   // [{ id, at, title, body, tag }]
```

`at` is a time in milliseconds (or a `Date`). The notification is handed to the system, which keeps it and shows it at that time — nothing of the application runs for it, and it does not matter whether the application, or any new tab, is open. When a new tab is in front it appears there as a banner; otherwise it is shown as a notification of the operating system, and clicking that one opens a new tab, opens the application and sends `notificationclick`. Either way it is filed in Notification Center. Scheduling again with the same `id` replaces the earlier one; an application may have 64 waiting. They go with the application's data, and are dropped when the user has switched its notifications off. The browser's alarms are accurate to about half a minute.

This is a notification, not a wake-up: an application that needs to *do* something at that time does it when it is next opened.

### `macos.search`

```js
await macos.search.setItems([
  { id: 'song:42', title: 'Blue Hour', subtitle: 'Artist — Album', keywords: 'jazz 1998' }
]);                                   // replaces the list; returns how many were kept
await macos.search.clear();
macos.on('search', ({ id, query }) => {});
```

What Spotlight may find in the application. The list is stored with the application's data, so its content is found while it is not running; choosing a result opens the application (starting it if necessary) and sends `search` with the item's `id`. Matching is on `title`, then `subtitle`, then `keywords`. Up to 2 000 items (10 000 relaxed). The user can switch application content off in Settings → Spotlight; erasing the application's data clears the list.

### `macos.permissions`

```js
const status = await macos.permissions.status();          // { storage: 'granted', files: 'denied', … } for every declared permission
await macos.permissions.request(['storage', 'files']);    // resolves true when all of them are granted
```

The user can switch a declared permission off (Settings → Applications). An application that cannot work without one asks for it back with `request()`: the system shows a dialog naming the application and the permissions, with **Open System Settings**, which takes the user to that application's switches. Only the user can switch a permission on, there, and the application is reopened afterwards — so `request()` resolves `false` whenever something was denied. The dialog appears at most once per permission and launch. Ask for what the application needs to function (Music: `storage`, `files`, `audio`), not for extras it can do without (`widgets`, `notifications`).

In Settings → Applications an application's permissions are folded away under **Permissions · n**; changing one while the application runs offers to reopen it.

### `macos.widgets` — permission `widgets`

An application can offer widgets for the desktop and the widget centre. A widget is **a way in, not a second process**: the host draws it from what the application last published, whether or not the application is open, and nothing of the application runs for it. Clicking a widget opens the application.

Declare the widgets in the manifest:

```json
"permissions": ["widgets"],
"widgets": [
  { "id": "recent", "title": "Recently Played", "titleKey": "widgetRecent", "sizes": ["small", "medium", "large"] }
]
```

Up to eight widgets; `sizes` are `small` (160 × 160), `medium` (332 × 160) and `large` (332 × 332). Each declared widget appears in the widget gallery under the application's name, in every size it lists.

While it runs, the application publishes what each widget shows — a native UI tree for every size, or one tree used for all of them:

```js
await macos.widgets.set('recent', {
  small:  { type: 'stack', direction: 'vertical', gradient: ['#fb5c74', '#fa233b'], padding: 14, children: [
    { type: 'image', src: `blob:${artId}`, width: 56, height: 56, radius: 6 },
    { type: 'text', text: title, color: 'white', lines: 1 },
    { type: 'spacer' },
    { type: 'button', id: `play:${songId}`, label: 'Play', shape: 'pill' }
  ] },
  medium: { … },
  large:  { … }
});
await macos.widgets.clear('recent');           // back to the placeholder; clear() clears all of them
const widgets = await macos.widgets.list();    // [{ id, sizes, placed: [{ size, location: 'desktop' | 'center' }] }]

macos.on('widget', ({ id, size, action }) => {});   // the application was opened from a widget
```

- The tree uses the same nodes and properties as `macos.ui`, limited to what a still picture needs: `stack`, `grid`, `zstack`, `card`, `text`, `button`, `image`, `progress`, `canvas`, `spacer`, `separator`. At most 160 nodes and 150 KB per widget. Image sources are package assets, `blob:<file id>` and `data:` images (and `https://` with the `network` permission).
- A root that sets `padding` (0 included) fills the card edge to edge — use it with `background` or `gradient` for a coloured widget. Without it the content sits on the system's widget material with the standard inset.
- `action` in the `widget` event is the `id` of the button that was clicked, or `''` when the widget itself was. The application is opened first (launched if it was not running) and receives the event once it is ready.
- Publish again whenever the content changes (the host ignores a call that changes nothing). A widget the application has never published shows its icon and title.
- The content is kept with the application's data: it goes when the data is erased or the application is uninstalled, and the widget shows a notice while the user has the `widgets` permission switched off.

### `macos.statusItem` — permission `statusItem`

```js
await macos.statusItem.set({
  icon: 'assets/icons/note.svg',      // package asset, blob:<id> or data: image
  template: true,                     // default: the icon takes the menu bar's text colour
  title: '',                          // optional short text (24 characters)
  tooltip: 'Not Playing',
  items: [                            // same shape as macos.ui.showMenu
    { id: 'toggle', label: 'Play' }, { separator: true }, { id: 'show', label: 'Show Music' }
  ]
});
await macos.statusItem.remove();
macos.on('statusitem', ({ id }) => {});   // the chosen entry; '' when an item without a menu was clicked
```

**A panel** — what a menu cannot show: a cover, transport controls, a slider.

```js
await macos.statusItem.set({
  icon: 'assets/icons/note.svg',
  panel: { type: 'stack', direction: 'horizontal', gap: 14, width: 340, children: [
    { type: 'image', id: 'show', src: `blob:${song.artId}`, width: 112, height: 112, radius: 10, fit: 'cover' },
    { type: 'stack', direction: 'vertical', grow: 1, children: [
      { type: 'text', text: song.title, fontWeight: 'semibold', lines: 1 },
      { type: 'button', id: 'toggle', icon: 'assets/icons/pause.svg', iconTint: true, variant: 'plain', shape: 'circle' },
      { type: 'slider', id: 'seek', min: 0, max: 214, value: 39 },
      { type: 'text', id: 'time', text: '0:39', fontSize: 11, color: 'secondary' }
    ] }
  ] },
  items: [{ id: 'show', label: 'Show Music' }]          // optional: the right-click menu
});
macos.statusItem.patch('time', { text: '0:40' });        // or patch([{ id, props }, …])
macos.on('statusitem', ({ id, event, value }) => {});    // a control was used: event 'click' / 'input' / 'change'
```

The panel is a UI tree with the nodes and properties of `macos.ui`, drawn by the host in a popover under the item — for Web Apps too. It allows `stack`, `grid`, `zstack`, `card`, `text`, `button`, `image`, `progress`, `slider`, `switch`, `segmented`, `canvas`, `spacer` and `separator`, up to 120 nodes. A click on the item opens it; it stays open while its controls are used and closes on a click elsewhere or Escape (`statusitem` with `id: ''` and `event: 'open'` / `'close'` says when). With both a panel and `items`, the menu opens on a right-click. `set()` without `panel` leaves the panel as it is, `panel: null` removes it; `patch()` changes single nodes, which is the way to move a progress slider once a second.

One item per running application on the right of the menu bar, for what should stay reachable while the window is minimised or behind others. It needs an `icon` or a `title`. Call `set()` again to change it; it is removed when the application quits.

### `macos.log`

```js
macos.log('loaded', items.length, { detail: true });
```

Writes to the new-tab page's developer console, prefixed with the app id. Use it together with the crash view (an uncaught error shows its stack in the app window with a Reload button).

### `macos.menu` — permission `menu`

Apps may invoke a stable allow-list of host commands:

```js
const commands = await macos.menu.list();
await macos.menu.invoke('apple.settings');
```

Current command IDs:

```text
apple.about
apple.settings
system.spotlight
system.launchpad
settings.applications
settings.widgets
settings.developer
```

Apps cannot click arbitrary host DOM or call arbitrary desktop functions.
