**English** · [简体中文](zh-CN/examples.md) · [日本語](ja/examples.md)

# Reference applications

Part of the application SDK documentation — start at [README](../README.md).

## 12. Reference applications

### Calculator

Included both as a readable directory and a one-file import package:

```text
plugin/examples/glass-calculator/
  src/ui.json
  src/main.js
  locales/*.json
  assets/icon.png
  assets/delete.svg

plugin/examples/glass-calculator.macos-app.json
```

The Calculator is a `runtime: "native"` app. It is dark by default (`window.appearance`) and its View menu lets the user choose light, dark or the system's appearance (`macos.window.setAppearance`); the keypad is repainted on `themechange`. Its keypad is a 4-column `grid` of `shape: "circle"` buttons with their own colours, the display is two `text` nodes, and the keyboard is handled through `macos.on('keydown')`. It requests a permanently dark window and declares an Edit menu with a working `⌘C` shortcut.

### Music

```text
plugin/examples/music/
  app.json
  src/ui.json
  src/main.js
  locales/*.json
  assets/icon.png
  assets/cover.svg

plugin/examples/music.macos-app.json
```

A full `runtime: "native"` application: import your own songs (file picker or drag onto the window), browse them by artist and album using their embedded tags and cover art, organise playlists and playlist folders, give each playlist a title and a cover image, search and sort, shuffle and repeat, manage the play queue, and export — a single song as its original file, or a playlist as one `.zip` that can be imported again. It shows the intended shape of a larger app:

- the whole interface is one `view()` function rendered with `macos.ui.render()`;
- audio files never enter the sandbox: they live in `macos.files` and are played by `macos.audio`;
- covers are `blob:<id>` image sources; the sidebar is a `plain` list with section headers, folder disclosure rows and per-row menus; the song list is a virtualised, reorderable, multi-select `list` with an `itemMenu`;
- the window has `titlebar: "hidden"` and a `split` root: sidebar on the window material, opaque content, optional queue pane;
- the player is a `material: "glass"` bar floating in a `zstack`; the info and settings sheets are just further branches of `view()`;
- `"settings": true` with a settings sheet that lets the user pick the app's accent (`macos.window.setAccentColor`);
- a progress bar driven by `fileprogress` while a large import is stored;
- export and import of one playlist (`macos.archive`) or one song; everything at once is left to System Settings ▸ Storage ▸ Export Data…;
- optional fades (settings): pausing and resuming fade, and songs cross-fade into each other (`macos.audio` `fade` / `crossfade`);
- page headers are `material: "bar"` layers over the lists (`insetTop`), so the rows scroll under a frosted title;
- on launch it asks for a required permission the user switched off (`macos.permissions.request`);
- a light / dark / automatic setting of its own (`macos.window.setAppearance`);
- a **Recently Played** widget in three sizes (`macos.widgets`): Music publishes it whenever what was played changes, and its Play buttons open Music and start that song;
- songs and playlists are listed for Spotlight with `macos.search`; choosing one plays it or opens the playlist;
- a menu bar item (`macos.statusItem`) shows what is playing and offers play / pause, next and previous while the window is out of sight.

### Books

```text
plugin/examples/books/
plugin/examples/books.macos-app.json
```

An e-book reader (`runtime: "native"`, bundled): EPUB books and CBZ comics, a bookshelf with collections, a paginated reader with themes, fonts, a table of contents and bookmarks, and a daily reading goal. Books are listed for Spotlight by title and author. It offers a **Continue Reading** widget (small and medium) with the book in progress, how far it is and today's reading time; its Continue button opens that book.

### Native Counter

```text
plugin/examples/native-counter.macos-app.json
```

This is the minimal `runtime: "native"` example. Its visible controls are rendered by the host and its sandbox contains only application logic.

### Hoshino (desktop pet)

```text
plugin/examples/hoshino-pet/
  app.json
  src/index.html, src/style.css
  src/sprite.js        the sprite sheet: clips and the sixteen look directions
  src/behaviour.js     resting, looking, standing on windows, falling, wandering, being carried
  src/main.js          settings, menus, start-up
  locales/*.json
  assets/sprites.webp  8 × 11 cells of 192 × 208
  assets/icon.png, assets/status.svg

plugin/examples/hoshino-pet.macos-app.json
```

A `runtime: "web"` application in a frameless, transparent, floating window with no Dock icon (`titlebar: "none"`, `material: "transparent"`, `level: "floating"`, `showInDock: false`):

- she is drawn from one sprite sheet by moving `background-position` — idle, waving, jumping, running left / right and more, plus sixteen poses looking in every direction;
- only she takes clicks: every pose is measured once from the sprite sheet's alpha channel and the window is cut to it with `macos.window.setShape`, so the desktop beside her stays clickable;
- pressing her starts `macos.window.beginDrag(event)`: carried sideways she runs in the air, held still she waits, and put down she lands (or stumbles against the edge of the desktop);
- she stands on things (`macos.desktop`, permission `windows`): the bottom of the screen, the top of the Dock, the top and the bottom edge of every window (Spotlight included) and of every widget on the desktop. With nothing under her feet she falls to the next edge underneath (`moveTo` with `easing: 'in'`), and standing on a window she is attached to it (`macos.window.attach`), so she rides along when it is dragged and falls when it closes. Both habits are switches in her menu;
- now and then she walks a little with `macos.window.moveTo(x, y, { duration })` — along whatever she stands on, and no further than its ends — jumps onto another edge within reach (from the ground onto the Dock: up with `easing: 'out'`, down with `'in'`), or plays one of her gestures: thinking it over, leaning in for a closer look, holding a hand out, sulking (all of them are in her menu too);
- she looks at the pointer only when it comes close (`macos.window.trackPointer`, permission `pointer`); across the desktop she keeps breathing and blinking;
- her menu bar item (`macos.statusItem`) and her right-click menu (`macos.ui.showMenu`, also available to Web Apps) offer, in submenus, the gestures and a walk on request, what a click on her does (one gesture, or one at random), her habits and three sizes — then calling her back, one more of her where the user allowed several windows (`macos.instances.open`), hiding and quitting; her place and settings are kept in `macos.storage`.

