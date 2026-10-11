import { state } from './state.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { applyTheme, bingTargetSize, cacheWallpaperForFirstPaint, resolveBingDailyWallpaper } from './theme.js';
import { virtualNow } from './time.js';
import { showMacAlert } from './dialog.js';
import { addWallpaperPhoto, addWallpaperVideo, getWallpaper, listWallpapers, removeWallpaper, wallpaperPhotoData } from './wallpaper-store.js';
import { applyLiveWallpaperSettings, liveWallpaperVideo } from './live-wallpaper.js';

// Wallpaper settings: a preview of what is on the desktop now, live (video) wallpapers,
// the pictures the user added, the daily Bing picture with a download progress bar, and
// a month-by-month browser of past Bing pictures.
//
// Bing's own API only goes back about two weeks, so the monthly lists come from the
// public archive at github.com/niumoo/bing-wallpaper (one small index per month, from
// 2021-02 on). The pictures themselves are always loaded from bing.com.

const ARCHIVE_URL = (year, month) => `https://raw.githubusercontent.com/niumoo/bing-wallpaper/main/picture/${year}-${String(month).padStart(2, '0')}/README.md`;
const FIRST_MONTH = { year: 2021, month: 2 };
const MONTH_CACHE_PREFIX = 'macOS_bing_month_';
const IMAGE_ID = /^OHR\.[A-Za-z0-9_.-]{1,160}$/;
const months = new Map(); // 'YYYY-MM' -> [{ id, date }]
let shown = null;         // { year, month }
let monthLoaded = false;
let loadToken = 0;
let downloadToken = 0;

const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
function today() { const now = virtualNow(); return { year: now.getFullYear(), month: now.getMonth() + 1 }; }
const isCurrentMonth = (year, month) => { const now = today(); return now.year === year && now.month === month; };

export const bingImageUrl = (id, [width, height] = bingTargetSize()) => `https://www.bing.com/th?id=${id}&w=${width}&h=${height}&rs=1&c=4`;
const bingThumbUrl = (id) => bingImageUrl(id, [384, 216]);
/** "OHR.OlmstedPoint_EN-US0964858045_UHD.jpg" -> "Olmsted Point" */
function titleFromId(id) {
    const name = String(id).replace(/^OHR\./, '').split('_')[0];
    return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim() || name;
}
const idFromUrl = (url) => (String(url || '').match(/^https:\/\/(?:www\.|cn\.)?bing\.com\/th\?id=(OHR\.[A-Za-z0-9_.-]+)/i) || [])[1] || '';

async function fetchMonth(year, month) {
    const key = monthKey(year, month);
    if (months.has(key)) return months.get(key);
    // Past months never change; the current one grows by a picture a day.
    try {
        const cached = JSON.parse(localStorage.getItem(MONTH_CACHE_PREFIX + key) || 'null');
        if (cached?.items?.length && (!isCurrentMonth(year, month) || Date.now() - cached.at < 3 * 3600_000)) { months.set(key, cached.items); return cached.items; }
    } catch { /* cache is optional */ }
    const response = await fetch(ARCHIVE_URL(year, month));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const seen = new Set();
    const items = [];
    for (const match of text.matchAll(/!\[\]\(https:\/\/(?:cn|www)\.bing\.com\/th\?id=([^&)\s]+)[^)]*\)\s*(\d{4}-\d{2}-\d{2})/g)) {
        const id = match[1]; const date = match[2];
        if (!IMAGE_ID.test(id) || seen.has(date) || !date.startsWith(key)) continue;
        seen.add(date);
        items.push({ id, date });
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    months.set(key, items);
    try { localStorage.setItem(MONTH_CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), items })); } catch { /* cache is optional */ }
    return items;
}

// ---- download with progress ---------------------------------------------------------
function setProgress(value, label = '') {
    const row = $('wallpaper-progress-row'); const bar = $('wallpaper-progress'); const text = $('wallpaper-progress-label');
    if (!row || !bar) return;
    row.classList.toggle('hidden', value === null);
    if (value === null) return;
    if (value < 0) bar.removeAttribute('value'); else bar.value = Math.max(0, Math.min(1, value));
    if (text) text.textContent = label;
}
/**
 * Downloads a picture into the browser cache, reporting progress, so that the wallpaper
 * can then be switched without the desktop sitting blank while it loads.
 */
