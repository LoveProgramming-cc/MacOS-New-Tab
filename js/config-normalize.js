// Normalising a configuration: launchers, folders, the Trash, and the configuration as a whole.

import { FALLBACK_CONFIG, ENGINES } from './constants.js';
import { clamp, deepClone, normalizeUrl, safeDataImage } from './utils.js';
import { normalizeWidgets } from './config-widgets.js';
import { normalizePlugins } from './config-plugins.js';

const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const THEMES = new Set(['light', 'dark', 'system', 'auto']);
const ACCENT_OPTIONS = new Set(['multicolor', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']);
const MODIFIERS = new Set(['Meta', 'Alt', 'Shift']);
const ACTIONS = new Set(['toggleLaunchpad', 'toggleSettings', 'openDevTools']);
const PLUGIN_APP_ACTION = /^pluginApp:([a-z0-9._-]{1,80})$/i;
function normalizeActionValue(value) {
    if (ACTIONS.has(value)) return value;
    const text = typeof value === 'string' ? value.trim() : '';
    return PLUGIN_APP_ACTION.test(text) ? text : undefined;
}
function validActionValue(value) { return Boolean(normalizeActionValue(value)); }

export async function fetchJsonSafely(path, fallback) {
    try {
        const response = await fetch(chrome.runtime.getURL(path));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch {
        return deepClone(fallback);
    }
}

export function stringOr(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

export function booleanOr(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

export function normalizeIcon(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    // Builds before 0.55.1 pointed icon-less plugin launchers at a file that never existed.
    if (value === 'assets/images/noicon.svg') return 'assets/icons/noicon.svg';
    if (value.startsWith('assets/') || safeDataImage(value)) return value;
    return fallback;
}

function normalizeWallpaper(value, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const trimmed = value.trim();
    if (trimmed.startsWith('assets/') || safeDataImage(trimmed) || /^https:\/\//i.test(trimmed)) return trimmed;
    return fallback;
}

function inferNameKey(raw, fallback = {}) {
    const explicit = stringOr(raw?.nameKey, stringOr(fallback?.nameKey, '')).trim();
    if (explicit) return explicit.slice(0, 100);

    const action = raw?.action || fallback?.action;
    if (action === 'toggleLaunchpad') return 'appLaunchpad';
    if (action === 'toggleSettings') return 'appSystemSettings';

    const url = normalizeUrl(raw?.url || fallback?.url || '');
    if (!url) return '';
    if (url === 'chrome://bookmarks/') return 'appFinder';
    const rules = [
        ['https://www.icloud.com/iclouddrive/', 'appFinder'],
        ['https://www.icloud.com/mail/', 'appMail'],
        ['https://www.icloud.com/photos/', 'appPhotos'],
        ['https://www.icloud.com/calendar/', 'appCalendar'],
        ['https://www.icloud.com/notes/', 'appNotes'],
        ['https://www.icloud.com/reminders/', 'appReminders'],
        ['https://www.icloud.com/find/', 'appFindMy'],
        ['https://maps.apple.com/', 'appMaps']
    ];
    for (const [prefix, key] of rules) {
        if (url.startsWith(prefix)) return key;
    }
    if (url.startsWith('https://chromewebstore.google.com/') && ['App Store', '应用商店'].includes(raw?.name || fallback?.name)) return 'appAppStore';
    if (url.startsWith('https://www.google.com/') && ['Safari浏览器', 'Safari'].includes(raw?.name || fallback?.name)) return 'appSafari';
    return '';
}

function normalizeApp(raw, fallback = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const action = normalizeActionValue(raw.action) || normalizeActionValue(fallback.action);
    const rawUrl = typeof raw.url === 'string' ? raw.url : fallback.url;
    const url = rawUrl ? normalizeUrl(rawUrl) : null;
    const name = stringOr(raw.name, stringOr(fallback.name, '')).slice(0, 120);
    if (!name || (!url && !action)) return null;

    const nameKey = inferNameKey(raw, fallback);
    const icon = normalizeIcon(raw.icon, normalizeIcon(fallback.icon, ''));
    const builtInProtected = Boolean(nameKey && icon.startsWith('assets/'));
    const app = {
        name,
        enName: stringOr(raw.enName, stringOr(fallback.enName, '')).slice(0, 120),
        nameKey,
        icon,
        originalIcon: normalizeIcon(raw.originalIcon, normalizeIcon(fallback.originalIcon, '')),
        forceBg: booleanOr(raw.forceBg, Boolean(fallback.forceBg)),
        isSystem: booleanOr(raw.isSystem, Boolean(fallback.isSystem)),
        protected: booleanOr(raw.protected, Boolean(fallback.protected) || builtInProtected),
        useBg: booleanOr(raw.useBg, fallback.useBg !== false),
        addedAt: Number.isFinite(Number(raw.addedAt)) ? Number(raw.addedAt) : (Number.isFinite(Number(fallback.addedAt)) ? Number(fallback.addedAt) : 0),
        lastAccessedAt: Number.isFinite(Number(raw.lastAccessedAt)) ? Number(raw.lastAccessedAt) : (Number.isFinite(Number(fallback.lastAccessedAt)) ? Number(fallback.lastAccessedAt) : 0)
    };

    if (url) app.url = url;
    if (action) app.action = action;

    const cx = Number.isFinite(Number(raw.cx)) ? Number(raw.cx) : (Number.isFinite(Number(raw.x)) ? Number(raw.x) : undefined);
    const cy = Number.isFinite(Number(raw.cy)) ? Number(raw.cy) : (Number.isFinite(Number(raw.y)) ? Number(raw.y) : undefined);
    if (cx !== undefined) app.cx = clamp(cx, -10000, 10000);
    if (cy !== undefined) app.cy = clamp(cy, -10000, 10000);

    return app;
}

// Built-in launchers known to this build, used to recognise entries that an older
// build corrupted. Before 0.55.1 an entry inherited icon / action / nameKey / url from
// whichever default app sat at the same array index, so a custom site dropped into
// Launchpad's slot turned into a second Launchpad on the next load.
function builtInCatalog(defaults) {
    return ['dockApps', 'desktopApps', 'quickLinks', 'launchpadApps']
        .flatMap((key) => (Array.isArray(defaults?.[key]) ? defaults[key] : []))
        .filter((entry) => entry && typeof entry === 'object');
}

function sameBuiltInName(raw, entry) {
    return Boolean((raw.name && raw.name === entry.name) || (raw.enName && raw.enName === entry.enName));
}

export let identityRepairs = 0;
/** Starts a new count of the launchers normalizeConfig() has to repair. */
export function resetIdentityRepairs() { identityRepairs = 0; }
function repairAppIdentity(raw, catalog) {
    if (!catalog?.length || !raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const nameKey = typeof raw.nameKey === 'string' ? raw.nameKey : '';
    const icon = typeof raw.icon === 'string' && raw.icon.startsWith('assets/') ? raw.icon : '';
    const action = ACTIONS.has(raw.action) ? raw.action : '';
    const hasUrl = typeof raw.url === 'string' && raw.url.trim() !== '';
    // An entry that is exactly a shipped default (default.json deliberately gives a few
    // plain links a built-in icon) is left alone.
    const url = normalizeUrl(typeof raw.url === 'string' ? raw.url : '');
    if (catalog.some((entry) => entry.name === raw.name && (entry.icon || '') === (raw.icon || '') && (entry.nameKey || '') === nameKey
        && (entry.action || '') === (raw.action || '') && normalizeUrl(entry.url || '') === url)) return raw;
    const related = catalog.filter((entry) => (entry.nameKey || entry.action)
        && ((nameKey && entry.nameKey === nameKey) || (icon && entry.icon === icon) || (action && entry.action === action)));
    if (!related.length) return raw;

    // The name is the one field the index fallback never overwrote, so it identifies
    // what the entry really is.
    const match = related.find((entry) => sameBuiltInName(raw, entry) || (!entry.url && !hasUrl));
    const app = { ...raw };
    let changed = false;
    if (match) {
        if (!match.url && hasUrl) { delete app.url; changed = true; }
        if (!match.action && action) { delete app.action; changed = true; }
    } else {
        for (const entry of related) {
            if (nameKey && entry.nameKey === nameKey && app.nameKey) { app.nameKey = ''; changed = true; }
            if (icon && entry.icon === icon && app.icon) { app.icon = ''; changed = true; }
            if (action && entry.action === action && hasUrl && app.action) { delete app.action; changed = true; }
            if (hasUrl && PLUGIN_APP_ACTION.test(String(app.action || '')) && app.url && normalizeUrl(app.url) === normalizeUrl(entry.url || '')) { delete app.url; changed = true; }
        }
        if (changed) {
            if (icon && app.originalIcon === icon) app.originalIcon = '';
            app.protected = false;
        }
    }
    if (changed) identityRepairs += 1;
    return changed ? app : raw;
}

function normalizeAppArray(value, fallbackArray = [], catalog = null) {
    if (!Array.isArray(value)) return deepClone(fallbackArray);
    const defaults = Array.isArray(fallbackArray) ? fallbackArray : [];
    return value.map((item) => {
        const raw = catalog ? repairAppIdentity(item, catalog) : item;
        // Missing fields are filled from the default entry with the same identity,
        // never from whatever default happens to share the array index.
        const key = typeof raw?.nameKey === 'string' ? raw.nameKey : '';
        const fallback = key ? defaults.find((entry) => entry?.nameKey === key && sameBuiltInName(raw, entry)) : null;
        return normalizeApp(raw, fallback || {});
    }).filter(Boolean);
}

function normalizeDockFolder(raw, fallback = {}) {
    const app = normalizeApp(raw, fallback);
    if (!app?.url) return null;
    app.icon = 'assets/images/Folder.png';
    app.isSystem = false;
    app.protected = false;
    app.useBg = false;
    return app;
}

function normalizeDockFolders(value, fallbackArray = []) {
    if (!Array.isArray(value)) return deepClone(fallbackArray);
    return value.map((raw) => normalizeDockFolder(raw, {})).filter(Boolean).slice(0, 24);
}

function normalizeTrashItems(value, catalog = null) {
    if (!Array.isArray(value)) return [];
    const allowedSources = new Set(['desk', 'dock', 'lp', 'launchpad', 'folder', 'sl', 'spotlight']);
    return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const app = normalizeApp(catalog ? repairAppIdentity(item.app, catalog) : item.app, {});
        if (!app) return null;
        return {
            id: stringOr(item.id, `trash-${Date.now()}-${Math.random().toString(36).slice(2,8)}`).slice(0, 160),
            source: allowedSources.has(item.source) ? item.source : 'desk',
            originalIndex: Number.isInteger(Number(item.originalIndex)) ? Number(item.originalIndex) : -1,
            deletedAt: Number.isFinite(Number(item.deletedAt)) ? Number(item.deletedAt) : Date.now(),
            app
        };
    }).filter(Boolean).slice(0, 200);
}


export function normalizeConfig(raw, defaults = FALLBACK_CONFIG, { repair = false } = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const base = deepClone(defaults);
    const catalog = repair ? builtInCatalog(base) : null;

    const config = {
        language: (typeof source.language === 'string' && LANGUAGE_CODE.test(source.language)) ? source.language : base.language,
        themeMode: THEMES.has(source.themeMode) ? source.themeMode : base.themeMode,
        accentColor: ACCENT_OPTIONS.has(source.accentColor) ? source.accentColor : (ACCENT_OPTIONS.has(base.accentColor) ? base.accentColor : 'multicolor'),
        useBingWallpaper: booleanOr(source.useBingWallpaper, base.useBingWallpaper),
        wallpaperLight: normalizeWallpaper(source.wallpaperLight, base.wallpaperLight),
        wallpaperDark: normalizeWallpaper(source.wallpaperDark, base.wallpaperDark),
        // Which pictures from the user's wallpaper library the two wallpapers came from (for the selection ring).
        wallpaperPhotoIds: {
            light: stringOr(source.wallpaperPhotoIds?.light, '').slice(0, 80),
            dark: stringOr(source.wallpaperPhotoIds?.dark, '').slice(0, 80)
        },
        // Live wallpaper: a video from the wallpaper library looping behind the desktop.
        liveWallpaper: {
            enabled: Boolean(source.liveWallpaper?.enabled && source.liveWallpaper?.id),
            id: stringOr(source.liveWallpaper?.id, '').slice(0, 80),
            rate: clamp(Number(source.liveWallpaper?.rate) || 1, 0.25, 2),
            volume: clamp(Number(source.liveWallpaper?.volume) || 0, 0, 1),
            paused: Boolean(source.liveWallpaper?.paused)
        },
        searchEngine: Object.hasOwn(ENGINES, source.searchEngine) ? source.searchEngine : base.searchEngine,
        openLinksInNewTab: booleanOr(source.openLinksInNewTab, Boolean(base.openLinksInNewTab)),
        showSpotlightOnStart: booleanOr(source.showSpotlightOnStart, base.showSpotlightOnStart),
        spotlightFocusOnOpen: booleanOr(source.spotlightFocusOnOpen, Boolean(base.spotlightFocusOnOpen)),
        developer: {
            enabled: booleanOr(source.developer?.enabled, Boolean(base.developer?.enabled)),
            timeScale: clamp(Number(source.developer?.timeScale ?? base.developer?.timeScale ?? 1) || 1, 0.5, 3600),
            baseRealMs: Number.isFinite(Number(source.developer?.baseRealMs)) ? Number(source.developer.baseRealMs) : (Number(base.developer?.baseRealMs) || 0),
            baseVirtualMs: Number.isFinite(Number(source.developer?.baseVirtualMs)) ? Number(source.developer.baseVirtualMs) : (Number(base.developer?.baseVirtualMs) || 0),
            secondsBase: booleanOr(source.developer?.secondsBase, Boolean(base.developer?.secondsBase)),
            disableExtraFeatures: booleanOr(source.developer?.disableExtraFeatures, Boolean(base.developer?.disableExtraFeatures)),
            selectableUIText: booleanOr(source.developer?.selectableUIText, Boolean(base.developer?.selectableUIText)),
            disableStrictPluginSecurity: booleanOr(source.developer?.disableStrictPluginSecurity, Boolean(base.developer?.disableStrictPluginSecurity)),
            allowSystemIconEditing: booleanOr(source.developer?.allowSystemIconEditing, Boolean(base.developer?.allowSystemIconEditing)),
            multiInstance: booleanOr(source.developer?.multiInstance, Boolean(base.developer?.multiInstance)),
            unrestrictedApps: booleanOr(source.developer?.unrestrictedApps, false),
            devTools: booleanOr(source.developer?.devTools, Boolean(base.developer?.devTools)),
            forceRTL: booleanOr(source.developer?.forceRTL, false),
            slowMotion: [1, 2, 4, 10].includes(Number(source.developer?.slowMotion)) ? Number(source.developer.slowMotion) : 1,
            instanceLimit: clamp(Math.floor(Number(source.developer?.instanceLimit ?? base.developer?.instanceLimit ?? 4) || 4), 2, 8),
            launchpadRows: clamp(Math.floor(Number(source.developer?.launchpadRows ?? base.developer?.launchpadRows ?? 0) || 0), 0, 8),
            launchpadCols: clamp(Math.floor(Number(source.developer?.launchpadCols ?? base.developer?.launchpadCols ?? 0) || 0), 0, 10),
            incognitoMode: false
        },
        // Display options (System Settings ▸ Accessibility). They used to be Developer
        // switches that only applied in Developer Mode; a configuration from then keeps
        // what it effectively had.
        accessibility: {
            ...Object.fromEntries(['disableAnimations', 'reduceTransparency', 'increaseContrast', 'transparentGlass'].map((key) => [key,
                source.accessibility && typeof source.accessibility === 'object' ? source.accessibility[key] === true : Boolean(source.developer?.enabled && source.developer?.[key])])),
            // How subtitles of videos played by applications look.
            subtitles: {
                size: ['small', 'medium', 'large', 'xlarge'].includes(source.accessibility?.subtitles?.size) ? source.accessibility.subtitles.size : 'medium',
                background: ['none', 'translucent', 'opaque'].includes(source.accessibility?.subtitles?.background) ? source.accessibility.subtitles.background : 'translucent',
                // 'custom': where the user dragged them to, as a percentage of the picture (x, y of their centre).
                position: ['top', 'custom'].includes(source.accessibility?.subtitles?.position) ? source.accessibility.subtitles.position : 'bottom',
                x: clamp(Number(source.accessibility?.subtitles?.x ?? 50) || 50, 5, 95),
                y: clamp(Number(source.accessibility?.subtitles?.y ?? 80) || 80, 5, 95)
            }
        },
        // Windows: dragging one to a screen edge tiles it (left / right half, top = fill).
        windows: { tiling: booleanOr(source.windows?.tiling, base.windows?.tiling !== false), escapeCloses: booleanOr(source.windows?.escapeCloses, base.windows?.escapeCloses !== false) },
        // Notifications: with Do Not Disturb on, banners are not shown; everything still goes to Notification Center.
        notifications: { doNotDisturb: booleanOr(source.notifications?.doNotDisturb, false) },
        // What Spotlight looks through besides the web.
        spotlight: { apps: booleanOr(source.spotlight?.apps, true), appContent: booleanOr(source.spotlight?.appContent, true) },
        desktop: {
            snapToGrid: booleanOr(source.desktop?.snapToGrid, base.desktop?.snapToGrid !== false),
            sortMode: ['manual','added','accessed','name','nameDesc'].includes(source.desktop?.sortMode) ? source.desktop.sortMode : (base.desktop?.sortMode || 'manual')
        },
        dock: {
            size: clamp(Number(source.dock?.size ?? base.dock?.size ?? 56) || 56, 30, 90),
            magnification: clamp(Number(
                source.dock?.magnification ??
                (source.dock?.magnify === false ? 0 : undefined) ??
                base.dock?.magnification ?? 45
            ) || 0, 0, 100),
            iconBg: booleanOr(source.dock?.iconBg, base.dock?.iconBg !== false),
            lightBgInDark: booleanOr(source.dock?.lightBgInDark, base.dock?.lightBgInDark !== false),
            showIndicators: booleanOr(source.dock?.showIndicators, base.dock?.showIndicators !== false)
        },
        shortcuts: {
            spotlightModifier: MODIFIERS.has(source.shortcuts?.spotlightModifier) ? source.shortcuts.spotlightModifier : (base.shortcuts?.spotlightModifier || 'Meta'),
            spotlightKey: stringOr(source.shortcuts?.spotlightKey, base.shortcuts?.spotlightKey || 'Space').slice(0, 10) || 'Space'
        },
        aboutMac: {
            osName: stringOr(source.aboutMac?.osName, base.aboutMac?.osName || 'macOS NewTab').slice(0, 120),
            osVersion: stringOr(source.aboutMac?.osVersion, base.aboutMac?.osVersion || '').slice(0, 80),
            model: stringOr(source.aboutMac?.model, base.aboutMac?.model || '').slice(0, 160),
            chip: stringOr(source.aboutMac?.chip, base.aboutMac?.chip || '').slice(0, 120),
            memory: stringOr(source.aboutMac?.memory, base.aboutMac?.memory || '').slice(0, 80),
            disk: stringOr(source.aboutMac?.disk, base.aboutMac?.disk || '').slice(0, 120)
        },
        desktopApps: normalizeAppArray(source.desktopApps, base.desktopApps || [], catalog),
        dockApps: normalizeAppArray(source.dockApps, base.dockApps || [], catalog),
        dockFolders: normalizeDockFolders(source.dockFolders, base.dockFolders || []),
        trashItems: normalizeTrashItems(source.trashItems ?? base.trashItems ?? [], catalog),
        quickLinks: normalizeAppArray(source.quickLinks, base.quickLinks || [], catalog),
        launchpadApps: normalizeAppArray(source.launchpadApps, base.launchpadApps || [], catalog),
        // Web pages pinned to the Finder sidebar.
        finderFavorites: (Array.isArray(source.finderFavorites) ? source.finderFavorites : []).map((item) => {
            const url = normalizeUrl(typeof item?.url === 'string' ? item.url : '');
            const name = stringOr(item?.name, '').trim().slice(0, 80);
            return url && name ? { name, url } : null;
        }).filter(Boolean).slice(0, 40),
        widgets: normalizeWidgets(source.widgets, base.widgets || {}),
        plugins: normalizePlugins(source.plugins, base.plugins || {})
    };

    return config;
}
