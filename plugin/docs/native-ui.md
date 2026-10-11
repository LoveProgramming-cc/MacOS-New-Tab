**English** · [简体中文](zh-CN/native-ui.md) · [日本語](ja/native-ui.md)

# Native App UI

Part of the application SDK documentation — start at [README](../README.md).

## 5. Native App UI

Native App UI is a tree of plain JSON nodes. The host validates every field and builds the real controls: text only reaches the page as text, style values come from a closed vocabulary, canvas drawing is a whitelisted display list and free-form HTML is confined to a script-less sandboxed frame.

`entry.ui` is either a root node, or `{ "styles": { … }, "root": { … } }` (see *Reusable styles*).

### Node types

| Kind | Types |
| --- | --- |
| Containers | `stack` (alias `group`), `split`, `grid`, `zstack`, `scroll`, `card`, `toolbar` |
| Text and media | `text`, `image`, `video`, `canvas`, `html`, `separator`, `spacer` |
| Controls | `button`, `input`, `textarea`, `switch`, `checkbox`, `slider`, `progress`, `select`, `segmented` |
| Collections | `list`, `table` |

Only containers have `children`.

### Layout direction

For a right-to-left language (Arabic, Hebrew, Persian, Urdu) — or with Developer ▸ **Force right-to-left layout** — the host mirrors a Native App by itself: horizontal stacks, grids, splits and lists run from the right, `start` / `end` alignment swaps sides, and the left and right of `padding` / `margin` are exchanged. An app has nothing to do.

What must not be mirrored is marked with `ltr: true` on the node: playback controls, a timeline, a numeric keypad, a phone number. The node and everything in it then keeps its left-to-right order.

`macos.context.direction` (and `macos.i18n.direction()`) is `'ltr'` or `'rtl'`; `languagechange` carries it as `direction`. That matters to an app that draws for itself — a `canvas`, an `html` node, a Web App — whose document the host cannot mirror. The package's `locales` map takes the language code the system uses (`"ar": "locales/ar.json"`).

### Properties every node accepts

- Identity: `id` (needed to patch the node or receive its events; any printable text up to 200 characters, so names and non-Latin titles work as ids), `hidden`, `disabled`, `tooltip`, `style` (one name or a list of names from the style table).
- Size: `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` — a number of CSS px, `"fill"` (100%), `"auto"` or a percentage string.
- Placement: `grow`, `alignSelf` (`start` / `center` / `end` / `stretch`), `justifySelf` (horizontal placement inside a `grid` / `zstack`), `span` and `rowSpan` (inside a `grid`), `padding` and `margin` (a number, `[vertical, horizontal]` or `[top, right, bottom, left]`).
- Appearance: `background`, `gradient` (two to four colours, top to bottom, in place of a flat background), `color`, `border` (`true` or a colour), `radius` (a number or `"full"`), `opacity`, `fontSize`, `fontWeight` (100–900 or `light` / `regular` / `medium` / `semibold` / `bold`), `textAlign`, `font` (`system` / `mono` / `rounded`), `material` (`glass`, `sidebar`, `content`, `clear` — see *Material ownership*).

Controls are drawn with the system's own metrics — the buttons, fields, switches, cards and selection colour of System Settings — so an app that sets no appearance properties looks like a system window. Appearance properties are for deliberate departures (the Calculator's round keys), not for getting the basics right.

Layers of a `zstack` are painted strictly in order: a later child is always above an earlier one.

