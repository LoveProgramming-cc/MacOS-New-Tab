// Launchers: clicking them, Launchpad paging and deleting, and dragging them between
// the Dock, Launchpad, Spotlight, folders and the Trash.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { getAppName, t } from './i18n.js';
import { getArrayForType, isProtectedApp, renderDesktopIcons, renderDock, renderForType, renderLaunchpadGrid, renderSettingsLists, renderSpotlightLinks } from './render.js';
import { $, navigateTo } from './utils.js';
import { createAppIcon } from './icons.js';
import { moveAppToTrash, openTrashFinder } from './trash.js';
import { devFlag } from './developer.js';
import { openPluginApp } from './plugin-system.js';
import { openDeveloperTools } from './devtools.js';
import { closeLaunchpad, closeMenus, performAppAction, toggleLaunchpad } from './events.js';
import { resetDockWave } from './events-dock.js';

let launchpadPressStart = null;
function showLaunchpadDeleteDialog(index) {
    const app = state.config.launchpadApps[index];
    if (!app || isProtectedApp(app, 'launchpad')) return;
    state.pendingLaunchpadDelete = index;
    const dialog = $('launchpad-delete-dialog');
    const iconHost = $('launchpad-delete-icon');
    const message = $('launchpad-delete-message');
    if (iconHost) {
        iconHost.replaceChildren(createAppIcon(app, { location: 'launchpad' }));
    }
    if (message) message.textContent = t('confirmDeleteApp', `确认删除“${getAppName(app)}”吗？`).replace('{name}', getAppName(app));
    dialog?.classList.remove('hidden');
}

export function hideLaunchpadDeleteDialog() {
    state.pendingLaunchpadDelete = null;
    $('launchpad-delete-dialog')?.classList.add('hidden');
}

export function bindAppClicks() {
    $('dock')?.addEventListener('click', async (event) => {
        if (state.drag) return;
        const item = event.target.closest('.dock-item');
        if (!item) return;
        if (item.dataset.kind === 'running') { openPluginApp(item.dataset.pluginId || ''); return; }
        if (item.dataset.kind === 'system-running') { openDeveloperTools(); return; }
        if (item.dataset.kind === 'trash') {
            if ($('launchpad')?.classList.contains('active') && !state.launchpadJiggle) { closeLaunchpad(); renderLaunchpadGrid(); }
            openTrashFinder();
            return;
        }
        if (item.dataset.kind === 'folder') {
            if ($('launchpad')?.classList.contains('active') && !state.launchpadJiggle) { closeLaunchpad(); renderLaunchpadGrid(); }
            const folder = state.config.dockFolders?.[Number(item.dataset.folderIndex)];
            if (folder?.url) {
                folder.lastAccessedAt = Date.now();
                await saveConfig();
                navigateTo(folder.url);
            }
            return;
        }
        const app = state.config.dockApps[Number(item.dataset.index)];
        if (!app) return;
        if ($('launchpad')?.classList.contains('active') && !state.launchpadJiggle && app?.action !== 'toggleLaunchpad') {
            closeLaunchpad();
            renderLaunchpadGrid();
        }
        app.lastAccessedAt = Date.now();
        await saveConfig();
        performAppAction(app);
    });

    $('quick-links')?.addEventListener('click', (event) => {
        if (state.drag) return;
        const item = event.target.closest('.link-item');
        if (!item) return;
        performAppAction(state.config.quickLinks[Number(item.dataset.index)]);
    });

    $('launchpad-grid')?.addEventListener('click', async (event) => {
        const deleteBadge = event.target.closest('.delete-badge');
        if (deleteBadge) {
            event.stopPropagation();
            showLaunchpadDeleteDialog(Number(deleteBadge.dataset.index));
            return;
        }
        if (state.launchpadJiggle || state.drag) return;
        const item = event.target.closest('.lp-item');
        if (!item) return;
        const app = state.config.launchpadApps[Number(item.dataset.index)];
        if (app) { app.lastAccessedAt = Date.now(); await saveConfig(); }
        closeLaunchpad();
        renderLaunchpadGrid();
        performAppAction(app);
    });
}

