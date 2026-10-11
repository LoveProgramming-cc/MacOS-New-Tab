// System Settings pages about applications: the application manager with permissions,
// notifications, instances and security levels.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { showMacConfirm } from './dialog.js';
import { createButton, createSwitch } from './ui-kit.js';
import { devFlag, extraFeaturesDisabled, strictPluginSecurityEnabled } from './developer.js';
import { clearNotifications } from './notifications.js';
import { openGlassMenu } from './glass-select.js';
import { applicationPermissionLog, applicationSecurityLevel, clearApplicationPermissionLog, closePluginApp, instancesOf, permissionAllowed } from './plugin-core.js';
import { openPluginApp } from './plugin-system.js';
import { deletePackageForPlugin, pluginState } from './plugin-package.js';
import { addPluginLauncher, appIcon, exportApplicationPlugin, exportLimitOverlayPlugin, hasPluginLauncher, launcherForPlugin, permissionLabel, removePluginLaunchers } from './plugin-install.js';
import { retireMedia } from './plugin-media.js';
import { removeStatusItem, searchIndexCache } from './plugin-integration.js';
import { widgetsChanged } from './plugin-widgets.js';
import { devReloadApplication } from './plugin-devapi.js';
import { clearApplicationPools } from './plugin-data.js';

export function renderPluginManager() {
    const host = $('limit-plugin-list');
    if (host) {
        host.replaceChildren(); const suspended = extraFeaturesDisabled(state.config); host.classList.toggle('plugin-runtime-disabled', suspended);
        const active = pluginState().activeLimitOverlay || 'builtin';
        // The built-in overlay's own options sit under the chooser, and only while it is chosen.
        const builtinSettings = $('limit-builtin-settings'); if (builtinSettings) builtinSettings.hidden = active !== 'builtin';
        const builtin = createElement('div', { className: `plugin-row${active === 'builtin' ? ' active' : ''}` });
        const builtinInfo = createElement('div', { className: 'plugin-row-info' }); builtinInfo.append(createElement('strong', { text: t('builtInOverlay', '内置遮罩') }), createElement('span', { text: t('builtInOverlayHint', '支持自定义文字、图片、字体与尺寸。') }));
        const useBuiltin = createButton(active === 'builtin' ? t('active', '已启用') : t('use', '使用'), { primary: active !== 'builtin', onClick: async () => { pluginState().activeLimitOverlay = 'builtin'; await saveConfig(); renderPluginManager(); } });
        useBuiltin.disabled = suspended || active === 'builtin'; builtin.append(builtinInfo, useBuiltin); host.appendChild(builtin);
        pluginState().installed.forEach((plugin) => {
            const row = createElement('div', { className: `plugin-row${active === plugin.id ? ' active' : ''}` });
            const info = createElement('div', { className: 'plugin-row-info' }); info.append(createElement('strong', { text: plugin.name }), createElement('span', { text: `${plugin.id} · v${plugin.version}` }));
            const actions = createElement('div', { className: 'plugin-row-actions' });
            const use = createButton(active === plugin.id ? t('active', '已启用') : t('use', '使用'), { primary: active !== plugin.id, onClick: async () => { pluginState().activeLimitOverlay = plugin.id; await saveConfig(); renderPluginManager(); } }); use.disabled = suspended || active === plugin.id;
            const exp = createButton(t('exportPlugin', '导出'), { onClick: () => exportLimitOverlayPlugin(plugin.id) });
            const del = createButton(t('btnDelete', '删除'), { danger: true, onClick: async () => { pluginState().installed = pluginState().installed.filter((item) => item.id !== plugin.id); if (pluginState().activeLimitOverlay === plugin.id) pluginState().activeLimitOverlay = 'builtin'; await saveConfig(); renderPluginManager(); } });
            exp.disabled = suspended; del.disabled = suspended; actions.append(use, exp, del); row.append(info, actions); host.appendChild(row);
        });
    }
    renderApplicationManager();
}

