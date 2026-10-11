import { state } from './state.js';
import { WIDGET_MEDIA_KEY } from './constants.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { layoutDesktopWidgets, setWidgetPosition, reflowDesktopAppsAroundWidgets, widgetPixels, resolveWidgetGridPosition, widgetGridPositionFromPoint, reflowDesktopWidgetsToGrid } from './desktop-layout.js';
import { renderDesktopIcons } from './render.js';
import { scheduleBootVisualCache } from './boot-cache.js';
import { virtualNow } from './time.js';
import { extraFeaturesDisabled } from './developer.js';
import { applicationWidgetTitle, mountApplicationWidget } from './plugin-system.js';
import { renderClockContent, updateClockWidgets } from './widget-clocks.js';
import { renderCalendarContent } from './widget-calendar.js';
import { clearPhotoTimers, defaultPhotoSource, ensurePhotoSources, flushPhotoState, getMedia, getPhotoState, mediaCache, populatePhoto, queuePhotoStateSave, restartPhotoSchedulers, triggerPhotoEvent } from './widget-photos.js';
import { populateBattery, populateScreenTime, populateWeather, renderBatteryLevel, renderScreenTimeSummary, renderWeatherData, weatherLocationFor, weatherLocations } from './widget-content.js';
import { bindCenterReordering, bindGalleryDrag, closeWidgetGallery, openWidgetGallery, renderGalleryCategory, renderWidgetGallery } from './widget-gallery.js';
import { bindWidgetSettings, renderScreenTimeManager, renderWidgetSettings } from './widget-settings.js';
import { bindWidgetManagement, hideWidgetContextMenu, widgetLocationOf } from './widget-menu.js';

export * from './widget-photos.js';
export * from './widget-content.js';
export * from './widget-gallery.js';
export * from './widget-settings.js';
export * from './widget-menu.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const WIDGET_LIBRARY = [
    { type: 'clock', variant: 'digital', size: 'small', category: 'clock', titleKey: 'widgetClockDigital' },
    { type: 'clock', variant: 'analog', size: 'small', category: 'clock', titleKey: 'widgetClockAnalog' },
    { type: 'clock', variant: 'world', size: 'medium', category: 'clock', titleKey: 'widgetWorldClock' },
    { type: 'calendar', variant: 'month', size: 'small', category: 'calendar', titleKey: 'widgetCalendarMonth' },
    { type: 'calendar', variant: 'upNext', size: 'medium', category: 'calendar', titleKey: 'widgetCalendarUpNext' },
    { type: 'photo', variant: 'photo', size: 'small', category: 'photo', titleKey: 'widgetPhotosSmall' },
    { type: 'photo', variant: 'photo', size: 'medium', category: 'photo', titleKey: 'widgetPhotosMedium' },
    { type: 'photo', variant: 'photo', size: 'large', category: 'photo', titleKey: 'widgetPhotosLarge' },
    { type: 'battery', variant: 'status', size: 'small', category: 'battery', titleKey: 'widgetBattery' },
    { type: 'battery', variant: 'status', size: 'medium', category: 'battery', titleKey: 'widgetBattery' },
    { type: 'weather', variant: 'current', size: 'small', category: 'weather', titleKey: 'widgetWeatherCurrent' },
    { type: 'weather', variant: 'forecast', size: 'medium', category: 'weather', titleKey: 'widgetWeatherForecast' },
    { type: 'weather', variant: 'detailed', size: 'large', category: 'weather', titleKey: 'widgetWeatherDetailed' },
    { type: 'screenTime', variant: 'summary', size: 'small', category: 'screenTime', titleKey: 'widgetScreenTime' },
    { type: 'screenTime', variant: 'summary', size: 'medium', category: 'screenTime', titleKey: 'widgetScreenTime' },
    { type: 'screenTime', variant: 'detailed', size: 'large', category: 'screenTime', titleKey: 'widgetScreenTimeDetailed' }
];

