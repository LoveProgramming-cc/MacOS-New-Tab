// Normalising the widgets part of a configuration.

import { clamp, deepClone, safeDataImage } from './utils.js';
import { booleanOr, stringOr } from './config-normalize.js';

// 'app' is a widget an installed application offers (see the widgets section of plugin-system.js).
const WIDGET_TYPES = new Set(['clock', 'photo', 'battery', 'weather', 'screenTime', 'calendar', 'app']);
const WIDGET_SIZES = new Set(['small', 'medium', 'large']);
const WIDGET_VARIANTS = {
    clock: new Set(['digital', 'analog', 'world']),
    photo: new Set(['photo']),
    battery: new Set(['status']),
    weather: new Set(['current', 'forecast', 'detailed']),
    screenTime: new Set(['summary', 'detailed']),
    calendar: new Set(['month', 'upNext'])
};

const APP_WIDGET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;
/** The widgets an application's manifest declares: [{ id, title, titleKey, sizes }]. Needs the widgets permission. */
export function normalizeApplicationWidgets(value, permissions = []) {
    if (!Array.isArray(value) || !permissions.includes('widgets')) return [];
    const seen = new Set();
    return value.slice(0, 8).map((item) => {
        const id = stringOr(item?.id, '').trim();
        if (!APP_WIDGET_ID.test(id) || seen.has(id)) return null;
        seen.add(id);
        const sizes = [...new Set((Array.isArray(item.sizes) ? item.sizes : []).filter((size) => WIDGET_SIZES.has(size)))];
        return { id, title: stringOr(item.title, '').trim().slice(0, 60), titleKey: stringOr(item.titleKey, '').slice(0, 120), sizes: sizes.length ? sizes : ['small'] };
    }).filter(Boolean);
}
// The size of the desktop a widget was placed on (vw × vh), so it can keep its distance from
// the nearest edges on a desktop of another size.
function keepPlacementViewport(out, source) {
    const vw = Number(source.vw); const vh = Number(source.vh);
    if (Number.isFinite(vw) && Number.isFinite(vh) && vw >= 200 && vh >= 200) { out.vw = Math.round(Math.min(vw, 20000)); out.vh = Math.round(Math.min(vh, 20000)); }
}
function normalizeWidgetInstance(raw, fallback = null) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : (fallback || {});
    const type = WIDGET_TYPES.has(source.type) ? source.type : fallback?.type;
    if (!type) return null;
    if (type === 'app') {
        // appId + variant name the application and which of its widgets this is.
        const appId = stringOr(source.appId, '').trim();
        const widgetId = stringOr(source.variant, '').trim();
        if (!/^[a-z0-9._-]{1,80}$/i.test(appId) || !APP_WIDGET_ID.test(widgetId)) return null;
        const placed = { id: stringOr(source.id, `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 120), type, appId, variant: widgetId, size: WIDGET_SIZES.has(source.size) ? source.size : 'small' };
        if (Number.isFinite(Number(source.cx))) placed.cx = clamp(Number(source.cx), -10000, 10000);
        if (Number.isFinite(Number(source.cy))) placed.cy = clamp(Number(source.cy), -10000, 10000);
        keepPlacementViewport(placed, source);
        return placed;
    }
    const variants = WIDGET_VARIANTS[type] || new Set();
    const variant = variants.has(source.variant) ? source.variant : (variants.has(fallback?.variant) ? fallback.variant : [...variants][0]);
    let size = WIDGET_SIZES.has(source.size) ? source.size : (WIDGET_SIZES.has(fallback?.size) ? fallback.size : 'small');
    if (type === 'calendar') size = size === 'medium' ? 'medium' : 'small';
    const id = stringOr(source.id, fallback?.id || `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 120);
    const normalizedVariant = type === 'calendar' ? (size === 'medium' ? 'upNext' : 'month') : variant;
    const out = { id, type, variant: normalizedVariant, size };
    if (Number.isFinite(Number(source.cx))) out.cx = clamp(Number(source.cx), -10000, 10000);
    if (Number.isFinite(Number(source.cy))) out.cy = clamp(Number(source.cy), -10000, 10000);
    keepPlacementViewport(out, source);
    if (type === 'photo') {
        out.photoSourceId = stringOr(source.photoSourceId, stringOr(fallback?.photoSourceId, `photo-source-${id}`)).slice(0, 160) || `photo-source-${id}`;
    }
    if (type === 'weather') {
        out.weatherLocationId = stringOr(source.weatherLocationId, stringOr(fallback?.weatherLocationId, '')).slice(0, 160);
    }
    return out;
}

function normalizeWidgetArray(value, fallback = []) {
    if (!Array.isArray(value)) return deepClone(fallback);
    return value.map((item) => normalizeWidgetInstance(item)).filter(Boolean).slice(0, 80);
}

function normalizeLimits(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const host = stringOr(item.host, '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        const minutes = clamp(Number(item.minutes) || 0, 1 / 60, 1440);
        if (!host || !/^[a-z0-9.-]+$/.test(host) || seen.has(host)) return null;
        seen.add(host);
        return { host, minutes };
    }).filter(Boolean);
}

function weatherLocationId(label, latitude, longitude) {
    const slug = String(label || 'place').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'place';
    return `weather-${slug}-${Math.round(latitude * 1000)}-${Math.round(longitude * 1000)}`;
}

