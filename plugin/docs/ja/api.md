[English](../api.md) · [简体中文](../zh-CN/api.md) · **日本語**

# ランタイム API

アプリケーション SDK ドキュメントの一部です — [README](../../README.ja.md) から読み始めてください。

## 7. ランタイム API

### 権限

マニフェストの `permissions` リストで宣言し、設定 → アプリケーション でユーザに表示されます。

| 権限 | 使えるようになるもの |
| --- | --- |
| `storage` | `macos.storage` |
| `files` | `macos.files`、`macos.archive`、`macos.dialog.openFile` / `saveFile`、`drop` イベント |
| `audio` | `macos.audio` |
| `network` | `macos.fetch`、リモートの `https://` 画像ソース |
| `notifications` | `macos.notifications` |
| `clipboard` / `clipboardRead` | `macos.clipboard.writeText` / `readText` |
| `openExternal` | `macos.openExternal` |
| `menu` | `macos.menu`（ホストのコマンド） |
| `statusItem` | `macos.statusItem`（メニューバーの項目） |
| `widgets` | マニフェストの `widgets` と `macos.widgets`（デスクトップとウィジェットセンター用のウィジェット） |
| `pointer` | `macos.window.trackPointer`（デスクトップ上でポインタがどこにあるか） |
| `windows` | `macos.desktop` と `macos.window.attach`（Dock と他のウインドウがどこにあるか — その中身は決して含まない） |

`macos.ui`、`macos.window`、`macos.dialog.alert` / `confirm` / `prompt`、`macos.system`、`macos.i18n`、`macos.search`、`macos.log` に権限は要りません。

ユーザは、宣言された権限を 1 つのアプリケーションについてオフにできます（設定 → アプリケーション）。その場合、それで使えるようになる呼び出しは、宣言されていなかったときとまったく同じように `Permission denied: <name>` で reject されます — 権限を任意のものとして扱うアプリは、その機能なしで動き続けます。

ホストは、アプリケーションが実際にどの権限を使ったか — 何回、最後はいつ、何回拒否されたか — を記録します。ユーザは 設定 → アプリケーション（**権限の使用状況**）とデベロッパツールでそれを見られます。宣言されているのに一度も使われていない権限は、そのように表示されます。

エントリスクリプトは次のものを受け取ります。

```js
macos
root
```

トップレベルの `await` がサポートされています。

`root` は Web App の DOM ルートです。Native App の目に見える UI はホストのドキュメントに属するので、Native App は通常 `root` を操作するのではなく `macos.ui` を使ってください。

### `macos.system`

```js
const info = await macos.system.getInfo();
```

現在の情報には次のものが含まれます。

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
  direction: 'ltr',            // レイアウトが鏡像のときは 'rtl'
  accentColor: '#0a84ff',      // このアプリに有効なアクセント
  accentSetting: 'multicolor'  // システムの設定：'multicolor' または固定色の名前
}
```

起動コンテキスト（`macos.context`）は、このランタイムがどのインスタンスなのかも運びます。

```js
{
  instance: 1,          // アプリの通常のウインドウは 1、それ以降のインスタンスは 2…
  sharedStorage: true   // false：このインスタンスは自分のストレージプールを持つ
}
```

関連するイベント：

```js
macos.on('themechange', ({ theme, systemTheme }) => {});   // theme：このウインドウが今表示している外観
macos.on('languagechange', ({ language, direction }) => {});
macos.on('visibilitychange', ({ visible }) => {});
macos.on('hostdragchange', ({ active, kind }) => {});
macos.on('resize', ({ width, height }) => {});   // ウインドウ外枠のサイズ（CSS px。レイアウト後のサイズで、最小化アニメーションの影響を受けない）
macos.on('focus', () => {});                     // ウインドウがアクティブになった
macos.on('blur', () => {});
macos.on('close', () => {});                     // ランタイムが破棄される前の最後のイベント
```

Canvas/WebGL/独自のアニメーションを行うアプリは、`visible === false` または `hostdragchange.active === true` のとき、負荷の大きい処理を止めてください。

`macos.system.getStats()` は、アプリケーションがホストの予算に対してどの位置にあるかを伝えるので、呼び出しが拒否される前に手を緩められます。

```js
const stats = await macos.system.getStats();
// { apiCallsThisSecond, apiCallsLimit, apiCallsAdvised,     厳格なセキュリティでは毎秒 240 回。推奨の 90 未満を目指す
//   nodeCount, nodeLimit,                                    画面上のネイティブ UI ノード
//   storageBytes, storageQuota, fileCount, fileBytes, fileQuota, securityLevel }   上限が null なら、上限はない
```

### `macos.i18n`

パッケージのロケールを宣言します。

```json
"locales": {
  "en-US": "locales/en-US.json",
  "zh-CN": "locales/zh-CN.json",
  "ja-JP": "locales/ja-JP.json"
}
```

そのうえで：

```js
macos.i18n.t('key', 'Fallback');
macos.i18n.language();
macos.i18n.direction();   // 'ltr' | 'rtl'
```

Native UI は `textKey`、`labelKey`、`placeholderKey` を、ホストが生成するアプリケーションメニューは `titleKey` と `labelKey` をサポートします。

### `macos.storage` — 権限 `storage`

```js
await macos.storage.get('key');
await macos.storage.get();
await macos.storage.set('key', value);
await macos.storage.remove('key');
await macos.storage.clear();
```

ストレージはアプリごとに名前空間が分かれ、小さな状態の変化のたびに 1 つの大きなアプリケーションオブジェクトを書き直すのではなく、キーごとに保存されます。

### `macos.fetch` — 権限 `network`

```js
const response = await macos.fetch('https://example.com/api', {
  method: 'GET',
  headers: { Accept: 'application/json' }
});
```

ホストは `ok`、`status`、`statusText`、`url`、`text`、レスポンスヘッダを返します。バイナリのレスポンスには `responseType: 'base64'` を渡すと、`text` の代わりに `base64` を受け取れます。

厳格モードでは、このマシンとプライベートネットワークのアドレス（`localhost`、`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、リンクローカル、`*.local`）へのリクエストは拒否されます。