export const weatherCache = new Map();
export const weatherInflight = new Map();
export const photoTimers = new Map();
export const photoTriggerStamp = new Map();
let widgetClockTimer = null;
let screenTimeRefreshTimer = null;
let desktopPlacementGhost = null;
let widgetConfigSaveTimer = null;
let widgetMediaSaveTimer = null;
export const photoPreloadCache = new Map();
let widgetMaintenanceTimer = null;
const pendingWidgetContent = new Set();
export const photoAdvanceInflight = new Set();
let widgetEventsBound = false;
export const WEATHER_PERSIST_KEY = 'macOS_weather_cache_v51';
export const SCREEN_TIME_BOOT_CACHE_KEY = 'macOS_screen_time_summary_cache_v51';

export function widgetsRuntimeDisabled() {
    return extraFeaturesDisabled(state.config);
}

function queueWidgetConfigSave(delay = 90) {
    clearTimeout(widgetConfigSaveTimer);
    widgetConfigSaveTimer = setTimeout(() => saveConfig().catch(() => {}), delay);
}
function queueWidgetMediaSave(delay = 130) {
    clearTimeout(widgetMediaSaveTimer);
    widgetMediaSaveTimer = setTimeout(() => {
        if (mediaCache && !state.incognitoConfigMode) storageSet(WIDGET_MEDIA_KEY, mediaCache).catch?.(() => {});
    }, delay);
}
function queueWidgetMaintenance({ photos = false } = {}) {
    clearTimeout(widgetMaintenanceTimer);
    const run = () => {
        try { renderWidgetSettings(); } catch {}
        try { renderDesktopIcons(); } catch {}
        if (photos) restartPhotoSchedulers().catch(() => {});
        scheduleBootVisualCache(500);
    };
    widgetMaintenanceTimer = setTimeout(() => {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 700 });
        else run();
    }, 60);
}

function uniqueWidgetId(prefix = 'widget') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trackWidgetContent(task) {
    const promise = Promise.resolve(task).catch((error) => console.debug('widget content update failed', error));
    pendingWidgetContent.add(promise);
    promise.finally(() => pendingWidgetContent.delete(promise));
    return promise;
}

export async function waitForWidgetContent(timeoutMs = 4000) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (pendingWidgetContent.size && Date.now() < deadline) {
        const snapshot = [...pendingWidgetContent];
        await Promise.race([
            Promise.allSettled(snapshot),
            new Promise((resolve) => setTimeout(resolve, Math.min(120, Math.max(1, deadline - Date.now()))))
        ]);
    }
}

export function storageGet(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (data) => resolve(data[key])));
}
export function storageSet(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}
export function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

export function allPlacedWidgets() {
    return [...(state.config.widgets?.center || []), ...(state.config.widgets?.desktop || [])];
}
export function allPhotoWidgets() {
    return allPlacedWidgets().filter((widget) => widget.type === 'photo');
}
export function findPlacedWidget(id) {
    return allPlacedWidgets().find((widget) => widget.id === id) || null;
}
export function widgetTitle(widget) {
    if (widget.type === 'app') return applicationWidgetTitle(widget.appId, widget.variant) || t('appWidgetMissing', '应用程序已移除');
    if (widget.type === 'clock') return t('widgetClock', '时钟');
    if (widget.type === 'photo') return t('widgetPhotos', '照片');
    if (widget.type === 'calendar') return t('widgetCalendar', '日历');
    if (widget.type === 'battery') return t('widgetBattery', '电源');
    if (widget.type === 'weather') return t('widgetWeather', '天气');
    return t('widgetScreenTime', '屏幕使用时间');
}

