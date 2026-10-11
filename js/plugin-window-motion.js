// Windows that move themselves: where a window is and how big the desktop is
// (macos.window.getFrame), moving it (moveTo, optionally animated), letting the user drag
// it by any part the application chooses (beginDrag — for frameless windows such as a
// desktop pet), where the pointer is on the desktop (trackPointer, permission: pointer),
// and keeping such windows on screen when the browser window changes size.

import { appWindows, postToPlugin, requirePermission } from './plugin-core.js';
import { bringManagedWindowToFront } from './window-manager.js';

const MENU_BAR = 26;
const isFrameless = (record) => record.plugin.window.titlebar === 'none';

/** The desktop as an application sees it: its size, the menu bar and the Dock. */
export function screenInfo() {
    const plate = document.getElementById('dock-plate') || document.getElementById('dock');
    const box = plate?.getBoundingClientRect();
    const dock = box?.width && !document.body.classList.contains('dock-hidden')
        ? { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height), radius: Math.round(parseFloat(getComputedStyle(plate).borderTopLeftRadius) || 0) } : null;
    return { width: innerWidth, height: innerHeight, top: MENU_BAR, bottom: dock ? dock.y : innerHeight, dock };
}
export function windowFrame(record) {
    const win = record.window;
    return { x: Math.round(parseFloat(win.style.left) || win.offsetLeft), y: Math.round(parseFloat(win.style.top) || win.offsetTop), width: win.offsetWidth, height: win.offsetHeight, screen: screenInfo() };
}
// Where a window may go. A frameless window stays entirely on the desktop (below the menu
// bar); one with a title bar keeps 80 px of it reachable, the rule for dragging by hand.
function clampPosition(record, x, y) {
    const win = record.window; const width = win.offsetWidth; const height = win.offsetHeight;
    const [minX, maxX, minY, maxY] = isFrameless(record)
        // 2 px clear of the screen edge (the window's clip is antialiased a pixel beyond it) —
        // unless the window is as large as the desktop, which then sits exactly on it.
        ? [width >= innerWidth - 4 ? 0 : 2, Math.max(width >= innerWidth - 4 ? 0 : 2, innerWidth - width - 2), MENU_BAR, Math.max(MENU_BAR, innerHeight - height - (height >= innerHeight - MENU_BAR - 4 ? 0 : 2))]
        : [80 - width, innerWidth - 80, MENU_BAR, innerHeight - 50];
    const cx = Math.min(maxX, Math.max(minX, Math.round(x))); const cy = Math.min(maxY, Math.max(minY, Math.round(y)));
    return { x: cx, y: cy, clamped: cx !== Math.round(x) || cy !== Math.round(y) };
}
function place(record, x, y, following = false) {
    const spot = clampPosition(record, x, y);
    record.window.style.left = `${spot.x}px`;
    record.window.style.top = `${spot.y}px`;
    // A window that moved itself keeps its new place on whatever it is attached to.
    if (!following && record.anchor) measureAnchor(record);
    return spot;
}