export function bindLaunchpadGestures() {
    const launchpad = $('launchpad');
    const grid = $('launchpad-grid');

    launchpad?.addEventListener('mousedown', (event) => {
        if (!event.target.closest('.lp-item') && !event.target.closest('.launchpad-dots') && !event.target.closest('.launchpad-search-wrap')) {
            if (state.launchpadJiggle) {
                state.launchpadJiggle = false;
                renderLaunchpadGrid();
            } else if (launchpad.classList.contains('active')) {
                closeLaunchpad();
            }
        }
    });

    grid?.addEventListener('mousedown', (event) => {
        const item = event.target.closest('.lp-item');
        if (!item || event.target.closest('.delete-badge') || state.launchpadJiggle) return;
        launchpadPressStart = { x: event.clientX, y: event.clientY };
        clearTimeout(state.launchpadLongPressTimer);
        state.launchpadLongPressTimer = setTimeout(() => {
            state.launchpadJiggle = true;
            renderLaunchpadGrid();
        }, 950);
    });

    grid?.addEventListener('mousemove', (event) => {
        if (!launchpadPressStart) return;
        if (Math.hypot(event.clientX - launchpadPressStart.x, event.clientY - launchpadPressStart.y) > 5) {
            clearTimeout(state.launchpadLongPressTimer);
            launchpadPressStart = null;
        }
    });
    const clearLongPress = () => {
        clearTimeout(state.launchpadLongPressTimer);
        launchpadPressStart = null;
    };
    grid?.addEventListener('mouseup', clearLongPress);
    grid?.addEventListener('mouseleave', clearLongPress);
    document.addEventListener('mousemove', (event) => {
        if (!launchpadPressStart) return;
        if (Math.hypot(event.clientX - launchpadPressStart.x, event.clientY - launchpadPressStart.y) > 5) clearLongPress();
    }, true);
    document.addEventListener('mouseup', clearLongPress, true);
    grid?.addEventListener('dragstart', clearLongPress, true);

    grid?.addEventListener('scroll', () => {
        const pageIndex = Math.round(grid.scrollLeft / window.innerWidth);
        $('lp-dots')?.querySelectorAll('.dot').forEach((dot, index) => dot.classList.toggle('active', index === pageIndex));
    });

    $('launchpad-search')?.addEventListener('input', (event) => {
        state.launchpadQuery = event.currentTarget.value || '';
        state.launchpadJiggle = false;
        renderLaunchpadGrid();
        const search = $('launchpad-search');
        if (search) {
            search.value = state.launchpadQuery;
            search.focus({ preventScroll: true });
        }
    });

    // Developer Beta 0.55.0: return to the V40 paging model.
    // Horizontal trackpad motion is native browser scrolling + CSS scroll snap. JS does
    // not synthesize per-wheel pixel movement. A very small commit latch only engages
    // after the adjacent page has actually been reached, preventing late reverse
    // momentum from snapping back to the page the gesture started on.
    let verticalWheelLock = false;
    let horizontalGesture = null;
    let horizontalQuietTimer = 0;
    let committedPage = null;

    const pageMetrics = () => ({
        width: Math.max(1, grid?.clientWidth || window.innerWidth),
        count: Math.max(1, grid?.querySelectorAll('.launchpad-page').length || 1)
    });
    const clearHorizontalGesture = () => {
        clearTimeout(horizontalQuietTimer);
        horizontalQuietTimer = 0;
        horizontalGesture = null;
        committedPage = null;
        grid?.classList.remove('launchpad-page-committed');
    };
    const armHorizontalRelease = () => {
        clearTimeout(horizontalQuietTimer);
        horizontalQuietTimer = setTimeout(clearHorizontalGesture, 120);
    };

    grid?.addEventListener('scroll', () => {
        if (horizontalGesture) armHorizontalRelease();
        const { width, count } = pageMetrics();
        const pageIndex = Math.max(0, Math.min(count - 1, Math.round(grid.scrollLeft / width)));
        $('lp-dots')?.querySelectorAll('.dot').forEach((dot, index) => dot.classList.toggle('active', index === pageIndex));
        if (!horizontalGesture || committedPage !== null) return;
        const start = horizontalGesture.startPage;
        const direction = horizontalGesture.direction;
        const candidate = start + direction;
        if (!direction || candidate < 0 || candidate >= count) return;
        const target = candidate * width;
        // Only latch when native scrolling has essentially arrived at the next page,
        // not merely when it crosses a guessed halfway threshold.
        if (Math.abs(grid.scrollLeft - target) <= Math.max(2, width * .006)) {
            committedPage = candidate;
            grid.classList.add('launchpad-page-committed');
        }
    }, { passive: true });

    grid?.addEventListener('wheel', (event) => {
        if (event.ctrlKey) return;
        const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0;
        if (horizontal) {
            const { width, count } = pageMetrics();
            if (!horizontalGesture) {
                horizontalGesture = {
                    startPage: Math.max(0, Math.min(count - 1, Math.round(grid.scrollLeft / width))),
                    direction: Math.sign(event.deltaX)
                };
            } else if (!horizontalGesture.direction && event.deltaX) {
                horizontalGesture.direction = Math.sign(event.deltaX);
            }
            armHorizontalRelease();
            if (committedPage !== null) {
                // The requested adjacent page was already reached. End this physical
                // paging interaction here; later momentum from the same gesture cannot
                // undo it. This is the only point where native horizontal wheel is blocked.
                event.preventDefault();
                grid.scrollLeft = committedPage * width;
            }
            return;
        }

        // Preserve V40's mouse-wheel / vertical gesture convenience: one vertical wheel
        // pulse means one page. It is intentionally separate from horizontal trackpad
        // physics and settles quickly.
        event.preventDefault();
        if (verticalWheelLock) return;
        verticalWheelLock = true;
        const { width, count } = pageMetrics();
        const current = Math.max(0, Math.min(count - 1, Math.round(grid.scrollLeft / width)));
        const target = Math.max(0, Math.min(count - 1, current + Math.sign(event.deltaY)));
        grid.scrollTo({ left: target * width, behavior: devFlag('disableAnimations') ? 'auto' : 'smooth' });
        setTimeout(() => { verticalWheelLock = false; }, 260);
    }, { passive: false });

    $('launchpad-delete-cancel')?.addEventListener('click', hideLaunchpadDeleteDialog);
    $('launchpad-delete-confirm')?.addEventListener('click', async () => {
        const index = state.pendingLaunchpadDelete;
        const app = state.config.launchpadApps[index];
        if (Number.isInteger(index) && app && !isProtectedApp(app, 'launchpad')) {
            const [removed] = state.config.launchpadApps.splice(index, 1);
            moveAppToTrash(removed, 'lp', index);
            await saveConfig();
            renderLaunchpadGrid();
            renderSettingsLists();
            renderDock();
        }
        hideLaunchpadDeleteDialog();
    });
}

