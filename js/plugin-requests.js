// The API an application calls: one request router, with the rate budget in front of it.

import { handleLinkRequest } from './plugin-links.js';
import { state } from './state.js';
import { saveConfig } from './config.js';
import { layoutDirection, t } from './i18n.js';
import { $ } from './utils.js';
import { showMacAlert, showMacConfirm, showMacPrompt } from './dialog.js';
import { restoreManagedWindow } from './window-manager.js';
import { accentHex, systemAccentSetting } from './accent.js';
import { runAppearanceTransition } from './theme.js';
import { showNativeMenu } from './plugin-native-ui.js';
import { devEmit, devOverride, devPreview } from './dev-hooks.js';
import { appAppearance, appLanguage, appStrict, appTheme, appWindows, appZoom, applicationUnrestricted, applyWindowAppearance, instancesOf, isPrivateNetworkHost, permissionAllowed, pluginStorageClear, pluginStorageGet, pluginStorageRemove, pluginStorageSet, postToPlugin, requirePermission, safeExternalUrl } from './plugin-core.js';
import { applyPluginAccent, closePluginWindow, environmentInfo, fitPluginWindow, invokeMenuCommand, isEditableTarget, menuCommands, minimizePluginWindow } from './plugin-system.js';
import { appAssetStorageKey, cleanPackagePath, dataUrlForRecord, nativeTranslate, storageGet } from './plugin-package.js';
import { bytesToBase64, handleArchiveRequest, handleFilesRequest, pickFileForPlugin, saveFileForPlugin } from './plugin-files.js';
import { handleAudioRequest } from './plugin-media.js';
import { handleScheduleRequest, handleSearchRequest, patchStatusPanel, removeStatusItem, setStatusItem, showPluginNotification } from './plugin-integration.js';
import { handleWidgetRequest } from './plugin-widgets.js';
import { permissionStatus, requestPermissions } from './plugin-settings.js';
import { handleDesktopRequest } from './plugin-desktop.js';
import { dragWindow, leaveHitRegion, moveWindow, setHitRegion, setWindowLevel, setWindowShape, trackPointer, windowFrame } from './plugin-window-motion.js';

// Performance budget (Developer Tools console): one interface update should fit in a
// frame, and an application should not need more than this many API calls a second.
export const FRAME_BUDGET_MS = 1000 / 60;
const CALL_BUDGET_PER_SECOND = 90;
function consumeAppRequestBudget(record) {
    const now = performance.now();
    const budget = record.requestBudget || (record.requestBudget = { start: now, count: 0 });
    if (now - budget.start >= 1000) { budget.start = now; budget.count = 0; }
    budget.count += 1;
    if (budget.count === CALL_BUDGET_PER_SECOND + 1) devEmit('perf', { app: record.key, level: 'warn', name: 'api rate', text: t('devPerfCalls', '1 秒内超过 {count} 次接口调用。把多次调用合并（ui.batch、一次 storage.set）可以减轻主线程负担。').replace('{count}', String(CALL_BUDGET_PER_SECOND)) });
    if (applicationUnrestricted(record.plugin)) return;
    const limit = appStrict(record.plugin) ? 240 : 1200;
    if (budget.count > limit) throw new Error(`Plugin API rate limit exceeded (${limit}/s)`);
}

