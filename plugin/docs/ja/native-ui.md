[English](../native-ui.md) · [简体中文](../zh-CN/native-ui.md) · **日本語**

# Native App の UI

アプリケーション SDK ドキュメントの一部です — [README](../../README.ja.md) から読み始めてください。

## 5. Native App の UI

Native App の UI は、素の JSON ノードのツリーです。ホストがすべてのフィールドを検証し、実際のコントロールを組み立てます。テキストはテキストとしてのみページに届き、スタイルの値は閉じた語彙から選ばれ、キャンバスの描画はホワイトリスト化されたディスプレイリストで、自由形式の HTML はスクリプトのないサンドボックス化されたフレームに閉じ込められます。

`entry.ui` は、ルートノードか、`{ "styles": { … }, "root": { … } }`（*再利用できるスタイル* を参照）のどちらかです。

### ノードの種類

| 分類 | 種類 |
| --- | --- |
| コンテナ | `stack`（別名 `group`）、`split`、`grid`、`zstack`、`scroll`、`card`、`toolbar` |
| テキストとメディア | `text`、`image`、`video`、`canvas`、`html`、`separator`、`spacer` |
| コントロール | `button`、`input`、`textarea`、`switch`、`checkbox`、`slider`、`progress`、`select`、`segmented` |
| コレクション | `list`、`table` |

`children` を持つのはコンテナだけです。

### レイアウトの方向

右から左に書く言語（アラビア語、ヘブライ語、ペルシア語、ウルドゥー語）のとき — または 開発者 ▸ **右から左へのレイアウトを強制** のとき — ホストは Native App を自分で鏡像にします。水平の stack、grid、split、list は右から並び、`start` / `end` の揃えは左右が入れ替わり、`padding` / `margin` の左と右が交換されます。アプリは何もする必要がありません。

鏡像にしてはならないものには、ノードに `ltr: true` を付けます：再生コントロール、タイムライン、テンキー、電話番号。そのノードとその中のすべてが、左から右の順序を保ちます。

`macos.context.direction`（および `macos.i18n.direction()`）は `'ltr'` または `'rtl'` で、`languagechange` はそれを `direction` として運びます。これは自分で描画するアプリ — `canvas`、`html` ノード、Web App — にとって重要です。それらのドキュメントをホストは鏡像にできないからです。パッケージの `locales` マップは、システムが使う言語コードを取ります（`"ar": "locales/ar.json"`）。

### すべてのノードが受け付けるプロパティ

- 識別：`id`（ノードを patch したり、そのイベントを受け取ったりするのに必要。200 文字までの表示可能な任意のテキストなので、名前やラテン文字以外のタイトルも id として使えます）、`hidden`、`disabled`、`tooltip`、`style`（スタイル表の名前 1 つ、または名前のリスト）。
- サイズ：`width`、`height`、`minWidth`、`minHeight`、`maxWidth`、`maxHeight` — CSS px の数値、`"fill"`（100%）、`"auto"`、またはパーセントの文字列。
- 配置：`grow`、`alignSelf`（`start` / `center` / `end` / `stretch`）、`justifySelf`（`grid` / `zstack` 内での水平方向の配置）、`span` と `rowSpan`（`grid` 内）、`padding` と `margin`（数値、`[縦, 横]`、または `[上, 右, 下, 左]`）。
- 外観：`background`、`gradient`（2〜4 色、上から下へ。単色の背景の代わり）、`color`、`border`（`true` または色）、`radius`（数値または `"full"`）、`opacity`、`fontSize`、`fontWeight`（100–900 または `light` / `regular` / `medium` / `semibold` / `bold`）、`textAlign`、`font`（`system` / `mono` / `rounded`）、`material`（`glass`、`sidebar`、`content`、`clear` — *マテリアルの持ち主* を参照）。

コントロールはシステム自身の寸法で描かれます — 「システム設定」のボタン、フィールド、スイッチ、カード、選択色 — なので、外観プロパティを何も設定しないアプリはシステムのウインドウのように見えます。外観プロパティは意図的に外すためのもの（計算機の丸いキー）であり、基本を正しくするためのものではありません。

`zstack` のレイヤーは厳密に順番どおりに描かれます。後の子は常に前の子の上にあります。