// ---- attached windows --------------------------------------------------------------------
// macos.window.attach(id, { edge }): the window keeps its place relative to another window's
// top or bottom edge (or the Dock's top) and travels with it — a pet standing on a window
// that is being dragged. The host moves it in the same frame as its carrier; it lets go
// ('detached' { reason }) when the carrier closes, is minimised or hidden.
const anchored = new Set();
const anchorBox = (anchor) => anchor.element.getBoundingClientRect();
function measureAnchor(record) {
    const anchor = record.anchor; const box = anchorBox(anchor);
    anchor.dx = (parseFloat(record.window.style.left) || 0) - box.left;
    anchor.dy = (parseFloat(record.window.style.top) || 0) - (anchor.edge === 'bottom' ? box.bottom : box.top);
}
export function attachWindow(record, element, edge) {
    if (!element) { record.anchor = null; anchored.delete(record); return false; }
    record.anchor = { element, edge: edge === 'bottom' ? 'bottom' : 'top', dx: 0, dy: 0 };
    measureAnchor(record);
    anchored.add(record);
    return true;
}
export const hasAnchoredWindows = () => anchored.size > 0;
const carrierGone = (element) => !element.isConnected || element.classList.contains('hidden') || element.classList.contains('window-animating') || element.getBoundingClientRect().width === 0;
/** Moves every attached window to where its carrier is now. */
export function followAnchors() {
    for (const record of anchored) {
        const anchor = record.anchor;
        if (appWindows.get(record.key) !== record || !anchor) { anchored.delete(record); continue; }
        if (carrierGone(anchor.element)) {
            record.anchor = null; anchored.delete(record);
            postToPlugin(record, { type: 'event', name: 'detached', detail: { reason: anchor.element.isConnected ? 'hidden' : 'closed', frame: windowFrame(record) } });
            continue;
        }
        if (record.drag || record.motion) continue;   // moving by itself: place() keeps the offset
        const box = anchorBox(anchor);
        const x = Math.round(box.left + anchor.dx); const y = Math.round((anchor.edge === 'bottom' ? box.bottom : box.top) + anchor.dy);
        if (x !== Math.round(parseFloat(record.window.style.left)) || y !== Math.round(parseFloat(record.window.style.top))) place(record, x, y, true);
    }
}
function stopMotion(record) {
    const motion = record.motion;
    record.motion = null;
    if (motion) { cancelAnimationFrame(motion.frame); motion.finish(true); }
}

/** moveTo { x, y, duration (ms, 0–20000), easing: 'linear' | 'ease' | 'in' | 'out' } -> frame once there. */
export function moveWindow(record, payload = {}) {
    // Being carried by the user: the hand wins, and the application is told so.
    if (record.drag) return { ...windowFrame(record), clamped: false, cancelled: true };
    stopMotion(record);
    const target = { x: Number(payload.x), y: Number(payload.y) };
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('moveTo needs numeric x and y');
    const duration = Math.max(0, Math.min(20000, Number(payload.duration) || 0));
    const from = windowFrame(record);
    const end = clampPosition(record, target.x, target.y);
    if (!duration || document.hidden) { place(record, end.x, end.y); return { ...windowFrame(record), clamped: end.clamped, cancelled: false }; }
    // 'ease': gently off and gently there; 'in': gathering speed, as something falling does;
    // 'out': losing it, as something thrown upwards does.
    const ease = payload.easing === 'ease' ? (t) => t * t * (3 - 2 * t) : payload.easing === 'in' ? (t) => t * t : payload.easing === 'out' ? (t) => 1 - (1 - t) * (1 - t) : (t) => t;
    return new Promise((resolve) => {
        const start = performance.now();
        const motion = {
            frame: 0,
            finish: (cancelled) => resolve({ ...windowFrame(record), clamped: end.clamped, cancelled })
        };
        const step = (now) => {
            if (record.motion !== motion) return;
            const t = Math.min(1, (now - start) / duration);
            place(record, from.x + (end.x - from.x) * ease(t), from.y + (end.y - from.y) * ease(t));
            if (t < 1) motion.frame = requestAnimationFrame(step);
            else { record.motion = null; motion.finish(false); }
        };
        record.motion = motion;
        motion.frame = requestAnimationFrame(step);
    });
}

