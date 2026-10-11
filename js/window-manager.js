import { motionScale } from './dev-hooks.js';

const MANAGED_WINDOW_SELECTOR = '.window,.plugin-app-window,.dropdown-menu';
const WINDOW_Z_MIN = 6000;
const WINDOW_Z_MAX = 799999;
// Floating windows (an application's window.level "floating", e.g. a desktop pet) stay above
// every ordinary window, whichever is in front.
const FLOATING_Z = 800000;
// Desktop-level windows (window.level "desktop", e.g. weather drawn over the wallpaper) stay
// behind every ordinary window: above the desktop's icons and widgets, below the first window.
const DESKTOP_Z = 5990;
let activeDragCount = 0;

export function bringManagedWindowToFront(element) {
    if (!element) return;
    if (element.dataset?.windowLevel === 'desktop') {
        element.style.zIndex = String(DESKTOP_Z);
        try { window.dispatchEvent(new CustomEvent('macos-managed-window-activated', { detail: { element, kind: 'plugin', pluginId: element.dataset?.pluginId || '' } })); } catch {}
        return;
    }
    if (element.dataset?.windowLevel === 'floating') {
        element.style.zIndex = String(FLOATING_Z);
        // An accessory's window does not take the menu bar over: the application in front keeps it.
        if (element.dataset.accessory === '1') return;
        try { window.dispatchEvent(new CustomEvent('macos-managed-window-activated', { detail: { element, kind: 'plugin', pluginId: element.dataset?.pluginId || '' } })); } catch {}
        return;
    }
    let maxZ = WINDOW_Z_MIN;
    document.querySelectorAll(MANAGED_WINDOW_SELECTOR).forEach((node) => {
        if (node === element || node.classList.contains('hidden')) return;
        const z = Number.parseInt(getComputedStyle(node).zIndex, 10);
        if (Number.isFinite(z) && z <= WINDOW_Z_MAX) maxZ = Math.max(maxZ, z);
    });
    element.style.zIndex = String(Math.min(WINDOW_Z_MAX, maxZ + 1));
    if (element.matches?.('.window,.plugin-app-window')) {
        try { window.dispatchEvent(new CustomEvent('macos-managed-window-activated', { detail: { element, kind: element.classList.contains('plugin-app-window') ? 'plugin' : 'system', pluginId: element.dataset?.pluginId || '' } })); } catch {}
    }
}

function broadcastGlobalDragState(active, element = null) {
    try {
        window.dispatchEvent(new CustomEvent('macos-managed-window-drag', {
            detail: { active: !!active, kind: element?.classList?.contains('plugin-app-window') ? 'plugin' : 'system' }
        }));
    } catch { /* no-op */ }
}

function enterGlobalDrag(element) {
    const wasIdle = activeDragCount === 0;
    activeDragCount += 1;
    document.body?.classList.add('global-window-drag-active');
    element?.classList.add('window-drag-moving');
    // Only broadcast on the 0 -> 1 edge so apps do not repeatedly pause themselves
    // if another pointer interaction is accidentally nested during a drag.
    if (wasIdle) broadcastGlobalDragState(true, element);
}

function leaveGlobalDrag(element) {
    activeDragCount = Math.max(0, activeDragCount - 1);
    element?.classList.remove('window-drag-moving');
    if (!activeDragCount) {
        document.body?.classList.remove('global-window-drag-active');
        broadcastGlobalDragState(false, element);
    }
}

/**
 * Pointer-captured, compositor-friendly window dragging.
 * The window moves with translate3d during the gesture and commits left/top once.
 * This prevents layout on every pointer sample and keeps iframe surfaces from stealing
 * pointerup/move events while a host window crosses an application window.
 */
