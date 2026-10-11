[English](../api.md) · **简体中文** · [日本語](../ja/api.md)

# 运行时 API

应用程序 SDK 文档的一部分 — 请从 [README](../../README.zh-CN.md) 开始阅读。

## 7. 运行时 API

### 权限

在清单的 `permissions` 列表中声明，并在 设置 → 应用程序 中向用户显示。

| 权限 | 解锁的功能 |
| --- | --- |
| `storage` | `macos.storage` |
| `files` | `macos.files`、`macos.archive`、`macos.dialog.openFile` / `saveFile`、`drop` 事件 |
| `audio` | `macos.audio` |
| `network` | `macos.fetch`、远程 `https://` 图片来源 |
| `notifications` | `macos.notifications` |
| `clipboard` / `clipboardRead` | `macos.clipboard.writeText` / `readText` |
| `openExternal` | `macos.openExternal` |
| `menu` | `macos.menu`（宿主命令） |
| `statusItem` | `macos.statusItem`（菜单栏中的一个项目） |
| `widgets` | 清单的 `widgets` 和 `macos.widgets`（用于桌面和小组件中心的小组件） |
| `pointer` | `macos.window.trackPointer`（指针在桌面上的位置） |
| `windows` | `macos.desktop` 和 `macos.window.attach`（程序坞和其他窗口在哪里 — 绝不包括它们里面有什么） |

`macos.ui`、`macos.window`、`macos.dialog.alert` / `confirm` / `prompt`、`macos.system`、`macos.i18n`、`macos.search` 和 `macos.log` 不需要权限。

用户可以为某一个应用程序关闭一项已声明的权限（设置 → 应用程序）。这时它所解锁的调用会以 `Permission denied: <name>` 拒绝，和没有声明过完全一样 — 把权限当作可选项的应用，少了这项功能仍然能工作。

宿主会记录应用程序实际使用了哪些权限 — 用了多少次、最近一次是什么时候，以及被拒绝了多少次。用户可以在 设置 → 应用程序（**权限使用记录**）和开发者工具中看到；声明了却从未使用的权限会如实标出。

入口脚本会得到：

```js
macos
root
```

支持顶层 `await`。

`root` 是 Web App 的 DOM 根节点。Native App 通常应当使用 `macos.ui`，而不是操作 `root`，因为 Native App 的可见界面属于宿主文档。

### `macos.system`

```js
const info = await macos.system.getInfo();
```

当前的信息包括：

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
  direction: 'ltr',            // 布局被镜像时为 'rtl'
  accentColor: '#0a84ff',      // 对这个应用生效的强调色
  accentSetting: 'multicolor'  // 系统设置：'multicolor' 或某个固定颜色的名称
}
```

启动上下文（`macos.context`）还携带这个运行时是哪一个实例：

```js
{
  instance: 1,          // 应用的普通窗口为 1，后续实例为 2…
  sharedStorage: true   // false：这个实例有自己的存储池
}
```

相关事件：

```js
macos.on('themechange', ({ theme, systemTheme }) => {});   // theme：这个窗口现在显示的外观
macos.on('languagechange', ({ language, direction }) => {});
macos.on('visibilitychange', ({ visible }) => {});
macos.on('hostdragchange', ({ active, kind }) => {});
macos.on('resize', ({ width, height }) => {});   // 窗口外框的尺寸，单位 CSS px（布局后的尺寸，不受最小化动画影响）
macos.on('focus', () => {});                     // 窗口成为活跃窗口
macos.on('blur', () => {});
macos.on('close', () => {});                     // 运行时被销毁前的最后一个事件
```

进行 Canvas/WebGL/自定义动画的应用，应当在 `visible === false` 或 `hostdragchange.active === true` 时暂停开销大的工作。

`macos.system.getStats()` 告诉应用程序它相对于宿主的各项预算处于什么位置，这样它可以在调用被拒绝之前收敛一些：

```js
const stats = await macos.system.getStats();
// { apiCallsThisSecond, apiCallsLimit, apiCallsAdvised,     严格安全性下每秒 240 次调用；请保持在建议值 90 以下
//   nodeCount, nodeLimit,                                    屏幕上的原生界面节点数
//   storageBytes, storageQuota, fileCount, fileBytes, fileQuota, securityLevel }   上限为 null 表示没有上限
```

### `macos.i18n`

声明包的语言文件：

```json
"locales": {
  "en-US": "locales/en-US.json",
  "zh-CN": "locales/zh-CN.json",
  "ja-JP": "locales/ja-JP.json"
}
```

然后：

```js
macos.i18n.t('key', 'Fallback');
macos.i18n.language();
macos.i18n.direction();   // 'ltr' | 'rtl'
```

Native UI 支持 `textKey`、`labelKey` 和 `placeholderKey`，宿主生成的应用程序菜单支持 `titleKey` 和 `labelKey`。

### `macos.storage` — 权限 `storage`

```js
await macos.storage.get('key');
await macos.storage.get();
await macos.storage.set('key', value);
await macos.storage.remove('key');
await macos.storage.clear();
```

存储按应用划分命名空间，并且按键存储，而不是每次小的状态变化都重写一个庞大的应用程序对象。

### `macos.fetch` — 权限 `network`

```js
const response = await macos.fetch('https://example.com/api', {
  method: 'GET',
  headers: { Accept: 'application/json' }
});
```

宿主返回 `ok`、`status`、`statusText`、`url`、`text` 和响应头。对于二进制响应，传入 `responseType: 'base64'` 以得到 `base64` 而不是 `text`。

在严格模式下，对本机和私有网络地址（`localhost`、`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、链路本地地址、`*.local`）的请求会被拒绝。

