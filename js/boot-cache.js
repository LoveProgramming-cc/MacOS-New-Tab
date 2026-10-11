const BOOT_CACHE_KEY = 'macOS_boot_visual_cache_v055';
let timer = null;
let idleHandle = null;
let captureGeneration = 0;

function collectWarmPhotoSources() {
    // The current photo already lives in the visual widget snapshot. Persist only the
    // decoded-next candidates here so localStorage does not duplicate every current image.
    const maps = [globalThis.__macOSPhotoWarmSources];
    const result = [];
    const seen = new Set();
    let chars = 0;
    for (const map of maps) {
        if (!(map instanceof Map)) continue;
        for (const src of map.values()) {
            if (typeof src !== 'string' || !src.startsWith('data:image/') || src.length > 1_500_000 || seen.has(src)) continue;
            if (chars + src.length > 3_200_000) return result;
            seen.add(src);
            result.push(src);
            chars += src.length;
            if (result.length >= 12) return result;
        }
    }
    return result;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('decode failed'));
        image.src = src;
    });
}

async function compactDataImage(src, widthHint = 360, heightHint = 260, { cover = false, alpha = false } = {}) {
    if (!src?.startsWith('data:image/') || src.length < 120_000) return src;
    try {
        const image = await loadImage(src);
        const dpr = Math.max(1, Math.min(2, Number(globalThis.devicePixelRatio) || 2));
        const maxW = Math.max(180, Math.min(1000, Math.round(widthHint * dpr)));
        const maxH = Math.max(180, Math.min(1000, Math.round(heightHint * dpr)));
        const canvas = document.createElement('canvas');

        if (cover) {
            // The live photo uses object-fit:cover. Cache exactly the visible crop instead
            // of preserving a potentially very wide/tall source in localStorage. On a
            // Retina display the 332 CSS-pixel square is about 664 physical pixels.
            const targetW = maxW;
            const targetH = maxH;
            canvas.width = targetW;
            canvas.height = targetH;
            const srcW = Math.max(1, image.naturalWidth);
            const srcH = Math.max(1, image.naturalHeight);
            const srcAspect = srcW / srcH;
            const dstAspect = targetW / targetH;
            let sx = 0, sy = 0, sw = srcW, sh = srcH;
            if (srcAspect > dstAspect) {
                sw = srcH * dstAspect;
                sx = (srcW - sw) / 2;
            } else if (srcAspect < dstAspect) {
                sh = srcW / dstAspect;
                sy = (srcH - sh) / 2;
            }
            const ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) return '';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetW, targetH);
            return canvas.toDataURL('image/webp', 0.95);
        }

        const scale = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.width = width;
        canvas.height = height;
        // Launcher icons are usually transparent PNGs; an opaque canvas would paint them
        // on a black square in the snapshot.
        const ctx = canvas.getContext('2d', { alpha });
        if (!ctx) return '';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/webp', alpha ? 0.92 : 0.80);
    } catch {
        return '';
    }
}