function dragTypeForContainer(container) {
    if (container.id === 'dock') return 'dock';
    if (container.id === 'launchpad-grid') return 'launchpad';
    if (container.id === 'quick-links') return 'spotlight';
    return null;
}

function itemSelectorForType(type) {
    if (type === 'dock') return '.dock-app-item';
    if (type === 'launchpad') return '.lp-item';
    if (type === 'spotlight') return '.link-item';
    return '.edit-row';
}

function dockDeleteReady(source, clientX, clientY) {
    if (!source || source.type !== 'dock') return false;
    const app = state.config.dockApps[source.index];
    if (!app || isProtectedApp(app, 'dock')) return false;
    const dock = $('dock');
    if (!dock) return false;
    const rect = dock.getBoundingClientRect();
    return clientY < rect.top - 52 || clientY > rect.bottom + 52 || clientX < rect.left - 52 || clientX > rect.right + 52;
}

function createDockDragGhost(source, event) {
    const icon = source.item?.querySelector('.app-icon-container');
    if (!icon) return;
    const ghost = document.createElement('div');
    ghost.className = 'dock-drag-ghost';
    const iconWrap = document.createElement('div');
    iconWrap.className = 'dock-drag-ghost-icon';
    iconWrap.appendChild(icon.cloneNode(true));
    const label = document.createElement('div');
    label.className = 'dock-drag-remove-label';
    label.textContent = t('removeFromDock', '删除');
    ghost.append(iconWrap, label);
    document.body.appendChild(ghost);
    source.ghost = ghost;
    source.deleteReady = false;

    const transparent = document.createElement('div');
    transparent.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(transparent);
    event.dataTransfer.setDragImage(transparent, 0, 0);
    setTimeout(() => transparent.remove(), 0);
}

