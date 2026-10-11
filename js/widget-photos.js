// Photo widgets: the picture library of each widget, importing and compressing photos,
// and the schedules that move a widget on to its next picture.

import { state } from './state.js';
import { WIDGET_MEDIA_KEY, WIDGET_PHOTO_STATE_KEY } from './constants.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { secondsBaseEnabled } from './developer.js';
import { allPhotoWidgets, clone, findPlacedWidget, photoAdvanceInflight, photoPreloadCache, photoTimers, photoTriggerStamp, storageGet, storageSet, widgetsRuntimeDisabled } from './widgets.js';
import { renderPhotoSettingsControls } from './widget-settings.js';

export let mediaCache = null;
let mediaLoadPromise = null;
let photoStateLastSavedAt = 0;
let photoStateCache = null;
let photoStateSaveTimer = null;
let photoStateLoadPromise = null;
export function getPhotoState() {
    if (photoStateCache) return Promise.resolve(photoStateCache);
    if (!photoStateLoadPromise) {
        photoStateLoadPromise = storageGet(WIDGET_PHOTO_STATE_KEY).then((value) => {
            photoStateCache = value && typeof value === 'object' ? value : {};
            return photoStateCache;
        }).finally(() => { photoStateLoadPromise = null; });
    }
    return photoStateLoadPromise;
}
export function flushPhotoState() {
    clearTimeout(photoStateSaveTimer);
    photoStateSaveTimer = null;
    if (!photoStateCache || state.incognitoConfigMode) return Promise.resolve();
    photoStateLastSavedAt = Date.now();
    return storageSet(WIDGET_PHOTO_STATE_KEY, photoStateCache).catch(() => {});
}
export function queuePhotoStateSave(delay = 1400) {
    clearTimeout(photoStateSaveTimer);
    const elapsed = Date.now() - photoStateLastSavedAt;
    // A one-second slideshow must not write extension storage every second. Persist at
    // most about once per five seconds, and flush immediately when the page is hidden.
    const wait = elapsed >= 5000 ? 0 : Math.max(delay, 5000 - elapsed);
    photoStateSaveTimer = setTimeout(() => { flushPhotoState(); }, wait);
}
async function photoSelectedIndex(sourceId, source) {
    const photoState = await getPhotoState();
    const saved = Number(photoState[sourceId]);
    return Number.isFinite(saved) ? Math.max(0, Math.floor(saved)) : Math.max(0, Math.floor(Number(source?.selectedIndex) || 0));
}
export async function setPhotoSelectedIndex(sourceId, index, { persist = true } = {}) {
    const photoState = await getPhotoState();
    photoState[sourceId] = Math.max(0, Math.floor(Number(index) || 0));
    if (persist) queuePhotoStateSave();
}

