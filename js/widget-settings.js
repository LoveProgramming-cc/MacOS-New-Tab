// System Settings ▸ Widgets: weather locations, photo sources, screen-time limits.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement, readFileAsDataUrl } from './utils.js';
import { secondsBaseEnabled, formatLimitDuration } from './developer.js';
import { renderPluginManager } from './plugin-system.js';
import { allPhotoWidgets, allPlacedWidgets, renderDesktopWidgets, renderWidgetCenter, widgetTitle } from './widgets.js';
import { ensurePhotoSources, importCompressedPhotos, normalizePhotoSource, photoSourceId, restartPhotoSchedulers, setMedia, setPhotoImportProgress, setPhotoSelectedIndex, updatePhotoWidget } from './widget-photos.js';
import { formatDuration, getScreenTimeSummaryCached, makeScreenTimeChart, screenTimeFavicon, weatherLocationFor, weatherLocations } from './widget-content.js';
import { openWidgetGallery } from './widget-gallery.js';

let weatherSearchResults = [];
function weatherLocationLabel(location) {
    return [location.label, location.admin1, location.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
}

function renderWeatherSettings() {
    const cfg = state.config.widgets?.weather;
    const list = $('widget-weather-location-list');
    if (list) {
        list.replaceChildren();
        (cfg?.locations || []).forEach((location) => {
            const row = createElement('div', { className: 'widget-location-row' });
            const label = createElement('span', { className: 'widget-location-name', text: weatherLocationLabel(location) });
            const actions = createElement('span', { className: 'widget-location-actions' });
            const def = createElement('button', {
                className: `mac-btn widget-location-default${cfg.defaultLocationId === location.id ? ' active' : ''}`,
                text: cfg.defaultLocationId === location.id ? t('weatherDefault', '默认') : t('setDefault', '设为默认'),
                dataset: { locationId: location.id }
            });
            const del = createElement('button', { className: 'mac-btn widget-location-delete', text: t('btnDelete', '删除'), dataset: { locationId: location.id } });
            del.disabled = (cfg.locations || []).length <= 1;
            actions.append(def, del);
            row.append(label, actions);
            list.appendChild(row);
        });
    }

    const results = $('widget-weather-search-results');
    if (results) {
        results.replaceChildren();
        weatherSearchResults.forEach((result, index) => {
            const row = createElement('button', { className: 'weather-search-result', dataset: { resultIndex: index } });
            row.append(
                createElement('span', { text: [result.name, result.admin1, result.country].filter(Boolean).join(', ') }),
                createElement('span', { className: 'weather-result-add', text: t('btnAdd', '添加') })
            );
            results.appendChild(row);
        });
    }
}

function photoWidgetOptionLabel(widget, index) {
    const location = (state.config.widgets.center || []).some((x) => x.id === widget.id) ? t('widgetCenter', '小组件中心') : t('desktop', '桌面');
    return `${t('widgetPhotos', '照片')} ${index + 1} · ${t(`widgetSize_${widget.size}`, widget.size)} · ${location}`;
}

export async function renderPhotoSettingsControls() {
    const select = $('widget-photo-target');
    if (!select) return;
    const widgets = allPhotoWidgets();
    if (!widgets.length) {
        state.selectedPhotoWidgetId = null;
        select.replaceChildren(createElement('option', { text: t('noPhotoWidgets', '尚未放置照片小组件'), attrs: { value: '' } }));
        select.disabled = true;
        document.querySelectorAll('.photo-widget-setting-control').forEach((el) => { el.disabled = true; });
        const status = $('widget-photo-status');
        if (status) status.textContent = t('addPhotoWidgetFirst', '请先从小组件图库添加照片小组件。');
        return;
    }
    select.disabled = false;
    if (!state.selectedPhotoWidgetId || !widgets.some((w) => w.id === state.selectedPhotoWidgetId)) state.selectedPhotoWidgetId = widgets[0].id;
    select.replaceChildren(...widgets.map((widget, index) => createElement('option', { text: photoWidgetOptionLabel(widget, index), attrs: { value: widget.id } })));
    select.value = state.selectedPhotoWidgetId;

    const media = await ensurePhotoSources();
    const widget = widgets.find((w) => w.id === state.selectedPhotoWidgetId);
    const source = normalizePhotoSource(media.photoSources[photoSourceId(widget)]);
    const status = $('widget-photo-status');
    if (status) status.textContent = source.photos.length ? t('photoCount', '{count} 张照片').replace('{count}', String(source.photos.length)) : t('widgetPhotoEmpty', '在设置中选择照片');

    if ($('widget-photo-schedule-mode')) $('widget-photo-schedule-mode').value = source.schedule.mode;
    if ($('widget-photo-interval-value')) $('widget-photo-interval-value').value = source.schedule.intervalValue;
    if ($('widget-photo-interval-unit')) $('widget-photo-interval-unit').value = source.schedule.intervalUnit;
    if ($('widget-photo-event-daynight')) $('widget-photo-event-daynight').checked = source.schedule.events.dayNight;
    if ($('widget-photo-event-appearance')) $('widget-photo-event-appearance').checked = source.schedule.events.appearance;
    if ($('widget-photo-event-newtab')) $('widget-photo-event-newtab').checked = source.schedule.events.newTab;

    const intervalMode = source.schedule.mode === 'interval';
    const eventMode = source.schedule.mode === 'events';
    if ($('widget-photo-interval-controls')) $('widget-photo-interval-controls').classList.toggle('disabled', !intervalMode);
    if ($('widget-photo-event-controls')) $('widget-photo-event-controls').classList.toggle('disabled', !eventMode);
    if ($('widget-photo-interval-value')) $('widget-photo-interval-value').disabled = !intervalMode || source.schedule.intervalUnit === 'days';
    if ($('widget-photo-interval-unit')) $('widget-photo-interval-unit').disabled = !intervalMode;
    ['widget-photo-event-daynight', 'widget-photo-event-appearance', 'widget-photo-event-newtab'].forEach((id) => { if ($(id)) $(id).disabled = !eventMode; });
    document.querySelectorAll('.photo-widget-setting-control').forEach((el) => { if (!['widget-photo-interval-value','widget-photo-interval-unit','widget-photo-event-daynight','widget-photo-event-appearance','widget-photo-event-newtab'].includes(el.id)) el.disabled = false; });
}

export function renderWidgetSettings() {
    const cfg = state.config.widgets;
    if (!cfg) return;
    const secondsMode = secondsBaseEnabled();
    const durationInput = $('widget-limit-minutes');
    const durationLabel = $('widget-limit-unit-label');
    if (durationInput) { durationInput.max = secondsMode ? '86400' : '1440'; if (!durationInput.dataset.userEdited) durationInput.value = secondsMode ? '60' : '60'; }
    if (durationLabel) { durationLabel.dataset.i18n = secondsMode ? 'secondsPerDay' : 'minutesPerDay'; durationLabel.textContent = t(durationLabel.dataset.i18n, secondsMode ? '秒/天' : '分钟/天'); }
    if ($('widget-screen-time-toggle')) $('widget-screen-time-toggle').checked = cfg.screenTime?.enabled !== false;
    if ($('screen-time-overlay-message')) $('screen-time-overlay-message').value = cfg.screenTime?.overlayMessage || '';
    const overlayImageStatus = $('screen-time-overlay-image-status');
    if (overlayImageStatus) overlayImageStatus.textContent = cfg.screenTime?.overlayImage ? t('limitOverlayImageSelected', '已选择提示图片') : t('limitOverlayImageNone', '未选择提示图片');
    if ($('screen-time-overlay-image-width')) $('screen-time-overlay-image-width').value = cfg.screenTime?.overlayImageMaxWidth ?? 320;
    if ($('screen-time-overlay-image-height')) $('screen-time-overlay-image-height').value = cfg.screenTime?.overlayImageMaxHeight ?? 220;
    if ($('screen-time-overlay-font-size')) $('screen-time-overlay-font-size').value = cfg.screenTime?.overlayTextFontSize ?? 20;
    if ($('screen-time-overlay-font-size-value')) $('screen-time-overlay-font-size-value').textContent = `${cfg.screenTime?.overlayTextFontSize ?? 20} px`;
    if ($('screen-time-overlay-text-color')) $('screen-time-overlay-text-color').value = cfg.screenTime?.overlayTextColor || '#1d1d1f';
    const fontStatus = $('screen-time-overlay-font-status');
    if (fontStatus) fontStatus.textContent = cfg.screenTime?.overlayFontData ? `${t('customFontSelected', '已选择字体')}${cfg.screenTime.overlayFontName ? ` · ${cfg.screenTime.overlayFontName}` : ''}` : t('customFontDefault', '使用系统字体');
    renderPluginManager();
    renderWeatherSettings();
    renderPhotoSettingsControls();

    const list = $('widget-management-list');
    if (list) {
        list.replaceChildren();
        [['center', cfg.center || []], ['desktop', cfg.desktop || []]].forEach(([location, widgets]) => {
            widgets.forEach((widget) => {
                const row = createElement('div', { className: 'widget-management-row' });
                const info = createElement('span', { text: `${widgetTitle(widget)} · ${t(`widgetSize_${widget.size}`, widget.size)} · ${location === 'center' ? t('widgetCenter', '小组件中心') : t('desktop', '桌面')}` });
                row.appendChild(info);
                if (widget.type === 'weather') {
                    const select = createElement('select', { className: 'mac-input widget-manager-weather-location', dataset: { widgetId: widget.id } });
                    weatherLocations().forEach((loc) => select.appendChild(createElement('option', { text: loc.label, attrs: { value: loc.id } })));
                    select.value = weatherLocationFor(widget)?.id || '';
                    row.appendChild(select);
                }
                row.appendChild(createElement('button', { className: 'mac-btn widget-manager-delete', text: t('btnDelete', '删除'), dataset: { location, widgetId: widget.id } }));
                list.appendChild(row);
            });
        });
    }

    const limits = $('widget-limit-list');
    if (limits) {
        limits.replaceChildren();
        (cfg.screenTime?.limits || []).forEach((limit) => {
            const row = createElement('div', { className: 'widget-limit-row' });
            row.append(
                createElement('span', { text: `${limit.host} · ${formatLimitDuration(limit.minutes, t)}` }),
                createElement('button', { className: 'mac-btn widget-limit-delete', text: t('btnDelete', '删除'), dataset: { host: limit.host } })
            );
            limits.appendChild(row);
        });
    }
    renderScreenTimeManager();
}

function makeWeeklyScreenTimeChart(history = []) {
    const wrap = createElement('div', { className: 'screen-time-week-chart' });
    const normalized = [...history].slice(-7);
    const max = Math.max(1, ...normalized.map((item) => Number(item.total) || 0));
    normalized.forEach((item) => {
        const date = new Date(`${item.date}T12:00:00`);
        const col = createElement('div', { className: 'screen-time-week-col' });
        const bar = createElement('div', { className: 'screen-time-week-bar' });
        bar.style.setProperty('--week-height', `${Math.max((Number(item.total) || 0) > 0 ? 4 : 0, Math.round((Number(item.total) || 0) / max * 100))}%`);
        col.append(bar, createElement('div', { className: 'screen-time-week-label', text: date.toLocaleDateString(state.config.language, { weekday: 'narrow' }) }));
        wrap.appendChild(col);
    });
    while (wrap.children.length < 7) {
        const col = createElement('div', { className: 'screen-time-week-col muted' });
        col.append(createElement('div', { className: 'screen-time-week-bar' }), createElement('div', { className: 'screen-time-week-label', text: '·' }));
        wrap.prepend(col);
    }
    return wrap;
}

export async function renderScreenTimeManager() {
    const totalEl = $('screen-time-manager-total');
    const chartHost = $('screen-time-manager-chart');
    const sitesHost = $('screen-time-manager-sites');
    if (!totalEl || !chartHost || !sitesHost) return;
    try {
        const summary = await getScreenTimeSummaryCached(800);
        totalEl.textContent = formatDuration(summary?.total || 0);
        $('screen-time-manager-date').textContent = new Date().toLocaleDateString(state.config.language, { month: 'long', day: 'numeric', weekday: 'long' });
        $('screen-time-updated').textContent = t('screenTimeUpdatedNow', '今天 · 实时更新');
        const weekHost = $('screen-time-manager-week');
        if (weekHost) weekHost.replaceChildren(makeWeeklyScreenTimeChart(summary?.history || []));
        chartHost.replaceChildren(makeScreenTimeChart(summary, { manager: true }));
        sitesHost.replaceChildren();
        (summary?.sites || []).slice(0, 16).forEach((site) => {
            const row = createElement('div', { className: 'screen-time-manager-site-row' });
            const icon = createElement('img', { className: 'screen-time-manager-site-icon', attrs: { src: screenTimeFavicon(site.host), alt: '' } });
            icon.addEventListener('error', () => { icon.src = 'assets/images/Safari浏览器.png'; });
            const text = createElement('div', { className: 'screen-time-manager-site-name', text: site.host });
            const value = createElement('div', { className: 'screen-time-manager-site-value', text: formatDuration(site.seconds, true) });
            const limit = state.config.widgets.screenTime.limits.find((x) => x.host === site.host);
            const limitText = createElement('div', { className: 'screen-time-manager-site-limit', text: limit ? formatLimitDuration(limit.minutes, t) : '—' });
            row.append(icon, text, value, limitText);
            sitesHost.appendChild(row);
        });
        if (!(summary?.sites || []).length) sitesHost.appendChild(createElement('div', { className: 'widget-settings-muted', text: t('screenTimeNoData', '今天还没有网页使用记录。') }));
    } catch {
        totalEl.textContent = '—';
        $('screen-time-manager-week')?.replaceChildren();
        chartHost.replaceChildren();
        sitesHost.replaceChildren(createElement('div', { className: 'widget-settings-muted', text: t('widgetScreenTimeUnavailable', '无法读取使用时间') }));
    }
}

async function searchWeatherLocations(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const params = new URLSearchParams({ name: q, count: '7', language: (state.config.language || 'en').split('-')[0], format: 'json' });
    try {
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
        if (!response.ok) throw new Error('geocode');
        const data = await response.json();
        return (data.results || []).map((result) => ({
            name: result.name,
            admin1: result.admin1 || '',
            country: result.country || '',
            latitude: result.latitude,
            longitude: result.longitude,
            timezone: result.timezone || 'auto'
        }));
    } catch {
        return [];
    }
}
function makeWeatherLocationId(result) {
    return `weather-${String(result.name || 'place').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}-${Math.round(Number(result.latitude) * 1000)}-${Math.round(Number(result.longitude) * 1000)}`;
}

async function selectedPhotoContext() {
    const widget = allPhotoWidgets().find((w) => w.id === state.selectedPhotoWidgetId);
    if (!widget) return null;
    const media = await ensurePhotoSources();
    const id = photoSourceId(widget);
    return { widget, media, sourceId: id, source: normalizePhotoSource(media.photoSources[id]) };
}
async function saveSelectedPhotoSource(mutator, { updateImage = true, restart = true } = {}) {
    const ctx = await selectedPhotoContext();
    if (!ctx) return;
    await mutator(ctx.source, ctx);
    ctx.media.photoSources[ctx.sourceId] = normalizePhotoSource(ctx.source);
    await setMedia(ctx.media);
    if (updateImage) await updatePhotoWidget(ctx.widget.id, true);
    await renderPhotoSettingsControls();
    if (restart) restartPhotoSchedulers();
}

export function bindWidgetSettings() {
    $('widget-screen-time-toggle')?.addEventListener('change', async (event) => {
        state.config.widgets.screenTime.enabled = event.target.checked;
        await saveConfig();
        renderWidgetCenter();
        renderDesktopWidgets();
        renderScreenTimeManager();
    });
    $('screen-time-overlay-message')?.addEventListener('change', async (event) => {
        state.config.widgets.screenTime.overlayMessage = String(event.target.value || '').slice(0, 160);
        await saveConfig();
    });
    $('screen-time-overlay-image')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        state.config.widgets.screenTime.overlayImage = await readFileAsDataUrl(file);
        await saveConfig();
        renderWidgetSettings();
        event.target.value = '';
    });
    $('screen-time-overlay-image-clear')?.addEventListener('click', async () => {
        state.config.widgets.screenTime.overlayImage = '';
        await saveConfig();
        renderWidgetSettings();
    });
    const persistOverlayAppearance = async () => {
        const cfg = state.config.widgets.screenTime;
        cfg.overlayImageMaxWidth = Math.max(80, Math.min(900, Number($('screen-time-overlay-image-width')?.value) || 320));
        cfg.overlayImageMaxHeight = Math.max(60, Math.min(700, Number($('screen-time-overlay-image-height')?.value) || 220));
        cfg.overlayTextFontSize = Math.max(10, Math.min(64, Number($('screen-time-overlay-font-size')?.value) || 20));
        cfg.overlayTextColor = $('screen-time-overlay-text-color')?.value || '#1d1d1f';
        await saveConfig();
    };
    ['screen-time-overlay-image-width','screen-time-overlay-image-height','screen-time-overlay-text-color'].forEach((id) => $(id)?.addEventListener('change', persistOverlayAppearance));
    $('screen-time-overlay-font-size')?.addEventListener('input', (event) => { if ($('screen-time-overlay-font-size-value')) $('screen-time-overlay-font-size-value').textContent = `${event.target.value} px`; });
    $('screen-time-overlay-font-size')?.addEventListener('change', persistOverlayAppearance);
    $('screen-time-overlay-font')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const allowed = /\.(woff2?|ttf|otf)$/i.test(file.name) || /^font\//i.test(file.type || '') || /font/i.test(file.type || '');
        if (!allowed || file.size > 4_000_000) { event.target.value = ''; return; }
        state.config.widgets.screenTime.overlayFontData = await readFileAsDataUrl(file);
        state.config.widgets.screenTime.overlayFontName = file.name.slice(0, 80);
        await saveConfig();
        renderWidgetSettings();
        event.target.value = '';
    });
    $('screen-time-overlay-font-clear')?.addEventListener('click', async () => {
        state.config.widgets.screenTime.overlayFontData = '';
        state.config.widgets.screenTime.overlayFontName = '';
        await saveConfig();
        renderWidgetSettings();
    });
    $('open-screen-time-settings')?.addEventListener('click', () => {
        document.querySelector('.settings-sidebar .tab[data-target="set-screen-time"]')?.click();
        renderScreenTimeManager();
    });

    $('widget-weather-search')?.addEventListener('click', async () => {
        const query = $('widget-weather-query')?.value || '';
        weatherSearchResults = await searchWeatherLocations(query);
        renderWeatherSettings();
    });
    $('widget-weather-query')?.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        weatherSearchResults = await searchWeatherLocations(event.currentTarget.value);
        renderWeatherSettings();
    });
    $('widget-weather-search-results')?.addEventListener('click', async (event) => {
        const button = event.target.closest('.weather-search-result');
        if (!button) return;
        const result = weatherSearchResults[Number(button.dataset.resultIndex)];
        if (!result) return;
        const weather = state.config.widgets.weather;
        const id = makeWeatherLocationId(result);
        if (!(weather.locations || []).some((loc) => loc.id === id)) {
            weather.locations.push({ id, label: result.name, admin1: result.admin1, country: result.country, latitude: result.latitude, longitude: result.longitude, timezone: result.timezone });
        }
        if (!weather.defaultLocationId) weather.defaultLocationId = id;
        weatherSearchResults = [];
        await saveConfig();
        renderWeatherSettings();
        renderWidgetSettings();
        renderWidgetCenter();
        renderDesktopWidgets();
    });
    $('widget-weather-location-list')?.addEventListener('click', async (event) => {
        const defaultBtn = event.target.closest('.widget-location-default');
        const deleteBtn = event.target.closest('.widget-location-delete');
        const weather = state.config.widgets.weather;
        if (defaultBtn) {
            weather.defaultLocationId = defaultBtn.dataset.locationId;
            await saveConfig();
            renderWeatherSettings();
            renderWidgetSettings();
            return;
        }
        if (deleteBtn && (weather.locations || []).length > 1) {
            const id = deleteBtn.dataset.locationId;
            weather.locations = weather.locations.filter((loc) => loc.id !== id);
            if (weather.defaultLocationId === id) weather.defaultLocationId = weather.locations[0]?.id || '';
            allPlacedWidgets().filter((w) => w.type === 'weather' && w.weatherLocationId === id).forEach((w) => { w.weatherLocationId = weather.defaultLocationId; });
            await saveConfig();
            renderWeatherSettings();
            renderWidgetSettings();
            renderWidgetCenter();
            renderDesktopWidgets();
        }
    });

    $('widget-photo-target')?.addEventListener('change', async (event) => {
        state.selectedPhotoWidgetId = event.target.value || null;
        await renderPhotoSettingsControls();
    });
    $('widget-photo-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        document.querySelectorAll('.photo-widget-setting-control').forEach((el) => { el.disabled = true; });
        setPhotoImportProgress({ visible: true, value: 0, total: 1 });
        const photos = await importCompressedPhotos([file], (current, total) => setPhotoImportProgress({ visible: true, value: current, total }));
        if (photos.length) {
            await saveSelectedPhotoSource(async (source, ctx) => {
                source.photos = [photos[0]];
                source.mode = 'single';
                source.selectedIndex = 0;
                await setPhotoSelectedIndex(ctx.sourceId, 0);
            });
        }
        setPhotoImportProgress({ visible: false });
        document.querySelectorAll('.photo-widget-setting-control').forEach((el) => { el.disabled = false; });
        event.target.value = '';
    });
    $('widget-photo-folder')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])].filter((f) => f.type.startsWith('image/')).slice(0, 80);
        if (!files.length) return;
        document.querySelectorAll('.photo-widget-setting-control').forEach((el) => { el.disabled = true; });
        setPhotoImportProgress({ visible: true, value: 0, total: files.length });
        const photos = await importCompressedPhotos(files, (current, total) => setPhotoImportProgress({ visible: true, value: current, total }));
        if (photos.length) {
            await saveSelectedPhotoSource(async (source, ctx) => {
                source.photos = photos;
                source.mode = photos.length > 1 ? 'cycle' : 'single';
                source.selectedIndex = 0;
                await setPhotoSelectedIndex(ctx.sourceId, 0);
            });
        }
        setPhotoImportProgress({ visible: false });
        document.querySelectorAll('.photo-widget-setting-control').forEach((el) => { el.disabled = false; });
        event.target.value = '';
    });
    $('widget-photo-schedule-mode')?.addEventListener('change', async (event) => {
        await saveSelectedPhotoSource(async (source) => {
            source.schedule.mode = ['manual', 'interval', 'events'].includes(event.target.value) ? event.target.value : 'manual';
        }, { updateImage: false });
    });
    const saveInterval = async () => {
        await saveSelectedPhotoSource(async (source) => {
            source.schedule.intervalUnit = ['seconds', 'minutes', 'hours', 'days'].includes($('widget-photo-interval-unit')?.value) ? $('widget-photo-interval-unit').value : (secondsBaseEnabled() ? 'seconds' : 'minutes');
            source.schedule.intervalValue = source.schedule.intervalUnit === 'days' ? 1 : Math.max(1, Math.min(1440, Number($('widget-photo-interval-value')?.value) || 1));
        }, { updateImage: false });
    };
    $('widget-photo-interval-value')?.addEventListener('change', saveInterval);
    $('widget-photo-interval-unit')?.addEventListener('change', saveInterval);
    [['widget-photo-event-daynight', 'dayNight'], ['widget-photo-event-appearance', 'appearance'], ['widget-photo-event-newtab', 'newTab']].forEach(([id, key]) => {
        $(id)?.addEventListener('change', async (event) => {
            await saveSelectedPhotoSource(async (source) => { source.schedule.events[key] = event.target.checked; }, { updateImage: false });
        });
    });

    $('widget-limit-minutes')?.addEventListener('input', (event) => { event.target.dataset.userEdited = '1'; });

    $('widget-limit-add')?.addEventListener('click', async () => {
        let host = ($('widget-limit-host')?.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        const rawDuration = Math.max(1, Number($('widget-limit-minutes')?.value) || 0);
        const minutes = secondsBaseEnabled() ? Math.min(1440, rawDuration / 60) : Math.min(1440, rawDuration);
        if (!host || !/^[a-z0-9.-]+$/.test(host)) return;
        const limits = state.config.widgets.screenTime.limits;
        const existing = limits.find((x) => x.host === host);
        if (existing) existing.minutes = minutes;
        else limits.push({ host, minutes });
        await saveConfig();
        $('widget-limit-host').value = '';
        renderWidgetSettings();
        renderScreenTimeManager();
    });
    $('widget-limit-list')?.addEventListener('click', async (event) => {
        const btn = event.target.closest('.widget-limit-delete');
        if (!btn) return;
        state.config.widgets.screenTime.limits = state.config.widgets.screenTime.limits.filter((x) => x.host !== btn.dataset.host);
        await saveConfig();
        renderWidgetSettings();
        renderScreenTimeManager();
    });
    $('open-widget-gallery-settings')?.addEventListener('click', openWidgetGallery);
}