export function beginManagedWindowDrag(element, handle, event, {
    minLeft = () => 0,
    maxLeft = (rect) => innerWidth - rect.width,
    minTop = () => 26,
    maxTop = (rect) => innerHeight - Math.min(50, rect.height),
    onEnd = null
} = {}) {
    if (!element || !handle || !event || event.button !== 0) return false;

    bringManagedWindowToFront(element);
    let rect = element.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let startLeft = rect.left;
    let startTop = rect.top;
    let nextDx = 0;
    let nextDy = 0;
    let appliedDx = 0;
    let appliedDy = 0;
    let raf = 0;
    let finished = false;
    let started = false;
    let snap = '';

    // A plain click on a title bar is not a drag. The window is only promoted to a
    // transform layer (and apps are only told a drag is in progress) once the pointer
    // has actually moved.
    const DRAG_THRESHOLD = 3;
    const start = () => {
        started = true;
        // Dragging a zoomed window pulls it out of the zoom: it returns to the size it had
        // before and stays under the pointer at the same relative spot of its title area.
        if (element.dataset.maximized === '1' || element.dataset.snapped) {
            let restore = null;
            try { restore = JSON.parse(element.dataset.restoreRect || 'null'); } catch { /* fall back to the current size */ }
            // A zoomed window is never smaller than what it returns to; a tiled one may be.
            const zoomed = element.dataset.maximized === '1';
            const width = zoomed ? Math.min(restore?.width || rect.width, rect.width) : Math.min(restore?.width || rect.width, innerWidth);
            const height = zoomed ? Math.min(restore?.height || rect.height, rect.height) : Math.min(restore?.height || rect.height, innerHeight - 26);
            const fraction = rect.width ? (startX - rect.left) / rect.width : 0.5;
            element.dataset.maximized = '0';
            delete element.dataset.snapped;
            element.classList.remove('window-zoomed', 'window-zooming');
            startLeft = startX - fraction * width;
            startTop = Math.min(rect.top, startY - 8);
            applyBounds(element, { left: startLeft, top: startTop, width, height });
            rect = element.getBoundingClientRect();
        }
        element.style.left = `${startLeft}px`;
        element.style.top = `${startTop}px`;
        element.style.removeProperty('right');
        element.style.removeProperty('bottom');
        element.style.willChange = 'transform';
        enterGlobalDrag(element);
    };

    const clampDelta = (clientX, clientY) => {
        const lowX = typeof minLeft === 'function' ? Number(minLeft(rect)) : Number(minLeft);
        const highX = typeof maxLeft === 'function' ? Number(maxLeft(rect)) : Number(maxLeft);
        const lowY = typeof minTop === 'function' ? Number(minTop(rect)) : Number(minTop);
        const highY = typeof maxTop === 'function' ? Number(maxTop(rect)) : Number(maxTop);
        const targetLeft = Math.max(Number.isFinite(lowX) ? lowX : -Infinity, Math.min(Number.isFinite(highX) ? highX : Infinity, startLeft + clientX - startX));
        const targetTop = Math.max(Number.isFinite(lowY) ? lowY : -Infinity, Math.min(Number.isFinite(highY) ? highY : Infinity, startTop + clientY - startY));
        nextDx = targetLeft - startLeft;
        nextDy = targetTop - startTop;
    };

    const paint = () => {
        raf = 0;
        appliedDx = nextDx;
        appliedDy = nextDy;
        element.style.transform = `translate3d(${appliedDx}px, ${appliedDy}px, 0)`;
    };

    const schedulePaint = () => {
        if (!raf) raf = requestAnimationFrame(paint);
    };

    const move = (moveEvent) => {
        if (finished || (event.pointerId != null && moveEvent.pointerId !== event.pointerId)) return;
        if (!started) {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
            start();
        }
        clampDelta(moveEvent.clientX, moveEvent.clientY);
        schedulePaint();
        // Held against a screen edge, the window offers to tile there.
        const zone = tilingEnabled() ? snapZone(moveEvent.clientX, moveEvent.clientY) : '';
        if (zone !== snap) { snap = zone && tileBounds(element, zone) ? zone : ''; showSnapPreview(element, snap); }
    };

    const finish = (endEvent, cancelled = false) => {
        if (finished) return;
        finished = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; paint(); }
        try {
            if (event.pointerId != null && handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        } catch { /* no-op */ }
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('pointercancel', cancel, true);
        window.removeEventListener('blur', blur);

        if (started) {
            element.style.transform = '';
            element.style.willChange = '';
            element.style.left = `${startLeft + appliedDx}px`;
            element.style.top = `${startTop + appliedDy}px`;
            leaveGlobalDrag(element);
            showSnapPreview(element, '');
            if (snap && !cancelled) tileManagedWindow(element, snap);
            // The release that ends a drag is not a click on whatever the window was held by.
            if (!cancelled) {
                const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
                window.addEventListener('click', swallow, { capture: true, once: true });
                setTimeout(() => window.removeEventListener('click', swallow, true), 0);
            }
        }
        try { onEnd?.({ cancelled, event: endEvent, left: startLeft + appliedDx, top: startTop + appliedDy }); } catch { /* no-op */ }
    };

    const up = (upEvent) => finish(upEvent, false);
    const cancel = (cancelEvent) => finish(cancelEvent, true);
    const blur = () => finish(null, true);

    // The gesture is followed at document level. Pointer capture is still requested so
    // that frames under the pointer cannot swallow it, but the drag does not depend on
    // the capture being kept: the browser drops it for elements with a CSS resize grip.
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', blur, { once: true });
    try { if (event.pointerId != null) handle.setPointerCapture(event.pointerId); } catch { /* pointer capture is a best effort fallback */ }
    event.preventDefault();
    return true;
}

