import { state } from './state.js';
import { saveConfig } from './config.js';
import { getAppName, t } from './i18n.js';
import { createAppIcon } from './icons.js';
import { $, createElement, navigateTo, normalizeUrl } from './utils.js';
import { showMacAlert, showMacConfirm, showMacPrompt } from './dialog.js';
import { devFlag, extraFeaturesDisabled, launcherAvailable } from './developer.js';
import { bringManagedWindowToFront } from './window-manager.js';

const FALLBACK_TRASH_EMPTY = 'assets/icons/废纸篓.svg';
const FALLBACK_TRASH_FULL = 'assets/icons/trash.full.svg';


function notifyTrashChanged(detail = {}) {
    hideTrashContextMenu();
    // Trash is a live view. Adding/removing an entry must update an already-open Finder
    // window immediately, not only after reopening it.
    try { renderTrashFinder(); } catch {}
    window.dispatchEvent(new CustomEvent('macos-trash-updated', { detail }));
}

export function moveAppToTrash(app, source = 'desk', originalIndex = -1) {
    if (!app) return false;
    state.config.trashItems ||= [];
    state.config.trashItems.unshift({
        id: `trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source,
        originalIndex: Number.isInteger(originalIndex) ? originalIndex : -1,
        deletedAt: Date.now(),
        app: structuredClone(app)
    });
    state.config.trashItems = state.config.trashItems.slice(0, 200);
    notifyTrashChanged({ added: state.config.trashItems[0] });
    return true;
}

function trashAsset(full = false, dark = false) {
    if (full) return dark ? 'assets/images/trashfull2.png' : 'assets/images/trashfull.png';
    return dark ? 'assets/images/trashempty2.png' : 'assets/images/trashempty.png';
}

function makeUtilityIcon(src, className, title, fallback = FALLBACK_TRASH_EMPTY) {
    const item = createElement('div', { className: `dock-item ${className}`, attrs: { 'data-title': title, draggable: 'false' } });
    const icon = createElement('div', { className: 'dock-icon' });
    const img = createElement('img', { attrs: { src, alt: '' } });
    img.addEventListener('error', () => {
        if (img.dataset.fallbackApplied === '1') return;
        img.dataset.fallbackApplied = '1';
        img.src = fallback;
    });
    icon.appendChild(img);
    item.appendChild(icon);
    return item;
}

export function createDockUtilities() {
    const fragment = document.createDocumentFragment();
    const separator = createElement('div', { className: 'dock-separator', attrs: { id: 'dock-resize-separator', title: t('dockResizeHint', '拖动调整程序坞大小') } });
    fragment.appendChild(separator);

    (state.config.dockFolders || []).forEach((folder, index) => {
        const item = createElement('div', {
            className: 'dock-item dock-folder-item',
            attrs: { draggable: 'true', 'data-title': getAppName(folder) || t('folder', '文件夹') },
            dataset: { kind: 'folder', folderIndex: index }
        });
        const icon = createElement('div', { className: 'dock-icon dock-folder-icon' });
        const img = createElement('img', { attrs: { src: 'assets/images/Folder.png', alt: '' } });
        img.addEventListener('error', () => { img.src = 'assets/icons/folder.svg'; });
        icon.appendChild(img);
        item.appendChild(icon);
        fragment.appendChild(item);
    });

    const full = Boolean(state.config.trashItems?.length);
    const dark = state.effectiveTheme === 'dark' || document.body.classList.contains('dark-mode');
    const trash = makeUtilityIcon(trashAsset(full, dark), 'dock-trash-item', t('trash', '废纸篓'), full ? FALLBACK_TRASH_FULL : FALLBACK_TRASH_EMPTY);
    trash.dataset.kind = 'trash';
    trash.dataset.trashState = full ? 'full' : 'empty';
    trash.dataset.dropLabel = t('moveToTrash', '移到废纸篓');
    fragment.appendChild(trash);
    return fragment;
}

function targetForTrashSource(source) {
    if (source === 'desk') return state.config.desktopApps;
    if (source === 'dock') return state.config.dockApps;
    if (source === 'lp' || source === 'launchpad') return state.config.launchpadApps;
    if (source === 'folder') return state.config.dockFolders;
    if (source === 'sl' || source === 'spotlight') return state.config.quickLinks;
    return null;
}

export async function restoreTrashEntry(id) {
    const items = state.config.trashItems || [];
    const index = items.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const [entry] = items.splice(index, 1);
    const target = targetForTrashSource(entry.source);
    if (!target) { items.splice(index, 0, entry); return false; }
    const at = Number.isInteger(entry.originalIndex) && entry.originalIndex >= 0 ? Math.min(entry.originalIndex, target.length) : target.length;
    target.splice(at, 0, structuredClone(entry.app));
    await saveConfig();
    notifyTrashChanged({ restored: entry });
    return true;
}


async function emptyTrashWithConfirm() {
    if (!(state.config.trashItems || []).length) return false;
    const confirmed = await showMacConfirm(t('emptyTrashQuestion', '确定要永久清倒废纸篓中的项目吗？'), {
        title: t('emptyTrashTitle', '清倒废纸篓？'),
        detail: t('emptyTrashWarning', '此操作无法撤销。'),
        confirmLabel: t('emptyTrash', '清倒'),
        cancelLabel: t('cancel', '取消'),
        danger: true,
        icon: trashAsset(true, state.effectiveTheme === 'dark' || document.body.classList.contains('dark-mode'))
    });
    if (!confirmed) return false;
    state.config.trashItems = [];
    selectedTrashId = null;
    await saveConfig();
    notifyTrashChanged();
    return true;
}

async function permanentlyDeleteTrashEntry(id) {
    const entry = (state.config.trashItems || []).find((item) => item.id === id);
    if (!entry) return false;
    const confirmed = await showMacConfirm(t('deletePermanentlyQuestion', '确定要永久删除“{name}”吗？').replace('{name}', getAppName(entry.app) || t('untitled', '未命名')), {
        title: t('deletePermanently', '彻底删除'),
        detail: t('emptyTrashWarning', '此操作无法撤销。'),
        confirmLabel: t('deletePermanently', '彻底删除'),
        cancelLabel: t('cancel', '取消'),
        danger: true
    });
    if (!confirmed) return false;
    state.config.trashItems = (state.config.trashItems || []).filter((item) => item.id !== id);
    if (selectedTrashId === id) selectedTrashId = null;
    await saveConfig();
    notifyTrashChanged();
    return true;
}

function contextItem(label, action, { danger = false, disabled = false } = {}) {
    const button = createElement('button', { className: `widget-context-item${danger ? ' danger' : ''}`, attrs: { type: 'button', disabled: disabled ? '' : undefined }, dataset: { action } });
    button.appendChild(createElement('span', { className: 'widget-context-label', text: label }));
    return button;
}

export function hideTrashContextMenu() {
    $('trash-context-menu')?.classList.add('hidden');
}

function showTrashContextMenu(event, kind, id = '') {
    const menu = $('trash-context-menu');
    if (!menu) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Context menus are mutually exclusive. A desktop menu left open before entering
    // Trash must not remain underneath the Trash menu.
    document.querySelectorAll('#desktop-context-menu,#widget-context-menu,.floating-context-submenu').forEach((node) => {
        if (node.classList) node.classList.add('hidden'); else node.remove();
    });
    document.querySelectorAll('.floating-context-submenu').forEach((node) => node.remove());
    menu.dataset.kind = kind;
    menu.dataset.trashId = id;
    const hasItems = Boolean(state.config.trashItems?.length);
    if (kind === 'favorite') {
        menu.replaceChildren(contextItem(t('open', '打开'), 'favorite-open'), createElement('div', { className: 'widget-context-separator' }), contextItem(t('finderRemoveFromSidebar', '从边栏中移除'), 'favorite-remove', { danger: true }));
    } else if (kind === 'dock') {
        menu.replaceChildren(
            contextItem(t('open', '打开'), 'trash-open'),
            contextItem(t('emptyTrash', '清空回收站'), 'trash-empty', { danger: true, disabled: !hasItems })
        );
    } else if (kind === 'app') {
        const entry = finderEntries().find((item) => item.id === id);
        menu.replaceChildren(
            contextItem(t('open', '打开'), 'finder-open'),
            ...(entry?.app?.url && /^https?:/i.test(entry.app.url) ? [contextItem(t('finderAddToSidebar', '添加到边栏'), 'finder-pin')] : []),
            createElement('div', { className: 'widget-context-separator' }),
            contextItem(t('moveToTrash', '移到废纸篓'), 'finder-trash', { danger: true, disabled: !entry || isLockedApp(entry.app) })
        );
    } else {
        menu.replaceChildren(
            contextItem(t('restoreToOriginal', '还原'), 'trash-restore'),
            contextItem(t('deletePermanently', '彻底删除'), 'trash-delete-permanently', { danger: true }),
            createElement('div', { className: 'widget-context-separator' }),
            contextItem(t('emptyTrash', '清空回收站'), 'trash-empty', { danger: true, disabled: !hasItems })
        );
    }
    menu.classList.remove('hidden');
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(30, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
}

let selectedTrashId = null;

// ---------------------------------------------------------------------------------
// Finder window. One window browses the launcher collections and the Trash.
// ---------------------------------------------------------------------------------
const FINDER_VIEW_KEY = 'macOS_finder_view';
const FINDER_LOCATIONS = [
    { id: 'applications', labelKey: 'finderApplications', label: '应用程序', icon: 'applications', list: () => state.config.launchpadApps, source: 'lp' },
    { id: 'desktop', labelKey: 'finderDesktop', label: '桌面', icon: 'desktop', list: () => state.config.desktopApps, source: 'desk' },
    { id: 'dock', labelKey: 'finderDock', label: '程序坞', icon: 'dock', list: () => state.config.dockApps, source: 'dock' },
    { id: 'downloads', labelKey: 'dockDownloads', label: '下载', icon: 'downloads', url: 'chrome://downloads/' },
    { id: 'bookmarks', labelKey: 'finderBookmarks', label: '书签', icon: 'bookmarks', url: 'chrome://bookmarks/' },
    { id: 'trash', labelKey: 'trash', label: '废纸篓', icon: 'trash' }
];
const finder = { location: 'trash', history: ['trash'], cursor: 0, query: '', view: 'icons' };
try { finder.view = localStorage.getItem(FINDER_VIEW_KEY) === 'list' ? 'list' : 'icons'; } catch { /* default */ }

const finderLocation = (id = finder.location) => FINDER_LOCATIONS.find((item) => item.id === id) || FINDER_LOCATIONS.at(-1);
const locationLabel = (location) => t(location.labelKey, location.label);
function isLockedApp(app) {
    if (devFlag('allowSystemIconEditing')) return false;
    return Boolean(app?.protected || app?.isSystem);
}
function appKind(app) {
    if (typeof app?.action === 'string' && app.action.startsWith('pluginApp:')) return t('finderKindApplication', '应用程序');
    if (app?.action) return t('finderKindSystem', '系统项目');
    return t('finderKindWebLink', '网页位置');
}
function formatDate(value) {
    const time = Number(value) || 0;
    if (!time) return '—';
    try { return new Date(time).toLocaleDateString(state.config.language || 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return '—'; }
}
// Everything shown in the current location, as { id, app, name, kind, date, ... }.
function finderEntries() {
    const location = finderLocation();
    let entries;
    if (location.id === 'trash') {
        entries = (state.config.trashItems || []).map((item) => ({ id: item.id, app: item.app, name: getAppName(item.app) || t('untitled', '未命名'), kind: appKind(item.app), date: item.deletedAt, trash: true }));
    } else {
        entries = (location.list?.() || []).map((app, index) => ({ id: `${location.id}:${index}`, app, index, name: getAppName(app) || t('untitled', '未命名'), kind: appKind(app), date: app.addedAt }));
    }
    entries = entries.filter((entry) => launcherAvailable(entry.app));
    const query = finder.query.trim().toLocaleLowerCase();
    return query ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) : entries;
}

function goToLocation(id, { record = true } = {}) {
    const location = finderLocation(id);
    if (location.url) { navigateTo(location.url); return; }
    if (record && location.id !== finder.location) {
        finder.history = finder.history.slice(0, finder.cursor + 1);
        finder.history.push(location.id);
        finder.cursor = finder.history.length - 1;
    }
    finder.location = location.id;
    finder.query = '';
    if ($('finder-search')) $('finder-search').value = '';
    selectedTrashId = null;
    renderTrashFinder();
}

function renderFinderSidebar() {
    const host = $('finder-sidebar');
    if (!host) return;
    const favorites = (state.config.finderFavorites || []).map((favorite, index) => {
        const row = createElement('div', { className: 'finder-side-item finder-side-favorite', dataset: { favorite: index }, attrs: { role: 'button', title: favorite.url } });
        const icon = createElement('span', { className: 'finder-side-icon finder-side-favicon' });
        icon.appendChild(createAppIcon({ name: favorite.name, url: favorite.url, useBg: false }, { location: 'settings' }));
        row.append(icon, createElement('span', { className: 'finder-side-name', text: favorite.name }));
        return row;
    });
    const add = createElement('div', { className: 'finder-side-item finder-side-add', dataset: { favoriteAdd: '1' }, attrs: { role: 'button' } });
    add.append(createElement('span', { className: 'finder-side-icon finder-side-plus', text: '+' }), createElement('span', { text: t('finderAddWebPage', '添加网页…') }));
    host.replaceChildren(...FINDER_LOCATIONS.map((location) => {
        const row = createElement('div', { className: `finder-side-item${location.id === finder.location ? ' active' : ''}`, dataset: { location: location.id }, attrs: { role: 'button' } });
        row.append(createElement('img', { className: 'finder-side-icon', attrs: { src: `assets/ui/finder/${location.icon}.svg`, alt: '' } }), createElement('span', { text: locationLabel(location) }));
        if (location.url) row.appendChild(createElement('span', { className: 'finder-side-external', text: '↗' }));
        return row;
    }), createElement('div', { className: 'finder-side-section-label', text: t('finderWebPages', '网页') }), ...favorites, add);
}

// Web pages the user pinned to the sidebar.
async function pinFavorite(name, url) {
    const clean = normalizeUrl(url, { allowInternal: false });
    if (!clean) return false;
    state.config.finderFavorites ||= [];
    if (!state.config.finderFavorites.some((item) => item.url === clean)) state.config.finderFavorites.push({ name: String(name || '').trim().slice(0, 80) || new URL(clean).hostname.replace(/^www\./, ''), url: clean });
    await saveConfig();
    renderFinderSidebar();
    return true;
}
async function addFavoriteInteractively() {
    const url = await showMacPrompt(t('finderFavoriteUrlPrompt', '要固定到边栏的网页地址：'), { title: t('finderAddWebPage', '添加网页…').replace('…', ''), placeholder: 'https://example.com', confirmLabel: t('continue', '继续') });
    if (url == null) return;
    const clean = normalizeUrl(url, { allowInternal: false });
    if (!clean) { await showMacAlert(t('invalidUrl', '请输入有效的名称和网址'), { title: t('error', '错误') }); return; }
    const host = new URL(clean).hostname.replace(/^www\./, '');
    const name = await showMacPrompt(t('finderFavoriteNamePrompt', '在边栏中显示的名称：'), { title: host, value: host });
    if (name != null) await pinFavorite(name, clean);
}
async function removeFavorite(index) {
    (state.config.finderFavorites || []).splice(index, 1);
    await saveConfig();
    renderFinderSidebar();
}

export function renderTrashFinder() {
    const grid = $('trash-finder-grid');
    const status = $('trash-finder-status');
    const emptyButton = $('trash-empty-btn');
    const restoreButton = $('trash-restore-btn');
    if (!grid) return;
    const location = finderLocation();
    const inTrash = location.id === 'trash';
    const entries = finderEntries();
    if (selectedTrashId && !entries.some((entry) => entry.id === selectedTrashId)) selectedTrashId = null;

    renderFinderSidebar();
    if ($('finder-title')) $('finder-title').textContent = locationLabel(location);
    if ($('finder-back')) $('finder-back').disabled = finder.cursor <= 0;
    if ($('finder-forward')) $('finder-forward').disabled = finder.cursor >= finder.history.length - 1;
    $('finder-view-icons')?.classList.toggle('active', finder.view === 'icons');
    $('finder-view-list')?.classList.toggle('active', finder.view === 'list');
    if ($('finder-pathbar')) {
        $('finder-pathbar').replaceChildren(
            createElement('img', { attrs: { src: 'assets/images/Internal.png', alt: '' } }), createElement('span', { text: 'Macintosh HD' }), createElement('span', { className: 'finder-path-arrow', text: '›' }),
            createElement('img', { attrs: { src: `assets/ui/finder/${location.icon}.svg`, alt: '' } }), createElement('span', { text: locationLabel(location) })
        );
    }

    grid.classList.toggle('list-view', finder.view === 'list');
    grid.replaceChildren();
    if (!entries.length) {
        grid.appendChild(createElement('div', { className: 'trash-empty-message', text: finder.query ? t('finderNoResults', '没有找到结果') : (inTrash ? t('trashEmpty', '废纸篓为空') : t('finderEmptyFolder', '此文件夹为空')) }));
    } else if (finder.view === 'list') {
        const header = createElement('div', { className: 'finder-list-header' });
        header.append(createElement('span', { text: t('finderColName', '名称') }), createElement('span', { text: t('finderColKind', '种类') }), createElement('span', { text: inTrash ? t('finderColDeleted', '删除日期') : t('finderColAdded', '添加日期') }));
        grid.appendChild(header);
        entries.forEach((entry) => {
            const row = createElement('div', { className: `trash-file-tile finder-list-row${selectedTrashId === entry.id ? ' selected' : ''}`, dataset: { trashId: entry.id } });
            const name = createElement('div', { className: 'finder-list-name' });
            const icon = createElement('div', { className: 'finder-list-icon' });
            icon.appendChild(createAppIcon(entry.app, { location: 'settings' }));
            name.append(icon, createElement('span', { text: entry.name }));
            row.append(name, createElement('span', { className: 'finder-list-cell', text: entry.kind }), createElement('span', { className: 'finder-list-cell', text: formatDate(entry.date) }));
            grid.appendChild(row);
        });
    } else {
        entries.forEach((entry) => {
            const tile = createElement('div', { className: `trash-file-tile${selectedTrashId === entry.id ? ' selected' : ''}`, dataset: { trashId: entry.id } });
            const icon = createElement('div', { className: 'trash-file-icon' });
            icon.appendChild(createAppIcon(entry.app, { location: 'settings' }));
            tile.append(icon, createElement('div', { className: 'trash-file-name', text: entry.name }));
            grid.appendChild(tile);
        });
    }
    const selected = entries.find((entry) => entry.id === selectedTrashId);
    if (status) {
        const count = t('trashCount', '{count} 个项目').replace('{count}', String(entries.length));
        status.textContent = selected ? `${t('finderSelected', '已选择“{name}”').replace('{name}', selected.name)} · ${count}` : count;
    }
    if (emptyButton) { emptyButton.hidden = !inTrash; emptyButton.disabled = !(state.config.trashItems || []).length; }
    if (restoreButton) { restoreButton.hidden = !inTrash; restoreButton.disabled = !selected; }
}

export function openFinder(locationId = 'applications') {
    const win = $('trash-window');
    if (!win) return;
    const wasHidden = win.classList.contains('hidden');
    const wasMinimized = win.dataset.minimized === '1';
    goToLocation(locationId);
    win.classList.remove('hidden');
    if (wasHidden && !wasMinimized && win.dataset.maximized !== '1') {
        const rect = win.getBoundingClientRect();
        win.style.left = `${Math.max(0, Math.round((window.innerWidth - (rect.width || 900)) / 2))}px`;
        win.style.top = `${Math.max(26, Math.round((window.innerHeight - (rect.height || 560)) / 2))}px`;
    }
    bringManagedWindowToFront(win);
}
function setFinderView(view) {
    finder.view = view === 'list' ? 'list' : 'icons';
    try { localStorage.setItem(FINDER_VIEW_KEY, finder.view); } catch { /* preference only */ }
    renderTrashFinder();
}
/** Finder's own menus in the menu bar (see app-menu.js). */
export function finderMenus() {
    return [
        { title: t('view', '显示'), items: [
            { label: t('finderAsIcons', '为图标'), checked: finder.view === 'icons', run: () => setFinderView('icons') },
            { label: t('finderAsList', '为列表'), checked: finder.view === 'list', run: () => setFinderView('list') }
        ] },
        { title: t('finderGo', '前往'), items: FINDER_LOCATIONS.map((location) => ({ label: locationLabel(location), checked: !location.url && location.id === finder.location, run: () => goToLocation(location.id) })) }
    ];
}
export function openTrashFinder() { openFinder('trash'); }

function openFinderEntry(entry) {
    if (!entry) return;
    if (entry.trash) { restoreTrashEntry(entry.id); return; }
    window.dispatchEvent(new CustomEvent('macos-finder-open-app', { detail: { app: entry.app } }));
}
async function trashFinderEntry(entry) {
    const location = finderLocation();
    if (!entry || entry.trash || isLockedApp(entry.app) || !location.list) return;
    const list = location.list();
    const index = list.indexOf(entry.app);
    if (index < 0) return;
    const [removed] = list.splice(index, 1);
    moveAppToTrash(removed, location.source, index);
    await saveConfig();
}

export function bindTrashFinderEvents() {
    const grid = $('trash-finder-grid');
    grid?.addEventListener('click', (event) => {
        const tile = event.target.closest('.trash-file-tile');
        selectedTrashId = tile?.dataset.trashId || null;
        // Restyle in place so the tile under the pointer survives for a double click.
        grid.querySelectorAll('.trash-file-tile').forEach((node) => node.classList.toggle('selected', node === tile));
        const entries = finderEntries(); const selected = entries.find((entry) => entry.id === selectedTrashId);
        if ($('trash-restore-btn')) $('trash-restore-btn').disabled = !selected;
        const count = t('trashCount', '{count} 个项目').replace('{count}', String(entries.length));
        if ($('trash-finder-status')) $('trash-finder-status').textContent = selected ? `${t('finderSelected', '已选择“{name}”').replace('{name}', selected.name)} · ${count}` : count;
    });
    grid?.addEventListener('dblclick', (event) => {
        const tile = event.target.closest('.trash-file-tile');
        if (tile) openFinderEntry(finderEntries().find((entry) => entry.id === tile.dataset.trashId));
    });
    $('finder-sidebar')?.addEventListener('click', (event) => {
        if (event.target.closest('[data-favorite-add]')) return addFavoriteInteractively();
        const favorite = event.target.closest('[data-favorite]');
        if (favorite) return navigateTo(state.config.finderFavorites?.[Number(favorite.dataset.favorite)]?.url || '');
        const row = event.target.closest('[data-location]');
        if (row) goToLocation(row.dataset.location);
    });
    $('finder-back')?.addEventListener('click', () => { if (finder.cursor > 0) { finder.cursor -= 1; goToLocation(finder.history[finder.cursor], { record: false }); } });
    $('finder-forward')?.addEventListener('click', () => { if (finder.cursor < finder.history.length - 1) { finder.cursor += 1; goToLocation(finder.history[finder.cursor], { record: false }); } });
    $('finder-view-icons')?.addEventListener('click', () => setFinderView('icons'));
    $('finder-view-list')?.addEventListener('click', () => setFinderView('list'));
    $('finder-search')?.addEventListener('input', (event) => { finder.query = event.currentTarget.value || ''; renderTrashFinder(); });
    $('trash-restore-btn')?.addEventListener('click', async () => {
        if (selectedTrashId) await restoreTrashEntry(selectedTrashId);
    });
    $('trash-empty-btn')?.addEventListener('click', () => emptyTrashWithConfirm());
    window.addEventListener('macos-language-change', () => { if (!$('trash-window')?.classList.contains('hidden')) renderTrashFinder(); });

    document.addEventListener('contextmenu', (event) => {
        const dockTrash = event.target.closest?.('.dock-trash-item');
        if (dockTrash) return showTrashContextMenu(event, 'dock');
        const favorite = event.target.closest?.('#finder-sidebar [data-favorite]');
        if (favorite) return showTrashContextMenu(event, 'favorite', favorite.dataset.favorite);
        const tile = event.target.closest?.('#trash-finder-grid .trash-file-tile');
        if (tile) {
            selectedTrashId = tile.dataset.trashId || null;
            renderTrashFinder();
            return showTrashContextMenu(event, finderLocation().id === 'trash' ? 'item' : 'app', selectedTrashId || '');
        }
    });
    $('trash-context-menu')?.addEventListener('click', async (event) => {
        const item = event.target.closest('[data-action]');
        if (!item || item.disabled) return;
        const menu = $('trash-context-menu');
        const action = item.dataset.action;
        const id = menu?.dataset.trashId || '';
        hideTrashContextMenu();
        if (action === 'trash-open') openTrashFinder();
        else if (action === 'trash-empty') await emptyTrashWithConfirm();
        else if (action === 'trash-restore' && id) await restoreTrashEntry(id);
        else if (action === 'trash-delete-permanently' && id) await permanentlyDeleteTrashEntry(id);
        else if (action === 'favorite-open') navigateTo(state.config.finderFavorites?.[Number(id)]?.url || '');
        else if (action === 'favorite-remove') await removeFavorite(Number(id));
        else if (action === 'finder-pin') { const entry = finderEntries().find((item) => item.id === id); if (entry?.app?.url) await pinFavorite(entry.name, entry.app.url); }
        else if (action === 'finder-open') openFinderEntry(finderEntries().find((entry) => entry.id === id));
        else if (action === 'finder-trash') await trashFinderEntry(finderEntries().find((entry) => entry.id === id));
    });
    const closeWhenOutside = (event) => {
        if (!event.target?.closest?.('#trash-context-menu')) hideTrashContextMenu();
    };
    document.addEventListener('pointerdown', closeWhenOutside, true);
    document.addEventListener('mousedown', closeWhenOutside, true);
    document.addEventListener('wheel', hideTrashContextMenu, { capture: true, passive: true });
    window.addEventListener('blur', hideTrashContextMenu);
    window.addEventListener('resize', hideTrashContextMenu);
    window.addEventListener('macos-managed-window-drag', (event) => { if (event.detail?.active) hideTrashContextMenu(); });
}
