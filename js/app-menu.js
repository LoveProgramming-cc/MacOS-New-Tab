import { $, createElement } from './utils.js';
import { t } from './i18n.js';
import {
    anyWindowHidden, applicationForWindow, hideManagedWindow, hideOtherManagedWindows, isWindowZoomable, managedWindowOptions, minimizeManagedWindow,
    canTileManagedWindow, otherWindowsVisible, showAllManagedWindows, tileManagedWindow, toggleZoomManagedWindow, topVisibleManagedWindow
} from './window-manager.js';
import { toggleMissionControl } from './mission-control.js';

// The menu bar. Whichever window is in front decides what it shows: the bold application
// name with the standard application menu, the application's own menus, and a Window
// menu. System windows (Settings, Finder, About) and application plug-ins are described
// the same way:
//
//   { id, name, window, about(), settings(), settingsLabel, extra: [items], quit(), menus(): [{ title, items }] }
//   item: { label, shortcut, disabled, danger, run() } | { separator: true }
//
// With no window open the bar falls back to the browser's own menu titles.

let active = null;
let dropdown = null;

export function closeApplicationMenuDropdown() {
    dropdown?.classList.add('hidden');
    document.querySelectorAll('#plugin-menu-items .plugin-menu-title').forEach((node) => node.classList.remove('active'));
}
function ensureDropdown() {
    if (dropdown?.isConnected) return dropdown;
    dropdown = createElement('div', { className: 'dropdown-menu mac-acrylic window-shadow plugin-app-menu-dropdown hidden', attrs: { role: 'menu' } });
    document.body.appendChild(dropdown);
    return dropdown;
}
function showDropdown(items, anchor) {
    const menu = ensureDropdown();
    menu.replaceChildren();
    for (const item of items) {
        if (item.separator) { menu.appendChild(createElement('div', { className: 'menu-separator' })); continue; }
        const row = createElement('div', { className: `menu-item plugin-menu-command${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`, attrs: { role: 'menuitem', 'aria-disabled': item.disabled ? 'true' : undefined } });
        row.appendChild(createElement('span', { text: `${item.checked ? '✓ ' : ''}${item.label}` }));
        if (item.shortcut) row.appendChild(createElement('span', { className: 'plugin-menu-shortcut', text: item.shortcut }));
        if (!item.disabled) row.addEventListener('click', (event) => { event.stopPropagation(); closeApplicationMenuDropdown(); item.run?.(); });
        menu.appendChild(row);
    }
    menu.classList.remove('hidden');
    anchor?.classList.add('active');
    const box = anchor?.getBoundingClientRect() || { left: 8, bottom: 26 };
    menu.style.left = '0px'; menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    // The menu hangs from the title's leading edge: its left, or its right where the bar runs right to left.
    const rtl = document.documentElement.dir === 'rtl';
    menu.style.left = `${Math.max(4, Math.min(rtl && anchor ? box.right - rect.width : box.left, innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(26, Math.min(box.bottom, innerHeight - rect.height - 4))}px`;
}

// About / Settings… / (the application's own entries) / Hide / Hide Others / Show All / Quit.
// Everything about windows is done here; an application only supplies what is its own.
function applicationMenu(app) {
    const named = (key, fallback) => t(key, fallback).replace('{name}', app.name);
    return [
        ...(app.about ? [{ label: named('appMenuAbout', '关于 {name}'), run: app.about }, { separator: true }] : []),
        ...(app.settings ? [{ label: app.settingsLabel || t('appMenuSettings', '设置…'), run: app.settings }, { separator: true }] : []),
        ...((app.extra || []).length ? [...app.extra, { separator: true }] : []),
        { label: named('appMenuHide', '隐藏 {name}'), run: () => hideManagedWindow(app.window) },
        { label: t('appMenuHideOthers', '隐藏其他'), disabled: !otherWindowsVisible(app.window), run: () => hideOtherManagedWindows(app.window) },
        { label: t('appMenuShowAll', '全部显示'), disabled: !anyWindowHidden(), run: showAllManagedWindows },
        { separator: true },
        { label: named('appMenuQuit', '退出 {name}'), run: app.quit }
    ];
}
function windowMenu(app) {
    const options = managedWindowOptions(app.window) || {};
    return { title: t('window', '窗口'), items: [
        { label: t('windowMinimize', '最小化'), disabled: options.minimizable === false, run: () => minimizeManagedWindow(app.window) },
        { label: t('windowZoom', '缩放'), disabled: !isWindowZoomable(app.window), run: () => toggleZoomManagedWindow(app.window) },
        { separator: true },
        { label: t('windowTileLeft', '移到桌面左半边'), disabled: !canTileManagedWindow(app.window, 'left'), run: () => tileManagedWindow(app.window, 'left') },
        { label: t('windowTileRight', '移到桌面右半边'), disabled: !canTileManagedWindow(app.window, 'right'), run: () => tileManagedWindow(app.window, 'right') },
        { separator: true },
        { label: t('missionControl', '调度中心'), shortcut: '⌃↑', run: () => toggleMissionControl() }
    ] };
}

function paint() {
    const system = $('system-menu-items'); const host = $('plugin-menu-items');
    if (!system || !host) return;
    closeApplicationMenuDropdown();
    if (!active) { host.classList.add('hidden'); host.replaceChildren(); system.classList.remove('hidden'); return; }
    const app = active;
    system.classList.add('hidden'); host.classList.remove('hidden'); host.replaceChildren();
    const add = (label, items, className = '') => {
        const title = createElement('span', { className: `plugin-menu-title${className}`, text: label });
        title.addEventListener('pointerdown', (event) => {
            event.stopPropagation(); event.preventDefault();
            const wasOpen = !ensureDropdown().classList.contains('hidden') && title.classList.contains('active');
            closeApplicationMenuDropdown();
            if (!wasOpen) showDropdown(items(), title);
        });
        // Sliding along the bar with a menu open switches menus, as on macOS.
        title.addEventListener('pointerenter', () => {
            if (ensureDropdown().classList.contains('hidden') || title.classList.contains('active')) return;
            closeApplicationMenuDropdown(); showDropdown(items(), title);
        });
        host.appendChild(title);
    };
    add(app.name, () => applicationMenu(app), ' bold plugin-menu-app-name');
    for (const menu of [...(app.menus?.() || []), windowMenu(app)]) add(menu.title, () => menu.items);
}

export const activeApplication = () => active;
export function setActiveApplication(app) {
    const previous = active;
    if ((previous?.id || '') === (app?.id || '') && previous?.window === app?.window) { active = app; paint(); return; }
    active = app || null;
    paint();
    try { window.dispatchEvent(new CustomEvent('macos-active-application-changed', { detail: { previous: previous?.id || '', current: active?.id || '' } })); } catch { /* no-op */ }
}
/** Re-read the frontmost window (after a window was shown, hidden or closed, or the language changed). */
export function refreshActiveApplication() {
    setActiveApplication(applicationForWindow(topVisibleManagedWindow()));
}

let bound = false;
export function bindApplicationMenu() {
    if (bound) return; bound = true;
    window.addEventListener('macos-managed-window-activated', (event) => {
        const app = applicationForWindow(event.detail?.element);
        if (app) setActiveApplication(app);
    });
    window.addEventListener('macos-window-visibility-changed', () => refreshActiveApplication());
    window.addEventListener('macos-language-change', () => refreshActiveApplication());
    document.addEventListener('pointerdown', (event) => {
        if (!event.target?.closest?.('#plugin-menu-items,.plugin-app-menu-dropdown')) closeApplicationMenuDropdown();
    }, true);
}