function updateDockDragGhost(source, clientX, clientY) {
    if (!source?.ghost || !Number.isFinite(clientX) || !Number.isFinite(clientY) || (clientX === 0 && clientY === 0)) return;
    source.ghost.style.left = `${clientX}px`;
    source.ghost.style.top = `${clientY}px`;
    source.deleteReady = dockDeleteReady(source, clientX, clientY);
    source.ghost.classList.toggle('delete-ready', source.deleteReady);
}

function cleanupDragFeedback(source) {
    source?.ghost?.remove();
    if (source) source.ghost = null;
}

// Where a dragged launcher lands: before the first item whose midpoint is past the
// pointer (on the pointer's row), otherwise at the end. Dropping in the gap between two
// icons therefore inserts between them instead of sending the icon to the far end.
function dropInsertIndex(container, selector, event, source, length) {
    const items = [...container.querySelectorAll(selector)].filter((el) => el !== source.item);
    const sameRow = items.filter((el) => { const r = el.getBoundingClientRect(); return event.clientY >= r.top && event.clientY <= r.bottom; });
    const row = sameRow.length ? sameRow : items;
    // "Before" an item is to its left, or to its right where the row runs right to left.
    const rtl = row.length > 0 && getComputedStyle(row[0].parentElement).direction === 'rtl';
    for (const el of row) {
        const rect = el.getBoundingClientRect(); const middle = rect.left + rect.width / 2;
        if (rtl ? event.clientX > middle : event.clientX < middle) return Number(el.dataset.index);
    }
    return row.length ? Number(row[row.length - 1].dataset.index) + 1 : length;
}