### `macos.openExternal` — 权限 `openExternal`

```js
await macos.openExternal('https://example.com/');
```

只接受 HTTP/HTTPS URL。

### `macos.openURL` 与 URL scheme — 权限 `openExternal`

应用程序用 URL 指向彼此。应用程序写明它响应哪些 scheme：

```json
"urlSchemes": ["notes"]
```

然后任何人 — 另一个应用程序，或它自己 — 都可以打开这样的链接：

```js
await macos.openURL('notes://note/abc123?mode=edit');     // 打开 Notes（需要时先启动它）

macos.on('openurl', ({ url, from }) => {                  // 在 Notes 中；from：调用方应用程序的 id
  const link = new URL(url);
  if (link.hostname === 'note') showNote(link.pathname.slice(1));
});
```

最多四个 scheme，每个由 2–32 个小写字母、数字、`+`、`.`、`-` 组成；Web 自己的 scheme（`http`、`mailto`、`file` 等）不能被占用。两个应用程序写了同一个 scheme 时，先安装的那个拥有它。没有任何应用响应的 URL 会被拒绝，`http(s)` 除外，它会像 `openExternal` 一样在新标签页中打开。“音乐”响应 `music://song/<id>` 和 `music://playlist/<id>`，“图书”响应 `books://book/<id>` — 这些 id 就是它们列给聚焦搜索的那些。

### `macos.instances`

```js
const windows = await macos.instances.list();        // [{ instance, self, front, title, sharedStorage }]
await macos.instances.broadcast({ changed: 'library' });   // 其他窗口中的 'instancemessage'
if (await macos.instances.canOpen()) await macos.instances.open();   // 这个应用程序的又一个窗口
```

只有在用户允许的地方，一个应用程序才会有多个窗口（设置 → 应用程序 → 该应用程序 → *允许多开*，并且开发者模式的应用程序多开已打开）。`canOpen()` 说明现在是否还能再打开一个；`open()` 打开它，否则 resolve 为 `false`。没有程序坞图标的附属应用，除了自己的菜单之外没有别的地方提供这个入口 — 宠物的 *再来一只星野*。

**浏览器的上下文菜单**（后退、重新加载、检查…）绝不会在应用程序上方打开：运行时在所有地方取消它，只有正在编辑的文本上除外，和桌面的其余部分一样。请用 `macos.ui.showMenu` 显示你自己的菜单。

### `macos.clipboard` — 权限 `clipboard`

```js
await macos.clipboard.writeText('hello');
```