// Dragging by the application's own surface. The runtime sends the pointer's travel since it
// went down ({ phase: 'start' | 'move' | 'end', dx, dy }, and with 'start' where on the screen
// that was). The pointer events themselves stay in the application's document, which the
// host cannot see into; this is no more than moveTo, with the same rule that the window
// stays on the desktop.
// The application's document can lose the pointer in the middle of it — the window lags a
// frame behind, the pointer is over the desktop or beyond what the window's shape leaves of
// it, and the release happens there. Then the events arrive here instead, and the host
// carries the drag on and ends it itself ('drag-end' to the runtime), so a window is never
// left hanging on a pointer that was let go.
const selfDrags = new Set();
function finishDrag(record, dx, dy, fromHost) {
    const drag = record.drag;
    if (!drag) return null;
    const spot = place(record, drag.x + dx, drag.y + dy);
    record.drag = null;
    selfDrags.delete(record);
    record.window.classList.remove('plugin-app-self-dragging');
    if (!selfDrags.size) { document.body.classList.remove('plugin-self-dragging'); unwatchSelfDrags(); }
    // Its document and the host may each have seen a part of the way: the host's samples hold
    // both (the runtime reports its moves), so the speed at the end is taken from them.
    if (drag.screenX !== null) drag.samples.push({ x: drag.screenX + dx, y: drag.screenY + dy, t: performance.now() });
    const frame = { ...windowFrame(record), clamped: spot.clamped, velocity: dragVelocity(drag) };
    // Where the window takes the pointer was left alone while it was carried.
    if (hitWindows.has(record) && (fromHost || drag.hitInside !== undefined)) setFrameHit(record, fromHost ? false : drag.hitInside);
    if (fromHost) postToPlugin(record, { type: 'drag-end', frame });
    return frame;
}
// How fast the pointer was going when it was let go (px/s), from the last tenth of a second.
function dragVelocity(drag) {
    const now = performance.now(); const recent = (drag.samples || []).filter((sample) => now - sample.t < 110);
    if (recent.length < 2) return { x: 0, y: 0 };
    const a = recent[0]; const b = recent[recent.length - 1]; const dt = Math.max(0.012, (b.t - a.t) / 1000);
    return { x: Math.round((b.x - a.x) / dt), y: Math.round((b.y - a.y) / dt) };
}
function onSelfDragPointer(event) {
    for (const record of [...selfDrags]) {
        const drag = record.drag;
        if (appWindows.get(record.key) !== record || !drag) { selfDrags.delete(record); continue; }
        if (drag.screenX === null) { if (event.type !== 'pointermove' || !(event.buttons & 1)) finishDrag(record, drag.dx, drag.dy, true); continue; }
        const dx = event.screenX - drag.screenX; const dy = event.screenY - drag.screenY;
        if (event.type === 'pointermove' && (event.buttons & 1)) {
            drag.dx = dx; drag.dy = dy; place(record, drag.x + dx, drag.y + dy);
            drag.samples.push({ x: event.screenX, y: event.screenY, t: performance.now() }); if (drag.samples.length > 12) drag.samples.shift();
        }
        else {
            finishDrag(record, event.type === 'pointerup' ? dx : drag.dx, event.type === 'pointerup' ? dy : drag.dy, true);
        }
    }
}
const endSelfDrags = () => { for (const record of [...selfDrags]) finishDrag(record, record.drag?.dx || 0, record.drag?.dy || 0, true); };
let watchingSelfDrags = false;
function watchSelfDrags() {
    if (watchingSelfDrags) return;
    watchingSelfDrags = true;
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) document.addEventListener(type, onSelfDragPointer, { capture: true, passive: true });
    window.addEventListener('blur', endSelfDrags);
}
function unwatchSelfDrags() {
    if (!watchingSelfDrags) return;
    watchingSelfDrags = false;
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) document.removeEventListener(type, onSelfDragPointer, { capture: true });
    window.removeEventListener('blur', endSelfDrags);
}
export function dragWindow(record, payload = {}) {
    const phase = String(payload.phase || '');
    if (phase === 'start') {
        stopMotion(record);
        if (record.drag) finishDrag(record, record.drag.dx, record.drag.dy, false);
        bringManagedWindowToFront(record.window);
        const frame = windowFrame(record);
        const screenX = Number(payload.screenX); const screenY = Number(payload.screenY);
        record.drag = { x: frame.x, y: frame.y, dx: 0, dy: 0, screenX: Number.isFinite(screenX) && Number.isFinite(screenY) ? screenX : null, screenY, hitInside: undefined, samples: Number.isFinite(screenX) && Number.isFinite(screenY) ? [{ x: screenX, y: screenY, t: performance.now() }] : [] };
        record.window.classList.add('plugin-app-self-dragging');
        // No other application's document takes the pointer meanwhile: what this one loses
        // has to arrive at the host.
        document.body.classList.add('plugin-self-dragging');
        selfDrags.add(record);
        watchSelfDrags();
        return frame;
    }
    if (!record.drag) return null;
    const dx = Number(payload.dx) || 0; const dy = Number(payload.dy) || 0;
    if (phase === 'end') return finishDrag(record, dx, dy, false);
    record.drag.dx = dx; record.drag.dy = dy;
    if (record.drag.screenX !== null) { record.drag.samples.push({ x: record.drag.screenX + dx, y: record.drag.screenY + dy, t: performance.now() }); if (record.drag.samples.length > 12) record.drag.samples.shift(); }
    const spot = place(record, record.drag.x + dx, record.drag.y + dy);
    return { ...windowFrame(record), clamped: spot.clamped };
}
/** The window closed in the middle of being carried. */
export function forgetDrag(record) {
    if (!record.drag) return;
    record.drag = null; selfDrags.delete(record);
    if (!selfDrags.size) { document.body.classList.remove('plugin-self-dragging'); unwatchSelfDrags(); }
}

