import { state } from './state.js';

// Accent colour.
//
// The system setting is either one fixed colour — then every surface, system or
// application, uses it — or “multicolor”, which lets each application use its own:
// system windows are blue, and an application may declare an accent in its manifest or
// set one at run time (macos.window.setAccentColor). Offering the user a choice of
// accent inside an application is that application's job; the system only supplies the
// colour that currently applies.

export const ACCENT_COLORS = Object.freeze({
    blue: '#0a84ff', purple: '#a550a7', pink: '#f74f9e', red: '#ff5257',
    orange: '#f7821b', yellow: '#f5b60a', green: '#62ba46', graphite: '#8c8c8c'
});
export const ACCENT_OPTIONS = Object.freeze(['multicolor', ...Object.keys(ACCENT_COLORS)]);
const CACHE_KEY = 'macOS_accent_cache';

export const systemAccentSetting = (config = state.config) => (ACCENT_OPTIONS.includes(config?.accentColor) ? config.accentColor : 'multicolor');
/** The colour system surfaces use right now. */
export const systemAccentHex = (config = state.config) => ACCENT_COLORS[systemAccentSetting(config)] || ACCENT_COLORS.blue;

/** A named accent or a #rrggbb value -> #rrggbb, or '' when it is neither. */
export function accentHex(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (Object.hasOwn(ACCENT_COLORS, text)) return ACCENT_COLORS[text];
    return /^#[0-9a-f]{6}$/.test(text) ? text : '';
}
export function hexToRgbList(hex) {
    const value = Number.parseInt(String(hex).slice(1), 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
/** The colour one application uses: its own while the system is on multicolor, else the system's. */
export function applicationAccentHex(ownAccent, config = state.config) {
    return systemAccentSetting(config) === 'multicolor' ? (accentHex(ownAccent) || ACCENT_COLORS.blue) : systemAccentHex(config);
}

export function setAccentVariables(element, hex) {
    element.style.setProperty('--accent', hex);
    element.style.setProperty('--accent-rgb', hexToRgbList(hex));
}

let applied = '';
export function applyAccentColor(config = state.config) {
    const hex = systemAccentHex(config);
    setAccentVariables(document.documentElement, hex);
    if (!state.incognitoConfigMode) { try { localStorage.setItem(CACHE_KEY, hex); } catch { /* first-paint cache only */ } }
    const signature = `${systemAccentSetting(config)}:${hex}`;
    if (signature === applied) return;
    const first = applied === '';
    applied = signature;
    if (!first) window.dispatchEvent(new CustomEvent('macos-accent-change', { detail: { setting: systemAccentSetting(config), color: hex } }));
}