### `macos.openExternal` — 権限 `openExternal`

```js
await macos.openExternal('https://example.com/');
```

HTTP/HTTPS の URL だけが受け付けられます。

### `macos.openURL` と URL スキーム — 権限 `openExternal`

アプリケーションは URL で互いを指し示します。アプリケーションは、自分が応えるスキームを挙げます。

```json
"urlSchemes": ["notes"]
```

すると誰でも — 別のアプリケーションでも、同じアプリケーションでも — そのようなリンクを開けます。

```js
await macos.openURL('notes://note/abc123?mode=edit');     // Notes を開く（必要なら起動する）

macos.on('openurl', ({ url, from }) => {                  // Notes 側。from：呼び出したアプリケーションの id
  const link = new URL(url);
  if (link.hostname === 'note') showNote(link.pathname.slice(1));
});
```

スキームは 4 つまで。小文字、数字、`+`、`.`、`-` の 2〜32 文字です。Web 自身のもの（`http`、`mailto`、`file` など）は取得できません。2 つのアプリケーションが同じスキームを挙げた場合は、先にインストールされたほうがそれを持ちます。誰も応えない URL は reject されますが、`http(s)` は例外で、`openExternal` と同じように新しいタブで開きます。「ミュージック」は `music://song/<id>` と `music://playlist/<id>` に、「ブック」は `books://book/<id>` に応えます — id は、それらが Spotlight に登録しているものです。

### `macos.instances`

```js
const windows = await macos.instances.list();        // [{ instance, self, front, title, sharedStorage }]
await macos.instances.broadcast({ changed: 'library' });   // 他のウインドウで 'instancemessage'
if (await macos.instances.canOpen()) await macos.instances.open();   // このアプリケーションのさらなるウインドウ
```

1 つのアプリケーションの複数のウインドウは、ユーザが許可した場合にだけ存在します（設定 → アプリケーション → そのアプリケーション → *複数起動を許可*、かつ開発者モードの複数起動がオン）。`canOpen()` は今もう 1 つ開けるかどうかを伝え、`open()` はそれを開き、そうでなければ `false` で resolve します。Dock アイコンのないアクセサリには、これを提供する場所が自分のメニュー以外にありません — ペットの *ホシノをもうひとり*。

**ブラウザのコンテキストメニュー**（戻る、再読み込み、検証…）は、アプリケーションの上では決して開きません。デスクトップの他の部分と同じく、ランタイムは編集中のテキストの上を除くすべての場所でそれをキャンセルします。自分のメニューは `macos.ui.showMenu` で表示してください。

### `macos.clipboard` — 権限 `clipboard`

```js
await macos.clipboard.writeText('hello');
```

