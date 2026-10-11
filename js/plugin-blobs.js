// Per-application binary file store.
//
// macos.storage is a small JSON key/value store. Anything large — a song, a photo, a
// PDF — lives here instead: in IndexedDB, on the host side of the sandbox. An app only
// ever holds a short id for a file; the bytes are never copied into the app runtime
// unless the app explicitly reads them. Images and audio are played straight from the
// store by the host.

const DB_NAME = 'macos-plugin-blobs-v1';
const STORE = 'blobs';
let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
            store.createIndex('app', 'appId', { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { dbPromise = null; reject(request.error || new Error('Unable to open application file store')); };
    });
    return dbPromise;
}

function run(mode, work) {
    return openDb().then((db) => new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        let result;
        if (request) request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('Application file store failed'));
        transaction.onabort = () => reject(transaction.error || new Error('Application file store aborted'));
    }));
}

const keyFor = (appId, id) => `${appId}/${id}`;
export const BLOB_ID = /^[a-z0-9-]{6,80}$/i;

function publicInfo(record) {
    if (!record) return null;
    const { id, name, type, size, created, duration, width, height } = record;
    const info = { id, name, type, size, created };
    if (Number.isFinite(duration)) info.duration = duration;
    if (Number.isFinite(width) && Number.isFinite(height)) { info.width = width; info.height = height; }
    // Audio files: embedded tags, and the id of the extracted cover art (a file of its own).
    if (record.tags && typeof record.tags === 'object') info.tags = record.tags;
    if (record.artworkId) info.artworkId = record.artworkId;
    // Video files: the text tracks found in the file (the cues themselves stay host-side).
    if (Array.isArray(record.subtitles) && record.subtitles.length) info.subtitles = record.subtitles.map(({ language, label }) => ({ language: language || '', label: label || '' }));
    return info;
}

export async function appUsage(appId) {
    const records = await run('readonly', (store) => store.index('app').getAll(appId));
    return { count: records.length, bytes: records.reduce((sum, record) => sum + (Number(record.size) || 0), 0) };
}

/** Bytes and file count of every pool in the store: Map(appId -> { count, bytes }). Blobs are not read. */
export function usageByApp() {
    const totals = new Map();
    return run('readonly', (store) => {
        store.openCursor().onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const entry = totals.get(cursor.value.appId) || { count: 0, bytes: 0 };
            entry.count += 1; entry.bytes += Number(cursor.value.size) || 0;
            totals.set(cursor.value.appId, entry);
            cursor.continue();
        };
        return null;
    }).then(() => totals);
}

export async function putBlob(appId, blob, { name = '', meta = {}, maxBytes = Infinity, quota = Infinity } = {}) {
    if (!(blob instanceof Blob)) throw new Error('A file is required');
    if (blob.size > maxBytes) throw new Error(`File is larger than the ${Math.round(maxBytes / 1_000_000)} MB limit`);
    if (Number.isFinite(quota)) {
        const usage = await appUsage(appId);
        if (usage.bytes + blob.size > quota) throw new Error('Application file storage is full');
    }
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 13)}`;
    const record = {
        key: keyFor(appId, id), appId, id, blob,
        name: String(name || blob.name || 'file').slice(0, 240),
        type: String(blob.type || 'application/octet-stream').slice(0, 120),
        size: blob.size, created: Date.now(), ...meta
    };
    await run('readwrite', (store) => store.put(record));
    return publicInfo(record);
}

export async function getBlobRecord(appId, id) {
    if (!BLOB_ID.test(String(id || ''))) return null;
    return (await run('readonly', (store) => store.get(keyFor(appId, id)))) || null;
}
/** Adds to what is known about a stored file (its bytes stay as they are). */
export async function updateBlobMeta(appId, id, patch) {
    const record = await getBlobRecord(appId, id);
    if (!record) return false;
    await run('readwrite', (store) => store.put({ ...record, ...patch }));
    return true;
}
export async function blobInfo(appId, id) { return publicInfo(await getBlobRecord(appId, id)); }
export async function listBlobs(appId) {
    return (await run('readonly', (store) => store.index('app').getAll(appId))).map(publicInfo).sort((a, b) => a.created - b.created);
}
/** Whole records (bytes included) of one pool, and putting one back under its own id: used to export and restore an application's data. */
export function listBlobRecords(appId) { return run('readonly', (store) => store.index('app').getAll(appId)); }
export async function putBlobRecord(appId, { id, blob, name = '', created = Date.now(), ...meta }) {
    if (!BLOB_ID.test(String(id || '')) || !(blob instanceof Blob)) throw new Error('A file with a valid id is required');
    const record = { ...meta, key: keyFor(appId, id), appId, id, blob, name: String(name || 'file').slice(0, 240), type: String(blob.type || 'application/octet-stream').slice(0, 120), size: blob.size, created: Number(created) || Date.now() };
    await run('readwrite', (store) => store.put(record));
    return publicInfo(record);
}
export async function removeBlob(appId, id) {
    if (!BLOB_ID.test(String(id || ''))) return false;
    await run('readwrite', (store) => store.delete(keyFor(appId, id)));
    return true;
}
export async function clearBlobs(appId) {
    const records = await run('readonly', (store) => store.index('app').getAllKeys(appId));
    if (records.length) await run('readwrite', (store) => { records.forEach((key) => store.delete(key)); return null; });
    return true;
}

// A frame from early in a video, as a JPEG: the picture an app shows for the file.
export function videoPoster(blob, maxSize = 640) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto';
        const finish = (result) => { clearTimeout(timer); video.removeAttribute('src'); try { video.load(); } catch { /* released */ } URL.revokeObjectURL(url); resolve(result); };
        const timer = setTimeout(() => finish(null), 8000);
        video.onerror = () => finish(null);
        video.onloadedmetadata = () => { if (!video.videoWidth) return finish(null); video.currentTime = Math.min(2, (video.duration || 2) / 3); };
        video.onseeked = () => {
            try {
                const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((image) => finish(image), 'image/jpeg', 0.84);
            } catch { finish(null); }
        };
        video.src = url;
    });
}

// Duration of an audio/video file, or pixel size of an image, so apps can show it
// without ever decoding the file themselves.
export function probeMedia(blob) {
    return new Promise((resolve) => {
        const type = String(blob.type || '');
        if (!/^(audio|video|image)\//.test(type)) return resolve({});
        const url = URL.createObjectURL(blob);
        const finish = (meta) => { URL.revokeObjectURL(url); resolve(meta); };
        const timer = setTimeout(() => finish({}), 4000);
        if (type.startsWith('image/')) {
            const image = new Image();
            image.onload = () => { clearTimeout(timer); finish({ width: image.naturalWidth, height: image.naturalHeight }); };
            image.onerror = () => { clearTimeout(timer); finish({}); };
            image.src = url;
            return;
        }
        const media = document.createElement(type.startsWith('video/') ? 'video' : 'audio');
        media.preload = 'metadata';
        media.onloadedmetadata = () => {
            clearTimeout(timer);
            const meta = Number.isFinite(media.duration) ? { duration: Math.round(media.duration * 100) / 100 } : {};
            if (media.videoWidth) { meta.width = media.videoWidth; meta.height = media.videoHeight; }
            finish(meta);
        };
        media.onerror = () => { clearTimeout(timer); finish({}); };
        media.src = url;
    });
}
