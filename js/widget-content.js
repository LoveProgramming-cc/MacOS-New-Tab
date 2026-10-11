// What the weather, battery and screen-time widgets show, and where their data comes from.

import { state } from './state.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { SCREEN_TIME_BOOT_CACHE_KEY, SVG_NS, WEATHER_PERSIST_KEY, weatherCache, weatherInflight, widgetsRuntimeDisabled } from './widgets.js';

let screenTimeSummaryFetchedAt = 0;
let persistentWeatherLoaded = false;
let screenTimeSummaryPromise = null;
let screenTimeSummaryCache = null;
let persistentScreenTimeLoaded = false;
export function formatDuration(seconds, compact = false) {
    const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (compact) {
        const h = t('hourCompact', 'h');
        const m = t('minuteCompact', 'm');
        return hours ? `${hours}${h} ${minutes}${m}` : `${minutes}${m}`;
    }
    const h = t('hoursShort', '小时');
    const m = t('minutesShort', '分钟');
    return hours ? `${hours}${h}${minutes}${m}` : `${minutes}${m}`;
}

function weatherSymbol(code) {
    const c = Number(code);
    if (c === 0) return '☀';
    if ([1, 2].includes(c)) return '🌤';
    if (c === 3) return '☁';
    if ([45, 48].includes(c)) return '🌫';
    if (c >= 51 && c <= 67) return '🌧';
    if (c >= 71 && c <= 77) return '❄';
    if (c >= 80 && c <= 82) return '🌦';
    if (c >= 95) return '⛈';
    return '☁';
}

function loadPersistentWeatherCache() {
    if (persistentWeatherLoaded) return;
    persistentWeatherLoaded = true;
    try {
        const raw = JSON.parse(localStorage.getItem(WEATHER_PERSIST_KEY) || '{}');
        Object.entries(raw || {}).forEach(([key, entry]) => {
            if (entry?.data && Number(entry.fetchedAt)) weatherCache.set(key, { fetchedAt: Number(entry.fetchedAt), data: entry.data });
        });
    } catch {}
}
function savePersistentWeatherCache() {
    try {
        const entries = [...weatherCache.entries()]
            .sort((a, b) => Number(b[1]?.fetchedAt || 0) - Number(a[1]?.fetchedAt || 0))
            .slice(0, 8);
        localStorage.setItem(WEATHER_PERSIST_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
}
function weatherCacheKey(location) { return `${location?.latitude},${location?.longitude}`; }

export function weatherLocations() {
    const weather = state.config.widgets?.weather || {};
    return Array.isArray(weather.locations) ? weather.locations : [];
}
export function weatherLocationFor(widget) {
    const locations = weatherLocations();
    if (!locations.length) return null;
    const weather = state.config.widgets?.weather || {};
    const id = widget?.weatherLocationId || weather.defaultLocationId;
    return locations.find((location) => location.id === id) || locations[0];
}
async function fetchWeather(location, { force = false } = {}) {
    if (!location || widgetsRuntimeDisabled()) return null;
    loadPersistentWeatherCache();
    const key = weatherCacheKey(location);
    const cached = weatherCache.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) return cached.data;
    const params = new URLSearchParams({
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        timezone: location.timezone || 'auto',
        forecast_days: '5',
        current: 'temperature_2m,weather_code',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min'
    });
    if (weatherInflight.has(key)) return weatherInflight.get(key);
    const request = (async () => {
        try {
            const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
            if (!response.ok) throw new Error('weather');
            const data = await response.json();
            weatherCache.set(key, { fetchedAt: Date.now(), data });
            savePersistentWeatherCache();
            return data;
        } catch {
            return cached?.data || null;
        } finally {
            weatherInflight.delete(key);
        }
    })();
    weatherInflight.set(key, request);
    return request;
}

function makeLaptopSvg() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 48');
    svg.setAttribute('class', 'battery-device-svg');
    svg.setAttribute('aria-hidden', 'true');
    const screen = document.createElementNS(SVG_NS, 'rect');
    screen.setAttribute('x', '13'); screen.setAttribute('y', '8'); screen.setAttribute('width', '38'); screen.setAttribute('height', '26'); screen.setAttribute('rx', '2.5');
    const base = document.createElementNS(SVG_NS, 'path');
    base.setAttribute('d', 'M7 38h50M18 34l-4 4h36l-4-4');
    svg.append(screen, base);
    return svg;
}
function makeBatteryRing(percent = null, active = false) {
    const ring = createElement('div', { className: `battery-ring${active ? ' active' : ''}` });
    if (percent !== null) ring.style.setProperty('--battery-level', `${Math.max(0, Math.min(100, percent)) * 3.6}deg`);
    if (active) ring.appendChild(makeLaptopSvg());
    return ring;
}
export function renderBatteryLevel(card, target, pct) {
    target.replaceChildren();
    if (card.classList.contains('widget-size-medium')) {
        const slots = createElement('div', { className: 'battery-slots' });
        const first = createElement('div', { className: 'battery-slot active' });
        first.append(makeBatteryRing(pct, true), createElement('div', { className: 'battery-percent', text: `${pct}%` }));
        slots.appendChild(first);
        for (let i = 0; i < 3; i += 1) {
            const slot = createElement('div', { className: 'battery-slot empty' });
            slot.appendChild(makeBatteryRing(null, false));
            slots.appendChild(slot);
        }
        target.appendChild(slots);
    } else {
        target.append(makeBatteryRing(pct, true), createElement('div', { className: 'battery-percent', text: `${pct}%` }), createElement('div', { className: 'widget-caption', text: t('widgetThisComputer', '此电脑') }));
    }
}
export async function populateBattery(card) {
    const target = card.querySelector('.battery-widget-content');
    if (!target) return;
    try {
        if (typeof navigator.getBattery !== 'function') throw new Error('unsupported');
        const battery = await navigator.getBattery();
        renderBatteryLevel(card, target, Math.round(battery.level * 100));
    } catch {
        target.replaceChildren(createElement('div', { className: 'battery-unavailable', text: t('widgetBatteryUnavailable', '浏览器无法读取系统电池') }));
    }
}