読み取りには別の `clipboardRead` 権限が必要で、ブラウザがさらにユーザに尋ねることがあります。

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
await macos.window.setAccentColor('red');   // §4 の「アクセントカラー」を参照
await macos.window.setAppearance('dark');   // 'system' | 'light' | 'dark'。null でマニフェストの window.appearance に戻る
const { left, top, width, height, maximized } = await macos.window.getBounds();
```

**ウインドウを動かす。** どのアプリケーションも自分のウインドウを配置できます。ホストはそれに手が届く状態を保ちます（フレームなしのウインドウはデスクトップ上、メニューバーの下に完全に収まり、それ以外は 80 px が画面に残ります）。

```js
const frame = await macos.window.getFrame();
// { x, y, width, height, screen: { width, height, top /* メニューバー */, bottom /* Dock の上端 */, dock: { x, y, width, height } | null } }
await macos.window.moveTo(400, 300);                                     // すぐに
const end = await macos.window.moveTo(800, 300, { duration: 2000 });    // そこへ滑っていく（'linear' または easing: 'ease'）
// end：到着したフレーム。clamped（デスクトップ内に留められた）と cancelled（ドラッグや別の移動に引き継がれた）が付く

petElement.addEventListener('pointerdown', (event) => {
  macos.window.beginDrag(event).then((frame) => { /* ここで下ろされた。端では frame.clamped、投げるなら frame.velocity */ });
});

macos.on('screenchange', ({ screen, frame, moved }) => {});   // ブラウザのウインドウのサイズが変わった。moved：ホストがこのウインドウを画面内へ戻した
```

`macos.context.launchReason` は、アプリケーションがなぜ起動されたかを伝えます：`'autostart'`（ユーザがそれに対して *新しいタブで自動的に開く* をオンにした）または `'user'`。`macos.context.autostart` は同じことを真偽値で表します。すべての新しいタブで起動するアプリケーションは、そのとき邪魔にならないようにしてください。

```js
macos.on('reopen', () => {});   // 実行中に、ユーザがアプリケーションをもう一度開いた（Dock、Launchpad、Spotlight）
```

`reopen` は、通常のウインドウを持たないアプリケーション — 自分を隠したもの、クリック透過のもの、メニューバーのアクセサリ — が、求められたことを知る手段です。ホストが自身の何かを届けるためにアプリケーションを開くとき（`widget`、`openurl`、`search`、`notificationclick`）には送られません。それらは何が求められているかを自ら伝えます。

フレームなしのウインドウは、描くものの形に切り抜くこともできます — `macos.window.setShape(rects)`、§4 の *フレームなし、フローティング、アクセサリのウインドウ* を参照 — そうすれば横のクリックはデスクトップに届きます — あるいは全体を描いたまま、`macos.window.setHitRegion(rects)` でポインタを受け取る場所を伝えることもできます。`macos.window.setLevel('desktop' | 'normal' | 'floating')` はレイヤー間を移動させます。

`beginDrag` を使うと、ユーザは押したものをつかんでウインドウを運べます（Web App 自身の面 — `titlebar: "hidden"` の Native App は、もともと何もない面でドラッグできます）。その間もアプリケーションは自分の `pointermove` イベントを受け取り続けるので、描いているものをアニメーションさせられます。フレームなしのウインドウ（`titlebar: "none"`、§4）のための道具です。resolve されるフレームは `velocity: { x, y }` — 離した瞬間のポインタの速さ（px/s）— も運びます。投げられるもののためです。ドラッグは必ず終わります。アプリケーションのドキュメントからもう見えない場所でポインタが離された場合（ウインドウが追いつくより速くはじかれた、またはウインドウの形状の外だった）は、ホストがドラッグを終わらせ、promise は同じように resolve します。ユーザがウインドウを運んでいる間、`moveTo` は何もせず、すぐに `cancelled: true` で resolve します — 手が優先です。

**デスクトップ上のポインタ** — 権限 `pointer`：

```js
await macos.window.trackPointer(true);
macos.on('pointerposition', ({ x, y, screenX, screenY }) => {});   // x、y はこのウインドウの左上隅からの相対位置
await macos.window.trackPointer(false);
```

毎秒およそ 16 回の更新で、ページが表示されている間だけ、かつデスクトップとネイティブのウインドウの上だけです — 別の Web App 自身の内容の上では届きません。アプリケーション自身のウインドウの中でポインタが何をしているかは、通常の DOM イベントで分かります。

`setAppearance()` は、アプリケーション自身のライト / ダーク設定です。ホストはその選択をアプリケーションと一緒に覚えているので、そのすべてのウインドウは最初のフレームからその外観で開き、切り替えにはシステムのクロスフェードが使われます。`macos.context.appearance`（および `system.getInfo().appearance`）は現在の選択、`theme` は実際に表示されているものです。アプリケーションとシステムのどちらが変えたかにかかわらず、変更のたびに `themechange` イベントが続きます。システムはアプリケーションごとの外観スイッチを提供しません。それが欲しいアプリケーションは、「ミュージック」や「ブック」のように自身の設定に、または「計算機」のようにメニューに置きます。

### `macos.desktop` — 権限 `windows`

デスクトップ上で物がどこにあるか。ウインドウの間で暮らすアプリケーションのためのものです：ウインドウに降り積もる天気、ウインドウの上に立つペット。

```js
const layout = await macos.desktop.getLayout();
// { screen: { width, height, top, bottom, dock },
//   dock:   { x, y, width, height, radius } | null,
//   windows: [{ id, app, system, x, y, width, height, radius, level, frameless, z, own }],    手前から奥へ
//   widgets: [{ id, x, y, width, height, radius }] }                                           デスクトップ上のウィジェット

