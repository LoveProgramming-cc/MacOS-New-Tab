import { state } from './state.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';

// Notifications. A notification is shown as a banner for a few seconds and kept in
// Notification Center (the panel behind the menu bar clock, above the widgets) until the
// user opens or clears it. The history survives closing the tab.
//
//   pushNotification({ appId, appKey, appName, icon, title, body, tag, duration, actions }) -> id
//   setNotificationActivator(fn)   fn(entry, action) runs when a banner or a history entry is
//                                  clicked; action is the id of the button, '' for the card
//
// With Do Not Disturb on (System Settings ▸ Notifications) banners are not shown; the
// notification still arrives in Notification Center.

const HISTORY_KEY = 'macOS_notification_history_v1';
const SCHEDULE_KEY = 'macOS_scheduled_notifications_v1';   // background-notifications.js delivers these
const OPEN_KEY = 'macOS_notification_open_v1';
const SCHEDULE_LIMIT = 64;                                  // per application
const LIMIT = 80;
let history = [];            // newest first: { id, appId, appKey, appName, title, body, tag, at, actions }
const ACTION_LIMIT = 3;
let loaded = null;
let activator = null;
let sequence = 0;
let unseen = 0;

const centerOpen = () => Boolean($('widget-center')) && !$('widget-center').classList.contains('hidden');
const iconOf = (entry) => (state.config?.plugins?.apps || []).find((app) => app.id === entry.appId)?.icon || entry.icon || '';

