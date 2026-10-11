import { state } from './state.js';
import { clamp } from './utils.js';

export function virtualNowMs(config = state.config) {
    const dev = config?.developer;
    if (!dev?.enabled) return Date.now();
    const scale = clamp(Number(dev.timeScale) || 1, 0.5, 3600);
    const realBase = Number(dev.baseRealMs) || Date.now();
    const virtualBase = Number(dev.baseVirtualMs) || realBase;
    return virtualBase + (Date.now() - realBase) * scale;
}

export function virtualNow(config = state.config) {
    return new Date(virtualNowMs(config));
}

export function rebaseDeveloperClock({ enabled, scale } = {}) {
    const current = virtualNowMs();
    state.config.developer ||= { enabled: false, timeScale: 1, baseRealMs: Date.now(), baseVirtualMs: Date.now() };
    const dev = state.config.developer;
    if (typeof enabled === 'boolean') dev.enabled = enabled;
    if (Number.isFinite(Number(scale))) dev.timeScale = clamp(Number(scale), 0.5, 3600);
    dev.baseRealMs = Date.now();
    dev.baseVirtualMs = dev.enabled ? current : dev.baseRealMs;
    return dev;
}

export function resetDeveloperClock() {
    state.config.developer ||= {};
    state.config.developer.baseRealMs = Date.now();
    state.config.developer.baseVirtualMs = Date.now();
}
