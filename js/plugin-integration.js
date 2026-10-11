// Where an application reaches into the desktop: notifications, Spotlight, the menu bar
// status item and menu shortcuts.

import { state } from './state.js';
import { $, createElement } from './utils.js';
import { extraFeaturesDisabled } from './developer.js';
import { restoreManagedWindow } from './window-manager.js';
import { createNativeRenderer, menuJustClosedBy, normalizeNativeTree, showNativeMenu } from './plugin-native-ui.js';
import { accentHex, hexToRgbList, systemAccentSetting } from './accent.js';
import { cancelScheduledNotification, pushNotification, scheduleNotification, scheduledNotifications } from './notifications.js';
import { APP_SEARCH_PREFIX, SEARCH_ITEM_LIMIT } from './plugin-constants.js';
import { activePluginId, announceRunningApps, appStrict, appWindows, applicationUnrestricted, frontInstance, postToPlugin, postWhenReady } from './plugin-core.js';
import { openPluginApp } from './plugin-system.js';
import { imageSourceKind, nativeTranslate, pluginState, storageGet, storageRemove, storageSet } from './plugin-package.js';
import { resolveImageSource, runtimeHasImageAsset } from './plugin-files.js';

// Notifications go through the system (notifications.js): a banner, and an entry in
// Notification Center that stays until the user opens or clears it. An application the
// user switched off in System Settings ▸ Notifications shows nothing.
export function showPluginNotification(record, payload) {
    if (record.plugin.notifications === false) return '';
    return pushNotification({ appId: record.plugin.id, appKey: record.key, appName: record.plugin.name, icon: record.plugin.icon || '',
        title: payload.title, body: payload.body, tag: payload.tag, duration: payload.duration, actions: payload.actions });
}
/** notification.schedule / cancel / scheduled: shown by the system at a time, whether or not a new tab is open. */
export function handleScheduleRequest(record, method, payload) {
    const { plugin } = record;
    if (method === 'notification.schedule') return scheduleNotification({ appId: plugin.id, appName: plugin.name, id: payload.id, at: payload.at, title: payload.title, body: payload.body, tag: payload.tag, actions: payload.actions });
    if (method === 'notification.cancel') return cancelScheduledNotification(plugin.id, payload.id ?? null);
    if (method === 'notification.scheduled') return scheduledNotifications(plugin.id);
    throw new Error(`Unknown plugin API method: ${method}`);
}
// Opening a notification brings its application forward — starting it if it is not
// running — and tells it which one: 'notificationclick' { id, tag, action }. `action` is the
// id of the button that was pressed, '' when it was the notification itself. A button never
// runs anything while the application is closed: it is one more way of opening it.
export async function activateNotification(entry, action = '') {
    const message = { type: 'event', name: 'notificationclick', detail: { id: entry.id, tag: entry.tag || '', action: String(action || '') } };
    let record = appWindows.get(entry.appKey) || frontInstance(entry.appId);
    if (!record) { await openPluginApp(entry.appId); record = frontInstance(entry.appId); }
    if (!record) return;
    restoreManagedWindow(record.window);
    postWhenReady(record, message);
}