export function bindMainDragAndDrop(container) {
    const type = dragTypeForContainer(container);
    const selector = itemSelectorForType(type);

    container.addEventListener('dragstart', (event) => {
        const item = event.target.closest(selector);
        if (!item || state.launchpadJiggle || item.getAttribute('draggable') === 'false') return;
        // Even protected/system icons may be dragged onto Trash. Finder remains a fixed
        // Dock anchor for ordinary reordering: its drag is trash-only unless developer
        // system-icon editing has explicitly unlocked it.
        let trashOnly = false;
        if (type === 'dock') {
            const dockApp = state.config.dockApps?.[Number(item.dataset.index)];
            trashOnly = Boolean(dockApp?.nameKey === 'appFinder' && !devFlag('allowSystemIconEditing'));
        }
        if (type === 'launchpad') {
            clearTimeout(state.launchpadLongPressTimer);
            state.launchpadLongPressTimer = null;
            launchpadPressStart = null;
        }
        state.drag = { type, index: Number(item.dataset.index), item, handledDrop: false, deleteReady: false, ghost: null, trashOnly };
        event.dataTransfer.effectAllowed = 'move';
        if (type === 'dock') {
            createDockDragGhost(state.drag, event);
            updateDockDragGhost(state.drag, event.clientX, event.clientY);
        } else {
            const image = item.querySelector('.app-icon-container') || item;
            if (image) event.dataTransfer.setDragImage(image, image.offsetWidth / 2, image.offsetHeight / 2);
        }
        queueMicrotask(() => item.classList.add('dragging'));
    });

    container.addEventListener('drag', (event) => {
        if (state.drag?.type === 'dock') updateDockDragGhost(state.drag, event.clientX, event.clientY);
    });

    container.addEventListener('dragover', (event) => {
        if (!state.drag) return;
        if (state.drag.type === 'dock') updateDockDragGhost(state.drag, event.clientX, event.clientY);
        const overDockUtility = type === 'dock' && Boolean(event.target.closest('.dock-folder-item,.dock-separator,.dock-trash-item'));
        if (!overDockUtility && (state.drag.type === type || (state.drag.type === 'launchpad' && type === 'dock'))) event.preventDefault();
        const item = event.target.closest(selector);
        if (item && item !== state.drag.item) item.classList.add('drag-over');
    });

    container.addEventListener('dragleave', (event) => {
        event.target.closest(selector)?.classList.remove('drag-over');
    });

    container.addEventListener('drop', async (event) => {
        if (!state.drag) return;
        const source = state.drag;
        if (type === 'dock' && event.target.closest('.dock-folder-item,.dock-separator,.dock-trash-item')) return;
        const target = event.target.closest(selector);
        const targetIndex = target ? Number(target.dataset.index) : null;

        if (source.type === type) {
            event.preventDefault();
            if (source.trashOnly) return;
            const array = getArrayForType(type);
            if (type === 'launchpad' && targetIndex !== null && targetIndex >= 0 && targetIndex < array.length) {
                // Launchpad behaves like a slot grid: dragging either direction swaps
                // the occupied slots, so front→back and back→front are symmetric.
                [array[source.index], array[targetIndex]] = [array[targetIndex], array[source.index]];
            } else {
                const slot = dropInsertIndex(container, selector, event, source, array.length);
                const [moved] = array.splice(source.index, 1);
                array.splice(Math.max(0, Math.min(array.length, slot - (source.index < slot ? 1 : 0))), 0, moved);
            }
            source.handledDrop = true;
            source.item?.classList.remove('dragging');
            cleanupDragFeedback(source);
            await saveConfig();
            state.drag = null;
            renderForType(type);
            return;
        }

        if (source.type === 'launchpad' && type === 'dock') {
            event.preventDefault();
            const sourceApp = state.config.launchpadApps[source.index];
            if (!sourceApp) return;
            const copy = structuredClone(sourceApp);
            copy.isSystem = false;
            copy.protected = false;
            const insertAt = Math.max(0, Math.min(state.config.dockApps.length, dropInsertIndex(container, selector, event, source, state.config.dockApps.length)));
            state.config.dockApps.splice(insertAt, 0, copy);
            source.handledDrop = true;
            source.item?.classList.remove('dragging');
            cleanupDragFeedback(source);
            await saveConfig();
            state.drag = null;
            renderDock();
            renderSettingsLists();
        }
    });

    container.addEventListener('dragend', async (event) => {
        if (!state.drag) return;
        const source = state.drag;
        updateDockDragGhost(source, event.clientX, event.clientY);
        source.item?.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));

        // Only a completed drop outside the Dock removes the icon. Pressing Esc ends the
        // drag without a drop event and must leave the Dock untouched.
        if (source.type === 'dock' && !source.handledDrop && source.dropConfirmed) {
            const app = state.config.dockApps[source.index];
            if (app && !isProtectedApp(app, 'dock')) {
                const [removed] = state.config.dockApps.splice(source.index, 1);
                moveAppToTrash(removed, 'dock', source.index);
                await saveConfig();
                renderDock();
                renderSettingsLists();
            }
        }
        cleanupDragFeedback(source);
        state.drag = null;
        resetDockWave();
    });
}