export function renderWeatherData(target, widget, location, data) {
    if (!target || !data?.current) return false;
    const current = data.current;
    const daily = data.daily || {};
    target.replaceChildren();
    const head = createElement('div', { className: 'weather-head' });
    const left = createElement('div');
    left.append(createElement('div', { className: 'weather-location', text: location.label }), createElement('div', { className: 'weather-temp', text: `${Math.round(current.temperature_2m)}°` }));
    const right = createElement('div', { className: 'weather-condition' });
    right.append(createElement('div', { className: 'weather-symbol', text: weatherSymbol(current.weather_code) }));
    if (daily.temperature_2m_max?.length) right.appendChild(createElement('div', { text: `${t('high', '高')} ${Math.round(daily.temperature_2m_max[0])}°  ${t('low', '低')} ${Math.round(daily.temperature_2m_min[0])}°` }));
    head.append(left, right);
    target.appendChild(head);
    if (widget.variant !== 'current') {
        const forecast = createElement('div', { className: 'weather-forecast-row' });
        (daily.time || []).slice(0, widget.variant === 'detailed' ? 5 : 4).forEach((day, i) => {
            const d = new Date(`${day}T12:00:00`);
            const col = createElement('div', { className: 'weather-day' });
            col.append(
                createElement('div', { text: d.toLocaleDateString(state.config.language, { weekday: 'short' }) }),
                createElement('div', { className: 'weather-day-icon', text: weatherSymbol(daily.weather_code?.[i]) }),
                createElement('div', { text: `${Math.round(daily.temperature_2m_max?.[i] ?? 0)}°` })
            );
            forecast.appendChild(col);
        });
        target.appendChild(forecast);
    }
    return true;
}

