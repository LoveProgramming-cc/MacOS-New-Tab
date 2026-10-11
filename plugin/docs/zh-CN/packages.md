[English](../packages.md) · **简体中文** · [日本語](../ja/packages.md)

# 包与资源

应用程序 SDK 文档的一部分 — 请从 [README](../../README.zh-CN.md) 开始阅读。

## 2. `macos-app-package-v3`

一个包以一个 JSON 文件的形式导入：

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

`files` 是应用程序的虚拟目录。路径是相对路径，不能逃出包的根目录。文本文件使用 `text`；二进制文件使用 `base64` 中的 Base64。

图标可以是 `assets/icon.png` 这样的包内路径，不需要以 data URL 的形式硬编码在清单里。安装时宿主会生成一份小尺寸的启动器副本，原始资源仍保留在包存储中。

### Native App 入口

Native App 把 Web 入口换成：

```json
{
  "runtime": "native",
  "entry": {
    "ui": "src/ui.json",
    "script": "src/main.js"
  }
}
```

可见界面由 `src/ui.json` 声明；脚本只处理状态和事件。

`entry.script` 也可以是一个文件列表。这些文件按顺序作为 **一个脚本** 运行 — 同一个作用域，所以前面文件里的 `const` 或函数在后面的文件里直接可用，顶层 `await` 也和单个文件时一样可用：

```json
"script": ["src/state.js", "src/views.js", "src/playback.js", "src/main.js"]
```

这是为了让大型应用程序保持可读（“音乐”和“图书”就是这样拆分的）；大小限制按这些文件合计计算。

---

## 3. 包资源

### HTML/CSS 中的相对资源

在 `src/index.html` 中：

```html
<img src="../assets/photo.webp" alt="">
```

在 `src/app.css` 中：

```css
.hero { background-image: url("../assets/photo.webp"); }
```

安装器会解析相对于包的引用。资源的字节留在宿主一侧，只有在被引用时才按需提供给正在运行的沙盒。

### 运行时访问资源

```js
const url = await macos.assets.url('assets/photo.webp');
const allPaths = macos.assets.list();
```

未使用的包资源不会仅仅因为应用程序被打开就被转换成运行时 URL。
