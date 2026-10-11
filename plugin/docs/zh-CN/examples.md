[English](../examples.md) · **简体中文** · [日本語](../ja/examples.md)

# 参考应用程序

应用程序 SDK 文档的一部分 — 请从 [README](../../README.zh-CN.md) 开始阅读。

## 12. 参考应用程序

### 计算器

同时以可读的目录和单文件导入包两种形式提供：

```text
plugin/examples/glass-calculator/
  src/ui.json
  src/main.js
  locales/*.json
  assets/icon.png
  assets/delete.svg

plugin/examples/glass-calculator.macos-app.json
```

计算器是一个 `runtime: "native"` 应用。它默认是深色的（`window.appearance`），其“显示”菜单让用户选择浅色、深色或系统外观（`macos.window.setAppearance`）；键盘区在 `themechange` 时重新绘制。它的键盘区是一个 4 列的 `grid`，由带有各自颜色的 `shape: "circle"` 按钮组成，显示区是两个 `text` 节点，键盘输入通过 `macos.on('keydown')` 处理。它请求一个永久深色的窗口，并声明了一个“编辑”菜单，其中的 `⌘C` 快捷键可以使用。

### 音乐

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

一个完整的 `runtime: "native"` 应用程序：导入你自己的歌曲（文件选择器或拖到窗口上），根据内嵌的标签和封面按艺人和专辑浏览，整理播放列表和播放列表文件夹，给每个播放列表设置标题和封面图片，搜索和排序，随机播放和循环播放，管理播放队列，以及导出 — 单首歌曲导出为原始文件，或把一个播放列表导出为可以再次导入的一个 `.zip`。它展示了较大型应用应有的形态：

- 整个界面是一个 `view()` 函数，用 `macos.ui.render()` 渲染；
- 音频文件从不进入沙盒：它们存放在 `macos.files` 中，由 `macos.audio` 播放；
- 封面是 `blob:<id>` 图片源；侧边栏是一个 `plain` 列表，带有分区标题、文件夹展开行和按行的菜单；歌曲列表是一个虚拟化、可重新排序、可多选并带有 `itemMenu` 的 `list`；
- 窗口使用 `titlebar: "hidden"` 和 `split` 根节点：侧边栏使用窗口材质，内容不透明，队列栏可选；
- 播放器是浮在 `zstack` 中的 `material: "glass"` 栏；简介表单和设置表单只是 `view()` 的另外几个分支；
- `"settings": true`，其设置表单让用户选择应用的强调色（`macos.window.setAccentColor`）；
- 存储大批量导入时，由 `fileprogress` 驱动的进度条；
- 导出和导入单个播放列表（`macos.archive`）或单首歌曲；一次导出全部内容则交给 系统设置 ▸ 储存空间 ▸ 导出数据…；
- 可选的淡入淡出（设置）：暂停和继续时淡出淡入，歌曲之间交叉淡化（`macos.audio` 的 `fade` / `crossfade`）；
- 页面标题是盖在列表之上的 `material: "bar"` 层（`insetTop`），所以行在磨砂标题之下滚动；
- 启动时，它会请求用户已关闭的必需权限（`macos.permissions.request`）；
- 自己的浅色 / 深色 / 自动设置（`macos.window.setAppearance`）；
- 三种尺寸的 **最近播放** 小组件（`macos.widgets`）：每当播放过的内容变化，“音乐”就重新发布它，其中的“播放”按钮会打开“音乐”并开始播放那首歌；
- 歌曲和播放列表通过 `macos.search` 列给聚焦搜索；选中其中一项会播放它或打开那个播放列表；
- 菜单栏项目（`macos.statusItem`）显示正在播放的内容，并在窗口不可见时提供播放 / 暂停、下一首和上一首。

### 图书

```text
plugin/examples/books/
plugin/examples/books.macos-app.json
```

电子书阅读器（`runtime: "native"`，内置）：EPUB 图书和 CBZ 漫画，带精选集的书架，带主题、字体、目录和书签的分页阅读器，以及每日阅读目标。图书按书名和作者列给聚焦搜索。它提供 **继续阅读** 小组件（小号和中号），显示正在读的书、读到哪里和今天的阅读时间；其中的“继续”按钮会打开那本书。

### Native Counter

```text
plugin/examples/native-counter.macos-app.json
```

这是最小的 `runtime: "native"` 示例。它的可见控件由宿主渲染，沙盒中只包含应用程序逻辑。

