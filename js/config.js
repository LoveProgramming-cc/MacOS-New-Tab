import { FALLBACK_CONFIG, STORAGE_KEY } from './constants.js';
import { devEmit } from './dev-hooks.js';
import { state } from './state.js';
import { deepClone } from './utils.js';
import { fetchJsonSafely, identityRepairs, normalizeConfig, resetIdentityRepairs } from './config-normalize.js';

export * from './config-normalize.js';
export * from './config-widgets.js';
export * from './config-plugins.js';

const FIRST_PAINT_STATE_KEY = 'macOS_first_paint_state_v055';
function cacheFirstPaintState(config) {
    if (!config || state.incognitoConfigMode) return;
    const dev = config.developer || {};
    const access = config.accessibility || {};
    const payload = {
        version: 55,
        language: config.language || 'zh-CN',
        themeMode: config.themeMode || 'system',
        dockSize: Math.max(30, Math.min(90, Number(config.dock?.size) || 56)),
        dockLightBgInDark: config.dock?.lightBgInDark !== false,
        showSpotlightOnStart: config.showSpotlightOnStart !== false,
        spotlightFocusOnOpen: Boolean(config.spotlightFocusOnOpen),
        direction: ['ar', 'he', 'fa', 'ur'].includes(String(config.language || '').split('-')[0].toLowerCase()) || (dev.enabled && dev.forceRTL) ? 'rtl' : 'ltr',
        developer: {
            enabled: Boolean(dev.enabled),
            timeScale: Number(dev.timeScale) || 1,
            baseRealMs: Number(dev.baseRealMs) || 0,
            baseVirtualMs: Number(dev.baseVirtualMs) || 0,
            disableAnimations: Boolean(access.disableAnimations),
            reduceTransparency: Boolean(access.reduceTransparency || access.increaseContrast),
            transparentGlass: Boolean(access.transparentGlass && !access.reduceTransparency && !access.increaseContrast),
            disableExtraFeatures: Boolean(dev.enabled && dev.disableExtraFeatures),
            selectableUIText: Boolean(dev.enabled && dev.selectableUIText),
            disableStrictPluginSecurity: Boolean(dev.enabled && dev.disableStrictPluginSecurity),
            increaseContrast: Boolean(access.increaseContrast)
        }
    };
    try {
        localStorage.setItem(FIRST_PAINT_STATE_KEY, JSON.stringify(payload));
        localStorage.setItem('macOS_theme_cache', payload.themeMode);
        localStorage.setItem('macOS_spotlight_start_cache', String(payload.showSpotlightOnStart));
    } catch { /* first-paint cache is best effort */ }
}

function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(Array.isArray(keys) ? keys : [keys], (data) => resolve(data || {})));
}

function storageSet(value) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(value, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(error);
            else resolve();
        });
    });
}

function storageRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}

// Large data: URLs (wallpapers, uploaded icons, overlay image/font) live under their own
// content-addressed storage keys. The config object keeps a short reference, so an
// ordinary save (every Dock click touches lastAccessedAt) writes a few KB instead of
// re-serialising megabytes, and the background worker / content scripts that read the
// config never pull those images into memory.
const BLOB_KEY_PREFIX = 'macOsBlobV1_';
const BLOB_REF = /^macos-blob:([a-f0-9]{32})$/;
const BLOB_MIN_LENGTH = 4096;
const refByData = new Map();
const storedRefs = new Set();
let persistedRefs = new Set();

function blobStorageKey(ref) { return BLOB_KEY_PREFIX + ref.slice('macos-blob:'.length); }
function isBlobCandidate(value) { return typeof value === 'string' && value.length >= BLOB_MIN_LENGTH && value.startsWith('data:'); }

function walkStrings(value, visit) {
    if (typeof value === 'string') return visit(value);
    if (Array.isArray(value)) return value.map((item) => walkStrings(item, visit));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkStrings(item, visit)]));
    return value;
}