// Sample content for the widget gallery. Gallery cards never run the live data path
// (network, battery, usage queries); they show fixed, representative values instead of
// an empty card, so every widget looks like itself while you choose.
function sampleWeather() {
    const today = new Date();
    const day = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    return { current: { temperature_2m: 23, weather_code: 1 },
        daily: { time: [0, 1, 2, 3, 4].map(day), weather_code: [1, 2, 61, 3, 0], temperature_2m_max: [26, 25, 21, 22, 27], temperature_2m_min: [17, 16, 15, 14, 18] } };
}
function sampleScreenTime() {
    const hours = {};
    const pattern = { '08': 900, '09': 2100, '10': 2700, '11': 1500, '13': 1800, '14': 2400, '15': 3000, '16': 1200, '19': 2000, '20': 2600, '21': 1400 };
    for (const [hour, seconds] of Object.entries(pattern)) hours[hour] = { 'github.com': seconds * 0.45, 'youtube.com': seconds * 0.3, 'x.com': seconds * 0.15, 'wikipedia.org': seconds * 0.1 };
    const total = Object.values(pattern).reduce((sum, value) => sum + value, 0);
    return { total, hours, history: [], sites: [{ host: 'github.com', seconds: total * 0.45 }, { host: 'youtube.com', seconds: total * 0.3 }, { host: 'x.com', seconds: total * 0.15 }, { host: 'wikipedia.org', seconds: total * 0.1 }] };
}
function previewWallpaper() {
    const dark = state.effectiveTheme === 'dark' || document.body.classList.contains('dark-mode');
    return state.currentWallpaper || (dark ? state.config.wallpaperDark : state.config.wallpaperLight) || 'assets/images/sequoia.shape.day.jpg';
}

export function createWidgetCard(widget, { location = 'center', preview = false } = {}) {
    const card = createElement('div', {
        className: `widget-card mac-widget-glass widget-${widget.type} widget-size-${widget.size}${preview ? ' widget-preview' : ''}`,
        dataset: { widgetId: widget.id || '', widgetType: widget.type, widgetVariant: widget.variant, widgetSize: widget.size, widgetLocation: location }
    });
    if (!preview && state.widgetEditMode) {
        card.appendChild(createElement('button', { className: 'widget-remove', text: '−', attrs: { type: 'button', title: t('removeWidget', '移除小组件') } }));
    }
    if (widget.type === 'clock') renderClockContent(card, widget);
    const startContent = (factory) => {
        if (preview || widgetsRuntimeDisabled()) return;
        // Register the promise synchronously so boot waits for the real first widget
        // content instead of retiring the cached snapshot before setTimeout fires.
        trackWidgetContent(Promise.resolve().then(factory));
    };
    if (widget.type === 'photo') {
        const frame = createElement('div', { className: 'photo-widget-frame' });
        card.appendChild(frame);
        // The gallery shows the current desktop picture as the sample photo.
        if (preview) frame.appendChild(createElement('img', { className: 'photo-current', attrs: { src: previewWallpaper(), alt: '', draggable: 'false' } }));
        else startContent(() => populatePhoto(card, widget, { animate: false }));
    }
    if (widget.type === 'battery') {
        card.appendChild(createElement('div', { className: 'battery-widget-content' }));
        if (preview) renderBatteryLevel(card, card.querySelector('.battery-widget-content'), 82);
        else startContent(() => populateBattery(card));
    }
    if (widget.type === 'weather') {
        const content = createElement('div', { className: 'weather-widget-content' });
        card.appendChild(content);
        if (preview) renderWeatherData(content, widget, weatherLocationFor(widget) || { label: t('widgetWeatherSampleCity', '库比蒂诺') }, sampleWeather());
        else startContent(() => populateWeather(card, widget));
    }
    if (widget.type === 'calendar') renderCalendarContent(card, widget);
    // An application's widget: drawn by the host from what the application last published.
    if (widget.type === 'app') { const drawn = mountApplicationWidget(card, widget, { preview }); if (!preview && !widgetsRuntimeDisabled()) trackWidgetContent(drawn); }
    if (widget.type === 'screenTime') {
        const content = createElement('div', { className: 'screen-time-content' });
        card.appendChild(content);
        if (preview) renderScreenTimeSummary(content, widget, sampleScreenTime());
        else startContent(() => populateScreenTime(card, widget));
    }
    if (preview) card.appendChild(createElement('div', { className: 'widget-preview-title', text: widgetTitle(widget) }));
    return card;
}

