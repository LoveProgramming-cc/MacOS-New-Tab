**English** · [简体中文](zh-CN/runtime.md) · [日本語](ja/runtime.md)

# Runtime and performance model, crash isolation

Part of the application SDK documentation — start at [README](../README.md).

## 10. Runtime and performance model

The SDK is designed around the rule that an installed-but-closed app should have effectively zero ongoing rendering cost.

### Installation-time work

Application import performs validation, sanitization and compilation. The compiled package is cached separately from the desktop configuration. Opening an installed app normally does not repeat package sanitization.

### Lazy assets

Large asset payloads are stored separately and requested only when referenced. A package with many images does not automatically decode or transfer them all at application startup.

### Private runtime channel

Each running application receives a dedicated `MessageChannel`. The global `window.message` listener is used only for sandbox bootstrap; normal API traffic uses the private port.

### Host-owned window compositor

Managed windows use one host glass layer. During a window drag:

- movement is driven by pointer capture;
- visual motion uses one `translate3d()` update per animation frame;
- final `left/top` geometry is committed when the drag ends;
- plugin iframes temporarily stop receiving pointer input so crossing one cannot swallow the host drag;
- plugin CSS animations/transitions pause;
- application windows keep the same frosted glass as system windows while they move;
- a drag only begins once the pointer has moved a few pixels, so a plain click on a title bar changes nothing.

### Visibility suspension

Apps receive visibility changes. Strict-mode intervals do not continue high-frequency work while the app is hidden/minimized.

### Author guidance

For smooth apps:

- prefer `runtime: "native"` whenever possible;
- animate `transform` and `opacity`, not layout properties or large filters;
- do not create nested full-surface backdrop blur layers;
- use event-driven updates instead of permanent polling timers;
- update existing DOM/control state instead of destroying and rebuilding whole views;
- resize packaged raster images to realistic display sizes;
- pause custom rendering while invisible or during host window drags;
- batch Native UI changes with `macos.ui.batch()` when several controls change together.

---

## 11. Crash isolation

App logic runs inside `plugin/app-runtime.html`, separate from the main new-tab JavaScript context. An uncaught error or unhandled rejection is reported to the host. The host tears down the failing runtime and presents a reload state in that app window.

A broken application therefore cannot leave its failed sandbox timers and animations running indefinitely, and does not terminate the desktop shell or other apps.
