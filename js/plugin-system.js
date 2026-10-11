import { bindPaste } from './plugin-links.js';
import { state } from './state.js';
import { saveConfig } from './config.js';
import { layoutDirection, t } from './i18n.js';
import { $, createElement } from './utils.js';
import { showMacAlert } from './dialog.js';
import { createButton } from './ui-kit.js';
import { devFlag, extraFeaturesDisabled, reduceTransparencyEnabled, transparentGlassEnabled } from './developer.js';
import { bringManagedWindowToFront, beginManagedWindowDrag, minimizeManagedWindow, registerManagedWindow, toggleZoomManagedWindow, unregisterManagedWindow } from './window-manager.js';
import { bindApplicationMenu } from './app-menu.js';
import { accentHex, applicationAccentHex, hexToRgbList, systemAccentSetting } from './accent.js';
import { createNativeRenderer, showNativeMenu } from './plugin-native-ui.js';
import { openRequestedNotification, setNotificationActivator } from './notifications.js';
import { dev, devEmit, devOverride, devPreview } from './dev-hooks.js';
import { APP_ASSET_INDEX_PREFIX, CHANNEL_APP, CHANNEL_HOST, NATIVE_NODE_LIMIT } from './plugin-constants.js';
import { announceRunningApps, appAppearance, appLanguage, appOpenPromises, appStrict, appTheme, appWindows, appZoom, applicationUnrestricted, applyWindowAppearance, canOpenAnotherInstance, closePluginApp, frontInstance, instanceKey, instanceStorageId, instancesOf, multiInstanceAllowed, permissionAllowed, postToPlugin, postWhenReady, showPluginWindows } from './plugin-core.js';
import { compiledForPlugin, deletePackageForPlugin, imageSourceKind, nativeTranslate, pluginState, sanitizeCss, sanitizeHtml, storageGet } from './plugin-package.js';
import { addPluginLauncher, appIcon, importApplicationPlugin, importLimitOverlayPlugin, permissionLabel } from './plugin-install.js';
import { bindFileDrop, dragHasFiles, resolveImageSource, runtimeHasImageAsset } from './plugin-files.js';
import { applySubtitleAppearance, clearSubtitles, ensureAudio, retireMedia, stopFade, subtitleOverlay } from './plugin-media.js';
import { bindScreenChanges, forgetWindowMotion } from './plugin-window-motion.js';
import { announcePeer, forgetDesktopWatcher } from './plugin-desktop.js';
import { activateNotification, handleApplicationShortcut, removeStatusItem } from './plugin-integration.js';
import { FRAME_BUDGET_MS, handleAppRequest } from './plugin-requests.js';
import { pinApplicationToDock, pinnedInDock, renderApplicationManager, renderPluginManager, unpinApplicationFromDock } from './plugin-settings.js';
import { applyAppZoom } from './plugin-devapi.js';

export * from './plugin-constants.js';
export * from './plugin-core.js';
export * from './plugin-links.js';
export * from './plugin-package.js';
export * from './plugin-install.js';
export * from './plugin-files.js';
export * from './plugin-media.js';
export * from './plugin-integration.js';
export * from './plugin-widgets.js';
export * from './plugin-requests.js';
export * from './plugin-settings.js';
export * from './plugin-devapi.js';
export * from './plugin-data.js';

