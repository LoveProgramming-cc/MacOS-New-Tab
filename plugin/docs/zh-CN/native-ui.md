[English](../native-ui.md) · **简体中文** · [日本語](../ja/native-ui.md)

# Native App 界面

应用程序 SDK 文档的一部分 — 请从 [README](../../README.zh-CN.md) 开始阅读。

## 5. Native App 界面

Native App 的界面是一棵由普通 JSON 节点组成的树。宿主校验每个字段并构建真正的控件：文本只会作为文本进入页面，样式值来自封闭的词汇表，画布绘制是一份白名单内的显示列表，自由形式的 HTML 被限制在一个无脚本的沙盒框架里。

`entry.ui` 要么是一个根节点，要么是 `{ "styles": { … }, "root": { … } }`（见 *可复用样式*）。

### 节点类型

| 种类 | 类型 |
| --- | --- |
| 容器 | `stack`（别名 `group`）、`split`、`grid`、`zstack`、`scroll`、`card`、`toolbar` |
| 文本与媒体 | `text`、`image`、`video`、`canvas`、`html`、`separator`、`spacer` |
| 控件 | `button`、`input`、`textarea`、`switch`、`checkbox`、`slider`、`progress`、`select`、`segmented` |
| 集合 | `list`、`table` |

只有容器有 `children`。

### 布局方向

对于从右到左的语言（阿拉伯语、希伯来语、波斯语、乌尔都语）— 或者启用 开发者 ▸ **强制从右到左布局** 时 — 宿主会自行镜像 Native App：水平的 stack、grid、split 和 list 从右边开始排，`start` / `end` 对齐互换两侧，`padding` / `margin` 的左右互换。应用什么都不用做。

不应被镜像的内容用节点上的 `ltr: true` 标记：播放控制、时间线、数字键盘、电话号码。该节点及其内部的一切就会保持从左到右的顺序。

`macos.context.direction`（以及 `macos.i18n.direction()`）是 `'ltr'` 或 `'rtl'`；`languagechange` 以 `direction` 携带它。这对自己绘制的应用很重要 — `canvas`、`html` 节点、Web App — 它们的文档宿主无法镜像。包的 `locales` 映射使用系统所用的语言代码（`"ar": "locales/ar.json"`）。

### 每个节点都接受的属性

- 标识：`id`（要 patch 节点或接收其事件时需要；任何可打印文本，最长 200 个字符，所以名称和非拉丁文字的标题都可以用作 id）、`hidden`、`disabled`、`tooltip`、`style`（样式表中的一个名称或名称列表）。
- 尺寸：`width`、`height`、`minWidth`、`minHeight`、`maxWidth`、`maxHeight` — CSS 像素数、`"fill"`（100%）、`"auto"` 或百分比字符串。
- 位置：`grow`、`alignSelf`（`start` / `center` / `end` / `stretch`）、`justifySelf`（在 `grid` / `zstack` 内的水平位置）、`span` 和 `rowSpan`（在 `grid` 内）、`padding` 和 `margin`（一个数、`[垂直, 水平]` 或 `[上, 右, 下, 左]`）。
- 外观：`background`、`gradient`（两到四种颜色，从上到下，代替纯色背景）、`color`、`border`（`true` 或一种颜色）、`radius`（一个数或 `"full"`）、`opacity`、`fontSize`、`fontWeight`（100–900 或 `light` / `regular` / `medium` / `semibold` / `bold`）、`textAlign`、`font`（`system` / `mono` / `rounded`）、`material`（`glass`、`sidebar`、`content`、`clear` — 见 *材质归属*）。

控件按系统自己的度量绘制 — “系统设置”的按钮、输入框、开关、卡片和选中颜色 — 所以不设置任何外观属性的应用看起来就像系统窗口。外观属性是为有意的偏离准备的（计算器的圆形按键），而不是用来把基础的东西弄对。