### 星野（桌面宠物）

```text
plugin/examples/hoshino-pet/
  app.json
  src/index.html, src/style.css
  src/sprite.js        精灵图：动画片段和十六个注视方向
  src/behaviour.js     休息、注视、站在窗口上、下落、闲逛、被拎起
  src/main.js          设置、菜单、启动
  locales/*.json
  assets/sprites.webp  8 × 11 格，每格 192 × 208
  assets/icon.png, assets/status.svg

plugin/examples/hoshino-pet.macos-app.json
```

一个 `runtime: "web"` 应用程序，位于无边框、透明、浮动且没有程序坞图标的窗口中（`titlebar: "none"`、`material: "transparent"`、`level: "floating"`、`showInDock: false`）：

- 她通过移动 `background-position` 从一张精灵图中画出来 — 待机、挥手、跳跃、向左 / 向右跑等等，外加朝各个方向看的十六个姿势；
- 只有她本身接收点击：每个姿势都从精灵图的 alpha 通道测量一次，并用 `macos.window.setShape` 把窗口裁剪成那个形状，所以她旁边的桌面仍然可以点击；
- 按住她会启动 `macos.window.beginDrag(event)`：被横向带着走时她在空中奔跑，被举着不动时她等待，被放下时她落地（或者在桌面边缘绊一下）；
- 她会站在东西上（`macos.desktop`，权限 `windows`）：屏幕底部、程序坞顶部、每个窗口（包括聚焦搜索）以及桌面上每个小组件的上沿和下沿。脚下什么都没有时，她会落到正下方的下一条边上（`moveTo` 配 `easing: 'in'`）；站在窗口上时，她会附着在窗口上（`macos.window.attach`），所以窗口被拖动时她跟着走，窗口关闭时她掉下去。这两个习惯在她的菜单里都是开关；
- 她时不时用 `macos.window.moveTo(x, y, { duration })` 走上一小段 — 沿着她所站的东西，不超出其两端 — 跳到够得着的另一条边上（从地面跳上程序坞：上升用 `easing: 'out'`，下落用 `'in'`），或者做一个她的小动作：琢磨、凑近细看、伸出一只手、闹别扭（这些也都在她的菜单里）；
- 只有指针靠近时她才看向它（`macos.window.trackPointer`，权限 `pointer`）；指针在桌面别处时，她继续呼吸和眨眼；
- 她的菜单栏项目（`macos.statusItem`）和右键菜单（`macos.ui.showMenu`，Web App 也可使用）在子菜单中提供：各个小动作和按要求走一走、点击她时做什么（某一个小动作，或随机一个）、她的习惯和三种大小 — 然后是把她叫回来、在用户允许多个窗口时再来一只（`macos.instances.open`）、隐藏和退出；她的位置和设置保存在 `macos.storage` 中。

和每个应用程序一样，她只在新标签页打开期间运行。想让她出现在每个新标签页上，请在 设置 → 应用程序 中为她打开 **打开新标签页时启动**（只有用户能做到）。

### 窗外（桌面上的天气）

```text
plugin/examples/outside/
  app.json
  src/index.html, src/style.css
  src/weather.js       Open-Meteo，以及它的代码如何变成场景
  src/sky.js           画布：粒子、东西落上去的表面、积雪
  src/main.js          窗口、面板、菜单、小组件、协作应用
  locales/*.json
  assets/icon.png, assets/status.svg

plugin/examples/outside.macos-app.json
```

一个 `runtime: "web"` 应用程序，它的窗口就是整个桌面：无边框、透明、`level: "desktop"`（在所有窗口之后）、没有程序坞图标，而且在任何地方都不接收指针（`macos.window.setHitRegion([])`）— 除了设置面板打开时的面板本身，为此它会来到最前（`setLevel('floating')`）。