let pluginMessageBound = false;
function renderNativeAppUI(record) {
    const ui = record.runtimeApp?.ui;
    if (!record?.nativeFrame || !ui?.root) return;
    record.nativeUi = createNativeRenderer({
        frame: record.nativeFrame,
        tree: structuredClone(ui.root),
        styles: structuredClone(ui.styles || {}),
        maxNodes: applicationUnrestricted(record.plugin) ? 1_000_000 : appStrict(record.plugin) ? NATIVE_NODE_LIMIT.strict : NATIVE_NODE_LIMIT.relaxed,
        validSource: (value) => { const kind = imageSourceKind(value); return kind === 'asset' ? runtimeHasImageAsset(record, value) : Boolean(kind); },
        sanitizeHtml: (html) => sanitizeHtml(html, { strict: true, files: null }),
        sanitizeCss: (css) => sanitizeCss(css, { strict: true, files: null }),
        translate: (key, fallback) => nativeTranslate(record, key, fallback),
        resolveSource: (value) => resolveImageSource(record, value),
        // A `video` node shows the app's media player (macos.audio). The element is only
        // ever moved between the node and a hidden holder, so playback never stops.
        attachMedia: (container) => { if (!permissionAllowed(record.plugin, 'audio')) return; const media = ensureAudio(record); if (media.parentNode !== container) container.appendChild(media); subtitleOverlay(record); },
        detachMedia: (container) => { const media = record.audio; if (media && record.mediaPark && (!container || media.parentNode === container)) { record.mediaPark.appendChild(media); subtitleOverlay(record); } },
        // Transitions are the host's: the Developer switch that turns animation off turns these off too.
        motion: () => !devFlag('disableAnimations'),
        emit: (detail) => postToPlugin(record, { type: 'event', name: 'ui', detail })
    });
}
export function refreshNativeTranslations(record) {
    record?.nativeUi?.refresh();
}
export function isEditableTarget(target) {
    return Boolean(target?.closest?.('input:not([type="checkbox"]):not([type="range"]),textarea,select,[contenteditable="true"]'));
}
// Native apps have no document of their own, so the host forwards keyboard input that
// happens while the app window has focus.
function bindNativeKeyboard(record) {
    const { window: win, nativeFrame } = record;
    if (!nativeFrame) return;
    nativeFrame.tabIndex = -1;
    win.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.plugin-app-controls') || isEditableTarget(event.target)) return;
        requestAnimationFrame(() => { if (!win.contains(document.activeElement) || !isEditableTarget(document.activeElement)) nativeFrame.focus({ preventScroll: true }); });
    });
    const forward = (name) => (event) => {
        if (event.isComposing) return;
        const editing = isEditableTarget(event.target);
        // Plain keys belong to the app; combinations with ⌘/Ctrl stay available to the
        // desktop (Spotlight shortcut, application menu shortcuts).
        if (!event.metaKey && !event.ctrlKey) {
            event.stopPropagation();
            if (!editing && (event.key === ' ' || event.key.startsWith('Arrow') || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Tab')) event.preventDefault();
        }
        postToPlugin(record, { type: 'event', name, detail: {
            key: event.key, code: event.code, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
            repeat: event.repeat, editing, targetId: record.nativeUi?.idForElement(event.target) || ''
        } });
    };
    // A click inside an `html` node moves focus into that frame, where the host — and so
    // the app — hears no keys. Focus comes straight back unless the node is `selectable`.
    const reclaim = () => setTimeout(() => {
        const active = document.activeElement;
        if (!active?.matches?.('iframe.plugin-native-html') || !nativeFrame.contains(active)) return;
        record.nativeUi?.pressedInside(active); // popovers close on a press there too
        if (!active.hasAttribute('data-keeps-focus')) nativeFrame.focus({ preventScroll: true });
    }, 0);
    window.addEventListener('blur', reclaim);
    record.releaseFocusWatch = () => window.removeEventListener('blur', reclaim);
    win.addEventListener('keydown', forward('keydown'));
    win.addEventListener('keyup', forward('keyup'));
}

function bringPluginWindowToFront(win) { bringManagedWindowToFront(win); }
// An application's window reopens where, and as large as, the user left it. A zoomed or
// tiled window is remembered by the frame it would return to.
const WINDOW_FRAME_KEY = 'macOS_plugin_window_frames_v1';
function windowFrames() { try { const value = JSON.parse(localStorage.getItem(WINDOW_FRAME_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
function rememberWindowFrame(record) {
    const win = record?.window;
    if (!win?.isConnected || state.incognitoConfigMode || devOverride(record.plugin.id)?.size) return;
    let frame = null;
    if (win.dataset.maximized === '1' || win.dataset.snapped) { try { frame = JSON.parse(win.dataset.restoreRect || 'null'); } catch { frame = null; } }
    frame ||= { left: parseFloat(win.style.left), top: parseFloat(win.style.top), width: parseFloat(win.style.width) || win.offsetWidth, height: parseFloat(win.style.height) || win.offsetHeight };
    if (![frame.left, frame.top, frame.width, frame.height].every(Number.isFinite)) return;
    const frames = windowFrames();
    frames[record.key] = { left: Math.round(frame.left), top: Math.round(frame.top), width: Math.round(frame.width), height: Math.round(frame.height) };
    try { localStorage.setItem(WINDOW_FRAME_KEY, JSON.stringify(frames)); } catch { /* storage full: the window opens centred next time */ }
}
export function fitPluginWindow(win, width, height) {
    // A frameless window (titlebar "none") may be small and stays wholly on the desktop.
    if (win.classList.contains('plugin-app-frameless')) {
        const w = Math.min(Math.max(40, width), innerWidth); const h = Math.min(Math.max(40, height), innerHeight - 26);
        win.style.width = `${w}px`; win.style.height = `${h}px`;
        const left = Number.isFinite(parseFloat(win.style.left)) ? parseFloat(win.style.left) : innerWidth - w - 40;
        const top = Number.isFinite(parseFloat(win.style.top)) ? parseFloat(win.style.top) : innerHeight - h - 120;
        win.style.left = `${Math.max(2, Math.min(left, innerWidth - w - 2))}px`;
        win.style.top = `${Math.max(26, Math.min(top, innerHeight - h - 2))}px`;
        return;
    }
    const w = Math.min(Math.max(260, width), Math.max(280, innerWidth - 24));
    const h = Math.min(Math.max(220, height), Math.max(240, innerHeight - 54));
    win.style.width = `${w}px`; win.style.height = `${h}px`;
    const rect = win.getBoundingClientRect();
    if (!win.style.left) win.style.left = `${Math.max(8, Math.round((innerWidth - w) / 2))}px`;
    if (!win.style.top) win.style.top = `${Math.max(30, Math.round((innerHeight - h) / 2))}px`;
    const left = Number.isFinite(parseFloat(win.style.left)) ? parseFloat(win.style.left) : rect.left;
    const top = Number.isFinite(parseFloat(win.style.top)) ? parseFloat(win.style.top) : rect.top;
    win.style.left = `${Math.max(80 - w, Math.min(left, innerWidth - 80))}px`;
    win.style.top = `${Math.max(26, Math.min(top, innerHeight - 50))}px`;
}
function bindPluginWindowDrag(win, bar, record = null) {
    // Without a title strip the window moves by any bare surface of the content, the way
    // system windows do. Controls, lists and text the app made clickable are left alone.
    if (record?.plugin.window.titlebar === 'hidden' && record.nativeFrame) {
        record.nativeFrame.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || !record.nativeUi?.isBackground(event.target)) return;
            beginManagedWindowDrag(win, record.nativeFrame, event, { minLeft: (rect) => 80 - rect.width, maxLeft: () => window.innerWidth - 80, minTop: () => 26, maxTop: () => window.innerHeight - 50 });
        });
    }
    bar.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('.plugin-app-controls')) return;
        // Same rules as system windows (events.js bindWindowDragging): a window may be
        // pushed partly off-screen but always keeps 80px reachable, and never slides
        // under the menu bar.
        beginManagedWindowDrag(win, bar, event, {
            minLeft: (rect) => 80 - rect.width,
            maxLeft: () => window.innerWidth - 80,
            minTop: () => 26,
            maxTop: () => window.innerHeight - 50
        });
    });
}
export function closePluginWindow(key) {
    const record = appWindows.get(key); if (!record) return;
    rememberWindowFrame(record);
    try { record.resizeObserver?.disconnect(); } catch {}
    try { record.releaseFocusWatch?.(); } catch {}
    try { if (record.audio) { stopFade(record.audio); record.audio.pause(); record.audio.removeAttribute('src'); record.audio.load(); clearSubtitles(record); } record.outgoingMedia?.forEach(retireMedia); } catch {}
    try { record.objectUrls?.forEach((url) => URL.revokeObjectURL(url)); record.objectUrls?.clear(); } catch {}
    try { removeStatusItem(record); } catch {}
    try { forgetWindowMotion(record); forgetDesktopWatcher(record); } catch {}
    record.readyWaiters?.splice(0).forEach((resolve) => resolve(false));
    try { postToPlugin(record, { type: 'event', name: 'close', detail: {} }); } catch {}
    try { postToPlugin(record, { type: 'dispose' }); } catch {}
    try { record.port?.close?.(); } catch {}
    record.port = null;
    appWindows.delete(key);
    record.window.remove();
    unregisterManagedWindow(record.window);
    announceRunningApps();
    if (!instancesOf(record.plugin.id).length) announcePeer(record.plugin, false);
}
export function minimizePluginWindow(key) {
    const record = appWindows.get(key); if (record) minimizeManagedWindow(record.window);
}
function maximizePluginWindow(key) {
    const record = appWindows.get(key); if (record) toggleZoomManagedWindow(record.window);
}
function showAboutApplication(plugin) {
    const permissions = plugin.permissions?.length ? `${t('permissions', '权限')}: ${plugin.permissions.map(permissionLabel).join(', ')}` : t('noExtraPermissions', '无额外权限');
    return showMacAlert(`${t('appVersion', '版本')} ${plugin.version}`, { title: plugin.name, detail: [plugin.description, permissions].filter(Boolean).join('\n\n'), icon: plugin.icon || '' });
}
// An application without a settings interface of its own is managed from System Settings.
function openApplicationSettings(id) {
    invokeMenuCommand('settings.applications');
    requestAnimationFrame(() => {
        const row = document.querySelector(`#application-plugin-list [data-plugin-id="${CSS.escape(id)}"]`);
        row?.scrollIntoView?.({ block: 'center' });
        row?.classList.add('settings-search-highlight');
        setTimeout(() => row?.classList.remove('settings-search-highlight'), 1400);
    });
}
// What the menu bar shows while this application is in front (see app-menu.js). The
// application menu itself — About, Settings…, Hide, Hide Others, Show All, Quit — is the
// system's; the application only contributes its own entries and menus.
function pluginApplication(record) {
    const { plugin } = record;
    const command = (name) => () => postToPlugin(record, { type: 'event', name: 'menucommand', detail: { command: name } });
    const toItem = (item) => (item.separator ? { separator: true } : {
        label: nativeTranslate(record, item.labelKey, item.label || item.command), shortcut: item.shortcut, danger: item.danger, disabled: item.disabled, run: command(item.command)
    });
    return {
        id: `plugin:${record.key}`, pluginId: record.key, name: plugin.name, window: record.window,
        about: () => showAboutApplication(plugin),
        settings: plugin.settings ? () => postToPlugin(record, { type: 'event', name: 'settings', detail: {} }) : () => openApplicationSettings(plugin.id),
        extra: [
            ...(multiInstanceAllowed(plugin) ? [{ label: t('appNewWindow', '新建窗口'), disabled: !canOpenAnotherInstance(plugin), run: () => openPluginApp(plugin.id, { newInstance: true }) }] : []),
            ...(plugin.appMenu || []).map(toItem)
        ],
        quit: () => closePluginWindow(record.key),
        menus: () => (plugin.menus || []).map((menu) => ({ title: nativeTranslate(record, menu.titleKey, menu.title || 'Menu'), items: (menu.items || []).map(toItem) }))
    };
}
const dockIconForPlugin = (id) => document.querySelector(`#dock [data-app-key="plugin:${CSS.escape(id)}"] .dock-icon`);
export function menuCommands() {
    return [
        { id: 'apple.about', label: t('aboutMac', '关于本机') },
        { id: 'apple.settings', label: t('sysSettings', '系统设置') },
        { id: 'system.spotlight', label: t('tabSpotlight', '聚焦搜索') },
        { id: 'system.launchpad', label: t('tabLaunchpad', '启动台') },
        { id: 'settings.applications', label: t('tabApplications', '应用程序') },
        { id: 'settings.widgets', label: t('tabWidgets', '小组件') },
        { id: 'settings.developer', label: t('tabDeveloper', '开发者') }
    ];
}
export function invokeMenuCommand(command) {
    if (command === 'apple.about') return $('btn-about-mac')?.click(), true;
    if (command === 'apple.settings') return $('btn-sys-settings')?.click(), true;
    if (command === 'system.spotlight') return $('spotlight-btn')?.click(), true;
    if (command === 'system.launchpad') { window.dispatchEvent(new CustomEvent('macos-plugin-menu-command', { detail: { command } })); return true; }
    const settingsMap = { 'settings.applications': 'set-applications', 'settings.widgets': 'set-widgets', 'settings.developer': 'set-developer' };
    if (settingsMap[command]) {
        $('btn-sys-settings')?.click();
        document.querySelector(`.settings-sidebar .tab[data-target="${settingsMap[command]}"]`)?.click();
        return true;
    }
    return false;
}

