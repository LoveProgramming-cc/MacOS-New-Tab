import { STORAGE_KEY } from './constants.js';
import { bindScheduledNotifications } from './background-notifications.js';

const USAGE_KEY = 'macOsScreenTimeUsageV41';
const HISTORY_KEY = 'macOsScreenTimeHistoryV44';
const ALARM_NAME = 'macOsScreenTimeSweepV48';
const MAX_HEARTBEAT_GAP_MS = 12_000;
const MAX_COUNT_SLICE_MS = 6_000;

const getLocal = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setLocal = (value) => new Promise((resolve, reject) => chrome.storage.local.set(value, () => {
    if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
}));

// A content script pings every two seconds. Keeping the previous ping in memory is
// deliberate: heartbeats themselves keep the MV3 worker alive while a foreground page
// is being counted. If Chrome does suspend/restart the worker we merely lose one slice,
// instead of corrupting usage or requiring a fragile session-storage transaction.
const heartbeatByTab = new Map();
let chain = Promise.resolve();
function serialize(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
}

function nowMs() { return Date.now(); }
function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function normalizeHost(value) {
    if (typeof value !== 'string') return '';
    let host = value.trim().toLowerCase();
    if (!host) return '';
    try {
        if (/^https?:\/\//i.test(host)) host = new URL(host).hostname.toLowerCase();
    } catch { return ''; }
    // Treat only the conventional www alias as the same site. Other subdomains remain
    // independent limits (shorts.youtube.com != youtube.com), as requested.
    host = host.replace(/^www\./, '').replace(/\.$/, '');
    if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..')) return '';
    return host;
}
function hostFromUrl(url) {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? normalizeHost(parsed.hostname) : '';
    } catch { return ''; }
}

// Heartbeats arrive every two seconds per visible tab. The config is read from storage
// once per worker lifetime and then kept current by storage.onChanged, instead of being
// deserialised again for every heartbeat.
let cachedConfig = null;
async function config() {
    if (cachedConfig) return cachedConfig;
    const stored = await getLocal([STORAGE_KEY]);
    cachedConfig = stored[STORAGE_KEY] || {};
    return cachedConfig;
}
function extraFeaturesDisabled(cfg) { return Boolean(cfg?.developer?.enabled && cfg?.developer?.disableExtraFeatures); }
function screenCfg(cfg) {
    if (extraFeaturesDisabled(cfg)) return { enabled: false, limits: [] };
    const value = cfg?.widgets?.screenTime;
    return value && typeof value === 'object' ? value : { enabled: true, limits: [] };
}
function trackingEnabled(cfg) { return !extraFeaturesDisabled(cfg) && screenCfg(cfg).enabled !== false; }
function limitFor(cfg, host) {
    return (screenCfg(cfg).limits || []).find((item) => normalizeHost(item?.host || '') === host) || null;
}

