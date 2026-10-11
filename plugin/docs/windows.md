**English** · [简体中文](zh-CN/windows.md) · [日本語](ja/windows.md)

# Windows, icons, accent and materials

Part of the application SDK documentation — start at [README](../README.md).

## 4. Window contract

`window` supports:

- `width`, `height` — initial **CSS-pixel** outer window size, including the host title bar.
- `minWidth`, `minHeight` — resize limits.
- `resizable` — `false` fixes the window size (same as `resize: "none"`).
- `resize` — which edges the user may drag: `"both"` (default), `"horizontal"`, `"vertical"` or `"none"`.
- `maxWidth`, `maxHeight` — upper limits for manual resizing and for zoom; omit for "as large as the screen allows".
- `appearance` — `"system"`, `"light"`, or `"dark"`: the appearance the window starts with. The application can change it at run time with `macos.window.setAppearance()` (below), which is how it offers the user a light / dark / automatic choice in its own settings.
- `material` — `"glass"`, `"solid"`, or `"transparent"`.
- `titlebar` — `"standard"` (a title strip with the traffic lights, icon and title), `"none"` (see *Frameless, floating and accessory windows* below) or `"hidden"` (no strip: the traffic lights float over the top-left corner and the content runs the full height, like System Settings and Finder). With `"hidden"` the window is dragged by any bare surface of the content — containers, spacers, plain text, an image without an `id`, a `video` node — never by a control. A drag does not also count as a click on the surface it started on.
- `titlebarHeight` — 32–72 CSS px (standard title bar only).
- `borderRadius` — 8–28 CSS px. The default, 12, is the system window radius.
- `showTitle` — whether the standard title bar shows the app icon/title.