await macos.desktop.watch();                    // 今の同じレイアウト。ここから先は 'desktopchange'
macos.on('desktopchange', (layout) => {});
await macos.desktop.watch(false);
```

- デスクトップの CSS ピクセルで、`macos.window.getFrame()` と同じ座標です。表示されているウインドウだけが挙げられ、最小化または非表示のものは単にそこにありません。`own` はアプリケーション自身のウインドウを、`system` はシステムのウインドウ（設定、Finder）を示し、`frameless` と `level` はペットやデスクトップ全面のオーバーレイを通常のウインドウから見分けます。
- Spotlight は、開いている間、ウインドウと一緒に挙げられます（`system:spotlight`）。デスクトップ上のウィジェットは別に挙げられます。すべてのウインドウの下にあるので、邪魔になるものではなく立てる場所です — また、`widget:…` の id には attach できません。
- **場所とサイズだけ。** タイトルも、内容も、他のアプリケーションが表示しているものも一切含みません — `app` はそのアプリケーションのマニフェストの id で、もともと公開されているものです。
- `desktopchange` は、何かが動いている間（ドラッグ、拡大のアニメーション、ポインタの下で大きくなる Dock）、1 フレームに最大 1 回届き、何も動いていない間はまったく届きません。

**別のウインドウと一緒に移動する**（同じ権限）：

```js
await macos.window.attach(windowId, { edge: 'top' });   // レイアウトの id、または 'dock'
await macos.window.attach(null);                        // 離す
macos.on('detached', ({ reason, frame }) => {});        // 運び手が閉じた（'closed'）、または最小化 / 非表示になった（'hidden'）
```

ホストは、このウインドウを運び手の上端（または下端）に対する相対位置に保ち、運び手と同じフレームで動かすので、ドラッグに遅れるものは何もありません。自分で動くこと（`moveTo`、`beginDrag`）は attach を保ったまま、運び手の上での位置を変えるだけです。通常の制限は引き続き有効です。フレームなしのウインドウはデスクトップ上に留まるので、運び手がさらに先へ行くと、画面の端に置いていかれます。

### `macos.apps` — 協力するアプリケーション

2 つのアプリケーションは、**それぞれがマニフェストの `peers` に相手の名前を挙げている** とき、会話できます。

```json
"peers": ["outside-weather"]
```

```js
const there = await macos.apps.send('outside-weather', { type: 'step', x, y });   // false：相手は実行中でない
macos.on('message', ({ from, message }) => {});
macos.on('peerchange', ({ id, running }) => {});        // ピアが起動した、または終了した
const peers = await macos.apps.peers();                 // [{ id, running }]
```

権限は要らず、マニフェストを迂回する方法もありません。挙げられていないアプリケーションへのメッセージは拒否され、送信元を挙げていないアプリケーションには何も届きません。メッセージは JSON で最大 16 KB、保持されません — 実行中でないアプリケーションはそれを受け取り損ねます（`send` は `false` で resolve します）。ですから、起動したときに挨拶し、ピアが起動したときに応えてください。ピアは 8 つまでです。

サンプルの *窓の外* と *ホシノ* がお手本です。ペットは足がどこにあるかを天気に伝え、そこの雪が蹴り上げられます。天気は今何をしているかをペットに伝え、彼女はそこへ手を差し出します。それぞれ単独で動き、一緒になると 1 つの情景になります。

### `macos.dialog`

```js
await macos.dialog.alert('Saved.', { title: 'Notes' });
const ok = await macos.dialog.confirm('Delete this note?', { confirmLabel: 'Delete', danger: true });
```

```js
const name = await macos.dialog.prompt('Name of the new playlist:', { value: 'Untitled' });   // キャンセルされたら null
```

ファイルへのアクセスは、ブラウザ自身のピッカーとダウンロードの UI を通るので、アプリが目にするのは、ユーザがそのアプリのために選んだファイルだけです。これらの呼び出しには `files` 権限が必要で、ユーザの操作（クリックまたはキー押下）に続けて行う必要があります。

```js
const file = await macos.dialog.openFile({ accept: '.txt,.md', as: 'text' });   // as: 'text' | 'dataUrl' | 'base64'
if (file) console.log(file.name, file.size, file.text);                       // キャンセルされたら null
const several = await macos.dialog.openFile({ accept: 'image/*', multiple: true, as: 'dataUrl' });   // 配列

