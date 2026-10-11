// System Settings ▸ Storage: what applications occupy, and exporting / importing /
// erasing an application's data.

import { t } from './i18n.js';
import { $ } from './utils.js';
import { cancelScheduledNotification, clearNotifications } from './notifications.js';
import { BLOB_ID, clearBlobs, listBlobRecords, putBlobRecord, usageByApp } from './plugin-blobs.js';
import { cleanArchivePath, createZip, readZip } from './zip.js';
import { APP_ASSET_INDEX_PREFIX, APP_ASSET_PREFIX, APP_COMPILED_PREFIX, APP_PACKAGE_PREFIX, APP_SEARCH_PREFIX, APP_STORAGE_PREFIX, APP_WIDGET_PREFIX, MAX_INSTANCES } from './plugin-constants.js';
import { closePluginApp, instancesOf, pluginStorageClear, pluginStorageGet, pluginStorageSet } from './plugin-core.js';
import { guessMime, pluginState, storageRemove } from './plugin-package.js';
import { downloadBlob } from './plugin-files.js';
import { searchIndexCache } from './plugin-integration.js';
import { widgetContentCache, widgetsChanged } from './plugin-widgets.js';

// ---- storage accounting (System Settings ▸ Storage) -----------------------------------
export const storagePools = (id) => Array.from({ length: MAX_INSTANCES }, (_unused, index) => (index ? `${id}#${index + 1}` : id));
export async function clearApplicationPools(id) {
    for (const pool of storagePools(id)) { await pluginStorageClear(pool).catch(() => {}); await clearBlobs(pool).catch(() => {}); }
    // What it listed for Spotlight and the notifications it left go with its data.
    searchIndexCache.set(id, []);
    widgetContentCache.set(id, {});
    await storageRemove([APP_SEARCH_PREFIX + id, APP_WIDGET_PREFIX + id]);
    widgetsChanged(id);
    cancelScheduledNotification(id).catch(() => {});
    clearNotifications(id);
}
const STORAGE_PREFIXES = { data: [APP_STORAGE_PREFIX, APP_SEARCH_PREFIX, APP_WIDGET_PREFIX], app: [APP_PACKAGE_PREFIX, APP_COMPILED_PREFIX, APP_ASSET_PREFIX, APP_ASSET_INDEX_PREFIX] };
// Which application, and which part of it, a chrome.storage key belongs to.
function classifyStorageKey(key, ids) {
    for (const [part, prefixes] of Object.entries(STORAGE_PREFIXES)) {
        for (const prefix of prefixes) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const id = ids.find((candidate) => rest === candidate || rest.startsWith(`${candidate}:`) || rest.startsWith(`${candidate}#`));
            return id ? { id, part } : null;
        }
    }
    return null;
}
async function storageKeySizes() {
    const area = chrome.storage.local;
    // Sizes without pulling every stored package into memory, where the browser offers it.
    if (typeof area.getKeys === 'function' && typeof area.getBytesInUse === 'function') {
        try {
            const keys = await area.getKeys();
            const sizes = await Promise.all(keys.map((key) => area.getBytesInUse(key)));
            return new Map(keys.map((key, index) => [key, Number(sizes[index]) || 0]));
        } catch { /* fall through to measuring the values */ }
    }
    const all = await new Promise((resolve) => area.get(null, (data) => resolve(data || {})));
    return new Map(Object.entries(all).map(([key, value]) => [key, key.length + (JSON.stringify(value)?.length || 0)]));
}
/**
 * What each installed application occupies: the application itself (its package and the
 * compiled copy) and its data (key/value storage and stored files, over all instances).
 * `otherBytes` is everything else in extension storage: settings, images, caches.
 */