export function renderApplicationManager() {
    const host = $('application-plugin-list'); if (!host) return;
    host.replaceChildren(); const suspended = extraFeaturesDisabled(state.config); host.classList.toggle('plugin-runtime-disabled', suspended);
    const apps = pluginState().apps;
    renderInstanceSettings();
    renderSecuritySettings();
    renderNotificationSettings();
    window.dispatchEvent(new CustomEvent('macos-applications-rendered'));
    if (!apps.length) host.appendChild(createElement('div', { className: 'plugin-app-empty', text: t('noApplicationsInstalled', '尚未安装应用程序插件。') }));
    apps.forEach((plugin) => {
        // Two lines per application: identity on top, controls underneath. The Settings
        // pane is narrow, and a single row squeezed the description into a few characters.
        const row = createElement('div', { className: 'application-plugin-row', dataset: { pluginId: plugin.id } });
        const head = createElement('div', { className: 'application-plugin-head' });
        head.appendChild(appIcon(plugin));
        const info = createElement('div', { className: 'application-plugin-info' });
        const heading = createElement('div', { className: 'application-plugin-heading' });
        heading.append(createElement('strong', { text: plugin.name }), createElement('span', { className: 'application-plugin-version', text: `v${plugin.version}` }));
        if (plugin.runtime === 'native') heading.appendChild(createElement('span', { className: 'application-plugin-badge', text: t('appRuntimeNative', '原生') }));
        info.appendChild(heading);
        if (plugin.description) info.appendChild(createElement('span', { className: 'application-plugin-description', text: plugin.description }));
        head.appendChild(info);
        // Its permissions stay folded away until asked for: each can be switched off there,
        // and shows what was actually used of it.
        const off = (plugin.deniedPermissions || []).length;
        const summary = `${t('permissions', '权限')} · ${(plugin.permissions || []).length}${off ? ` · ${t('permissionsOff', '已关闭 {count} 项').replace('{count}', String(off))}` : ''}`;
        const disclosure = createElement('button', { className: 'permission-disclosure', attrs: { type: 'button', 'aria-expanded': String(expandedPermissions.has(plugin.id)) } });
        disclosure.append(createElement('span', { className: 'permission-disclosure-chevron', text: '›' }), createElement('span', { text: summary }));
        info.appendChild(disclosure);
        const showPermissions = () => {
            if (info.querySelector('.permission-usage-list')) return;
            info.appendChild(permissionUsageList(plugin));
            disclosure.setAttribute('aria-expanded', 'true');
        };
        disclosure.addEventListener('click', () => {
            if (expandedPermissions.delete(plugin.id)) { info.querySelector('.permission-usage-list')?.remove(); disclosure.setAttribute('aria-expanded', 'false'); }
            else { expandedPermissions.add(plugin.id); showPermissions(); }
        });
        if (expandedPermissions.has(plugin.id)) showPermissions();

        const footer = createElement('div', { className: 'application-plugin-footer' });
        // Launch at startup is only ever changed by this switch.
        const autoStart = createSwitch({ checked: plugin.autoStart === true, disabled: suspended, ariaLabel: t('appAutoStart', '打开新标签页时启动') });
        autoStart.input.addEventListener('change', async () => { plugin.autoStart = autoStart.input.checked; await saveConfig(); });
        const autoStartRow = createElement('label', { className: 'application-plugin-autostart', attrs: { title: t('appAutoStartHint', '每次打开新标签页时自动打开此应用程序。') } });
        autoStartRow.append(autoStart.root, createElement('span', { text: t('appAutoStart', '打开新标签页时启动') }));

        const actions = createElement('div', { className: 'application-plugin-actions' });
        const open = createButton(t('open', '打开'), { primary: true, onClick: () => openPluginApp(plugin.id) }); open.disabled = suspended;
        const launcher = createButton(hasPluginLauncher(plugin.id) ? t('launcherAdded', '已加入启动台') : t('addToLaunchpad', '加入启动台'), { onClick: async () => { await addPluginLauncher(plugin); renderApplicationManager(); } }); launcher.disabled = suspended || hasPluginLauncher(plugin.id);
        const exp = createButton(t('exportPlugin', '导出'), { onClick: () => exportApplicationPlugin(plugin.id) });
        const del = createButton(t('btnDelete', '删除'), { danger: true, onClick: async () => {
            const ok = await showMacConfirm(t('deleteApplicationPluginQuestion', '确定要卸载“{name}”吗？').replace('{name}', plugin.name), { title: t('uninstallApplication', '卸载应用程序'), confirmLabel: t('btnDelete', '删除'), cancelLabel: t('cancel', '取消'), danger: true });
            if (!ok) return; closePluginApp(plugin.id); pluginState().apps = pluginState().apps.filter((item) => item.id !== plugin.id); removePluginLaunchers(plugin.id); if (plugin.packageStored) await deletePackageForPlugin(plugin.id);
            // Uninstalling removes the app's own data as well: its key/value storage and stored files.
            await clearApplicationPools(plugin.id);
            await clearApplicationPermissionLog(plugin.id);
            searchIndexCache.delete(plugin.id);
            // Its widgets leave the desktop and the widget centre with it.
            for (const place of ['desktop', 'center']) if (state.config.widgets?.[place]) state.config.widgets[place] = state.config.widgets[place].filter((widget) => !(widget.type === 'app' && widget.appId === plugin.id));
            widgetsChanged(plugin.id);
            await saveConfig(); renderApplicationManager(); window.dispatchEvent(new CustomEvent('macos-plugin-launchers-updated'));
        } });
        exp.disabled = suspended; del.disabled = suspended; actions.append(open, launcher, exp, del);
        footer.append(autoStartRow, actions);
        row.append(head, footer); host.appendChild(row);
    });
}