读取需要单独的 `clipboardRead` 权限，浏览器还可能另外询问用户：

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
await macos.window.setAccentColor('red');   // 见 §4 的“强调色”
await macos.window.setAppearance('dark');   // 'system' | 'light' | 'dark'；null 回到清单的 window.appearance
const { left, top, width, height, maximized } = await macos.window.getBounds();
```

**移动窗口。** 任何应用程序都可以放置自己的窗口；宿主保证它够得着（无边框窗口完整地留在桌面上、菜单栏下方；其他窗口至少有 80 px 在屏幕上）。

```js
const frame = await macos.window.getFrame();
// { x, y, width, height, screen: { width, height, top /* 菜单栏 */, bottom /* 程序坞顶部 */, dock: { x, y, width, height } | null } }
await macos.window.moveTo(400, 300);                                     // 立刻
const end = await macos.window.moveTo(800, 300, { duration: 2000 });    // 滑行过去（'linear' 或 easing: 'ease'）
// end：它到达的框架，带有 clamped（它被留在了桌面内）和 cancelled（一次拖动或另一次移动接管了）

petElement.addEventListener('pointerdown', (event) => {
  macos.window.beginDrag(event).then((frame) => { /* 在这里放下；在边缘时 frame.clamped，扔出去时用 frame.velocity */ });
});

macos.on('screenchange', ({ screen, frame, moved }) => {});   // 浏览器窗口改变了大小；moved：宿主把这个窗口移回了屏幕内
```

`macos.context.launchReason` 说明应用程序为何被启动：`'autostart'`（用户为它打开了 *打开新标签页时启动*）或 `'user'`；`macos.context.autostart` 是同一信息的布尔值。随每个新标签页启动的应用程序，这时应当不碍事。

```js
macos.on('reopen', () => {});   // 应用程序运行期间，用户再次打开了它（程序坞、启动台、聚焦搜索）
```

没有普通窗口的应用程序 — 隐藏了自己的、可点击穿透的、菜单栏里的附属应用 — 就是靠 `reopen` 得知有人找它。宿主为了送达某样东西而打开应用程序时（`widget`、`openurl`、`search`、`notificationclick`）不会发送它：那些事件本身就说明了要什么。

无边框窗口还可以裁剪成它所画内容的形状 — `macos.window.setShape(rects)`，见 §4 的 *无边框、浮动与附属窗口* — 这样旁边的点击会落到桌面上；或者完整绘制，用 `macos.window.setHitRegion(rects)` 告诉宿主它在哪里接收指针。`macos.window.setLevel('desktop' | 'normal' | 'floating')` 在层级之间移动它。

`beginDrag` 让用户抓着被按下的任何东西带着窗口走（Web App 自己的表面 — 使用 `titlebar: "hidden"` 的 Native App 本来就可以通过空白表面拖动）。在此期间应用程序持续收到自己的 `pointermove` 事件，用来为它画的东西做动画。它是无边框窗口（`titlebar: "none"`，§4）的工具。它 resolve 的框架还带有 `velocity: { x, y }` — 松手时指针的速度，单位 px/s — 供被“扔出去”的东西使用。拖动一定会结束：如果指针是在应用程序的文档已经看不到的地方松开的（甩得比窗口跟得还快，或者落在窗口形状之外），宿主会结束这次拖动，promise 照样 resolve。用户拎着窗口期间，`moveTo` 什么都不做，并立刻以 `cancelled: true` resolve — 以手为准。

**桌面上的指针** — 权限 `pointer`：

```js
await macos.window.trackPointer(true);
macos.on('pointerposition', ({ x, y, screenX, screenY }) => {});   // x、y 相对于这个窗口的左上角
await macos.window.trackPointer(false);
```

每秒约 16 次更新，只在页面可见时、并且只在桌面和原生窗口上方 — 不包括另一个 Web App 自己的内容上方。指针在应用程序自己窗口内做了什么，它通过普通的 DOM 事件得知。

`setAppearance()` 是应用程序自己的浅色 / 深色设置。宿主把这个选择和应用程序一起记住，所以它的每个窗口从第一帧起就以那种外观打开，并用系统的交叉淡化来切换。`macos.context.appearance`（以及 `system.getInfo().appearance`）是当前的选择，`theme` 是实际显示的外观；每次变化之后都会有 `themechange` 事件，不论是应用程序还是系统做的更改。系统自己不提供按应用程序的外观开关：想要这个开关的应用程序把它放进自己的设置里，如“音乐”和“图书”那样，或者放进菜单里，如“计算器”那样。

### `macos.desktop` — 权限 `windows`

东西在桌面上的位置，供生活在窗口之间的应用程序使用：落在窗口上的天气、站在窗口上的宠物。

```js
const layout = await macos.desktop.getLayout();
// { screen: { width, height, top, bottom, dock },
//   dock:   { x, y, width, height, radius } | null,
//   windows: [{ id, app, system, x, y, width, height, radius, level, frameless, z, own }],    从前到后
//   widgets: [{ id, x, y, width, height, radius }] }                                           桌面上的小组件

