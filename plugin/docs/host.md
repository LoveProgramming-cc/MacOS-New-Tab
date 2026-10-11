**English** · [简体中文](zh-CN/host.md) · [日本語](ja/host.md)

# Tooling, limits and host behaviour

Part of the application SDK documentation — start at [README](../README.md).

## 13. Tooling

```bash
python3 plugin/tools/pack.py plugin/examples/music
```

packs a directory (`app.json` manifest plus the files it refers to) into the one-file `music.macos-app.json` package. Install it from Settings → Applications, or simply drop the file onto the desktop.

The same can be done without leaving the page: Developer Tools ▸ Applications ▸ **Pack Folder…** (or **Export Package** on an application loaded from a folder).

`plugin/macos.d.ts` holds TypeScript definitions of the whole runtime API — every method, the node properties, and the detail of every event. Put it beside your sources and add `/// <reference path="./macos.d.ts" />` (or list it in `jsconfig.json`) for completion and checking in an editor; plain JavaScript files benefit as well.

---

## 14. Current limits

Things the SDK deliberately does not do yet, so you can plan around them:

- One window per app, unless the user allows more of the same (*Instances*, §8); no inspector or preferences windows.
- An app runs only while its window exists. There is no background execution, so background sync is not possible; a reminder is a scheduled notification (`macos.notifications.schedule`, §7), which the system shows without the app running.
- `html` nodes are static. An interactive custom region needs `canvas` (drawing plus pointer events) or the Web runtime.
- No split view with a draggable divider; compose one from `stack`, `canvas` pointer events and `macos.ui.showMenu()`.
- `macos.storage` is a key/value store (4 MB per value, 32 MB per app) without queries; keep bulk data in `macos.files`.
- Browser-reserved shortcuts (`⌘T`, `⌘W`, `⌘N`, …) can never be bound.
- The SDK is in active development and packages are not kept compatible between builds.

---

## 15. Launch at startup

Settings → Applications shows an **Open with every new tab** switch for each installed application. It is off by default and is a user preference only: an application package cannot request it, a `macos` API cannot change it, and importing a settings file resets it to off.

---

## 16. Limit-overlay packages

Web Time Management overlays remain declarative rather than executable:

```json
{
  "id": "my-limit-overlay",
  "name": "My Overlay",
  "version": "1.0.0",
  "kind": "limit-overlay",
  "actions": ["delay5", "dismiss"],
  "overlay": {
    "html": "<main>...<button data-macos-action=\"delay5\">Five more minutes</button></main>",
    "css": "..."
  }
}
```

A `delay5` action and a corresponding `[data-macos-action="delay5"]` control are required. Limit overlays do not receive the executable app runtime API.

---

### Developer Tools: Task Manager and Performance Monitor

With Developer Mode ▸ Developer Tools on, two panels show what applications cost the desktop:

- **Task Manager** lists every running application window — state, API calls a second, the main-thread time the system spends answering them, events sent to it, the size of its native interface — with Show, Reload and Quit, and the system's own windows below.
- **Performance Monitor** charts the last minute: frame rate, slowest frame, long tasks, JS memory, DOM size, and the traffic between applications and the system, then the applications by their share.

What an application does inside its sandbox is not visible to the host; an application that is heavy there shows up as a low frame rate with little traffic of its own.

## 17. Public Beta 0.6.2 host behavior

- **Disable extra features** suspends app runtimes and hides plugin launchers from Desktop, Dock, Launchpad and Spotlight without deleting saved launcher configuration.
- **Use transparency instead of frosted glass** (Settings → Accessibility) disables host backdrop sampling while preserving the same semantic translucent window material. The display options there — reduce motion, reduce transparency, increase contrast — apply without Developer Mode; applications see them in `macos.context` / `macos.system.getInfo()`.
- **Disable strict security** lets the user relax individual applications; it does not grant access to the host DOM or `chrome.*`.
- **Windows.** A window dragged against the left or right edge of the desktop takes that half, against the top it fills the desktop (Settings → Desktop & Windows); dragging it away gives it back its size. The halves respect the window's `minWidth` / `maxWidth`, and a window whose manifest does not allow resizing in both directions is not tiled sideways. An application is told through the ordinary `resize` event.
- **Right-to-left.** Arabic is a system language; with it, or with Developer ▸ **Force right-to-left layout** (which leaves the text as it is), the desktop is mirrored: menu bar, Dock, windows' contents and traffic lights, Notification Center on the left. Windows themselves are still placed in screen coordinates.
- **Window memory.** An application's window reopens at the place and size the user last left it (a zoomed or tiled window: the frame it would return to), kept on screen if the desktop has shrunk since. `window.width` / `height` are the size of the first launch.
- **Subtitles** are placed by the user: bottom, top, or wherever they drag them on the picture (Settings → Accessibility → Subtitles).
- **Developer Tools** has an icon of its own: in Launchpad while the tools are switched on, and in the Dock while their window is open.
- **Mission Control** (⌃↑, F3, or the Window menu) lays every open window out side by side. The windows are the live ones, only scaled; an application receives no event for it.
- Application packages are loaded only when an app actually opens.
- Native horizontal Launchpad paging is browser scroll physics plus CSS scroll snap; apps cannot intercept or synthesize Launchpad paging behavior.