async function blobRefFor(data) {
    const known = refByData.get(data);
    if (known) return known;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hex = [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const ref = `macos-blob:${hex}`;
    refByData.set(data, ref);
    return ref;
}

async function externalizeBlobs(config) {
    const pending = new Set();
    walkStrings(config, (text) => { if (isBlobCandidate(text)) pending.add(text); return text; });
    const blobs = new Map();
    await Promise.all([...pending].map(async (data) => blobs.set(await blobRefFor(data), data)));
    const slim = walkStrings(config, (text) => (isBlobCandidate(text) ? refByData.get(text) : text));
    return { slim, blobs };
}

async function hydrateBlobs(stored) {
    const refs = new Set();
    let inlineBlobs = false;
    walkStrings(stored, (text) => {
        if (BLOB_REF.test(text)) refs.add(text);
        else if (isBlobCandidate(text)) inlineBlobs = true;
        return text;
    });
    if (!refs.size) return { config: stored, refs, inlineBlobs };
    const table = await storageGet([...refs].map(blobStorageKey));
    const found = new Set();
    const config = walkStrings(stored, (text) => {
        if (!BLOB_REF.test(text)) return text;
        const data = table[blobStorageKey(text)];
        if (typeof data !== 'string') return text; // missing blob: the normalizers drop the dangling reference
        refByData.set(data, text);
        storedRefs.add(text);
        found.add(text);
        return data;
    });
    return { config, refs: found, inlineBlobs };
}

// Several new-tab pages are usually open at once and each holds the whole config in
// memory. Without this, an older tab's next save (every Dock click saves) silently
// reverted whatever a newer tab had changed. A change written by another page is
// adopted here, and the page re-renders through 'macos-config-external-change'.
// chrome.storage hands objects back with their keys sorted, so a stored config never
// serialises to the same text as the object that was written. Own saves are recognised
// by a per-page writer stamp stored beside the config, with an order-independent
// comparison as the fallback.
const WRITER_KEY = 'macOsConfigWriterV1';
const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
function canonicalJson(value) {
    return JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item));
}
const ownStamp = (stamp) => typeof stamp === 'string' && stamp.startsWith(`${PAGE_ID}:`);
let lastWrittenJson = '';
let writeSeq = 0;
let adoptChain = Promise.resolve();
async function adoptExternalConfig() {
    devEmit('config', { name: 'adopt', text: 'another tab wrote the configuration' });
    if (!state.defaults || state.incognitoConfigMode) return;
    // Read what storage holds now rather than trusting the event payload: this page
    // may have saved again in the meantime, and the stored copy is the one that wins.
    const data = await storageGet([STORAGE_KEY, WRITER_KEY]);
    const stored = data[STORAGE_KEY];
    if (!stored || ownStamp(data[WRITER_KEY]) || canonicalJson(stored) === lastWrittenJson) return;
    lastWrittenJson = canonicalJson(stored); // what storage holds now
    const hydrated = await hydrateBlobs(stored);
    persistedRefs = hydrated.refs;
    state.config = normalizeConfig(hydrated.config, state.defaults, { repair: true });
    state.config.developer.incognitoMode = false;
    state.persistedConfig = normalizeConfig(state.config, state.defaults);
    cacheFirstPaintState(state.config);
    window.dispatchEvent(new CustomEvent('macos-config-external-change'));
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const [key, change] of Object.entries(changes)) {
            // Another page may have garbage-collected a blob this page still holds in
            // memory. Forget that it is stored so the next save writes it again.
            if (key.startsWith(BLOB_KEY_PREFIX) && change.newValue === undefined) storedRefs.delete(`macos-blob:${key.slice(BLOB_KEY_PREFIX.length)}`);
        }
        const next = changes[STORAGE_KEY]?.newValue;
        if (!next || typeof window === 'undefined') return;
        // This page's own save: stamped by this page, or identical to what it last wrote.
        if (ownStamp(changes[WRITER_KEY]?.newValue) || canonicalJson(next) === lastWrittenJson) return;
        adoptChain = adoptChain.then(() => saveChain).then(() => adoptExternalConfig()).catch(() => {});
    });
}

function ensureBuiltInLaunchpadApps(config, defaults) {
    if (config?.developer?.enabled && config.developer.allowSystemIconEditing) return config;
    const existing = new Set((config.launchpadApps || []).map((app) => app.nameKey).filter(Boolean));
    (defaults.launchpadApps || []).forEach((app, desiredIndex) => {
        if (!app.isSystem || !app.nameKey || existing.has(app.nameKey)) return;
        config.launchpadApps.splice(Math.min(desiredIndex, config.launchpadApps.length), 0, deepClone(app));
        existing.add(app.nameKey);
    });
    return config;
}

export async function loadConfig() {
    const defaults = normalizeConfig(await fetchJsonSafely('default.json', FALLBACK_CONFIG), FALLBACK_CONFIG);
    state.defaults = defaults;
    const saved = await storageGet(STORAGE_KEY);
    if (saved[STORAGE_KEY]) lastWrittenJson = canonicalJson(saved[STORAGE_KEY]);
    const hydrated = await hydrateBlobs(saved[STORAGE_KEY]);
    persistedRefs = hydrated.refs;
    // Developer Beta 0.55.0 permits Launchpad icons moved to Trash to stay removed. Do not auto-resurrect
    // deliberately removed system apps on the next tab load. Fresh profiles already
    // receive the complete built-in set from default.json.
    resetIdentityRepairs();
    state.config = normalizeConfig(hydrated.config, defaults, { repair: true });
    const needsRewrite = identityRepairs > 0 || hydrated.inlineBlobs;
    state.config.developer.incognitoMode = false;
    state.persistedConfig = normalizeConfig(state.config, defaults);
    try { state.incognitoConfigMode = sessionStorage.getItem('macOS_incognito_config_mode') === '1'; } catch { state.incognitoConfigMode = false; }
    state.incognitoBaseline = state.incognitoConfigMode ? deepClone(state.config) : null;
    cacheFirstPaintState(state.config);
    // Persist the repaired launchers / the split-out images once, so the stored copy
    // stops carrying the old damage and the old multi-megabyte layout.
    if (needsRewrite && saved[STORAGE_KEY]) saveConfig({ forcePersist: true, snapshot: state.persistedConfig }).catch(() => {});
    return state.config;
}

