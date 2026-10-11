// Application runtime, shared state: the open windows, messaging to an application,
// its key/value storage, security level, permissions and appearance. Everything else in
// the plugin-*.js modules builds on this.

import { state } from './state.js';
import { t } from './i18n.js';
import { $ } from './utils.js';
import { devFlag, strictPluginSecurityEnabled } from './developer.js';
import { restoreManagedWindow } from './window-manager.js';
import { activeApplication } from './app-menu.js';
import { dev, devEmit, devOverride, devPreview } from './dev-hooks.js';
import { APP_STORAGE_PREFIX, CHANNEL_HOST, MAX_INSTANCES, PERMISSION_LOG_KEY } from './plugin-constants.js';
import { closePluginWindow } from './plugin-system.js';
import { storageGet, storageRemove, storageSet } from './plugin-package.js';
import { restartAsked } from './plugin-settings.js';

// Open application windows by instance key. An application normally has one window, whose
// key is the application id; further instances (Developer settings) are "<id>#<n>".
export const appWindows = new Map();
export const appOpenPromises = new Map();
export const compiledPackageCache = new Map();
// The plug-in whose window is in front (owns the menu bar and the keyboard shortcuts).
export const activePluginId = () => activeApplication()?.pluginId || '';

export function announceRunningApps() {
    // An accessory (window.showInDock: false) has no Dock icon while it runs — as long as its
    // menu bar item is there to reach it. Without one it shows in the Dock like any other.
    const accessory = (id) => instancesOf(id).some((record) => record.plugin.window.showInDock === false && record.statusItem);
    state.runningApps = new Map([...appWindows.values()].map((record) => [record.plugin.id, { name: record.plugin.name, icon: record.plugin.icon || '', accessory: accessory(record.plugin.id) }]));
    for (const id of restartAsked) if (!instancesOf(id).length) restartAsked.delete(id);
    window.dispatchEvent(new CustomEvent('macos-running-apps-changed'));
}
// ---- instances -------------------------------------------------------------------------
export const instancesOf = (id) => [...appWindows.values()].filter((record) => record.plugin.id === id);
export const instanceKey = (id, instance) => (instance > 1 ? `${id}#${instance}` : id);
// Further instances either share the application's storage (key/value and files) or get a
// pool of their own, kept per instance number so the second window finds its data again.
export const instanceStorageId = (plugin, instance) => (instance > 1 && plugin.instanceStorage === 'separate' ? `${plugin.id}#${instance}` : plugin.id);
const instanceLimit = () => Math.max(2, Math.min(MAX_INSTANCES, Number(state.config.developer?.instanceLimit) || 4));
/** Multiple instances are off unless Developer Mode allows them and the user enabled this application. */
export const multiInstanceAllowed = (plugin) => devFlag('multiInstance') && plugin?.multiInstance === true;
export const canOpenAnotherInstance = (plugin) => multiInstanceAllowed(plugin) && instancesOf(plugin.id).length < instanceLimit();
export function frontInstance(id) {
    let front = null; let frontZ = -Infinity;
    for (const record of instancesOf(id)) { const z = Number.parseInt(record.window.style.zIndex, 10) || 0; if (z >= frontZ) { front = record; frontZ = z; } }
    return front;
}
/** The Dock icon of a running application: every window of it comes back, the last used one in front. */
export function showPluginWindows(id) {
    const front = frontInstance(id);
    for (const record of instancesOf(id)) if (record !== front) restoreManagedWindow(record.window);
    if (front) restoreManagedWindow(front.window);
}
export const closePluginApp = (id) => instancesOf(id).forEach((record) => closePluginWindow(record.key));
// An event for an application that may still be starting: it is delivered once the
// application's script has run and its listeners exist.
export function postWhenReady(record, message) {
    if (record.ready) postToPlugin(record, message); else (record.pending ||= []).push(message);
}
// Input the user (or the system on the user's behalf) sent to an application. These are
// what Developer Tools records and plays back; events that merely report the result of
// something the application did (audio state, resize, progress) are not.
const RECORDABLE_EVENTS = new Set(['ui', 'keydown', 'keyup', 'menucommand', 'settings', 'search', 'widget', 'openurl', 'paste', 'statusitem', 'notificationclick']);
export function postToPlugin(record, message) {
    if (message.type === 'event') (record.stats || (record.stats = { calls: 0, events: 0, hostMs: 0 })).events += 1;
    if (dev.enabled && message.type === 'event' && !(message.name === 'audio' && message.detail?.type === 'timeupdate') && message.name !== 'desktopchange') devEmit('event', { app: record.key, name: message.name, text: devPreview(message.detail) });
    const recorder = dev.recorder;
    if (recorder && !dev.replaying && message.type === 'event' && recorder.app === record.key && RECORDABLE_EVENTS.has(message.name)) {
        try { recorder.events.push({ t: Math.round(performance.now() - recorder.start), name: message.name, detail: structuredClone(message.detail ?? {}) }); } catch { /* not cloneable: not recorded */ }
    }
    const payload = { channel: CHANNEL_HOST, instanceId: record.instanceId, token: record.token, ...message };
    try {
        if (record.port) record.port.postMessage(payload);
        else record.iframe?.contentWindow?.postMessage(payload, '*');
    } catch {}
}