`zstack` 的各层严格按顺序绘制：后面的子节点总在前面的子节点之上。

`dismissable: true` 标记一个弹出层：节点在屏幕上期间，在窗口中其他任何地方按下，都会在它上面发出 `dismiss`，并带有 `targetId` — 被按下的东西的 id。在那里关闭弹出层，但 `targetId` 是用来切换它的那个按钮时除外（该按钮自己的 `click` 会随后到来）：

```js
if (id === 'appearance' && event === 'dismiss' && targetId !== 'toggle-appearance') { open = false; render(); }
```

任何节点上的 `showOnHover: true` 都会让它保持不可见，直到指针位于其父容器之上 — 这是构建悬停提示的方式（标题旁的收藏星标、封面上的“展开”图形），不需要往返应用一次。

`segmented` 控件的宽度与它的各段相当，并在给它的空间中居中，和 AppKit 中一样。给定宽度（`width: "fill"`）时，各段平分这个宽度。

**Escape。** 用掉了 Escape 的 `keydown` 监听器（关闭了表单、离开了全窗口视图）返回 `true`。如果没有监听器这样做，宿主就关闭窗口，就像 Escape 关闭系统窗口一样；正在输入框里输入时，Escape 只是让焦点离开输入框。Web App 在自己的文档中得到同样的行为：对它处理过的 Escape 调用 `preventDefault()`。

```js
macos.on('keydown', ({ key }) => {
  if (key === 'Escape' && sheetOpen) { sheetOpen = false; render(); return true; }
});
```

`select` 画成系统的弹出按钮，打开的是系统的菜单，而不是浏览器的列表。

键盘输入属于应用：窗口在最前时宿主会转发按键，并且在一次更新移除了拥有焦点的控件之后仍继续转发。`html` 节点是一个框架，在其中点击会把键盘带进那个框架，那里什么都到不了应用 — 所以焦点会立刻回到应用。对于文本需要用键盘操作的 `html` 节点，设置 `selectable: true`（这样在框架拥有焦点期间，应用收不到按键）。

### 过渡

Native App 中的动画属于宿主。节点指明它如何到来；宿主运行它，在节点离开时把同一个动画倒着运行，并在用户关闭了动画时（设置 → 辅助功能 → 减弱动态效果）两者都跳过 — 应用什么都不用检查。

```js
{ type: 'zstack', id: 'now-playing', transition: 'slide-up', children: [ … ] }
```

`transition` 是 `slide-up`、`slide-down`、`slide-left`、`slide-right`（节点到来时行进的方向）、`fade` 或 `scale` 之一。当节点被加入一个已经在屏幕上的界面时它会播放 — 通过 `render`、`setChildren`、`append` 或 `replace` — 窗口首次渲染时绝不播放。

离开时需要有个地方待着直到动画跑完，所以它适用于 `zstack` 的层：被移除的层留在最上面，倒着播放它的过渡，然后才被取走。同样地，一个层被替换、而另一个层在它上面到来时，它会留在下面直到新来者就位；正因如此，全窗口视图才是滑到前一个视图之上，而不是滑到空窗口之上。在其他任何容器中，被移除的节点直接消失。正在离开的层不再有 id，也不再接收输入；其中的 `video` 节点会一直显示画面，直到它消失。

带着 `html` 节点到来的层会在起始位置等待，直到那个框架的文档加载完成（最多几帧），所以它是带着内容进来的，而不是空白的。

`video` 节点（`fit`：`contain` / `cover`）显示应用媒体播放器的画面 — 也就是 `macos.audio.load()` 正在播放的内容（权限 `audio`）。播放器是一个宿主元素，会被移入节点、再移出去，所以添加或移除该节点绝不会打断播放。会报告 `click` 和 `activate`（双击）。
- 交互：`contextMenu`（右键时显示的菜单项）、`hover: true`（发出 `hoverstart` / `hoverend`）。

