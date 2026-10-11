import { state } from './state.js';
import { $ } from './utils.js';
import { virtualNow } from './time.js';
import { applyDeveloperPreferences } from './developer.js';
import { applyAccentColor } from './accent.js';
import { syncLiveWallpaper } from './live-wallpaper.js';
import { blobToDataUrl, fitPicture } from './wallpaper-store.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const BING_URL_KEY = 'macOS_bing_url';
const BING_DATE_KEY = 'macOS_bing_date';
const WALL_CACHE = {
    light: 'macOS_bg_cache_light',
    dark: 'macOS_bg_cache_dark'
};

function todayKey() {
    const now = virtualNow();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function effectiveTheme(config = state.config) {
    const hour = virtualNow(config).getHours();
    if (config.themeMode === 'dark') return 'dark';
    if (config.themeMode === 'system') return media.matches ? 'dark' : 'light';
    if (config.themeMode === 'auto') return (hour >= 18 || hour < 6) ? 'dark' : 'light';
    return 'light';
}

function currentDayPhase() {
    const hour = virtualNow().getHours();
    return (hour >= 18 || hour < 6) ? 'night' : 'day';
}

function notifyAppearance(mode, wallpaperValue) {
    const previousTheme = state.effectiveTheme;
    const previousWallpaper = state.currentWallpaper;
    state.effectiveTheme = mode;
    state.currentWallpaper = wallpaperValue || '';
    if (!state.themeInitialized) {
        state.themeInitialized = true;
        return;
    }
    if (previousTheme !== mode || previousWallpaper !== state.currentWallpaper) {
        window.dispatchEvent(new CustomEvent('macos-appearance-change', { detail: { theme: mode, wallpaper: state.currentWallpaper } }));
    }
}

function safeCacheSet(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

// The first-paint copy is made once per picture (both appearances often share one) and
// off the main thread, so switching wallpaper does not stall on encoding it.
let lastPreview = { source: '', preview: null };
function makeFirstPaintPreview(dataUrl) {
    if (lastPreview.source === dataUrl) return lastPreview.preview;
    const maxWidth = Math.max(1440, Math.min(window.screen?.width || 1920, 2560));
    const preview = (async () => {
        const blob = await (await fetch(dataUrl)).blob();
        const fitted = await fitPicture(blob, [maxWidth, Math.round(maxWidth * 9 / 16)], { type: 'image/webp', quality: 0.84, keepSmall: false });
        return blobToDataUrl(fitted.blob);
    })();
    lastPreview = { source: dataUrl, preview };
    return preview;
}

export async function cacheWallpaperForFirstPaint(mode, value) {
    if (state.incognitoConfigMode) return;
    const key = WALL_CACHE[mode];
    if (!key || typeof value !== 'string' || !value) return;
    const signatureKey = `${key}_signature`;
    const signature = `${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
    try {
        if (localStorage.getItem(signatureKey) === signature && localStorage.getItem(key)) return;
    } catch { /* continue and rebuild cache */ }

    if (value.startsWith('assets/') || /^https:\/\//i.test(value)) {
        if (safeCacheSet(key, value)) safeCacheSet(signatureKey, signature);
        return;
    }
    if (!value.startsWith('data:image/')) return;

    // Store the exact image when practical. If it is too large for localStorage,
    // persist a visually equivalent WebP preview used only for first paint.
    if (value.length <= 850_000 && safeCacheSet(key, value)) { safeCacheSet(signatureKey, signature); return; }
    try {
        const preview = await makeFirstPaintPreview(value);
        if (safeCacheSet(key, preview)) safeCacheSet(signatureKey, signature);
        else localStorage.removeItem(key);
    } catch {
        try { localStorage.removeItem(key); } catch { /* no-op */ }
    }
}

export function refreshWallpaperCaches() {
    if (!state.config) return Promise.resolve();
    return Promise.allSettled([
        cacheWallpaperForFirstPaint('light', state.config.wallpaperLight),
        cacheWallpaperForFirstPaint('dark', state.config.wallpaperDark)
    ]);
}

function cacheBaseState(mode) {
    const config = state.config;
    if (state.incognitoConfigMode) return;
    try {
        localStorage.setItem('macOS_theme_cache', config.themeMode || 'system');
        localStorage.setItem('macOS_bing_cache', String(Boolean(config.useBingWallpaper)));
    } catch { /* cache failure must never block theme application */ }
}

/** The Bing picture size that suits this display: 1080p, 1440p or 4K. */
export function bingTargetSize() {
    const pixels = Math.max(window.screen?.width || 1920, window.innerWidth) * Math.min(2, window.devicePixelRatio || 1);
    if (pixels > 2560) return [3840, 2160];
    return pixels > 1920 ? [2560, 1440] : [1920, 1080];
}

/** Today's Bing picture (looked up once a day, then served from the cache). */
export async function resolveBingDailyWallpaper() {
    const cachedDate = localStorage.getItem(BING_DATE_KEY);
    const cachedUrl = localStorage.getItem(BING_URL_KEY);
    if (cachedDate === todayKey() && cachedUrl) return cachedUrl;

    try {
        const response = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const image = data?.images?.[0];
        if (!image?.url) return cachedUrl || null;
        const [width, height] = bingTargetSize();
        // urlbase + _UHD lets the server scale to the display instead of always sending 1080p.
        const url = /^\/th\?id=OHR\.[\w.-]+$/.test(image.urlbase || '')
            ? `https://www.bing.com${image.urlbase}_UHD.jpg&w=${width}&h=${height}&rs=1&c=4`
            : new URL(image.url, 'https://www.bing.com').href;
        localStorage.setItem(BING_URL_KEY, url);
        localStorage.setItem(BING_DATE_KEY, todayKey());
        localStorage.setItem('macOS_bing_title', String(image.title || '').slice(0, 120));
        return url;
    } catch {
        return cachedUrl || null;
    }
}

function cssUrl(value) {
    return `url("${value.replaceAll('"', '%22')}")`;
}

function syncLaunchpadWallpaper(value) {
    const layer = $('launchpad-wallpaper-layer');
    if (layer && value) layer.style.backgroundImage = cssUrl(value);
}

// Appearance changes are animated once the desktop is up, unless motion is reduced or the
// tab is not being looked at.
const motionAllowed = () => Boolean(state.themeInitialized) && !document.hidden
    && document.body.classList.contains('wallpaper-transitions-enabled') && !state.config?.accessibility?.disableAnimations;

/**
 * Runs `update` (a synchronous change of appearance: light / dark for the system or for one
 * window) as a cross-fade of the whole desktop instead of a hard cut.
 */
export function runAppearanceTransition(update) {
    if (!motionAllowed() || typeof document.startViewTransition !== 'function') { update(); return Promise.resolve(); }
    let done = false;
    const once = () => { if (!done) { done = true; update(); } };
    try {
        document.documentElement.classList.add('appearance-transition');
        const transition = document.startViewTransition(once);
        const finish = () => document.documentElement.classList.remove('appearance-transition');
        transition.finished.then(finish, finish);
        // The change itself never waits for, or depends on, the animation.
        return transition.updateCallbackDone.catch(once);
    } catch { once(); document.documentElement.classList.remove('appearance-transition'); return Promise.resolve(); }
}

/** Resolves once the picture can be painted without a decode pause (or after `limit` ms). */
function pictureReady(value, limit = 1500) {
    return new Promise((resolve) => {
        const image = new Image();
        const timer = setTimeout(resolve, limit);
        const done = () => { clearTimeout(timer); resolve(); };
        image.src = value;
        if (image.decode) image.decode().then(done, done); else { image.onload = done; image.onerror = done; }
    });
}

let wallpaperToken = 0;
let wallpaperShown = '';
/**
 * Puts a picture on the desktop. A change of picture dissolves in over the old one, which
 * stays underneath until the new one is fully there.
 */
async function showWallpaper(value, { animate = true } = {}) {
    const wallpaper = $('wallpaper');
    if (!wallpaper || !value) return;
    syncLaunchpadWallpaper(value);
    if (wallpaperShown === value) return;
    const first = !wallpaperShown;
    wallpaperShown = value;
    const token = ++wallpaperToken;
    const settle = () => { wallpaper.style.backgroundImage = cssUrl(value); wallpaper.querySelectorAll('.wallpaper-fade-layer').forEach((layer) => layer.remove()); };
    if (first || !animate || !motionAllowed() || typeof wallpaper.animate !== 'function') { settle(); return; }
    await pictureReady(value);
    if (token !== wallpaperToken) return;
    const layer = document.createElement('div');
    layer.className = 'wallpaper-fade-layer';
    layer.style.backgroundImage = cssUrl(value);
    // Below a live wallpaper's video, above the picture being replaced.
    wallpaper.insertBefore(layer, wallpaper.querySelector('#wallpaper-video'));
    // Opacity and scale only: both are compositor work. (A blur over the whole desktop was not.)
    const animation = layer.animate([{ opacity: 0, transform: 'scale(1.045)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 1100, easing: 'cubic-bezier(.22,.7,.2,1)', fill: 'both' });
    const finish = () => { if (token === wallpaperToken) settle(); };
    animation.finished.then(finish, finish);
}

export async function applyTheme() {
    if (!state.config) return;
    const requestId = ++state.themeRequestId;
    const mode = effectiveTheme();
    cacheBaseState(mode);

    const body = document.body;
    const fallback = mode === 'dark' ? 'assets/images/sequoia.shape.night.jpg' : 'assets/images/sequoia.shape.day.jpg';
    const ownWallpaper = (mode === 'dark' ? state.config.wallpaperDark : state.config.wallpaperLight) || fallback;
    const applyClasses = () => {
        body.classList.toggle('dark-mode', mode === 'dark');
        body.classList.toggle('light-mode', mode === 'light');
        body.classList.toggle('light-icon-bg-in-dark', Boolean(state.config.dock?.lightBgInDark));
        // preload.js may temporarily provide a synchronous boot-theme selector. Remove it
        // only after the live body classes are already correct, so there is no theme flash.
        delete document.documentElement.dataset.bootTheme;
        applyDeveloperPreferences(state.config);
        applyAccentColor(state.config);
    };

    // Light <-> dark: the whole desktop, wallpaper included, dissolves from one appearance
    // into the other in a single step.
    const switching = body.classList.contains('dark-mode') !== (mode === 'dark') && motionAllowed();
    if (switching) {
        const bing = state.config.useBingWallpaper;
        if (!bing) await pictureReady(ownWallpaper, 500);
        if (requestId !== state.themeRequestId) return;
        await runAppearanceTransition(() => {
            applyClasses();
            if (!bing) { showWallpaper(ownWallpaper, { animate: false }); notifyAppearance(mode, ownWallpaper); }
            else notifyAppearance(mode, state.currentWallpaper);
        });
        if (requestId !== state.themeRequestId) return;
    } else {
        applyClasses();
    }

    if (!$('wallpaper')) return;

    syncLiveWallpaper().catch(() => {});
    if (state.config.useBingWallpaper) {
        const url = await resolveBingDailyWallpaper();
        if (requestId !== state.themeRequestId || !state.config.useBingWallpaper) return;
        if (url) {
            showWallpaper(url);
            try { localStorage.setItem('macOS_bing_url', url); } catch { /* no-op */ }
            notifyAppearance(mode, url);
            return;
        }
    }

    showWallpaper(ownWallpaper);
    notifyAppearance(mode, ownWallpaper);

    // Update next-tab first-paint caches without blocking this paint.
    if (!state.incognitoConfigMode) refreshWallpaperCaches();
}

export function startThemeObservers() {
    state.dayPhase = currentDayPhase();
    media.addEventListener('change', () => {
        if (state.config?.themeMode === 'system') applyTheme();
        else window.dispatchEvent(new CustomEvent('macos-appearance-change', { detail: { systemTheme: media.matches ? 'dark' : 'light' } }));
    });

    let previousAutoTheme = effectiveTheme();
    setInterval(() => {
        const phase = currentDayPhase();
        if (state.dayPhase && phase !== state.dayPhase) {
            state.dayPhase = phase;
            window.dispatchEvent(new CustomEvent('macos-dayphase-change', { detail: { phase } }));
        } else if (!state.dayPhase) {
            state.dayPhase = phase;
        }

        if (state.config?.themeMode === 'auto') {
            const next = effectiveTheme();
            if (next !== previousAutoTheme) {
                previousAutoTheme = next;
                applyTheme();
            }
        }
    }, 30_000);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        const phase = currentDayPhase();
        if (state.dayPhase && phase !== state.dayPhase) {
            state.dayPhase = phase;
            window.dispatchEvent(new CustomEvent('macos-dayphase-change', { detail: { phase } }));
        } else if (!state.dayPhase) {
            state.dayPhase = phase;
        }
        if (state.config?.themeMode === 'auto' || state.config?.themeMode === 'system') applyTheme();
    });
}
