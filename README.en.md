[简体中文](README.md) · **English**

# MacOS New Tab

Replaces Chrome's new tab page with a macOS-style desktop: Dock, Launchpad, menu bar, Spotlight, widgets, Finder, System Settings, and a sandboxed application system that third-party apps can be installed into.

Current version: **Public Beta 0.6.2**. Release Candidate 0.7.x and a stable 1.x are planned. During the beta, the application SDK is not kept compatible between versions.

> This is an unofficial web implementation of the macOS interface, for learning and research only. It is not affiliated with Apple Inc.; Apple, macOS and related marks are trademarks of Apple Inc.

## Features

- **Desktop**: wallpaper (light/dark, daily Bing wallpaper), desktop icons, Dock, Launchpad, menu bar, Spotlight, Notification Center, Mission Control.
- **Windows**: drag, resize, edge tiling, minimise into the Dock, frosted-glass material.
- **System apps**: Finder, System Settings, About This Mac, Web Time Management.
- **Widgets**: on the desktop and in the widget centre; applications can offer their own.
- **Application system**: an app installs from one JSON file, runs in a sandbox, and reaches storage, files, audio, network, notifications and more through permissions. The bundled examples are Music, Books, Calculator, the desktop pet "Hoshino", the desktop weather "Outside" and "Paper Plane".
- **Developer Tools**: load and hot-reload an app from a folder, console, interface inspector, storage browser, record and replay, Task Manager, Performance Monitor.
- **Languages**: 简体中文, English, 日本語, 한국어, العربية (with right-to-left layout).

## Installation

For now it installs as an unpacked extension:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome and switch on "Developer mode".
3. Click "Load unpacked" and choose the root of this repository.
4. Open a new tab.

The example applications are in `plugin/examples/`, ending in `.macos-app.json`. Import them in Settings → Applications, or drop the file onto the desktop.

## Writing applications

The application SDK is documented in three languages:

- [English](plugin/README.md)
- [简体中文](plugin/README.zh-CN.md)
- [日本語](plugin/README.ja.md)

Type definitions are in [plugin/macos.d.ts](plugin/macos.d.ts); the packer is `plugin/tools/pack.py`.

## Use of AI

Most of the code, documentation and tests in this project were written by several AI coding assistants, working from the author's requirements, round-by-round review and feedback from real use. The author is responsible for the design, the decisions and the acceptance of the result.

Two things to be aware of:

- The Japanese, Korean and Arabic interface text and documentation were translated by AI and have not been reviewed by native speakers. Corrections are welcome.
- Some features were verified only in an automated test environment, not on a range of real devices.

## Credits and origin

This project refers to and adapts source code from the following projects, both released under GPL-3.0:

- [Mengobs/Webintosh](https://github.com/Mengobs/Webintosh)
- [Mengobs/Webintosh-Desktop](https://github.com/Mengobs/Webintosh-Desktop)

Thanks to the original author Mengobs and contributors. Since 2026 this repository has modified and extended that work substantially — turning it into a Chrome extension, rewriting window management, adding the application system and Developer Tools, among others; the commit history records the changes.

## License

Released under the [GNU General Public License v3.0](LICENSE).

Copyright © 2026 koen
Portions derived from Webintosh / Webintosh-Desktop remain the copyright of their original authors.

You may use, modify and redistribute this project, provided that redistribution is also under GPL-3.0 with complete source code and keeps the copyright and origin notices above.

### Material not covered by the GPL

Some material in this repository does not belong to the author, and the GPL grants no rights to it:

- **Apple's material**: the macOS wallpapers, application icons and Finder icons under `assets/`, and the SF Pro and PingFang SC fonts, are the property of Apple Inc.
- **The "Hoshino" desktop pet**: the character in `plugin/examples/hoshino-pet/` is from Blue Archive, © NEXON Games and Yostar. It is an unofficial fan-made example.

They are included for learning and demonstration only. Replace them before redistributing or using this project commercially. Rights holders who object can open an issue and the material will be removed.