await macos.desktop.watch();                    // 现在的同一份布局，并从此开始收到 'desktopchange'
macos.on('desktopchange', (layout) => {});
await macos.desktop.watch(false);
```

- 桌面的 CSS 像素，与 `macos.window.getFrame()` 的坐标相同。只列出显示着的窗口；最小化或隐藏的窗口根本不在其中。`own` 标记应用程序自己的窗口，`system` 标记系统的窗口（设置、访达），`frameless` 和 `level` 用来把宠物或铺满桌面的覆盖层与普通窗口区分开。
- 聚焦搜索打开期间，会和窗口一起列出（`system:spotlight`）。桌面上的小组件单独列出：它们位于所有窗口之下，所以是可以站立的地方，而不是挡路的东西 — 并且不能附着到 `widget:…` id 上。
- **只有位置和尺寸。** 没有标题，没有内容，没有其他应用程序显示的任何东西 — `app` 是那个应用程序清单里的 id，而它本来就是公开的。
- 有东西在移动时（拖动、缩放动画、程序坞在指针下变大），`desktopchange` 每帧最多到达一次；什么都没动时完全不会到达。

**随另一个窗口移动**（同一权限）：

```js
await macos.window.attach(windowId, { edge: 'top' });   // 布局中的一个 id，或 'dock'
await macos.window.attach(null);                        // 松开
macos.on('detached', ({ reason, frame }) => {});        // 载体关闭了（'closed'）或被最小化 / 隐藏了（'hidden'）
```

宿主让这个窗口保持在相对于载体上沿（或下沿）的位置，并在载体移动的同一帧移动它，所以拖动时没有任何滞后。自己移动（`moveTo`、`beginDrag`）会保留附着，只是改变在载体上的位置。通常的限制仍然有效：无边框窗口留在桌面上，所以当载体走得更远时，它会被留在屏幕边缘。

### `macos.apps` — 协作的应用程序

两个应用程序 **在各自清单的 `peers` 下写上对方的名字** 时，就可以交谈：

```json
"peers": ["outside-weather"]
```

```js
const there = await macos.apps.send('outside-weather', { type: 'step', x, y });   // false：它没有在运行
macos.on('message', ({ from, message }) => {});
macos.on('peerchange', ({ id, running }) => {});        // 一个协作应用启动或退出了
const peers = await macos.apps.peers();                 // [{ id, running }]
```

不需要权限，也没有办法绕过清单：发给未列出的应用程序的消息会被拒绝，没有列出发送方的应用程序什么都收不到。消息是 JSON，最大 16 KB，并且不会保留 — 没有在运行的应用程序会错过它（`send` resolve 为 `false`），所以启动时要打个招呼，协作应用启动时要应答。最多八个协作应用。

示例 *窗外* 和 *星野* 就是范例：宠物告诉天气她的脚在哪里，那里的雪就被踢起来；天气告诉宠物它在下什么，她就把一只手伸进去。各自都能单独工作；合在一起，它们是同一个场景。

### `macos.dialog`

```js
await macos.dialog.alert('Saved.', { title: 'Notes' });
const ok = await macos.dialog.confirm('Delete this note?', { confirmLabel: 'Delete', danger: true });
```

```js
const name = await macos.dialog.prompt('Name of the new playlist:', { value: 'Untitled' });   // 取消时为 null
```

文件访问通过浏览器自己的选择器和下载界面进行，所以应用只会看到用户为它选择的文件。这些调用需要 `files` 权限，并且必须紧跟一次用户操作（点击或按键）：

```js
const file = await macos.dialog.openFile({ accept: '.txt,.md', as: 'text' });   // as: 'text' | 'dataUrl' | 'base64'
if (file) console.log(file.name, file.size, file.text);                       // 取消时为 null
const several = await macos.dialog.openFile({ accept: 'image/*', multiple: true, as: 'dataUrl' });   // 一个数组

