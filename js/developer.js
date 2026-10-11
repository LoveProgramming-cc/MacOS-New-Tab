import { state } from './state.js';
import { bindEventMonitor, bindSlowMotion, dev } from './dev-hooks.js';
import { applyLayoutDirection } from './i18n.js';

export function incognitoConfigEnabled() {
    return Boolean(state.incognitoConfigMode);
}

export function developerConfig(config = state.config) {
    return config?.developer && typeof config.developer === 'object' ? config.developer : {};
}

// Every switch on the Developer page only takes effect while Developer Mode itself is on.
// The stored values are kept, so turning the mode back on restores the same setup.
// The display options that used to sit on the Developer page are ordinary settings now
// (System Settings ▸ Accessibility) and apply whether or not Developer Mode is on.
const ACCESSIBILITY_KEYS = new Set(['disableAnimations', 'reduceTransparency', 'increaseContrast', 'transparentGlass']);
export const accessibilityFlag = (key, config = state.config) => Boolean(config?.accessibility?.[key]);
export function devFlag(key, config = state.config) {
    if (ACCESSIBILITY_KEYS.has(key)) return accessibilityFlag(key, config);
    const dev = developerConfig(config);
    return Boolean(dev.enabled && dev[key]);
}

export function secondsBaseEnabled(config = state.config) {
    return devFlag('secondsBase', config);
}

export function extraFeaturesDisabled(config = state.config) {
    const dev = developerConfig(config);
    return Boolean(dev.enabled && dev.disableExtraFeatures);
}

export function transparentGlassEnabled(config = state.config) {
    const opaque = accessibilityFlag('reduceTransparency', config) || accessibilityFlag('increaseContrast', config);
    return accessibilityFlag('transparentGlass', config) && !opaque;
}

export function reduceTransparencyEnabled(config = state.config) {
    return accessibilityFlag('reduceTransparency', config) || accessibilityFlag('increaseContrast', config);
}

export function strictPluginSecurityEnabled(config = state.config) {
    const dev = developerConfig(config);
    // Strict security is always on unless Developer Mode is enabled and the user
    // explicitly turns on “Disable strict security”. Even then it stays on for every
    // application the user has not chosen, one by one, to relax (plugin-system.js).
    return !(dev.enabled && dev.disableStrictPluginSecurity);
}

/** Whether a launcher exists right now: application launchers go with extra features, Developer Tools with its switch. */
export function launcherAvailable(app, config = state.config) {
    if (!app) return false;
    if (app.action === 'openDevTools') return devFlag('devTools', config);
    if (typeof app.action === 'string' && app.action.startsWith('pluginApp:')) return !extraFeaturesDisabled(config);
    return true;
}

export function selectableUITextEnabled(config = state.config) {
    const dev = developerConfig(config);
    return Boolean(dev.enabled && dev.selectableUIText);
}

export function applyDeveloperPreferences(config = state.config) {
    const dev0 = developerConfig(config);
    const body = document.body;
    if (!body) return;
    const on = Boolean(dev0.enabled);
    const reduceMotion = accessibilityFlag('disableAnimations', config);
    body.classList.toggle('dev-disable-animations', reduceMotion);
    const highContrast = accessibilityFlag('increaseContrast', config);
    const reduceTransparency = reduceTransparencyEnabled(config);
    body.classList.toggle('dev-reduce-transparency', reduceTransparency);
    body.classList.toggle('dev-transparent-glass', transparentGlassEnabled(config));
    body.classList.toggle('dev-disable-extra-features', Boolean(dev0.enabled && dev0.disableExtraFeatures));
    body.classList.toggle('dev-selectable-ui', Boolean(dev0.enabled && dev0.selectableUIText));
    body.classList.toggle('dev-relaxed-plugin-security', Boolean(dev0.enabled && dev0.disableStrictPluginSecurity));
    body.classList.toggle('dev-increase-contrast', highContrast);
    body.classList.toggle('dev-system-icons-unlocked', on && Boolean(dev0.allowSystemIconEditing));
    body.classList.toggle('dev-incognito-config', incognitoConfigEnabled());
    // Developer Tools and slow motion (see dev-hooks.js).
    dev.enabled = on && Boolean(dev0.devTools);
    dev.slowMotion = on && !reduceMotion ? Math.max(1, Number(dev0.slowMotion) || 1) : 1;
    if (dev.slowMotion > 1) bindSlowMotion();
    if (dev.enabled) bindEventMonitor();
    body.classList.toggle('dev-tools-enabled', dev.enabled);
    applyLayoutDirection();
}

export function formatLimitDuration(minutes, t = (_k, fallback) => fallback) {
    const value = Math.max(0, Number(minutes) || 0);
    if (secondsBaseEnabled()) {
        const seconds = Math.max(1, Math.round(value * 60));
        return `${seconds} ${t('secondsPerDay', '秒/天')}`;
    }
    const rounded = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    return `${rounded} ${t('minutesPerDay', '分钟/天')}`;
}