// The accent an application draws with: its own while the system accent is multicolor
// (manifest accentColor, or what it last set with macos.window.setAccentColor), otherwise
// the one system-wide colour.
const pluginAccent = (record) => applicationAccentHex(record.accent ?? record.plugin.accentColor);
export function applyPluginAccent(record) {
    const own = systemAccentSetting() === 'multicolor' ? accentHex(record.accent ?? record.plugin.accentColor) : '';
    const style = record.window.style;
    if (own) { style.setProperty('--app-accent', own); style.setProperty('--app-accent-rgb', hexToRgbList(own)); }
    else { style.removeProperty('--app-accent'); style.removeProperty('--app-accent-rgb'); }
    return pluginAccent(record);
}
export function environmentInfo(record) {
    return {
        reduceTransparency: reduceTransparencyEnabled(), transparentGlass: transparentGlassEnabled(), increaseContrast: devFlag('increaseContrast'),
        reduceMotion: devFlag('disableAnimations'),
        // accentColor is what applies now. accentSetting is the system choice: with
        // "multicolor" the application's own accent is used, otherwise it is overridden.
        accentColor: record ? pluginAccent(record) : applicationAccentHex(''), accentSetting: systemAccentSetting()
    };
}
function runtimeContext(record) {
    const plugin = record.plugin;
    const language = appLanguage(plugin); let region = ''; try { region = new Intl.Locale(language).region || ''; } catch {}
    return {
        language, region, direction: layoutDirection(), theme: appTheme(plugin), systemTheme: state.effectiveTheme || 'light', appearance: appAppearance(plugin), appId: plugin.id, appName: plugin.name,
        strictSecurity: appStrict(plugin), devicePixelRatio: (window.devicePixelRatio || 1) * appZoom(plugin), ...environmentInfo(record),
        // 1 for the application's ordinary window. Further instances count up from 2; they
        // see the same storage as instance 1 unless sharedStorage is false.
        instance: record.instance, sharedStorage: record.storageId === plugin.id,
        // Why it was started: 'autostart' (opened with the new tab, the user's setting) or 'user'.
        launchReason: record.launchReason || 'user', autostart: record.launchReason === 'autostart'
    };
}
function handlePluginRuntimeMessage(record, message) {
    if (!record || !message || message.instanceId !== record.instanceId || message.token !== record.token) return;
    if (message.type === 'ready') {
        record.window.classList.remove('plugin-app-loading');
        record.ready = true;
        for (const pending of record.pending?.splice(0) || []) postToPlugin(record, pending);
        record.readyWaiters?.splice(0).forEach((resolve) => resolve(true));
        announcePeer(record.plugin, true);
        return;
    }
    if (message.type === 'crash') {
        devEmit('crash', { app: record.key, level: 'error', text: String(message.message || '').slice(0, 5000) });
        record.window.classList.add('plugin-app-crashed');
        record.crashText.textContent = String(message.message || t('appPluginCrashed', '应用程序插件已崩溃。')).slice(0, 5000);
        try { record.port?.close?.(); } catch {}
        record.port = null;
        // Removing the sandbox frame stops runaway timers/animations instead of letting
        // a crashed app consume CPU in the background.
        record.iframe?.remove(); record.iframe = null;
        return;
    }
    if (message.type !== 'request') return;
    (async () => {
        const method = String(message.method || '');
        const started = dev.enabled ? performance.now() : 0;
        const trace = (ok, text) => {
            if (!dev.enabled || method === 'log') return;
            const ms = Math.round((performance.now() - started) * 10) / 10;
            // An interface update that took longer than a frame is marked in the console.
            const slow = ok && method.startsWith('ui.') && method !== 'ui.showMenu' && ms > FRAME_BUDGET_MS;
            devEmit('api', { app: record.key, name: method, ok, level: ok ? (slow ? 'warn' : 'log') : 'error', ms, slow, args: devPreview(message.payload), text: slow ? `${text}  ⚠ ${t('devPerfFrame', '超过一帧（16.7 ms）')}` : text });
        };
        try {
            const value = await handleAppRequest(record, method, message.payload || {});
            trace(true, devPreview(value, 120));
            postToPlugin(record, { type: 'response', requestId: message.requestId, ok: true, value });
        } catch (error) {
            trace(false, error?.message || String(error));
            postToPlugin(record, { type: 'response', requestId: message.requestId, ok: false, error: error?.message || String(error) });
        }
    })();
}