// 大文件：把它们留在宿主一侧，得到 id 而不是内容。
const songs = await macos.dialog.openFile({ accept: 'audio/*', multiple: true, store: true });
// -> [{ id, name, type, size, duration }]

await macos.dialog.saveFile({ name: 'note.txt', text: 'hello', mime: 'text/plain' });   // 或 base64: '...'
```

### `macos.files` — 权限 `files`

`macos.storage` 是一个小型 JSON 存储。任何大的东西 — 歌曲、照片、文稿 — 都放进应用的文件存储。文件留在沙盒的宿主一侧；应用只持有一个 id，用 `blob:<id>` 来源显示图片，通过 `macos.audio` 播放音频，所以成兆字节的数据永远不必进入应用。

```js
const info = await macos.files.put({ text: 'hello', name: 'note.txt', type: 'text/plain' });   // 或 base64 / dataUrl
await macos.files.list();            // [{ id, name, type, size, created, duration?, width?, height? }]
await macos.files.info(id);
await macos.files.read(id, { as: 'text' });   // 'text' | 'base64' | 'dataUrl'；严格模式下最大 8 MB
await macos.files.export(id, 'copy.mp3');     // 下载到用户的磁盘
await macos.files.remove(id);
await macos.files.usage();           // { count, bytes, quota, maxFileBytes }
await macos.files.clear();
```

文件通过 `put()`、`openFile({ store: true })`、`drop` 事件和 `macos.archive.extract()` 进入存储。音频和视频会得到 `duration`，图片会得到 `width` / `height`。音频文件还会被读取标签：`tags`（`title`、`artist`、`album`、`albumArtist`、`track`、`year` — 来自 ID3v2、MP4 和 FLAC 元数据）和 `artworkId`，即内嵌封面作为独立文件存储后的 id（用作 `blob:<artworkId>`）。限制：严格模式下每个文件 2 GB（否则 4 GB），每个应用 64 GB。视频文件会得到一张海报帧作为它的 `artworkId`。使用 `openFile({ store: true, multiple: true })` 时，无法存储的文件会被跳过，并由宿主告知用户；所选的其余文件仍会返回。卸载应用会删除它的文件和它的 `macos.storage` 数据。

### `macos.archive` — 权限 `files`

```js
// 由已存储的文件和生成的文本组成一个 .zip。下载它，或者用 store: true 保留它。
await macos.archive.create({ name: 'Road Trip.zip', entries: [
  { path: 'playlist.json', text: JSON.stringify(manifest) },
  { path: 'songs/01.mp3', fileId }
] });

// 解开一个已存储的 .zip。小的文本条目直接内联返回，其余的作为已存储的文件返回。
const entries = await macos.archive.extract(zipFileId);   // [{ path, text } | { path, file: { id, … } }]
```

### `macos.audio` — 权限 `audio`

每个应用一个位于宿主一侧的播放器，从文件存储取数据。

```js
await macos.audio.load(fileId);                 // 开始播放；用 { autoplay: false, startAt: 30 } 改变这一点
await macos.audio.pause(); await macos.audio.play(); await macos.audio.stop();
await macos.audio.pause({ fade: 0.45 });         // 淡出，然后停止；play({ fade }) 淡入回来（最长 5 秒）
await macos.audio.load(nextId, { crossfade: 4 }); // 正在播放的内容在新文件之下淡出（最长 12 秒）
await macos.audio.seek(42); await macos.audio.setVolume(0.6);
const { fileId: current, paused, currentTime, duration, volume } = await macos.audio.state();