// ---- Spotlight ------------------------------------------------------------------------
// An application lists what Spotlight may find in it (macos.search.setItems): songs,
// books, notes. The list is kept with the application's data, so its content is found
// while it is not running; choosing a result opens the application and sends it
// 'search' { id, query }.
export const searchIndexCache = new Map(); // application id -> items
function cleanSearchItems(raw, limit) {
    const items = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        if (items.length >= limit) break;
        const id = String(item?.id ?? '').slice(0, 160); const title = String(item?.title ?? '').trim().slice(0, 160);
        if (!id || !title) continue;
        items.push({ id, title, subtitle: String(item.subtitle ?? '').trim().slice(0, 200), keywords: String(Array.isArray(item.keywords) ? item.keywords.join(' ') : item.keywords ?? '').slice(0, 300) });
    }
    return items;
}
export async function handleSearchRequest(record, method, payload) {
    const id = record.plugin.id;
    if (method === 'search.clear') { searchIndexCache.set(id, []); await storageRemove([APP_SEARCH_PREFIX + id]); return true; }
    if (method === 'search.setItems') {
        const limit = applicationUnrestricted(record.plugin) ? 100_000 : appStrict(record.plugin) ? SEARCH_ITEM_LIMIT.strict : SEARCH_ITEM_LIMIT.relaxed;
        const items = cleanSearchItems(payload?.items, limit);
        searchIndexCache.set(id, items);
        await storageSet({ [APP_SEARCH_PREFIX + id]: items });
        return items.length;
    }
    throw new Error(`Unknown plugin API method: ${method}`);
}
/** Everything installed applications offer to Spotlight: [{ plugin, items }]. */
export async function applicationSearchIndex() {
    if (extraFeaturesDisabled(state.config)) return [];
    const apps = pluginState().apps;
    const missing = apps.filter((app) => !searchIndexCache.has(app.id));
    if (missing.length) {
        const stored = await storageGet(missing.map((app) => APP_SEARCH_PREFIX + app.id));
        for (const app of missing) searchIndexCache.set(app.id, Array.isArray(stored[APP_SEARCH_PREFIX + app.id]) ? stored[APP_SEARCH_PREFIX + app.id] : []);
    }
    return apps.map((plugin) => ({ plugin, items: searchIndexCache.get(plugin.id) || [] }));
}
/** Opens the application and hands it the chosen Spotlight result. */
export async function openApplicationSearchResult(appId, itemId, query = '') {
    await openPluginApp(appId, { announce: false });
    const record = frontInstance(appId);
    if (!record) return false;
    restoreManagedWindow(record.window);
    postWhenReady(record, { type: 'event', name: 'search', detail: { id: String(itemId), query: String(query).slice(0, 200) } });
    return true;
}

// ---- status items ---------------------------------------------------------------------
// An application may keep one item on the right of the menu bar while it runs
// (macos.statusItem, permission: statusItem): a short title and / or an icon, with a menu.
// Choosing a menu entry — or clicking an item that has no menu — sends 'statusitem' { id }.
function statusItemHost() {
    let host = $('status-items');
    if (!host) { host = createElement('span', { className: 'status-items', attrs: { id: 'status-items' } }); document.querySelector('#menu-bar .menu-right')?.prepend(host); }
    return host;
}
export function removeStatusItem(record) {
    const had = Boolean(record.statusItem);
    if (openPanel?.record === record) closeStatusPanel();
    record.statusItem?.panel?.element.remove();
    record.statusItem?.element.remove();
    record.statusItem = null;
    if (had) announceRunningApps();
}

