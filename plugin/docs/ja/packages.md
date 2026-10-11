[English](../packages.md) · [简体中文](../zh-CN/packages.md) · **日本語**

# パッケージとリソース

アプリケーション SDK ドキュメントの一部です — [README](../../README.ja.md) から読み始めてください。

## 2. `macos-app-package-v3`

パッケージは 1 つの JSON ファイルとして読み込まれます。

```json
{
  "format": "macos-app-package-v3",
  "id": "example-app",
  "name": "Example",
  "version": "1.0.0",
  "kind": "app",
  "runtime": "web",
  "description": "Example application",
  "icon": "assets/icon.png",
  "permissions": ["storage", "menu"],
  "window": {
    "width": 620,
    "height": 480,
    "minWidth": 360,
    "minHeight": 260,
    "resizable": true,
    "appearance": "system",
    "material": "glass",
    "titlebarHeight": 36,
    "borderRadius": 13,
    "showTitle": true
  },
  "entry": {
    "html": "src/index.html",
    "css": ["src/base.css", "src/app.css"],
    "script": "src/main.js"
  },
  "locales": {
    "en-US": "locales/en-US.json",
    "zh-CN": "locales/zh-CN.json"
  },
  "files": {
    "src/index.html": { "mime": "text/html", "text": "<main>...</main>" },
    "src/base.css": { "mime": "text/css", "text": "..." },
    "src/app.css": { "mime": "text/css", "text": "..." },
    "src/main.js": { "mime": "text/javascript", "text": "..." },
    "locales/en-US.json": { "mime": "application/json", "text": "{\"hello\":\"Hello\"}" },
    "assets/icon.png": { "mime": "image/png", "base64": "..." }
  }
}
```

`files` はアプリケーションの仮想ディレクトリです。パスは相対パスで、パッケージのルートの外に出ることはできません。テキストファイルは `text` を、バイナリファイルは `base64` に Base64 を使います。

アイコンは `assets/icon.png` のようなパッケージ内のパスで構いません。data URL としてマニフェストに直接書き込む必要はありません。インストール時にホストがランチャー用の小さなコピーを作り、元のリソースはパッケージのストレージに残します。

### Native App のエントリ

Native App は Web のエントリを次のものに置き換えます。

```json
{
  "runtime": "native",
  "entry": {
    "ui": "src/ui.json",
    "script": "src/main.js"
  }
}
```

目に見える UI は `src/ui.json` で宣言し、スクリプトは状態とイベントだけを扱います。

`entry.script` はファイルのリストにすることもできます。それらはその順番で **1 つのスクリプト** として実行されます — スコープは 1 つなので、前のファイルの `const` や関数は後のファイルでそのまま使えますし、トップレベルの `await` も単一ファイルのときと同じように動きます。

```json
"script": ["src/state.js", "src/views.js", "src/playback.js", "src/main.js"]
```

これは大きなアプリケーションを読みやすく保つためのものです（「ミュージック」と「ブック」はこのように分割されています）。サイズの上限はファイル全体の合計に適用されます。

---

## 3. パッケージのリソース

### HTML/CSS の相対リソース

`src/index.html` の中で：

```html
<img src="../assets/photo.webp" alt="">
```

`src/app.css` の中で：

```css
.hero { background-image: url("../assets/photo.webp"); }
```

インストーラがパッケージ相対の参照を解決します。アセットのバイト列はホスト側に留まり、参照されたときにだけ、実行中のサンドボックスへ遅延して渡されます。

### 実行時のアセットアクセス

```js
const url = await macos.assets.url('assets/photo.webp');
const allPaths = macos.assets.list();
```

使われていないパッケージのアセットが、アプリケーションが開かれたというだけで実行時 URL に変換されることはありません。
