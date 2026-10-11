// What applications may know about each other on the desktop, and say to each other.
//
//   macos.desktop.getLayout() / watch()   permission: windows
//       where the Dock and every window on the desktop are — so snow can settle on a window
//       and a pet can stand on one. Places and sizes only: never a title or anything inside.
//   macos.window.attach(id, { edge })
//       this window travels with another one (plugin-window-motion.js does the moving).
//   macos.apps.send(appId, message) / 'message'
//       two applications that name each other under "peers" in their manifests can talk.
//       Nothing reaches an application that did not name the sender.

import { appWindows, instancesOf, jsonSize, postToPlugin, postWhenReady, requirePermission } from './plugin-core.js';
import { managedWindowElements, onManagedWindowsChanged } from './window-manager.js';
import { attachWindow, followAnchors, hasAnchoredWindows, screenInfo } from './plugin-window-motion.js';

// ---- the layout ----------------------------------------------------------------------------
const systemIds = new WeakMap();
let systemSequence = 0;
function idOf(element) {
    if (element.classList.contains('plugin-app-window')) {
        for (const record of appWindows.values()) if (record.window === element) return record.key;
    }
    if (element.id) return `system:${element.id}`;
    if (!systemIds.has(element)) systemIds.set(element, `system:window-${(systemSequence += 1)}`);
    return systemIds.get(element);
}
function elementOf(id) {
    if (id === 'dock') return document.getElementById('dock-plate');
    if (id === SPOTLIGHT) return document.getElementById('spotlight');
    if (String(id).startsWith('widget:')) return [...document.querySelectorAll(WIDGETS)].find((card) => `widget:${card.dataset.widgetId}` === id) || null;
    const record = appWindows.get(String(id));
    if (record) return record.window;
    return managedWindowElements().find((element) => idOf(element) === id) || null;
}
// Spotlight is not a window anyone manages, but it is one to look at: it is listed with them.
const SPOTLIGHT = 'system:spotlight';
const WIDGETS = '#desktop-widget-layer .widget-card';
const boxOf = (element, style = getComputedStyle(element)) => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height), radius: Math.round(parseFloat(style.borderTopLeftRadius) || 0) };
};
/** { screen, dock, windows: front to back, widgets } — what is shown, in desktop CSS px. */
function desktopLayout() {
    const windows = [];
    const spotlight = document.getElementById('spotlight');
    if (spotlight && !spotlight.classList.contains('hidden') && spotlight.offsetWidth) {
        const style = getComputedStyle(spotlight);
        if (style.visibility !== 'hidden' && Number(style.opacity) > 0.5) windows.push({ id: SPOTLIGHT, app: '', system: true, ...boxOf(spotlight, style), level: 'normal', frameless: false, z: Number.parseInt(style.zIndex, 10) || 0 });
    }
    // The widgets on the desktop lie under every window: places to stand, not things in the way.
    const widgets = document.getElementById('launchpad')?.classList.contains('active') ? [] : [...document.querySelectorAll(WIDGETS)].filter((card) => card.offsetWidth && !card.classList.contains('widget-offscreen'))
        .map((card) => ({ id: `widget:${card.dataset.widgetId || ''}`, ...boxOf(card) }));
    for (const element of managedWindowElements()) {
        if (element.classList.contains('hidden') || element.classList.contains('window-animating')) continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const style = getComputedStyle(element);
        const plugin = element.classList.contains('plugin-app-window');
        windows.push({
            id: idOf(element), app: plugin ? element.dataset.pluginId || '' : '', system: !plugin,
            x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height),
            radius: Math.round(parseFloat(style.borderTopLeftRadius) || 0),
            level: element.dataset.windowLevel || 'normal', frameless: element.classList.contains('plugin-app-frameless'),
            z: Number.parseInt(style.zIndex, 10) || 0
        });
    }
    windows.sort((a, b) => b.z - a.z);
    const screen = screenInfo();
    return { screen, dock: screen.dock, windows, widgets };
}
const layoutFor = (record, layout) => ({ ...layout, windows: layout.windows.map((item) => ({ ...item, own: item.id === record.key })) });

