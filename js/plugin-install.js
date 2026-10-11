// Installing, importing and exporting application and limit-overlay packages, and the
// launchers an application gets.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement, readFileAsText } from './utils.js';
import { showMacAlert, showMacConfirm } from './dialog.js';
import { extraFeaturesDisabled, strictPluginSecurityEnabled } from './developer.js';
import { devEmit } from './dev-hooks.js';
import { APP_COMPILED_PREFIX } from './plugin-constants.js';
import { appStrict, compiledPackageCache } from './plugin-core.js';
import { syncLauncherIcons } from './plugin-system.js';
import { cacheDisplayIcon, cleanId, compileApplicationPackage, packageForPlugin, pluginState, savePackageForPlugin, storageRemove, storeCompiledPackage, validateLimitOverlayPlugin } from './plugin-package.js';
import { renderApplicationManager, renderPluginManager } from './plugin-settings.js';

export async function importLimitOverlayPlugin(file) {
    if (extraFeaturesDisabled(state.config)) throw new Error(t('extraFeaturesDisabledMessage', '额外功能已关闭。'));
    const parsed = JSON.parse(await readFileAsText(file));
    const plugin = validateLimitOverlayPlugin(parsed);
    const cfg = pluginState();
    const existing = cfg.installed.findIndex((item) => item.id === plugin.id);
    if (existing >= 0) cfg.installed.splice(existing, 1, plugin); else cfg.installed.push(plugin);
    await saveConfig(); renderPluginManager(); return plugin;
}

export function launcherForPlugin(plugin) {
    return { name: plugin.name, enName: plugin.name, action: `pluginApp:${plugin.id}`, icon: plugin.icon || 'assets/icons/noicon.svg', originalIcon: plugin.icon || 'assets/icons/noicon.svg', isSystem: false, protected: false, useBg: !plugin.icon };
}
export function hasPluginLauncher(id) {
    const action = `pluginApp:${id}`;
    return ['launchpadApps', 'desktopApps', 'dockApps', 'quickLinks'].some((key) => (state.config[key] || []).some((app) => app?.action === action));
}
export async function addPluginLauncher(plugin, { save = true } = {}) {
    if (!plugin || hasPluginLauncher(plugin.id)) return false;
    state.config.launchpadApps ||= []; state.config.launchpadApps.push(launcherForPlugin(plugin));
    if (save) await saveConfig();
    window.dispatchEvent(new CustomEvent('macos-plugin-launchers-updated'));
    return true;
}
export function removePluginLaunchers(id) {
    const action = `pluginApp:${id}`;
    for (const key of ['launchpadApps', 'desktopApps', 'dockApps', 'quickLinks']) if (Array.isArray(state.config[key])) state.config[key] = state.config[key].filter((app) => app?.action !== action);
}

/** Installs (or updates) an application from its package object. `source` marks a package loaded from a folder by Developer Tools. */
export async function installApplicationPackage(parsed, { source = '' } = {}) {
    if (extraFeaturesDisabled(state.config)) throw new Error(t('extraFeaturesDisabledMessage', '额外功能已关闭。'));
    const previous = pluginState().apps.find((item) => item.id === cleanId(parsed?.id));
    let relaxed = previous?.relaxed === true;
    let compiled;
    try { compiled = compileApplicationPackage(parsed, { strict: appStrict(previous) }); }
    catch (error) {
        // The package does not fit under strict security. Only with the Developer switch
        // on, and only if the user says so for this one application, is it installed relaxed.
        if (strictPluginSecurityEnabled(state.config) || !appStrict(previous) || !/^macos-app-package-v3$/.test(parsed?.format || '')) throw error;
        try { compileApplicationPackage(parsed, { strict: false }); } catch { throw error; }
        const ok = await showMacConfirm(t('installRelaxedQuestion', '以宽松安全性安装“{name}”？').replace('{name}', String(parsed?.name || parsed?.id || '')), {
            title: t('installApplicationTitle', '安装应用程序'), detail: `${error?.message || ''}\n\n${t('installRelaxedDetail', '这个应用程序超出了严格安全性的限制。以宽松安全性安装后，它可以使用更大的包、外部资源和更高的配额，但仍在沙盒中运行。只对你信任的应用程序这样做。')}`,
            confirmLabel: t('installRelaxedConfirm', '以宽松安全性安装'), cancelLabel: t('cancel', '取消'), danger: true });
        if (!ok) throw error;
        relaxed = true;
        compiled = compileApplicationPackage(parsed, { strict: false });
    }
    const cachedIcon = await cacheDisplayIcon(compiled.metadata.icon);
    const plugin = { ...compiled.metadata, icon: cachedIcon, packageStored: true, autoStart: previous?.autoStart === true, multiInstance: previous?.multiInstance === true, instanceStorage: previous?.instanceStorage === 'separate' ? 'separate' : 'shared', unrestricted: previous?.unrestricted === true, relaxed, notifications: previous?.notifications !== false, appearance: previous?.appearance || '',
        deniedPermissions: (previous?.deniedPermissions || []).filter((name) => compiled.metadata.permissions.includes(name)) };
    await savePackageForPlugin(plugin.id, parsed);
    const mode = appStrict(plugin) ? 'strict' : 'relaxed';
    const other = mode === 'strict' ? 'relaxed' : 'strict';
    // The copy compiled for the other security mode belongs to the previous package.
    compiledPackageCache.delete(`${plugin.id}:${other}`);
    await storageRemove([APP_COMPILED_PREFIX + plugin.id + ':' + other]);
    const cachedCompiled = await storeCompiledPackage(plugin.id, compiled, mode);
    compiledPackageCache.set(`${plugin.id}:${mode}`, cachedCompiled);
    const cfg = pluginState();
    const existing = cfg.apps.findIndex((item) => item.id === plugin.id);
    if (existing >= 0) cfg.apps.splice(existing, 1, plugin); else cfg.apps.push(plugin);
    await addPluginLauncher(plugin, { save: false });
    if (syncLauncherIcons()) window.dispatchEvent(new CustomEvent('macos-plugin-launchers-updated'));
    await saveConfig(); renderApplicationManager();
    devEmit('system', { name: 'app installed', text: `${plugin.id} ${plugin.version}${source ? ` from ${source}` : ''}` });
    return plugin;
}
export async function importApplicationPlugin(file) {
    return installApplicationPackage(JSON.parse(await readFileAsText(file)));
}

function exportJson(value, id, suffix) {
    if (!value) return;
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${id}.${suffix}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function exportLimitOverlayPlugin(id) {
    const plugin = pluginState().installed.find((item) => item.id === id); exportJson(plugin, plugin?.id || id, 'macos-limit-plugin');
}
export async function exportApplicationPlugin(id) {
    const plugin = pluginState().apps.find((item) => item.id === id); if (!plugin) return;
    try { exportJson(await packageForPlugin(plugin), plugin.id, 'macos-app'); }
    catch (error) { await showMacAlert(error?.message || t('appPackageMissing', '应用程序包不存在或已损坏。'), { title: t('error', '错误') }); }
}

export function permissionLabel(permission) { return t(`appPermission_${permission}`, permission); }
export function appIcon(plugin, size = 42) {
    const wrap = createElement('span', { className: 'plugin-app-icon' }); wrap.style.width = `${size}px`; wrap.style.height = `${size}px`;
    if (plugin.icon) wrap.appendChild(createElement('img', { attrs: { src: plugin.icon, alt: '' } })); else wrap.textContent = '◫';
    return wrap;
}