export function bindDockFolderReorder() {
    const dock = $('dock');
    if (!dock) return;
    let sourceIndex = null;
    let sourceEl = null;
    dock.addEventListener('dragstart', (event) => {
        const item = event.target.closest('.dock-folder-item');
        if (!item) return;
        sourceIndex = Number(item.dataset.folderIndex);
        sourceEl = item;
        if (!Number.isInteger(sourceIndex)) { sourceIndex = null; sourceEl = null; return; }
        state.drag = { type: 'folder', index: sourceIndex, item, handledDrop: false, deleteReady: false, ghost: null };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-macos-dock-folder', String(sourceIndex));
        const icon = item.querySelector('.dock-icon') || item;
        try { event.dataTransfer.setDragImage(icon, icon.offsetWidth / 2, icon.offsetHeight / 2); } catch {}
        queueMicrotask(() => item.classList.add('dragging'));
    });
    dock.addEventListener('dragover', (event) => {
        if (sourceIndex === null) return;
        const target = event.target.closest('.dock-folder-item');
        if (!target) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        dock.querySelectorAll('.dock-folder-item.drag-over').forEach((el) => el.classList.remove('drag-over'));
        if (target !== sourceEl) target.classList.add('drag-over');
    });
    dock.addEventListener('drop', async (event) => {
        if (sourceIndex === null) return;
        const target = event.target.closest('.dock-folder-item');
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        const targetIndex = Number(target.dataset.folderIndex);
        const folders = state.config.dockFolders || [];
        if (Number.isInteger(targetIndex) && folders[sourceIndex] && folders[targetIndex] && sourceIndex !== targetIndex) {
            [folders[sourceIndex], folders[targetIndex]] = [folders[targetIndex], folders[sourceIndex]];
            if (state.drag?.type === 'folder') state.drag.handledDrop = true;
            await saveConfig();
            renderDock();
            renderSettingsLists();
        }
        if (state.drag?.type === 'folder') state.drag = null;
        sourceIndex = null; sourceEl = null;
    });
    dock.addEventListener('dragend', () => {
        dock.querySelectorAll('.dock-folder-item.drag-over,.dock-folder-item.dragging').forEach((el) => el.classList.remove('drag-over','dragging'));
        if (state.drag?.type === 'folder') state.drag = null;
        sourceIndex = null; sourceEl = null;
    });
}

function trashSourceCode(type) {
    if (type === 'launchpad') return 'lp';
    if (type === 'spotlight') return 'sl';
    return type;
}
export function bindGlobalTrashDropTarget() {
    const validTypes = new Set(['dock', 'launchpad', 'spotlight', 'folder']);
    const clear = () => document.querySelectorAll('.dock-trash-item.trash-drop-ready').forEach((el) => el.classList.remove('trash-drop-ready'));
    document.addEventListener('dragstart', () => { document.body.classList.add('global-app-drag-active'); resetDockWave(); closeMenus(); }, true);
    document.addEventListener('dragend', () => { document.body.classList.remove('global-app-drag-active'); clear(); resetDockWave(); }, true);
    document.addEventListener('drop', () => { document.body.classList.remove('global-app-drag-active'); resetDockWave(); }, true);
    document.addEventListener('dragover', (event) => {
        const trash = event.target.closest?.('.dock-trash-item');
        if (!trash || !state.drag || !validTypes.has(state.drag.type)) { if (!trash) clear(); return; }
        const array = getArrayForType(state.drag.type);
        const app = array?.[state.drag.index];
        if (!app) return clear();
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        trash.classList.add('trash-drop-ready');
    }, true);
    document.addEventListener('dragleave', (event) => {
        const trash = event.target.closest?.('.dock-trash-item');
        if (trash && !trash.contains(event.relatedTarget)) trash.classList.remove('trash-drop-ready');
    }, true);
    document.addEventListener('drop', async (event) => {
        const trash = event.target.closest?.('.dock-trash-item');
        const source = state.drag;
        if (!trash || !source || !validTypes.has(source.type)) return;
        const array = getArrayForType(source.type);
        const app = array?.[source.index];
        if (!app) return clear();
        event.preventDefault(); event.stopImmediatePropagation();
        const [removed] = array.splice(source.index, 1);
        if (removed) moveAppToTrash(removed, trashSourceCode(source.type), source.index);
        source.handledDrop = true;
        source.item?.classList.remove('dragging');
        cleanupDragFeedback(source);
        state.drag = null;
        clear();
        await saveConfig();
        renderDock(); renderDesktopIcons(); renderLaunchpadGrid(); renderSpotlightLinks(); renderSettingsLists();
    }, true);
    document.addEventListener('dragend', clear, true);
    // While a Dock icon is far enough out to be removed, the whole page accepts the drop
    // so releasing there produces a real drop event (see the dragend handler).
    document.addEventListener('dragover', (event) => {
        if (state.drag?.type !== 'dock' || !state.drag.deleteReady || event.target.closest?.('#dock-shell')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    });
    document.addEventListener('drop', (event) => {
        if (state.drag?.type !== 'dock' || !state.drag.deleteReady || state.drag.handledDrop) return;
        event.preventDefault();
        state.drag.dropConfirmed = true;
    });
}
