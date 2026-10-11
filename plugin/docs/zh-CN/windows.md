[English](../windows.md) · **简体中文** · [日本語](../ja/windows.md)

# 窗口、图标、强调色与材质

应用程序 SDK 文档的一部分 — 请从 [README](../../README.zh-CN.md) 开始阅读。

## 4. 窗口约定

`window` 支持：

- `width`、`height` — 窗口外框的初始尺寸，单位为 **CSS 像素**，包含宿主的标题栏。
- `minWidth`、`minHeight` — 调整大小的下限。
- `resizable` — `false` 固定窗口尺寸（等同于 `resize: "none"`）。
- `resize` — 用户可以拖动哪些边：`"both"`（默认）、`"horizontal"`、`"vertical"` 或 `"none"`。
- `maxWidth`、`maxHeight` — 手动调整大小和缩放的上限；省略表示“屏幕允许多大就多大”。
- `appearance` — `"system"`、`"light"` 或 `"dark"`：窗口启动时的外观。应用程序可以在运行时用 `macos.window.setAppearance()`（见下文）更改它，应用正是这样在自己的设置里向用户提供浅色 / 深色 / 自动的选择。
- `material` — `"glass"`、`"solid"` 或 `"transparent"`。
- `titlebar` — `"standard"`（带红绿灯按钮、图标和标题的标题条）、`"none"`（见下文 *无边框、浮动与附属窗口*）或 `"hidden"`（没有标题条：红绿灯按钮浮在左上角，内容占满整个高度，像“系统设置”和“访达”那样）。使用 `"hidden"` 时，窗口可以通过内容中任何空白的表面拖动 — 容器、间隔、纯文本、没有 `id` 的图片、`video` 节点 — 但绝不会通过控件拖动。一次拖动不会同时算作对其起始表面的点击。
- `titlebarHeight` — 32–72 CSS 像素（仅标准标题栏）。
- `borderRadius` — 8–28 CSS 像素。默认值 12 是系统窗口的圆角半径。
- `showTitle` — 标准标题栏是否显示应用图标/标题。

- `level` — `"normal"`（默认）、`"floating"`（窗口停留在所有普通窗口之上，不论哪个普通窗口在最前）或 `"desktop"`（停留在所有普通窗口之后，位于壁纸、桌面图标和桌面小组件之上 — 天气、画在桌面上的时钟）。这两个层级上的窗口在启动台打开时会让开，也不参与调度中心。`macos.window.setLevel(level)` 可以在运行时更改层级：一个桌面层级的窗口打开自己的面板时，在面板打开期间升到 `"floating"`。
- `showInDock` — `false` 让应用程序成为 *附属应用*：运行时没有程序坞图标，点击它的窗口也不会把菜单栏交给它。它需要一个菜单栏项目（`macos.statusItem`，权限 `statusItem`）才能被找到；只要它还没有菜单栏项目 — 权限被关闭，或者项目尚未设置 — 程序坞就照常显示它，所以总能找到并退出它。

### 无边框、浮动与附属窗口

`titlebar: "none"` 完全去掉标题栏和窗口按钮。宿主什么都不画：配合 `material: "transparent"`，窗口就只是应用程序自己绘制的内容，没有边框和阴影。这样的窗口

- 最小可以到 40 × 40，用户不能调整其大小（`window.resize()` 仍然有效）；
- 始终完整地留在桌面上、菜单栏下方：无论被移到哪里，以及浏览器窗口变小时 — 这时它会被移回来，并收到带 `moved: true` 的 `screenchange`；
- 由应用程序自己移动：在 `pointerdown` 中调用 `macos.window.beginDrag(event)`，用户就可以抓着被按下的东西带着它走；`macos.window.moveTo(x, y, { duration })` 移动它（或让它滑行过去）— 见 §7 的 `macos.window`；
- 无法从“窗口”菜单最小化或缩放；`macos.window.minimize()` / `focus()` 隐藏和显示它，`close()` 退出。