macos.on('audio', ({ type, paused, ended, currentTime, duration }) => {
  // type: play, pause, timeupdate, ended, loadedmetadata, seeked, volumechange, error
});
```

窗口最小化时播放继续，窗口关闭时播放停止。

```js
await macos.audio.setMetadata({ title, artist, album, artwork: 'blob:' + artworkId });
```

把“正在播放”的信息发布给系统的媒体控制。此后硬件媒体键会以 `type: 'action'` 的 `audio` 事件到达，`action` 为 `play`、`pause`、`nexttrack` 或 `previoustrack`。

**淡入淡出。** 渐变由宿主来做，所以应用程序只需要说多长时间。使用 `crossfade` 时，`load()` 立刻开始播放新文件，并让旧文件在它下面播完；从那时起，`state()` 和 `audio` 事件只描述新文件（旧文件不会报告 `ended`）。要在歌曲自然结束处混合，就在 `duration - currentTime` 降到交叉淡化的长度时加载下一首，如“音乐”那样。播放器已暂停、`autoplay: false` 或者没有任何东西在播放时，就是直接切换。暂停正在淡出期间，`paused` 已经是 `true`。到底要不要淡入淡出，是应用程序提供给用户的一项设置。

**字幕。** 浏览器会播放视频的画面和声音，但不会播放存储在文件中的文本轨道。宿主在文件被存储时读取它们 — MP4 / MOV 的 mov_text 和 WebVTT 轨道，Matroska / WebM 的 SRT、ASS / SSA 和 WebVTT 轨道 — 并把它们显示在 `video` 节点之上。`macos.files.info()` 以 `subtitles: [{ language, label }]` 列出它们。

```js
await macos.audio.load(fileId, {
  subtitles: [{ fileId: srtFileId, label: 'English' }],   // 应用为这个视频存储的字幕文件：.srt .vtt .ass .ssa .lrc
  subtitle: 0                                             // 显示哪条轨道：索引，或 -1 表示不显示（默认 0）
});
const { subtitles, subtitle } = await macos.audio.state();  // [{ label, language }]，正在显示的索引（-1：无）
await macos.audio.setSubtitle(1);                           // 或 -1
await macos.audio.addSubtitle({ fileId, label });           // 给正在播放的内容加上一个已存储的字幕文件，并显示它
```

字幕由宿主自己绘制，位于 `video` 节点的画面之上；它们的样子 — 文字大小、底衬、顶部还是底部 — 是用户的设置（系统设置 → 辅助功能 → 字幕），而不是应用程序的。文件中找到的轨道排在前面，然后是随 `load()` 传入的文件。很长的 Matroska 文件会在后台读完；轨道就绪时，一个 `type: 'subtitles'` 的 `audio` 事件会通告它们。

### `macos.notifications` — 权限 `notifications`

```js
const id = await macos.notifications.show({ title: 'Timer', body: 'Time is up.', tag: 'timer' });
macos.on('notificationclick', ({ id, tag, action }) => {});   // action：通知本身为 ''

// 带按钮（最多三个；`destructive: true` 把标题画成红色）：
macos.notifications.show({ title: 'Import finished', body: '12 songs added.', tag: 'import',
  actions: [{ id: 'show', title: 'Show' }, { id: 'undo', title: 'Undo', destructive: true }] });