function emptyUsage() { return { date: dayKey(), total: 0, sites: {}, hours: {}, grace: {} }; }
async function readUsage() {
    const stored = (await getLocal([USAGE_KEY]))[USAGE_KEY];
    const today = dayKey();
    if (!stored || stored.date !== today) return emptyUsage();
    return {
        date: today,
        total: Number(stored.total) || 0,
        sites: stored.sites && typeof stored.sites === 'object' ? stored.sites : {},
        hours: stored.hours && typeof stored.hours === 'object' ? stored.hours : {},
        grace: stored.grace && typeof stored.grace === 'object' ? stored.grace : {}
    };
}
async function writeUsage(usage) {
    const stored = await getLocal([HISTORY_KEY]);
    const history = stored[HISTORY_KEY] && typeof stored[HISTORY_KEY] === 'object' ? stored[HISTORY_KEY] : {};
    history[usage.date] = { total: Math.round(Number(usage.total) || 0) };
    const keys = Object.keys(history).sort();
    while (keys.length > 14) delete history[keys.shift()];
    await setLocal({ [USAGE_KEY]: usage, [HISTORY_KEY]: history });
}
async function readHistory() {
    const stored = await getLocal([HISTORY_KEY]);
    const history = stored[HISTORY_KEY] && typeof stored[HISTORY_KEY] === 'object' ? stored[HISTORY_KEY] : {};
    return Object.entries(history).sort(([a], [b]) => a.localeCompare(b)).slice(-7)
        .map(([date, value]) => ({ date, total: Number(value?.total || 0) }));
}
function addSlice(usage, host, start, end) {
    if (!host || end <= start) return;
    const seconds = (end - start) / 1000;
    usage.total = Number(usage.total || 0) + seconds;
    usage.sites[host] = Number(usage.sites[host] || 0) + seconds;
    let cursor = start;
    while (cursor < end) {
        const date = new Date(cursor);
        const hour = String(date.getHours()).padStart(2, '0');
        const next = new Date(date);
        next.setMinutes(60, 0, 0);
        const sliceEnd = Math.min(end, next.getTime());
        usage.hours[hour] ||= {};
        usage.hours[hour][host] = Number(usage.hours[hour][host] || 0) + (sliceEnd - cursor) / 1000;
        cursor = sliceEnd;
    }
}
function blocked(host, usage, cfg, now = nowMs()) {
    if (screenCfg(cfg).enabled === false) return false;
    const limit = limitFor(cfg, host);
    const max = Math.max(0, Number(limit?.minutes || 0) * 60);
    if (!limit || !max) return false;
    return Number(usage.sites?.[host] || 0) >= max && now >= Number(usage.grace?.[host] || 0);
}
function payload(host, cfg) {
    const sc = screenCfg(cfg);
    return {
        type: 'showMacOsLimitOverlay',
        host,
        language: cfg?.language || 'en-US',
        message: typeof sc.overlayMessage === 'string' ? sc.overlayMessage.slice(0, 160) : '',
        image: ''
    };
}

async function allWebTabs() {
    try { return await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }); }
    catch { return []; }
}
async function ensureContentScript(tabId) {
    if (!tabId) return false;
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'macOsScreenTimePing' });
        return true;
    } catch {}
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['js/limit-overlay.js'] });
        return true;
    } catch { return false; }
}
async function setOverlay(tabId, show, data) {
    if (!tabId) return;
    if (show) await ensureContentScript(tabId);
    try { await chrome.tabs.sendMessage(tabId, show ? data : { type: 'hideMacOsLimitOverlay' }); } catch {}
}
async function enforceHost(host, usage, cfg) {
    const isBlocked = blocked(host, usage, cfg);
    const tabs = (await allWebTabs()).filter((tab) => tab.id && hostFromUrl(tab.url || '') === host);
    await Promise.all(tabs.map((tab) => setOverlay(tab.id, isBlocked, payload(host, cfg))));
}
async function refreshOverlays(cfg = null, usage = null) {
    if (!cfg) cfg = await config();
    const tabs = await allWebTabs();
    if (!trackingEnabled(cfg)) {
        await Promise.all(tabs.filter((tab) => tab.id).map(async (tab) => {
            try { await chrome.tabs.sendMessage(tab.id, { type: 'macOsScreenTimeSuspend' }); } catch {}
        }));
        return;
    }
    if (!usage) usage = await readUsage();
    await Promise.all(tabs.map(async (tab) => {
        const host = hostFromUrl(tab.url || '');
        if (!host || !tab.id) return;
        await setOverlay(tab.id, blocked(host, usage, cfg), payload(host, cfg));
    }));
}
async function installTrackerIntoExistingTabs(cfg = null) {
    if (!cfg) cfg = await config();
    if (!trackingEnabled(cfg)) return;
    const tabs = await allWebTabs();
    await Promise.all(tabs.filter((tab) => tab.id).map((tab) => ensureContentScript(tab.id)));
}