`dismissable: true` はポップオーバーを示します。ノードが画面にある間、ウインドウ内の他の場所が押されると、そのノードに `dismiss` が発行され、`targetId` — 押されたものの id — が付きます。そこでポップオーバーを閉じてください。ただし `targetId` がそれを開閉するボタンである場合は除きます（そのボタン自身の `click` が続いて届きます）。

```js
if (id === 'appearance' && event === 'dismiss' && targetId !== 'toggle-appearance') { open = false; render(); }
```

任意のノードの `showOnHover: true` は、ポインタが親コンテナの上に来るまでそのノードを見えないままにします — アプリとの往復なしに、ホバー時の手がかり（タイトルの横のお気に入りの星、カバーの上の「拡大」の記号）を作る方法です。

`segmented` コントロールは、AppKit と同じく、セグメントの分だけの幅を持ち、与えられた場所の中央に置かれます。幅を与えると（`width: "fill"`）、セグメントがそれを等分します。

**Escape。** Escape を使った `keydown` リスナー（シートを閉じた、ウインドウ全面のビューを抜けた）は `true` を返します。どのリスナーもそうしなかった場合、Escape がシステムのウインドウを閉じるのと同じように、ホストがウインドウを閉じます。フィールドに入力している間は、Escape はフォーカスをそこから外すだけです。Web App は自分のドキュメントで同じ挙動を得ます。処理した Escape に対して `preventDefault()` を呼んでください。

```js
macos.on('keydown', ({ key }) => {
  if (key === 'Escape' && sheetOpen) { sheetOpen = false; render(); return true; }
});
```

`select` はシステムのポップアップボタンとして描かれ、ブラウザのリストではなくシステムのメニューを開きます。

キーボード入力はアプリのものです。ウインドウが前面にある間、ホストはキーを転送し、フォーカスを持っていたコントロールが更新で取り除かれたあとも転送し続けます。`html` ノードはフレームであり、その中をクリックするとキーボードがそのフレームに移って、アプリには何も届かなくなります — そのため、フォーカスはすぐにアプリに戻ります。テキストをキーボードで扱うことを意図した `html` ノードには `selectable: true` を設定してください（その場合、フレームがフォーカスを持つ間、アプリはキーを受け取りません）。

### トランジション

Native App のアニメーションはホストのものです。ノードはどのように現れるかを指定し、ホストがそれを実行し、ノードが去るときは同じアニメーションを逆向きに実行し、ユーザがアニメーションをオフにしているとき（設定 → アクセシビリティ → 視差効果を減らす）は両方とも省きます — アプリが確認することは何もありません。

```js
{ type: 'zstack', id: 'now-playing', transition: 'slide-up', children: [ … ] }
```

`transition` は `slide-up`、`slide-down`、`slide-left`、`slide-right`（ノードが現れるときに進む方向）、`fade`、`scale` のいずれかです。すでに画面にあるインターフェイスにノードが追加されたとき — `render`、`setChildren`、`append`、`replace` によって — に再生され、ウインドウの最初の描画では決して再生されません。

去るときには、アニメーションが動いている間いられる場所が必要なので、これは `zstack` のレイヤーに適用されます。取り除かれたレイヤーは最前面に留まり、トランジションを逆再生してから取り出されます。同じように、あるレイヤーが置き換えられ、別のレイヤーがその上に現れるときは、新しいレイヤーが落ち着くまで下に留まります。ウインドウ全面のビューが、空のウインドウの上ではなく前のビューの上にスライドしてくるのはこのためです。他のコンテナでは、取り除かれたノードは単に消えます。去りつつあるレイヤーはもう id を持たず、入力も受け取りません。その中の `video` ノードは、消えるまで映像を表示し続けます。

`html` ノードを中に持って現れるレイヤーは、そのフレームのドキュメントが読み込まれるまで（長くても数フレーム）開始位置で待つので、空白ではなく内容と一緒に入ってきます。

`video` ノード（`fit`：`contain` / `cover`）は、アプリのメディアプレーヤーの映像 — `macos.audio.load()` が再生しているもの（権限 `audio`）— を表示します。プレーヤーはホストの 1 つの要素で、ノードの中へ移され、また外へ戻されるので、ノードの追加や削除が再生を中断することはありません。`click` と `activate`（ダブルクリック）が報告されます。
- インタラクション：`contextMenu`（右クリックで表示されるメニュー項目）、`hover: true`（`hoverstart` / `hoverend` を発行）。

