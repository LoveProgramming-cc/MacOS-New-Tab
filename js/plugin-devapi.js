// What Developer Tools needs from the application runtime.

import { state } from './state.js';
import { $ } from './utils.js';
import { toggleZoomManagedWindow } from './window-manager.js';
import { getBlobRecord, listBlobs, removeBlob } from './plugin-blobs.js';
import { dev } from './dev-hooks.js';
import { appLanguage, appTheme, appWindows, appZoom, applicationSecurityLevel, applyWindowAppearance, closePluginApp, frontInstance, instancesOf, pluginStorageGet, pluginStorageRemove, pluginStorageSet, postToPlugin, postWhenReady } from './plugin-core.js';
import { fitPluginWindow, openPluginApp, refreshNativeTranslations } from './plugin-system.js';
import { packageForPlugin, pluginState } from './plugin-package.js';
import { downloadBlob } from './plugin-files.js';
import { storagePools } from './plugin-data.js';

// ---- Developer Tools ------------------------------------------------------------------
/** Installed applications with their open instances. */
export function devApplications() {
    return pluginState().apps.map((plugin) => ({
        id: plugin.id, name: plugin.name, version: plugin.version, runtime: plugin.runtime, icon: plugin.icon || '', permissions: plugin.permissions || [], bundled: Boolean(plugin.packagePath), security: applicationSecurityLevel(plugin),
        instances: instancesOf(plugin.id).map((record) => ({ key: record.key, instance: record.instance, storageId: record.storageId, native: Boolean(record.nativeUi), crashed: record.window.classList.contains('plugin-app-crashed') }))
    }));
}
export const devNativeUi = (key) => appWindows.get(key)?.nativeUi || null;
export const devWindowOf = (key) => appWindows.get(key)?.window || null;
/** Closes every window of an application and opens the same instances again (after its package changed). */
export async function devReloadApplication(id) {
    const instances = instancesOf(id).map((record) => record.instance).sort((a, b) => a - b);
    closePluginApp(id);
    for (const instance of instances.length ? instances : [1]) await openPluginApp(id, { instance });
}
/** Simulated conditions for one application: { language, theme, deny, offline, storageFull } (null clears them). */
export function devSetOverride(id, override) {
    if (override && Object.values(override).some((value) => (Array.isArray(value) ? value.length : value))) dev.overrides.set(id, override); else dev.overrides.delete(id);
    for (const record of instancesOf(id)) {
        applyWindowAppearance(record);
        refreshNativeTranslations(record);
        applyAppZoom(record);
        postToPlugin(record, { type: 'event', name: 'resize', detail: { width: Math.round(record.window.offsetWidth / appZoom(record.plugin)), height: Math.round(record.window.offsetHeight / appZoom(record.plugin)) } });
        postToPlugin(record, { type: 'event', name: 'languagechange', detail: { language: appLanguage(record.plugin) } });
        postToPlugin(record, { type: 'event', name: 'themechange', detail: { theme: appTheme(record.plugin), systemTheme: state.effectiveTheme || 'light' } });
        requestAnimationFrame(() => record.nativeUi?.refresh());
    }
}
export function applyAppZoom(record) {
    const zoom = appZoom(record.plugin);
    for (const frame of [record.nativeFrame, record.runtimeApp?.mode === 'native' ? null : record.iframe]) if (frame) frame.style.zoom = zoom === 1 ? '' : String(zoom);
}
/** Resizes an application's windows to a size Developer Tools picked (within what the screen allows). */
export function devSetWindowSize(id, width, height) {
    for (const record of instancesOf(id)) {
        const win = record.window;
        if (win.dataset.maximized === '1') toggleZoomManagedWindow(win);
        // A preset may be smaller or larger than the limits the manifest gives the user.
        win.style.minWidth = `${Math.min(record.plugin.window.minWidth, width)}px`; win.style.minHeight = `${Math.min(record.plugin.window.minHeight, height)}px`;
        if (record.plugin.window.maxWidth) win.style.maxWidth = `${Math.max(record.plugin.window.maxWidth, width)}px`;
        if (record.plugin.window.maxHeight) win.style.maxHeight = `${Math.max(record.plugin.window.maxHeight, height)}px`;
        fitPluginWindow(win, width, height);
    }
}
export const devWindowSizeOf = (id) => { const win = frontInstance(id)?.window; return win ? { width: win.offsetWidth, height: win.offsetHeight } : null; };
export const devManifestWindow = (id) => pluginState().apps.find((app) => app.id === id)?.window || null;
/** Sends an event to a running application, as the host would (Developer Tools playback). */
export function devSendEvent(key, name, detail) {
    const record = appWindows.get(key);
    if (!record) return false;
    postWhenReady(record, { type: 'event', name: String(name), detail });
    return true;
}
/** Resolves true once the application's script has run (false if its window closed first). */
export function devWhenReady(key) {
    const record = appWindows.get(key);
    if (!record) return Promise.resolve(false);
    if (record.ready) return Promise.resolve(true);
    return new Promise((resolve) => (record.readyWaiters ||= []).push(resolve));
}
export const devPackageOf = (id) => { const plugin = pluginState().apps.find((app) => app.id === id); return plugin ? packageForPlugin(plugin) : Promise.reject(new Error('Unknown application')); };
/** An application's storage, by pool (the application's own, and one per further instance that has data). */
export const devStorage = {
    pools: (id) => storagePools(id),
    entries: (pool) => pluginStorageGet(pool, null),
    set: (pool, key, value) => pluginStorageSet(pool, key, value),
    remove: (pool, key) => pluginStorageRemove(pool, key),
    files: (pool) => listBlobs(pool),
    removeFile: (pool, fileId) => removeBlob(pool, fileId),
    async exportFile(pool, fileId) { const stored = await getBlobRecord(pool, fileId); if (stored) downloadBlob(stored.blob, stored.name); }
};