`dismissable: true` marks a popover: while the node is on screen, a press anywhere else in the window emits `dismiss` on it, with `targetId` — the id of what was pressed. Close the popover there, except when `targetId` is the button that toggles it (that button's own `click` follows):

```js
if (id === 'appearance' && event === 'dismiss' && targetId !== 'toggle-appearance') { open = false; render(); }
```

`showOnHover: true` on any node keeps it invisible until the pointer is over its parent container — the way to build hover affordances (a favourite star beside a title, an “expand” glyph over a cover) without a round trip to the app.

A `segmented` control is as wide as its segments and centred in the room it is given, as in AppKit. With a width (`width: "fill"`), the segments share it equally.

**Escape.** A `keydown` listener that used Escape (closed a sheet, left a full-window view) returns `true`. If no listener did, the host closes the window, as Escape closes system windows; while a field is being typed in, Escape only takes the focus out of it. A Web App gets the same behaviour from its own document: call `preventDefault()` on an Escape it handled.

```js
macos.on('keydown', ({ key }) => {
  if (key === 'Escape' && sheetOpen) { sheetOpen = false; render(); return true; }
});
```

`select` is drawn as the system's pop-up button and opens the system's menu, not the browser's list.

Keyboard input belongs to the app: the host forwards keys while the window is in front, and keeps doing so after an update removes the control that had focus. An `html` node is a frame, and a click inside one would take the keyboard into that frame where nothing reaches the app — so focus returns to the app at once. Set `selectable: true` on an `html` node whose text is meant to be worked with by keyboard (the app then gets no keys while the frame has focus).

### Transitions

Animation in a Native App belongs to the host. A node names how it arrives; the host runs it, runs the same animation backwards when the node leaves, and skips both when the user has switched animation off (Settings → Accessibility → Reduce motion) — an app has nothing to check.

```js
{ type: 'zstack', id: 'now-playing', transition: 'slide-up', children: [ … ] }
```

`transition` is one of `slide-up`, `slide-down`, `slide-left`, `slide-right` (the direction the node travels as it arrives), `fade` or `scale`. It plays when the node is added to an interface that is already on screen — through `render`, `setChildren`, `append` or `replace` — never for the first render of the window.

Leaving needs somewhere to be while the animation runs, so it applies to layers of a `zstack`: the removed layer stays on top, plays its transition in reverse and is then taken out. In the same way, a layer that is replaced while another one arrives over it stays underneath until the newcomer has settled, which is what makes a full-window view slide over the previous one rather than over an empty window. In any other container a removed node simply goes. A leaving layer no longer has ids or receives input; a `video` node inside it keeps showing the picture until it is gone.

A layer that arrives with an `html` node inside waits at its starting position until that frame's document has loaded (a few frames at most), so it comes in with its content rather than blank.

A `video` node (`fit`: `contain` / `cover`) shows the picture of the app's media player — whatever `macos.audio.load()` is playing (permission `audio`). The player is one host element that is moved into the node and back out again, so adding or removing the node never interrupts playback. `click` and `activate` (double-click) are reported.
- Interaction: `contextMenu` (menu items shown on right-click), `hover: true` (emit `hoverstart` / `hoverend`).

Colours are hex (`#ff9500`), `rgb()` / `rgba()` / `hsl()`, or a system token: `accent`, `red`, `orange`, `yellow`, `green`, `teal`, `purple`, `pink`, `gray`, `text`, `secondary`, `tertiary`, `control`, `fill`, `separator`, `clear`. Tokens follow the window's light/dark appearance.

A root node that sets `padding` owns the content area edge to edge; otherwise the host applies its standard 14 px inset. The root is at least as tall as the window; give it `"height": "fill"` for a fixed full-window layout whose inner `list` / `table` / `scroll` nodes do the scrolling.

### Image sources

`image.src`, `button.icon`, list and table row `icon`, and canvas `drawImage` all accept:

| Source | Example |
| --- | --- |
| A package image | `assets/cover.png` |
| A stored file (see `macos.files`) | `blob:<file id>` — files the user picked or dropped, or data the app saved |
| An inline image | `data:image/png;base64,…` (up to about 3 MB) |
| A remote image | `https://…` — needs the `network` permission; private-network hosts are refused |

### Type-specific properties

- `stack`: `direction` (`vertical` / `horizontal`), `gap`, `align`, `justify` (`start` / `center` / `end` / `between` / `around` / `evenly`), `wrap`. A horizontal stack centres its children vertically unless `align` says otherwise.
- `grid`: `columns` — a count (equal columns) or a list of tracks such as `[200, "1fr", "auto"]`; `gap`, `rowHeight` (px or `"auto"`), `align`, `justify`.
- `zstack`: children are layered on top of each other (overlays, badges on images); `align` / `justify` position them, `alignSelf` overrides per child.
- `scroll`: `direction` (`vertical` / `horizontal` / `both`), `scrollEvents`. What is inside a scroll view keeps its natural size along the scrolling axis — content that does not fit scrolls, it is never squeezed. Everywhere else a `stack` gives its children only the room there is, so a page whose length depends on its content (a library, a feed) belongs in a `scroll`.
- `text`: `text` / `textKey`, `variant` (`title`, `headline`, `body`, `caption`, `muted`, `display`, `mono`), `lines` (truncate after n lines), `selectable`, or `runs` for rich text: `[{ text, bold, italic, underline, strike, code, color, link }]`. Clicking a run with `link` emits a `link` event carrying `href`; nothing is opened automatically.
- `button`: `label` / `labelKey`, `variant` (`primary`, `danger`, `plain`, `tinted`), `shape` (`circle`, `pill`), `icon`, `iconSize`, `iconTint` (draw a monochrome glyph in the button's text colour so it follows the theme and `color`).
- `input`: `value`, `placeholder` / `placeholderKey`, `inputType` (`text`, `number`, `password`, `search`, `email`, `url`), `maxLength`, `readOnly`, `selectionEvents`.
- `textarea`: `value`, `placeholder`, `rows`, `maxLength`, `readOnly`, `selectionEvents`. See *Text selection* below.
- `switch`, `checkbox`: `checked`, `label` / `labelKey`.
- `slider`: `min`, `max`, `step`, `value`. `progress`: `max`, `value` (omit `value` for indeterminate).
- `select`, `segmented`: `options` (strings or `{ value, label, labelKey }`), `value`.
- `list`: `items` (`{ id, title, titleKey, subtitle, detail, badge, icon, disabled, emphasis, indent, disclosure, header, menu }`), `iconSize`. `header: true` makes a non-selectable section caption; `indent` nests a row; `disclosure` (`open` / `closed`) draws a folder chevron (clicking it emits `disclose` instead of selecting the row); `menu` gives one row its own right-click menu; `drag: false` / `drop: false` exclude a row from dragging / from being a drop target. Rows with `children` make the list an outline, and `sections` groups it under titles — see *Outlines and sections*.
- `table`: `columns` (`{ id, title, titleKey, width, align, sortable, muted }`, `width` is px, `"Nfr"` or `"auto"`), `rows` (`{ id, cells: { columnId: text }, icon, emphasis, disabled }`), `sort` (`{ column, direction }`), `header`, `striped`.
- `list` and `table` share: `value` (selected id), `multiple` + `values` (multi-selection with ⌘ / ⇧ click), `reorderable` (drag rows to a new position), `draggable` + `dropTarget` (drag rows onto rows of another list — see *Dragging between lists*), `itemMenu` (right-click menu for rows), `rowHeight`, `placeholder` (shown when empty), `scrollEvents`, `plain` (no border or background — sidebars), `insetBottom` (extra scrollable space under the last row, e.g. beneath a floating bar). Up to 20 000 rows; only the rows in view exist in the page, so long collections stay fast. Without an explicit size they show up to 12 rows and scroll beyond that.
- `image`: `src`, `alt`, `fit` (`contain` / `cover`). Emits `click`.
- `canvas`: `commands` — a display list, see below; `pointer: true` to receive pointer events.
- `html`: `html`, `css` — static rich content, see below.
- `separator`: `vertical`.

### Canvas

A `canvas` node draws a list of commands, each `[name, ...args]`. It is resolution-independent: coordinates are CSS px and the host handles the device pixel ratio and redraws on resize and theme change.

```js
await macos.ui.patch('chart', { commands: [
  ['fillStyle', 'accent'], ['fillRect', 10, 40, 24, 80],
  ['strokeStyle', 'secondary'], ['lineWidth', 1], ['beginPath'], ['moveTo', 0, 120], ['lineTo', 300, 120], ['stroke'],
  ['fillStyle', 'text'], ['font', 12, 'semibold'], ['textAlign', 'center'], ['fillText', 'Mon', 22, 136],
  ['drawImage', 'blob:' + fileId, 200, 10, 64, 64]
] });
```

State: `fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`, `font` (size, weight, `system` / `mono` / `rounded`), `textAlign`, `textBaseline`, `lineCap`, `lineJoin`, `setLineDash`, `shadow` (colour, blur, x, y), `save`, `restore`, `translate`, `scale`, `rotate`, `clip`.
Drawing: `fillRect`, `strokeRect`, `clearRect`, `beginPath`, `moveTo`, `lineTo`, `rect`, `roundRect`, `arc`, `ellipse`, `quadraticCurveTo`, `bezierCurveTo`, `closePath`, `fill`, `stroke`, `fillText`, `strokeText`, `drawImage`.

With `pointer: true` the node emits `pointerdown`, `pointermove` (while a button is held; once per frame) and `pointerup`, each with `x`, `y` relative to the canvas.

### Static HTML

An `html` node renders package-supplied or generated markup — a Markdown preview, an article body, formatted help — inside a sandboxed frame that cannot run script or load anything from the network. `<script>`, frames, forms and event attributes are removed; images must be `data:` URLs; links are inert (use `text` with `runs` when you need clickable links). The frame scrolls on its own, so give the node a `height` or `grow`.

This is how a mostly-native app gets a free-form region without switching the whole app to the Web runtime.

### Reusable styles

```json
{
  "styles": {
    "card-title": { "fontSize": 15, "fontWeight": "semibold" },
    "chip": { "background": "fill", "radius": "full", "padding": [2, 8], "fontSize": 11 }
  },
  "root": { "type": "stack", "children": [
    { "type": "text", "style": "card-title", "text": "Inbox" },
    { "type": "text", "style": ["chip"], "text": "12" }
  ] }
}
```

A style is a named bag of properties; a node's own properties win. Add more at run time with `macos.ui.defineStyles({ … })`.

### Events

```js
macos.on('ui', ({ id, event, value, values, checked, itemId, menuId }) => {
  // click                     button, image, text with an id
  // input, change             input, textarea, slider, select, switch, checkbox, segmented
  // submit                    Enter pressed in an input
  // focus, blur               input, textarea
  // select, activate          list / table: selection changed / row double-clicked or Enter (itemId)
  // reorder                   list / table: { itemId, index, order } after a row was dragged
  // rowdrop                   list / table with dropTarget: { itemId, position, index, parentId, sectionId, sourceId, items }
  // expand                    list (outline): a row was opened or closed ({ itemId, expanded, expandedIds })
  // section                   list (sections): a collapsible section was folded ({ sectionId, collapsed, collapsedIds })
  // disclose                  list: the chevron of a row with `disclosure` was clicked ({ itemId })
  // sort                      table: { column, direction } — re-supply the rows in that order
  // menu                      contextMenu / itemMenu choice: { menuId, itemId? }
  // link                      text run with a link: { href }
  // reachend, scroll          scroll / list / table: near the end; position (with scrollEvents)
  // hoverstart, hoverend      any node with hover: true
  // pointerdown / move / up   canvas with pointer: true
});
```

Events carry the control's current `value` / `values` / `checked`, so a separate `macos.ui.get()` is rarely needed.

Keyboard input is forwarded while the app window has focus:

```js
macos.on('keydown', ({ key, code, altKey, ctrlKey, metaKey, shiftKey, repeat, editing, targetId }) => {});
macos.on('keyup', (detail) => {});
```

`editing` is `true` when the key was typed into an `input` / `textarea`. Outside text fields the host already suppresses the page's default action for Space, arrows, Enter, Backspace and Tab, so the app can use them freely. As in AppKit, clicking a button does not move keyboard focus onto it.

Files dragged from the user's desktop onto the window (permission `files`) are stored first and then announced:

```js
macos.on('drop', ({ files, rejected, targetId, itemId, x, y }) => {
  // files: [{ id, name, type, size, duration?, width?, height? }] — already in macos.files
});
```

Storing takes time when there are many files (each is probed, tagged and written). While the host works through a drop or a `openFile({ store: true })` selection it reports progress, first with `done: 0` and last with `done === total`, so the app can show a progress bar:

```js
macos.on('fileprogress', ({ source, done, total, name }) => {});   // source: 'drop' | 'picker' | 'export' (macos.archive.create, one step per entry packed)
```

List rows may carry `tint: true`: the row's `icon` is then treated as a monochrome glyph and drawn in the accent colour (white on a selected row) instead of being shown as a picture.

### Text selection

Every event of an `input` or `textarea`, and `macos.ui.get(id)`, carries the selection: `selectionStart`, `selectionEnd`, `selectionDirection` and `selectionText`. With `selectionEvents: true` the control also sends a `selection` event whenever the caret or the selection moves.

```js
const { selectionText } = await macos.ui.get('body');
await macos.ui.replaceSelection('body', `**${selectionText}**`, { select: 'all' });   // 'end' (default) | 'start' | 'all'
await macos.ui.setSelection('body', { start: 120, end: 131 });                           // scrolled into view; reveal: false to leave the view alone
```

`replaceSelection` types the text through the browser's own editing, so ⌘Z takes it back like anything the user typed. Undo and redo (⌘Z, ⇧⌘Z), cut, copy, paste and select-all in a text control are the browser's and are never intercepted by the host. A search inside a long text is `value.indexOf()` plus `setSelection()`.

**Paste.** An application that listens for `paste` is told what ⌘V brought:

```js
macos.on('paste', ({ id, types, files, text }) => {
  // files: pasted files (a copied image, a screenshot) — already in macos.files, never typed into a field
  // text:  only when no text control had the focus; into a focused control the text goes by itself
});
```

Storing pasted files needs the `files` permission. Without a `paste` listener the host does nothing about pasting.

### Dragging between lists

Give the source `draggable: true` and the destination `dropTarget: true`. Dragging one or more selected rows onto a row of the destination highlights it and, on release, emits `rowdrop` **on the destination** with the target row's `itemId`, the source list's id as `sourceId` and the dragged row ids as `items`. Nothing moves by itself — update your state and render.

```js
macos.on('ui', ({ id, event, itemId, sourceId, items }) => {
  if (id === 'sidebar' && event === 'rowdrop' && sourceId === 'songs') addToPlaylist(itemId, items);
});
```

A list can be both (rows dragged onto other rows of the same list, e.g. a playlist onto a folder). Inside a `reorderable` list a drag within the list reorders; dragging out of it onto a `dropTarget` drops.

**Dropping between rows.** By default a drop lands *on* a row. `dropPosition: 'between'` makes the destination take drops in the gaps instead, shown as an insertion line; `'both'` does either (the middle half of a row is "on", its top and bottom quarters are the gaps). `rowdrop` then also says where:

| field | meaning |
| --- | --- |
| `position` | `'on'`, `'before'` or `'after'` the row `itemId` |
| `index` | where the rows would go among the destination's visible rows (0 = first) |
| `parentId` | in an outline: the row they would become children of (`''` at the top level) |
| `sectionId` | in a sectioned list: the section they fall in |

Under an open outline row, the gap is reported as `'before'` its first child, so `parentId` is that row. An empty list reports `itemId: ''`, `index: 0`. A section title takes a drop as `position: 'on'` with `itemId: ''` and its `sectionId`.

Files dragged in from outside follow the same rules over a `dropTarget` list: the insertion line is shown while they hover, and the `drop` event carries the same `position`, `index`, `parentId` and `sectionId` next to its `targetId` / `itemId`.

### Outlines and sections

**Outline (tree).** Give rows `children` and the list draws them as a tree: indentation, chevrons, and ← / → on the keyboard (→ opens a row or steps into it, ← closes it or steps out to its parent). Up to 8 levels; nested rows count towards the 20 000-row limit.

```js
{ type: 'list', id: 'tree', expanded: ['src'], items: [
  { id: 'src', title: 'src', icon: folder, children: [
    { id: 'src/main.js', title: 'main.js' },
    { id: 'src/lib', title: 'lib', expandable: true }      // children supplied when opened
  ] },
  { id: 'README.md', title: 'README.md' }
] }

macos.on('ui', ({ id, event, itemId, expanded, expandedIds }) => {
  if (id === 'tree' && event === 'expand' && expanded && !loaded.has(itemId)) loadChildren(itemId);   // then render
});
```

The host opens and closes rows by itself and remembers what is open across renders; `expand` only tells you about it (store `expandedIds` if it should survive a restart). Pass `expanded` to set it yourself. `expandable: true` shows a chevron on a row whose children you have not loaded yet. Closing a row that contains the selection moves the selection to that row. Rows that only use `indent` / `disclosure` keep working as before and emit `disclose`.

**Sections.** `sections` replaces `items` with titled groups. The title of the group being read stays pinned to the top of the list while its rows scroll under it (`stickyHeaders: false` turns that off). A section with `collapsible: true` folds when its title is clicked.

```js
{ type: 'list', id: 'songs', sections: [
  { id: 'a', title: 'A', detail: '12', collapsible: true, items: [...] },
  { id: 'b', title: 'B', detail: '7', collapsible: true, items: [...] }
] }
// 'section' { sectionId, collapsed, collapsedIds } — `collapsed` on the node sets it from your side
```

Section ids share the row id space of the list (keep them distinct from row ids). Sections can hold outline rows.

Outlines and sectioned lists ignore `reorderable`, since a flat position says too little there. Move rows with `draggable` + `dropTarget` + `dropPosition: 'between'` (or `'both'`) and use `parentId` / `sectionId` / `index` from `rowdrop`.

### Updating the UI

The simplest model is declarative: keep your state in JavaScript and describe the whole interface as a function of it.

```js
const view = () => ({ type: 'stack', id: 'root', children: items.map((item) => ({ type: 'text', id: `row:${item.id}`, text: item.title })) });
await macos.ui.render(view());   // call again whenever state changes
```

`render()` diffs the new tree against what is on screen and changes only what differs. Children are matched by `id` (or by position and type when they have none), so text fields keep focus and their caret, scroll positions and media are preserved, and unchanged nodes are not rebuilt. A field the user is currently typing in keeps its own text even if your state is a keystroke behind.

Targeted updates are available when you want them:

```js
macos.ui.patch('value', { text: '42', color: 'accent' });        // any property; null removes it
await macos.ui.append('rows', { type: 'text', text: 'New row' });  // optional third argument: index
await macos.ui.setChildren('rows', [/* nodes */]);                 // diffed like render()
await macos.ui.replace('row-3', { type: 'card', id: 'row-3', children: [] });
await macos.ui.remove('row-3');
await macos.ui.focus('field');
await macos.ui.scrollTo('songs', { itemId: 'song-42' });           // or { top: 0 }
const state = await macos.ui.get('field');                         // { value, checked, disabled } / { value, values } / { text }
const choice = await macos.ui.showMenu([{ id: 'a', label: 'First' }, { separator: true }, { id: 'b', label: 'Second', danger: true }]);
```

A menu entry with `submenu` — a list of the same shape, two levels deep at most — opens a further menu beside it instead of being a choice: `{ label: 'Size', submenu: [{ id: 'size:small', label: 'Small', checked: true }, …] }`. The same goes for the menu of a status item.

`patch()` calls made in the same tick are sent to the host as one message, so updating many controls at once costs a single round trip.

A tree is limited to 2 000 nodes in strict mode (8 000 otherwise). Long collections belong in `list` / `table` rows, which do not count as nodes.

## 6. Web App native UI stylesheet

Web Apps automatically load:

```text
plugin/sdk/native-ui.css
```

It provides system-token-based primitives including:

```text
.macos-app
.macos-glass
.macos-glass-strong
.macos-card
.macos-toolbar
.macos-button
.macos-input
.macos-select
.macos-switch
.macos-segmented
.macos-list
.macos-separator
.macos-icon-button
.macos-checkbox
.macos-slider
.macos-progress
.macos-panel
.macos-sheet
.macos-group
.macos-sidebar
.macos-badge
.macos-menu
.macos-menu-item
.macos-title
.macos-caption
.macos-muted
```

Useful variables include:

```css
var(--macos-text)
var(--macos-secondary)
var(--macos-glass)
var(--macos-glass-strong)
var(--macos-control)
var(--macos-border)
var(--macos-blue)
var(--macos-red)
var(--macos-orange)
```

These are **inner translucent materials**, not independent full-window backdrop samplers.