色は 16 進（`#ff9500`）、`rgb()` / `rgba()` / `hsl()`、またはシステムトークン：`accent`、`red`、`orange`、`yellow`、`green`、`teal`、`purple`、`pink`、`gray`、`text`、`secondary`、`tertiary`、`control`、`fill`、`separator`、`clear`。トークンはウインドウのライト/ダークの外観に従います。

`padding` を設定したルートノードは、内容領域を端から端まで持ちます。そうでなければ、ホストが標準の 14 px のインセットを適用します。ルートは少なくともウインドウと同じ高さです。内側の `list` / `table` / `scroll` ノードがスクロールを受け持つ、固定のウインドウ全面レイアウトには `"height": "fill"` を与えてください。

### 画像ソース

`image.src`、`button.icon`、リストとテーブルの行の `icon`、キャンバスの `drawImage` はすべて、次のものを受け付けます。

| ソース | 例 |
| --- | --- |
| パッケージの画像 | `assets/cover.png` |
| 保存されたファイル（`macos.files` を参照） | `blob:<ファイル id>` — ユーザが選んだ、またはドロップしたファイル、あるいはアプリが保存したデータ |
| インライン画像 | `data:image/png;base64,…`（約 3 MB まで） |
| リモート画像 | `https://…` — `network` 権限が必要。プライベートネットワークのホストは拒否される |

### 種類ごとのプロパティ

- `stack`：`direction`（`vertical` / `horizontal`）、`gap`、`align`、`justify`（`start` / `center` / `end` / `between` / `around` / `evenly`）、`wrap`。水平の stack は、`align` で別の指定がない限り、子を縦方向の中央に揃えます。
- `grid`：`columns` — 個数（等幅の列）、または `[200, "1fr", "auto"]` のようなトラックのリスト。`gap`、`rowHeight`（px または `"auto"`）、`align`、`justify`。
- `zstack`：子は互いの上に重ねられます（オーバーレイ、画像の上のバッジ）。`align` / `justify` で位置を決め、`alignSelf` で子ごとに上書きします。
- `scroll`：`direction`（`vertical` / `horizontal` / `both`）、`scrollEvents`。スクロールビューの中にあるものは、スクロール軸に沿って自然なサイズを保ちます — 収まらない内容はスクロールし、決して押しつぶされません。それ以外の場所では、`stack` は子にある分の場所しか与えないので、長さが内容に左右されるページ（ライブラリ、フィード）は `scroll` に入れます。
- `text`：`text` / `textKey`、`variant`（`title`、`headline`、`body`、`caption`、`muted`、`display`、`mono`）、`lines`（n 行で切り詰め）、`selectable`、またはリッチテキスト用の `runs`：`[{ text, bold, italic, underline, strike, code, color, link }]`。`link` を持つ run をクリックすると、`href` を運ぶ `link` イベントが発行されます。自動的に開かれるものはありません。
- `button`：`label` / `labelKey`、`variant`（`primary`、`danger`、`plain`、`tinted`）、`shape`（`circle`、`pill`）、`icon`、`iconSize`、`iconTint`（単色のグリフをボタンのテキスト色で描き、テーマと `color` に従わせる）。
- `input`：`value`、`placeholder` / `placeholderKey`、`inputType`（`text`、`number`、`password`、`search`、`email`、`url`）、`maxLength`、`readOnly`、`selectionEvents`。
- `textarea`：`value`、`placeholder`、`rows`、`maxLength`、`readOnly`、`selectionEvents`。後述の *テキストの選択* を参照。
- `switch`、`checkbox`：`checked`、`label` / `labelKey`。
- `slider`：`min`、`max`、`step`、`value`。`progress`：`max`、`value`（`value` を省くと不確定表示）。
- `select`、`segmented`：`options`（文字列または `{ value, label, labelKey }`）、`value`。
- `list`：`items`（`{ id, title, titleKey, subtitle, detail, badge, icon, disabled, emphasis, indent, disclosure, header, menu }`）、`iconSize`。`header: true` は選択できないセクションの見出しを作り、`indent` は行を入れ子にし、`disclosure`（`open` / `closed`）はフォルダの開閉用の山形を描き（クリックすると行を選択する代わりに `disclose` を発行）、`menu` は 1 つの行に専用の右クリックメニューを与え、`drag: false` / `drop: false` は行をドラッグの対象 / ドロップ先の対象から外します。`children` を持つ行はリストをアウトラインにし、`sections` はタイトルの下にグループ化します — *アウトラインとセクション* を参照。
- `table`：`columns`（`{ id, title, titleKey, width, align, sortable, muted }`、`width` は px、`"Nfr"`、または `"auto"`）、`rows`（`{ id, cells: { columnId: text }, icon, emphasis, disabled }`）、`sort`（`{ column, direction }`）、`header`、`striped`。
- `list` と `table` の共通：`value`（選択された id）、`multiple` + `values`（⌘ / ⇧ クリックでの複数選択）、`reorderable`（行を新しい位置へドラッグ）、`draggable` + `dropTarget`（行を別のリストの行の上へドラッグ — *リスト間のドラッグ* を参照）、`itemMenu`（行の右クリックメニュー）、`rowHeight`、`placeholder`（空のときに表示）、`scrollEvents`、`plain`（枠も背景もなし — サイドバー）、`insetBottom`（最後の行の下の、追加でスクロールできる余白。例えば浮かぶバーの下）。最大 20 000 行。ページに存在するのは見えている行だけなので、長いコレクションでも速さが保たれます。サイズを明示しないと、最大 12 行を表示し、それを超える分はスクロールします。
- `image`：`src`、`alt`、`fit`（`contain` / `cover`）。`click` を発行します。
- `canvas`：`commands` — ディスプレイリスト（後述）。`pointer: true` でポインタイベントを受け取ります。
- `html`：`html`、`css` — 静的なリッチコンテンツ（後述）。
- `separator`：`vertical`。