let saveChain = Promise.resolve();
export function saveConfig({ forcePersist = false, snapshot = null } = {}) {
    // Incognito configuration is deliberately tab-local. Nothing in the persistent
    // config advertises that another new-tab page is using an ephemeral workspace.
    if (!snapshot) snapshot = normalizeConfig(state.config, state.defaults || FALLBACK_CONFIG, { repair: true });
    snapshot.developer.incognitoMode = false;
    if (state.incognitoConfigMode && !forcePersist) return Promise.resolve(snapshot);
    // Saves are serialised so a slower earlier write can never land after a newer one.
    const run = saveChain.then(async () => {
        const { slim, blobs } = await externalizeBlobs(snapshot);
        const json = canonicalJson(slim);
        // Nothing changed since the last write (a Dock click that only re-saves, a
        // control set to the value it already had): skip the storage round trip.
        if (json === lastWrittenJson && [...blobs.keys()].every((ref) => storedRefs.has(ref))) { devEmit('config', { name: 'save skipped', text: 'nothing changed' }); state.persistedConfig = snapshot; return snapshot; }
        const payload = { [STORAGE_KEY]: slim, [WRITER_KEY]: `${PAGE_ID}:${++writeSeq}` };
        lastWrittenJson = json;
        for (const [ref, data] of blobs) if (!storedRefs.has(ref)) payload[blobStorageKey(ref)] = data;
        devEmit('config', { name: 'save', text: `${json.length} bytes of settings, ${Object.keys(payload).length - 2} new image(s), write #${writeSeq}` });
        await storageSet(payload);
        blobs.forEach((_data, ref) => storedRefs.add(ref));
        const stale = [...persistedRefs].filter((ref) => !blobs.has(ref));
        persistedRefs = new Set(blobs.keys());
        if (stale.length) {
            stale.forEach((ref) => storedRefs.delete(ref));
            for (const [data, ref] of refByData) if (stale.includes(ref)) refByData.delete(data);
            storageRemove(stale.map(blobStorageKey)).catch(() => {});
        }
        state.persistedConfig = snapshot;
        cacheFirstPaintState(snapshot);
        return snapshot;
    });
    saveChain = run.catch(() => {});
    return run;
}

export async function setIncognitoConfigMode(enabled) {
    const next = Boolean(enabled);
    if (next === state.incognitoConfigMode) return state.config;
    if (next) {
        state.incognitoBaseline = deepClone(normalizeConfig(state.config, state.defaults || FALLBACK_CONFIG));
        state.incognitoConfigMode = true;
        try { sessionStorage.setItem('macOS_incognito_config_mode', '1'); } catch {}
        return state.config;
    }

    // Turning it off explicitly discards the current tab's ephemeral mutations and
    // returns to the last persistent snapshot. Other tabs were never touched.
    const baseline = normalizeConfig(state.incognitoBaseline || state.persistedConfig || state.config, state.defaults || FALLBACK_CONFIG);
    baseline.developer.incognitoMode = false;
    state.incognitoConfigMode = false;
    state.incognitoBaseline = null;
    try { sessionStorage.removeItem('macOS_incognito_config_mode'); } catch {}
    state.config = deepClone(baseline);
    return state.config;
}

export function validateImportedConfig(raw) {
    // Developer Beta configuration compatibility is schema-by-default: an imported
    // object may be from an older build or have missing/invalid fields. normalizeConfig
    // repairs each supported field using the current default.json value. Only a
    // non-object root is unrecoverable.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Root must be a JSON object');
    return true;
}

export function importConfig(raw) {
    validateImportedConfig(raw);
    state.config = normalizeConfig(raw, state.defaults || FALLBACK_CONFIG, { repair: true });
    // Launch-at-startup can only be switched on by hand in Settings; a configuration
    // file must not be able to make an application start by itself.
    state.config.plugins.apps.forEach((app) => { app.autoStart = false; app.unrestricted = false; app.relaxed = false; });
    // Nor can it lift the limits on applications: that is confirmed by the user, on this machine.
    state.config.developer.unrestrictedApps = false;
    return state.config;
}
