// Instrumentation shared by the host modules and Developer Tools (devtools.js).
//
// Everything here is inert until Developer Mode switches Developer Tools on: devEmit()
// returns at once, no overrides apply, and animations run at their normal speed. This
// module has no imports, so any host module may use it.

const LIMIT = 1500;
export const dev = {
    enabled: false,          // Developer Mode ▸ Developer Tools
    slowMotion: 1,           // animations take this many times longer (Developer Mode)
    entries: [],             // ring buffer of { at, kind, ... }
    listeners: new Set(),
    overrides: new Map(),    // application id -> { language, theme, deny: [], offline, storageFull, zoom }
    recorder: null,          // { app: instance key, start, events: [{ t, name, detail }] } while recording
    replaying: false,        // a recording is being played back (its events are not recorded again)
    counters: new Map()      // render surface -> { drawn, skipped }
};

/** Record something for the Developer Tools console / monitors. kind: api | log | event | crash | perf | system | config | render */
export function devEmit(kind, detail = {}) {
    if (!dev.enabled) return;
    const entry = { at: Date.now(), kind, ...detail };
    dev.entries.push(entry);
    if (dev.entries.length > LIMIT) dev.entries.splice(0, dev.entries.length - LIMIT);
    for (const listener of dev.listeners) { try { listener(entry); } catch { /* a monitor must never break the host */ } }
}
export function devCount(surface, skipped) {
    if (!dev.enabled) return;
    const entry = dev.counters.get(surface) || { drawn: 0, skipped: 0 };
    if (skipped) entry.skipped += 1; else entry.drawn += 1;
    dev.counters.set(surface, entry);
}
/** Simulated conditions for one application, or null. */
export const devOverride = (appId) => (dev.enabled ? dev.overrides.get(appId) || null : null);
/** Multiply animation durations by this (1 unless slow motion is on). */
export const motionScale = () => Math.max(1, Number(dev.slowMotion) || 1);

// A compact, bounded description of a value for the console.
export function devPreview(value, limit = 160) {
    let text;
    try { text = typeof value === 'string' ? value : JSON.stringify(value, (_key, item) => (typeof item === 'string' && item.length > 80 ? `${item.slice(0, 77)}…` : item)); } catch { text = String(value); }
    text = text === undefined ? '' : String(text);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Slow motion for CSS transitions and animations: each one is slowed as it starts. The
// host's scripted animations (window flights, native transitions) scale their own duration.
let slowBound = false;
export function bindSlowMotion() {
    if (slowBound) return; slowBound = true;
    const slow = (event) => {
        const scale = motionScale();
        if (scale === 1 || !event.target?.getAnimations) return;
        for (const animation of event.target.getAnimations()) if (animation.playbackRate === 1 && !animation.id?.startsWith('host-')) animation.playbackRate = 1 / scale;
    };
    document.addEventListener('transitionrun', slow, true);
    document.addEventListener('animationstart', slow, true);
}

// Internal events (CustomEvents named macos-*) are recorded as they are dispatched.
let eventsBound = false;
export function bindEventMonitor() {
    if (eventsBound) return; eventsBound = true;
    const original = window.dispatchEvent.bind(window);
    window.dispatchEvent = (event) => {
        if (dev.enabled && typeof event?.type === 'string' && event.type.startsWith('macos-')) {
            const detail = event.detail;
            devEmit('system', { name: event.type, text: detail && typeof detail === 'object' ? devPreview(Object.fromEntries(Object.entries(detail).filter(([, value]) => !(value instanceof Element)))) : devPreview(detail ?? '') });
        }
        return original(event);
    };
}
