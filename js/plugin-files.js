// macos.files / macos.archive / file dialogs / drag and drop: an application's files
// stay on the host side, and images are resolved from them.

import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { showMacAlert } from './dialog.js';
import { BLOB_ID, appUsage, blobInfo, clearBlobs, getBlobRecord, listBlobs, probeMedia, putBlob, removeBlob, videoPoster } from './plugin-blobs.js';
import { extractSubtitles } from './subtitles.js';
import { cleanArchivePath, createZip, readZip } from './zip.js';
import { readAudioTags } from './audio-tags.js';
import { devOverride } from './dev-hooks.js';
import { FILE_LIMIT } from './plugin-constants.js';
import { appStrict, appWindows, applicationUnrestricted, isPrivateNetworkHost, notePermission, permissionAllowed, postToPlugin } from './plugin-core.js';
import { appAssetStorageKey, cleanPackagePath, dataUrlForRecord, guessMime, imageSourceKind, storageGet } from './plugin-package.js';
import { isVideoFile } from './plugin-media.js';

async function resolveRuntimeAsset(record, path) {
    const clean = cleanPackagePath(path);
    const asset = clean && record.runtimeAssets?.[clean];
    if (!asset) return '';
    if (!asset.stored) return dataUrlForRecord(asset);
    const storageKey = appAssetStorageKey(record.plugin.id, clean);
    const stored = (await storageGet([storageKey]))[storageKey];
    return stored ? dataUrlForRecord(stored) : '';
}
export function runtimeHasImageAsset(record, path) {
    const clean = cleanPackagePath(path);
    const asset = clean && record.runtimeAssets?.[clean];
    return Boolean(asset && /^image\//i.test(asset.mime || guessMime(clean)));
}
const fileLimits = (plugin = null) => (applicationUnrestricted(plugin) ? { maxBytes: Infinity, quota: Infinity } : appStrict(plugin) ? { maxBytes: FILE_LIMIT.strict, quota: FILE_LIMIT.quota } : { maxBytes: FILE_LIMIT.relaxed, quota: FILE_LIMIT.quota });
export async function storeFileForPlugin(record, blob, name) {
    if (devOverride(record.plugin.id)?.storageFull) throw new Error('Application file storage is full');
    const meta = await probeMedia(blob);
    const fileName = name || blob.name || '';
    if (/^audio\//.test(blob.type) || /\.(mp3|m4a|aac|flac|mp4)$/i.test(fileName)) {
        const { picture, ...tags } = await readAudioTags(blob);
        if (Object.keys(tags).length) meta.tags = tags;
        // Embedded cover art becomes a file of its own, usable as a blob:<id> image source.
        if (picture && picture.size <= 12_000_000) {
            try { meta.artworkId = (await putBlob(record.storageId, picture, { name: 'artwork', meta: await probeMedia(picture), ...fileLimits(record.plugin) })).id; } catch { /* art is optional */ }
        }
    }
    // A video's poster frame is stored the same way embedded cover art is.
    if (/^video\//.test(blob.type) && meta.width && !meta.artworkId) {
        const poster = await videoPoster(blob);
        if (poster) { try { meta.artworkId = (await putBlob(record.storageId, poster, { name: 'poster', meta: await probeMedia(poster), ...fileLimits(record.plugin) })).id; } catch { /* a poster is optional */ } }
    }
    // The text tracks inside a video are read once, here, and kept with the file.
    if (isVideoFile(blob, fileName)) meta.subtitles = await extractSubtitles(blob);
    return putBlob(record.storageId, blob, { name: fileName, meta, ...fileLimits(record.plugin) });
}
// Stored files are shown / played through object URLs that live as long as the window.
export async function fileObjectUrl(record, id) {
    record.objectUrls ||= new Map();
    if (record.objectUrls.has(id)) return record.objectUrls.get(id);
    const stored = await getBlobRecord(record.storageId, id);
    if (!stored) return '';
    const url = URL.createObjectURL(stored.blob);
    record.objectUrls.set(id, url);
    return url;
}
function releaseFileUrl(record, id) {
    const url = record.objectUrls?.get(id);
    if (url) { URL.revokeObjectURL(url); record.objectUrls.delete(id); }
}
export async function resolveImageSource(record, value) {
    const kind = imageSourceKind(value);
    if (kind === 'file') return fileObjectUrl(record, String(value).slice(5));
    if (kind === 'data') return String(value);
    if (kind === 'remote') {
        if (!permissionAllowed(record.plugin, 'network')) return '';
        try { if (isPrivateNetworkHost(new URL(value).hostname)) return ''; } catch { return ''; }
        return String(value);
    }
    return kind === 'asset' ? resolveRuntimeAsset(record, value) : '';
}
export function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}
// File access is always mediated by the browser's own picker / download UI, so an app
// only ever sees a file the user chose for it.
function readFileAs(file, mode) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Unable to read file'));
        reader.onload = () => {
            const info = { name: file.name, type: file.type, size: file.size };
            if (mode === 'text') resolve({ ...info, text: String(reader.result) });
            else if (mode === 'dataUrl') resolve({ ...info, dataUrl: String(reader.result) });
            else resolve({ ...info, base64: String(reader.result).split(',')[1] || '' });
        };
        if (mode === 'text') reader.readAsText(file); else reader.readAsDataURL(file);
    });
}
// options.store keeps the chosen files in the app's file store and returns their ids
// (the bytes never enter the sandbox); otherwise the contents are returned directly.
export function pickFileForPlugin(record, payload) {
    const mode = ['text', 'dataUrl', 'base64'].includes(payload.as) ? payload.as : 'text';
    const multiple = payload.multiple === true;
    const maxBytes = Math.max(1, Math.min(Number(payload.maxBytes) || 5_000_000, applicationUnrestricted(record.plugin) ? Infinity : appStrict(record.plugin) ? 5_000_000 : 25_000_000));
    return new Promise((resolve, reject) => {
        const input = createElement('input', { attrs: { type: 'file', hidden: '' } });
        if (typeof payload.accept === 'string') input.accept = payload.accept.slice(0, 300);
        input.multiple = multiple;
        input.addEventListener('cancel', () => { input.remove(); resolve(multiple ? [] : null); });
        input.addEventListener('change', async () => {
            const files = [...(input.files || [])].slice(0, 500);
            input.remove();
            try {
                const results = [];
                const skipped = [];
                const progress = fileProgress(record, 'picker', payload.store === true ? files.length : 0);
                for (const file of files) {
                    if (payload.store === true) {
                        // One file that cannot be stored does not cost the user the rest of the selection.
                        try { results.push(await storeFileForPlugin(record, file)); } catch (error) { skipped.push(`${file.name} — ${error?.message || 'rejected'}`); }
                        progress(file.name);
                    }
                    else if (file.size > maxBytes) throw new Error(`File is larger than ${maxBytes} bytes`);
                    else results.push(await readFileAs(file, mode));
                }
                if (skipped.length) showMacAlert(t('filesSkipped', '以下文件无法导入：'), { title: record.plugin.name, detail: skipped.slice(0, 12).join('\n'), icon: record.plugin.icon || '' });
                resolve(multiple ? results : (results[0] || null));
            } catch (error) { reject(error); }
        });
        document.body.appendChild(input);
        input.click();
    });
}
// Storing many files takes a while (each one is probed, tagged and written). The app is
// told how far along the host is: 'fileprogress' { source, done, total, name }, first with
// done = 0 and last with done = total.
function fileProgress(record, source, total) {
    let done = 0;
    const send = (name = '') => { if (total > 0 && appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'fileprogress', detail: { source, done, total, name: String(name).slice(0, 240) } }); };
    send();
    return (name) => { done += 1; send(name); };
}
export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = createElement('a', { attrs: { href: url, download: String(name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 160) || 'download' } });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function base64ToBlob(base64, type = 'application/octet-stream') {
    const binary = atob(String(base64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
}
const cleanMime = (value) => (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(value || '')) ? String(value) : 'application/octet-stream');
async function blobToBase64(blob) {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
export async function handleFilesRequest(record, method, payload) {
    const appId = record.storageId;
    const id = String(payload?.id || '');
    if (method === 'files.list') return listBlobs(appId);
    if (method === 'files.usage') return { ...(await appUsage(appId)), quota: fileLimits(record.plugin).quota, maxFileBytes: fileLimits(record.plugin).maxBytes };
    if (method === 'files.clear') { record.objectUrls?.forEach((url) => URL.revokeObjectURL(url)); record.objectUrls?.clear(); return clearBlobs(appId); }
    if (method === 'files.put') {
        const type = cleanMime(payload?.type);
        let blob;
        if (typeof payload?.base64 === 'string') blob = base64ToBlob(payload.base64, type);
        else if (typeof payload?.dataUrl === 'string' && payload.dataUrl.startsWith('data:')) blob = await (await fetch(payload.dataUrl)).blob();
        else blob = new Blob([String(payload?.text ?? '')], { type: payload?.type ? type : 'text/plain' });
        return storeFileForPlugin(record, blob, String(payload?.name || 'file'));
    }
    if (!BLOB_ID.test(id)) throw new Error('Unknown file id');
    if (method === 'files.info') return blobInfo(appId, id);
    if (method === 'files.remove') { releaseFileUrl(record, id); return removeBlob(appId, id); }
    const stored = await getBlobRecord(appId, id);
    if (!stored) throw new Error('Unknown file id');
    if (method === 'files.export') { downloadBlob(stored.blob, payload?.name || stored.name); return true; }
    if (method === 'files.read') {
        const limit = applicationUnrestricted(record.plugin) ? Infinity : appStrict(record.plugin) ? 8_000_000 : 40_000_000;
        if (stored.size > limit) throw new Error(`Only files up to ${Math.round(limit / 1_000_000)} MB can be read into the app; larger files stay host-side`);
        if (payload?.as === 'base64') return blobToBase64(stored.blob);
        if (payload?.as === 'dataUrl') return `data:${stored.type};base64,${await blobToBase64(stored.blob)}`;
        return stored.blob.text();
    }
    throw new Error(`Unknown plugin API method: ${method}`);
}
// macos.archive: bundle stored files and generated text into one .zip, or unpack one.
export async function handleArchiveRequest(record, method, payload) {
    const appId = record.storageId;
    if (method === 'archive.create') {
        const entries = [];
        for (const entry of (Array.isArray(payload?.entries) ? payload.entries : []).slice(0, 20000)) {
            const path = cleanArchivePath(entry?.path);
            if (!path) continue;
            if (entry.fileId) { const stored = await getBlobRecord(appId, String(entry.fileId)); if (stored) entries.push({ path, blob: stored.blob }); }
            else if (typeof entry.base64 === 'string') entries.push({ path, blob: base64ToBlob(entry.base64) });
            else entries.push({ path, blob: new Blob([String(entry.text ?? '')]) });
        }
        if (!entries.length) throw new Error('The archive has no entries');
        // 'fileprogress' with source "export": one step per entry packed.
        const progress = fileProgress(record, 'export', entries.length);
        const zip = await createZip(entries, (_done, _total, path) => progress(path));
        const name = String(payload?.name || `${record.plugin.name}.zip`);
        if (payload?.store === true) return storeFileForPlugin(record, zip, name);
        downloadBlob(zip, name);
        return true;
    }
    if (method === 'archive.extract') {
        const stored = await getBlobRecord(appId, String(payload?.fileId || ''));
        if (!stored) throw new Error('Unknown file id');
        const out = [];
        for (const entry of await readZip(stored.blob)) {
            const type = guessMime(entry.path);
            const blob = entry.blob.type === type ? entry.blob : new Blob([entry.blob], { type });
            const isText = /^(?:text\/|application\/json)/.test(type) && blob.size <= 2_000_000;
            // Small text entries (manifests) are returned inline; everything else is stored.
            if (isText && payload?.inlineText !== false) out.push({ path: entry.path, text: await blob.text() });
            else out.push({ path: entry.path, file: await storeFileForPlugin(record, blob, entry.path.split('/').pop()) });
        }
        return out;
    }
    throw new Error(`Unknown plugin API method: ${method}`);
}
// Files dragged from the desktop onto an app window go into that app's file store and
// are announced with a 'drop' event (permission: files).
export const dragHasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
export function bindFileDrop(record) {
    const win = record.window;
    win.addEventListener('dragover', (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault(); event.stopPropagation();
        const allowed = permissionAllowed(record.plugin, 'files');
        event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
        win.classList.toggle('plugin-app-drop-target', allowed);
        if (allowed) record.nativeUi?.dropHint?.(event.clientX, event.clientY);
    });
    win.addEventListener('dragleave', (event) => { if (!win.contains(event.relatedTarget)) { win.classList.remove('plugin-app-drop-target'); record.nativeUi?.clearDropHint?.(); } });
    win.addEventListener('drop', async (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault(); event.stopPropagation();
        win.classList.remove('plugin-app-drop-target');
        // Over a dropTarget list: the row, or the gap between rows, the files were let go on.
        const hint = record.nativeUi?.dropHint?.(event.clientX, event.clientY) || null;
        record.nativeUi?.clearDropHint?.();
        if (!permissionAllowed(record.plugin, 'files')) return;
        notePermission(record.plugin, 'files', true);
        const rect = win.getBoundingClientRect();
        const detail = { files: [], rejected: [], x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top),
            targetId: record.nativeUi?.idForElement(event.target) || '', itemId: record.nativeUi?.itemIdForElement(event.target) || '', ...(hint || {}) };
        const dropped = [...event.dataTransfer.files].slice(0, 500);
        const progress = fileProgress(record, 'drop', dropped.length);
        for (const file of dropped) {
            try { detail.files.push(await storeFileForPlugin(record, file)); }
            catch (error) { detail.rejected.push({ name: file.name, reason: error?.message || 'rejected' }); }
            progress(file.name);
        }
        if (appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'drop', detail });
    });
}
export function saveFileForPlugin(plugin, payload) {
    const mime = cleanMime(payload.mime);
    const blob = typeof payload.base64 === 'string' ? base64ToBlob(payload.base64, mime) : new Blob([String(payload.text ?? '')], { type: mime });
    downloadBlob(blob, payload.name || `${plugin.id}.txt`);
    return true;
}