// ---- watching it ---------------------------------------------------------------------------
// One look per frame while something moves, and for a little longer: a zoom or the Dock's
// magnification is a CSS transition, which changes no attribute on its way.
const watchers = new Set();
let frame = 0; let settleUntil = 0; let lastKey = '';
function tick() {
    frame = 0;
    followAnchors();
    for (const record of watchers) if (appWindows.get(record.key) !== record) watchers.delete(record);
    if (watchers.size && !document.hidden) {
        const layout = desktopLayout();
        const key = JSON.stringify(layout);
        if (key !== lastKey) {
            lastKey = key;
            for (const record of watchers) postToPlugin(record, { type: 'event', name: 'desktopchange', detail: layoutFor(record, layout) });
        }
    }
    if (performance.now() < settleUntil && (watchers.size || hasAnchoredWindows())) frame = requestAnimationFrame(tick);
}
function changed() {
    if (!watchers.size && !hasAnchoredWindows()) return;
    settleUntil = performance.now() + 450;
    if (!frame) frame = requestAnimationFrame(tick);
}
let bound = false;
function bind() {
    if (bound) return; bound = true;
    onManagedWindowsChanged(changed);
    addEventListener('resize', changed);
    const dock = document.getElementById('dock-shell') || document.getElementById('dock');
    if (dock) {
        new ResizeObserver(changed).observe(dock);
        const plate = document.getElementById('dock-plate');
        if (plate) new ResizeObserver(changed).observe(plate);
        new MutationObserver(changed).observe(dock, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
        // The magnification wave follows the pointer without touching an attribute of the plate.
        dock.addEventListener('pointermove', changed, { passive: true });
        dock.addEventListener('pointerleave', changed, { passive: true });
    }
    new MutationObserver(changed).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const spotlight = document.getElementById('spotlight');
    if (spotlight) new MutationObserver(changed).observe(spotlight, { attributes: true, attributeFilter: ['class', 'style'] });
    const widgetLayer = document.getElementById('desktop-widget-layer');
    if (widgetLayer) new MutationObserver(changed).observe(widgetLayer, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
}

// ---- messages between applications ---------------------------------------------------------
const namesPeer = (plugin, id) => Array.isArray(plugin.peers) && plugin.peers.includes(id);
function sendToPeer(record, payload) {
    const to = String(payload?.to || '');
    if (!namesPeer(record.plugin, to)) throw new Error(`"${to}" is not listed under "peers" in this application's manifest`);
    const message = payload?.message;
    if (jsonSize(message) > 16_000) throw new Error('A message to another application may be at most 16 KB');
    let delivered = 0;
    for (const other of instancesOf(to)) {
        // Both sides have to name each other: an application never hears from a stranger.
        if (!namesPeer(other.plugin, record.plugin.id)) continue;
        postWhenReady(other, { type: 'event', name: 'message', detail: { from: record.plugin.id, message: structuredClone(message ?? null) } });
        delivered += 1;
    }
    return delivered > 0;
}
/** Tells the applications that name `plugin` as a peer that it started or quit: 'peerchange' { id, running }. */
export function announcePeer(plugin, running) {
    for (const record of appWindows.values()) {
        if (record.plugin.id === plugin.id || !namesPeer(record.plugin, plugin.id) || !namesPeer(plugin, record.plugin.id)) continue;
        postWhenReady(record, { type: 'event', name: 'peerchange', detail: { id: plugin.id, running: Boolean(running) } });
    }
}

/** Requests of this module: desktop.*, apps.*, window.attach. Returns undefined for anything else. */
export function handleDesktopRequest(record, method, payload) {
    if (method === 'desktop.getLayout' || method === 'desktop.watch') {
        requirePermission(record.plugin, 'windows');
        bind();
        if (method === 'desktop.watch') { if (payload?.on === false) watchers.delete(record); else watchers.add(record); }
        return layoutFor(record, desktopLayout());
    }
    if (method === 'window.attach') {
        if (payload?.id == null) return attachWindow(record, null);
        requirePermission(record.plugin, 'windows');
        const element = elementOf(String(payload.id));
        if (!element || element === record.window || element.classList.contains('hidden')) throw new Error('There is no such window to attach to');
        bind();
        const attached = attachWindow(record, element, payload.edge);
        changed();
        return attached;
    }
    if (method === 'apps.send') return sendToPeer(record, payload);
    if (method === 'apps.peers') {
        return (record.plugin.peers || []).map((id) => ({ id, running: instancesOf(id).some((other) => namesPeer(other.plugin, record.plugin.id)) }));
    }
    return undefined;
}
export function forgetDesktopWatcher(record) { watchers.delete(record); }