颜色是十六进制（`#ff9500`）、`rgb()` / `rgba()` / `hsl()`，或系统记号：`accent`、`red`、`orange`、`yellow`、`green`、`teal`、`purple`、`pink`、`gray`、`text`、`secondary`、`tertiary`、`control`、`fill`、`separator`、`clear`。记号跟随窗口的浅色/深色外观。

设置了 `padding` 的根节点拥有从边到边的整个内容区域；否则宿主会应用它标准的 14 px 内边距。根节点至少和窗口一样高；对于内部的 `list` / `table` / `scroll` 节点负责滚动的固定全窗口布局，给它 `"height": "fill"`。

### 图片来源

`image.src`、`button.icon`、列表和表格行的 `icon`，以及画布的 `drawImage` 都接受：

| 来源 | 示例 |
| --- | --- |
| 包内图片 | `assets/cover.png` |
| 已存储的文件（见 `macos.files`） | `blob:<文件 id>` — 用户选择或拖入的文件，或应用保存的数据 |
| 内联图片 | `data:image/png;base64,…`（最大约 3 MB） |
| 远程图片 | `https://…` — 需要 `network` 权限；私有网络主机会被拒绝 |

### 各类型专有的属性

- `stack`：`direction`（`vertical` / `horizontal`）、`gap`、`align`、`justify`（`start` / `center` / `end` / `between` / `around` / `evenly`）、`wrap`。水平 stack 会把子节点垂直居中，除非 `align` 另有指定。
- `grid`：`columns` — 一个数量（等宽的列）或一个轨道列表，如 `[200, "1fr", "auto"]`；`gap`、`rowHeight`（px 或 `"auto"`）、`align`、`justify`。
- `zstack`：子节点彼此叠放（覆盖层、图片上的角标）；`align` / `justify` 定位它们，`alignSelf` 按子节点覆盖。
- `scroll`：`direction`（`vertical` / `horizontal` / `both`）、`scrollEvents`。滚动视图内部的内容沿滚动轴保持其自然尺寸 — 放不下的内容会滚动，绝不会被挤压。在其他任何地方，`stack` 只给子节点现有的空间，所以长度取决于内容的页面（资料库、信息流）应当放在 `scroll` 里。
- `text`：`text` / `textKey`、`variant`（`title`、`headline`、`body`、`caption`、`muted`、`display`、`mono`）、`lines`（n 行之后截断）、`selectable`，或者用 `runs` 表示富文本：`[{ text, bold, italic, underline, strike, code, color, link }]`。点击带有 `link` 的 run 会发出携带 `href` 的 `link` 事件；不会自动打开任何东西。
- `button`：`label` / `labelKey`、`variant`（`primary`、`danger`、`plain`、`tinted`）、`shape`（`circle`、`pill`）、`icon`、`iconSize`、`iconTint`（用按钮的文字颜色绘制单色图形，使其跟随主题和 `color`）。
- `input`：`value`、`placeholder` / `placeholderKey`、`inputType`（`text`、`number`、`password`、`search`、`email`、`url`）、`maxLength`、`readOnly`、`selectionEvents`。
- `textarea`：`value`、`placeholder`、`rows`、`maxLength`、`readOnly`、`selectionEvents`。见下文 *文本选择*。
- `switch`、`checkbox`：`checked`、`label` / `labelKey`。
- `slider`：`min`、`max`、`step`、`value`。`progress`：`max`、`value`（省略 `value` 表示不确定进度）。
- `select`、`segmented`：`options`（字符串或 `{ value, label, labelKey }`）、`value`。
- `list`：`items`（`{ id, title, titleKey, subtitle, detail, badge, icon, disabled, emphasis, indent, disclosure, header, menu }`）、`iconSize`。`header: true` 生成不可选中的分区标题；`indent` 让一行缩进嵌套；`disclosure`（`open` / `closed`）画出文件夹的展开箭头（点击它会发出 `disclose`，而不是选中该行）；`menu` 给某一行它自己的右键菜单；`drag: false` / `drop: false` 把一行排除在拖动之外 / 排除在放置目标之外。带有 `children` 的行让列表成为大纲，`sections` 把它按标题分组 — 见 *大纲与分区*。
- `table`：`columns`（`{ id, title, titleKey, width, align, sortable, muted }`，`width` 是 px、`"Nfr"` 或 `"auto"`）、`rows`（`{ id, cells: { columnId: text }, icon, emphasis, disabled }`）、`sort`（`{ column, direction }`）、`header`、`striped`。
- `list` 和 `table` 共有：`value`（选中的 id）、`multiple` + `values`（用 ⌘ / ⇧ 点击进行多选）、`reorderable`（把行拖到新位置）、`draggable` + `dropTarget`（把行拖到另一个列表的行上 — 见 *在列表之间拖动*）、`itemMenu`（行的右键菜单）、`rowHeight`、`placeholder`（为空时显示）、`scrollEvents`、`plain`（没有边框或背景 — 侧边栏）、`insetBottom`（最后一行下方额外的可滚动空间，例如在浮动栏之下）。最多 20 000 行；只有可见的行存在于页面中，所以很长的集合依然很快。没有明确尺寸时，它们最多显示 12 行，超出部分滚动。
- `image`：`src`、`alt`、`fit`（`contain` / `cover`）。发出 `click`。
- `canvas`：`commands` — 一份显示列表，见下文；`pointer: true` 用来接收指针事件。
- `html`：`html`、`css` — 静态富内容，见下文。
- `separator`：`vertical`。

