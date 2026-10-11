import { state } from './state.js';
import { createElement, normalizeUrl, safeDataImage } from './utils.js';
import { devFlag } from './developer.js';

const FALLBACK_ICON = 'assets/images/Safari浏览器.png';

export function isLocalAssetIcon(app) {
    return typeof app?.icon === 'string' && app.icon.startsWith('assets/');
}

/** The icon of an application plug-in (its own artwork, or one the user replaced it with). */
export function isApplicationIcon(app) {
    return typeof app?.action === 'string' && app.action.startsWith('pluginApp:') && Boolean(safeDataImage(app.icon));
}

export function isExternalIcon(app) {
    return !isLocalAssetIcon(app);
}

function iconSource(app) {
    if (typeof app?.icon === 'string') {
        if (app.icon.startsWith('assets/') || safeDataImage(app.icon)) return app.icon;
    }

    const url = normalizeUrl(app?.url);
    if (!url || url.startsWith('chrome:') || url.startsWith('edge:')) return FALLBACK_ICON;

    try {
        const favicon = new URL(chrome.runtime.getURL('/_favicon/'));
        favicon.searchParams.set('pageUrl', url);
        favicon.searchParams.set('size', '128');
        return favicon.href;
    } catch {
        return FALLBACK_ICON;
    }
}

function createImage(className, src) {
    const image = createElement('img', { className, attrs: { src, alt: '' } });
    image.addEventListener('error', () => {
        if (image.dataset.fallbackApplied === '1') return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_ICON;
    });
    return image;
}

export function createAppIcon(app, { location = 'generic' } = {}) {
    const container = createElement('div', { className: 'app-icon-container' });
    const src = iconSource(app);

    // An application ships a complete icon drawn on the macOS icon grid, exactly like the
    // built-in ones, so it is shown at full size instead of being fitted like a favicon.
    // Like a built-in icon it can still be given a backing plate, which is off by default.
    const appIcon = isApplicationIcon(app);
    const local = !isExternalIcon(app) || appIcon;
    const forceLocalBg = local && app.forceBg === true && (appIcon || devFlag('allowSystemIconEditing'));
    if (local && !forceLocalBg) {
        container.appendChild(createImage('native-icon', src));
        return container;
    }

    const globalDockBg = location !== 'dock' || state.config?.dock?.iconBg !== false;
    const useBg = globalDockBg && (forceLocalBg || app.useBg !== false);
    if (useBg) {
        container.classList.add('external-with-bg');
        container.appendChild(createElement('div', { className: 'squircle-bg' }));
        container.appendChild(createImage('squircle-icon', src));
    } else {
        container.classList.add('external-no-bg');
        container.appendChild(createImage('native-icon', src));
    }
    return container;
}
