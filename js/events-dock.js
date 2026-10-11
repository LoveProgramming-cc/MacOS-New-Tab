// The Dock: magnification, pinning a running application, resizing by the separator.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { dockFitMaxSize, effectiveDockSize, renderDock } from './render.js';
import { $ } from './utils.js';
import { pinApplicationToDock } from './plugin-system.js';

let dockTrackingTimer = 0;
let dockAnimationFrame = null;
let dockPointerX = null;
// Lays the magnification wave out around pointerX. Runs once per pointer sample, and
// again whenever the Dock is rebuilt under the pointer so new icons take their place in
// the wave instead of snapping back to the resting size.
function applyDockWave(pointerX) {
    const dock = $('dock');
    const shell = $('dock-shell') || dock;
    const plate = $('dock-plate');
    const magnification = Number(state.config.dock?.magnification ?? 45);
    const children = [...dock.children];
    if (magnification <= 0 || !children.some((child) => child.classList.contains('dock-item'))) return;

    const base = effectiveDockSize();
    const peakExtra = Math.max(0, Math.min(1, magnification / 100)); // 100 -> 2x, 45 -> 1.45x.
    const sigma = base * 1.05;
    // Influence is measured against the resting layout (offsetLeft ignores
    // transforms), so the wave does not chase its own motion and the separator
    // width is accounted for.
    const dockLeft = shell.getBoundingClientRect().left + dock.offsetLeft;
    const extras = children.map((child) => {
        if (!child.classList.contains('dock-item')) return 0;
        const center = dockLeft + child.offsetLeft + child.offsetWidth / 2;
        return base * peakExtra * Math.exp(-0.5 * ((pointerX - center) / sigma) ** 2);
    });
    // Each magnified icon claims extra room; neighbours are pushed aside with
    // translate3d instead of resizing flex slots, so no layout runs per frame.
    const spreads = extras.map((extra) => extra * 0.92);
    const total = spreads.reduce((sum, value) => sum + value, 0);

    dock.classList.add('is-magnifying');
    shell.classList.add('is-magnifying');
    // Ease into the wave when the pointer arrives; follow it 1:1 afterwards.
    if (!dockTrackingTimer && !dock.classList.contains('is-tracking')) {
        dockTrackingTimer = setTimeout(() => { dockTrackingTimer = 0; if (dock.classList.contains('is-magnifying')) { dock.classList.add('is-tracking'); shell.classList.add('is-tracking'); } }, 190);
    }
    // Icons are pushed apart in the order they appear on screen, which is the reverse of
    // the document order in a right-to-left layout.
    const rtl = getComputedStyle(dock).direction === 'rtl';
    const visual = children.map((child, index) => index);
    if (rtl) visual.reverse();
    let before = 0;
    visual.forEach((index) => {
        const child = children[index];
        const shift = before + spreads[index] / 2 - total / 2;
        before += spreads[index];
        child.style.transform = `translate3d(${shift.toFixed(2)}px, 0, 0)`;
        if (!child.classList.contains('dock-item')) return;
        const icon = child.querySelector('.dock-icon');
        if (icon) icon.style.transform = `scale(${(1 + extras[index] / base).toFixed(4)})`;
        child.style.setProperty('--dock-tooltip-lift', `${extras[index].toFixed(1)}px`);
    });
    if (plate) plate.style.left = plate.style.right = `${(-total / 2).toFixed(2)}px`;
}
const dockWaveBlocked = () => Boolean(state.drag) || document.body.classList.contains('global-app-drag-active') || document.body.classList.contains('dock-resizing');