export async function downloadWallpaper(url, label = t('wallpaperDownloading', '正在下载壁纸…')) {
    const token = ++downloadToken;
    const megabytes = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
    setProgress(-1, label);
    try {
        const response = await fetch(url);
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const total = Number(response.headers.get('content-length')) || 0;
        const reader = response.body.getReader();
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            if (token === downloadToken) setProgress(total ? received / total : -1, total ? `${label} ${megabytes(received)} / ${megabytes(total)}` : `${label} ${megabytes(received)}`);
        }
        // Decode before it goes on the desktop.
        await new Promise((resolve) => { const image = new Image(); image.onload = image.onerror = resolve; image.src = url; });
        return token === downloadToken;
    } catch {
        // No progress information available (offline cache, blocked request): let the
        // desktop load the picture by itself.
        return token === downloadToken;
    } finally {
        if (token === downloadToken) setProgress(null);
    }
}

// ---- current wallpaper --------------------------------------------------------------
// The appearance is chosen first: `scope` says which of the two wallpapers (light, dark
// or both) the page shows as selected and the next choice replaces.
const live = () => (state.config.liveWallpaper?.enabled && state.config.liveWallpaper.id ? state.config.liveWallpaper : null);
const DEFAULT_WALLPAPER = { light: 'assets/images/sequoia.shape.day.jpg', dark: 'assets/images/sequoia.shape.night.jpg' };
const CONFIG_KEY = { light: 'wallpaperLight', dark: 'wallpaperDark' };
let library = [];         // summaries of the user's photos and videos
let scope = 'both';
const libraryItem = (id) => library.find((item) => item.id === id) || null;
const targetModes = () => (scope === 'both' ? ['light', 'dark'] : [scope]);
const photoIds = () => (state.config.wallpaperPhotoIds ||= { light: '', dark: '' });
// Bing's daily picture and a live wallpaper take over both appearances.
const shared = () => Boolean(live() || state.config.useBingWallpaper);
const modeValue = (mode) => (shared() ? (state.currentWallpaper || '') : (state.config[CONFIG_KEY[mode]] || DEFAULT_WALLPAPER[mode]));
const stopLive = () => { state.config.liveWallpaper = { ...(state.config.liveWallpaper || {}), enabled: false }; };
function setPicture(modes, value, photoId = '') {
    for (const mode of modes) { state.config[CONFIG_KEY[mode]] = value[mode] ?? value; photoIds()[mode] = photoId; }
    state.config.useBingWallpaper = false;
    stopLive();
}

