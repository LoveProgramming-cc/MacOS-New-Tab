// The desktop's context menu and sorting its icons.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { getAppName, t } from './i18n.js';
import { isProtectedApp, renderDesktopIcons, renderDock, renderSettingsLists } from './render.js';
import { $ } from './utils.js';
import { closeGlassSelectMenu } from './glass-select.js';
import { hideTrashContextMenu, moveAppToTrash } from './trash.js';
import { resolveDesktopIconPosition } from './desktop-layout.js';
import { extraFeaturesDisabled } from './developer.js';
import { openWindow } from './events.js';
import { activateSettingsTab } from './events-settings.js';

let desktopContextAppIndex = null;
let desktopFloatingSubmenu = null;
function desktopSortLabel(mode) {
    return {
        added: t('sortAdded', '按添加时间'),
        accessed: t('sortAccessed', '按访问时间'),
        name: t('sortName', '名称'),
        nameDesc: t('sortNameDesc', '名称（逆序）')
    }[mode] || mode;
}

function layoutSortedDesktopApps() {
    const apps = state.config.desktopApps || [];
    apps.forEach((app) => { delete app.cx; delete app.cy; });
    const stepX = 90, stepY = 110;
    const top = 44;
    const rows = Math.max(1, Math.floor((window.innerHeight - top - Math.max(100, Number(state.config.dock?.size || 56) + 46)) / stepY));
    apps.forEach((app, index) => {
        const row = index % rows;
        const col = Math.floor(index / rows);
        const left = Math.max(8, window.innerWidth - 88 - col * stepX);
        const requestedCx = left - window.innerWidth / 2;
        const requestedCy = top + row * stepY - window.innerHeight / 2;
        const resolved = resolveDesktopIconPosition(requestedCx, requestedCy, index);
        app.cx = resolved.cx;
        app.cy = resolved.cy;
    });
}

async function sortDesktopApps(mode) {
    const apps = state.config.desktopApps || [];
    if (mode === 'added') apps.sort((a,b) => (Number(a.addedAt)||0) - (Number(b.addedAt)||0));
    if (mode === 'accessed') apps.sort((a,b) => (Number(b.lastAccessedAt)||0) - (Number(a.lastAccessedAt)||0));
    if (mode === 'name' || mode === 'nameDesc') {
        apps.sort((a,b) => getAppName(a).localeCompare(getAppName(b), state.config.language || undefined, { numeric: true, sensitivity: 'base' }));
        if (mode === 'nameDesc') apps.reverse();
    }
    state.config.desktop.sortMode = mode;
    layoutSortedDesktopApps();
    await saveConfig();
    renderDesktopIcons();
}

function desktopMenuItem(label, action, { selected = false, hasSubmenu = false } = {}) {
    const item = document.createElement(hasSubmenu ? 'div' : 'button');
    item.className = `widget-context-item${selected ? ' selected' : ''}${hasSubmenu ? ' widget-context-has-submenu' : ''}`;
    if (!hasSubmenu) item.type = 'button';
    item.dataset.action = action;
    const text = document.createElement('span');
    text.className = 'widget-context-label';
    text.textContent = label;
    item.appendChild(text);
    if (hasSubmenu) {
        const arrow = document.createElement('span');
        arrow.className = 'widget-context-chevron';
        arrow.textContent = '›';
        item.appendChild(arrow);
    }
    return item;
}

export function closeDesktopFloatingSubmenu() {
    desktopFloatingSubmenu?.remove();
    desktopFloatingSubmenu = null;
}

function openDesktopSortSubmenu(row) {
    closeDesktopFloatingSubmenu();
    const submenu = document.createElement('div');
    submenu.className = 'widget-context-submenu floating-context-submenu mac-acrylic window-shadow';
    ['added','accessed','name','nameDesc'].forEach((mode) => {
        submenu.appendChild(desktopMenuItem(desktopSortLabel(mode), `desktop-sort:${mode}`, { selected: state.config.desktop?.sortMode === mode }));
    });
    document.body.appendChild(submenu);
    const rowRect = row.getBoundingClientRect();
    const rect = submenu.getBoundingClientRect();
    const left = rowRect.right + rect.width <= window.innerWidth - 8 ? rowRect.right - 3 : rowRect.left - rect.width + 3;
    submenu.style.left = `${Math.max(8, left)}px`;
    submenu.style.top = `${Math.max(28, Math.min(rowRect.top, window.innerHeight - rect.height - 8))}px`;
    submenu.addEventListener('click', async (event) => {
        const item = event.target.closest('[data-action^="desktop-sort:"]');
        if (!item) return;
        event.stopPropagation();
        $('desktop-context-menu')?.classList.add('hidden');
        closeDesktopFloatingSubmenu();
        await sortDesktopApps(item.dataset.action.split(':')[1]);
    });
    desktopFloatingSubmenu = submenu;
}