function updateWidgetCenterDate() {
    const now = virtualNow();
    const dateEl = $('widget-center-date');
    const weekdayEl = $('widget-center-weekday');
    if (dateEl) dateEl.textContent = now.toLocaleDateString(state.config.language, { month: 'long', day: 'numeric' });
    if (weekdayEl) weekdayEl.textContent = now.toLocaleDateString(state.config.language, { weekday: 'long' });
}

export function renderWidgetCenter() {
    updateWidgetCenterDate();
    const list = $('widget-center-list');
    if (!list) return;
    if (widgetsRuntimeDisabled()) { list.replaceChildren(); list.classList.add('empty'); return; }
    list.replaceChildren();
    const widgets = state.config.widgets?.center || [];
    widgets.forEach((widget) => {
        const card = createWidgetCard(widget, { location: 'center' });
        card.draggable = true;
        list.appendChild(card);
    });
    list.classList.toggle('widget-editing', Boolean(state.widgetEditMode));
    list.classList.toggle('empty', widgets.length === 0);
    const empty = $('widget-center-empty');
    if (empty) empty.classList.toggle('hidden', widgets.length > 0);
}

export function clearDesktopPlacementGhost() {
    desktopPlacementGhost?.remove();
    desktopPlacementGhost = null;
    $('widget-center-list')?.classList.remove('widget-drop-target');
}

export function showDesktopPlacementGhost(widget, pos) {
    if (!desktopPlacementGhost || !desktopPlacementGhost.isConnected) {
        desktopPlacementGhost = createElement('div', { className: `widget-placement-ghost widget-size-${widget.size}` });
        $('desktop-widget-layer')?.appendChild(desktopPlacementGhost);
    }
    desktopPlacementGhost.className = `widget-placement-ghost widget-size-${widget.size}`;
    desktopPlacementGhost.style.width = `${pos.width}px`;
    desktopPlacementGhost.style.height = `${pos.height}px`;
    desktopPlacementGhost.style.left = `${pos.left}px`;
    desktopPlacementGhost.style.top = `${pos.top}px`;
}