function connectPluginPort(record) {
    if (!record?.iframe?.contentWindow || record.port) return;
    const channel = new MessageChannel();
    record.port = channel.port1;
    record.port.onmessage = (event) => handlePluginRuntimeMessage(record, event.data);
    record.port.start?.();
    try {
        record.iframe.contentWindow.postMessage({
            channel: CHANNEL_HOST,
            type: 'connect',
            instanceId: record.instanceId,
            token: record.token,
            pluginId: record.plugin.id,
            plugin: record.runtimeApp,
            context: runtimeContext(record)
        }, '*', [channel.port2]);
    } catch (error) {
        try { record.port.close(); } catch {}
        record.port = null;
        throw error;
    }
}

function bindPluginMessageBridge() {
    if (pluginMessageBound) return; pluginMessageBound = true;
    // The global window message listener is bootstrap-only. Once the sandbox announces
    // itself, each app gets a private MessagePort so steady-state API traffic never has
    // to traverse/filter the global window message stream.
    window.addEventListener('message', (event) => {
        const message = event.data; if (!message || message.channel !== CHANNEL_APP || message.type !== 'runtime-ready') return;
        const record = [...appWindows.values()].find((entry) => event.source === entry.iframe?.contentWindow);
        if (!record) return;
        try { connectPluginPort(record); } catch (error) {
            record.window.classList.add('plugin-app-crashed');
            record.crashText.textContent = error?.message || String(error);
        }
    });
    window.addEventListener('macos-appearance-change', () => {
        for (const record of appWindows.values()) postToPlugin(record, { type: 'event', name: 'themechange', detail: { theme: appTheme(record.plugin), systemTheme: state.effectiveTheme || 'light' } });
    });
    applySubtitleAppearance();
    window.addEventListener('macos-subtitle-style-change', applySubtitleAppearance);
    // Closing the tab leaves the windows where they are: that is where they open next time.
    window.addEventListener('pagehide', () => { for (const record of appWindows.values()) rememberWindowFrame(record); });
    window.addEventListener('macos-appearance-change', () => {
        // Canvas drawings and embedded HTML resolve their colours from the window theme.
        requestAnimationFrame(() => { for (const record of appWindows.values()) record.nativeUi?.refresh(); });
    });
    // While files are dragged over the desktop, sandbox frames must not swallow the drag,
    // otherwise a Web app window could never receive a drop.
    let fileDragDepth = 0;
    const endFileDrag = () => { fileDragDepth = 0; document.body.classList.remove('file-drag-active'); document.querySelectorAll('.plugin-app-drop-target').forEach((node) => node.classList.remove('plugin-app-drop-target')); };
    document.addEventListener('dragenter', (event) => { if (dragHasFiles(event)) { fileDragDepth += 1; document.body.classList.add('file-drag-active'); } }, true);
    document.addEventListener('dragleave', (event) => { if (dragHasFiles(event) && --fileDragDepth <= 0) endFileDrag(); }, true);
    document.addEventListener('drop', endFileDrag, true);
    document.addEventListener('dragend', endFileDrag, true);
    window.addEventListener('macos-language-change', () => {
        for (const record of appWindows.values()) {
            refreshNativeTranslations(record);
            postToPlugin(record, { type: 'event', name: 'languagechange', detail: { language: appLanguage(record.plugin), direction: layoutDirection() } });
        }
    });
    // The layout was mirrored (a right-to-left language, or the Developer switch): host-drawn
    // interfaces follow by themselves; the application is told in case it draws its own.
    window.addEventListener('macos-direction-change', () => {
        for (const record of appWindows.values()) {
            postToPlugin(record, { type: 'event', name: 'languagechange', detail: { language: appLanguage(record.plugin), direction: layoutDirection() } });
            requestAnimationFrame(() => record.nativeUi?.refresh());
        }
    });
    window.addEventListener('macos-accent-change', () => {
        for (const record of appWindows.values()) {
            const accentColor = applyPluginAccent(record);
            record.nativeUi?.refresh();
            postToPlugin(record, { type: 'event', name: 'accentchange', detail: { accentColor, accentSetting: systemAccentSetting() } });
        }
    });
    window.addEventListener('macos-managed-window-drag', (event) => {
        const active = !!event.detail?.active;
        for (const record of appWindows.values()) postToPlugin(record, { type: 'host-drag-state', active, kind: event.detail?.kind || 'system' });
    });
    window.addEventListener('macos-active-application-changed', (event) => {
        const pluginOf = (id) => (String(id).startsWith('plugin:') ? appWindows.get(String(id).slice(7)) : null);
        const before = pluginOf(event.detail?.previous); const after = pluginOf(event.detail?.current);
        if (before) postToPlugin(before, { type: 'event', name: 'blur', detail: {} });
        if (after) postToPlugin(after, { type: 'event', name: 'focus', detail: {} });
    });
    // Shown, minimised or hidden — by its own buttons, the Dock or the application menu.
    window.addEventListener('macos-window-visibility-changed', (event) => {
        const record = [...appWindows.values()].find((entry) => entry.window === event.detail?.element);
        if (record) postToPlugin(record, { type: 'event', name: 'visibilitychange', detail: { visible: Boolean(event.detail.visible) && !document.hidden } });
    });
    document.addEventListener('keydown', handleApplicationShortcut, true);
    document.addEventListener('visibilitychange', () => {
        for (const record of appWindows.values()) {
            const visible = !document.hidden && !record.window.classList.contains('hidden');
            postToPlugin(record, { type: 'event', name: 'visibilitychange', detail: { visible } });
        }
    });
}