### キャンバス

`canvas` ノードは、それぞれ `[name, ...args]` の形をしたコマンドのリストを描きます。解像度に依存しません。座標は CSS px で、ホストがデバイスピクセル比を処理し、サイズ変更とテーマ変更のときに描き直します。

```js
await macos.ui.patch('chart', { commands: [
  ['fillStyle', 'accent'], ['fillRect', 10, 40, 24, 80],
  ['strokeStyle', 'secondary'], ['lineWidth', 1], ['beginPath'], ['moveTo', 0, 120], ['lineTo', 300, 120], ['stroke'],
  ['fillStyle', 'text'], ['font', 12, 'semibold'], ['textAlign', 'center'], ['fillText', 'Mon', 22, 136],
  ['drawImage', 'blob:' + fileId, 200, 10, 64, 64]
] });
```

状態：`fillStyle`、`strokeStyle`、`lineWidth`、`globalAlpha`、`font`（サイズ、ウェイト、`system` / `mono` / `rounded`）、`textAlign`、`textBaseline`、`lineCap`、`lineJoin`、`setLineDash`、`shadow`（色、ぼかし、x、y）、`save`、`restore`、`translate`、`scale`、`rotate`、`clip`。
描画：`fillRect`、`strokeRect`、`clearRect`、`beginPath`、`moveTo`、`lineTo`、`rect`、`roundRect`、`arc`、`ellipse`、`quadraticCurveTo`、`bezierCurveTo`、`closePath`、`fill`、`stroke`、`fillText`、`strokeText`、`drawImage`。

`pointer: true` のとき、ノードは `pointerdown`、`pointermove`（ボタンが押されている間。フレームごとに 1 回）、`pointerup` を発行し、それぞれキャンバスからの相対位置 `x`、`y` を持ちます。

### 静的な HTML

`html` ノードは、パッケージが提供する、または生成したマークアップ — Markdown のプレビュー、記事の本文、整形されたヘルプ — を、スクリプトを実行できず、ネットワークから何も読み込めないサンドボックス化されたフレームの中に描画します。`<script>`、フレーム、フォーム、イベント属性は取り除かれます。画像は `data:` URL でなければなりません。リンクは働きません（クリックできるリンクが必要なときは、`runs` を持つ `text` を使ってください）。フレームは自分でスクロールするので、ノードに `height` または `grow` を与えてください。