function pointInsideWidgetCenter(clientX, clientY) {
    const center = $('widget-center');
    const list = $('widget-center-list');
    if (!center || !list || center.classList.contains('hidden')) return false;
    const rect = list.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function syncWidgetCenterChrome() {
    const list = $('widget-center-list');
    if (!list) return;
    const count = state.config.widgets?.center?.length || 0;
    list.classList.toggle('widget-editing', Boolean(state.widgetEditMode));
    list.classList.toggle('empty', count === 0);
    const empty = $('widget-center-empty');
    if (empty) empty.classList.toggle('hidden', count > 0);
}

function replaceMovedWidgetCard(widget, from, to) {
    const oldHost = from === 'desktop' ? $('desktop-widget-layer') : $('widget-center-list');
    const oldCard = oldHost?.querySelector(`.widget-card[data-widget-id="${CSS.escape(widget.id)}"]`);
    oldCard?.remove();

    if (to === 'desktop') {
        const host = $('desktop-widget-layer');
        if (!host) return;
        const size = widgetPixels(widget);
        const card = createWidgetCard(widget, { location: 'desktop' });
        card.classList.add('desktop-widget');
        card.style.width = `${size.width}px`;
        card.style.height = `${size.height}px`;
        bindDesktopWidgetPointer(card, widget);
        host.appendChild(card);
        syncDesktopWidgetPositions();
    } else {
        const host = $('widget-center-list');
        if (!host) return;
        const card = createWidgetCard(widget, { location: 'center' });
        card.draggable = true;
        host.appendChild(card);
        syncWidgetCenterOrder();
    }
    syncWidgetCenterChrome();
}

export async function moveWidgetBetweenLocations(widgetId, from, to, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
    if (from === to) return;
    const source = from === 'desktop' ? state.config.widgets.desktop : state.config.widgets.center;
    const target = to === 'desktop' ? state.config.widgets.desktop : state.config.widgets.center;
    const index = source.findIndex((widget) => widget.id === widgetId);
    if (index < 0) return;
    const [widget] = source.splice(index, 1);
    if (to === 'desktop') {
        const pos = widgetGridPositionFromPoint(widget, clientX, clientY, widget.id);
        setWidgetPosition(widget, pos);
    } else {
        delete widget.cx;
        delete widget.cy;
    }
    target.push(widget);
    reflowDesktopAppsAroundWidgets();
    await saveConfig();

    // Relocating one widget must not rebuild every card. Recreate only the moved
    // widget in its new container, then sync geometry/order around it.
    replaceMovedWidgetCard(widget, from, to);
    syncDesktopWidgetPositions();
    renderWidgetSettings();
    renderDesktopIcons();
}

function widgetGridPositionFromDraggedTopLeft(widget, left, top, ignoreId = widget?.id || '') {
    const cx = left - window.innerWidth / 2;
    const cy = top - window.innerHeight / 2;
    return resolveWidgetGridPosition(widget, cx, cy, ignoreId);
}

function bindDesktopWidgetPointer(card, widget) {
    const widgetId = widget?.id || card?.dataset?.widgetId || '';
    card.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || event.target.closest('button,input,select,label,.widget-context-menu,.widget-quick-editor')) return;
        const liveWidget = findPlacedWidget(widgetId);
        if (!liveWidget || widgetLocationOf(widgetId) !== 'desktop') return;
        const selectableText = Boolean(state.config.developer?.enabled && state.config.developer?.selectableUIText);
        if (!selectableText) event.preventDefault();
        hideWidgetContextMenu();
        const rect = card.getBoundingClientRect();
        const startX = event.clientX, startY = event.clientY;
        const offsetX = event.clientX - rect.left, offsetY = event.clientY - rect.top;
        let moved = false;
        let latestPos = resolveWidgetGridPosition(liveWidget, liveWidget.cx, liveWidget.cy, widgetId);
        card.classList.add('desktop-widget-dragging');
        const onMove = (ev) => {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true;
            if (!moved) return;
            if (selectableText) { window.getSelection?.()?.removeAllRanges?.(); ev.preventDefault(); }
            const dragLeft = ev.clientX - offsetX;
            const dragTop = ev.clientY - offsetY;
            card.style.transform = `translate3d(${dragLeft - rect.left}px, ${dragTop - rect.top}px, 0)`;
            if (pointInsideWidgetCenter(ev.clientX, ev.clientY)) {
                desktopPlacementGhost?.classList.add('hidden');
                $('widget-center-list')?.classList.add('widget-drop-target');
            } else {
                $('widget-center-list')?.classList.remove('widget-drop-target');
                latestPos = widgetGridPositionFromDraggedTopLeft(liveWidget, ev.clientX - offsetX, ev.clientY - offsetY, widgetId);
                showDesktopPlacementGhost(liveWidget, latestPos);
                desktopPlacementGhost?.classList.remove('hidden');
            }
        };
        const onUp = async (ev) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            card.classList.remove('desktop-widget-dragging');
            card.style.transform = '';
            // The click that ends a drag is not a click on the widget.
            if (moved) { card.dataset.justDragged = '1'; setTimeout(() => { delete card.dataset.justDragged; }, 80); }
            if (!moved) {
                clearDesktopPlacementGhost();
                syncDesktopWidgetPositions();
                return;
            }
            if (pointInsideWidgetCenter(ev.clientX, ev.clientY)) {
                clearDesktopPlacementGhost();
                await moveWidgetBetweenLocations(widgetId, 'desktop', 'center', ev.clientX, ev.clientY);
                return;
            }
            // saveConfig() normalizes/replaces state.config, so always mutate the live
            // state object captured for this gesture, never the stale render-time object.
            setWidgetPosition(liveWidget, latestPos);
            clearDesktopPlacementGhost();
            reflowDesktopAppsAroundWidgets();
            await saveConfig();
            syncDesktopWidgetPositions();
            renderDesktopIcons();
            renderWidgetSettings();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// A widget the window has no room for is laid out beyond its edge: no glass there (glass
// must not sample outside the page; see "Glass stays on the screen" in 10-features.css).
function markOffscreen(card, rect) {
    const out = Boolean(rect) && (rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight);
    card.classList.toggle('widget-offscreen', out);
}
export function syncDesktopWidgetPositions() {
    const layer = $('desktop-widget-layer');
    if (!layer) return;
    const layout = layoutDesktopWidgets();
    (state.config.widgets?.desktop || []).forEach((widget) => {
        const card = layer.querySelector(`.widget-card[data-widget-id="${CSS.escape(widget.id)}"]`);
        if (!card) return;
        const size = widgetPixels(widget);
        card.style.width = `${size.width}px`;
        card.style.height = `${size.height}px`;
        const rect = layout.get(widget.id);
        card.style.left = `${rect ? rect.left : window.innerWidth / 2 + widget.cx}px`;
        card.style.top = `${rect ? rect.top : window.innerHeight / 2 + widget.cy}px`;
        markOffscreen(card, rect);
    });
}

export function syncWidgetCenterOrder() {
    const list = $('widget-center-list');
    if (!list) return;
    const byId = new Map([...list.querySelectorAll('.widget-card')].map((card) => [card.dataset.widgetId, card]));
    (state.config.widgets?.center || []).forEach((widget) => {
        const card = byId.get(widget.id);
        if (card) list.appendChild(card);
    });
}

export function renderDesktopWidgets({ reconcile = false } = {}) {
    const layer = $('desktop-widget-layer');
    if (!layer) return;
    layer.replaceChildren();
    if (widgetsRuntimeDisabled()) { scheduleBootVisualCache(); return; }
    if (reconcile) {
        const changed = reflowDesktopWidgetsToGrid();
        if (changed) saveConfig().catch(() => {});
    }
    const layout = layoutDesktopWidgets();
    (state.config.widgets?.desktop || []).forEach((widget) => {
        const size = widgetPixels(widget);
        const card = createWidgetCard(widget, { location: 'desktop' });
        card.classList.add('desktop-widget');
        card.style.width = `${size.width}px`;
        card.style.height = `${size.height}px`;
        const rect = layout.get(widget.id);
        card.style.left = `${rect.left}px`;
        card.style.top = `${rect.top}px`;
        markOffscreen(card, rect);
        bindDesktopWidgetPointer(card, widget);
        layer.appendChild(card);
    });
    scheduleBootVisualCache();
}

export function renderWidgets({ includeGallery = false, includeSettings = false, reconcile = false } = {}) {
    if (widgetsRuntimeDisabled()) {
        $('desktop-widget-layer')?.replaceChildren();
        $('widget-center-list')?.replaceChildren();
        closeWidgetGallery();
        return;
    }
    renderWidgetCenter();
    renderDesktopWidgets({ reconcile });
    document.body.classList.add('live-widgets-structure-ready');
    if (includeGallery) renderWidgetGallery();
    if (includeSettings) renderWidgetSettings();
}

export function hideWidgetGalleryWindows() {
    state.widgetGalleryHiddenWindows = [];
    document.querySelectorAll('.window:not(.hidden)').forEach((win) => {
        state.widgetGalleryHiddenWindows.push(win.id);
        win.classList.add('hidden');
    });
    $('launchpad')?.classList.remove('active');
    document.body.classList.remove('launchpad-open');
    ['apple-dropdown', 'engine-menu', 'global-select-dropdown'].forEach((id) => $(id)?.classList.add('hidden'));
}
export function restoreWidgetGalleryWindows() {
    (state.widgetGalleryHiddenWindows || []).forEach((id) => $(id)?.classList.remove('hidden'));
    state.widgetGalleryHiddenWindows = [];
}

function toggleWidgetCenter(force) {
    if (widgetsRuntimeDisabled()) { $('widget-center')?.classList.add('hidden'); return; }
    const center = $('widget-center');
    if (!center) return;
    if (document.body.classList.contains('widget-gallery-open') && force !== true) return;
    const open = typeof force === 'boolean' ? force : center.classList.contains('hidden');
    center.classList.toggle('hidden', !open);
    if (open) {
        $('apple-dropdown')?.classList.add('hidden');
        $('engine-menu')?.classList.add('hidden');
        $('global-select-dropdown')?.classList.add('hidden');
        renderWidgetCenter();
    } else {
        state.widgetEditMode = false;
        center.classList.remove('editing');
        renderWidgetCenter();
    }
}
export function syncWidgetEditControls() {
    document.querySelectorAll('#desktop-widget-layer .widget-card, #widget-center-list .widget-card').forEach((card) => {
        const existing = card.querySelector(':scope > .widget-remove');
        if (state.widgetEditMode && !existing) {
            card.appendChild(createElement('button', { className: 'widget-remove', text: '−', attrs: { type: 'button', title: t('removeWidget', '移除小组件') } }));
        } else if (!state.widgetEditMode) existing?.remove();
    });
}

export async function addWidget(template, location, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
    const instance = { id: uniqueWidgetId(template.type), type: template.type, variant: template.variant, size: template.size };
    if (instance.type === 'app') instance.appId = template.appId;
    if (instance.type === 'photo') instance.photoSourceId = uniqueWidgetId('photo-source');
    if (instance.type === 'weather') instance.weatherLocationId = state.config.widgets?.weather?.defaultLocationId || weatherLocations()[0]?.id || '';
    if (location === 'desktop') {
        const pos = widgetGridPositionFromPoint(instance, clientX, clientY, instance.id);
        setWidgetPosition(instance, pos);
        state.config.widgets.desktop.push(instance);
        reflowDesktopAppsAroundWidgets();
    } else {
        state.config.widgets.center.push(instance);
    }

    // Optimistic UI first. chrome.storage (especially a large photo library) must never
    // sit on the pointer-up path; persistence and media bookkeeping happen just after paint.
    const live = findPlacedWidget(instance.id) || instance;
    if (location === 'desktop') {
        const host = $('desktop-widget-layer');
        if (host) {
            const size = widgetPixels(live);
            const card = createWidgetCard(live, { location: 'desktop' });
            card.classList.add('desktop-widget');
            card.style.width = `${size.width}px`;
            card.style.height = `${size.height}px`;
            bindDesktopWidgetPointer(card, live);
            host.appendChild(card);
            syncDesktopWidgetPositions();
        }
    } else {
        const host = $('widget-center-list');
        if (host) {
            const card = createWidgetCard(live, { location: 'center' });
            card.draggable = true;
            host.appendChild(card);
            syncWidgetCenterOrder();
            syncWidgetCenterChrome();
        }
    }

    queueWidgetConfigSave();
    if (instance.type === 'photo') {
        // Do not await a potentially multi-megabyte media read during drag/drop.
        getMedia().then((media) => {
            if (!findPlacedWidget(instance.id)) return;
            media.photoSources[instance.photoSourceId] ||= defaultPhotoSource();
            queueWidgetMediaSave();
        }).catch(() => {});
    }
    queueWidgetMaintenance({ photos: instance.type === 'photo' });
    return live;
}

export async function deleteWidget(location, id) {
    const list = location === 'desktop' ? state.config.widgets.desktop : state.config.widgets.center;
    const index = list.findIndex((w) => w.id === id);
    if (index < 0) return;
    const [removed] = list.splice(index, 1);

    // Remove the card synchronously, before any storage write/large photo cleanup.
    const host = location === 'desktop' ? $('desktop-widget-layer') : $('widget-center-list');
    host?.querySelector(`.widget-card[data-widget-id="${CSS.escape(id)}"]`)?.remove();
    if (state.selectedPhotoWidgetId === id) state.selectedPhotoWidgetId = null;
    syncWidgetCenterChrome();
    reflowDesktopAppsAroundWidgets();

    queueWidgetConfigSave();
    if (removed?.type === 'photo' && removed.photoSourceId) {
        getMedia().then((media) => {
            delete media.photoSources[removed.photoSourceId];
            queueWidgetMediaSave();
        }).catch(() => {});
        getPhotoState().then((photoState) => {
            delete photoState[removed.photoSourceId];
            queuePhotoStateSave();
            photoPreloadCache.delete(removed.photoSourceId);
        }).catch(() => {});
    }
    queueWidgetMaintenance({ photos: removed?.type === 'photo' });
}

export async function syncWidgetRuntimeState() {
    clearPhotoTimers();
    if (widgetClockTimer) { clearInterval(widgetClockTimer); widgetClockTimer = null; }
    if (screenTimeRefreshTimer) { clearInterval(screenTimeRefreshTimer); screenTimeRefreshTimer = null; }

    const disabled = widgetsRuntimeDisabled();
    document.body.classList.toggle('widgets-runtime-disabled', disabled);
    if (disabled) {
        $('widget-center')?.classList.add('hidden');
        closeWidgetGallery();
        $('desktop-widget-layer')?.replaceChildren();
        return;
    }

    renderWidgetCenter();
    renderDesktopWidgets();
    widgetClockTimer = setInterval(() => { updateClockWidgets(); updateWidgetCenterDate(); }, 1000);
    screenTimeRefreshTimer = setInterval(() => {
        if (widgetsRuntimeDisabled()) return;
        document.querySelectorAll('.widget-screenTime[data-widget-id]').forEach((card) => {
            const widget = findPlacedWidget(card.dataset.widgetId);
            if (widget) populateScreenTime(card, widget);
        });
        renderScreenTimeManager();
    }, 60000);
    await restartPhotoSchedulers();
}

export async function bindWidgetEvents() {
    if (!widgetEventsBound) {
        widgetEventsBound = true;
        ensurePhotoSources().catch(() => {});
        $('clock')?.addEventListener('click', (event) => {
            if (widgetsRuntimeDisabled()) return;
            event.stopPropagation();
            toggleWidgetCenter();
        });
        $('widget-center')?.addEventListener('click', (event) => event.stopPropagation());
        $('widget-edit-btn')?.addEventListener('click', openWidgetGallery);
        $('widget-gallery-done')?.addEventListener('click', closeWidgetGallery);
        $('widget-gallery')?.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', (event) => {
            if (document.body.classList.contains('widget-gallery-open')) return;
            if (!$('widget-center')?.classList.contains('hidden') && !event.target.closest('#widget-center') && !event.target.closest('#widget-gallery') && !event.target.closest('#clock')) toggleWidgetCenter(false);
        });
        document.querySelectorAll('.widget-gallery-category').forEach((item) => item.addEventListener('click', () => renderGalleryCategory(item.dataset.category)));
        $('widget-gallery-search')?.addEventListener('input', () => renderGalleryCategory(state.widgetGalleryCategory || 'all'));
        bindGalleryDrag();
        bindCenterReordering();
        bindWidgetManagement();
        bindWidgetSettings();

        window.addEventListener('macos-dayphase-change', () => triggerPhotoEvent('dayNight'));
        window.addEventListener('macos-appearance-change', () => triggerPhotoEvent('appearance'));
        // An application published new widget content, was removed, or lost the permission.
        window.addEventListener('macos-app-widgets-changed', (event) => {
            const appId = event.detail?.appId;
            const placed = allPlacedWidgets().filter((widget) => widget.type === 'app');
            // Widgets whose application is gone were dropped from the configuration: redraw the lists.
            if ([...document.querySelectorAll('.widget-card.widget-app:not(.widget-preview)')].some((card) => !placed.some((widget) => widget.id === card.dataset.widgetId))) { renderWidgets({ includeSettings: true }); renderDesktopIcons(); return; }
            document.querySelectorAll('.widget-card.widget-app:not(.widget-preview)').forEach((card) => {
                const widget = placed.find((item) => item.id === card.dataset.widgetId);
                if (widget && (!appId || widget.appId === appId) && (!event.detail?.widgetId || widget.variant === event.detail.widgetId)) mountApplicationWidget(card, widget);
            });
            if (!$('widget-gallery')?.classList.contains('hidden')) renderWidgetGallery();
        });
        const flush = () => { flushPhotoState(); };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }
    await syncWidgetRuntimeState();
}