function describeWallpaper(mode) {
    const value = modeValue(mode);
    if (live()) return { name: libraryItem(live().id)?.name || t('liveWallpaper', '动态壁纸'), detail: t('liveWallpaperDetail', '动态壁纸 · 循环播放') };
    if (state.config.useBingWallpaper) {
        let title = ''; try { title = localStorage.getItem('macOS_bing_title') || ''; } catch { /* no title */ }
        return { name: title || t('bingDailyWallpaper', 'Bing 每日壁纸'), detail: t('bingDailyDetail', 'Bing 每日壁纸 · 每天自动更换') };
    }
    const id = idFromUrl(value);
    if (id) {
        const date = [...months.values()].flat().find((item) => item.id === id)?.date || '';
        return { name: titleFromId(id), detail: [t('bingWallpaperArchive', 'Bing 壁纸'), date].filter(Boolean).join(' · ') };
    }
    if (String(value).startsWith('assets/')) return { name: 'Sequoia', detail: t('wallpaperBuiltIn', '内置壁纸') };
    return { name: libraryItem(photoIds()[mode])?.name || t('wallpaperCustom', '自定义图片'), detail: t('wallpaperCustomDetail', '你添加的图片') };
}
export function renderWallpaperSettings() {
    if (!$('wallpaper-preview-light')) return;
    const modes = targetModes();
    for (const mode of ['light', 'dark']) {
        const value = modeValue(mode);
        $(`wallpaper-preview-${mode}`).style.backgroundImage = value ? `url("${value.replaceAll('"', '%22')}")` : '';
        document.querySelector(`.wallpaper-preview-item[data-mode="${mode}"]`)?.classList.toggle('in-scope', modes.includes(mode));
    }
    document.querySelectorAll('#wallpaper-scope [data-scope]').forEach((button) => button.classList.toggle('selected', button.dataset.scope === scope));
    const infos = modes.map(describeWallpaper);
    const same = modes.length === 1 || shared() || modeValue('light') === modeValue('dark') || infos[0].name === infos[1].name;
    const name = same ? infos[0].name : `${t('wallpaperScopeLight', '浅色')}: ${infos[0].name}  ·  ${t('wallpaperScopeDark', '深色')}: ${infos[1].name}`;
    const detail = same ? infos[0].detail : t('wallpaperDiffers', '两种外观使用不同的墙纸');
    if ($('wallpaper-current-name')) { $('wallpaper-current-name').textContent = name; $('wallpaper-current-name').title = name; }
    if ($('wallpaper-current-detail')) $('wallpaper-current-detail').textContent = detail;
    markSelection();
    syncLiveControls();
}
function setScope(next) {
    scope = ['light', 'dark'].includes(next) ? next : 'both';
    renderWallpaperSettings();
}
// The ring goes on what the appearances in scope are using now.
function markSelection() {
    const video = live(); const modes = shared() ? [] : targetModes();
    const bing = new Set(modes.map((mode) => idFromUrl(state.config[CONFIG_KEY[mode]])).filter(Boolean));
    const photos = new Set(modes.filter((mode) => !idFromUrl(state.config[CONFIG_KEY[mode]])).map((mode) => photoIds()[mode]).filter(Boolean));
    document.querySelectorAll('#bing-gallery-grid .bing-gallery-item').forEach((item) => item.classList.toggle('selected', bing.has(item.dataset.id)));
    document.querySelectorAll('#wallpaper-photo-grid .wallpaper-tile[data-id]').forEach((item) => item.classList.toggle('selected', photos.has(item.dataset.id)));
    document.querySelectorAll('#wallpaper-video-grid .wallpaper-tile[data-id]').forEach((item) => item.classList.toggle('selected', Boolean(video) && item.dataset.id === video.id));
}