// ---------------------------------------------------------------------------------
// Window registry: minimise, zoom, hide and the bookkeeping the menu bar and the Dock
// need. System windows and application windows register here and behave the same.
// ---------------------------------------------------------------------------------
const registry = new Map();
const MINIMIZE_MS = 400;
const ZOOM_MS = 280;
const motionOff = () => document.body.classList.contains('dev-disable-animations');
const announceVisibility = (element) => {
    try { window.dispatchEvent(new CustomEvent('macos-window-visibility-changed', { detail: { element, visible: !element.classList.contains('hidden') } })); } catch { /* no-op */ }
};

/**
 * options:
 *   app()         -> application descriptor for the menu bar ({ id, name, ... })
 *   dockTarget()  -> element a minimised window flies to (its Dock icon), or null
 *   minimizable / zoomable (default true)
 */
// ---- glass stays on the screen (see "Glass stays on the screen" in 10-features.css) ----
// A window may hang partly off the screen. Its own glass surface (::before) is then cut back
// to the screen edge with --glass-trim-*, and glass surfaces inside it that cross the edge
// are clipped there (clip-path), so they stay frosted for as much as is on the screen.
const INNER_GLASS = '.mac-acrylic, .plugin-native-glass, .plugin-native-material-bar, .plugin-native-list-header.pinned, .settings-header, .trash-finder-toolbar';
const glassFrames = new WeakMap();
// Whoever follows the windows around (plugin-desktop.js: the layout applications may read,
// windows attached to other windows) is told when one moved, changed size, order or state.
const changeListeners = new Set();
export function onManagedWindowsChanged(fn) { changeListeners.add(fn); }
const windowsChanged = () => { for (const fn of changeListeners) { try { fn(); } catch { /* a listener's own trouble */ } } };
/** Every registered window element still in the document. */
export const managedWindowElements = () => [...registry.keys()].filter((element) => element.isConnected);
export function syncGlassToScreen(element) {
    if (!element?.isConnected) return;
    const rect = element.getBoundingClientRect();
    const shown = !element.classList.contains('hidden') && rect.width > 0 && rect.height > 0;
    const trims = shown ? [-rect.top, rect.right - innerWidth, rect.bottom - innerHeight, -rect.left].map((value) => Math.max(0, Math.ceil(value))) : [0, 0, 0, 0];
    const key = trims.join(',');
    if (element.dataset.glassTrim !== key) {
        element.dataset.glassTrim = key;
        ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
            if (trims[index]) element.style.setProperty(`--glass-trim-${side}`, `${trims[index]}px`);
            else element.style.removeProperty(`--glass-trim-${side}`);
        });
    }
    const over = trims.some(Boolean);
    const surfaces = [...element.querySelectorAll(INNER_GLASS)];
    // A window whose glass is its own trimmed ::before surface is handled above; one that is
    // glass itself (a small system window) goes without blur while it crosses the edge.
    if (element.matches(INNER_GLASS) && !element.matches('.plugin-app-window, #spotlight')) surfaces.push(element);
    for (const surface of surfaces) {
        let clip = '';
        if (over) {
            const box = surface.getBoundingClientRect();
            // Cut where it leaves the screen; generous everywhere else, so shadows stay.
            const cut = [-box.top, box.right - innerWidth, box.bottom - innerHeight, -box.left].map((value) => (value > 0 ? `${Math.ceil(value)}px` : '-200px'));
            if (box.width > 0 && cut.some((value) => value !== '-200px')) clip = `inset(${cut.join(' ')})`;
        }
        if ((surface.dataset.glassClip || '') !== clip) {
            if (clip) { surface.dataset.glassClip = clip; surface.style.clipPath = clip; }
            else { delete surface.dataset.glassClip; surface.style.removeProperty('clip-path'); }
        }
    }
}
function watchGlass(element) {
    const sync = () => {
        windowsChanged();
        if (glassFrames.get(element)) return;
        glassFrames.set(element, requestAnimationFrame(() => { glassFrames.delete(element); syncGlassToScreen(element); }));
    };
    new ResizeObserver(sync).observe(element);
    return sync;
}
addEventListener('resize', () => { for (const element of registry.keys()) syncGlassToScreen(element); });