// 大きなファイル：ホスト側に置いたまま、内容の代わりに id を受け取る。
const songs = await macos.dialog.openFile({ accept: 'audio/*', multiple: true, store: true });
// -> [{ id, name, type, size, duration }]

await macos.dialog.saveFile({ name: 'note.txt', text: 'hello', mime: 'text/plain' });   // または base64: '...'
```

### `macos.files` — 権限 `files`

`macos.storage` は小さな JSON ストアです。大きなもの — 曲、写真、書類 — は、代わりにアプリのファイルストアに入れます。ファイルはサンドボックスのホスト側に留まります。アプリは id だけを持ち、画像は `blob:<id>` ソースで表示し、オーディオは `macos.audio` で再生するので、何メガバイトものデータがアプリの中へ渡る必要はありません。

```js
const info = await macos.files.put({ text: 'hello', name: 'note.txt', type: 'text/plain' });   // または base64 / dataUrl
await macos.files.list();            // [{ id, name, type, size, created, duration?, width?, height? }]
await macos.files.info(id);
await macos.files.read(id, { as: 'text' });   // 'text' | 'base64' | 'dataUrl'。厳格モードでは 8 MB まで
await macos.files.export(id, 'copy.mp3');     // ユーザのディスクにダウンロード
await macos.files.remove(id);
await macos.files.usage();           // { count, bytes, quota, maxFileBytes }
await macos.files.clear();
```

ファイルは、`put()`、`openFile({ store: true })`、`drop` イベント、`macos.archive.extract()` を通じてストアに入ります。オーディオとビデオには `duration` が、画像には `width` / `height` が付きます。オーディオファイルはタグも読み取られます：`tags`（`title`、`artist`、`album`、`albumArtist`、`track`、`year` — ID3v2、MP4、FLAC のメタデータから）と `artworkId`。後者は、埋め込まれたカバーアートを独立したファイルとして保存したものの id です（`blob:<artworkId>` として使います）。上限：厳格モードでファイルあたり 2 GB（それ以外は 4 GB）、アプリあたり 64 GB。ビデオファイルは、ポスターフレームを `artworkId` として得ます。`openFile({ store: true, multiple: true })` では、保存できないファイルはスキップされ、ホストがユーザに報告します。選択の残りは引き続き返されます。アプリをアンインストールすると、そのファイルと `macos.storage` のデータが削除されます。

### `macos.archive` — 権限 `files`

```js
// 保存されたファイルと生成したテキストから 1 つの .zip を作る。ダウンロードするか、store: true で保持する。
await macos.archive.create({ name: 'Road Trip.zip', entries: [
  { path: 'playlist.json', text: JSON.stringify(manifest) },
  { path: 'songs/01.mp3', fileId }
] });

// 保存された .zip を展開する。小さなテキストのエントリはインラインで、それ以外は保存されたファイルとして返る。
const entries = await macos.archive.extract(zipFileId);   // [{ path, text } | { path, file: { id, … } }]
```

### `macos.audio` — 権限 `audio`

アプリごとにホスト側のプレーヤーが 1 つあり、ファイルストアから供給されます。

```js
await macos.audio.load(fileId);                 // 再生を始める。変えるには { autoplay: false, startAt: 30 }
await macos.audio.pause(); await macos.audio.play(); await macos.audio.stop();
await macos.audio.pause({ fade: 0.45 });         // フェードアウトしてから止まる。play({ fade }) はフェードインで戻る（最長 5 秒）
await macos.audio.load(nextId, { crossfade: 4 }); // 再生中のものが、新しいファイルの下でフェードアウトする（最長 12 秒）
await macos.audio.seek(42); await macos.audio.setVolume(0.6);
const { fileId: current, paused, currentTime, duration, volume } = await macos.audio.state();

