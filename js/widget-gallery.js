// The widget gallery: its categories, dragging a widget out of it, and reordering the
// widget centre.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { widgetGridPositionFromPoint } from './desktop-layout.js';
import { applicationWidgetApps, applicationWidgetTemplates, prepareApplicationWidgets } from './plugin-system.js';
import { WIDGET_LIBRARY, addWidget, clearDesktopPlacementGhost, createWidgetCard, findPlacedWidget, hideWidgetGalleryWindows, moveWidgetBetweenLocations, restoreWidgetGalleryWindows, showDesktopPlacementGhost, syncWidgetCenterOrder, syncWidgetEditControls, widgetTitle, widgetsRuntimeDisabled } from './widgets.js';
import { renderWidgetSettings } from './widget-settings.js';

let galleryDesktopDropCatcher = null;
export function renderGalleryCategory(category = state.widgetGalleryCategory || 'all') {
    state.widgetGalleryCategory = category;
    document.querySelectorAll('.widget-gallery-category').forEach((el) => el.classList.toggle('active', el.dataset.category === category));
    const grid = $('widget-gallery-grid');
    if (!grid) return;
    const query = ($('widget-gallery-search')?.value || '').trim().toLowerCase();
    grid.replaceChildren();
    const label = (item) => (item.type === 'app' ? `${item.appName} ${item.title}` : t(item.titleKey, ''));
    [...WIDGET_LIBRARY, ...applicationWidgetTemplates()]
        .filter((item) => category === 'all' || item.category === category)
        .filter((item) => !query || label(item).toLowerCase().includes(query))
        .forEach((template) => {
            const wrap = createElement('div', { className: 'widget-gallery-item', attrs: { draggable: 'false' } });
            wrap.dataset.template = JSON.stringify(template);
            const previewWidget = { id: `preview-${template.type}-${template.variant}-${template.size}`, ...template };
            if (template.type === 'weather') previewWidget.weatherLocationId = state.config.widgets?.weather?.defaultLocationId;
            const preview = createWidgetCard(previewWidget, { preview: true, location: 'gallery' });
            const caption = createElement('div', { className: 'widget-gallery-item-label', text: template.type === 'app' ? template.title : t(template.titleKey, widgetTitle(template)) });
            wrap.append(preview, caption);
            grid.appendChild(wrap);
        });
}
// Applications that offer widgets get a category each, below the system ones.
function renderGalleryApplications() {
    const sidebar = document.querySelector('.widget-gallery-sidebar');
    if (!sidebar) return;
    sidebar.querySelectorAll('.widget-gallery-category[data-app]').forEach((item) => item.remove());
    for (const app of applicationWidgetApps()) {
        const item = createElement('button', { className: 'widget-gallery-category', text: app.name, attrs: { type: 'button' }, dataset: { category: `app:${app.id}`, app: app.id } });
        item.addEventListener('click', () => renderGalleryCategory(item.dataset.category));
        sidebar.appendChild(item);
    }
    if (!sidebar.querySelector(`.widget-gallery-category[data-category="${CSS.escape(state.widgetGalleryCategory || 'all')}"]`)) state.widgetGalleryCategory = 'all';
}
export function renderWidgetGallery() {
    renderGalleryApplications();
    renderGalleryCategory(state.widgetGalleryCategory || 'all');
    // Titles in the application's own language arrive with its package.
    prepareApplicationWidgets().then((loaded) => { if (loaded && !$('widget-gallery')?.classList.contains('hidden')) { renderGalleryApplications(); renderGalleryCategory(state.widgetGalleryCategory || 'all'); } }).catch(() => {});
}

export function openWidgetGallery() {
    if (widgetsRuntimeDisabled()) return;
    const center = $('widget-center');
    state.widgetCenterWasOpenBeforeGallery = Boolean(center && !center.classList.contains('hidden'));
    state.widgetEditMode = true;
    document.body.classList.add('widget-gallery-open');
    document.body.classList.toggle('widget-gallery-with-center', state.widgetCenterWasOpenBeforeGallery);
    hideWidgetGalleryWindows();
    if (state.widgetCenterWasOpenBeforeGallery) {
        center?.classList.remove('hidden');
        center?.classList.add('editing');
        syncWidgetEditControls();
    } else {
        center?.classList.add('hidden');
    }
    $('widget-gallery')?.classList.remove('hidden');
    syncWidgetEditControls();
    renderWidgetGallery();
}
export function closeWidgetGallery() {
    $('widget-gallery')?.classList.add('hidden');
    document.body.classList.remove('widget-gallery-open', 'widget-gallery-with-center', 'widget-drag-to-desktop');
    state.widgetEditMode = false;
    const center = $('widget-center');
    center?.classList.remove('editing');
    center?.classList.toggle('hidden', !state.widgetCenterWasOpenBeforeGallery);
    restoreWidgetGalleryWindows();
    syncWidgetEditControls();
    state.widgetCenterWasOpenBeforeGallery = false;
}

