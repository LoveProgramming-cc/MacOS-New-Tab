**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

# macOS New Tab Plugin / Application SDK — Public Beta 0.6.2

Public Beta 0.6.2 has two extension package families:

- `kind: "app"` — an executable application that opens in a managed macOS-style window.
- `kind: "limit-overlay"` — a declarative Web Time Management limit overlay.

Applications are installed from **one JSON file** in **Settings → Applications**, or by dropping that file onto the desktop. The JSON represents a virtual directory tree, so an application can contain HTML, CSS, JavaScript, JSON, SVG/PNG/WebP images, fonts and other resources without requiring a real folder at import time.

## Compatibility policy for Public Beta 0

The application SDK is still in Public Beta 0 and is intentionally allowed to break while the architecture is being stabilized.

**Public Beta 0.6.2 does not accept the old inline `app.html / app.css / app.script` package layout.** Application packages must use the current `macos-app-package-v3` directory format described below. This avoids carrying compatibility branches into the runtime while the API is still changing.

This is separate from the **whole macOS New Tab settings JSON**. Older exported settings JSON remains supported by the host configuration loader: missing or invalid supported configuration fields are repaired from the current `default.json` schema.

---

## 1. Application architecture

Public Beta 0.6.2 supports two runtimes.

### Native App — recommended

```json
"runtime": "native"
```

A Native App keeps its visible UI in the host desktop DOM. The package supplies a semantic UI description (`entry.ui`) and a sandboxed JavaScript logic file (`entry.script`). The host creates the actual controls, material, typography, focus behavior and accessibility surface.

This is the preferred runtime when the app can be expressed with system controls because it provides:

- system-owned macOS visual styling;
- automatic light/dark, transparency, contrast and language integration;
- no visible iframe document tree;
- lower DOM and compositor overhead;
- consistent buttons, inputs, switches, menus and focus behavior across third-party apps;
- future SDK visual improvements without every app shipping new CSS.

Only the logic runtime remains in the sandbox.

### Web App — free-form mode

```json
"runtime": "web"
```

A Web App receives an isolated sandbox iframe and can use its own HTML/CSS layout. The host still owns the outer window, title bar, traffic-light controls, shadow and expensive wallpaper backdrop material.

Use Web App mode only when the UI genuinely needs free-form HTML/CSS that the Native App control set cannot express yet.

## Documentation

| Document | Contents |
| --- | --- |
| [Packages and resources](docs/packages.md) | 2. `macos-app-package-v3`; 3. Package resources |
| [Windows, icons, accent and materials](docs/windows.md) | 4. Window contract |
| [Native App UI](docs/native-ui.md) | 5. Native App UI; 6. Web App native UI stylesheet |
| [Runtime API](docs/api.md) | 7. Runtime API |
| [Menus, instances, security levels and Developer Tools](docs/menus-security.md) | 8. Application-specific menu bar; 9. Strict security; Unrestricted applications; Developer Tools |
| [Runtime and performance model, crash isolation](docs/runtime.md) | 10. Runtime and performance model; 11. Crash isolation |
| [Reference applications](docs/examples.md) | 12. Reference applications |
| [Tooling, limits and host behaviour](docs/host.md) | 13. Tooling; 14. Current limits; 15. Launch at startup; 16. Limit-overlay packages; 17. Public Beta 0.6.2 host behavior |
| [macos.d.ts](macos.d.ts) | TypeScript definitions of the runtime API |