macos.on('audio', ({ type, paused, ended, currentTime, duration }) => {
  // type: play, pause, timeupdate, ended, loadedmetadata, seeked, volumechange, error
});
```

再生は、ウインドウが最小化されている間も続き、閉じられると止まります。

```js
await macos.audio.setMetadata({ title, artist, album, artwork: 'blob:' + artworkId });
```

は、再生中の情報をシステムのメディアコントロールに公開します。それ以降、ハードウェアのメディアキーは、`type: 'action'` の `audio` イベントとして届き、`action` は `play`、`pause`、`nexttrack`、`previoustrack` のいずれかです。

**フェード。** 音量の変化はホストが行うので、アプリケーションは長さを伝えるだけです。`crossfade` を使うと、`load()` は新しいファイルをすぐに始め、古いファイルをその下で最後まで流します。それ以降、`state()` と `audio` イベントは新しいファイルだけを表します（古いファイルが `ended` を報告することはありません）。曲の自然な終わりで混ぜるには、「ミュージック」のように、`duration - currentTime` がクロスフェードの長さまで下がったときに次の曲を load してください。プレーヤーが一時停止中、`autoplay: false`、または何も再生していないときは、単純な切り替えになります。一時停止がフェード中の間、`paused` はすでに `true` です。そもそもフェードするかどうかは、アプリケーションがユーザに提供する設定です。

**字幕。** ブラウザはビデオの映像と音声を再生しますが、ファイルに保存されたテキストトラックは再生しません。ホストはファイルが保存されるときにそれらを読み取り — MP4 / MOV の mov_text と WebVTT のトラック、Matroska / WebM の SRT、ASS / SSA、WebVTT のトラック — `video` ノードの上に表示します。`macos.files.info()` は、それらを `subtitles: [{ language, label }]` として挙げます。

```js
await macos.audio.load(fileId, {
  subtitles: [{ fileId: srtFileId, label: 'English' }],   // アプリがこのビデオ用に保存した字幕ファイル：.srt .vtt .ass .ssa .lrc
  subtitle: 0                                             // 表示するトラック：インデックス、または -1 でなし（デフォルト 0）
});
const { subtitles, subtitle } = await macos.audio.state();  // [{ label, language }]、表示中のインデックス（-1：なし）
await macos.audio.setSubtitle(1);                           // または -1
await macos.audio.addSubtitle({ fileId, label });           // 保存された字幕ファイルを再生中のものに追加し、表示する
```

字幕は、ホストが自分で `video` ノードの映像の上に描きます。どう見えるか — 文字の大きさ、背景、上か下か — はユーザの設定（システム設定 → アクセシビリティ → 字幕）であり、アプリケーションのものではありません。ファイルの中で見つかったトラックが先に、そのあとに `load()` で渡されたファイルが並びます。長い Matroska ファイルはバックグラウンドで読み進められ、準備ができると、`type: 'subtitles'` の `audio` イベントがトラックを知らせます。

### `macos.notifications` — 権限 `notifications`

```js
const id = await macos.notifications.show({ title: 'Timer', body: 'Time is up.', tag: 'timer' });
macos.on('notificationclick', ({ id, tag, action }) => {});   // action：通知そのものなら ''

// ボタン付き（3 つまで。`destructive: true` はタイトルを赤で描く）：
macos.notifications.show({ title: 'Import finished', body: '12 songs added.', tag: 'import',
  actions: [{ id: 'show', title: 'Show' }, { id: 'undo', title: 'Undo', destructive: true }] });