// ---- the user's own pictures and videos ------------------------------------------------
const clock = (seconds) => { const total = Math.max(0, Math.round(seconds || 0)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
function libraryTile(item) {
    const tile = createElement('div', { className: 'wallpaper-tile', attrs: { role: 'button', tabindex: '0', title: item.name }, dataset: { id: item.id, kind: item.kind } });
    tile.append(createElement('img', { attrs: { src: item.thumb, alt: '', draggable: 'false' } }));
    if (item.kind === 'video') tile.appendChild(createElement('span', { className: 'wallpaper-tile-badge', text: `▶ ${clock(item.duration)}` }));
    tile.append(createElement('span', { className: 'wallpaper-tile-name', text: item.name }),
        createElement('button', { className: 'wallpaper-tile-remove', text: '×', attrs: { type: 'button', title: t('btnDelete', '删除') } }));
    return tile;
}
function addTile(label) {
    const tile = createElement('div', { className: 'wallpaper-tile wallpaper-tile-add', attrs: { role: 'button', tabindex: '0' } });
    tile.append(createElement('span', { className: 'wallpaper-tile-plus', text: '+' }), createElement('span', { className: 'wallpaper-tile-name', text: label }));
    return tile;
}
function renderLibrary() {
    $('wallpaper-video-grid')?.replaceChildren(addTile(t('addVideo', '添加视频…')), ...library.filter((item) => item.kind === 'video').map(libraryTile));
    $('wallpaper-photo-grid')?.replaceChildren(addTile(t('addPhoto', '添加照片…')), ...library.filter((item) => item.kind === 'photo').map(libraryTile));
    markSelection();
}
async function loadLibrary() {
    try { library = await listWallpapers(); } catch { library = []; }
    renderLibrary();
    renderWallpaperSettings();
}
async function commit() {
    await saveConfig();
    await applyTheme();
    if ($('bing-wallpaper-toggle')) $('bing-wallpaper-toggle').checked = Boolean(state.config.useBingWallpaper);
    renderWallpaperSettings();
}
// Decoded before it goes on the desktop, so the switch itself is a single frame.
async function decoded(url) {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { /* the desktop will show whatever it can */ }
}
async function choosePhoto(id) {
    const data = await wallpaperPhotoData(id);
    if (!data) return;
    await decoded(data);
    const modes = targetModes();
    setPicture(modes, data, id);
    await Promise.all(modes.map((mode) => cacheWallpaperForFirstPaint(mode, data)));
    await commit();
}
async function chooseVideo(id) {
    const record = await getWallpaper(id);
    if (!record) return;
    // The poster is the wallpaper proper; the video plays on top of it — for both appearances.
    setPicture(['light', 'dark'], record.poster);
    state.config.liveWallpaper = { rate: 1, volume: 0, ...(state.config.liveWallpaper || {}), enabled: true, id, paused: false };
    await Promise.all(['light', 'dark'].map((mode) => cacheWallpaperForFirstPaint(mode, record.poster)));
    await commit();
}
function restoreDefaultWallpaper(modes = targetModes()) {
    setPicture(modes, DEFAULT_WALLPAPER);
    return Promise.all(modes.map((mode) => cacheWallpaperForFirstPaint(mode, DEFAULT_WALLPAPER[mode]))).then(commit);
}
async function addFiles(files, kind) {
    let last = null;
    setProgress(-1, t('wallpaperImporting', '正在添加…'));
    try {
        for (const file of files) {
            try { last = kind === 'video' ? await addWallpaperVideo(file) : await addWallpaperPhoto(file); }
            catch (error) { await showMacAlert(`${file.name}: ${error?.message || error}`, { title: t('error', '错误') }); }
        }
    } finally { setProgress(null); }
    await loadLibrary();
    // What was just added goes straight onto the desktop.
    if (last) await (kind === 'video' ? chooseVideo(last.id) : choosePhoto(last.id));
}
async function removeFromLibrary(id) {
    if (!library.length) { try { library = await listWallpapers(); } catch { /* nothing to remove */ } }
    const item = libraryItem(id);
    if (!item) return;
    await removeWallpaper(id);
    if (item.kind === 'video' && live()?.id === id) await restoreDefaultWallpaper(['light', 'dark']);
    const ids = photoIds();
    if (ids.light === id || ids.dark === id) { for (const mode of ['light', 'dark']) if (ids[mode] === id) ids[mode] = ''; await saveConfig(); }
    await loadLibrary();
}
function bindLibraryGrid(gridId, inputId, kind) {
    const grid = $(gridId); const input = $(inputId);
    if (!grid || !input) return;
    grid.addEventListener('click', (event) => {
        const tile = event.target.closest('.wallpaper-tile');
        if (!tile) return;
        if (tile.classList.contains('wallpaper-tile-add')) return input.click();
        if (event.target.closest('.wallpaper-tile-remove')) return removeFromLibrary(tile.dataset.id);
        (kind === 'video' ? chooseVideo : choosePhoto)(tile.dataset.id).catch((error) => showMacAlert(error?.message || String(error), { title: t('error', '错误') }));
    });
    input.addEventListener('change', () => {
        const files = [...(input.files || [])];
        input.value = '';
        if (files.length) addFiles(files, kind);
    });
}

// ---- live wallpaper controls ---------------------------------------------------------
function syncLiveControls() {
    const row = $('live-wallpaper-controls');
    if (!row) return;
    const active = live();
    row.hidden = !active;
    if (!active) return;
    if ($('live-wallpaper-toggle')) $('live-wallpaper-toggle').textContent = active.paused ? '▶' : '❚❚';
    const rate = $('live-wallpaper-rate');
    if (rate) { rate.dataset.value = String(active.rate || 1); rate.querySelector('.selected-text').textContent = `${active.rate || 1}×`; }
    if ($('live-wallpaper-volume')) $('live-wallpaper-volume').value = String(Math.round((active.volume || 0) * 100));
    syncLiveProgress();
}
function syncLiveProgress() {
    const video = liveWallpaperVideo(); const seek = $('live-wallpaper-seek');
    if (!video || !seek || seek.matches(':active')) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    seek.value = duration ? String(Math.round(video.currentTime / duration * 1000)) : '0';
    if ($('live-wallpaper-time')) $('live-wallpaper-time').textContent = `${clock(video.currentTime)} / ${clock(duration)}`;
}
async function updateLive(patch) {
    if (!live()) return;
    state.config.liveWallpaper = { ...state.config.liveWallpaper, ...patch };
    applyLiveWallpaperSettings();
    syncLiveControls();
    await saveConfig();
}
export const setLiveWallpaperRate = (value) => updateLive({ rate: Math.max(0.25, Math.min(2, Number(value) || 1)) });
function bindLiveControls() {
    $('live-wallpaper-toggle')?.addEventListener('click', () => updateLive({ paused: !live()?.paused }));
    $('live-wallpaper-volume')?.addEventListener('input', (event) => {
        if (!live()) return;
        state.config.liveWallpaper.volume = Number(event.target.value) / 100;
        applyLiveWallpaperSettings();
    });
    $('live-wallpaper-volume')?.addEventListener('change', () => saveConfig());
    $('live-wallpaper-seek')?.addEventListener('input', (event) => {
        const video = liveWallpaperVideo();
        if (video && Number.isFinite(video.duration)) video.currentTime = Number(event.target.value) / 1000 * video.duration;
    });
    // The progress display only runs while the Wallpaper page can be seen.
    setInterval(() => { if (live() && $('set-wallpaper')?.classList.contains('active') && !$('settings-window')?.classList.contains('hidden')) syncLiveProgress(); }, 500);
    window.addEventListener('macos-live-wallpaper-changed', syncLiveControls);
}

// ---- month browser ------------------------------------------------------------------
function syncMonthControls() {
    const now = today();
    const yearLabel = (year) => t('yearLabel', '{year} 年').replace('{year}', year);
    const years = []; for (let year = now.year; year >= FIRST_MONTH.year; year -= 1) years.push({ value: String(year), label: yearLabel(year) });
    const yearSelect = $('bing-year-select'); const monthSelect = $('bing-month-select');
    if (yearSelect) { yearSelect.dataset.options = JSON.stringify(years); yearSelect.dataset.value = String(shown.year); yearSelect.querySelector('.selected-text').textContent = yearLabel(shown.year); }
    if (monthSelect) {
        const options = [];
        for (let month = 1; month <= 12; month += 1) {
            if ((shown.year === FIRST_MONTH.year && month < FIRST_MONTH.month) || (shown.year === now.year && month > now.month)) continue;
            options.push({ value: String(month), label: t('monthLabel', '{month} 月').replace('{month}', month) });
        }
        monthSelect.dataset.options = JSON.stringify(options); monthSelect.dataset.value = String(shown.month);
        monthSelect.querySelector('.selected-text').textContent = t('monthLabel', '{month} 月').replace('{month}', shown.month);
    }
    const first = shown.year === FIRST_MONTH.year && shown.month === FIRST_MONTH.month;
    if ($('bing-month-prev')) $('bing-month-prev').disabled = first;
    if ($('bing-month-next')) $('bing-month-next').disabled = isCurrentMonth(shown.year, shown.month);
}
function clampMonth(year, month) {
    const now = today();
    let y = year; let m = month;
    if (y > now.year || (y === now.year && m > now.month)) { y = now.year; m = now.month; }
    if (y < FIRST_MONTH.year || (y === FIRST_MONTH.year && m < FIRST_MONTH.month)) { y = FIRST_MONTH.year; m = FIRST_MONTH.month; }
    return { year: y, month: m };
}
export async function showBingMonth(year, month) {
    const grid = $('bing-gallery-grid'); const status = $('bing-gallery-status');
    if (!grid) return;
    shown = clampMonth(year, month);
    syncMonthControls();
    const token = ++loadToken;
    if (status) status.textContent = t('loading', '正在载入…');
    let items = [];
    try { items = await fetchMonth(shown.year, shown.month); }
    catch {
        if (token !== loadToken) return;
        grid.replaceChildren(createElement('div', { className: 'bing-gallery-empty', text: t('bingArchiveFailed', '无法载入这个月的壁纸列表。请检查网络后重试。') }));
        if (status) status.textContent = '';
        return;
    }
    if (token !== loadToken) return;
    if (status) status.textContent = t('bingArchiveCount', '{count} 张').replace('{count}', items.length);
    if (!items.length) { grid.replaceChildren(createElement('div', { className: 'bing-gallery-empty', text: t('bingArchiveEmpty', '这个月还没有壁纸。') })); return; }
    grid.replaceChildren(...items.map((item) => {
        const tile = createElement('button', { className: 'bing-gallery-item', attrs: { type: 'button', title: `${titleFromId(item.id)} · ${item.date}` }, dataset: { id: item.id, date: item.date } });
        tile.append(createElement('img', { attrs: { src: bingThumbUrl(item.id), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' } }), createElement('span', { text: item.date.slice(5).replace('-', '/') }));
        return tile;
    }));
    markSelection();
}
function stepMonth(delta) {
    let { year, month } = shown;
    month += delta;
    if (month < 1) { month = 12; year -= 1; } else if (month > 12) { month = 1; year += 1; }
    showBingMonth(year, month);
}
export function selectBingYear(year) { showBingMonth(Number(year), shown?.month || 1); }
export function selectBingMonth(month) { showBingMonth(shown?.year || today().year, Number(month)); }

async function chooseArchiveWallpaper(id) {
    if (!IMAGE_ID.test(id)) return;
    const url = bingImageUrl(id);
    if (!(await downloadWallpaper(url))) return; // a newer choice took over
    const modes = targetModes();
    setPicture(modes, url);
    await Promise.all(modes.map((mode) => cacheWallpaperForFirstPaint(mode, url)));
    await commit();
}

/** Daily Bing picture switched on or off. Switching on downloads today's picture first. */
export async function setBingDailyWallpaper(enabled) {
    if (enabled) {
        const url = await resolveBingDailyWallpaper();
        if (url) await downloadWallpaper(url);
    }
    state.config.useBingWallpaper = Boolean(enabled);
    if (enabled) stopLive();
    await commit();
}

/** Removes a picture or video from the library; a live wallpaper that was playing gives way to the default. */
export const removeWallpaperItem = (id) => removeFromLibrary(id);

let bound = false;
export function bindWallpaperSettings() {
    if (bound) return; bound = true;
    $('bing-month-prev')?.addEventListener('click', () => stepMonth(-1));
    $('bing-month-next')?.addEventListener('click', () => stepMonth(1));
    $('bing-gallery-grid')?.addEventListener('click', (event) => {
        const tile = event.target.closest('.bing-gallery-item');
        if (tile) chooseArchiveWallpaper(tile.dataset.id);
    });
    bindLibraryGrid('wallpaper-video-grid', 'wallpaper-add-video', 'video');
    bindLibraryGrid('wallpaper-photo-grid', 'wallpaper-add-photo', 'photo');
    bindLiveControls();
    $('reset-bg-btn')?.addEventListener('click', () => restoreDefaultWallpaper());
    $('wallpaper-scope')?.addEventListener('click', (event) => { const button = event.target.closest('[data-scope]'); if (button) setScope(button.dataset.scope); });
    document.querySelectorAll('.wallpaper-preview-item').forEach((item) => item.addEventListener('click', () => setScope(item.dataset.mode)));
    renderLibrary();
    window.addEventListener('macos-appearance-change', renderWallpaperSettings);
    window.addEventListener('macos-language-change', () => { if (shown) syncMonthControls(); renderWallpaperSettings(); });
    // The browser loads its first month when the wallpaper settings first come into view.
    window.addEventListener('macos-window-visibility-changed', (event) => {
        if (event.detail?.element?.id !== 'settings-window' || !event.detail.visible) return;
        renderWallpaperSettings();
        if (!monthLoaded) { monthLoaded = true; loadLibrary(); showBingMonth(shown.year, shown.month); }
    });
    const now = today();
    shown = clampMonth(now.year, now.month);
    syncMonthControls();
}