// ---- the shape of a frameless window ---------------------------------------------------
// A frameless window is a rectangle, but what it draws need not be. setShape lists the
// rectangles (window CSS px) it really covers; the window is clipped to their union with
// clip-path, which also clips hit testing, so a click on the rest goes to whatever is
// underneath — the desktop, its icons, another window. null makes it a rectangle again.
const MAX_SHAPE_RECTS = 400;
export function setWindowShape(record, payload = {}) {
    if (!isFrameless(record)) throw new Error('Only a frameless window (titlebar "none") can have a shape');
    const win = record.window;
    if (payload.rects == null) { win.style.removeProperty('clip-path'); record.shapeKey = ''; return true; }
    if (!Array.isArray(payload.rects)) throw new Error('setShape takes a list of [x, y, width, height] rectangles, or null');
    const width = win.offsetWidth; const height = win.offsetHeight;
    const parts = [];
    for (const rect of payload.rects.slice(0, MAX_SHAPE_RECTS)) {
        const [x, y, w, h] = (Array.isArray(rect) ? rect : [rect?.x, rect?.y, rect?.width, rect?.height]).map(Number);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        const left = Math.max(0, Math.min(width, x)); const top = Math.max(0, Math.min(height, y));
        const right = Math.max(left, Math.min(width, x + w)); const bottom = Math.max(top, Math.min(height, y + h));
        if (right - left < 0.5 || bottom - top < 0.5) continue;
        const r = (n) => Math.round(n * 2) / 2;
        // Every rectangle is drawn clockwise, so with the nonzero rule overlaps add up to a union.
        parts.push(`M${r(left)} ${r(top)}H${r(right)}V${r(bottom)}H${r(left)}Z`);
    }
    // Nothing left to click at all would make the window unreachable; keep a pixel of it.
    const path = parts.length ? parts.join('') : 'M0 0H1V1H0Z';
    if (path !== record.shapeKey) { win.style.clipPath = `path('${path}')`; record.shapeKey = path; }
    return parts.length;
}

// ---- what takes the pointer --------------------------------------------------------------
// setShape cuts the window, picture and all. setHitRegion leaves the picture alone and says
// where the window takes the pointer: the rectangles given (window CSS px). Everywhere else a
// click goes to whatever is underneath, although the window is drawn there — rain over the
// whole desktop with one small panel that can be clicked.
// The application's document cannot be half transparent to the pointer, so its frame is
// switched: off while the pointer is elsewhere (the host sees the pointer then, and switches
// the frame on when it enters a rectangle), on while it is inside one (the runtime sees the
// pointer then, and reports when it leaves).
const hitWindows = new Set();
let hitListening = false;
function setFrameHit(record, on) {
    record.hitInside = on;
    record.iframe.style.pointerEvents = on ? 'auto' : 'none';
}
function onHitMove(event) {
    for (const record of hitWindows) {
        if (record.hitInside || appWindows.get(record.key) !== record || record.window.classList.contains('hidden')) continue;
        const box = record.window.getBoundingClientRect();
        const x = event.clientX - box.left; const y = event.clientY - box.top;
        if (record.hitRects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh)) setFrameHit(record, true);
    }
}
function syncHitListener() {
    if (hitWindows.size && !hitListening) { document.addEventListener('pointermove', onHitMove, { capture: true, passive: true }); hitListening = true; }
    if (!hitWindows.size && hitListening) { document.removeEventListener('pointermove', onHitMove, { capture: true }); hitListening = false; }
}
export function setHitRegion(record, payload = {}) {
    if (!isFrameless(record)) throw new Error('Only a frameless window (titlebar "none") can set where it takes the pointer');
    if (record.runtimeApp?.mode === 'native') throw new Error('setHitRegion is for Web Apps');
    const win = record.window;
    if (payload.rects == null) {
        hitWindows.delete(record); record.hitRects = null;
        win.style.removeProperty('pointer-events'); record.iframe.style.removeProperty('pointer-events');
        syncHitListener();
        return true;
    }
    if (!Array.isArray(payload.rects)) throw new Error('setHitRegion takes a list of [x, y, width, height] rectangles, or null');
    record.hitRects = payload.rects.slice(0, 64).map((rect) => (Array.isArray(rect) ? rect : [rect?.x, rect?.y, rect?.width, rect?.height]).map(Number))
        .filter((rect) => rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0);
    win.style.pointerEvents = 'none';
    // While the window is carried its document keeps the pointer, wherever the pointer is
    // just now; what was asked for takes effect when it is put down.
    const inside = Boolean(payload.inside) && record.hitRects.length > 0;
    if (record.drag) { record.drag.hitInside = inside; setFrameHit(record, true); } else setFrameHit(record, inside);
    hitWindows.add(record);
    syncHitListener();
    return record.hitRects.length;
}
/** The runtime saw the pointer leave every rectangle. */
export function leaveHitRegion(record) {
    if (record.drag) { record.drag.hitInside = false; return true; }
    if (hitWindows.has(record)) setFrameHit(record, false);
    return true;
}