function positionDesktopContextMenu(menu, clientX, clientY) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(30, Math.min(clientY, window.innerHeight - rect.height - 8))}px`;
}

function showDesktopContextMenu(event) {
    // The desktop menu belongs to the desktop only — never to an application window,
    // a dialog or another menu that happens to sit on top of it.
    if (!event.target?.closest || event.target.closest('.window,.plugin-app-window,.plugin-context-menu,.app-notification,.mac-dialog-overlay,#dock-shell,#launchpad,#menu-bar,.widget-card,#widget-center,#widget-gallery,.dropdown-menu,.widget-context-menu')) return;
    const menu = $('desktop-context-menu');
    if (!menu) return;
    event.preventDefault();
    hideTrashContextMenu();
    $('widget-context-menu')?.classList.add('hidden');
    closeGlassSelectMenu();
    closeDesktopFloatingSubmenu();

    const desktopItem = event.target.closest('.desk-item');
    if (desktopItem) {
        const index = Number(desktopItem.dataset.index);
        const app = state.config.desktopApps?.[index];
        if (!app) return;
        desktopContextAppIndex = index;
        menu.dataset.context = 'desktop-app';
        const editItem = desktopMenuItem(t('edit', '编辑'), 'desktop-app-edit');
        const deleteItem = desktopMenuItem(t('btnDelete', '删除'), 'desktop-app-delete');
        if (isProtectedApp(app, 'desk')) {
            deleteItem.disabled = true;
            deleteItem.classList.add('disabled');
        } else {
            deleteItem.classList.add('danger');
        }
        menu.replaceChildren(editItem, deleteItem);
        menu.classList.remove('hidden');
        positionDesktopContextMenu(menu, event.clientX, event.clientY);
        return;
    }

    desktopContextAppIndex = null;
    menu.dataset.context = 'desktop';
    const sortRow = desktopMenuItem(t('sortBy', '排序'), 'desktop-sort', { hasSubmenu: true });
    const openSort = (ev) => {
        ev?.stopPropagation?.();
        openDesktopSortSubmenu(sortRow);
    };
    sortRow.addEventListener('mouseenter', openSort);
    sortRow.addEventListener('pointerenter', openSort);
    sortRow.addEventListener('click', openSort);
    const separator = document.createElement('div');
    separator.className = 'widget-context-separator';
    menu.replaceChildren(
        desktopMenuItem(t('changeWallpaper', '更改墙纸'), 'desktop-wallpaper'),
        // Widgets are an extra feature; with extra features disabled there is nothing to configure.
        ...(extraFeaturesDisabled(state.config) ? [] : [desktopMenuItem(t('configureWidgets', '设置小组件'), 'desktop-widgets')]),
        separator,
        desktopMenuItem(t('snapToGrid', '跟网格对齐'), 'desktop-snap', { selected: state.config.desktop?.snapToGrid !== false }),
        sortRow
    );
    menu.classList.remove('hidden');
    positionDesktopContextMenu(menu, event.clientX, event.clientY);
}

export function bindDesktopContextMenu() {
    document.addEventListener('contextmenu', showDesktopContextMenu);
    $('desktop-context-menu')?.addEventListener('click', async (event) => {
        const item = event.target.closest('[data-action]');
        if (!item) return;
        const action = item.dataset.action || '';
        if (action === 'desktop-app-edit') {
            $('desktop-context-menu').classList.add('hidden');
            const index = desktopContextAppIndex;
            openWindow('settings-window');
            activateSettingsTab('set-desktop');
            requestAnimationFrame(() => {
                const row = document.querySelector(`#desk-edit-list .edit-row[data-index="${index}"]`);
                row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                row?.classList.add('context-edit-highlight');
                setTimeout(() => row?.classList.remove('context-edit-highlight'), 1200);
            });
            desktopContextAppIndex = null;
        } else if (action === 'desktop-app-delete') {
            const index = desktopContextAppIndex;
            const app = state.config.desktopApps?.[index];
            $('desktop-context-menu').classList.add('hidden');
            desktopContextAppIndex = null;
            if (!app || isProtectedApp(app, 'desk')) return;
            const [removed] = state.config.desktopApps.splice(index, 1);
            moveAppToTrash(removed, 'desk', index);
            await saveConfig();
            renderDesktopIcons();
            renderDock();
            renderSettingsLists();
            window.dispatchEvent(new CustomEvent('macos-trash-updated'));
        } else if (action === 'desktop-wallpaper') {
            $('desktop-context-menu').classList.add('hidden');
            openWindow('settings-window'); activateSettingsTab('set-wallpaper');
        } else if (action === 'desktop-widgets') {
            $('desktop-context-menu').classList.add('hidden');
            $('widget-edit-btn')?.click();
        } else if (action === 'desktop-snap') {
            state.config.desktop.snapToGrid = state.config.desktop.snapToGrid === false;
            await saveConfig();
            if ($('desktop-snap-toggle')) $('desktop-snap-toggle').checked = state.config.desktop.snapToGrid;
            showDesktopContextMenu({ ...event, target: document.body, clientX: event.clientX, clientY: event.clientY, preventDefault(){}, stopPropagation(){} });
        } else if (action.startsWith('desktop-sort:')) {
            $('desktop-context-menu').classList.add('hidden');
            closeDesktopFloatingSubmenu();
            await sortDesktopApps(action.split(':')[1]);
        }
    });
    document.addEventListener('mousedown', (event) => {
        if (!event.target.closest('#desktop-context-menu,.floating-context-submenu')) closeDesktopFloatingSubmenu();
    }, true);
}