export function bindDockMagnification() {
    const dock = $('dock');
    if (!dock) return;
    const shell = $('dock-shell') || dock;

    const menuOpen = () => document.body.classList.contains('dock-menu-open');
    // While an icon's menu is open the Dock holds its shape, so the menu stays attached
    // to the icon it belongs to; it settles when the menu closes.
    window.addEventListener('macos-dock-menu-closed', () => { if (!shell.matches(':hover')) resetDockWave(); });
    shell.addEventListener('mousemove', (event) => {
        if (menuOpen()) return;
        if (Number(state.config.dock?.magnification ?? 45) <= 0 || dockWaveBlocked()) return resetDockWave();
        dockPointerX = event.clientX;
        if (dockAnimationFrame) return;
        dockAnimationFrame = requestAnimationFrame(() => { dockAnimationFrame = null; if (dockPointerX !== null) applyDockWave(dockPointerX); });
    });

    shell.addEventListener('mouseleave', () => { if (!menuOpen()) resetDockWave(); });
    // Clicking an icon often rebuilds the Dock (an application opened, the Trash filled).
    // The pointer has not moved, so the wave is laid out again around where it still is.
    window.addEventListener('macos-dock-rendered', () => {
        if (dockPointerX === null || dockWaveBlocked() || !shell.matches(':hover')) { if (dockPointerX !== null) resetDockWave(); return; }
        const tracking = dock.classList.contains('is-magnifying');
        if (tracking) { dock.classList.add('is-tracking'); shell.classList.add('is-tracking'); }
        applyDockWave(dockPointerX);
    });
    // Desktop icons use pointer-driven dragging instead of native HTML5 drag events.
    // Reset an already-magnified Dock the moment that drag begins so the Trash target
    // never starts the gesture at a stale enlarged size.
    window.addEventListener('macos-app-drag-state', resetDockWave);
}
// An application that is running without a place in the Dock sits at the end of the
// applications. Dragging its icon in among them keeps it there.
export function bindRunningAppPinning() {
    const dock = $('dock');
    if (!dock) return;
    let dragged = '';
    dock.addEventListener('dragstart', (event) => {
        const item = event.target.closest?.('.dock-running-item');
        if (!item) return;
        dragged = item.dataset.pluginId || '';
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain', item.dataset.title || dragged); } catch { /* no-op */ }
        const icon = item.querySelector('.app-icon-container') || item;
        event.dataTransfer.setDragImage(icon, icon.offsetWidth / 2, icon.offsetHeight / 2);
    });
    dock.addEventListener('dragover', (event) => {
        if (!dragged || event.target.closest?.('.dock-folder-item,.dock-separator,.dock-trash-item')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    });
    dock.addEventListener('drop', (event) => {
        if (!dragged) return;
        event.preventDefault();
        const id = dragged; dragged = '';
        // Before the first pinned icon whose middle is to the right of the pointer.
        const pinned = [...dock.querySelectorAll('.dock-app-item')];
        const rtl = getComputedStyle(dock).direction === 'rtl';
        const next = pinned.find((item) => { const rect = item.getBoundingClientRect(); const middle = rect.left + rect.width / 2; return rtl ? event.clientX > middle : event.clientX < middle; });
        pinApplicationToDock(id, next ? Number(next.dataset.index) : null);
    });
    dock.addEventListener('dragend', () => { dragged = ''; });
}
export function resetDockWave() {
    if (dockAnimationFrame) { cancelAnimationFrame(dockAnimationFrame); dockAnimationFrame = null; }
    dockPointerX = null;
    const dock = $('dock');
    if (!dock) return;
    clearTimeout(dockTrackingTimer); dockTrackingTimer = 0;
    dock.classList.remove('is-magnifying', 'is-tracking');
    $('dock-shell')?.classList.remove('is-magnifying', 'is-tracking');
    [...dock.children].forEach((child) => {
        child.style.transform = '';
        // Slot size always comes from --dock-size; a fixed inline width would go stale
        // as soon as the Dock is resized.
        child.style.removeProperty('width');
        child.style.removeProperty('margin');
        child.style.removeProperty('--dock-tooltip-lift');
        const icon = child.querySelector('.dock-icon');
        if (icon) icon.style.transform = '';
    });
    const plate = $('dock-plate');
    if (plate) plate.style.left = plate.style.right = '';
}

export function bindDockSeparatorResize() {
    const dock = $('dock');
    if (!dock) return;
    dock.addEventListener('mousedown', (event) => {
        const separator = event.target.closest('#dock-resize-separator');
        if (!separator || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        resetDockWave();
        const startY = event.clientY;
        const startSize = effectiveDockSize();
        document.body.classList.add('dock-resizing');
        const onMove = (moveEvent) => {
            const max = dockFitMaxSize();
            const next = Math.max(30, Math.min(max, Math.round(startSize + (startY - moveEvent.clientY) * .48)));
            state.config.dock.size = next;
            document.documentElement.style.setProperty('--dock-size', `${next}px`);
            if ($('dock-size')) $('dock-size').value = String(next);
        };
        const onUp = async () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.classList.remove('dock-resizing');
            await saveConfig();
            renderDock();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