export function registerManagedWindow(element, options = {}) {
    if (!element || registry.has(element)) return;
    let wasHidden = element.classList.contains('hidden');
    const syncGlass = watchGlass(element);
    const observer = new MutationObserver(() => {
        syncGlass();
        const hidden = element.classList.contains('hidden');
        if (hidden === wasHidden) return;
        wasHidden = hidden;
        // Anything that shows the window again (Dock, a menu command, …) ends its minimised state.
        if (!hidden && !element.classList.contains('window-animating')) delete element.dataset.minimized;
        announceVisibility(element);
    });
    // style: moves (left / top, the transform of a drag); class: shown / hidden.
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
    syncGlass();
    registry.set(element, { minimizable: true, zoomable: true, ...options, observer });
    windowsChanged();
}
export function unregisterManagedWindow(element) {
    const entry = registry.get(element);
    if (!entry) return;
    entry.observer.disconnect();
    registry.delete(element);
    windowsChanged();
    try { window.dispatchEvent(new CustomEvent('macos-window-visibility-changed', { detail: { element, visible: false, closed: true } })); } catch { /* no-op */ }
}
export const managedWindowOptions = (element) => registry.get(element) || null;
export const applicationForWindow = (element) => registry.get(element)?.app?.() || null;
/** Shown, or minimised / hidden but not closed: the application counts as running. */
export const isWindowRunning = (element) => Boolean(element) && (!element.classList.contains('hidden') || element.dataset.minimized === '1');

export function topVisibleManagedWindow() {
    let top = null; let topZ = -Infinity;
    for (const element of registry.keys()) {
        if (!element.isConnected || element.classList.contains('hidden')) continue;
        const z = Number.parseInt(getComputedStyle(element).zIndex, 10) || 0;
        if (z >= topZ) { top = element; topZ = z; }
    }
    return top;
}