### 画布

`canvas` 节点绘制一个命令列表，每条命令是 `[name, ...args]`。它与分辨率无关：坐标是 CSS 像素，宿主处理设备像素比，并在调整大小和主题变化时重绘。

```js
await macos.ui.patch('chart', { commands: [
  ['fillStyle', 'accent'], ['fillRect', 10, 40, 24, 80],
  ['strokeStyle', 'secondary'], ['lineWidth', 1], ['beginPath'], ['moveTo', 0, 120], ['lineTo', 300, 120], ['stroke'],
  ['fillStyle', 'text'], ['font', 12, 'semibold'], ['textAlign', 'center'], ['fillText', 'Mon', 22, 136],
  ['drawImage', 'blob:' + fileId, 200, 10, 64, 64]
] });
```

状态：`fillStyle`、`strokeStyle`、`lineWidth`、`globalAlpha`、`font`（字号、字重、`system` / `mono` / `rounded`）、`textAlign`、`textBaseline`、`lineCap`、`lineJoin`、`setLineDash`、`shadow`（颜色、模糊、x、y）、`save`、`restore`、`translate`、`scale`、`rotate`、`clip`。
绘制：`fillRect`、`strokeRect`、`clearRect`、`beginPath`、`moveTo`、`lineTo`、`rect`、`roundRect`、`arc`、`ellipse`、`quadraticCurveTo`、`bezierCurveTo`、`closePath`、`fill`、`stroke`、`fillText`、`strokeText`、`drawImage`。

设置 `pointer: true` 后，节点会发出 `pointerdown`、`pointermove`（按键按住期间；每帧一次）和 `pointerup`，每个都带有相对于画布的 `x`、`y`。

### 静态 HTML

`html` 节点渲染包提供的或生成的标记 — Markdown 预览、文章正文、带格式的帮助 — 位于一个沙盒框架内，它无法运行脚本，也无法从网络加载任何东西。`<script>`、框架、表单和事件属性会被移除；图片必须是 `data:` URL；链接是惰性的（需要可点击的链接时，请使用带 `runs` 的 `text`）。这个框架自己滚动，所以要给节点一个 `height` 或 `grow`。

以原生为主的应用就是这样得到一块自由形式的区域，而不必把整个应用切换到 Web 运行时。