- `level` — `"normal"` (default), `"floating"` (the window stays above every ordinary window, whichever of them is in front) or `"desktop"` (it stays behind every ordinary window, over the wallpaper, the desktop's icons and its widgets — weather, a clock drawn on the desktop). Windows on either level step aside while Launchpad is open and are not part of Mission Control. `macos.window.setLevel(level)` changes it while running: a desktop-level window that opens a panel of its own comes to `"floating"` for as long as the panel is open.
- `showInDock` — `false` makes the application an *accessory*: no Dock icon while it runs, and clicking its window does not hand it the menu bar. It needs a menu bar item (`macos.statusItem`, permission `statusItem`) to be reachable; as long as it has none — the permission is off, or the item has not been set yet — the Dock shows it as usual, so it can always be found and quit.

### Frameless, floating and accessory windows

`titlebar: "none"` removes the title bar and the window buttons altogether. Nothing of the host is drawn: with `material: "transparent"` the window is only what the application paints, without a frame or shadow. Such a window

- may be as small as 40 × 40 and cannot be resized by the user (`window.resize()` still works);
- stays wholly on the desktop, below the menu bar: wherever it is moved, and when the browser window gets smaller — it is then moved back in and receives `screenchange` with `moved: true`;
- is moved by the application: `macos.window.beginDrag(event)` from a `pointerdown` lets the user carry it by whatever was pressed, and `macos.window.moveTo(x, y, { duration })` moves (or glides) it — see `macos.window` in §7;
- cannot be minimised or zoomed from the Window menu; `macos.window.minimize()` / `focus()` hide and show it, `close()` quits.

A desktop pet combines all three:

```json
"window": { "width": 106, "height": 114, "titlebar": "none", "material": "transparent", "level": "floating", "showInDock": false }
```

**Shape.** A window is a rectangle and, left alone, all of it takes the pointer — transparent parts too. A frameless window can say what it really covers with `macos.window.setShape(rects)`: a list of `[x, y, width, height]` rectangles in window coordinates (up to 400). The window is cut to their union, and a click anywhere else goes to whatever is underneath — the desktop, its icons, another window. Call it again whenever the picture changes (a pet: whenever the pose changes; the host ignores a shape it already has); `setShape(null)` makes the whole window count again. While the application has not set a shape, the whole window counts.

```js
// one cell of the pose, measured once from its alpha in 8 px blocks and grown by a block so it is easy to grab
await macos.window.setShape([[12, 0, 30, 8], [6, 8, 44, 60], [14, 68, 28, 40]]);
```

See *Hoshino* in §12 for a complete one: it measures every pose of its sprite sheet from the image's alpha channel.

**Where it takes the pointer.** A shape cuts the window — what is outside it is not drawn either. `macos.window.setHitRegion(rects)` (Web Apps) leaves the picture alone and only says where the window takes the pointer: the listed `[x, y, width, height]` rectangles (up to 64). Everywhere else clicks go to whatever is underneath although the window is drawn there. `[]` makes the whole window click-through; `null` gives it the pointer everywhere again.

```js
// rain over the whole desktop, one panel that can be clicked
const r = panel.getBoundingClientRect();
await macos.window.setHitRegion(panel.hidden ? [] : [[r.left, r.top, r.width, r.height]]);
```

Use `setShape` when the window is exactly what it draws (a pet: the cut also keeps its layer small), `setHitRegion` when it draws more than it wants to be clicked on (weather, a soft shadow around a card, a speech bubble). The pointer positions of `trackPointer` keep arriving over the click-through parts.

The red, yellow and green buttons are the host's: close, minimise into the Dock icon (scale effect) and zoom. Zoom takes the window to the largest size its resize rules allow — the whole area between the menu bar and the Dock for a freely resizable window, full height only for a `"vertical"` one, never beyond `maxWidth` / `maxHeight` — and centres whatever does not fill that area. A window that cannot be resized at all has its green button disabled. Dragging a zoomed window pulls it back to its previous size under the pointer. A minimised or hidden app keeps running. The host also adds a **Window** menu (Minimize, Zoom) to every app's menu bar.

`moveTo(x, y, { duration, easing })` takes `easing: 'linear'` (the default), `'ease'`, `'in'` (gathering speed, as something falling does) or `'out'` (losing it, as something thrown upwards does). A window can also travel with another one — `macos.window.attach`, see `macos.desktop` in §7.

### Application icon

Draw the icon on the macOS icon grid: a square canvas with the artwork (the rounded square) occupying about 80% of it, centred — 824 of 1024 px. Launchpad, the Dock and Finder show application icons at full size next to the built-in ones, so an icon that fills its canvas edge to edge looks oversized and one with extra padding looks small.

### Accent colour

The system accent is either one fixed colour or **Multicolor**. With Multicolor each application uses its own accent: the manifest's `accentColor` (`blue`, `purple`, `pink`, `red`, `orange`, `yellow`, `green`, `graphite` or `#rrggbb`; default blue), which the app can change at run time with `macos.window.setAccentColor()`. With a fixed system colour every application uses that colour and the app's own choice is kept but not shown.

The accent drives selection, primary and tinted buttons, focus rings, progress bars, links, tinted list icons and the `accent` colour token. `blue` as a colour token stays blue. The host offers no per-app accent setting: an app that wants its users to choose one builds that into its own settings (see *Settings…* in §8) and stores the choice itself.

```js
macos.context.accentColor    // '#ff5257' — the colour in effect now
macos.context.accentSetting  // 'multicolor' or the fixed system colour's name
await macos.window.setAccentColor('purple');   // or '#8844ee'; null returns to the manifest accent
macos.on('accentchange', ({ accentColor, accentSetting }) => {});
```

`appearance: "system"` follows the desktop. A Calculator-like application may request `"dark"` permanently.

### Material ownership

The **outer application window owns the expensive wallpaper backdrop blur**. App content should normally have a transparent root. Do not paint a second full-window blur inside the app.

Inside the window a native app chooses surfaces per container with `material`, the way a SwiftUI app does:

| `material` | Surface |
| --- | --- |
| `sidebar` / `clear` | nothing of its own — the window material (frosted wallpaper) shows through |
| `content` | the opaque window background, as in the right-hand side of System Settings |
| `glass` | a floating frosted panel over the app's own content (player bars, sheets) |
| `bar` | a frosted bar over the content of its own window: a page title or toolbar that the page scrolls underneath. It blurs that content on the window's opaque base, never the desktop |

A `bar` floats, so it is a layer of a `zstack` above the page, and the page leaves room for it:

```js
{ type: 'zstack', children: [
  { type: 'list', id: 'songs', insetTop: 62, items },                       // rows start below the bar and scroll under it
  { type: 'stack', material: 'bar', height: 62, alignSelf: 'start', justifySelf: 'stretch', children: [title, search] }
] }
```

A `list` / `table` takes `insetTop` (and `insetBottom`, for a bar floating at the bottom): its rows start below the bar. A `scroll` takes the same two properties to keep its scroll bar clear of the bars; give its content that much padding yourself. This is how System Settings, Finder, Music and Books draw their headers.

The `split` container applies the usual arrangement by itself: its first child is a sidebar (window material, hairline on the right), every further child is opaque content, and a third child gets a hairline on the left (an inspector). Set `material` on a pane to override it: `material: "clear"` on the content pane gives an all-glass window, `material: "content"` on the sidebar gives one with no glass at all (or use `window.material: "solid"`).

The sidebar pane scrolls by itself when its content is taller than the window. Parts that can give way — a `list`, which scrolls internally — shrink first; the pane's scroll bar only appears once fixed-height content no longer fits. Nothing needs to be declared for this.

Where blur is switched off (Reduce Transparency, or transparency instead of frosted glass), `glass` panels become opaque raised surfaces, because unblurred glass over scrolling content is unreadable. Apps do nothing for this.

When Developer Mode → **Use transparency instead of frosted glass** is enabled, the host keeps the same semantic material but disables backdrop sampling. Apps therefore remain visually consistent without implementing their own special performance mode.

When Reduce Transparency / Increase Contrast is active, the host likewise changes the material centrally.