- 只有一个画布，画在上面的东西在天气允许的范围内尽可能少：雨和闪电每秒 30 帧，雪、花瓣和落叶 24 帧，云、雾和星星 12 帧，拖动窗口期间再减半。从不移动的东西 — 阴天的灰色、晴天的光、贴着地面的薄雾 — 是画布后面的 CSS 背景，只画一次；每朵云各自画一次，画进它自己的一小幅图里；
- 它会监视自己每帧的开销以及浏览器掉帧的频率，并自行降级 — 先减少像素（每点 1.5 → 1.25 → 1 个设备像素），再减少粒子和帧数 — 有余量时再小心地升回去。面板中的 *低功耗* 让它保持在最低一级；
- 因为这一切对慢的机器来说仍然要求不低，所以它在启动时会说明这一点（`macos.dialog.confirm`），直到用户选择 *不再提示*；
- 落下的东西落在它从 `macos.desktop.watch()`（权限 `windows`）得到的 **表面** 上：屏幕底部、程序坞顶部和每个窗口的上沿，每个表面都带有系统报告的圆角半径，所以雪堆沿着圆角走，而不是以直角收尾。雨在那里溅开；雪会堆积 — 很慢，以分钟计；
- 每个表面都有自己的积雪。窗口一动，上面的一切 — 雪、花瓣、落叶 — 就立刻崩落下去，重新落在下面的东西上；没有任何东西被拖在窗口后面。程序坞在指针下变大变小时，程序坞上的雪留在原地，失去立足点的部分以同样的方式落下；程序坞下方的地面上不积任何东西。花瓣和落叶只停留几秒钟；
- 天气变化时，新场景里没有的东西在三分之一秒内消失 — 空中的粒子、雪堆、地上的花瓣；
- 因为它在窗口之后，它画的东西不需要自己做遮挡 — 只有 *落下* 的东西需要：雪花不会落在被另一个窗口盖住的边上；
- 通过 `macos.fetch`（权限 `network`）获取实时天气，指针当作雨伞（`pointer`），带场景列表的状态项目，一个小组件。

### 纸飞机（写给未来的自己的信）

```text
plugin/examples/paper-plane/
  app.json
  src/index.html, src/style.css
  src/flight.js        作为飞机的窗口：布局、飞行、降落
  src/main.js          信件、写信、读信、信箱、通知
  locales/*.json

plugin/examples/paper-plane.macos-app.json
```

一个无边框、浮动的附属应用，随显示的内容改变大小 — 一张纸、带对话气泡的飞机、用 `moveTo` 一帧一帧移动的飞行中的飞机。

- 在空中的信同时也是一条 **定时通知**（`macos.notifications.schedule`，id = 信的 id）：到期时由系统显示它，即使没有打开任何新标签页；打开通知会启动应用程序，然后飞机飞进来降落。阅读、删除或重新寄出一封信，会取消或替换它的通知；
- 用手扔出去：`beginDrag` resolve 时带有松手那一刻指针的速度（`frame.velocity`），这就是飞机最初的那一推；
- 应用运行期间，一个定时器在到期的那一分钟让飞机降落；既然就在用户眼前，这已经说明了一切，通知会被取消；
- 系统语言变化时（`languagechange`），屏幕上的一切都会重新书写，等待中的通知会用新语言重新安排；
- `macos.context.launchReason` 用来区分用户启动（飞机主动出现）和用户的 *打开新标签页时启动* 设置（它在菜单栏中等候）。

### 协作的应用程序：星野与窗外

两者在各自的清单中写上对方的名字（`"peers": ["outside-weather"]` / `"peers": ["hoshino-pet"]`），并通过 `macos.apps` 交谈：

| 发送方 | 消息 | 对方做什么 |
| --- | --- | --- |
| 星野 | 启动时的 `{ type: 'hello', head: { x, y, w } }` | 窗外回答当前天气，并知道她的头在她窗口中的位置：雨打在上面溅开，雪落在上面积起来 |
| 星野 | 走路时的 `{ type: 'step', x, y, vx }` | 她脚边的雪被踢到一旁 |
| 星野 | 下落或跳跃之后的 `{ type: 'land', x, y }` | 她落地处的雪被震散，落在那里的花瓣飞起来 |
| 星野 | `{ type: 'shake' }` | 她头上的雪飞出去 |
| 窗外 | `{ type: 'hit', kind }` — 雨、雪、花瓣或落叶落在了她身上；头上的雪很厚时为 `snowcap` | 她抬头看、伸出一只手、凑近看看是什么 — 或者跳起来把雪抖掉 |
| 窗外 | 天气变化时的 `{ type: 'weather', scene, night }` | 她向雨、雪和花瓣伸出一只手，打雷时垂头丧气，放晴时蹦一下 |

两者互不依赖：没有窗外，她就是干燥桌面上的一只宠物；没有她，雪就原封不动地躺着。两者从 `macos.desktop` 读取同一份布局，所以她站的那个窗口，就是积着雪的那个窗口。