### 可复用样式

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

样式是一组带名字的属性；节点自己的属性优先。运行时可以用 `macos.ui.defineStyles({ … })` 添加更多样式。

### 事件

```js
macos.on('ui', ({ id, event, value, values, checked, itemId, menuId }) => {
  // click                     button、image、带 id 的 text
  // input, change             input、textarea、slider、select、switch、checkbox、segmented
  // submit                    在 input 中按下 Enter
  // focus, blur               input、textarea
  // select, activate          list / table：选择变化 / 行被双击或按下 Enter（itemId）
  // reorder                   list / table：拖动一行之后的 { itemId, index, order }
  // rowdrop                   带 dropTarget 的 list / table：{ itemId, position, index, parentId, sectionId, sourceId, items }
  // expand                    list（大纲）：一行被展开或收起（{ itemId, expanded, expandedIds }）
  // section                   list（分区）：一个可折叠的分区被折叠（{ sectionId, collapsed, collapsedIds }）
  // disclose                  list：带 `disclosure` 的行的箭头被点击（{ itemId }）
  // sort                      table：{ column, direction } — 按该顺序重新提供行
  // menu                      contextMenu / itemMenu 的选择：{ menuId, itemId? }
  // link                      带链接的 text run：{ href }
  // reachend, scroll          scroll / list / table：接近末尾；位置（配合 scrollEvents）
  // hoverstart, hoverend      任何带 hover: true 的节点
  // pointerdown / move / up   带 pointer: true 的 canvas
});
```

事件携带控件当前的 `value` / `values` / `checked`，所以很少需要另外调用 `macos.ui.get()`。

应用窗口拥有焦点期间，键盘输入会被转发：

```js
macos.on('keydown', ({ key, code, altKey, ctrlKey, metaKey, shiftKey, repeat, editing, targetId }) => {});
macos.on('keyup', (detail) => {});
```

当按键是输入到 `input` / `textarea` 中时，`editing` 为 `true`。在文本框之外，宿主已经阻止了页面对空格、方向键、Enter、Backspace 和 Tab 的默认动作，所以应用可以自由使用它们。和 AppKit 中一样，点击按钮不会把键盘焦点移到按钮上。

从用户桌面拖到窗口上的文件（权限 `files`）会先被存储，然后再通知：

```js
macos.on('drop', ({ files, rejected, targetId, itemId, x, y }) => {
  // files: [{ id, name, type, size, duration?, width?, height? }] — 已经在 macos.files 中
});
```

文件很多时，存储需要时间（每个文件都要探测、读取标签并写入）。宿主处理一次拖放或一次 `openFile({ store: true })` 选择期间会报告进度，第一次是 `done: 0`，最后一次是 `done === total`，这样应用可以显示进度条：

```js
macos.on('fileprogress', ({ source, done, total, name }) => {});   // source: 'drop' | 'picker' | 'export'（macos.archive.create，每打包一个条目算一步）
```

列表行可以带有 `tint: true`：这时该行的 `icon` 会被当作单色图形，以强调色绘制（在选中的行上为白色），而不是作为图片显示。

### 文本选择

`input` 或 `textarea` 的每个事件，以及 `macos.ui.get(id)`，都携带选区：`selectionStart`、`selectionEnd`、`selectionDirection` 和 `selectionText`。设置 `selectionEvents: true` 后，每当光标或选区移动，控件还会发送 `selection` 事件。

```js
const { selectionText } = await macos.ui.get('body');
await macos.ui.replaceSelection('body', `**${selectionText}**`, { select: 'all' });   // 'end'（默认）| 'start' | 'all'
await macos.ui.setSelection('body', { start: 120, end: 131 });                           // 会滚动到可见处；reveal: false 则不动视图
```