```

通知是新标签页桌面内部的横幅，不是操作系统的通知。横幅在几秒后消失（`duration`，2–15 秒）；通知会留在 **通知中心** — 菜单栏时钟背后的面板，位于小组件上方 — 直到用户打开或清除它，标签页关闭之后也是如此。带有 `tag` 的通知会替换该应用程序先前带有同一 tag 的那条。

打开一条通知 — 或按下它的某个按钮 — 会把应用程序带到前面，并发送 `notificationclick`；`action` 是那个按钮的 id。按钮不是在后台运行代码的途径：和通知本身一样，它会打开应用程序，然后由应用程序去做事。按钮显示在横幅上（指针停在上面时横幅不会消失）和通知中心里。如果应用程序没有在运行，会先启动它，事件在它的脚本运行之后到达。

是否允许显示通知，由用户按应用程序决定（设置 → 通知）；对于不被允许的应用程序，`show()` resolve 为空 id，什么都不会出现。打开 **勿扰模式** 时不显示横幅，通知直接进入通知中心。

**定时通知** — 用于在应用程序没有运行、甚至根本没有打开任何新标签页时到期的事情：

```js
await macos.notifications.schedule({ id: letter.id, at: letter.due, title: 'A paper plane has landed', body: '…', tag: `landed:${letter.id}` });
await macos.notifications.cancel(letter.id);    // 不带 id 的 cancel() 取消全部
const waiting = await macos.notifications.scheduled();   // [{ id, at, title, body, tag }]
```

`at` 是以毫秒表示的时间（或一个 `Date`）。通知被交给系统，由系统保存并在那个时间显示 — 应用程序没有任何部分为它运行，应用程序或任何新标签页是否打开都无关紧要。有新标签页在前台时，它在那里以横幅出现；否则它以操作系统通知的形式显示，点击它会打开一个新标签页、打开应用程序并发送 `notificationclick`。无论哪种情况，它都会归入通知中心。用同一个 `id` 再次安排会替换先前的那条；一个应用程序最多可以有 64 条在等待。它们随应用程序的数据走，用户关闭了它的通知时会被丢弃。浏览器的闹钟精确到大约半分钟。

这是通知，不是唤醒：需要在那个时间 *做* 点什么的应用程序，要等到下次被打开时再做。

### `macos.search`

```js
await macos.search.setItems([
  { id: 'song:42', title: 'Blue Hour', subtitle: 'Artist — Album', keywords: 'jazz 1998' }
]);                                   // 替换整个列表；返回保留了多少条
await macos.search.clear();
macos.on('search', ({ id, query }) => {});
```

聚焦搜索可以在应用程序中找到的东西。这个列表与应用程序的数据存放在一起，所以应用程序没有运行时，它的内容也能被找到；选中一条结果会打开应用程序（需要时先启动它），并带着该条目的 `id` 发送 `search`。匹配先看 `title`，再看 `subtitle`，然后是 `keywords`。最多 2 000 条（宽松时 10 000 条）。用户可以在 设置 → 聚焦搜索 中关闭应用程序内容；抹掉应用程序的数据会清空这个列表。

### `macos.permissions`

```js
const status = await macos.permissions.status();          // 每项已声明的权限：{ storage: 'granted', files: 'denied', … }
await macos.permissions.request(['storage', 'files']);    // 全部被授予时 resolve 为 true
```

用户可以关闭一项已声明的权限（设置 → 应用程序）。缺了它就无法工作的应用程序，用 `request()` 把它要回来：系统会显示一个对话框，写明应用程序和这些权限，并带有 **打开系统设置**，它会把用户带到该应用程序的开关处。只有用户能在那里打开权限，之后应用程序会被重新打开 — 所以只要有任何一项被拒绝，`request()` 就 resolve 为 `false`。每项权限在每次启动中最多出现一次对话框。请只请求应用程序运作所必需的权限（音乐：`storage`、`files`、`audio`），而不是没有也行的附加功能（`widgets`、`notifications`）。

在 设置 → 应用程序 中，应用程序的权限折叠在 **权限 · n** 之下；应用程序运行期间更改某一项，会提示重新打开它。

### `macos.widgets` — 权限 `widgets`

应用程序可以为桌面和小组件中心提供小组件。小组件是 **一个入口，而不是第二个进程**：宿主根据应用程序最近一次发布的内容绘制它，不论应用程序是否打开，应用程序没有任何部分为它运行。点击小组件会打开应用程序。

在清单中声明小组件：

```json
"permissions": ["widgets"],
"widgets": [
  { "id": "recent", "title": "Recently Played", "titleKey": "widgetRecent", "sizes": ["small", "medium", "large"] }
]
```

最多八个小组件；`sizes` 为 `small`（160 × 160）、`medium`（332 × 160）和 `large`（332 × 332）。每个已声明的小组件都会以它列出的每种尺寸，出现在小组件库中该应用程序的名称之下。

运行期间，应用程序发布每个小组件显示的内容 — 每种尺寸一棵原生界面树，或者所有尺寸共用一棵：

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
await macos.widgets.clear('recent');           // 回到占位内容；clear() 清除全部
const widgets = await macos.widgets.list();    // [{ id, sizes, placed: [{ size, location: 'desktop' | 'center' }] }]

macos.on('widget', ({ id, size, action }) => {});   // 应用程序是从一个小组件打开的
```

