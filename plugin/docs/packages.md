**English** · [简体中文](zh-CN/packages.md) · [日本語](ja/packages.md)

# Packages and resources

Part of the application SDK documentation — start at [README](../README.md).

## 2. `macos-app-package-v3`

A package imports as one JSON file:

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

`files` is the virtual application directory. Paths are relative and may not escape the package root. Text files use `text`; binary files use Base64 in `base64`.

The icon may be a package path such as `assets/icon.png`. It does not need to be hard-coded into the manifest as a data URL. During installation the host creates a small launcher copy while keeping the original resource in package storage.

### Native App entry

A Native App replaces the Web entry with:

```json
{
  "runtime": "native",
  "entry": {
    "ui": "src/ui.json",
    "script": "src/main.js"
  }
}
```

The visible UI is declared by `src/ui.json`; the script only handles state and events.

`entry.script` may also be a list of files. They are run in that order as **one script** — one scope, so a `const` or function of an earlier file is simply there in a later one, and top-level `await` works as in a single file:

```json
"script": ["src/state.js", "src/views.js", "src/playback.js", "src/main.js"]
```

This is for keeping a large application readable (Music and Books are split this way); the size limit applies to the files together.

---

## 3. Package resources

### Relative HTML/CSS resources

Inside `src/index.html`:

```html
<img src="../assets/photo.webp" alt="">
```

Inside `src/app.css`:

```css
.hero { background-image: url("../assets/photo.webp"); }
```

The installer resolves package-relative references. Asset bytes stay host-side and are supplied lazily to the running sandbox only when referenced.

### Runtime asset access

```js
const url = await macos.assets.url('assets/photo.webp');
const allPaths = macos.assets.list();
```

Unused package assets are not converted to runtime URLs simply because an application was opened.