export async function applicationStorageReport() {
    const apps = pluginState().apps;
    const ids = apps.map((app) => app.id).sort((a, b) => b.length - a.length);
    const report = new Map(apps.map((app) => [app.id, { plugin: app, appBytes: 0, dataBytes: 0, files: 0, running: instancesOf(app.id).length > 0 }]));
    let otherBytes = 0;
    for (const [key, size] of await storageKeySizes()) {
        const owner = classifyStorageKey(key, ids);
        if (owner) report.get(owner.id)[owner.part === 'app' ? 'appBytes' : 'dataBytes'] += size; else otherBytes += size;
    }
    for (const [pool, usage] of await usageByApp().catch(() => new Map())) {
        const entry = report.get(pool.split('#')[0]);
        if (entry) { entry.dataBytes += usage.bytes; entry.files += usage.count; } else otherBytes += usage.bytes;
    }
    // A bundled application's package ships inside the extension instead of being stored.
    await Promise.all(apps.filter((app) => app.packagePath).map(async (app) => {
        try { report.get(app.id).appBytes += (await (await fetch(chrome.runtime.getURL(app.packagePath))).blob()).size; } catch { /* size unknown */ }
    }));
    return { apps: [...report.values()], otherBytes };
}
const dateStamp = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const DATA_FORMAT = 'macos-app-data-v1';
// What is known about a stored file besides its bytes; nothing else is taken from an archive.
const FILE_META_KEYS = ['duration', 'width', 'height', 'tags', 'artworkId', 'subtitles'];
/**
 * Everything an application stored, as one archive: data.json (the key/value storage of
 * each of its storage pools and the catalogue of its files) and the files themselves.
 * importApplicationData() puts such an archive back.
 */
export async function exportApplicationData(id) {
    const plugin = pluginState().apps.find((app) => app.id === id);
    if (!plugin) throw new Error('Unknown application');
    const manifest = { format: DATA_FORMAT, app: { id, name: plugin.name, version: plugin.version }, exported: new Date().toISOString(), pools: [] };
    const entries = [];
    for (const [index, pool] of storagePools(id).entries()) {
        const storage = await pluginStorageGet(pool).catch(() => ({}));
        const records = await listBlobRecords(pool).catch(() => []);
        if (!Object.keys(storage).length && !records.length) continue;
        const files = records.map((record) => {
            const path = `files/${index + 1}/${record.id}/${cleanArchivePath(record.name).split('/').pop() || 'file'}`;
            entries.push({ path, blob: record.blob });
            const file = { id: record.id, path, name: record.name, type: record.type, created: record.created };
            for (const key of FILE_META_KEYS) if (record[key] !== undefined) file[key] = record[key];
            return file;
        });
        manifest.pools.push({ instance: index + 1, storage, files });
    }
    if (!manifest.pools.length) return false;
    entries.unshift({ path: 'data.json', blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });
    downloadBlob(await createZip(entries), `${plugin.name} Data ${dateStamp()}.zip`);
    return true;
}
/** Replaces everything the application stored with the contents of an exported archive. Its windows are closed first. */
export async function importApplicationData(id, blob) {
    const plugin = pluginState().apps.find((app) => app.id === id);
    if (!plugin) throw new Error('Unknown application');
    let entries; let manifest = null;
    try { entries = new Map((await readZip(blob)).map((entry) => [entry.path, entry.blob])); manifest = JSON.parse(await entries.get('data.json').text()); } catch { /* reported below */ }
    if (manifest?.format !== DATA_FORMAT || !Array.isArray(manifest.pools)) throw new Error(t('storageImportNotData', '这不是应用程序数据的导出文件。'));
    if (manifest.app?.id !== id) throw new Error(t('storageImportWrongApp', '这份数据属于“{name}”，不能导入到这个应用程序。').replace('{name}', String(manifest.app?.name || manifest.app?.id || '?')));
    closePluginApp(id);
    await clearApplicationPools(id);
    const pools = storagePools(id);
    for (const described of manifest.pools) {
        const pool = pools[Math.round(Number(described?.instance)) - 1];
        if (!pool) continue;
        const storage = described.storage && typeof described.storage === 'object' && !Array.isArray(described.storage) ? described.storage : {};
        for (const [key, value] of Object.entries(storage)) await pluginStorageSet(pool, key, value, { unlimited: true });
        for (const file of Array.isArray(described.files) ? described.files : []) {
            const data = entries.get(cleanArchivePath(file?.path));
            if (!data || !BLOB_ID.test(String(file.id || ''))) continue;
            const meta = {};
            for (const key of FILE_META_KEYS) if (file[key] !== undefined) meta[key] = file[key];
            await putBlobRecord(pool, { ...meta, id: file.id, name: file.name, created: file.created, blob: new Blob([data], { type: String(file.type || guessMime(String(file.name || ''))) }) });
        }
    }
    return true;
}
/** Erases everything an application stored (it stays installed). Its windows are closed first. */
export async function eraseApplicationData(id) {
    closePluginApp(id);
    await clearApplicationPools(id);
}