```

通知は、新しいタブのデスクトップ内のバナーであり、オペレーティングシステムの通知ではありません。バナーは数秒後に消えます（`duration`、2〜15 秒）。通知は **通知センター** — メニューバーの時計の裏、ウィジェットの上にあるパネル — に、ユーザが開くか消去するまで残り、タブが閉じられたあとも残ります。`tag` を持つ通知は、そのアプリケーションの、同じ tag を持つ以前の通知を置き換えます。

通知を開く — またはそのボタンの 1 つを押す — と、アプリケーションが前面に出て `notificationclick` が送られます。`action` はそのボタンの id です。ボタンはバックグラウンドでコードを実行する手段ではありません。通知そのものと同じく、アプリケーションを開き、作業はアプリケーションが行います。ボタンはバナー（ポインタが乗っている間は消えません）と通知センターに表示されます。アプリケーションが実行中でなければ先に起動され、イベントはそのスクリプトが実行されたあとに届きます。

通知を表示してよいかどうかは、ユーザがアプリケーションごとに決めます（設定 → 通知）。許可されていないアプリケーションでは、`show()` は空の id で resolve し、何も表示されません。**おやすみモード** がオンのとき、バナーは表示されず、通知はそのまま通知センターに入ります。

**スケジュールされた通知** — アプリケーションが実行中でない間、あるいは新しいタブがまったく開いていない間に期日が来るもののために：

```js
await macos.notifications.schedule({ id: letter.id, at: letter.due, title: 'A paper plane has landed', body: '…', tag: `landed:${letter.id}` });
await macos.notifications.cancel(letter.id);    // id なしの cancel() はすべてをキャンセルする
const waiting = await macos.notifications.scheduled();   // [{ id, at, title, body, tag }]
```

`at` はミリ秒単位の時刻（または `Date`）です。通知はシステムに渡され、システムがそれを保持してその時刻に表示します — そのためにアプリケーションの何かが動くことはなく、アプリケーションや新しいタブが開いているかどうかは関係ありません。新しいタブが前面にあるときは、そこにバナーとして現れます。そうでなければオペレーティングシステムの通知として表示され、それをクリックすると新しいタブが開き、アプリケーションが開き、`notificationclick` が送られます。どちらの場合も、通知センターに収められます。同じ `id` でもう一度スケジュールすると、以前のものを置き換えます。アプリケーションは 64 件まで待機させられます。それらはアプリケーションのデータと運命を共にし、ユーザがその通知をオフにしたときは破棄されます。ブラウザのアラームの精度はおよそ 30 秒です。

これは通知であって、目覚ましではありません。その時刻に何かを *する* 必要があるアプリケーションは、次に開かれたときにそれを行います。

### `macos.search`

```js
await macos.search.setItems([
  { id: 'song:42', title: 'Blue Hour', subtitle: 'Artist — Album', keywords: 'jazz 1998' }
]);                                   // リストを置き換える。保持された件数を返す
await macos.search.clear();
macos.on('search', ({ id, query }) => {});
```

Spotlight がアプリケーションの中で見つけてよいものです。リストはアプリケーションのデータと一緒に保存されるので、実行中でなくても内容が見つかります。結果を選ぶとアプリケーションが開き（必要なら起動し）、その項目の `id` を付けて `search` が送られます。マッチングは `title`、次に `subtitle`、次に `keywords` に対して行われます。最大 2 000 項目（緩和時は 10 000）。ユーザは 設定 → Spotlight でアプリケーションの内容をオフにできます。アプリケーションのデータを消去すると、リストも消えます。

### `macos.permissions`

```js
const status = await macos.permissions.status();          // 宣言されたすべての権限について { storage: 'granted', files: 'denied', … }
await macos.permissions.request(['storage', 'files']);    // すべてが許可されているとき true で resolve する
```

ユーザは、宣言された権限をオフにできます（設定 → アプリケーション）。それなしでは動けないアプリケーションは、`request()` で戻してくれるよう頼みます。システムは、アプリケーションと権限の名前を挙げたダイアログを表示し、そこにある **システム設定を開く** が、ユーザをそのアプリケーションのスイッチへ案内します。権限をオンにできるのはそこでユーザだけで、そのあとアプリケーションは開き直されます — したがって、何かが拒否されていれば `request()` は常に `false` で resolve します。ダイアログは、権限と起動ごとに最大 1 回だけ現れます。求めるのは、アプリケーションが機能するために必要なもの（ミュージック：`storage`、`files`、`audio`）にし、なくても済むおまけ（`widgets`、`notifications`）は求めないでください。

設定 → アプリケーション では、アプリケーションの権限は **権限 · n** の下に折りたたまれています。アプリケーションの実行中に権限を変えると、開き直すかどうかを尋ねられます。

### `macos.widgets` — 権限 `widgets`

アプリケーションは、デスクトップとウィジェットセンター用のウィジェットを提供できます。ウィジェットは **入口であって、2 つ目のプロセスではありません**。ホストは、アプリケーションが開いているかどうかにかかわらず、アプリケーションが最後に公開したものからそれを描き、そのためにアプリケーションの何かが動くことはありません。ウィジェットをクリックするとアプリケーションが開きます。

ウィジェットはマニフェストで宣言します。

```json
"permissions": ["widgets"],
"widgets": [
  { "id": "recent", "title": "Recently Played", "titleKey": "widgetRecent", "sizes": ["small", "medium", "large"] }
]
```

ウィジェットは 8 つまで。`sizes` は `small`（160 × 160）、`medium`（332 × 160）、`large`（332 × 332）です。宣言された各ウィジェットは、ウィジェットギャラリーのアプリケーション名の下に、挙げたすべてのサイズで現れます。

実行中、アプリケーションは各ウィジェットが表示するものを公開します — サイズごとのネイティブ UI ツリー、またはすべてのサイズで使う 1 つのツリーです。

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
await macos.widgets.clear('recent');           // プレースホルダに戻す。clear() はすべてを消す
const widgets = await macos.widgets.list();    // [{ id, sizes, placed: [{ size, location: 'desktop' | 'center' }] }]

macos.on('widget', ({ id, size, action }) => {});   // アプリケーションがウィジェットから開かれた
```