async function actuallyOpenPluginApp(id, { newInstance = false, instance: wanted = 0, reason = 'user', announce = true } = {}) {
    if (extraFeaturesDisabled(state.config)) return;
    const plugin = pluginState().apps.find((item) => item.id === id); if (!plugin) return;
    bindPluginMessageBridge(); bindApplicationMenu();
    const running = instancesOf(id);
    // Opening an application that is running shows it. A further window is only made on request.
    // (It is told so — 'reopen' — because an application without an ordinary window, or one
    // that hid itself, has nothing else to go by: the user asked for it again.)
    if (running.length && !wanted && !(newInstance && canOpenAnotherInstance(plugin))) {
        showPluginWindows(id);
        const front = frontInstance(id);
        // Not when the host opens it to hand over something of its own (a widget click, a link,
        // a Spotlight result): that event says what is wanted.
        if (front && announce) postWhenReady(front, { type: 'event', name: 'reopen', detail: {} });
        return;
    }
    const taken = new Set(running.map((record) => record.instance));
    let instance = wanted;
    if (!instance) { instance = 1; while (taken.has(instance)) instance += 1; }
    if (taken.has(instance)) return;
    const key = instanceKey(id, instance);
    const compiled = await compiledForPlugin(plugin);
    if (appWindows.has(key)) { showPluginWindows(id); return; } // opened meanwhile
    // Keep asset bytes host-side. The sandbox receives only the path catalog and
    // requests an asset when HTML/CSS/app logic actually references it.
    const runtimeAssets = compiled.runtime?.assets || {};
    const runtimeApp = { ...compiled.runtime, assets: Object.keys(runtimeAssets) };

    const win = createElement('section', { className: 'plugin-app-window mac-acrylic window-shadow plugin-app-loading', dataset: { pluginId: id, instance: String(instance) } });
    applyWindowAppearance({ plugin, window: win });
    if (plugin.window.material === 'solid') win.classList.add('plugin-app-material-solid');
    if (plugin.window.material === 'transparent') win.classList.add('plugin-app-material-transparent');
    win.style.minWidth = `${plugin.window.minWidth}px`; win.style.minHeight = `${plugin.window.minHeight}px`;
    const resizeMode = plugin.window.resizable === false ? 'none' : (plugin.window.resize || 'both');
    if (resizeMode !== 'none') { win.classList.add('plugin-app-resizable'); win.style.resize = resizeMode; }
    if (plugin.window.maxWidth) win.style.maxWidth = `${plugin.window.maxWidth}px`;
    if (plugin.window.maxHeight) win.style.maxHeight = `${plugin.window.maxHeight}px`;
    if (plugin.window.titlebar === 'hidden') win.classList.add('plugin-app-titlebar-hidden');
    // Frameless (no title bar, no window buttons), floating above other windows, and / or an
    // accessory without a Dock icon — a desktop pet is all three.
    if (plugin.window.titlebar === 'none') win.classList.add('plugin-app-frameless');
    if (plugin.window.level !== 'normal') win.dataset.windowLevel = plugin.window.level;
    if (plugin.window.showInDock === false) win.dataset.accessory = '1';
    const titlebar = createElement('div', { className: 'plugin-app-titlebar' });
    const controls = createElement('div', { className: 'plugin-app-controls' });
    const close = createElement('button', { className: 'plugin-app-dot close', attrs: { type: 'button', 'aria-label': t('close', '关闭') } });
    const minimize = createElement('button', { className: 'plugin-app-dot minimize', attrs: { type: 'button', 'aria-label': t('minimize', '最小化') } });
    const maximize = createElement('button', { className: 'plugin-app-dot maximize', attrs: { type: 'button', 'aria-label': t('maximize', '最大化') } });
    if (!plugin.window.resizable) {
        maximize.disabled = true;
        maximize.setAttribute('aria-disabled', 'true');
        maximize.title = t('windowNotResizable', '此应用窗口不可调整大小');
    }
    controls.append(close, minimize, maximize);
    win.style.setProperty('--plugin-titlebar-height', `${plugin.window.titlebarHeight || 36}px`);
    win.style.setProperty('--plugin-window-radius', `${plugin.window.borderRadius || 12}px`);
    const identity = createElement('div', { className: 'plugin-app-identity' });
    if (plugin.window.showTitle !== false) { identity.append(appIcon(plugin, 22)); }
    const title = createElement('span', { className: 'plugin-app-title', text: plugin.window.showTitle === false ? '' : plugin.name });
    if (plugin.window.showTitle !== false) identity.appendChild(title); else identity.classList.add('plugin-app-identity-hidden');
    titlebar.append(controls, identity, createElement('span', { className: 'plugin-app-title-spacer' }));
    const nativeMode = runtimeApp.mode === 'native';
    const nativeFrame = nativeMode ? createElement('div', { className: 'plugin-native-app-frame', attrs: { role:'application', 'aria-label':plugin.name } }) : null;
    const iframe = createElement('iframe', { className: nativeMode ? 'plugin-app-runtime-frame' : 'plugin-app-frame', attrs: { src: appStrict(plugin) ? 'plugin/app-runtime-strict.html' : 'plugin/app-runtime.html', sandbox: 'allow-scripts', title: nativeMode ? `${plugin.name} runtime` : plugin.name, referrerpolicy: 'no-referrer', 'aria-hidden': nativeMode ? 'true' : undefined } });
    const loading = createElement('div', { className: 'plugin-app-loading-view', text: t('appPluginLoading', '正在打开应用程序…') });
    const crash = createElement('div', { className: 'plugin-app-crash-view' });
    const crashText = createElement('pre', { className: 'plugin-app-crash-text' });
    const reload = createButton(t('reloadApp', '重新载入'), { primary: true, onClick: () => { closePluginWindow(key); openPluginApp(id, { instance }); } });
    crash.append(createElement('strong', { text: t('appPluginCrashed', '应用程序插件已崩溃。') }), crashText, reload);
    win.append(titlebar); if (nativeFrame) win.appendChild(nativeFrame); win.append(iframe, loading, crash); document.body.appendChild(win);
    const instanceId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`; const token = crypto.randomUUID?.() || `${Math.random()}-${Date.now()}`;
    const record = { plugin, key, instance, storageId: instanceStorageId(plugin, instance), runtimeApp, runtimeAssets, window: win, iframe, nativeFrame, nativeUi: null, title, crashText, instanceId, token, port: null, launchReason: reason === 'autostart' ? 'autostart' : 'user' }; appWindows.set(key, record);
    // A further window opens a step down and to the right of the one in front.
    const front = running.length ? frontInstance(id)?.window.getBoundingClientRect() : null;
    if (front?.width) { win.style.left = `${Math.round(front.left + 26)}px`; win.style.top = `${Math.round(front.top + 26)}px`; }
    // Where this window was the last time it was open.
    const remembered = windowFrames()[key];
    if (remembered) { win.style.left = `${remembered.left}px`; win.style.top = `${remembered.top}px`; }
    const frameless = plugin.window.titlebar === 'none';
    registerManagedWindow(win, { app: () => pluginApplication(record), dockTarget: () => dockIconForPlugin(id), zoomable: !frameless, minimizable: !frameless,
        resize: () => ({ x: resizeMode === 'both' || resizeMode === 'horizontal', y: resizeMode === 'both' || resizeMode === 'vertical', maxWidth: plugin.window.maxWidth || Infinity, maxHeight: plugin.window.maxHeight || Infinity }) });
    announceRunningApps();
    applyPluginAccent(record);
    applyAppZoom(record);
    if (nativeFrame) { renderNativeAppUI(record); bindNativeKeyboard(record); }
    // Apps are told when their window is resized so canvases and custom layouts can follow.
    let resizeFrame = 0;
    record.resizeObserver = new ResizeObserver(() => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            // The layout size: while the window flies to or from the Dock it is scaled, and
            // its on-screen rectangle says nothing about the room the app has.
            const width = win.offsetWidth; const height = win.offsetHeight;
            const zoom = appZoom(plugin);
            if (width && height) postToPlugin(record, { type: 'event', name: 'resize', detail: { width: Math.round(width / zoom), height: Math.round(height / zoom) } });
        });
    });
    record.resizeObserver.observe(win);
    bindFileDrop(record);
    bindPaste(record);
    const trackPointer = (event) => { record.lastPointer = { x: event.clientX, y: event.clientY }; };
    win.addEventListener('pointerdown', trackPointer, true);
    win.addEventListener('contextmenu', trackPointer, true);
    const sizeX = resizeMode === 'both' || resizeMode === 'horizontal'; const sizeY = resizeMode === 'both' || resizeMode === 'vertical';
    fitPluginWindow(win, remembered && sizeX ? Math.max(plugin.window.minWidth, remembered.width) : plugin.window.width, remembered && sizeY ? Math.max(plugin.window.minHeight, remembered.height) : plugin.window.height); bringPluginWindowToFront(win); bindPluginWindowDrag(win, titlebar, record);
    close.addEventListener('click', () => closePluginWindow(key)); minimize.addEventListener('click', () => minimizePluginWindow(key)); if (plugin.window.resizable) maximize.addEventListener('click', () => maximizePluginWindow(key));
    win.addEventListener('pointerdown', () => bringPluginWindowToFront(win), { capture: true });
}

/** Opens an application, or shows it when it is running. `newInstance` asks for a further window (if allowed). */
export function openPluginApp(id, options = {}) {
    const pending = `${id}:${options.newInstance ? 'new' : (options.instance || 'open')}`;
    if (appOpenPromises.has(pending)) return appOpenPromises.get(pending);
    const task = actuallyOpenPluginApp(id, options).catch(async (error) => { await showMacAlert(error?.message || t('applicationOpenFailed', '应用程序无法打开。'), { title: t('error', '错误') }); }).finally(() => appOpenPromises.delete(pending));
    appOpenPromises.set(pending, task); return task;
}

export function syncPluginRuntimeState({ forceClose = false } = {}) {
    if (!forceClose && !extraFeaturesDisabled(state.config)) return;
    [...appWindows.keys()].forEach(closePluginWindow);
}

// Right-clicking an application's Dock icon: open / a further window / keep in Dock / quit.
function bindDockApplicationMenu() {
    document.addEventListener('contextmenu', (event) => {
        const item = event.target.closest?.('#dock [data-app-key^="plugin:"]');
        if (!item || extraFeaturesDisabled(state.config)) return;
        const id = item.dataset.appKey.slice('plugin:'.length);
        const plugin = pluginState().apps.find((app) => app.id === id); if (!plugin) return;
        event.preventDefault(); event.stopPropagation();
        const running = instancesOf(id).length > 0;
        const items = [
            { id: 'open', label: running ? t('appShowWindows', '显示所有窗口') : t('open', '打开') },
            ...(running && multiInstanceAllowed(plugin) ? [{ id: 'new', label: t('appNewWindow', '新建窗口'), disabled: !canOpenAnotherInstance(plugin) }] : []),
            { separator: true },
            pinnedInDock(id) ? { id: 'unpin', label: t('dockRemove', '从程序坞中移除') } : { id: 'pin', label: t('dockKeep', '在程序坞中保留') },
            ...(running ? [{ separator: true }, { id: 'quit', label: t('appMenuQuit', '退出 {name}').replace('{name}', plugin.name) }] : [])
        ];
        // Like the Dock's own menus on macOS, it opens above the Dock rather than at the
        // pointer, and the icon's name label gives way to it.
        const icon = (item.querySelector('.dock-icon') || item).getBoundingClientRect(); // as magnified
        const dockTop = Math.min(icon.top, $('dock-plate')?.getBoundingClientRect().top ?? icon.top);
        document.body.classList.add('dock-menu-open');
        showNativeMenu(items, event.clientX, event.clientY, undefined, {
            above: { centerX: icon.left + icon.width / 2, top: dockTop - 10 },
            // The Dock stays as it is (magnified) while its menu is open; events.js lets it settle afterwards.
            onClose: () => { document.body.classList.remove('dock-menu-open'); window.dispatchEvent(new CustomEvent('macos-dock-menu-closed')); }
        }).then((choice) => {
            if (choice === 'open') openPluginApp(id);
            else if (choice === 'new') openPluginApp(id, { newInstance: true });
            else if (choice === 'quit') closePluginApp(id);
            else if (choice === 'pin') pinApplicationToDock(id);
            else if (choice === 'unpin') unpinApplicationFromDock(id);
        });
    }, true);
}

// Installs each bundled application (and its launcher) the first time this profile
// sees it. See plugins.bundledSeen in config.js.
async function ensureBundledApps() {
    const cfg = pluginState();
    cfg.bundledSeen ||= [];
    let changed = false;
    for (const bundled of (state.defaults?.plugins?.apps || []).filter((app) => app.bundled)) {
        if (cfg.bundledSeen.includes(bundled.id)) continue;
        if (!cfg.apps.some((app) => app.id === bundled.id)) cfg.apps.push(structuredClone(bundled));
        await addPluginLauncher(cfg.apps.find((app) => app.id === bundled.id), { save: false });
        cfg.bundledSeen.push(bundled.id);
        changed = true;
    }
    if (changed) { await saveConfig(); renderApplicationManager(); }
    // An application that used to be imported by hand and now ships with the system runs
    // from the bundled package; the stored copy of the old one is dropped.
    for (const app of cfg.apps.filter((item) => item.packagePath && !item.packageStored)) {
        const key = APP_ASSET_INDEX_PREFIX + app.id;
        if ((await storageGet([key]))[key]) await deletePackageForPlugin(app.id);
    }
}

// A launcher still showing the icon its application was installed with follows the
// application when an update brings a new icon. One the user replaced is left alone.
export function syncLauncherIcons() {
    let changed = false;
    for (const plugin of pluginState().apps) {
        const action = `pluginApp:${plugin.id}`; const icon = plugin.icon || 'assets/icons/noicon.svg';
        for (const key of ['launchpadApps', 'desktopApps', 'dockApps', 'quickLinks']) {
            for (const app of state.config[key] || []) {
                if (app?.action !== action || app.icon === icon || (app.originalIcon && app.icon !== app.originalIcon)) continue;
                app.icon = icon; app.originalIcon = icon; app.useBg = !plugin.icon;
                changed = true;
            }
        }
    }
    return changed;
}

export function bindPluginManagerEvents() {
    bindPluginMessageBridge();
    bindDockApplicationMenu();
    setNotificationActivator(activateNotification);
    openRequestedNotification().catch(() => {});
    bindScreenChanges();
    $('limit-plugin-import')?.addEventListener('change', async (event) => {
        if (extraFeaturesDisabled(state.config)) { event.target.value = ''; return; }
        const file = event.target.files?.[0]; if (!file) return;
        try { await importLimitOverlayPlugin(file); await showMacAlert(t('pluginImported', '插件已导入。'), { title: t('limitOverlayPlugins', '限额遮罩插件') }); }
        catch (error) { await showMacAlert(error?.message || t('pluginImportFailed', '插件导入失败。'), { title: t('error', '错误') }); }
        finally { event.target.value = ''; }
    });
    $('application-plugin-import')?.addEventListener('change', async (event) => {
        if (extraFeaturesDisabled(state.config)) { event.target.value = ''; return; }
        const file = event.target.files?.[0]; if (!file) return;
        try { const plugin = await importApplicationPlugin(file); await showMacAlert(t('applicationImported', '应用程序已安装。'), { title: plugin.name }); }
        catch (error) { await showMacAlert(error?.message || t('applicationImportFailed', '应用程序安装失败。'), { title: t('error', '错误') }); }
        finally { event.target.value = ''; }
    });
    $('limit-plugin-use-builtin')?.addEventListener('click', async () => { if (extraFeaturesDisabled(state.config)) return; pluginState().activeLimitOverlay = 'builtin'; await saveConfig(); renderPluginManager(); });
    window.addEventListener('resize', () => appWindows.forEach((record) => { if (record.window.dataset.maximized !== '1' && !record.window.dataset.snapped) fitPluginWindow(record.window, record.window.getBoundingClientRect().width, record.window.getBoundingClientRect().height); }));
    const initialize = async () => {
        await ensureBundledApps();
        if (syncLauncherIcons()) { await saveConfig(); window.dispatchEvent(new CustomEvent('macos-plugin-launchers-updated')); }
        // Applications the user marked "launch at startup" open with every new tab.
        if (!extraFeaturesDisabled(state.config)) for (const plugin of pluginState().apps.filter((app) => app.autoStart === true)) openPluginApp(plugin.id, { reason: 'autostart' });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => initialize().catch(() => {}), { timeout: 2600 }); else setTimeout(() => initialize().catch(() => {}), 800);
    renderPluginManager();
}
