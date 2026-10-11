// The user's own wallpapers: pictures and videos they added, kept on this machine in
// IndexedDB. A picture is kept at display size (see fitPicture) with a small thumbnail
// for the Wallpaper settings page; a video is kept whole and also carries a poster frame,
// which is what the desktop shows until the video has loaded (and what first paint uses).

const DB_NAME = 'macos-wallpapers-v1';
const STORE = 'items';
let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { dbPromise = null; reject(request.error || new Error('Unable to open the wallpaper library')); };
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
        transaction.onerror = () => reject(transaction.error || new Error('Wallpaper library failed'));
        transaction.onabort = () => reject(transaction.error || new Error('Wallpaper library aborted'));
    }));
}

function drawCover(source, sourceWidth, sourceHeight, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const w = sourceWidth * scale; const h = sourceHeight * scale;
    context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
    return canvas.toDataURL('image/jpeg', quality);
}
function loadImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => { resolve({ image, release: () => URL.revokeObjectURL(url) }); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture cannot be read')); };
        image.src = url;
    });
}
// A frame from early in the video: the poster.
function loadVideoFrame(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto';
        const fail = () => { URL.revokeObjectURL(url); reject(new Error('This video cannot be played by the browser')); };
        const timer = setTimeout(fail, 15000);
        video.onerror = () => { clearTimeout(timer); fail(); };
        video.onloadedmetadata = () => { video.currentTime = Math.min(1, (video.duration || 2) / 2); };
        video.onseeked = () => { clearTimeout(timer); resolve({ video, release: () => { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); } }); };
        video.src = url;
    });
}

const summary = ({ id, kind, name, thumb, created, duration, size }) => ({ id, kind, name, thumb, created, duration, size });
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// A desktop picture never needs more pixels than the display has. Camera files and
// exported artwork are often several times that, and carrying one around — in the
// configuration, in the first-paint cache, through the decoder at every switch — is what
// makes changing the wallpaper stutter. So a picture is fitted to the display once, when
// it is added, and only that copy is kept. Decoding and scaling happen off the main thread.
export function wallpaperPixelBox() {
    const width = Math.max(window.screen?.width || 1920, window.innerWidth || 0) * Math.min(2, window.devicePixelRatio || 1);
    const long = Math.max(1920, Math.min(3840, Math.round(width)));
    return [long, Math.round(long * 9 / 16)];
}
/** Scales a picture down to cover `box` (never up) and re-encodes it. Returns { blob, width, height }. */
export async function fitPicture(source, [boxWidth, boxHeight] = wallpaperPixelBox(), { type = 'image/jpeg', quality = 0.9, keepSmall = true } = {}) {
    const { image, release } = await loadImage(source);
    const sourceWidth = image.naturalWidth; const sourceHeight = image.naturalHeight;
    release();
    if (!sourceWidth || !sourceHeight) throw new Error('This picture cannot be read');
    const scale = Math.min(1, Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale));
    // Already display-sized and compact: keep the file exactly as it is.
    if (keepSmall && scale === 1 && source.size <= 2_500_000 && /^image\/(?:jpeg|webp|png|avif)$/.test(source.type)) return { blob: source, width, height };
    const bitmap = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    try {
        if (typeof OffscreenCanvas === 'function') {
            const canvas = new OffscreenCanvas(width, height);
            canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
            return { blob: await canvas.convertToBlob({ type, quality }), width, height };
        }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
        return { blob: await new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Unable to encode the picture'))), type, quality)), width, height };
    } finally { bitmap.close?.(); }
}

export async function addWallpaperPhoto(file) {
    const fitted = await fitPicture(file);
    const thumb = await blobToDataUrl((await fitPicture(fitted.blob, [384, 216], { quality: 0.8, keepSmall: false })).blob);
    const record = { id: newId(), kind: 'photo', name: String(file.name || 'Photo').replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 120), blob: fitted.blob, size: fitted.blob.size, width: fitted.width, height: fitted.height,
        fitted: true, created: Date.now(), thumb };
    await run('readwrite', (store) => store.put(record));
    return summary(record);
}
/** The picture to put on the desktop, as a data URL. Pictures added before fitting existed are fitted now. */
export async function wallpaperPhotoData(id) {
    const record = await getWallpaper(id);
    if (!record || record.kind !== 'photo') return '';
    if (!record.fitted) {
        try {
            const fitted = await fitPicture(record.blob);
            Object.assign(record, { blob: fitted.blob, size: fitted.blob.size, width: fitted.width, height: fitted.height, fitted: true });
            await run('readwrite', (store) => store.put(record));
        } catch { /* use the picture as it is */ }
    }
    return blobToDataUrl(record.blob);
}
export async function addWallpaperVideo(file) {
    const { video, release } = await loadVideoFrame(file);
    try {
        const width = Math.min(1920, video.videoWidth || 1280);
        const height = Math.round(width * (video.videoHeight || 720) / (video.videoWidth || 1280));
        const record = { id: newId(), kind: 'video', name: String(file.name || 'Video').replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 120), blob: file, size: file.size, created: Date.now(),
            duration: Number.isFinite(video.duration) ? video.duration : 0,
            thumb: drawCover(video, video.videoWidth, video.videoHeight, 384, 216, 0.8),
            poster: drawCover(video, video.videoWidth, video.videoHeight, width, height, 0.84) };
        await run('readwrite', (store) => store.put(record));
        return summary(record);
    } finally { release(); }
}
export async function listWallpapers() {
    return ((await run('readonly', (store) => store.getAll())) || []).map(summary).sort((a, b) => b.created - a.created);
}
export async function getWallpaper(id) { return id ? ((await run('readonly', (store) => store.get(String(id)))) || null) : null; }
export async function removeWallpaper(id) { await run('readwrite', (store) => store.delete(String(id))); }
export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Unable to read the picture'));
        reader.readAsDataURL(blob);
    });
}