桌面宠物把这三项结合在一起：

```json
"window": { "width": 106, "height": 114, "titlebar": "none", "material": "transparent", "level": "floating", "showInDock": false }
```

**形状。** 窗口是一个矩形，不做处理的话整个矩形都会接收指针 — 包括透明的部分。无边框窗口可以用 `macos.window.setShape(rects)` 说明它实际覆盖的范围：一个窗口坐标系下的 `[x, y, width, height]` 矩形列表（最多 400 个）。窗口会被裁剪为这些矩形的并集，点击其他任何地方都会落到下面的东西上 — 桌面、桌面图标、另一个窗口。每当画面变化就再调用一次（宠物：每当姿势变化；宿主会忽略与当前相同的形状）；`setShape(null)` 让整个窗口重新计入。在应用程序没有设置形状期间，整个窗口都计入。

```js
// 姿势的一格，按 8 px 的方块从 alpha 测量一次，再外扩一个方块，方便抓取
await macos.window.setShape([[12, 0, 30, 8], [6, 8, 44, 60], [14, 68, 28, 40]]);
```

完整的例子见 §12 的 *星野*：它从图片的 alpha 通道测量精灵图中的每一个姿势。

**在哪里接收指针。** 形状会裁剪窗口 — 形状之外的部分也不会被绘制。`macos.window.setHitRegion(rects)`（Web App）不动画面，只说明窗口在哪里接收指针：列出的 `[x, y, width, height]` 矩形（最多 64 个）。其他任何地方，尽管窗口在那里有绘制，点击仍会落到下面的东西上。`[]` 让整个窗口可被点击穿透；`null` 让它重新在所有位置接收指针。

```js
// 雨覆盖整个桌面，只有一个面板可以点击
const r = panel.getBoundingClientRect();
await macos.window.setHitRegion(panel.hidden ? [] : [[r.left, r.top, r.width, r.height]]);
```

当窗口恰好就是它画的东西时使用 `setShape`（宠物：裁剪还能让它的图层保持很小）；当它画的范围比希望被点击的范围大时使用 `setHitRegion`（天气、卡片周围的柔和阴影、对话气泡）。在点击穿透的部分上，`trackPointer` 的指针位置仍会持续送达。

红、黄、绿按钮归宿主所有：关闭、最小化到程序坞图标（缩放效果）和缩放。缩放会把窗口放到其调整大小规则所允许的最大尺寸 — 可自由调整大小的窗口是菜单栏和程序坞之间的整个区域，`"vertical"` 的窗口只占满高度，且绝不超过 `maxWidth` / `maxHeight` — 并把没有填满该区域的方向居中。完全不能调整大小的窗口，绿色按钮是禁用的。拖动已缩放的窗口，会在指针下把它拉回原先的尺寸。最小化或隐藏的应用继续运行。宿主还会给每个应用的菜单栏加上 **窗口** 菜单（最小化、缩放）。

`moveTo(x, y, { duration, easing })` 接受 `easing: 'linear'`（默认）、`'ease'`、`'in'`（逐渐加速，像东西下落）或 `'out'`（逐渐减速，像东西被向上抛）。窗口也可以跟随另一个窗口移动 — `macos.window.attach`，见 §7 的 `macos.desktop`。

### 应用程序图标

请按 macOS 图标网格绘制图标：正方形画布，图形（圆角正方形）约占其 80%，居中 — 1024 px 中的 824。启动台、程序坞和访达会把应用程序图标与内置图标并排以全尺寸显示，所以铺满画布的图标看起来过大，留白过多的图标看起来偏小。

### 强调色