// The window travels to its Dock icon and arrives exactly the icon's size, whatever its
// own proportions. Only transforms are animated: fading the window would cut its glass
// off from the wallpaper for the length of the flight.
function flightTarget(element) {
    const rect = element.getBoundingClientRect();
    const target = registry.get(element)?.dockTarget?.()?.getBoundingClientRect?.();
    const size = target?.width || 48;
    const tx = target?.width ? target.left + target.width / 2 : innerWidth / 2;
    const ty = target?.width ? target.top + target.height / 2 : innerHeight - 34;
    return {
        translate: `${(tx - (rect.left + rect.width / 2)).toFixed(1)}px ${(ty - (rect.top + rect.height / 2)).toFixed(1)}px`,
        scale: `${Math.max(0.02, size * 0.82 / Math.max(1, rect.width)).toFixed(4)} ${Math.max(0.02, size * 0.82 / Math.max(1, rect.height)).toFixed(4)}`
    };
}
function runFlight(element, reverse, done) {
    const target = flightTarget(element);
    const rest = { translate: '0px 0px', scale: '1 1' };
    element.classList.add('window-animating');
    // The window first gathers itself and then drops into the Dock. Position and size
    // follow different curves, which gives the path its sweep. Coming back out is the very
    // same animation played backwards, so both directions take the same path and time.
    const options = (easing) => ({ id: 'host-flight', duration: MINIMIZE_MS * motionScale(), easing, fill: 'both', direction: reverse ? 'reverse' : 'normal' });
    const move = element.animate({ translate: [rest.translate, target.translate] }, options('cubic-bezier(.6,.05,.85,.55)'));
    const size = element.animate({ scale: [rest.scale, target.scale] }, options('cubic-bezier(.35,0,.65,.9)'));
    let finished = false;
    const finish = () => {
        if (finished) return; finished = true;
        done();
        move.cancel(); size.cancel();
        element.classList.remove('window-animating');
    };
    move.onfinish = finish; move.oncancel = finish;
}

/** Scale effect: the window shrinks into its Dock icon and stays running. */
export function minimizeManagedWindow(element, { animate = true } = {}) {
    if (!element || element.classList.contains('hidden') || element.classList.contains('window-animating')) return;
    const hide = () => { element.dataset.minimized = '1'; element.classList.add('hidden'); };
    if (!animate || motionOff()) return hide();
    runFlight(element, false, hide);
}
export function restoreManagedWindow(element, { animate = true } = {}) {
    if (!element) return;
    const wasMinimized = element.dataset.minimized === '1';
    const wasHidden = element.classList.contains('hidden');
    delete element.dataset.minimized;
    element.classList.remove('hidden');
    bringManagedWindowToFront(element);
    if (!wasHidden || !wasMinimized || !animate || motionOff()) return;
    runFlight(element, true, () => {});
}
/** Hide without ceremony (application menu “Hide”): the window keeps running. */
export function hideManagedWindow(element) { minimizeManagedWindow(element, { animate: false }); }
export function closeManagedWindow(element) {
    if (!element) return;
    delete element.dataset.minimized;
    element.classList.add('hidden');
}

/** The desktop between the menu bar and the Dock. */
function workArea() {
    const dock = document.getElementById('dock-plate')?.getBoundingClientRect() || document.getElementById('dock-shell')?.getBoundingClientRect();
    const bottom = dock?.height ? Math.max(0, innerHeight - dock.top) + 6 : 6;
    return { left: 0, top: 26, width: innerWidth, height: Math.max(160, innerHeight - 26 - bottom) };
}
// Which edges a window may be resized along, and how far. Zoom takes the window to the
// largest size those rules allow and centres whatever does not fill the work area.
const resizeRules = (element) => ({ x: true, y: true, maxWidth: Infinity, maxHeight: Infinity, ...(registry.get(element)?.resize?.() || {}) });
export const isWindowZoomable = (element) => { const rules = resizeRules(element); return registry.get(element)?.zoomable !== false && (rules.x || rules.y); };
function zoomedBounds(element, rect = element.getBoundingClientRect()) {
    const area = workArea(); const rules = resizeRules(element);
    const width = rules.x ? Math.min(area.width, rules.maxWidth || Infinity) : Math.min(rect.width, area.width);
    const height = rules.y ? Math.min(area.height, rules.maxHeight || Infinity) : Math.min(rect.height, area.height);
    return { left: area.left + (area.width - width) / 2, top: area.top + (area.height - height) / 2, width, height };
}
// bounds are the outer (border-box) rectangle; content-box windows get their frame subtracted.
function applyBounds(element, bounds) {
    const style = getComputedStyle(element);
    const frame = (...sides) => (style.boxSizing === 'border-box' ? 0 : sides.reduce((sum, side) => sum + (parseFloat(style[`border${side}Width`]) || 0) + (parseFloat(style[`padding${side}`]) || 0), 0));
    element.style.left = `${Math.round(bounds.left)}px`;
    element.style.top = `${Math.round(bounds.top)}px`;
    element.style.width = `${Math.round(bounds.width - frame('Left', 'Right'))}px`;
    element.style.height = `${Math.round(bounds.height - frame('Top', 'Bottom'))}px`;
}
// Moves a window to `target` with the zoom animation.
function animateBounds(element, rect, target) {
    element.style.removeProperty('right'); element.style.removeProperty('bottom');
    if (motionOff()) return applyBounds(element, target);
    // Start from explicit pixel values so the browser has two lengths to interpolate.
    applyBounds(element, rect);
    void element.offsetWidth;
    element.classList.add('window-zooming');
    applyBounds(element, target);
    clearTimeout(element.zoomTimer);
    element.zoomTimer = setTimeout(() => element.classList.remove('window-zooming'), ZOOM_MS * motionScale() + 40);
}
/** Green button: fill the space between the menu bar and the Dock, or go back. */
export function toggleZoomManagedWindow(element) {
    if (!element || element.classList.contains('hidden') || !isWindowZoomable(element)) return;
    const zoomed = element.dataset.maximized === '1';
    const rect = element.getBoundingClientRect();
    let target;
    if (zoomed) {
        try { target = JSON.parse(element.dataset.restoreRect || 'null'); } catch { target = null; }
        target ||= { left: Math.max(0, (innerWidth - 720) / 2), top: 60, width: Math.min(720, innerWidth), height: Math.min(500, innerHeight - 120) };
    } else {
        // A tiled window already remembers the size it had before it was tiled.
        if (!element.dataset.snapped) element.dataset.restoreRect = JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        target = zoomedBounds(element, rect);
    }
    delete element.dataset.snapped;
    element.dataset.maximized = zoomed ? '0' : '1';
    element.classList.toggle('window-zoomed', !zoomed);
    animateBounds(element, rect, target);
}