ほとんどがネイティブなアプリが、アプリ全体を Web ランタイムに切り替えずに自由形式の領域を得る方法がこれです。

### 再利用できるスタイル

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

スタイルは名前の付いたプロパティの集まりで、ノード自身のプロパティが優先されます。実行時には `macos.ui.defineStyles({ … })` でさらに追加できます。

### イベント

```js
macos.on('ui', ({ id, event, value, values, checked, itemId, menuId }) => {
  // click                     button、image、id を持つ text
  // input, change             input、textarea、slider、select、switch、checkbox、segmented
  // submit                    input で Enter が押された
  // focus, blur               input、textarea
  // select, activate          list / table：選択が変わった / 行がダブルクリックされた、または Enter（itemId）
  // reorder                   list / table：行がドラッグされたあとの { itemId, index, order }
  // rowdrop                   dropTarget を持つ list / table：{ itemId, position, index, parentId, sectionId, sourceId, items }
  // expand                    list（アウトライン）：行が開かれた、または閉じられた（{ itemId, expanded, expandedIds }）
  // section                   list（セクション）：折りたためるセクションが畳まれた（{ sectionId, collapsed, collapsedIds }）
  // disclose                  list：`disclosure` を持つ行の山形がクリックされた（{ itemId }）
  // sort                      table：{ column, direction } — その順序で行を渡し直す
  // menu                      contextMenu / itemMenu の選択：{ menuId, itemId? }
  // link                      リンクを持つ text run：{ href }
  // reachend, scroll          scroll / list / table：末尾の近く。位置（scrollEvents と併用）
  // hoverstart, hoverend      hover: true を持つ任意のノード
  // pointerdown / move / up   pointer: true を持つ canvas
});
```

イベントはコントロールの現在の `value` / `values` / `checked` を運ぶので、別途 `macos.ui.get()` が必要になることはほとんどありません。

キーボード入力は、アプリのウインドウがフォーカスを持つ間、転送されます。

```js
macos.on('keydown', ({ key, code, altKey, ctrlKey, metaKey, shiftKey, repeat, editing, targetId }) => {});
macos.on('keyup', (detail) => {});
```

`editing` は、キーが `input` / `textarea` に入力されたときに `true` です。テキストフィールドの外では、スペース、矢印、Enter、Backspace、Tab に対するページのデフォルト動作をホストがすでに抑えているので、アプリはそれらを自由に使えます。AppKit と同じく、ボタンをクリックしてもキーボードフォーカスはそこに移りません。

ユーザのデスクトップからウインドウにドラッグされたファイル（権限 `files`）は、まず保存されてから通知されます。

```js
macos.on('drop', ({ files, rejected, targetId, itemId, x, y }) => {
  // files: [{ id, name, type, size, duration?, width?, height? }] — すでに macos.files にある
});
```

ファイルが多いと保存に時間がかかります（それぞれ調べられ、タグが読まれ、書き込まれます）。ホストはドロップや `openFile({ store: true })` の選択を処理している間、進捗を報告します。最初は `done: 0`、最後は `done === total` なので、アプリはプログレスバーを表示できます。

```js
macos.on('fileprogress', ({ source, done, total, name }) => {});   // source: 'drop' | 'picker' | 'export'（macos.archive.create。エントリを 1 つ詰めるごとに 1 ステップ）
```

リストの行は `tint: true` を持てます。その場合、行の `icon` は単色のグリフとして扱われ、画像として表示される代わりにアクセントカラー（選択された行では白）で描かれます。

### テキストの選択

`input` や `textarea` のすべてのイベント、そして `macos.ui.get(id)` は、選択範囲を運びます：`selectionStart`、`selectionEnd`、`selectionDirection`、`selectionText`。`selectionEvents: true` にすると、キャレットや選択範囲が動くたびに、コントロールは `selection` イベントも送ります。

```js
const { selectionText } = await macos.ui.get('body');
await macos.ui.replaceSelection('body', `**${selectionText}**`, { select: 'all' });   // 'end'（デフォルト）| 'start' | 'all'
await macos.ui.setSelection('body', { start: 120, end: 131 });                           // 見える位置までスクロールする。reveal: false でビューを動かさない
```