async function processHeartbeat(message, sender) {
    const tabId = sender.tab?.id;
    const host = normalizeHost(message?.host || '') || hostFromUrl(message?.url || '') || hostFromUrl(sender.tab?.url || '');
    if (!tabId || !host) return { ok: false, blocked: false };
    const active = message?.active === true;
    const now = nowMs();
    const cfg = await config();
    if (!trackingEnabled(cfg)) {
        heartbeatByTab.delete(tabId);
        return { ok: true, blocked: false, hide: true, disabled: true };
    }
    const usage = await readUsage();
    const previous = heartbeatByTab.get(tabId);
    const wasBlocked = blocked(host, usage, cfg, now);

    if (screenCfg(cfg).enabled !== false && active) {
        if (!wasBlocked && previous?.active && previous.host === host) {
            const gap = now - Number(previous.ts || 0);
            if (gap > 0 && gap <= MAX_HEARTBEAT_GAP_MS) {
                const counted = Math.min(gap, MAX_COUNT_SLICE_MS);
                addSlice(usage, host, now - counted, now);
                await writeUsage(usage);
            }
        }
        heartbeatByTab.set(tabId, { host, ts: now, active: true });
    } else {
        heartbeatByTab.delete(tabId);
    }

    const isBlocked = blocked(host, usage, cfg, now);
    if (isBlocked && !wasBlocked) enforceHost(host, usage, cfg).catch(() => {});
    const limit = limitFor(cfg, host);
    return {
        ok: true,
        blocked: isBlocked,
        hide: !isBlocked,
        payload: isBlocked ? payload(host, cfg) : null,
        usedSeconds: Math.round(Number(usage.sites?.[host] || 0)),
        limitSeconds: limit ? Math.round(Number(limit.minutes || 0) * 60) : 0
    };
}
async function summary() {
    const cfg = await config();
    if (extraFeaturesDisabled(cfg)) return { date: dayKey(), total: 0, sites: [], hours: {}, history: [], disabled: true };
    const usage = await readUsage();
    const sites = Object.entries(usage.sites || {}).map(([host, seconds]) => ({ host, seconds: Math.round(Number(seconds) || 0) }))
        .sort((a, b) => b.seconds - a.seconds);
    const history = await readHistory();
    if (!history.some((item) => item.date === usage.date)) history.push({ date: usage.date, total: Math.round(usage.total || 0) });
    return { date: usage.date, total: Math.round(usage.total || 0), sites, hours: usage.hours || {}, history: history.slice(-7) };
}

function createAlarm() { chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 }); }
async function clearAlarm() { try { await chrome.alarms.clear(ALARM_NAME); } catch {} }
async function syncBackgroundFeatureState() {
    const cfg = await config();
    if (!trackingEnabled(cfg)) {
        heartbeatByTab.clear();
        await clearAlarm();
        await refreshOverlays(cfg, null);
        return;
    }
    createAlarm();
    await installTrackerIntoExistingTabs(cfg);
    await refreshOverlays(cfg, await readUsage());
}
chrome.runtime.onInstalled.addListener(() => { syncBackgroundFeatureState().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { syncBackgroundFeatureState().catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => heartbeatByTab.delete(id));
chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (info.status !== 'complete' || !/^https?:\/\//i.test(tab.url || '')) return;
    config().then((cfg) => { if (trackingEnabled(cfg)) ensureContentScript(id).catch(() => {}); }).catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    const cutoff = nowMs() - 20_000;
    for (const [id, beat] of heartbeatByTab) if (Number(beat.ts || 0) < cutoff) heartbeatByTab.delete(id);
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    cachedConfig = changes[STORAGE_KEY].newValue || {};
    serialize(syncBackgroundFeatureState).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'screenTimeHeartbeat') {
        serialize(() => processHeartbeat(message, sender)).then(sendResponse).catch(() => sendResponse({ ok: false, blocked: false }));
        return true;
    }
    if (message?.type === 'getScreenTimeSummary') {
        serialize(summary).then(sendResponse).catch(() => sendResponse({ date: dayKey(), total: 0, sites: [], hours: {}, history: [] }));
        return true;
    }
    if (message?.type === 'delayScreenTimeLimitFromPage' || message?.type === 'delayScreenTimeLimit') {
        serialize(async () => {
            const cfg = await config();
            if (!trackingEnabled(cfg)) return { ok: false, disabled: true };
            const host = normalizeHost(message.host || '') || hostFromUrl(sender.tab?.url || '');
            if (!host) return { ok: false };
            const usage = await readUsage();
            usage.grace ||= {};
            usage.grace[host] = nowMs() + 5 * 60 * 1000;
            await writeUsage(usage);
            await enforceHost(host, usage, cfg);
            return { ok: true };
        }).then(sendResponse).catch(() => sendResponse({ ok: false }));
        return true;
    }
});

syncBackgroundFeatureState().catch(() => {});
bindScheduledNotifications();