// Which layer a window is on: 'desktop' (behind every window, over the desktop and its
// widgets), 'normal', or 'floating' (over every window). The manifest's window.level, or
// macos.window.setLevel() while running.
export function setWindowLevel(record, payload = {}) {
    const level = ['desktop', 'floating'].includes(payload.level) ? payload.level : 'normal';
    if (level === 'normal') delete record.window.dataset.windowLevel; else record.window.dataset.windowLevel = level;
    bringManagedWindowToFront(record.window);
    return level;
}

// ---- the pointer on the desktop (permission: pointer) ----------------------------------
// Only while the page is visible, only positions over the desktop itself (not inside other
// applications' own documents), at most ~16 times a second per window.
const tracking = new Set();
let listening = false;
function onPointerMove(event) {
    if (document.hidden) return;
    const now = performance.now();
    for (const record of tracking) {
        if (appWindows.get(record.key) !== record || record.window.classList.contains('hidden')) continue;
        if (now - (record.pointerSent || 0) < 60) continue;
        record.pointerSent = now;
        const box = record.window.getBoundingClientRect();
        postToPlugin(record, { type: 'event', name: 'pointerposition', detail: { x: Math.round(event.clientX - box.left), y: Math.round(event.clientY - box.top), screenX: Math.round(event.clientX), screenY: Math.round(event.clientY) } });
    }
}
export function trackPointer(record, on) {
    requirePermission(record.plugin, 'pointer');
    if (on) tracking.add(record); else tracking.delete(record);
    if (tracking.size && !listening) { document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true }); listening = true; }
    if (!tracking.size && listening) { document.removeEventListener('pointermove', onPointerMove, { capture: true }); listening = false; }
    return Boolean(on);
}
export function forgetWindowMotion(record) {
    stopMotion(record);
    tracking.delete(record);
    anchored.delete(record); record.anchor = null;
    forgetDrag(record);
    hitWindows.delete(record); syncHitListener();
    if (!tracking.size && listening) { document.removeEventListener('pointermove', onPointerMove, { capture: true }); listening = false; }
}

// The browser window changed size: frameless windows come back fully onto the desktop, and
// every application is told about the new desktop ('screenchange' { screen, frame, moved }).
let resizeTimer = 0;
export function bindScreenChanges() {
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            for (const record of appWindows.values()) {
                let moved = false;
                if (isFrameless(record) && !record.drag) {
                    const frame = windowFrame(record);
                    const spot = clampPosition(record, frame.x, frame.y);
                    if (spot.clamped) { stopMotion(record); place(record, spot.x, spot.y); moved = true; }
                }
                postToPlugin(record, { type: 'event', name: 'screenchange', detail: { screen: screenInfo(), frame: windowFrame(record), moved } });
            }
        }, 160);
    });
}