`replaceSelection` はブラウザ自身の編集機能を通じてテキストを入力するので、⌘Z で、ユーザが入力したものと同じように取り消せます。テキストコントロールでの取り消しとやり直し（⌘Z、⇧⌘Z）、カット、コピー、ペースト、すべて選択はブラウザのもので、ホストが横取りすることは決してありません。長いテキスト内の検索は、`value.indexOf()` と `setSelection()` の組み合わせです。

**ペースト。** `paste` を待ち受けるアプリケーションには、⌘V が何を運んできたかが伝えられます。

```js
macos.on('paste', ({ id, types, files, text }) => {
  // files：ペーストされたファイル（コピーした画像、スクリーンショット）— すでに macos.files にあり、フィールドに入力されることはない
  // text： テキストコントロールがフォーカスを持っていなかったときだけ。フォーカスのあるコントロールには、テキストがそのまま入る
});
```

ペーストされたファイルの保存には `files` 権限が必要です。`paste` リスナーがなければ、ホストはペーストについて何もしません。

### リスト間のドラッグ

ソースに `draggable: true` を、ドロップ先に `dropTarget: true` を与えます。選択された 1 つ以上の行をドロップ先の行の上にドラッグするとその行が強調表示され、離すと **ドロップ先に** `rowdrop` が発行されます。ターゲット行の `itemId`、`sourceId` としてソースリストの id、`items` としてドラッグされた行の id が付きます。何も勝手には動きません — 状態を更新して描画してください。

```js
macos.on('ui', ({ id, event, itemId, sourceId, items }) => {
  if (id === 'sidebar' && event === 'rowdrop' && sourceId === 'songs') addToPlaylist(itemId, items);
});
```

リストは両方を兼ねられます（同じリストの別の行の上に行をドラッグする。例えばプレイリストをフォルダへ）。`reorderable` なリストの中では、リスト内のドラッグは並べ替えになり、そこから `dropTarget` の上へドラッグして出すとドロップになります。

**行の間へのドロップ。** デフォルトでは、ドロップは行の *上* に落ちます。`dropPosition: 'between'` にすると、ドロップ先は代わりに隙間でドロップを受け取り、挿入線として表示されます。`'both'` はどちらも受け付けます（行の中央の半分が「上」、上下の 4 分の 1 ずつが隙間）。このとき `rowdrop` は場所も伝えます。

| フィールド | 意味 |
| --- | --- |
| `position` | 行 `itemId` に対して `'on'`、`'before'`、`'after'` |
| `index` | ドロップ先の見えている行の中で、行が入る位置（0 = 先頭） |
| `parentId` | アウトラインの場合：それらが子になる行（最上位では `''`） |
| `sectionId` | セクション付きリストの場合：それらが入るセクション |

開いているアウトライン行の下では、隙間はその最初の子の `'before'` として報告されるので、`parentId` はその行になります。空のリストは `itemId: ''`、`index: 0` を報告します。セクションのタイトルは、`position: 'on'`、`itemId: ''` とその `sectionId` でドロップを受け取ります。

外からドラッグしてきたファイルは、`dropTarget` のリスト上で同じルールに従います。ホバー中は挿入線が表示され、`drop` イベントは `targetId` / `itemId` に加えて、同じ `position`、`index`、`parentId`、`sectionId` を運びます。

### アウトラインとセクション

**アウトライン（ツリー）。** 行に `children` を与えると、リストはそれらをツリーとして描きます。インデント、山形、そしてキーボードの ← / →（→ は行を開くか中へ入り、← は閉じるか親へ出ます）。最大 8 階層。入れ子の行は 20 000 行の上限に数えられます。

```js
{ type: 'list', id: 'tree', expanded: ['src'], items: [
  { id: 'src', title: 'src', icon: folder, children: [
    { id: 'src/main.js', title: 'main.js' },
    { id: 'src/lib', title: 'lib', expandable: true }      // 子は開かれたときに渡す
  ] },
  { id: 'README.md', title: 'README.md' }
] }

macos.on('ui', ({ id, event, itemId, expanded, expandedIds }) => {
  if (id === 'tree' && event === 'expand' && expanded && !loaded.has(itemId)) loadChildren(itemId);   // そのあと描画
});
```