// Every call is counted for Developer Tools ▸ Task Manager: how many, and how long the system
// worked on each before it first had to wait for something.
export function handleAppRequest(record, method, payload) {
    const stats = record.stats || (record.stats = { calls: 0, events: 0, hostMs: 0 });
    stats.calls += 1;
    const started = performance.now();
    try { return route(record, method, payload); } finally { stats.hostMs += performance.now() - started; }
}
async function route(record, method, payload) {
    consumeAppRequestBudget(record);
    const plugin = record.plugin;
    // A context menu is the system's for every application, web or native.
    if (method === 'ui.showMenu') {
        const at = record.lastPointer || { x: innerWidth / 2, y: innerHeight / 2 };
        return showNativeMenu(payload?.items, Number.isFinite(payload?.x) ? record.window.getBoundingClientRect().left + payload.x : at.x, Number.isFinite(payload?.y) ? record.window.getBoundingClientRect().top + payload.y : at.y, (key, fallback) => nativeTranslate(record, key, fallback));
    }
    if (method.startsWith('ui.')) {
        const ui = record.nativeUi;
        if (record.runtimeApp?.mode !== 'native' || !ui) throw new Error('Native UI API is only available to runtime=native applications');
        // An update may remove the control that had keyboard focus (a list the user just
        // clicked in, replaced by another view). Focus then falls to the page and the app
        // would stop receiving keys, so it is handed back to the app's frame.
        if (record.window.contains(document.activeElement)) queueMicrotask(() => { if (!record.window.contains(document.activeElement) && appWindows.get(record.key) === record) record.nativeFrame?.focus({ preventScroll: true }); });
        if (method === 'ui.patch') return ui.patch(payload?.id, payload?.props || {});
        if (method === 'ui.batch') { for (const patch of (Array.isArray(payload?.patches) ? payload.patches.slice(0, 2000) : [])) ui.patch(patch?.id, patch?.props || {}); return true; }
        if (method === 'ui.get') return ui.valueOf(String(payload?.id || ''));
        if (method === 'ui.replace') return ui.replace(payload?.id, payload?.node);
        if (method === 'ui.append') return ui.append(payload?.parentId, payload?.node, Number.isInteger(payload?.index) ? payload.index : null);
        if (method === 'ui.setChildren') return ui.setChildren(payload?.parentId, payload?.children);
        if (method === 'ui.remove') return ui.remove(payload?.id);
        if (method === 'ui.render') return ui.render(payload?.tree);
        if (method === 'ui.defineStyles') return ui.defineStyles(payload?.styles);
        if (method === 'ui.scrollTo') return ui.scrollTo(payload?.id, payload?.options || {});
        if (method === 'ui.focus') return ui.focus(payload?.id);
        if (method === 'ui.setSelection') return ui.setSelection(String(payload?.id || ''), payload?.selection || {});
        if (method === 'ui.replaceSelection') return ui.replaceSelection(String(payload?.id || ''), payload?.text, payload?.options || {});
        throw new Error('Unknown Native UI method');
    }
    if (method === 'dialog.alert' || method === 'dialog.confirm') {
        const options = { title: String(payload?.title || plugin.name).slice(0, 120), detail: String(payload?.detail || '').slice(0, 600), icon: plugin.icon || '' };
        if (payload?.confirmLabel) options.confirmLabel = String(payload.confirmLabel).slice(0, 40);
        if (payload?.cancelLabel) options.cancelLabel = String(payload.cancelLabel).slice(0, 40);
        if (payload?.danger) options.danger = true;
        const message = String(payload?.message || '').slice(0, 1000);
        return method === 'dialog.alert' ? showMacAlert(message, options) : showMacConfirm(message, options);
    }
    if (method === 'dialog.prompt') {
        return showMacPrompt(String(payload?.message || '').slice(0, 1000), { title: String(payload?.title || plugin.name).slice(0, 120), detail: String(payload?.detail || '').slice(0, 600), icon: plugin.icon || '',
            value: String(payload?.value ?? '').slice(0, 400), placeholder: String(payload?.placeholder ?? '').slice(0, 120), confirmLabel: payload?.confirmLabel ? String(payload.confirmLabel).slice(0, 40) : undefined });
    }
    if (method === 'dialog.openFile' || method === 'dialog.saveFile' || method.startsWith('files.') || method.startsWith('archive.')) {
        requirePermission(plugin, 'files');
        if (method === 'dialog.openFile') return pickFileForPlugin(record, payload || {});
        if (method === 'dialog.saveFile') return saveFileForPlugin(plugin, payload || {});
        return method.startsWith('files.') ? handleFilesRequest(record, method, payload || {}) : handleArchiveRequest(record, method, payload || {});
    }
    if (method.startsWith('audio.')) {
        // Polling the player's state is not counted as a use of the permission.
        if (method === 'audio.state') { if (!permissionAllowed(plugin, 'audio')) throw new Error('Permission denied: audio'); } else requirePermission(plugin, 'audio');
        return handleAudioRequest(record, method, payload || {});
    }
    if (method === 'log') {
        devEmit('log', { app: record.key, level: ['warn', 'error', 'info'].includes(payload?.level) ? payload.level : 'log', text: (Array.isArray(payload?.args) ? payload.args.slice(0, 20) : []).map((arg) => devPreview(arg, 600)).join(' ') });
        console[['warn', 'error', 'info'].includes(payload?.level) ? payload.level : 'log'](`[app:${plugin.id}]`, ...(Array.isArray(payload?.args) ? payload.args.slice(0, 20) : []));
        return true;
    }
    if (method === 'notification.show') {
        requirePermission(plugin, 'notifications');
        return showPluginNotification(record, payload || {});
    }
    if (method.startsWith('notification.')) {
        requirePermission(plugin, 'notifications');
        return handleScheduleRequest(record, method, payload || {});
    }
    if (method === 'permissions.status') return permissionStatus(plugin);
    if (method === 'permissions.request') return requestPermissions(record, payload?.names ?? []);
    if (method.startsWith('search.')) return handleSearchRequest(record, method, payload || {});
    if (method.startsWith('widgets.')) return handleWidgetRequest(record, method, payload || {});
    if (method.startsWith('statusItem.')) {
        requirePermission(plugin, 'statusItem');
        if (method === 'statusItem.set') return setStatusItem(record, payload || {});
        if (method === 'statusItem.patch') return patchStatusPanel(record, payload || {});
        if (method === 'statusItem.remove') { removeStatusItem(record); return true; }
        throw new Error(`Unknown plugin API method: ${method}`);
    }
    if (method.startsWith('storage.')) requirePermission(plugin, 'storage');
    if (method === 'storage.get') return pluginStorageGet(record.storageId, payload?.key ?? null);
    if (method === 'storage.set') { if (devOverride(plugin.id)?.storageFull) throw new Error('Plugin storage quota exceeded'); return pluginStorageSet(record.storageId, payload?.key, payload?.value, { unlimited: applicationUnrestricted(plugin) }); }
    if (method === 'storage.remove') return pluginStorageRemove(record.storageId, payload?.key);
    if (method === 'storage.clear') return pluginStorageClear(record.storageId);
    if (method === 'asset.get') {
        const path = cleanPackagePath(payload?.path || '');
        const recordAsset = path && record.runtimeAssets?.[path];
        if (!recordAsset) return '';
        if (recordAsset.stored) {
            const storageKey = appAssetStorageKey(plugin.id, path);
            const stored = (await storageGet([storageKey]))[storageKey];
            return stored ? dataUrlForRecord(stored) : '';
        }
        return dataUrlForRecord(recordAsset);
    }
    if (method === 'network.fetch') {
        requirePermission(plugin, 'network');
        if (devOverride(plugin.id)?.offline) throw new Error('Failed to fetch');
        const strict = appStrict(plugin);
        const free = applicationUnrestricted(plugin);
        const maxConcurrent = free ? Infinity : strict ? 4 : 16;
        record.networkInflight = Number(record.networkInflight) || 0;
        if (record.networkInflight >= maxConcurrent) throw new Error(`Too many concurrent plugin network requests (max ${maxConcurrent})`);
        const url = safeExternalUrl(payload?.url); if (!url) throw new Error('Only http/https URLs are allowed');
        if (strict && isPrivateNetworkHost(new URL(url).hostname)) throw new Error('Strict plugin security blocks requests to local and private network addresses');
        const options = payload?.options && typeof payload.options === 'object' ? payload.options : {};
        const methodName = ['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(String(options.method || 'GET').toUpperCase()) ? String(options.method || 'GET').toUpperCase() : 'GET';
        record.networkInflight += 1;
        try {
            const response = await fetch(url, { method: methodName, headers: options.headers && typeof options.headers === 'object' ? options.headers : undefined, body: ['GET','HEAD'].includes(methodName) ? undefined : String(options.body ?? '') });
            const meta = { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url, headers: Object.fromEntries([...response.headers.entries()].slice(0, 80)) };
            if (options.responseType === 'base64') {
                const bytes = new Uint8Array(await response.arrayBuffer());
                const limit = free ? Infinity : strict ? 3_000_000 : 12_000_000;
                if (bytes.length > limit) throw new Error(`Response is larger than the ${Math.round(limit / 1_000_000)} MB plugin limit`);
                return { ...meta, base64: bytesToBase64(bytes) };
            }
            const text = free ? await response.text() : (await response.text()).slice(0, strict ? 1_500_000 : 5_000_000);
            return { ...meta, text };
        } finally { record.networkInflight = Math.max(0, record.networkInflight - 1); }
    }
    const linked = handleLinkRequest(record, method, payload);
    if (linked !== undefined) return linked;
    const desktop = handleDesktopRequest(record, method, payload);
    if (desktop !== undefined) return desktop;
    if (method === 'openExternal') {
        requirePermission(plugin, 'openExternal'); const url = safeExternalUrl(payload?.url); if (!url) throw new Error('Only http/https URLs are allowed'); await chrome.tabs.create({ url }); return true;
    }
    if (method === 'clipboard.readText') { requirePermission(plugin, 'clipboardRead'); return (await navigator.clipboard.readText()).slice(0, 1_000_000); }
    if (method === 'clipboard.writeText') { requirePermission(plugin, 'clipboard'); await navigator.clipboard.writeText(String(payload?.text ?? '').slice(0, 100000)); return true; }
    if (method === 'menu.list') { requirePermission(plugin, 'menu'); return menuCommands(); }
    if (method === 'menu.invoke') { requirePermission(plugin, 'menu'); const command = String(payload?.command || ''); if (!invokeMenuCommand(command)) throw new Error('Unknown or unavailable menu command'); return true; }
    if (method === 'window.setTitle') { const title = String(payload?.title || plugin.name).slice(0, 120); record.title.textContent = title || plugin.name; return true; }
    if (method === 'window.resize') { fitPluginWindow(record.window, Number(payload?.width) || plugin.window.width, Number(payload?.height) || plugin.window.height); return true; }
    if (method === 'window.getBounds') { const w = record.window; return { left: Math.round(w.offsetLeft), top: Math.round(w.offsetTop), width: w.offsetWidth, height: w.offsetHeight, maximized: w.dataset.maximized === '1' }; }
    if (method === 'window.center') {
        const r = record.window.getBoundingClientRect();
        record.window.style.left = `${Math.max(0, Math.round((innerWidth - r.width) / 2))}px`;
        record.window.style.top = `${Math.max(26, Math.round((innerHeight - r.height) / 2))}px`;
        return true;
    }
    if (method === 'window.focus') { restoreManagedWindow(record.window); return true; }
    if (method === 'window.getFrame') return windowFrame(record);
    if (method === 'window.moveTo') return moveWindow(record, payload || {});
    if (method === 'window.drag') return dragWindow(record, payload || {});
    if (method === 'window.trackPointer') return trackPointer(record, payload?.on !== false);
    if (method === 'window.setShape') return setWindowShape(record, payload || {});
    if (method === 'window.setHitRegion') return setHitRegion(record, payload || {});
    if (method === 'window.hitLeave') return leaveHitRegion(record);
    if (method === 'window.setLevel') return setWindowLevel(record, payload || {});
    if (method === 'window.setAccentColor') {
        // null / '' returns to the manifest accent. Takes visible effect while the system accent is multicolor.
        const value = payload?.color == null || payload.color === '' ? null : String(payload.color).trim().toLowerCase();
        if (value !== null && !accentHex(value)) throw new Error('Accent must be one of blue, purple, pink, red, orange, yellow, green, graphite or #rrggbb');
        record.accent = value === null ? undefined : value;
        const color = applyPluginAccent(record);
        record.nativeUi?.refresh();
        return { accentColor: color, accentSetting: systemAccentSetting() };
    }
    if (method === 'window.setAppearance') {
        // The application's own light / dark choice; 'system' (or null) follows the system again.
        // null hands the choice back to the manifest's window.appearance.
        const stored = payload?.appearance == null || payload.appearance === '' ? '' : String(payload.appearance);
        if (stored && !['system', 'light', 'dark'].includes(stored)) throw new Error('Appearance must be system, light or dark');
        if ((plugin.appearance || '') !== stored) {
            plugin.appearance = stored;
            runAppearanceTransition(() => { for (const other of instancesOf(plugin.id)) { applyWindowAppearance(other); other.nativeUi?.refresh(); } });
            for (const other of instancesOf(plugin.id)) postToPlugin(other, { type: 'event', name: 'themechange', detail: { theme: appTheme(plugin), systemTheme: state.effectiveTheme || 'light', appearance: appAppearance(plugin) } });
            saveConfig().catch(() => {});
        }
        return { appearance: appAppearance(plugin), theme: appTheme(plugin) };
    }
    if (method === 'window.close') { closePluginWindow(record.key); return true; }
    // Escape that the app did not use for anything closes its window, as it does for
    // system windows. A field being typed in gives up focus instead.
    if (method === 'window.escape') {
        const active = document.activeElement;
        if (record.window.contains(active) && isEditableTarget(active)) { active.blur(); record.nativeFrame?.focus({ preventScroll: true }); return false; }
        // System Settings ▸ Desktop & Windows ▸ Close the Front Window with Esc.
        if (state.config.windows?.escapeCloses === false) return false;
        closePluginWindow(record.key); return true;
    }
    if (method === 'window.minimize') { minimizePluginWindow(record.key); return true; }
    if (method === 'system.getInfo') {
        const language = appLanguage(plugin);
        let region = ''; try { region = new Intl.Locale(language).region || ''; } catch {}
        return {
            language, region, direction: layoutDirection(), theme: appTheme(plugin), systemTheme: state.effectiveTheme || 'light', appearance: appAppearance(plugin),
            appVersion: chrome.runtime.getManifest().version, strictSecurity: appStrict(plugin),
            devicePixelRatio: (window.devicePixelRatio || 1) * appZoom(plugin), ...environmentInfo(record)
        };
    }
    throw new Error(`Unknown plugin API method: ${method}`);
}