// ---------------------------------------------------------------------------------
// Tiling: a window dragged against the left or right edge takes that half of the desktop,
// against the top it fills it. Dragging it away again gives it back the size it had.
// ---------------------------------------------------------------------------------
let tilingEnabled = () => true;
/** `enabled()` says whether dragging to a screen edge tiles (System Settings ▸ Desktop & Windows). */
export function configureWindowTiling(enabled) { tilingEnabled = typeof enabled === 'function' ? enabled : () => Boolean(enabled); }
const snapZone = (x, y) => (y <= 10 ? 'top' : x <= 8 ? 'left' : x >= innerWidth - 8 ? 'right' : '');
/** Where `zone` ('left' | 'right' | 'top') would put the window, or null if its resize rules do not allow that. */
function tileBounds(element, zone) {
    if (!registry.has(element)) return null;
    if (zone === 'top') return isWindowZoomable(element) ? zoomedBounds(element) : null;
    const rules = resizeRules(element);
    if (!rules.x || !rules.y) return null;
    const area = workArea(); const style = getComputedStyle(element);
    // Half the desktop, or as near to it as the window's own limits allow.
    const width = Math.min(Math.max(Math.floor(area.width / 2), parseFloat(style.minWidth) || 0), rules.maxWidth, area.width);
    const height = Math.min(area.height, rules.maxHeight);
    if (width < (parseFloat(style.minWidth) || 0) || height < (parseFloat(style.minHeight) || 0)) return null;
    return { left: zone === 'left' ? area.left : area.left + area.width - width, top: area.top, width, height };
}
export const canTileManagedWindow = (element, zone) => Boolean(element) && !element.classList.contains('hidden') && Boolean(tileBounds(element, zone));
export function tileManagedWindow(element, zone) {
    if (!canTileManagedWindow(element, zone)) return false;
    if (zone === 'top') { if (element.dataset.maximized !== '1') toggleZoomManagedWindow(element); return true; }
    const rect = element.getBoundingClientRect();
    if (!element.dataset.snapped && element.dataset.maximized !== '1') element.dataset.restoreRect = JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    element.dataset.snapped = zone; element.dataset.maximized = '0';
    element.classList.add('window-zoomed');
    animateBounds(element, rect, tileBounds(element, zone));
    return true;
}
// The translucent outline of where the window will land.
let snapPreview = null;
function showSnapPreview(element, zone) {
    const bounds = zone ? tileBounds(element, zone) : null;
    if (!bounds) { snapPreview?.remove(); snapPreview = null; return; }
    const place = (box) => Object.assign(snapPreview.style, { left: `${box.left + 6}px`, top: `${box.top + 6}px`, width: `${Math.max(0, box.width - 12)}px`, height: `${Math.max(0, box.height - 12)}px` });
    if (!snapPreview) {
        snapPreview = document.createElement('div');
        snapPreview.className = 'window-snap-preview';
        // Just under the window being dragged, above every other one.
        snapPreview.style.zIndex = String((Number.parseInt(element.style.zIndex, 10) || WINDOW_Z_MIN) - 1);
        document.body.appendChild(snapPreview);
        // It grows out of the window itself.
        place(element.getBoundingClientRect());
        void snapPreview.offsetWidth;
    }
    place(bounds);
}
/** Keep zoomed and tiled windows in place when the browser window is resized, and bring
 *  any other window back within reach: 80 px of it on screen and its top below the menu bar
 *  (the rule for dragging by hand). Frameless application windows are placed by
 *  plugin-window-motion.js, which keeps them wholly on screen. */