function templateFromDrag(event) {
    try {
        if (!event.dataTransfer?.types?.includes('application/x-macos-widget')) return null;
        const raw = event.dataTransfer.getData('application/x-macos-widget');
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}
function createWidgetDragImage(card) {
    if (!card) return null;
    const cloneCard = card.cloneNode(true);
    cloneCard.classList.add('widget-drag-image');
    cloneCard.style.transform = 'none';
    const host = document.createElement('div');
    host.className = 'widget-drag-image-host';
    host.appendChild(cloneCard);
    document.body.appendChild(host);
    return host;
}

function removeGalleryDesktopDropCatcher() {
    galleryDesktopDropCatcher?.remove();
    galleryDesktopDropCatcher = null;
}
function pointInsideElement(element, x, y) {
    if (!element || element.classList?.contains('hidden')) return false;
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
function installGalleryDesktopDropCatcher() {
    removeGalleryDesktopDropCatcher();
    const catcher = document.createElement('div');
    catcher.id = 'widget-desktop-drop-catcher';
    catcher.setAttribute('aria-hidden', 'true');
    document.body.appendChild(catcher);
    galleryDesktopDropCatcher = catcher;

    catcher.addEventListener('dragover', (event) => {
        if (state.widgetDragSource !== 'gallery' || !state.widgetDragTemplate) return;
        if (pointInsideElement($('dock-container') || $('dock'), event.clientX, event.clientY) ||
            pointInsideElement($('menu-bar'), event.clientX, event.clientY)) {
            clearDesktopPlacementGhost();
            $('widget-center-list')?.classList.remove('widget-drop-target');
            event.dataTransfer.dropEffect = 'none';
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        const overCenter = state.widgetCenterWasOpenBeforeGallery && pointInsideElement($('widget-center'), event.clientX, event.clientY);
        if (overCenter) {
            clearDesktopPlacementGhost();
            $('widget-center-list')?.classList.add('widget-drop-target');
            return;
        }
        $('widget-center-list')?.classList.remove('widget-drop-target');
        const template = state.widgetDragTemplate;
        showDesktopPlacementGhost(template, widgetGridPositionFromPoint(template, event.clientX, event.clientY, ''));
    });
    catcher.addEventListener('drop', async (event) => {
        if (state.widgetDragSource !== 'gallery' || !state.widgetDragTemplate) return;
        if (pointInsideElement($('dock-container') || $('dock'), event.clientX, event.clientY) ||
            pointInsideElement($('menu-bar'), event.clientX, event.clientY)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const template = state.widgetDragTemplate;
        const location = state.widgetCenterWasOpenBeforeGallery && pointInsideElement($('widget-center'), event.clientX, event.clientY) ? 'center' : 'desktop';
        clearDesktopPlacementGhost();
        $('widget-center-list')?.classList.remove('widget-drop-target');
        state.widgetDragTemplate = null;
        state.widgetDragSource = null;
        document.body.classList.remove('widget-drag-active', 'widget-drag-to-desktop');
        state.widgetDesktopDragRestoreZones = null;
        removeGalleryDesktopDropCatcher();
        await addWidget(template, location, event.clientX, event.clientY);
    });
}

export function bindGalleryDrag() {
    const galleryGrid = $('widget-gallery-grid');
    if (!galleryGrid) return;

    // The Gallery deliberately disappears while dragging. Therefore the drag cannot
    // depend on the Gallery remaining a hit-test surface. Capture the pointer globally
    // and compute the destination from screen coordinates only. This also makes the
    // Gallery's former rectangle a perfectly valid desktop drop zone.
    galleryGrid.addEventListener('dragstart', (event) => event.preventDefault(), true);
    galleryGrid.addEventListener('pointerdown', (downEvent) => {
        if (downEvent.button !== 0 || !downEvent.isPrimary) return;
        const item = downEvent.target.closest('.widget-gallery-item');
        if (!item || downEvent.target.closest('button,input,select,textarea,a')) return;
        let template = null;
        try { template = JSON.parse(item.dataset.template || 'null'); } catch {}
        if (!template) return;

        const pointerId = downEvent.pointerId;
        const startX = downEvent.clientX;
        const startY = downEvent.clientY;
        let started = false;
        let finished = false;
        let ghostHost = null;
        let lastX = startX;
        let lastY = startY;

        const removeGlobalListeners = () => {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onCancel, true);
            window.removeEventListener('blur', onBlur, true);
            document.removeEventListener('visibilitychange', onVisibility, true);
        };
        const clearVisuals = () => {
            ghostHost?.remove();
            ghostHost = null;
            clearDesktopPlacementGhost();
            $('widget-center-list')?.classList.remove('widget-drop-target');
        };
        const restorePicker = () => {
            document.body.classList.remove('widget-drag-active', 'widget-drag-to-desktop');
            state.widgetDesktopDragRestoreZones = null;
        };
        const finish = async (shouldDrop) => {
            if (finished) return;
            finished = true;
            removeGlobalListeners();
            try { if (item.hasPointerCapture?.(pointerId)) item.releasePointerCapture(pointerId); } catch {}

            const x = lastX;
            const y = lastY;
            const blocked = pointInsideElement($('dock-container') || $('dock'), x, y) ||
                pointInsideElement($('menu-bar'), x, y);
            const overCenter = state.widgetCenterWasOpenBeforeGallery && pointInsideElement($('widget-center'), x, y);
            clearVisuals();
            state.widgetDragTemplate = null;
            state.widgetDragSource = null;
            removeGalleryDesktopDropCatcher();

            // Restore the picker immediately after pointer-up. addWidget is optimistic
            // and paints synchronously, so storage/media work never blocks this path.
            if (started && shouldDrop && !blocked) {
                await addWidget(template, overCenter ? 'center' : 'desktop', x, y);
            }
            restorePicker();
        };
        const updateGhost = (event) => {
            lastX = event.clientX;
            lastY = event.clientY;
            if (ghostHost) {
                const width = parseFloat(ghostHost.style.width) || 100;
                const height = parseFloat(ghostHost.style.height) || 100;
                ghostHost.style.transform = `translate3d(${event.clientX - width / 2}px, ${event.clientY - height / 2}px, 0)`;
            }
            const blocked = pointInsideElement($('dock-container') || $('dock'), event.clientX, event.clientY) ||
                pointInsideElement($('menu-bar'), event.clientX, event.clientY);
            const overCenter = state.widgetCenterWasOpenBeforeGallery && pointInsideElement($('widget-center'), event.clientX, event.clientY);
            if (blocked || overCenter) {
                clearDesktopPlacementGhost();
                $('widget-center-list')?.classList.toggle('widget-drop-target', Boolean(overCenter));
                return;
            }
            $('widget-center-list')?.classList.remove('widget-drop-target');
            showDesktopPlacementGhost(template, widgetGridPositionFromPoint(template, event.clientX, event.clientY, ''));
        };
        const begin = (event) => {
            started = true;
            state.widgetDragTemplate = template;
            state.widgetDragSource = 'gallery-pointer';
            state.widgetDesktopDragRestoreZones = {
                galleryRect: $('widget-gallery')?.getBoundingClientRect(),
                centerRect: $('widget-center')?.getBoundingClientRect()
            };
            document.body.classList.add('widget-drag-active', 'widget-drag-to-desktop');

            const card = item.querySelector('.widget-card');
            if (card) {
                const rect = card.getBoundingClientRect();
                const cloneCard = card.cloneNode(true);
                cloneCard.classList.add('widget-pointer-drag-card');
                cloneCard.style.transform = 'none';
                ghostHost = document.createElement('div');
                ghostHost.className = 'widget-pointer-drag-host';
                ghostHost.style.width = `${rect.width}px`;
                ghostHost.style.height = `${rect.height}px`;
                ghostHost.appendChild(cloneCard);
                document.body.appendChild(ghostHost);
            }
            updateGhost(event);
        };
        const onMove = (event) => {
            if (finished || event.pointerId !== pointerId) return;
            lastX = event.clientX;
            lastY = event.clientY;
            if (!started && Math.hypot(lastX - startX, lastY - startY) < 5) return;
            if (!started) begin(event);
            event.preventDefault();
            event.stopPropagation();
            updateGhost(event);
        };
        const onUp = (event) => {
            if (event.pointerId !== pointerId) return;
            lastX = event.clientX;
            lastY = event.clientY;
            event.preventDefault();
            finish(true).catch(() => restorePicker());
        };
        const onCancel = (event) => {
            if (event.pointerId !== pointerId) return;
            finish(false).catch(() => restorePicker());
        };
        const onBlur = () => { finish(false).catch(() => restorePicker()); };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') finish(false).catch(() => restorePicker());
        };

        // Window capture listeners survive the Gallery becoming pointer-events:none.
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
        window.addEventListener('blur', onBlur, true);
        document.addEventListener('visibilitychange', onVisibility, true);
        try { item.setPointerCapture?.(pointerId); } catch {}
        downEvent.preventDefault();
    }, true);
}

export function bindCenterReordering() {
    const list = $('widget-center-list');
    const nearestTargetId = (clientX, clientY, sourceId) => {
        const cards = [...(list?.querySelectorAll('.widget-card') || [])].filter((card) => card.dataset.widgetId !== sourceId);
        if (!cards.length) return null;
        let best = null;
        let bestDistance = Infinity;
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
            if (d < bestDistance) { bestDistance = d; best = card; }
        }
        return best?.dataset.widgetId || null;
    };

    list?.addEventListener('dragstart', (event) => {
        const card = event.target.closest('.widget-card');
        if (!card || state.widgetDragSource === 'gallery') return;
        if (event.target.closest('button,input,select,label')) { event.preventDefault(); return; }
        state.widgetDragTemplate = null;
        state.widgetDragSource = 'center';
        state.widgetCenterDragId = card.dataset.widgetId;
        state.widgetCenterDropTargetId = null;
        state.widgetDesktopDragRestoreZones = {
            galleryRect: $('widget-gallery')?.getBoundingClientRect(),
            centerRect: $('widget-center')?.getBoundingClientRect()
        };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-macos-widget-center', card.dataset.widgetId);
        const ghost = createWidgetDragImage(card);
        if (ghost) {
            const rect = card.getBoundingClientRect();
            event.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
            setTimeout(() => ghost.remove(), 0);
        }
        queueMicrotask(() => card.classList.add('widget-center-dragging'));
        event.stopPropagation();
    });
    list?.addEventListener('dragover', (event) => {
        if (!state.widgetCenterDragId || state.widgetDragSource !== 'center') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const targetCard = event.target.closest?.('.widget-card[data-widget-id]');
        state.widgetCenterDropTargetId = targetCard && targetCard.dataset.widgetId !== state.widgetCenterDragId
            ? targetCard.dataset.widgetId
            : nearestTargetId(event.clientX, event.clientY, state.widgetCenterDragId);
    });
    list?.addEventListener('drop', async (event) => {
        if (!state.widgetCenterDragId || state.widgetDragSource !== 'center') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const arr = state.config.widgets.center;
        const from = arr.findIndex((w) => w.id === state.widgetCenterDragId);
        const targetId = state.widgetCenterDropTargetId || nearestTargetId(event.clientX, event.clientY, state.widgetCenterDragId);
        const to = targetId ? arr.findIndex((w) => w.id === targetId) : -1;
        if (from >= 0 && to >= 0 && from !== to) {
            [arr[from], arr[to]] = [arr[to], arr[from]];
            await saveConfig();
            syncWidgetCenterOrder();
            renderWidgetSettings();
        }
        state.widgetCenterDragId = null;
        state.widgetCenterDropTargetId = null;
        state.widgetDragSource = null;
    });
    document.addEventListener('dragover', (event) => {
        if (!state.widgetCenterDragId || state.widgetDragSource !== 'center') return;
        const zones = state.widgetDesktopDragRestoreZones || {};
        const inside = (rect) => rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        const inOverlay = inside(zones.centerRect) || inside(zones.galleryRect);
        document.body.classList.toggle('widget-drag-to-desktop', !inOverlay);
        if (inOverlay || event.target.closest('.window,#dock-shell,#menu-bar')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const widget = findPlacedWidget(state.widgetCenterDragId);
        if (widget) showDesktopPlacementGhost(widget, widgetGridPositionFromPoint(widget, event.clientX, event.clientY, widget.id));
    });
    document.addEventListener('drop', async (event) => {
        if (!state.widgetCenterDragId || state.widgetDragSource !== 'center') return;
        if (event.target.closest('#widget-center,#widget-gallery,.window,#dock-shell,#menu-bar')) return;
        event.preventDefault();
        const id = state.widgetCenterDragId;
        clearDesktopPlacementGhost();
        state.widgetCenterDragId = null;
        state.widgetCenterDropTargetId = null;
        state.widgetDragSource = null;
        document.body.classList.remove('widget-drag-to-desktop');
        state.widgetDesktopDragRestoreZones = null;
        await moveWidgetBetweenLocations(id, 'center', 'desktop', event.clientX, event.clientY);
    });
    list?.addEventListener('dragend', () => {
        list.querySelectorAll('.widget-center-dragging').forEach((el) => el.classList.remove('widget-center-dragging'));
        clearDesktopPlacementGhost();
        state.widgetCenterDragId = null;
        state.widgetCenterDropTargetId = null;
        if (state.widgetDragSource === 'center') state.widgetDragSource = null;
        document.body.classList.remove('widget-drag-to-desktop');
        state.widgetDesktopDragRestoreZones = null;
    });
}