- 这棵树使用与 `macos.ui` 相同的节点和属性，但仅限于一幅静态画面所需要的：`stack`、`grid`、`zstack`、`card`、`text`、`button`、`image`、`progress`、`canvas`、`spacer`、`separator`。每个小组件最多 160 个节点、150 KB。图片来源是包内资源、`blob:<文件 id>` 和 `data:` 图片（以及有 `network` 权限时的 `https://`）。
- 设置了 `padding`（包括 0）的根节点会从边到边铺满卡片 — 配合 `background` 或 `gradient` 可以做出彩色的小组件。没有它时，内容位于系统的小组件材质上，并带有标准内边距。
- `widget` 事件中的 `action` 是被点击的按钮的 `id`，点击的是小组件本身时为 `''`。应用程序会先被打开（没有在运行就先启动），并在准备好之后收到事件。
- 内容每次变化时都要重新发布（没有任何变化的调用会被宿主忽略）。应用程序从未发布过的小组件显示它的图标和标题。
- 内容与应用程序的数据存放在一起：数据被抹掉或应用程序被卸载时它也随之消失；用户关闭了 `widgets` 权限期间，小组件会显示一条提示。

### `macos.statusItem` — 权限 `statusItem`

```js
await macos.statusItem.set({
  icon: 'assets/icons/note.svg',      // 包内资源、blob:<id> 或 data: 图片
  template: true,                     // 默认：图标采用菜单栏的文字颜色
  title: '',                          // 可选的短文本（24 个字符）
  tooltip: 'Not Playing',
  items: [                            // 与 macos.ui.showMenu 结构相同
    { id: 'toggle', label: 'Play' }, { separator: true }, { id: 'show', label: 'Show Music' }
  ]
});
await macos.statusItem.remove();
macos.on('statusitem', ({ id }) => {});   // 选中的条目；点击没有菜单的项目时为 ''
```

**面板** — 菜单显示不了的东西：封面、播放控制、滑块。

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
  items: [{ id: 'show', label: 'Show Music' }]          // 可选：右键菜单
});
macos.statusItem.patch('time', { text: '0:40' });        // 或 patch([{ id, props }, …])
macos.on('statusitem', ({ id, event, value }) => {});    // 某个控件被使用：event 为 'click' / 'input' / 'change'
```

面板是一棵使用 `macos.ui` 节点和属性的界面树，由宿主画在项目下方的弹出层里 — 对 Web App 也一样。它允许 `stack`、`grid`、`zstack`、`card`、`text`、`button`、`image`、`progress`、`slider`、`switch`、`segmented`、`canvas`、`spacer` 和 `separator`，最多 120 个节点。点击项目会打开它；使用其中的控件时它保持打开，在别处点击或按 Escape 时关闭（带有 `id: ''` 和 `event: 'open'` / `'close'` 的 `statusitem` 说明何时发生）。同时有面板和 `items` 时，菜单在右键点击时打开。不带 `panel` 的 `set()` 让面板保持原样，`panel: null` 移除它；`patch()` 更改单个节点，每秒移动一次进度滑块就该用它。

每个正在运行的应用程序在菜单栏右侧有一个项目，用于窗口最小化或被其他窗口挡住时仍应够得着的东西。它需要一个 `icon` 或一个 `title`。再次调用 `set()` 来更改它；应用程序退出时它会被移除。

### `macos.log`

```js
macos.log('loaded', items.length, { detail: true });
```

写入新标签页的开发者控制台，以应用 id 为前缀。请把它与崩溃视图一起使用（未捕获的错误会在应用窗口中显示其调用栈，并带有“重新载入”按钮）。

### `macos.menu` — 权限 `menu`

应用可以调用一份稳定的宿主命令白名单：

```js
const commands = await macos.menu.list();
await macos.menu.invoke('apple.settings');
```

当前的命令 ID：

```text
apple.about
apple.settings
system.spotlight
system.launchpad
settings.applications
settings.widgets
settings.developer
```

应用不能点击任意的宿主 DOM，也不能调用任意的桌面函数。
