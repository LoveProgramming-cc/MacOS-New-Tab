[English](README.md) · **简体中文** · [日本語](README.ja.md)

# macOS New Tab 插件 / 应用程序 SDK — Public Beta 0.6.2

Public Beta 0.6.2 有两类扩展包：

- `kind: "app"` — 可执行的应用程序，在受系统管理的 macOS 风格窗口中打开。
- `kind: "limit-overlay"` — 声明式的“网页时间管理”限制覆盖层。

应用程序通过 **一个 JSON 文件** 安装：在 **设置 → 应用程序** 中导入，或者把这个文件拖到桌面上。这个 JSON 表示一棵虚拟目录树，所以一个应用程序可以包含 HTML、CSS、JavaScript、JSON、SVG/PNG/WebP 图片、字体和其他资源，导入时不需要真实的文件夹。

## Public Beta 0 的兼容性策略

应用程序 SDK 仍处于 Public Beta 0 阶段，在架构稳定下来之前，有意允许出现不兼容的改动。

**Public Beta 0.6.2 不接受旧的内联 `app.html / app.css / app.script` 包布局。** 应用程序包必须使用下文所述的当前 `macos-app-package-v3` 目录格式。这样在 API 仍在变化期间，运行时里不必背着兼容分支。

这与 **整个 macOS New Tab 的设置 JSON** 是两回事。较旧的导出设置 JSON 仍然受宿主配置加载器支持：缺失或无效的受支持配置字段会按当前 `default.json` 的结构修复。

---

## 1. 应用程序架构

Public Beta 0.6.2 支持两种运行时。

### Native App — 推荐

```json
"runtime": "native"
```

Native App 的可见界面位于宿主桌面的 DOM 中。包提供一份语义化的界面描述（`entry.ui`）和一个在沙盒中运行的 JavaScript 逻辑文件（`entry.script`）。实际的控件、材质、字体排印、焦点行为和无障碍界面都由宿主创建。

只要应用能用系统控件表达，就应优先选用这种运行时，因为它提供：

- 由系统负责的 macOS 视觉样式；
- 自动适配浅色/深色、透明度、对比度和语言；
- 没有可见的 iframe 文档树；
- 更低的 DOM 和合成器开销；
- 第三方应用之间一致的按钮、输入框、开关、菜单和焦点行为；
- 未来 SDK 的视觉改进无需每个应用自带新的 CSS。

只有逻辑运行时留在沙盒里。

### Web App — 自由形式

```json
"runtime": "web"
```

Web App 得到一个隔离的沙盒 iframe，可以使用自己的 HTML/CSS 布局。外层窗口、标题栏、红绿灯按钮、阴影和开销较大的壁纸背景材质仍然归宿主所有。

只有当界面确实需要 Native App 控件集暂时还表达不了的自由形式 HTML/CSS 时，才使用 Web App 模式。

## 文档

| 文档 | 内容 |
| --- | --- |
| [包与资源](docs/zh-CN/packages.md) | 2. `macos-app-package-v3`；3. 包资源 |
| [窗口、图标、强调色与材质](docs/zh-CN/windows.md) | 4. 窗口约定 |
| [Native App 界面](docs/zh-CN/native-ui.md) | 5. Native App 界面；6. Web App 原生界面样式表 |
| [运行时 API](docs/zh-CN/api.md) | 7. 运行时 API |
| [菜单、多开、安全级别与开发者工具](docs/zh-CN/menus-security.md) | 8. 应用程序专属菜单栏；9. 严格安全性；没有限制的应用程序；开发者工具 |
| [运行时与性能模型、崩溃隔离](docs/zh-CN/runtime.md) | 10. 运行时与性能模型；11. 崩溃隔离 |
| [参考应用程序](docs/zh-CN/examples.md) | 12. 参考应用程序 |
| [工具、限制与宿主行为](docs/zh-CN/host.md) | 13. 工具；14. 当前限制；15. 启动时打开；16. 限制覆盖层包；17. Public Beta 0.6.2 宿主行为 |
| [macos.d.ts](macos.d.ts) | 运行时 API 的 TypeScript 类型定义 |