const PHOTO_IMPORT_TARGET_SHORT_EDGE = 665;
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Unable to read image'));
        reader.readAsDataURL(blob);
    });
}
async function loadImageForResize(file) {
    if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        if (typeof img.decode === 'function') await img.decode();
        else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
        img.__widgetObjectUrl = url;
        return img;
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}
async function compressPhotoFile(file, targetShortEdge = PHOTO_IMPORT_TARGET_SHORT_EDGE) {
    const bitmap = await loadImageForResize(file);
    const width = Number(bitmap.naturalWidth || bitmap.width || 1);
    const height = Number(bitmap.naturalHeight || bitmap.height || 1);
    // The largest widget is 332 CSS px square; on the target Retina display that is
    // about 664 device pixels. Preserve a 665 px SHORT edge for object-fit:cover.
    // Small source images are never upscaled.
    const shortEdge = Math.max(1, Math.min(width, height));
    const scale = Math.min(1, targetShortEdge / shortEdge);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();
    if (bitmap.__widgetObjectUrl) URL.revokeObjectURL(bitmap.__widgetObjectUrl);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.96));
    if (!blob) throw new Error('Image compression failed');
    return { name: file.webkitRelativePath || file.name, data: await blobToDataUrl(blob), width: targetWidth, height: targetHeight };
}
export function setPhotoImportProgress({ visible = true, value = 0, total = 1, label = '' } = {}) {
    const row = $('widget-photo-import-progress-row');
    const bar = $('widget-photo-import-progress');
    const text = $('widget-photo-import-progress-label');
    if (row) row.classList.toggle('hidden', !visible);
    if (bar) { bar.max = Math.max(1, total); bar.value = Math.max(0, Math.min(total, value)); }
    if (text) text.textContent = label || t('photoImportProgress', '正在导入 {current}/{total}').replace('{current}', String(value)).replace('{total}', String(total));
}
export async function importCompressedPhotos(files, onProgress = null) {
    const input = [...files].filter((file) => file?.type?.startsWith('image/')).slice(0, 80);
    const photos = [];
    for (let i = 0; i < input.length; i += 1) {
        onProgress?.(i, input.length, input[i]);
        try { photos.push(await compressPhotoFile(input[i])); } catch (error) { console.debug('photo import skipped', input[i]?.name, error); }
        onProgress?.(i + 1, input.length, input[i]);
        // Yield between images so progress paint/input stays responsive.
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
    return photos;
}
export function defaultPhotoSource() {
    return {
        photos: [],
        mode: 'single',
        selectedIndex: 0,
        schedule: {
            mode: 'manual',
            intervalValue: 30,
            intervalUnit: secondsBaseEnabled() ? 'seconds' : 'minutes',
            events: { dayNight: false, appearance: false, newTab: false }
        }
    };
}

export function normalizePhotoSource(source) {
    const base = defaultPhotoSource();
    const raw = source && typeof source === 'object' ? source : {};
    const photos = Array.isArray(raw.photos) ? raw.photos.filter((p) => p && typeof p.data === 'string' && p.data.startsWith('data:image/')).slice(0, 80) : [];
    const schedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
    const scheduleMode = ['manual', 'interval', 'events'].includes(schedule.mode) ? schedule.mode : 'manual';
    const intervalUnit = ['seconds', 'minutes', 'hours', 'days'].includes(schedule.intervalUnit) ? schedule.intervalUnit : (secondsBaseEnabled() ? 'seconds' : 'minutes');
    return {
        photos,
        mode: raw.mode === 'cycle' ? 'cycle' : 'single',
        selectedIndex: Math.max(0, Math.floor(Number(raw.selectedIndex) || 0)),
        schedule: {
            mode: scheduleMode,
            intervalValue: Math.max(1, Math.min(1440, Number(schedule.intervalValue) || 30)),
            intervalUnit,
            events: {
                dayNight: Boolean(schedule.events?.dayNight),
                appearance: Boolean(schedule.events?.appearance),
                newTab: Boolean(schedule.events?.newTab)
            }
        }
    };
}

export async function getMedia() {
    if (mediaCache) return mediaCache;
    if (!mediaLoadPromise) {
        mediaLoadPromise = storageGet(WIDGET_MEDIA_KEY).then((value) => {
            const raw = value && typeof value === 'object' ? value : {};
            const photoSources = {};
            if (raw.photoSources && typeof raw.photoSources === 'object') {
                Object.entries(raw.photoSources).forEach(([id, source]) => { photoSources[id] = normalizePhotoSource(source); });
            }
            mediaCache = { photos: Array.isArray(raw.photos) ? raw.photos : [], photoSources };
            return mediaCache;
        }).finally(() => { mediaLoadPromise = null; });
    }
    return mediaLoadPromise;
}
export async function setMedia(value) {
    mediaCache = value;
    if (!state.incognitoConfigMode) await storageSet(WIDGET_MEDIA_KEY, value);
}

export function resetWidgetMediaCache() {
    mediaCache = null;
    mediaLoadPromise = null;
    photoStateCache = null;
    photoStateLoadPromise = null;
    photoPreloadCache.clear();
    photoTimers.forEach((timer) => clearTimeout(timer));
    photoTimers.clear();
}

export function photoSourceId(widget) {
    if (!widget) return '';
    if (!widget.photoSourceId) widget.photoSourceId = `photo-source-${widget.id}`;
    return widget.photoSourceId;
}

export async function ensurePhotoSources() {
    const media = await getMedia();
    let mediaChanged = false;
    let configChanged = false;
    const legacy = Array.isArray(media.photos) ? media.photos.filter((p) => p && typeof p.data === 'string') : [];
    for (const widget of allPhotoWidgets()) {
        if (!widget.photoSourceId) {
            widget.photoSourceId = `photo-source-${widget.id}`;
            configChanged = true;
        }
        if (!media.photoSources[widget.photoSourceId]) {
            const source = defaultPhotoSource();
            if (legacy.length) {
                source.photos = clone(legacy);
                source.mode = legacy.length > 1 ? 'cycle' : 'single';
                const legacyCfg = state.config.widgets?.photos || {};
                source.selectedIndex = Math.max(0, Number(legacyCfg.selectedIndex) || 0);
            }
            media.photoSources[widget.photoSourceId] = source;
            mediaChanged = true;
        }
    }
    if (mediaChanged) await setMedia(media);
    if (configChanged) await saveConfig();
    return media;
}

function intervalMilliseconds(schedule) {
    const value = Math.max(1, Number(schedule?.intervalValue) || 1);
    if (schedule?.intervalUnit === 'days') return value * 24 * 60 * 60 * 1000;
    if (schedule?.intervalUnit === 'hours') return value * 60 * 60 * 1000;
    if (schedule?.intervalUnit === 'minutes') return value * 60 * 1000;
    return value * 1000;
}

async function takeBootPreloadedPhoto(src) {
    const entries = globalThis.__macOSBootPhotoPreloads;
    if (!Array.isArray(entries) || !src) return null;
    const index = entries.findIndex((entry) => entry?.src === src);
    if (index < 0) return null;
    const [entry] = entries.splice(index, 1);
    try {
        const ok = await entry.done;
        return ok === false ? null : entry.img;
    } catch { return null; }
}

async function takePreloadedPhoto(sourceId, src) {
    const cached = sourceId ? photoPreloadCache.get(sourceId) : null;
    if (!cached || cached.src !== src) return takeBootPreloadedPhoto(src);
    photoPreloadCache.delete(sourceId);
    try {
        const ok = await cached.done;
        return ok === false ? null : cached.img;
    } catch {
        return null;
    }
}

async function setPhotoFrameImage(frame, src, animate = true, sourceId = '') {
    if (!frame || !src) return;
    const current = frame.querySelector('img.photo-current');
    if (current?.dataset.src === src) return;

    // Consume the already-decoded next image when available. This turns a normal
    // slideshow step into an opacity/compositor operation instead of decoding on click.
    let next = await takePreloadedPhoto(sourceId, src);
    if (!next) {
        next = document.createElement('img');
        next.decoding = 'async';
        next.fetchPriority = 'low';
        next.src = src;
        try {
            if (typeof next.decode === 'function') await next.decode();
            else await new Promise((resolve, reject) => { next.onload = resolve; next.onerror = reject; });
        } catch { return; }
    }
    next.alt = '';
    next.decoding = 'async';
    next.fetchPriority = 'low';
    next.dataset.src = src;
    next.className = 'photo-next';

    if (!animate || !current) {
        next.className = 'photo-current';
        frame.replaceChildren(next);
        return;
    }

    frame.appendChild(next);
    requestAnimationFrame(() => {
        next.classList.add('photo-visible');
        current.classList.add('photo-fading');
        window.setTimeout(() => {
            if (current.isConnected) current.remove();
            next.className = 'photo-current';
        }, 260);
    });
}

function preloadPhoto(sourceId, src) {
    if (!sourceId || !src || photoPreloadCache.get(sourceId)?.src === src) return;
    globalThis.__macOSPhotoWarmSources ||= new Map();
    globalThis.__macOSPhotoWarmSources.set(sourceId, src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    const done = typeof img.decode === 'function' ? img.decode().then(() => true).catch(() => false) : Promise.resolve(true);
    photoPreloadCache.set(sourceId, { src, img, done });
}

export async function populatePhoto(card, widget, { animate = false } = {}) {
    const frame = card.querySelector('.photo-widget-frame');
    if (!frame) return;
    const media = await getMedia();
    const sourceId = photoSourceId(widget);
    const source = normalizePhotoSource(media.photoSources[sourceId]);
    const photos = source.photos;
    card.classList.toggle('widget-photo-has-image', photos.length > 0);
    if (!photos.length) {
        frame.replaceChildren(createElement('div', { className: 'photo-widget-empty', text: t('widgetPhotoEmpty', '在设置中选择照片') }));
        return;
    }
    const selectedIndex = await photoSelectedIndex(sourceId, source);
    const index = source.mode === 'single' ? Math.min(photos.length - 1, selectedIndex) : (selectedIndex % photos.length);
    const currentSrc = photos[index]?.data || '';
    globalThis.__macOSPhotoCurrentSources ||= new Map();
    if (currentSrc) globalThis.__macOSPhotoCurrentSources.set(sourceId, currentSrc);
    await setPhotoFrameImage(frame, currentSrc, animate, sourceId);
    if (source.mode === 'cycle' && photos.length > 1) preloadPhoto(sourceId, photos[(index + 1) % photos.length]?.data);
}

export async function updatePhotoWidget(widgetId, animate = true) {
    const widget = findPlacedWidget(widgetId);
    if (!widget || widget.type !== 'photo') return;
    const cards = document.querySelectorAll(`.widget-card[data-widget-id="${CSS.escape(widgetId)}"]`);
    for (const card of cards) await populatePhoto(card, widget, { animate });
}

export async function advancePhotoWidget(widget, trigger = 'interval') {
    if (!widget || widget.type !== 'photo' || widgetsRuntimeDisabled()) return;
    const id = photoSourceId(widget);
    if (photoAdvanceInflight.has(id)) return;
    const now = Date.now();
    if (now - (photoTriggerStamp.get(id) || 0) < 250) return;
    photoTriggerStamp.set(id, now);
    photoAdvanceInflight.add(id);
    try {
        const media = await getMedia();
        const source = normalizePhotoSource(media.photoSources[id]);
        if (source.mode !== 'cycle' || source.photos.length <= 1) return;
        const currentIndex = await photoSelectedIndex(id, source);
        const nextIndex = (currentIndex + 1) % source.photos.length;

        // Visual update first. Persist only the tiny playback index, never the complete
        // Base64 library. Fast slides are coalesced into a storage write every few seconds.
        await setPhotoSelectedIndex(id, nextIndex, { persist: false });
        source.selectedIndex = nextIndex;
        media.photoSources[id] = source;
        await updatePhotoWidget(widget.id, true);
        queuePhotoStateSave();
        if (state.selectedPhotoWidgetId === widget.id) renderPhotoSettingsControls();
    } finally {
        photoAdvanceInflight.delete(id);
    }
}

let photoSchedulerGeneration = 0;
export function clearPhotoTimers() {
    photoSchedulerGeneration += 1;
    photoTimers.forEach((timer) => clearTimeout(timer));
    photoTimers.clear();
}

export async function restartPhotoSchedulers() {
    clearPhotoTimers();
    if (widgetsRuntimeDisabled()) return;
    const generation = photoSchedulerGeneration;
    const media = await ensurePhotoSources();
    for (const widget of allPhotoWidgets()) {
        const source = normalizePhotoSource(media.photoSources[photoSourceId(widget)]);
        if (source.mode !== 'cycle' || source.photos.length <= 1 || source.schedule.mode !== 'interval') continue;
        const period = Math.max(1_000, intervalMilliseconds(source.schedule));
        const schedule = () => {
            if (generation !== photoSchedulerGeneration || widgetsRuntimeDisabled()) return;
            const timer = setTimeout(async () => {
                if (generation !== photoSchedulerGeneration || widgetsRuntimeDisabled()) return;
                try { await advancePhotoWidget(widget, 'interval'); } catch {}
                schedule();
            }, period);
            photoTimers.set(widget.id, timer);
        };
        schedule();
    }
}

export async function triggerPhotoEvent(eventName) {
    if (widgetsRuntimeDisabled()) return;
    const media = await ensurePhotoSources();
    for (const widget of allPhotoWidgets()) {
        const source = normalizePhotoSource(media.photoSources[photoSourceId(widget)]);
        if (source.mode !== 'cycle' || source.photos.length <= 1 || source.schedule.mode !== 'events') continue;
        if (source.schedule.events?.[eventName]) await advancePhotoWidget(widget, eventName);
    }
}