`replaceSelection` 通过浏览器自己的编辑机制输入文本，所以 ⌘Z 可以像撤销用户输入的任何内容一样撤销它。文本控件中的撤销和重做（⌘Z、⇧⌘Z）、剪切、拷贝、粘贴和全选都是浏览器的，宿主绝不拦截。在长文本中搜索就是 `value.indexOf()` 加 `setSelection()`。

**粘贴。** 监听 `paste` 的应用程序会被告知 ⌘V 带来了什么：

```js
macos.on('paste', ({ id, types, files, text }) => {
  // files：粘贴的文件（拷贝的图片、截屏）— 已经在 macos.files 中，绝不会被输入到输入框里
  // text： 只有在没有文本控件拥有焦点时才有；有焦点的控件会自己接收文本
});
```

存储粘贴的文件需要 `files` 权限。没有 `paste` 监听器时，宿主对粘贴不做任何事。

### 在列表之间拖动

给源列表 `draggable: true`，给目标列表 `dropTarget: true`。把一行或多行选中的行拖到目标列表的某一行上会高亮那一行，松开时 **在目标列表上** 发出 `rowdrop`，带有目标行的 `itemId`、作为 `sourceId` 的源列表 id，以及作为 `items` 的被拖动行的 id。没有任何东西会自己移动 — 更新你的状态并渲染。

```js
macos.on('ui', ({ id, event, itemId, sourceId, items }) => {
  if (id === 'sidebar' && event === 'rowdrop' && sourceId === 'songs') addToPlaylist(itemId, items);
});
```

一个列表可以两者兼是（把行拖到同一列表的其他行上，例如把播放列表拖到文件夹上）。在 `reorderable` 列表内部，列表内的拖动是重新排序；拖出列表到一个 `dropTarget` 上则是放置。

**放在行与行之间。** 默认情况下，放置是落 *在* 某一行 *上*。`dropPosition: 'between'` 让目标列表改为在行间的空隙接收放置，以一条插入线显示；`'both'` 两者皆可（一行的中间一半是“上”，其顶部和底部各四分之一是空隙）。这时 `rowdrop` 还会说明位置：

| 字段 | 含义 |
| --- | --- |
| `position` | 相对于行 `itemId` 的 `'on'`、`'before'` 或 `'after'` |
| `index` | 这些行将位于目标列表可见行中的哪个位置（0 = 第一个） |
| `parentId` | 在大纲中：它们将成为其子项的那一行（顶层为 `''`） |
| `sectionId` | 在分区列表中：它们落入的分区 |

在一个展开的大纲行之下，空隙被报告为其第一个子项的 `'before'`，所以 `parentId` 就是那一行。空列表报告 `itemId: ''`、`index: 0`。分区标题以 `position: 'on'`、`itemId: ''` 及其 `sectionId` 接收放置。

从外部拖入的文件在 `dropTarget` 列表上遵循同样的规则：它们悬停时显示插入线，`drop` 事件在 `targetId` / `itemId` 之外还携带同样的 `position`、`index`、`parentId` 和 `sectionId`。

### 大纲与分区

**大纲（树）。** 给行加上 `children`，列表就把它们画成一棵树：缩进、展开箭头，以及键盘上的 ← / →（→ 展开一行或进入其中，← 收起它或退到它的父行）。最多 8 层；嵌套的行计入 20 000 行的上限。

```js
{ type: 'list', id: 'tree', expanded: ['src'], items: [
  { id: 'src', title: 'src', icon: folder, children: [
    { id: 'src/main.js', title: 'main.js' },
    { id: 'src/lib', title: 'lib', expandable: true }      // 展开时才提供子项
  ] },
  { id: 'README.md', title: 'README.md' }
] }

macos.on('ui', ({ id, event, itemId, expanded, expandedIds }) => {
  if (id === 'tree' && event === 'expand' && expanded && !loaded.has(itemId)) loadChildren(itemId);   // 然后渲染
});
```