ホストは行を自分で開閉し、何が開いているかを描画をまたいで覚えています。`expand` はそれを知らせるだけです（再起動後も残したいなら `expandedIds` を保存してください）。自分で設定するには `expanded` を渡します。`expandable: true` は、子をまだ読み込んでいない行に山形を表示します。選択を含む行を閉じると、選択はその行に移ります。`indent` / `disclosure` だけを使う行はこれまでどおり動き、`disclose` を発行します。

**セクション。** `sections` は `items` を、タイトル付きのグループに置き換えます。読んでいるグループのタイトルは、その行が下をスクロールする間、リストの上端に固定されます（`stickyHeaders: false` でオフ）。`collapsible: true` のセクションは、タイトルをクリックすると畳まれます。

```js
{ type: 'list', id: 'songs', sections: [
  { id: 'a', title: 'A', detail: '12', collapsible: true, items: [...] },
  { id: 'b', title: 'B', detail: '7', collapsible: true, items: [...] }
] }
// 'section' { sectionId, collapsed, collapsedIds } — ノードの `collapsed` で、こちら側から設定する
```

セクションの id は、リストの行の id と同じ空間を共有します（行の id と重ならないようにしてください）。セクションはアウトラインの行を持てます。

アウトラインとセクション付きリストは `reorderable` を無視します。そこでは平坦な位置では情報が足りないからです。行の移動には `draggable` + `dropTarget` + `dropPosition: 'between'`（または `'both'`）を使い、`rowdrop` の `parentId` / `sectionId` / `index` を使ってください。

### UI の更新

最も単純なモデルは宣言的なものです。状態を JavaScript に持ち、インターフェイス全体をその関数として記述します。

```js
const view = () => ({ type: 'stack', id: 'root', children: items.map((item) => ({ type: 'text', id: `row:${item.id}`, text: item.title })) });
await macos.ui.render(view());   // 状態が変わるたびにもう一度呼ぶ
```

`render()` は新しいツリーを画面にあるものと比較し、違うところだけを変更します。子は `id` で（id がなければ位置と種類で）対応づけられるので、テキストフィールドはフォーカスとキャレットを保ち、スクロール位置とメディアは保存され、変わっていないノードは作り直されません。ユーザが入力中のフィールドは、状態がキー入力 1 つ分遅れていても、自身のテキストを保ちます。

必要なら、的を絞った更新もできます。

```js
macos.ui.patch('value', { text: '42', color: 'accent' });        // 任意のプロパティ。null で取り除く
await macos.ui.append('rows', { type: 'text', text: 'New row' });  // 省略可能な第 3 引数：index
await macos.ui.setChildren('rows', [/* ノード */]);                // render() と同じように差分をとる
await macos.ui.replace('row-3', { type: 'card', id: 'row-3', children: [] });
await macos.ui.remove('row-3');
await macos.ui.focus('field');
await macos.ui.scrollTo('songs', { itemId: 'song-42' });           // または { top: 0 }
const state = await macos.ui.get('field');                         // { value, checked, disabled } / { value, values } / { text }
const choice = await macos.ui.showMenu([{ id: 'a', label: 'First' }, { separator: true }, { id: 'b', label: 'Second', danger: true }]);
```

`submenu` を持つメニュー項目 — 同じ形のリストで、深さは 2 階層まで — は、選択肢になる代わりに、横にさらにメニューを開きます：`{ label: 'Size', submenu: [{ id: 'size:small', label: 'Small', checked: true }, …] }`。ステータス項目のメニューでも同じです。

同じ tick で行われた `patch()` の呼び出しは 1 つのメッセージとしてホストに送られるので、多くのコントロールを一度に更新しても往復は 1 回で済みます。

ツリーは、厳格モードで 2 000 ノード（それ以外では 8 000）に制限されます。長いコレクションは、ノードとして数えられない `list` / `table` の行に入れてください。

## 6. Web App 用ネイティブ UI スタイルシート

Web App は次のものを自動的に読み込みます。

```text
plugin/sdk/native-ui.css
```

システムトークンに基づく、次のような基本部品を提供します。

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

役に立つ変数には次のものがあります。

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

これらは **内側の半透明マテリアル** であり、独立したウインドウ全面の背景サンプラーではありません。
