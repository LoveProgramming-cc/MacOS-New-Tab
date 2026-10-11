import { state } from './state.js';

export const $ = (id) => document.getElementById(id);

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export function debounce(fn, wait = 80) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

export function normalizeUrl(input, { allowInternal = true } = {}) {
    if (typeof input !== 'string') return null;
    let value = input.trim();
    if (!value) return null;

    if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) value = `https://${value}`;

    const protocol = value.slice(0, value.indexOf(':') + 1).toLowerCase();
    if (allowInternal && (protocol === 'chrome:' || protocol === 'edge:')) return value;
    if (protocol !== 'http:' && protocol !== 'https:') return null;

    try {
        return new URL(value).href;
    } catch {
        return null;
    }
}

export function navigateTo(input) {
    const url = normalizeUrl(input);
    if (!url) return;
    // Browser-internal pages (chrome://bookmarks, chrome://downloads …) refuse ordinary
    // navigation from a page; the tabs API is allowed to open them.
    const tabs = typeof chrome !== 'undefined' ? chrome.tabs : null;
    // “Open links in a new tab” keeps this desktop (and whatever is running on it) open.
    if (state.config?.openLinksInNewTab && tabs?.create) {
        try { tabs.create({ url }); return; } catch { /* fall through */ }
    }
    if (/^(?:chrome|edge):/i.test(url) && tabs?.update) {
        try { tabs.update({ url }); return; } catch { /* fall through */ }
    }
    window.location.href = url;
}

export function createElement(tag, { className = '', text = '', attrs = {}, dataset = {} } = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null && text !== '') el.textContent = String(text);
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null) el.setAttribute(key, String(value));
    }
    for (const [key, value] of Object.entries(dataset)) {
        if (value !== undefined && value !== null) el.dataset[key] = String(value);
    }
    return el;
}

export function safeDataImage(value) {
    return typeof value === 'string' && /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)(?:;[^,]*)?,/i.test(value);
}

export function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
        reader.readAsDataURL(file);
    });
}

export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
        reader.readAsText(file);
    });
}

// Uploaded launcher icons are shown at 128 CSS px at most. Storing the original file
// (often several MB) would bloat every config save, so keep a 256 px PNG instead.
export async function readFileAsIconDataUrl(file, maxSize = 256) {
    const original = await readFileAsDataUrl(file);
    try {
        const image = new Image();
        image.decoding = 'async';
        image.src = original;
        await image.decode();
        const width = Math.max(1, image.naturalWidth || maxSize);
        const height = Math.max(1, image.naturalHeight || maxSize);
        if (Math.max(width, height) <= maxSize && original.length <= 200_000) return original;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
    } catch {
        return original;
    }
}