export function refitZoomedWindows() {
    for (const element of registry.keys()) {
        if (!element.isConnected) continue;
        if (element.dataset.maximized === '1') applyBounds(element, zoomedBounds(element));
        else if (element.dataset.snapped) { const bounds = tileBounds(element, element.dataset.snapped); if (bounds) applyBounds(element, bounds); }
        else if (!element.classList.contains('hidden') && !element.classList.contains('plugin-app-frameless')) {
            const left = parseFloat(element.style.left); const top = parseFloat(element.style.top);
            if (!Number.isFinite(left) || !Number.isFinite(top) || !element.style.left.endsWith('px') || !element.style.top.endsWith('px')) continue;
            const width = element.offsetWidth;
            const x = Math.min(innerWidth - 80, Math.max(80 - width, left));
            const y = Math.min(Math.max(26, innerHeight - 50), Math.max(26, top));
            if (x !== left) element.style.left = `${Math.round(x)}px`;
            if (y !== top) element.style.top = `${Math.round(y)}px`;
        }
    }
}

export function hideOtherManagedWindows(keep) {
    for (const element of registry.keys()) {
        if (element !== keep && element.isConnected && !element.classList.contains('hidden')) hideManagedWindow(element);
    }
}
export function showAllManagedWindows() {
    const front = topVisibleManagedWindow();
    for (const element of registry.keys()) if (element.isConnected && element.dataset.minimized === '1') restoreManagedWindow(element, { animate: false });
    if (front) bringManagedWindowToFront(front);
}
export const otherWindowsVisible = (keep) => [...registry.keys()].some((element) => element !== keep && element.isConnected && !element.classList.contains('hidden'));
export const anyWindowHidden = () => [...registry.keys()].some((element) => element.isConnected && element.dataset.minimized === '1');

/** Every registered window with its state, front to back (Developer Tools). */
export function managedWindowList() {
    return [...registry.entries()].filter(([element]) => element.isConnected).map(([element, options]) => {
        const rect = element.getBoundingClientRect(); const rules = resizeRules(element);
        return {
            element, name: options.app?.()?.name || element.id || 'window', id: options.app?.()?.id || element.id || '',
            state: element.dataset.minimized === '1' ? 'minimized' : element.classList.contains('hidden') ? 'closed' : element.dataset.maximized === '1' ? 'zoomed' : 'open',
            z: Number.parseInt(getComputedStyle(element).zIndex, 10) || 0,
            bounds: [Math.round(rect.left), Math.round(rect.top), element.offsetWidth, element.offsetHeight],
            resize: rules.x && rules.y ? 'both' : rules.x ? 'horizontal' : rules.y ? 'vertical' : 'none',
            max: [Number.isFinite(rules.maxWidth) ? rules.maxWidth : 0, Number.isFinite(rules.maxHeight) ? rules.maxHeight : 0]
        };
    }).sort((a, b) => b.z - a.z);
}