const usageTime = (at) => new Date(at).toLocaleString(state.config.language || 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/**
 * An application's permissions, one row each: a switch that lets the user take the
 * permission away, and how often and when it was last used (filled in once the log is read).
 */
// Applications whose permission list is unfolded in Settings ▸ Applications, and those
// that were told a change needs them to be reopened.
const expandedPermissions = new Set();
export const restartAsked = new Set();
/** Opens System Settings ▸ Applications at one application, with its permissions unfolded. */
export function revealApplicationPermissions(id) {
    expandedPermissions.add(id);
    window.dispatchEvent(new CustomEvent('macos-open-settings-tab', { detail: { id: 'set-applications' } }));
    renderApplicationManager();
    requestAnimationFrame(() => {
        const row = document.querySelector(`#application-plugin-list [data-plugin-id="${CSS.escape(id)}"]`);
        row?.scrollIntoView({ block: 'center' });
        row?.classList.add('settings-search-highlight');
        setTimeout(() => row?.classList.remove('settings-search-highlight'), 1400);
    });
}
// A running application learns of a changed permission only by being refused (or served)
// in the middle of what it was doing. It is reopened, now or when the user gets to it.
async function offerRestart(plugin) {
    if (!instancesOf(plugin.id).length || restartAsked.has(plugin.id)) return;
    restartAsked.add(plugin.id);
    const now = await showMacConfirm(t('permissionRestartQuestion', '重新打开“{name}”使更改生效？').replace('{name}', plugin.name), {
        title: t('permissions', '权限'), icon: plugin.icon || '', confirmLabel: t('permissionRestartNow', '重新打开'), cancelLabel: t('permissionRestartLater', '稍后'),
        detail: t('permissionRestartDetail', '应用程序正在运行。权限的更改在它下次打开时才完全生效。')
    });
    if (!now) return;
    restartAsked.delete(plugin.id);
    await devReloadApplication(plugin.id);
}
// macos.permissions: an application may see which of its declared permissions the user
// has switched off, and ask for them. Only the user can switch one back on, in System
// Settings; the request shows where.
export function permissionStatus(plugin) {
    return Object.fromEntries((plugin.permissions || []).map((name) => [name, permissionAllowed(plugin, name) ? 'granted' : 'denied']));
}
export async function requestPermissions(record, names) {
    const { plugin } = record;
    const wanted = [...new Set((Array.isArray(names) ? names : [names]).map(String))].filter((name) => plugin.permissions?.includes(name));
    const denied = wanted.filter((name) => !permissionAllowed(plugin, name));
    if (!denied.length) return wanted.length > 0;
    // One request per permission and launch: an application cannot nag.
    record.permissionAsked ||= new Set();
    const fresh = denied.filter((name) => !record.permissionAsked.has(name));
    if (!fresh.length) return false;
    fresh.forEach((name) => record.permissionAsked.add(name));
    const open = await showMacConfirm(t('permissionRequestQuestion', '“{name}”想使用：{permissions}').replace('{name}', plugin.name).replace('{permissions}', fresh.map(permissionLabel).join('、')), {
        title: plugin.name, icon: plugin.icon || '', confirmLabel: t('permissionRequestOpen', '打开系统设置'), cancelLabel: t('permissionRequestDeny', '不允许'),
        detail: t('permissionRequestDetail', '这些权限已在系统设置中关闭。你可以在“应用程序”里重新打开；之后需要重新打开这个应用程序。')
    });
    if (open) revealApplicationPermissions(plugin.id);
    return false;
}
function permissionUsageList(plugin) {
    const list = createElement('div', { className: 'permission-usage-list' });
    const suspended = extraFeaturesDisabled(state.config);
    const describe = (name, use = { count: 0, last: 0, denied: 0, lastDenied: 0 }) => {
        const parts = [use.count ? t('permissionUsed', '用过 {count} 次，最近 {time}').replace('{count}', String(use.count)).replace('{time}', usageTime(use.last)) : t('permissionNeverUsed', '从未使用')];
        if (use.denied) parts.push(t('permissionRefused', '被拒绝 {count} 次，最近 {time}').replace('{count}', String(use.denied)).replace('{time}', usageTime(use.lastDenied)));
        if (!plugin.permissions?.includes(name)) parts.push(t('permissionUndeclared', '未声明'));
        return parts.join(' · ');
    };
    const row = (name, use) => {
        const denied = Boolean(plugin.deniedPermissions?.includes(name));
        const node = createElement('div', { className: `permission-usage-row${denied ? ' denied' : ''}`, dataset: { permission: name } });
        node.append(createElement('span', { className: 'permission-usage-name', text: permissionLabel(name) }), createElement('span', { className: 'permission-usage-detail', text: use === undefined ? '' : describe(name, use) }));
        if (plugin.permissions?.includes(name)) {
            const allow = createSwitch({ checked: !denied, disabled: suspended, ariaLabel: permissionLabel(name) });
            allow.input.addEventListener('change', async () => {
                plugin.deniedPermissions = (plugin.deniedPermissions || []).filter((item) => item !== name);
                if (!allow.input.checked) plugin.deniedPermissions.push(name);
                node.classList.toggle('denied', !allow.input.checked);
                // What the permission gave a running application is taken back at once.
                if (!allow.input.checked) for (const record of instancesOf(plugin.id)) {
                    if (name === 'statusItem') removeStatusItem(record);
                    if (name === 'audio') { try { record.audioPausing = false; record.audio?.pause(); record.outgoingMedia?.forEach(retireMedia); record.outgoingMedia?.clear(); } catch { /* not playing */ } }
                }
                if (name === 'widgets') widgetsChanged(plugin.id);
                await saveConfig();
                offerRestart(plugin);
            });
            node.appendChild(allow.root);
        }
        return node;
    };
    for (const name of plugin.permissions || []) list.appendChild(row(name));
    if (!plugin.permissions?.length) list.appendChild(createElement('div', { className: 'permission-usage-row unused', text: t('noExtraPermissions', '无额外权限') }));
    applicationPermissionLog(plugin.id).then((log) => {
        for (const name of new Set([...(plugin.permissions || []), ...Object.keys(log)])) {
            const existing = list.querySelector(`[data-permission="${CSS.escape(name)}"]`);
            if (existing) { existing.querySelector('.permission-usage-detail').textContent = describe(name, log[name]); existing.classList.toggle('unused', !log[name]?.count); }
            else list.appendChild(row(name, log[name]));
        }
    }).catch(() => {});
    return list;
}

// System Settings ▸ Notifications: which applications may show notifications.
function renderNotificationSettings() {
    const host = $('notification-app-list'); if (!host) return;
    host.replaceChildren();
    const apps = pluginState().apps.filter((plugin) => plugin.permissions?.includes('notifications'));
    for (const plugin of apps) {
        const row = createElement('div', { className: 'card-row developer-instance-row', dataset: { pluginId: plugin.id } });
        const identity = createElement('div', { className: 'developer-instance-app' });
        identity.append(appIcon(plugin, 26), createElement('span', { text: plugin.name }));
        const allow = createSwitch({ checked: plugin.notifications !== false, ariaLabel: t('notificationAllow', '允许通知') });
        allow.input.addEventListener('change', async () => { plugin.notifications = allow.input.checked; if (!allow.input.checked) clearNotifications(plugin.id); await saveConfig(); });
        row.append(identity, allow.root); host.appendChild(row);
    }
    if (!apps.length) host.appendChild(createElement('div', { className: 'card-row developer-setting-note', text: t('notificationNoApps', '没有会发送通知的应用程序。') }));
}

// Developer settings: which applications may have more than one window, and whether the
// further windows share the application's storage.
function renderInstanceSettings() {
    const host = $('developer-instance-apps'); if (!host) return;
    host.replaceChildren();
    const developerOn = Boolean(state.config.developer?.enabled);
    const enabled = devFlag('multiInstance');
    for (const plugin of pluginState().apps) {
        const row = createElement('div', { className: `card-row developer-instance-row${developerOn ? '' : ' developer-row-locked'}${enabled ? '' : ' developer-instance-off'}`, dataset: { pluginId: plugin.id } });
        const identity = createElement('div', { className: 'developer-instance-app' });
        identity.append(appIcon(plugin, 26), createElement('span', { text: plugin.name }));
        const controls = createElement('div', { className: 'developer-instance-controls' });
        const allow = createSwitch({ checked: plugin.multiInstance === true, disabled: !enabled, ariaLabel: t('instanceAllow', '允许多开') });
        const share = createSwitch({ checked: plugin.instanceStorage !== 'separate', disabled: !enabled || plugin.multiInstance !== true, ariaLabel: t('instanceShareStorage', '共享储存') });
        allow.input.addEventListener('change', async () => { plugin.multiInstance = allow.input.checked; share.input.disabled = !allow.input.checked; await saveConfig(); });
        share.input.addEventListener('change', async () => { plugin.instanceStorage = share.input.checked ? 'shared' : 'separate'; await saveConfig(); });
        const labelled = (control, text, hint) => { const label = createElement('label', { className: 'developer-instance-option', attrs: { title: hint } }); label.append(createElement('span', { text }), control.root); return label; };
        controls.append(
            labelled(share, t('instanceShareStorage', '共享储存'), t('instanceShareStorageHint', '打开时，新开的窗口与第一个窗口使用同一份数据和文件；关闭时，每个新窗口有自己独立的一份。')),
            labelled(allow, t('instanceAllow', '允许多开'), t('instanceAllowHint', '允许这个应用程序同时打开多个窗口。'))
        );
        row.append(identity, controls); host.appendChild(row);
    }
    if (!pluginState().apps.length) host.appendChild(createElement('div', { className: 'card-row developer-instance-row developer-setting-note', text: t('noApplicationsInstalled', '尚未安装应用程序插件。') }));
}

/** Keeps an application in the Dock (at `index`, or at the end of the applications). */
export async function pinApplicationToDock(id, index = null) {
    const plugin = pluginState().apps.find((app) => app.id === id);
    const action = `pluginApp:${id}`;
    state.config.dockApps ||= [];
    if (!plugin || state.config.dockApps.some((app) => app?.action === action)) return false;
    const at = Number.isInteger(index) ? Math.max(0, Math.min(state.config.dockApps.length, index)) : state.config.dockApps.length;
    state.config.dockApps.splice(at, 0, launcherForPlugin(plugin));
    await saveConfig();
    window.dispatchEvent(new CustomEvent('macos-plugin-launchers-updated'));
    return true;
}
export async function unpinApplicationFromDock(id) {
    const action = `pluginApp:${id}`;
    const before = (state.config.dockApps || []).length;
    state.config.dockApps = (state.config.dockApps || []).filter((app) => app?.action !== action);
    if (state.config.dockApps.length === before) return false;
    await saveConfig();
    window.dispatchEvent(new CustomEvent('macos-plugin-launchers-updated'));
    return true;
}
export const pinnedInDock = (id) => (state.config.dockApps || []).some((app) => app?.action === `pluginApp:${id}`);

// Developer settings: the security level of each application. Strict is the rule; with
// "Disable strict security" on an application may be relaxed, and with "Unrestricted
// applications" on (see applicationUnrestricted) it may be exempted from the limits.
function renderSecuritySettings() {
    const host = $('developer-security-list'); if (!host) return;
    host.replaceChildren();
    const available = !strictPluginSecurityEnabled(state.config);
    host.hidden = !available;
    if (!available) return;
    const unrestrictedOn = devFlag('unrestrictedApps');
    const labels = { strict: t('securityStrict', '严格'), relaxed: t('securityRelaxed', '宽松'), unrestricted: t('unrestrictedAllow', '不受限制') };
    for (const plugin of pluginState().apps) {
        const row = createElement('div', { className: 'card-row developer-instance-row', dataset: { pluginId: plugin.id } });
        const identity = createElement('div', { className: 'developer-instance-app' });
        identity.append(appIcon(plugin, 26), createElement('span', { text: plugin.name }));
        const level = applicationSecurityLevel(plugin);
        const select = createElement('div', { className: 'mac-custom-select', attrs: { role: 'button', 'aria-label': t('securityLevel', '安全级别') }, dataset: { value: level } });
        select.append(createElement('span', { className: 'selected-text', text: labels[level] }), createElement('span', { text: '▾' }));
        select.addEventListener('click', (event) => {
            event.stopPropagation();
            const options = [{ value: 'strict', label: labels.strict }, { value: 'relaxed', label: labels.relaxed }, ...(unrestrictedOn ? [{ value: 'unrestricted', label: labels.unrestricted }] : [])];
            openGlassMenu(select, options, level, async (value) => {
                if (value === level) return;
                plugin.relaxed = value !== 'strict';
                plugin.unrestricted = value === 'unrestricted';
                await saveConfig();
                // The level is fixed when a window is created: the application starts again under the new one.
                closePluginApp(plugin.id);
                renderSecuritySettings();
            });
        });
        row.append(identity, select); host.appendChild(row);
    }
    if (!pluginState().apps.length) host.appendChild(createElement('div', { className: 'card-row developer-instance-row developer-setting-note', text: t('noApplicationsInstalled', '尚未安装应用程序插件。') }));
}