async function sanitizeWidgetSnapshot(layer) {
    if (!layer) return '';
    const clone = layer.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('.widget-remove,.widget-placement-ghost,.widget-drag-image-host').forEach((el) => el.remove());
    clone.querySelectorAll('.photo-next').forEach((el) => el.remove());
    clone.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'));

    // Pictures in application widgets are object URLs, which do not outlive this tab: the
    // snapshot carries a small copy of what is on screen instead.
    const liveBlobImages = [...layer.querySelectorAll('img[src^="blob:"]')];
    [...clone.querySelectorAll('img[src^="blob:"]')].forEach((img, index) => {
        const original = liveBlobImages[index];
        try {
            if (!original?.complete || !original.naturalWidth) throw new Error('not loaded');
            const scale = Math.min(1, 360 / Math.max(original.naturalWidth, original.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(original.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
            canvas.getContext('2d').drawImage(original, 0, 0, canvas.width, canvas.height);
            img.setAttribute('src', canvas.toDataURL('image/webp', 0.8));
        } catch { img.removeAttribute('src'); img.dataset.bootImageOmitted = '1'; }
    });
    const originalImages = [...layer.querySelectorAll('img[src^="data:image/"]')].filter((img) => !img.classList.contains('photo-next'));
    const clonedImages = [...clone.querySelectorAll('img[src^="data:image/"]')];
    await Promise.all(clonedImages.map(async (img, index) => {
        const source = img.getAttribute('src') || '';
        if (source.length < 120_000) return;
        const original = originalImages[index];
        const rect = original?.getBoundingClientRect?.() || { width: 360, height: 260 };
        const compact = await compactDataImage(source, rect.width || 360, rect.height || 260, { cover: img.classList.contains('photo-current') || Boolean(img.closest('.photo-widget-frame')) });
        if (compact) img.setAttribute('src', compact);
        else {
            img.removeAttribute('src');
            img.dataset.bootImageOmitted = '1';
        }
    }));
    return clone.innerHTML;
}

async function sanitizeSurfaceSnapshot(element, widthHint = 96, heightHint = 96) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'));
    // Nothing is running when the next tab starts: drop run-time Dock state from the snapshot.
    clone.querySelectorAll('.dock-running-item').forEach((el) => el.remove());
    clone.querySelectorAll('.running').forEach((el) => el.classList.remove('running'));
    const originals = [...element.querySelectorAll('img[src^="data:image/"]')];
    const images = [...clone.querySelectorAll('img[src^="data:image/"]')];
    await Promise.all(images.map(async (img, index) => {
        const source = img.getAttribute('src') || '';
        if (source.length < 120_000) return;
        const rect = originals[index]?.getBoundingClientRect?.() || { width: widthHint, height: heightHint };
        const compact = await compactDataImage(source, rect.width || widthHint, rect.height || heightHint, { alpha: true });
        if (compact) img.setAttribute('src', compact);
        else img.removeAttribute('src');
    }));
    return clone.innerHTML;
}

// A new tab starts with no window open, so the snapshot always carries the resting menu
// bar, whatever application happens to be in front right now.
function restingMenuBarHtml() {
    const left = document.querySelector('#menu-bar .menu-left');
    if (!left) return '';
    const clone = left.cloneNode(true);
    clone.querySelector('#system-menu-items')?.classList.remove('hidden');
    const apps = clone.querySelector('#plugin-menu-items');
    if (apps) { apps.replaceChildren(); apps.classList.add('hidden'); }
    return clone.innerHTML;
}

async function captureNow(generation) {
    if (document.body?.classList.contains('dev-incognito-config')) return;
    // Never overwrite a good previous snapshot while the new tab is still showing it,
    // or before the live widget structure exists. This was the cause of the empty-cache
    // regression where Dock rendering saved an empty widget layer first.
    if (generation !== captureGeneration) return;
    // A capture that lands while the Dock is magnified or something is being dragged is
    // postponed, not dropped: dropping it left the previous snapshot in place, so the
    // next new tab painted an outdated Dock and then visibly swapped to the real one.
    if (document.body.classList.contains('widget-drag-active') ||
        document.body.classList.contains('widget-gallery-open') ||
        document.body.classList.contains('dock-resizing') ||
        document.getElementById('dock')?.classList.contains('is-magnifying') ||
        document.querySelector('.dragging,.dock-drag-ghost') ||
        document.body.classList.contains('boot-widget-snapshot-active') ||
        !document.body.classList.contains('live-widgets-content-ready')) return 'retry';

    const widgetLayer = document.getElementById('desktop-widget-layer');
    const extrasDisabled = document.body.classList.contains('dev-disable-extra-features');
    const [widgetsHtml, desktopHtml, dockHtml, quickLinksHtml] = await Promise.all([
        extrasDisabled ? Promise.resolve('') : sanitizeWidgetSnapshot(widgetLayer),
        sanitizeSurfaceSnapshot(document.getElementById('desktop-grid'), 64, 64),
        sanitizeSurfaceSnapshot(document.getElementById('dock'), 90, 90),
        sanitizeSurfaceSnapshot(document.getElementById('quick-links'), 56, 56)
    ]);
    if (generation !== captureGeneration) return;

    const snapshot = {
        version: 55,
        timestamp: Date.now(),
        widgetsHtml,
        desktopHtml,
        dockHtml,
        quickLinksHtml,
        menuLeftHtml: restingMenuBarHtml(),
        spotlightPlaceholder: document.getElementById('search-input')?.getAttribute('placeholder') || '',
        photoWarmSources: extrasDisabled ? [] : collectWarmPhotoSources()
    };
    try {
        let serialized = JSON.stringify(snapshot);
        // As a final quota guard, preserve widget geometry/text even if user photos are huge.
        if (serialized.length > 4_000_000) {
            for (const key of ['widgetsHtml', 'desktopHtml', 'dockHtml', 'quickLinksHtml']) {
                const holder = document.createElement('div');
                holder.innerHTML = snapshot[key] || '';
                holder.querySelectorAll('img[src^="data:image/"]').forEach((img) => img.removeAttribute('src'));
                snapshot[key] = holder.innerHTML;
            }
            serialized = JSON.stringify(snapshot);
        }
        localStorage.setItem(BOOT_CACHE_KEY, serialized);
    } catch {
        // Boot caching is an optimization. Quota/security failures must never affect UI.
    }
}

const MAX_CAPTURE_RETRIES = 60;
export function scheduleBootVisualCache(delay = 850, attempt = 0) {
    captureGeneration += 1;
    const generation = captureGeneration;
    clearTimeout(timer);
    if (idleHandle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
    timer = setTimeout(() => {
        const run = () => {
            captureNow(generation).then((outcome) => {
                if (outcome === 'retry' && generation === captureGeneration && attempt < MAX_CAPTURE_RETRIES) scheduleBootVisualCache(1500, attempt + 1);
            }).catch(() => {});
        };
        if (typeof requestIdleCallback === 'function') idleHandle = requestIdleCallback(run, { timeout: 1800 });
        else run();
    }, Math.max(0, delay));
}

export function retireBootVisualSnapshot() {
    const layer = document.getElementById('boot-widget-snapshot-layer');
    if (!layer) {
        document.body.classList.remove('boot-widget-snapshot-active');
        document.body.classList.remove('boot-visual-snapshot-active');
        return;
    }
    document.body.classList.remove('boot-widget-snapshot-active');
    document.body.classList.remove('boot-visual-snapshot-active');
    layer.classList.add('retiring');
    setTimeout(() => layer.remove(), 130);
}

export { BOOT_CACHE_KEY };