She runs only while the new tab is open, like every application. To have her on every new tab, switch on **Open with every new tab** for her in Settings → Applications (only the user can).

### Outside (weather on the desktop)

```text
plugin/examples/outside/
  app.json
  src/index.html, src/style.css
  src/weather.js       Open-Meteo, and how its codes become scenes
  src/sky.js           the canvas: particles, the surfaces things land on, lying snow
  src/main.js          the window, the panel, menus, the widget, the peers
  locales/*.json
  assets/icon.png, assets/status.svg

plugin/examples/outside.macos-app.json
```

A `runtime: "web"` application whose window is the whole desktop: frameless, transparent, `level: "desktop"` (behind every window), no Dock icon, and nowhere does it take the pointer (`macos.window.setHitRegion([])`) — except on its settings panel while that is open, for which it comes to the front (`setLevel('floating')`).

- one canvas, and as little drawn on it as the weather allows: rain and lightning 30 frames a second, snow, petals and leaves 24, clouds, fog and stars 12, and half of that while a window is being dragged. What never moves — the grey of a dull day, the light of a clear one, the mist along the ground — is a CSS background behind the canvas, painted once; each cloud is painted once into a small picture of its own;
- it watches what its frames cost and how often the browser misses one, and steps down by itself — fewer pixels (1.5 → 1.25 → 1 device pixels per point), then fewer particles and frames — and carefully up again when there is room. *Low Power* in its panel keeps it on the lowest step;
- because all of that is still a lot to ask of a slow machine, it says so when it starts (`macos.dialog.confirm`), until the user chooses *Don’t Show Again*;
- what falls lands on **surfaces** it gets from `macos.desktop.watch()` (permission `windows`): the bottom of the screen, the top of the Dock and the top edge of every window, each with the corner radius the system reports, so a drift follows the rounding instead of ending in a right angle. Rain splashes there; snow piles up — slowly, over minutes;
- every surface has its own lying snow. The moment a window moves, everything on it — snow, petals, leaves — breaks off and falls, and lies again on whatever is underneath; nothing is dragged along behind a window. The Dock's snow stays where it lies while the Dock grows and shrinks under the pointer, and what loses its footing falls the same way; nothing lies on the ground under the Dock. Petals and leaves lie for a few seconds only;
- when the weather changes, what the new scene has none of is gone in a third of a second — particles in the air, drifts, petals on the ground;
- being behind the windows, it needs no occlusion of its own for what it draws — only for what *lands*: a flake does not settle on an edge that another window covers;
- live weather through `macos.fetch` (permission `network`), the pointer as an umbrella (`pointer`), a status item with the scenes, a widget.

### Paper Plane (letters to your future self)

```text
plugin/examples/paper-plane/
  app.json
  src/index.html, src/style.css
  src/flight.js        the window as a plane: layouts, flight, landing
  src/main.js          letters, writing, reading, the mailbox, notifications
  locales/*.json

plugin/examples/paper-plane.macos-app.json
```

A frameless, floating accessory that changes size with what it shows — a sheet of paper, a plane with a speech bubble, a plane in flight moved a frame at a time with `moveTo`.

- a letter in the air is also a **scheduled notification** (`macos.notifications.schedule`, id = the letter's): the system shows it when the letter is due, with no new tab open, and opening it starts the application, where the plane then comes in to land. Reading, deleting or re-sending a letter cancels or replaces its notification;
- thrown by hand: `beginDrag` resolves with the speed of the pointer at the moment it let go (`frame.velocity`), and that is the plane's first push;
- while it runs, a timer lands the plane at the minute it is due; in front of the user that says it all and the notification is cancelled;
- everything on screen is written again when the system's language changes (`languagechange`), and the waiting notifications are rescheduled in the new language;
- `macos.context.launchReason` tells a launch by the user (the plane offers itself) from the user's *Open with every new tab* setting (it waits in the menu bar).

### Applications that work together: Hoshino and Outside

The two name each other in their manifests (`"peers": ["outside-weather"]` / `"peers": ["hoshino-pet"]`) and talk through `macos.apps`:

| from | message | what the other does |
| --- | --- | --- |
| Hoshino | `{ type: 'hello', head: { x, y, w } }` when she starts | Outside answers with the weather, and knows where in her window her head is: rain splashes on it, snow settles on it |
| Hoshino | `{ type: 'step', x, y, vx }` while she walks | the snow at her feet is scuffed aside |
| Hoshino | `{ type: 'land', x, y }` after a fall or a jump | the snow where she lands is scattered, and petals lying there fly up |
| Hoshino | `{ type: 'shake' }` | the snow on her head flies off |
| Outside | `{ type: 'hit', kind }` — rain, snow, a petal or a leaf came down on her; `snowcap` when the snow on her head is deep | she looks up, holds a hand out, leans in to see what it was — or jumps and shakes the snow off |
| Outside | `{ type: 'weather', scene, night }` when it changes | she holds a hand out into rain, snow and petals, droops at thunder, hops when it clears |

Neither depends on the other: without Outside she is a pet on a dry desktop, and without her the snow lies undisturbed. Both read the same layout from `macos.desktop`, so the window she stands on is the window the snow lies on.