function normalizeWeather(rawWeather, baseWeather) {
    const raw = rawWeather && typeof rawWeather === 'object' && !Array.isArray(rawWeather) ? rawWeather : {};
    const base = baseWeather && typeof baseWeather === 'object' ? baseWeather : {};
    let sourceLocations = Array.isArray(raw.locations) ? raw.locations : null;
    if (!sourceLocations && (raw.label !== undefined || raw.latitude !== undefined || raw.longitude !== undefined)) {
        sourceLocations = [{ label: raw.label || 'Singapore', latitude: raw.latitude ?? 1.3521, longitude: raw.longitude ?? 103.8198, timezone: 'auto' }];
    }
    if (!sourceLocations) sourceLocations = Array.isArray(base.locations) ? base.locations : [{ label: base.label || 'Singapore', latitude: base.latitude ?? 1.3521, longitude: base.longitude ?? 103.8198, timezone: 'Asia/Singapore' }];

    const seen = new Set();
    const locations = sourceLocations.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = stringOr(item.label ?? item.name, '').trim().slice(0, 100);
        const latitude = clamp(Number(item.latitude), -90, 90);
        const longitude = clamp(Number(item.longitude), -180, 180);
        if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const id = stringOr(item.id, weatherLocationId(label, latitude, longitude)).slice(0, 160) || weatherLocationId(label, latitude, longitude);
        if (seen.has(id)) return null;
        seen.add(id);
        return {
            id,
            label,
            admin1: stringOr(item.admin1, '').slice(0, 100),
            country: stringOr(item.country, '').slice(0, 100),
            latitude,
            longitude,
            timezone: stringOr(item.timezone, 'auto').slice(0, 100) || 'auto'
        };
    }).filter(Boolean).slice(0, 30);

    if (!locations.length) locations.push({ id: 'weather-singapore', label: 'Singapore', admin1: '', country: 'Singapore', latitude: 1.3521, longitude: 103.8198, timezone: 'Asia/Singapore' });
    const requestedDefault = stringOr(raw.defaultLocationId, stringOr(base.defaultLocationId, ''));
    const defaultLocationId = locations.some((loc) => loc.id === requestedDefault) ? requestedDefault : locations[0].id;
    return { locations, defaultLocationId };
}

export function normalizeWidgets(sourceWidgets, baseWidgets) {
    const src = sourceWidgets && typeof sourceWidgets === 'object' && !Array.isArray(sourceWidgets) ? sourceWidgets : {};
    const base = baseWidgets && typeof baseWidgets === 'object' ? baseWidgets : {};
    const weather = normalizeWeather(src.weather, base.weather);
    const center = normalizeWidgetArray(src.center, base.center || []);
    const desktop = normalizeWidgetArray(src.desktop, base.desktop || []);
    [...center, ...desktop].filter((widget) => widget.type === 'weather').forEach((widget) => {
        if (!weather.locations.some((loc) => loc.id === widget.weatherLocationId)) widget.weatherLocationId = weather.defaultLocationId;
    });
    return {
        center,
        desktop,
        weather,
        photos: {
            mode: ['single', 'cycle'].includes(src.photos?.mode) ? src.photos.mode : (base.photos?.mode === 'single' ? 'single' : 'cycle'),
            intervalSeconds: clamp(Number(src.photos?.intervalSeconds ?? base.photos?.intervalSeconds ?? 30) || 30, 1, 3600),
            selectedIndex: Math.max(0, Math.floor(Number(src.photos?.selectedIndex ?? base.photos?.selectedIndex ?? 0) || 0))
        },
        screenTime: {
            enabled: booleanOr(src.screenTime?.enabled, base.screenTime?.enabled !== false),
            limits: normalizeLimits(src.screenTime?.limits ?? base.screenTime?.limits ?? []),
            overlayMessage: stringOr(src.screenTime?.overlayMessage, stringOr(base.screenTime?.overlayMessage, '')).slice(0, 160),
            overlayImage: safeDataImage(src.screenTime?.overlayImage) ? src.screenTime.overlayImage : (safeDataImage(base.screenTime?.overlayImage) ? base.screenTime.overlayImage : ''),
            overlayImageMaxWidth: clamp(Number(src.screenTime?.overlayImageMaxWidth ?? base.screenTime?.overlayImageMaxWidth ?? 320) || 320, 80, 900),
            overlayImageMaxHeight: clamp(Number(src.screenTime?.overlayImageMaxHeight ?? base.screenTime?.overlayImageMaxHeight ?? 220) || 220, 60, 700),
            overlayTextFontSize: clamp(Number(src.screenTime?.overlayTextFontSize ?? base.screenTime?.overlayTextFontSize ?? 20) || 20, 10, 64),
            overlayTextColor: /^#[0-9a-f]{6}$/i.test(stringOr(src.screenTime?.overlayTextColor, '')) ? src.screenTime.overlayTextColor : (stringOr(base.screenTime?.overlayTextColor, '#1d1d1f') || '#1d1d1f'),
            overlayFontName: stringOr(src.screenTime?.overlayFontName, stringOr(base.screenTime?.overlayFontName, '')).slice(0, 80),
            overlayFontData: typeof src.screenTime?.overlayFontData === 'string' && /^data:font\/|^data:application\/(?:font|x-font)/i.test(src.screenTime.overlayFontData) ? src.screenTime.overlayFontData : (typeof base.screenTime?.overlayFontData === 'string' ? base.screenTime.overlayFontData : '')
        }
    };
}