function load() {
    loaded ||= new Promise((resolve) => {
        try {
            chrome.storage.local.get([HISTORY_KEY], (data) => {
                const stored = Array.isArray(data?.[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
                // Anything pushed before the stored history arrived stays on top.
                const known = new Set(history.map((entry) => entry.id));
                history = [...history, ...stored.filter((entry) => entry && typeof entry.id === 'string' && !known.has(entry.id))].slice(0, LIMIT);
                resolve();
            });
        } catch { resolve(); }
    });
    return loaded;
}
function cleanActions(raw) {
    const actions = [];
    for (const action of Array.isArray(raw) ? raw : []) {
        const id = String(action?.id ?? '').slice(0, 80); const title = String(action?.title ?? '').trim().slice(0, 40);
        if (!id || !title || actions.some((item) => item.id === id)) continue;
        actions.push({ id, title, destructive: Boolean(action.destructive) });
        if (actions.length >= ACTION_LIMIT) break;
    }
    return actions;
}
function persist() {
    try { chrome.storage.local.set({ [HISTORY_KEY]: history.map(({ icon, ...entry }) => entry) }); } catch { /* history is best effort */ }
}

function timeLabel(at) {
    const language = state.config?.language || 'zh-CN';
    const minutes = Math.round((Date.now() - at) / 60_000);
    try {
        if (minutes < 1) return t('notificationNow', '现在');
        const relative = new Intl.RelativeTimeFormat(language, { numeric: 'always', style: 'narrow' });
        if (minutes < 60) return relative.format(-minutes, 'minute');
        if (minutes < 60 * 24) return relative.format(-Math.round(minutes / 60), 'hour');
        return new Date(at).toLocaleDateString(language, { month: 'short', day: 'numeric' });
    } catch { return new Date(at).toLocaleTimeString(); }
}
function card(entry, { banner = false, onAction = null } = {}) {
    const node = createElement('div', { className: `app-notification mac-acrylic window-shadow${banner ? '' : ' in-center'}`, attrs: { role: banner ? 'status' : 'listitem' }, dataset: { notificationId: entry.id } });
    const icon = createElement('span', { className: 'plugin-app-icon' });
    icon.style.width = icon.style.height = '32px';
    const source = iconOf(entry);
    if (source) icon.appendChild(createElement('img', { attrs: { src: source, alt: '' } })); else icon.textContent = '◫';
    const body = createElement('div', { className: 'app-notification-body' });
    const head = createElement('div', { className: 'app-notification-head' });
    head.append(createElement('span', { className: 'app-notification-app', text: entry.appName || '' }), createElement('span', { className: 'app-notification-time', text: timeLabel(entry.at) }));
    body.append(head, createElement('div', { className: 'app-notification-title', text: entry.title || '' }), createElement('div', { className: 'app-notification-text', text: entry.body || '' }));
    // Up to three buttons the application asked for. Each one opens the application, like the
    // card itself, and tells it which button it was.
    if (entry.actions?.length) {
        const row = createElement('div', { className: 'app-notification-actions' });
        for (const action of entry.actions) {
            const button = createElement('button', { className: `app-notification-action${action.destructive ? ' destructive' : ''}`, text: action.title, attrs: { type: 'button' } });
            button.addEventListener('click', (event) => { event.stopPropagation(); onAction?.(action.id); });
            row.appendChild(button);
        }
        body.appendChild(row);
    }
    node.append(icon, body);
    if (!banner) {
        const close = createElement('button', { className: 'app-notification-close', text: '×', attrs: { type: 'button', 'aria-label': t('clear', '清除') } });
        close.addEventListener('click', (event) => { event.stopPropagation(); removeNotification(entry.id); });
        node.appendChild(close);
    }
    return node;
}
function activate(entry, action = '') {
    removeNotification(entry.id);
    try { activator?.(entry, action); } catch { /* the application is gone */ }
}

function syncIndicator() {
    $('clock')?.classList.toggle('has-notifications', unseen > 0);
}
function ensureCenter() {
    const center = $('widget-center');
    if (!center) return null;
    let host = $('notification-center');
    if (host) return host;
    host = createElement('div', { className: 'notification-center', attrs: { id: 'notification-center' } });
    const head = createElement('div', { className: 'notification-center-head' });
    const clear = createElement('button', { className: 'notification-center-clear', attrs: { type: 'button', id: 'notification-center-clear' } });
    clear.addEventListener('click', (event) => { event.stopPropagation(); clearNotifications(); });
    head.append(createElement('span', { className: 'notification-center-title' }), clear);
    host.append(head, createElement('div', { className: 'notification-center-list', attrs: { id: 'notification-center-list', role: 'list' } }));
    center.prepend(host);
    return host;
}
export function renderNotificationCenter() {
    const host = ensureCenter();
    if (!host) return;
    host.hidden = history.length === 0;
    host.querySelector('.notification-center-title').textContent = t('notificationCenter', '通知中心');
    host.querySelector('.notification-center-clear').textContent = t('notificationClearAll', '全部清除');
    const list = $('notification-center-list');
    list.replaceChildren(...history.map((entry) => {
        const node = card(entry, { onAction: (action) => activate(entry, action) });
        node.addEventListener('click', () => activate(entry));
        return node;
    }));
}

function showBanner(entry, duration) {
    let stack = $('app-notification-stack');
    if (!stack) { stack = createElement('div', { className: 'app-notification-stack', attrs: { id: 'app-notification-stack', 'aria-live': 'polite' } }); document.body.appendChild(stack); }
    const dismiss = () => { node.classList.add('leaving'); setTimeout(() => node.remove(), 220); };
    const node = card(entry, { banner: true, onAction: (action) => { dismiss(); activate(entry, action); } });
    node.addEventListener('click', () => { dismiss(); activate(entry); });
    while (stack.children.length >= 4) stack.firstElementChild.remove();
    stack.appendChild(node);
    // A banner with buttons stays while the pointer is on it, so a button can be reached.
    const life = Math.max(2000, Math.min(15000, Number(duration) || 5000));
    let timer = setTimeout(dismiss, life);
    if (entry.actions?.length) {
        node.addEventListener('pointerenter', () => clearTimeout(timer));
        node.addEventListener('pointerleave', () => { clearTimeout(timer); timer = setTimeout(dismiss, 1500); });
    }
}

/** Shows a notification and files it in Notification Center. Returns its id. */
export function pushNotification({ appId = '', appKey = '', appName = '', icon = '', title = '', body = '', tag = '', duration = 5000, actions = [] } = {}) {
    load();
    const entry = {
        id: `n${Date.now().toString(36)}${(sequence += 1)}`, appId: String(appId), appKey: String(appKey || appId), appName: String(appName).slice(0, 120), icon,
        title: String(title).slice(0, 120), body: String(body).slice(0, 400), tag: String(tag).slice(0, 80), at: Date.now(), actions: cleanActions(actions)
    };
    // A notification with a tag replaces the application's earlier one with that tag.
    if (entry.tag) history = history.filter((item) => !(item.appId === entry.appId && item.tag === entry.tag));
    history = [entry, ...history].slice(0, LIMIT);
    persist();
    // With Notification Center open the notification is simply seen arriving there.
    if (centerOpen()) renderNotificationCenter();
    else {
        unseen += 1; syncIndicator(); renderNotificationCenter();
        if (!state.config?.notifications?.doNotDisturb) showBanner(entry, duration);
    }
    return entry.id;
}
export function removeNotification(id) {
    const before = history.length;
    history = history.filter((entry) => entry.id !== id);
    if (history.length === before) return;
    persist(); renderNotificationCenter();
}
export function clearNotifications(appId = '') {
    history = appId ? history.filter((entry) => entry.appId !== appId) : [];
    persist(); renderNotificationCenter();
}
export const notificationHistory = () => history.slice();
export function setNotificationActivator(fn) { activator = typeof fn === 'function' ? fn : null; }

// ---- scheduled notifications ------------------------------------------------------------
// macos.notifications.schedule(): the list is kept in storage; the service worker shows each
// one when its time comes, whether or not a new tab is open.
const readScheduled = () => new Promise((resolve) => { try { chrome.storage.local.get([SCHEDULE_KEY], (data) => resolve(Array.isArray(data?.[SCHEDULE_KEY]) ? data[SCHEDULE_KEY] : [])); } catch { resolve([]); } });
const writeScheduled = (list) => new Promise((resolve) => { try { chrome.storage.local.set({ [SCHEDULE_KEY]: list }, () => resolve()); } catch { resolve(); } });
let scheduleChain = Promise.resolve();
const withSchedule = (task) => { const run = scheduleChain.then(task, task); scheduleChain = run.catch(() => {}); return run; };
export function scheduleNotification({ appId, appName, id, at, title, body, tag, actions }) {
    const when = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : Number(at);
    if (!Number.isFinite(when)) throw new Error('schedule needs `at`: a time in milliseconds, or a date');
    const key = String(id ?? '').slice(0, 80) || `s${Date.now().toString(36)}${(sequence += 1)}`;
    return withSchedule(async () => {
        const list = (await readScheduled()).filter((entry) => !(entry.appId === appId && entry.id === key));
        if (list.filter((entry) => entry.appId === appId).length >= SCHEDULE_LIMIT) throw new Error(`An application can have at most ${SCHEDULE_LIMIT} notifications scheduled`);
        list.push({ appId: String(appId), appName: String(appName || '').slice(0, 120), id: key, at: Math.round(when), title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 400), tag: String(tag || '').slice(0, 80), actions: cleanActions(actions) });
        await writeScheduled(list);
        return key;
    });
}
/** Cancels one scheduled notification of an application, or all of them (id null). */
export function cancelScheduledNotification(appId, id = null) {
    return withSchedule(async () => {
        const list = await readScheduled();
        const next = list.filter((entry) => entry.appId !== appId || (id != null && entry.id !== String(id)));
        if (next.length !== list.length) await writeScheduled(next);
        return list.length - next.length;
    });
}
export async function scheduledNotifications(appId) {
    return (await readScheduled()).filter((entry) => entry.appId === appId).map(({ id, at, title, body, tag }) => ({ id, at, title, body, tag })).sort((a, b) => a.at - b.at);
}
// What the service worker filed while this page was open: taken into the list here, with a
// banner when the page is the one being looked at.
const adopted = new Set();
function adoptDelivered(stored) {
    const known = new Set(history.map((entry) => entry.id));
    const fresh = (Array.isArray(stored) ? stored : []).filter((entry) => entry?.scheduled && typeof entry.id === 'string' && !known.has(entry.id) && !adopted.has(entry.id));
    if (!fresh.length) return;
    for (const entry of fresh) {
        adopted.add(entry.id);
        if (entry.tag) history = history.filter((item) => !(item.appId === entry.appId && item.tag === entry.tag));
    }
    history = [...fresh, ...history].sort((a, b) => b.at - a.at).slice(0, LIMIT);
    renderNotificationCenter();
    if (centerOpen()) return;
    unseen += fresh.length; syncIndicator();
    if (document.visibilityState === 'visible' && !state.config?.notifications?.doNotDisturb) for (const entry of fresh) if (Date.now() - entry.at < 20_000) showBanner(entry, 6000);
}
/** The user clicked the operating system's notification: open that one here. */
export async function openRequestedNotification() {
    if (document.visibilityState !== 'visible') return;
    await load();
    const request = await new Promise((resolve) => { try { chrome.storage.local.get([OPEN_KEY], (data) => resolve(data?.[OPEN_KEY] || null)); } catch { resolve(null); } });
    if (!request || Date.now() - Number(request.at || 0) > 120_000) return;
    try { chrome.storage.local.remove([OPEN_KEY]); } catch { /* another page took it */ }
    const entry = history.find((item) => item.id === request.id);
    if (entry) activate(entry);
}

let bound = false;
export function bindNotificationCenter() {
    if (bound) return; bound = true;
    const center = $('widget-center');
    load().then(renderNotificationCenter);
    if (center) {
        // Opening Notification Center is seeing what is in it; the times are refreshed too.
        // Banners still on screen give way: the same notifications are in the list now.
        new MutationObserver(() => { if (centerOpen()) { unseen = 0; syncIndicator(); $('app-notification-stack')?.replaceChildren(); renderNotificationCenter(); } }).observe(center, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('macos-language-change', renderNotificationCenter);
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if (changes[HISTORY_KEY]) load().then(() => adoptDelivered(changes[HISTORY_KEY].newValue));
            if (changes[OPEN_KEY]?.newValue) openRequestedNotification();
        });
    } catch { /* no extension storage: nothing is scheduled either */ }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') openRequestedNotification(); });
}