- ツリーは `macos.ui` と同じノードとプロパティを使いますが、静止した絵に必要なものに限られます：`stack`、`grid`、`zstack`、`card`、`text`、`button`、`image`、`progress`、`canvas`、`spacer`、`separator`。ウィジェットごとに最大 160 ノード、150 KB。画像ソースは、パッケージのアセット、`blob:<ファイル id>`、`data:` 画像（および `network` 権限があれば `https://`）です。
- `padding`（0 を含む）を設定したルートは、カードを端から端まで埋めます — 色の付いたウィジェットにするには、`background` や `gradient` と一緒に使ってください。設定しなければ、内容は標準のインセット付きで、システムのウィジェットマテリアルの上に置かれます。
- `widget` イベントの `action` は、クリックされたボタンの `id` で、ウィジェットそのものがクリックされたときは `''` です。アプリケーションはまず開かれ（実行中でなければ起動され）、準備ができてからイベントを受け取ります。
- 内容が変わるたびに公開し直してください（何も変えない呼び出しはホストが無視します）。アプリケーションが一度も公開していないウィジェットは、そのアイコンとタイトルを表示します。
- 内容はアプリケーションのデータと一緒に保持されます。データが消去されるか、アプリケーションがアンインストールされると消え、ユーザが `widgets` 権限をオフにしている間、ウィジェットはその旨を表示します。

### `macos.statusItem` — 権限 `statusItem`

```js
await macos.statusItem.set({
  icon: 'assets/icons/note.svg',      // パッケージのアセット、blob:<id>、または data: 画像
  template: true,                     // デフォルト：アイコンはメニューバーの文字色になる
  title: '',                          // 任意の短いテキスト（24 文字）
  tooltip: 'Not Playing',
  items: [                            // macos.ui.showMenu と同じ形
    { id: 'toggle', label: 'Play' }, { separator: true }, { id: 'show', label: 'Show Music' }
  ]
});
await macos.statusItem.remove();
macos.on('statusitem', ({ id }) => {});   // 選ばれた項目。メニューのない項目がクリックされたときは ''
```

**パネル** — メニューでは見せられないもの：カバー、再生コントロール、スライダ。

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
  items: [{ id: 'show', label: 'Show Music' }]          // 任意：右クリックメニュー
});
macos.statusItem.patch('time', { text: '0:40' });        // または patch([{ id, props }, …])
macos.on('statusitem', ({ id, event, value }) => {});    // コントロールが使われた：event は 'click' / 'input' / 'change'
```

パネルは、`macos.ui` のノードとプロパティを使う UI ツリーで、ホストが項目の下のポップオーバーに描きます — Web App でも同じです。使えるのは `stack`、`grid`、`zstack`、`card`、`text`、`button`、`image`、`progress`、`slider`、`switch`、`segmented`、`canvas`、`spacer`、`separator` で、最大 120 ノードです。項目をクリックすると開き、そのコントロールが使われている間は開いたままで、他の場所のクリックか Escape で閉じます（`id: ''` と `event: 'open'` / `'close'` の `statusitem` が、そのタイミングを伝えます）。パネルと `items` の両方があるとき、メニューは右クリックで開きます。`panel` なしの `set()` はパネルをそのままにし、`panel: null` で取り除きます。`patch()` は個々のノードを変更するもので、進捗のスライダを 1 秒に 1 回動かすにはこれを使います。

実行中のアプリケーションごとに、メニューバーの右側に項目が 1 つあります。ウインドウが最小化されていたり他のウインドウの後ろにあったりしても、手が届くべきもののためです。`icon` か `title` が必要です。変更するには `set()` をもう一度呼びます。アプリケーションが終了すると取り除かれます。

### `macos.log`

```js
macos.log('loaded', items.length, { detail: true });
```

新しいタブのページのデベロッパコンソールに、アプリの id を前置きして書き込みます。クラッシュビューと一緒に使ってください（捕捉されなかったエラーは、そのスタックを「再読み込み」ボタン付きでアプリのウインドウに表示します）。

### `macos.menu` — 権限 `menu`

アプリは、安定した許可リストにあるホストのコマンドを呼び出せます。

```js
const commands = await macos.menu.list();
await macos.menu.invoke('apple.settings');
```

現在のコマンド ID：

```text
apple.about
apple.settings
system.spotlight
system.launchpad
settings.applications
settings.widgets
settings.developer
```

アプリは、ホストの任意の DOM をクリックしたり、デスクトップの任意の関数を呼び出したりすることはできません。