export async function populateWeather(card, widget) {
    const target = card.querySelector('.weather-widget-content');
    if (!target || widgetsRuntimeDisabled()) return;
    const location = weatherLocationFor(widget);
    if (!location) {
        target.replaceChildren(createElement('div', { className: 'widget-loading', text: t('widgetWeatherAddLocation', '请先在设置中添加天气地点') }));
        return;
    }

    // First paint from the last real weather response. A stale cache is deliberately
    // shown immediately and refreshed after the widget is already visible.
    loadPersistentWeatherCache();
    const key = weatherCacheKey(location);
    const cached = weatherCache.get(key);
    if (cached?.data?.current) {
        renderWeatherData(target, widget, location, cached.data);
        if (Date.now() - Number(cached.fetchedAt || 0) >= 10 * 60 * 1000) {
            fetchWeather(location, { force: true }).then((fresh) => {
                if (fresh?.current && card.isConnected && !widgetsRuntimeDisabled()) renderWeatherData(target, widget, location, fresh);
            }).catch(() => {});
        }
        return;
    }

    const data = await fetchWeather(location);
    if (!data?.current) {
        target.replaceChildren(createElement('div', { className: 'widget-loading', text: t('widgetWeatherUnavailable', '天气数据不可用') }));
        return;
    }
    renderWeatherData(target, widget, location, data);
}

function screenTimeCategory(host) {
    const h = String(host || '').toLowerCase();
    if (/(youtube|netflix|bilibili|twitch|spotify|music|video|iqiyi|youku)/.test(h)) return 'entertainment';
    if (/(whatsapp|wechat|facebook|instagram|twitter|x\.com|reddit|telegram|discord|snapchat|tiktok)/.test(h)) return 'social';
    if (/(docs|drive|notion|github|stackoverflow|openai|chatgpt|deepseek|classroom|slack|office|microsoft)/.test(h)) return 'productivity';
    return 'other';
}

export function screenTimeFavicon(host) {
    try {
        const url = new URL(chrome.runtime.getURL('/_favicon/'));
        url.searchParams.set('pageUrl', `https://${host}`);
        url.searchParams.set('size', '64');
        return url.href;
    } catch { return 'assets/images/Safari浏览器.png'; }
}

export function makeScreenTimeChart(summary, { manager = false } = {}) {
    const hours = summary?.hours || {};
    const chart = createElement('div', { className: `screen-time-hourly-chart${manager ? ' manager' : ''}` });
    const nowHour = new Date().getHours();
    const startHour = manager ? 0 : Math.max(0, Math.min(8, nowHour - 14));
    const endHour = manager ? 23 : 23;
    let max = 1;
    const hourRows = [];
    for (let h = startHour; h <= endHour; h += 1) {
        const key = String(h).padStart(2, '0');
        const byHost = hours[key] || {};
        const categories = { productivity: 0, entertainment: 0, social: 0, other: 0 };
        Object.entries(byHost).forEach(([host, seconds]) => { categories[screenTimeCategory(host)] += Number(seconds) || 0; });
        const total = Object.values(categories).reduce((a, b) => a + b, 0);
        max = Math.max(max, total);
        hourRows.push({ h, categories, total });
    }
    hourRows.forEach(({ h, categories, total }) => {
        const col = createElement('div', { className: 'screen-time-hour-col' });
        const stack = createElement('div', { className: 'screen-time-hour-stack' });
        stack.style.setProperty('--hour-height', `${Math.max(total > 0 ? 3 : 0, Math.round(total / max * 100))}%`);
        ['other', 'social', 'entertainment', 'productivity'].forEach((category) => {
            const value = categories[category];
            const part = createElement('span', { className: `screen-time-segment ${category}` });
            part.style.setProperty('--segment-ratio', total ? String(value / total) : '0');
            stack.appendChild(part);
        });
        col.appendChild(stack);
        if ((manager && h % 3 === 0) || (!manager && [8, 14, 20].includes(h))) {
            col.appendChild(createElement('div', { className: 'screen-time-hour-label', text: String(h).padStart(2, '0') }));
        }
        chart.appendChild(col);
    });
    return chart;
}

function makeScreenTimeSiteList(sites, maxItems = 4) {
    const list = createElement('div', { className: 'screen-time-site-list' });
    (sites || []).slice(0, maxItems).forEach((site) => {
        const row = createElement('div', { className: 'screen-time-site-item' });
        const icon = createElement('img', { className: 'screen-time-site-icon', attrs: { src: screenTimeFavicon(site.host), alt: '' } });
        icon.addEventListener('error', () => { icon.src = 'assets/images/Safari浏览器.png'; });
        row.append(icon, createElement('span', { className: 'screen-time-site-name', text: site.host }), createElement('span', { className: 'screen-time-site-duration', text: formatDuration(site.seconds, true) }));
        list.appendChild(row);
    });
    return list;
}

function currentScreenTimeDayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function loadPersistentScreenTimeCache() {
    if (persistentScreenTimeLoaded) return;
    persistentScreenTimeLoaded = true;
    try {
        const entry = JSON.parse(localStorage.getItem(SCREEN_TIME_BOOT_CACHE_KEY) || 'null');
        if (entry?.summary && (!entry.summary.date || entry.summary.date === currentScreenTimeDayKey())) {
            screenTimeSummaryCache = entry.summary;
            screenTimeSummaryFetchedAt = Number(entry.fetchedAt) || 0;
        }
    } catch {}
}
function savePersistentScreenTimeCache() {
    if (!screenTimeSummaryCache) return;
    try { localStorage.setItem(SCREEN_TIME_BOOT_CACHE_KEY, JSON.stringify({ fetchedAt: screenTimeSummaryFetchedAt, summary: screenTimeSummaryCache })); } catch {}
}
async function requestScreenTimeSummary() {
    if (widgetsRuntimeDisabled()) return { date: currentScreenTimeDayKey(), total: 0, sites: [], hours: {}, history: [] };
    if (!screenTimeSummaryPromise) {
        screenTimeSummaryPromise = chrome.runtime.sendMessage({ type: 'getScreenTimeSummary' })
            .then((summary) => {
                screenTimeSummaryCache = summary || { date: currentScreenTimeDayKey(), total: 0, sites: [], hours: {}, history: [] };
                screenTimeSummaryFetchedAt = Date.now();
                savePersistentScreenTimeCache();
                return screenTimeSummaryCache;
            })
            .finally(() => { screenTimeSummaryPromise = null; });
    }
    return screenTimeSummaryPromise;
}
export async function getScreenTimeSummaryCached(maxAge = 2500) {
    loadPersistentScreenTimeCache();
    const now = Date.now();
    if (screenTimeSummaryCache && now - screenTimeSummaryFetchedAt <= maxAge) return screenTimeSummaryCache;
    return requestScreenTimeSummary();
}

export function renderScreenTimeSummary(target, widget, summary) {
    if (!target) return;
    target.replaceChildren();
    const total = createElement('div', { className: 'screen-time-total', text: formatDuration(summary?.total || 0) });
    target.appendChild(total);
    if (widget.size === 'small') {
        const compact = createElement('div', { className: 'screen-time-small-layout' });
        compact.appendChild(makeScreenTimeChart(summary));
        target.appendChild(compact);
        return;
    }
    if (widget.size === 'medium') {
        const body = createElement('div', { className: 'screen-time-visual-body screen-time-medium-layout' });
        body.append(makeScreenTimeChart(summary), makeScreenTimeSiteList(summary?.sites || [], 4));
        target.appendChild(body);
        return;
    }
    const large = createElement('div', { className: 'screen-time-large-layout' });
    large.appendChild(makeScreenTimeChart(summary));
    const sites = makeScreenTimeSiteList(summary?.sites || [], 6);
    sites.classList.add('screen-time-large-sites');
    large.appendChild(sites);
    target.appendChild(large);
}

export async function populateScreenTime(card, widget) {
    const target = card.querySelector('.screen-time-content');
    if (!target || widgetsRuntimeDisabled()) return;
    if (state.config.widgets?.screenTime?.enabled === false) {
        target.replaceChildren(createElement('div', { className: 'widget-loading', text: t('widgetScreenTimeOff', '屏幕使用时间已关闭') }));
        return;
    }
    try {
        loadPersistentScreenTimeCache();
        if (screenTimeSummaryCache) {
            renderScreenTimeSummary(target, widget, screenTimeSummaryCache);
            // Cached content makes the first live frame complete; freshness arrives later
            // without holding the boot snapshot or flashing a blank/default widget.
            if (Date.now() - screenTimeSummaryFetchedAt > 2500) {
                requestScreenTimeSummary().then((fresh) => {
                    if (card.isConnected && !widgetsRuntimeDisabled()) renderScreenTimeSummary(target, widget, fresh);
                }).catch(() => {});
            }
            return;
        }
        renderScreenTimeSummary(target, widget, await requestScreenTimeSummary());
    } catch {
        target.replaceChildren(createElement('div', { className: 'widget-loading', text: t('widgetScreenTimeUnavailable', '无法读取使用时间') }));
    }
}