// A status item may have a panel instead of (or as well as) a menu: a small native UI tree
// the host draws in a popover under the item — what is playing, with its controls. It is
// drawn by the host from what the application last sent, like a widget; its controls report
// as 'statusitem' { id, event, value }, and it stays open while they are used. With both a
// panel and a menu, a click opens the panel and a right-click the menu.
const PANEL_NODE_TYPES = new Set(['stack', 'group', 'zstack', 'grid', 'card', 'text', 'button', 'image', 'progress', 'slider', 'switch', 'segmented', 'canvas', 'spacer', 'separator']);
const PANEL_NODE_LIMIT = 120;
let openPanel = null;        // { record, cleanup }
function assertPanelTree(node) {
    if (!PANEL_NODE_TYPES.has(node.type)) throw new Error(`A status item panel cannot contain a "${node.type}" node`);
    for (const child of node.children || []) assertPanelTree(child);
}
function placeStatusPanel(record) {
    const item = record.statusItem; const panel = item.panel.element;
    const box = item.element.getBoundingClientRect();
    const width = panel.offsetWidth;
    const left = Math.max(8, Math.min(innerWidth - width - 8, box.left + box.width / 2 - width / 2));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(box.bottom + 6)}px`;
}
function closeStatusPanel() {
    if (!openPanel) return;
    const { record, cleanup } = openPanel;
    openPanel = null;
    cleanup();
    record.statusItem?.panel?.element.classList.add('hidden');
    record.statusItem?.element.classList.remove('active');
    if (appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'statusitem', detail: { id: '', event: 'close' } });
}
function openStatusPanel(record) {
    closeStatusPanel();
    const item = record.statusItem; const panel = item.panel.element;
    panel.classList.remove('hidden');
    item.element.classList.add('active');
    placeStatusPanel(record);
    const outside = (event) => { if (!panel.contains(event.target) && !item.element.contains(event.target)) closeStatusPanel(); };
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeStatusPanel(); } };
    const blur = () => closeStatusPanel();   // a press inside an application's own document
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    addEventListener('blur', blur);
    addEventListener('resize', blur);
    openPanel = { record, cleanup: () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); removeEventListener('blur', blur); removeEventListener('resize', blur); } };
    postToPlugin(record, { type: 'event', name: 'statusitem', detail: { id: '', event: 'open' } });
}
function setStatusPanel(record, item, raw) {
    if (raw == null) {
        if (openPanel?.record === record) closeStatusPanel();
        item.panel?.element.remove(); item.panel = null;
        return;
    }
    const normalized = normalizeNativeTree(structuredClone(raw), {
        maxNodes: PANEL_NODE_LIMIT,
        validSource: (value) => { const kind = imageSourceKind(value); return kind === 'asset' ? runtimeHasImageAsset(record, value) : Boolean(kind); },
        sanitizeHtml: () => '', sanitizeCss: () => ''
    });
    if (!normalized?.root) throw new Error('The status item panel is not a valid UI tree');
    assertPanelTree(normalized.root);
    if (item.panel) { item.panel.ui.render(structuredClone(normalized.root)); if (openPanel?.record === record) placeStatusPanel(record); return; }
    const element = createElement('div', { className: 'status-panel mac-acrylic window-shadow hidden', dataset: { pluginId: record.plugin.id } });
    const frame = createElement('div', { className: 'status-panel-frame plugin-native-app-frame' });
    const own = systemAccentSetting() === 'multicolor' ? accentHex(record.accent || record.plugin.accentColor) : '';
    if (own) { frame.style.setProperty('--app-accent', own); frame.style.setProperty('--app-accent-rgb', hexToRgbList(own)); }
    element.appendChild(frame);
    document.body.appendChild(element);
    const ui = createNativeRenderer({
        frame, tree: structuredClone(normalized.root), maxNodes: PANEL_NODE_LIMIT,
        validSource: (value) => Boolean(imageSourceKind(value)), sanitizeHtml: () => '', sanitizeCss: () => '',
        translate: (key, fallback) => nativeTranslate(record, key, fallback),
        resolveSource: (value) => resolveImageSource(record, value),
        motion: () => false,
        emit: (detail) => { if (appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'statusitem', detail: { ...detail, id: String(detail?.id || '') } }); }
    });
    item.panel = { element, ui };
}
/** statusItem.patch: changes properties of nodes in the panel ([{ id, props }]) without sending it again. */
export function patchStatusPanel(record, payload) {
    const ui = record.statusItem?.panel?.ui;
    if (!ui) return false;
    for (const patch of (Array.isArray(payload?.patches) ? payload.patches.slice(0, 200) : [])) { try { ui.patch(String(patch?.id || ''), patch?.props || {}); } catch { /* a node that is not there now */ } }
    return true;
}
export async function setStatusItem(record, payload) {
    const title = String(payload?.title ?? '').trim().slice(0, 24);
    const iconSource = payload?.icon ? await resolveImageSource(record, payload.icon).catch(() => '') : '';
    if (appWindows.get(record.key) !== record) return false;
    if (!title && !iconSource) throw new Error('A status item needs a title or an icon');
    const item = record.statusItem || { element: createElement('span', { className: 'status-item', attrs: { role: 'button', tabindex: '-1' }, dataset: { pluginId: record.plugin.id } }), items: [], panel: null };
    const element = item.element;
    element.replaceChildren();
    if (iconSource) {
        // A template icon takes the menu bar's text colour, whatever its own colours are.
        const icon = createElement('span', { className: `status-item-icon${payload.template === false ? '' : ' template'}` });
        if (payload.template === false) icon.style.backgroundImage = `url("${iconSource}")`;
        else icon.style.webkitMaskImage = icon.style.maskImage = `url("${iconSource}")`;
        element.appendChild(icon);
    }
    if (title) element.appendChild(createElement('span', { className: 'status-item-title', text: title }));
    element.title = String(payload?.tooltip ?? record.plugin.name).slice(0, 120);
    item.items = Array.isArray(payload?.items) ? payload.items.slice(0, 40) : [];
    // `panel` left out keeps the panel as it is; null removes it.
    if (payload && 'panel' in payload) setStatusPanel(record, item, payload.panel);
    if (!record.statusItem) {
        const send = (id) => { if (appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'statusitem', detail: { id } }); };
        const menu = () => {
            if (menuJustClosedBy(element)) return;
            const box = element.getBoundingClientRect();
            element.classList.add('active');
            showNativeMenu(item.items, box.left - 6, box.bottom + 4, (key, fallback) => nativeTranslate(record, key, fallback), { anchor: element, onClose: () => { if (openPanel?.record !== record) element.classList.remove('active'); } })
                .then((choice) => { if (choice != null) send(String(choice)); });
        };
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            if (item.panel) { if (openPanel?.record === record) closeStatusPanel(); else openStatusPanel(record); return; }
            if (!item.items.length) return send('');
            menu();
        });
        element.addEventListener('contextmenu', (event) => {
            if (!item.panel || !item.items.length) return;
            event.preventDefault(); event.stopPropagation();
            closeStatusPanel();
            menu();
        });
        statusItemHost().appendChild(element);
        record.statusItem = item;
        announceRunningApps();
    }
    return true;
}

// Application menu shortcuts. "⇧⌘S", "Cmd+Shift+S" and "Ctrl+S" style strings are
// understood; ⌘ also matches Ctrl so the same package works off the Mac. Combinations
// the browser reserves for itself (⌘T, ⌘W, ⌘N, …) never reach the page and cannot be bound.
function parseShortcut(text) {
    let rest = String(text || '').trim();
    if (!rest) return null;
    const spec = { meta: false, ctrl: false, alt: false, shift: false, key: '' };
    const words = [[/^(?:⌘|cmd|command|meta)\+?/i, 'meta'], [/^(?:⌃|ctrl|control)\+?/i, 'ctrl'], [/^(?:⌥|alt|option|opt)\+?/i, 'alt'], [/^(?:⇧|shift)\+?/i, 'shift']];
    for (let matched = true; matched;) {
        matched = false;
        for (const [pattern, flag] of words) {
            const hit = rest.match(pattern);
            if (hit && hit[0].length < rest.length) { spec[flag] = true; rest = rest.slice(hit[0].length).trim(); matched = true; }
        }
    }
    const names = { '⏎': 'ENTER', '↩': 'ENTER', RETURN: 'ENTER', '⌫': 'BACKSPACE', DELETE: 'BACKSPACE', '⎋': 'ESCAPE', ESC: 'ESCAPE', SPACE: ' ', '←': 'ARROWLEFT', '→': 'ARROWRIGHT', '↑': 'ARROWUP', '↓': 'ARROWDOWN' };
    const key = rest.toUpperCase();
    spec.key = names[key] || key;
    return spec.key ? spec : null;
}
function shortcutMatches(spec, event) {
    if (!spec || event.key.toUpperCase() !== spec.key) return false;
    const command = event.metaKey || event.ctrlKey;
    if (spec.meta ? !command : (event.metaKey || (event.ctrlKey && !spec.ctrl))) return false;
    if (spec.ctrl && !event.ctrlKey) return false;
    return spec.alt === event.altKey && spec.shift === event.shiftKey;
}
export function handleApplicationShortcut(event) {
    const record = appWindows.get(activePluginId());
    if (!record || record.window.classList.contains('hidden') || event.isComposing) return;
    for (const menu of record.plugin.menus || []) {
        for (const item of menu.items || []) {
            if (item.separator || item.disabled || !item.shortcut) continue;
            const spec = parseShortcut(item.shortcut);
            if (!spec || !(spec.meta || spec.ctrl || spec.alt)) continue; // bare keys are never global shortcuts
            if (!shortcutMatches(spec, event)) continue;
            event.preventDefault();
            event.stopPropagation();
            postToPlugin(record, { type: 'event', name: 'menucommand', detail: { command: item.command } });
            return;
        }
    }
}
