// Scheduled notifications (macos.notifications.schedule), delivered by the service worker.
//
// An application hands the system a notification and a time. Nothing of the application runs
// for it: at that time the worker files the notification in Notification Center and — when no
// new tab page is in front to show it as a banner — shows it as a notification of the
// operating system, so it arrives although no new tab is open. Clicking that one opens a new
// tab, which opens the application and tells it ('notificationclick').

import { STORAGE_KEY } from './constants.js';

export const SCHEDULE_KEY = 'macOS_scheduled_notifications_v1';
const HISTORY_KEY = 'macOS_notification_history_v1';
const OPEN_KEY = 'macOS_notification_open_v1';
const ALARM = 'macOsScheduledNotificationsV1';
const HISTORY_LIMIT = 80;
// Something to show when the application has no icon the notification can use.
const BLANK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const getLocal = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setLocal = (value) => new Promise((resolve) => chrome.storage.local.set(value, () => resolve()));

let chain = Promise.resolve();
const serialize = (task) => { const run = chain.then(task, task); chain = run.catch(() => {}); return run; };

async function scheduled() {
    const list = (await getLocal([SCHEDULE_KEY]))[SCHEDULE_KEY];
    return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.appId === 'string' && Number.isFinite(entry.at)) : [];
}
async function arm() {
    const list = await scheduled();
    if (!list.length) { try { await chrome.alarms.clear(ALARM); } catch {} return; }
    chrome.alarms.create(ALARM, { when: Math.max(Date.now() + 1000, Math.min(...list.map((entry) => entry.at))) });
}
/** Is one of this extension's own pages the tab the user is looking at? */
async function pageInFront() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const url = tab?.url || tab?.pendingUrl || '';
        if (!(url.startsWith(chrome.runtime.getURL('')) || /^chrome:\/\/newtab\/?/.test(url))) return false;
        const win = await chrome.windows.get(tab.windowId);
        return Boolean(win?.focused) && win.state !== 'minimized';
    } catch { return false; }
}
async function deliver() {
    const now = Date.now();
    const list = await scheduled();
    const due = list.filter((entry) => entry.at <= now + 500);
    if (!due.length) return arm();
    const stored = await getLocal([STORAGE_KEY, HISTORY_KEY]);
    const cfg = stored[STORAGE_KEY] || {};
    const apps = Array.isArray(cfg.plugins?.apps) ? cfg.plugins.apps : [];
    let history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    const banners = [];
    for (const item of due) {
        const app = apps.find((candidate) => candidate.id === item.appId);
        // Uninstalled since, notifications switched off, or the permission taken away: dropped.
        if (!app || app.notifications === false || app.deniedPermissions?.includes('notifications')) continue;
        const entry = {
            id: `s${item.at.toString(36)}${Math.random().toString(36).slice(2, 7)}`, appId: item.appId, appKey: item.appId, appName: String(app.name || item.appName || ''),
            title: String(item.title || ''), body: String(item.body || ''), tag: String(item.tag || `scheduled:${item.id}`), at: now, actions: Array.isArray(item.actions) ? item.actions : [], scheduled: true
        };
        history = [entry, ...history.filter((other) => !(other.appId === entry.appId && other.tag === entry.tag))].slice(0, HISTORY_LIMIT);
        banners.push({ entry, icon: typeof app.icon === 'string' && app.icon.startsWith('data:image/') && !app.icon.startsWith('data:image/svg') ? app.icon : BLANK_ICON });
    }
    await setLocal({ [SCHEDULE_KEY]: list.filter((entry) => !due.includes(entry)), [HISTORY_KEY]: history });
    // The page in front shows the banner itself (it sees the history change).
    if (banners.length && !cfg.notifications?.doNotDisturb && !(await pageInFront())) {
        for (const { entry, icon } of banners) {
            try { chrome.notifications.create(`macos:${entry.id}`, { type: 'basic', iconUrl: icon, title: entry.title || entry.appName, message: entry.body || '', contextMessage: entry.title ? entry.appName : '' }); } catch { /* notifications are not available */ }
        }
    }
    return arm();
}

export function bindScheduledNotifications() {
    chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) serialize(deliver).catch(() => {}); });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[SCHEDULE_KEY]) serialize(deliver).catch(() => {}); });
    chrome.runtime.onStartup.addListener(() => { serialize(deliver).catch(() => {}); });
    chrome.runtime.onInstalled.addListener(() => { serialize(deliver).catch(() => {}); });
    // Clicking the operating system's notification: a new tab page comes forward and opens it.
    chrome.notifications?.onClicked.addListener(async (notificationId) => {
        if (!notificationId.startsWith('macos:')) return;
        try { chrome.notifications.clear(notificationId); } catch {}
        await setLocal({ [OPEN_KEY]: { id: notificationId.slice(6), at: Date.now() } });
        try {
            const pages = (await chrome.tabs.query({})).filter((tab) => (tab.url || '').startsWith(chrome.runtime.getURL('')) || /^chrome:\/\/newtab\/?/.test(tab.url || ''));
            const page = pages.find((tab) => tab.active) || pages[0];
            if (page) { await chrome.tabs.update(page.id, { active: true }); await chrome.windows.update(page.windowId, { focused: true }); }
            else await chrome.tabs.create({});
        } catch { try { await chrome.tabs.create({}); } catch {} }
    });
    serialize(deliver).catch(() => {});
}