系统强调色要么是一种固定颜色，要么是 **多色**。在“多色”下，每个应用程序使用自己的强调色：清单的 `accentColor`（`blue`、`purple`、`pink`、`red`、`orange`、`yellow`、`green`、`graphite` 或 `#rrggbb`；默认蓝色），应用可以在运行时用 `macos.window.setAccentColor()` 更改它。在固定的系统颜色下，每个应用程序都使用那个颜色，应用自己的选择会被保留但不显示。

强调色决定选中状态、主要按钮和着色按钮、焦点环、进度条、链接、着色的列表图标以及 `accent` 颜色记号。作为颜色记号的 `blue` 始终是蓝色。宿主不提供按应用设置强调色的界面：想让用户选择强调色的应用，要把它做进自己的设置里（见 §8 的 *设置…*），并自己保存这个选择。

```js
macos.context.accentColor    // '#ff5257' — 当前生效的颜色
macos.context.accentSetting  // 'multicolor' 或固定系统颜色的名称
await macos.window.setAccentColor('purple');   // 或 '#8844ee'；null 回到清单里的强调色
macos.on('accentchange', ({ accentColor, accentSetting }) => {});
```

`appearance: "system"` 跟随桌面。类似计算器的应用程序可以请求永久使用 `"dark"`。

### 材质归属

**开销较大的壁纸背景模糊归应用程序的外层窗口所有**。应用内容的根节点通常应当是透明的。不要在应用内部再画一层覆盖整个窗口的模糊。

在窗口内部，原生应用通过 `material` 为每个容器选择表面，就像 SwiftUI 应用那样：

| `material` | 表面 |
| --- | --- |
| `sidebar` / `clear` | 自己什么都没有 — 透出窗口材质（磨砂的壁纸） |
| `content` | 不透明的窗口背景，如“系统设置”的右侧 |
| `glass` | 浮在应用自身内容之上的磨砂面板（播放条、表单） |
| `bar` | 位于自身窗口内容之上的磨砂栏：页面在其下方滚动的页面标题或工具栏。它在窗口的不透明底色上模糊这些内容，绝不会模糊桌面 |

`bar` 是浮动的，所以它是 `zstack` 中位于页面之上的一层，页面要为它留出空间：

```js
{ type: 'zstack', children: [
  { type: 'list', id: 'songs', insetTop: 62, items },                       // 行从栏的下方开始，并在栏下滚动
  { type: 'stack', material: 'bar', height: 62, alignSelf: 'start', justifySelf: 'stretch', children: [title, search] }
] }
```

`list` / `table` 接受 `insetTop`（以及用于底部浮动栏的 `insetBottom`）：它的行从栏的下方开始。`scroll` 接受同样的两个属性，让滚动条避开这些栏；内容本身需要你自己加上相应的内边距。“系统设置”“访达”“音乐”和“图书”的标题区就是这样画的。

`split` 容器会自动采用惯常的布局：第一个子节点是侧边栏（窗口材质，右侧有细线），其后的每个子节点都是不透明内容，第三个子节点左侧有一条细线（检查器）。在某一栏上设置 `material` 可以覆盖它：内容栏设为 `material: "clear"` 得到全玻璃的窗口，侧边栏设为 `material: "content"` 得到完全没有玻璃的窗口（或者使用 `window.material: "solid"`）。

侧边栏的内容比窗口高时，它会自己滚动。能够退让的部分 — `list`，它在内部滚动 — 先收缩；只有当固定高度的内容放不下时，这一栏的滚动条才会出现。这些都不需要声明。

在模糊被关闭的地方（降低透明度，或用透明代替磨砂玻璃），`glass` 面板会变成不透明的凸起表面，因为没有模糊的玻璃盖在滚动内容上是无法阅读的。应用对此无需做任何事。

启用 开发者模式 → **使用透明代替磨砂玻璃** 时，宿主保持相同的语义材质，但关闭背景采样。因此应用不需要实现自己的特殊性能模式，视觉上仍保持一致。

“降低透明度”/“增强对比度”生效时，宿主同样集中地更改材质。