宿主自己展开和收起行，并在多次渲染之间记住哪些是展开的；`expand` 只是告诉你这件事（如果要在重启后保留，就保存 `expandedIds`）。传入 `expanded` 可以自己设置。`expandable: true` 在你尚未加载其子项的行上显示展开箭头。收起一个包含当前选中项的行，会把选中移到那一行。只使用 `indent` / `disclosure` 的行照旧工作，并发出 `disclose`。

**分区。** `sections` 用带标题的分组代替 `items`。正在阅读的那个分组的标题会固定在列表顶部，它的行在标题下滚动（`stickyHeaders: false` 关闭这一行为）。带有 `collapsible: true` 的分区在其标题被点击时折叠。

```js
{ type: 'list', id: 'songs', sections: [
  { id: 'a', title: 'A', detail: '12', collapsible: true, items: [...] },
  { id: 'b', title: 'B', detail: '7', collapsible: true, items: [...] }
] }
// 'section' { sectionId, collapsed, collapsedIds } — 节点上的 `collapsed` 由你这一侧设置它
```

分区 id 与列表的行 id 共用同一个 id 空间（请让它们与行 id 不同）。分区可以包含大纲行。

大纲和分区列表会忽略 `reorderable`，因为在那里一个扁平的位置能说明的太少。用 `draggable` + `dropTarget` + `dropPosition: 'between'`（或 `'both'`）移动行，并使用 `rowdrop` 中的 `parentId` / `sectionId` / `index`。

### 更新界面

最简单的模型是声明式的：把状态保存在 JavaScript 中，把整个界面描述为状态的函数。

```js
const view = () => ({ type: 'stack', id: 'root', children: items.map((item) => ({ type: 'text', id: `row:${item.id}`, text: item.title })) });
await macos.ui.render(view());   // 状态每次变化时再调用一次
```

`render()` 把新的树与屏幕上的内容做差异比较，只改动不同之处。子节点按 `id` 匹配（没有 id 时按位置和类型），所以文本框保有焦点和光标，滚动位置和媒体得以保留，未变化的节点不会被重建。用户正在输入的输入框会保留它自己的文本，即使你的状态落后了一次按键。

需要时也可以做定向更新：

```js
macos.ui.patch('value', { text: '42', color: 'accent' });        // 任何属性；null 移除它
await macos.ui.append('rows', { type: 'text', text: 'New row' });  // 可选的第三个参数：index
await macos.ui.setChildren('rows', [/* 节点 */]);                  // 像 render() 一样做差异比较
await macos.ui.replace('row-3', { type: 'card', id: 'row-3', children: [] });
await macos.ui.remove('row-3');
await macos.ui.focus('field');
await macos.ui.scrollTo('songs', { itemId: 'song-42' });           // 或 { top: 0 }
const state = await macos.ui.get('field');                         // { value, checked, disabled } / { value, values } / { text }
const choice = await macos.ui.showMenu([{ id: 'a', label: 'First' }, { separator: true }, { id: 'b', label: 'Second', danger: true }]);
```

带有 `submenu` 的菜单条目 — 一个同样结构的列表，最多两层 — 会在旁边打开进一步的菜单，而它本身不是一个选项：`{ label: 'Size', submenu: [{ id: 'size:small', label: 'Small', checked: true }, …] }`。状态项目的菜单同样如此。

在同一个 tick 中发出的 `patch()` 调用会作为一条消息发给宿主，所以一次更新许多控件只花费一次往返。

在严格模式下一棵树限制为 2 000 个节点（否则为 8 000 个）。很长的集合应当放在 `list` / `table` 的行里，它们不计入节点数。

## 6. Web App 原生界面样式表

Web App 会自动加载：

```text
plugin/sdk/native-ui.css
```

它提供基于系统记号的基础组件，包括：

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

有用的变量包括：

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

这些是 **内部的半透明材质**，而不是独立的全窗口背景采样器。