function pluginStorageIndexKey(id) { return `${APP_STORAGE_PREFIX}${id}:index`; }
function pluginStorageValueKey(id, key) { return `${APP_STORAGE_PREFIX}${id}:k:${key}`; }
export function jsonSize(value) { try { return new Blob([JSON.stringify(value)]).size; } catch { return Infinity; } }
export async function pluginStorageIndex(id) {
    const key = pluginStorageIndexKey(id);
    const value = (await storageGet([key]))[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { keys: {}, total: 0 };
}
export async function pluginStorageGet(id, key = null) {
    const index = await pluginStorageIndex(id);
    if (key != null) {
        const userKey = String(key);
        if (!Object.hasOwn(index.keys || {}, userKey)) return undefined;
        const storageKey = pluginStorageValueKey(id, userKey);
        return (await storageGet([storageKey]))[storageKey];
    }
    const userKeys = Object.keys(index.keys || {});
    if (!userKeys.length) return {};
    const storageKeys = userKeys.map((userKey) => pluginStorageValueKey(id, userKey));
    const raw = await storageGet(storageKeys);
    const result = {};
    userKeys.forEach((userKey) => { const storageKey = pluginStorageValueKey(id, userKey); if (Object.hasOwn(raw, storageKey)) result[userKey] = raw[storageKey]; });
    return result;
}
export async function pluginStorageSet(id, key, value, { unlimited = false } = {}) {
    const userKey = String(key ?? '').slice(0, 160); if (!userKey) throw new Error('Storage key is required');
    const size = jsonSize(value); if (!Number.isFinite(size) || (size > 4_000_000 && !unlimited)) throw new Error('Plugin storage value is too large');
    const index = await pluginStorageIndex(id); index.keys ||= {};
    const previous = Number(index.keys[userKey]) || 0;
    const total = Math.max(0, (Number(index.total) || 0) - previous + size);
    if (total > 32_000_000 && !unlimited) throw new Error('Plugin storage quota exceeded');
    index.keys[userKey] = size; index.total = total;
    await storageSet({ [pluginStorageValueKey(id, userKey)]: structuredClone(value), [pluginStorageIndexKey(id)]: index });
    return true;
}
export async function pluginStorageRemove(id, key) {
    const userKey = String(key ?? ''); const index = await pluginStorageIndex(id);
    if (!Object.hasOwn(index.keys || {}, userKey)) return true;
    index.total = Math.max(0, (Number(index.total) || 0) - (Number(index.keys[userKey]) || 0)); delete index.keys[userKey];
    await storageRemove([pluginStorageValueKey(id, userKey)]); await storageSet({ [pluginStorageIndexKey(id)]: index }); return true;
}
export async function pluginStorageClear(id) {
    const index = await pluginStorageIndex(id); const keys = Object.keys(index.keys || {}).map((key) => pluginStorageValueKey(id, key));
    await storageRemove([...keys, pluginStorageIndexKey(id)]); return true;
}
// "Unrestricted" is a per-application exception the user grants by hand in Developer
// settings, and only while strict security is switched off and the unrestricted switch
// is on. Such an application may use every API without declaring the permission, and
// the host's quotas, size limits, rate limits and private-network block do not apply to
// it. It still runs in its sandboxed frame.
export const applicationUnrestricted = (plugin) => Boolean(plugin?.unrestricted) && devFlag('unrestrictedApps') && !strictPluginSecurityEnabled(state.config);
// Strict security is the rule for every application. With Developer ▸ Disable strict
// security on, the user may relax individual applications; nothing is relaxed by the
// switch alone, and a package cannot ask for it.
export const appStrict = (plugin) => strictPluginSecurityEnabled(state.config) || !(plugin?.relaxed === true || applicationUnrestricted(plugin));
/** 'strict' | 'relaxed' | 'unrestricted': the level an application effectively runs at. */
export const applicationSecurityLevel = (plugin) => (applicationUnrestricted(plugin) ? 'unrestricted' : appStrict(plugin) ? 'strict' : 'relaxed');
// The display scale Developer Tools simulates for an application (1 = none).
export const appZoom = (plugin) => Math.max(0.5, Math.min(3, Number(devOverride(plugin?.id)?.zoom) || 1));
// A permission the package declares (or any, for an unrestricted application) — unless
// Developer Tools is simulating its refusal.
// The user may switch a permission off for an application; that holds whatever its level.
export function permissionAllowed(plugin, name) { return (Boolean(plugin.permissions?.includes(name)) || applicationUnrestricted(plugin)) && !plugin.deniedPermissions?.includes(name) && !devOverride(plugin.id)?.deny?.includes(name); }

// ---- permission use ---------------------------------------------------------------------
// Which permissions each application actually used, how often and when last, and how
// often it was refused one: { appId: { permission: { count, last, denied, lastDenied } } }.
// Kept across sessions; shown in System Settings ▸ Applications and in Developer Tools.
let permissionLog = null; let permissionLogLoading = null; let permissionLogTimer = 0;
function loadPermissionLog() {
    permissionLogLoading ||= storageGet([PERMISSION_LOG_KEY]).then((data) => {
        const stored = data[PERMISSION_LOG_KEY] && typeof data[PERMISSION_LOG_KEY] === 'object' ? data[PERMISSION_LOG_KEY] : {};
        // Uses noted before the stored log arrived are added to it.
        for (const [id, entries] of Object.entries(permissionLog || {})) {
            stored[id] ||= {};
            for (const [name, use] of Object.entries(entries)) {
                const into = stored[id][name] ||= { count: 0, last: 0, denied: 0, lastDenied: 0 };
                into.count += use.count; into.denied += use.denied; into.last = Math.max(into.last, use.last); into.lastDenied = Math.max(into.lastDenied, use.lastDenied);
            }
        }
        permissionLog = stored;
        return permissionLog;
    });
    return permissionLogLoading;
}
export function notePermission(plugin, name, allowed) {
    permissionLog ||= {};
    loadPermissionLog();
    const use = (permissionLog[plugin.id] ||= {})[name] ||= { count: 0, last: 0, denied: 0, lastDenied: 0 };
    if (allowed) { use.count += 1; use.last = Date.now(); } else { use.denied += 1; use.lastDenied = Date.now(); }
    if (!permissionLogTimer) permissionLogTimer = setTimeout(() => { permissionLogTimer = 0; loadPermissionLog().then((log) => storageSet({ [PERMISSION_LOG_KEY]: log })).catch(() => {}); }, 1500);
}
/** Checks a permission for an API call and notes the use (or the refusal). */
export function requirePermission(plugin, name) {
    const allowed = permissionAllowed(plugin, name);
    notePermission(plugin, name, allowed);
    if (!allowed) throw new Error(`Permission denied: ${name}`);
}
/** What an application used: { permission: { count, last, denied, lastDenied } }. */
export async function applicationPermissionLog(id) { return structuredClone((await loadPermissionLog())[id] || {}); }
export async function clearApplicationPermissionLog(id) { const log = await loadPermissionLog(); delete log[id]; await storageSet({ [PERMISSION_LOG_KEY]: log }).catch(() => {}); }
// The language an application sees: the system's, or the one Developer Tools simulates for it.
export const appLanguage = (plugin) => devOverride(plugin.id)?.language || state.config.language || 'zh-CN';
// Strict mode keeps apps away from this machine and the local network: a plugin with the
// network permission could otherwise read a router admin page or a dev server through
// the host's cross-origin fetch.
export function isPrivateNetworkHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4) return false;
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
export function safeExternalUrl(url) { try { const u = new URL(String(url || '')); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
// What the application asked for: its own choice (macos.window.setAppearance) before the
// manifest's window.appearance. 'system' follows the system appearance.
export function appAppearance(plugin) {
    const own = plugin.appearance || plugin.window?.appearance;
    return own === 'dark' || own === 'light' ? own : 'system';
}
export function applyWindowAppearance(record) {
    const simulated = devOverride(record.plugin.id)?.theme;
    const theme = simulated === 'dark' || simulated === 'light' ? simulated : appAppearance(record.plugin);
    record.window.classList.toggle('plugin-app-force-dark', theme === 'dark');
    record.window.classList.toggle('plugin-app-force-light', theme === 'light');
}
export function appTheme(plugin) {
    const simulated = devOverride(plugin.id)?.theme;
    if (simulated === 'dark' || simulated === 'light') return simulated;
    const own = appAppearance(plugin);
    if (own !== 'system') return own;
    return state.effectiveTheme || (document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}
