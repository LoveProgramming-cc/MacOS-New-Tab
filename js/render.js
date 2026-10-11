import { state } from './state.js';
import { devCount } from './dev-hooks.js';
import { saveConfig } from './config.js';
import { getAppName, t, applyTranslations, updateCustomSelectLabel } from './i18n.js';
import { createAppIcon, isApplicationIcon, isExternalIcon, isLocalAssetIcon } from './icons.js';
import { ENGINES } from './constants.js';
import { $, clamp, createElement, navigateTo } from './utils.js';
import { resolveDesktopIconPosition } from './desktop-layout.js';
import { createDockUtilities, moveAppToTrash } from './trash.js';
import { scheduleBootVisualCache } from './boot-cache.js';
import { virtualNow } from './time.js';
import { applyDeveloperPreferences, devFlag, extraFeaturesDisabled, launcherAvailable } from './developer.js';
import { isWindowRunning } from './window-manager.js';

// Render de-duplication. Many code paths ask for the same surface to be drawn again
// (“something changed, redraw everything”). Each surface remembers what it was last drawn
// from; a request that would produce the same DOM returns immediately, so those callers
// cost nothing and a hover or a running animation is never torn down for no reason.
const drawn = new Map();
const appSignature = (app) => (app ? [app.name, app.enName, app.nameKey, app.action, app.url, app.useBg, app.forceBg, app.isSystem, app.protected, app.cx, app.cy,
    typeof app.icon === 'string' ? `${app.icon.length}:${app.icon.slice(-32)}` : ''].join('\u0001') : '');
const listSignature = (list = []) => list.map(appSignature).join('\u0002');
const environmentSignature = () => [state.config.language, state.effectiveTheme, extraFeaturesDisabled(state.config), devFlag('allowSystemIconEditing'), devFlag('devTools'), state.config.dock?.iconBg].join('|');
function unchanged(surface, signature, container) {
    if (drawn.get(surface) === signature && container.childElementCount > 0) { devCount(surface, true); return true; }
    drawn.set(surface, signature);
    devCount(surface, false);
    return false;
}
/** Forget what was drawn (the DOM was replaced by something else, e.g. the boot snapshot). */
export function invalidateRenderCache(surface = null) { if (surface) drawn.delete(surface); else drawn.clear(); }

const runtimeLauncherVisible = (app) => launcherAvailable(app);
function runtimeEntries(list = []) {
    return list.map((app, index) => ({ app, index })).filter(({ app }) => runtimeLauncherVisible(app));
}

function appArray(type) {
    if (type === 'dock') return state.config.dockApps;
    if (type === 'lp' || type === 'launchpad') return state.config.launchpadApps;
    if (type === 'sl' || type === 'spotlight') return state.config.quickLinks;
    if (type === 'folder' || type === 'dockFolder') return state.config.dockFolders || [];
    return state.config.desktopApps;
}

export function isProtectedApp(app, location = 'generic') {
    if (!app) return false;
    if (devFlag('allowSystemIconEditing')) return false;
    if (location === 'dock') return app.nameKey === 'appFinder' || app.action === 'toggleLaunchpad';
    if (location === 'launchpad' || location === 'lp') return Boolean(app.isSystem || app.protected);
    return Boolean(app.protected && app.isSystem);
}

export function syncControlState() {
    const config = state.config;
    const values = {
        'lang-select': config.language,
        'theme-select': config.themeMode,
        'engine-select-main': config.searchEngine,
        'shortcut-modifier': config.shortcuts?.spotlightModifier || 'Meta',
        'developer-time-scale': String(config.developer?.timeScale ?? 1),
        'developer-launchpad-rows': String(config.developer?.launchpadRows || 0),
        'developer-launchpad-cols': String(config.developer?.launchpadCols || 0),
        'developer-instance-limit': String(config.developer?.instanceLimit || 4),
        'developer-slow-motion': String(config.developer?.slowMotion || 1),
        'subtitle-size': config.accessibility?.subtitles?.size || 'medium',
        'subtitle-background': config.accessibility?.subtitles?.background || 'translucent',
        'subtitle-position': config.accessibility?.subtitles?.position || 'bottom'
    };
    for (const [id, value] of Object.entries(values)) {
        const el = $(id);
        if (el) {
            el.dataset.value = value;
            updateCustomSelectLabel(el);
        }
    }

    if ($('bing-wallpaper-toggle')) $('bing-wallpaper-toggle').checked = Boolean(config.useBingWallpaper);
    if ($('open-links-new-tab-toggle')) $('open-links-new-tab-toggle').checked = Boolean(config.openLinksInNewTab);
    if ($('spotlight-on-start-toggle')) $('spotlight-on-start-toggle').checked = config.showSpotlightOnStart !== false;
    if ($('spotlight-focus-on-open-toggle')) $('spotlight-focus-on-open-toggle').checked = Boolean(config.spotlightFocusOnOpen);
    if ($('desktop-snap-toggle')) $('desktop-snap-toggle').checked = config.desktop?.snapToGrid !== false;
    if ($('dock-size')) $('dock-size').value = config.dock?.size ?? 56;
    if ($('dock-magnification')) $('dock-magnification').value = config.dock?.magnification ?? 45;
    if ($('dock-icon-bg')) $('dock-icon-bg').checked = config.dock?.iconBg !== false;
    if ($('dock-light-bg-dark')) $('dock-light-bg-dark').checked = config.dock?.lightBgInDark !== false;
    if ($('dock-show-indicators')) $('dock-show-indicators').checked = config.dock?.showIndicators !== false;
    if ($('shortcut-key')) $('shortcut-key').value = config.shortcuts?.spotlightKey || 'Space';
    if ($('developer-mode-toggle')) $('developer-mode-toggle').checked = Boolean(config.developer?.enabled);
    if ($('developer-seconds-base')) $('developer-seconds-base').checked = Boolean(config.developer?.secondsBase);
    const access = config.accessibility || {};
    if ($('accessibility-reduce-motion')) $('accessibility-reduce-motion').checked = Boolean(access.disableAnimations);
    if ($('accessibility-reduce-transparency')) {
        $('accessibility-reduce-transparency').checked = Boolean(access.reduceTransparency || access.increaseContrast);
        $('accessibility-reduce-transparency').disabled = Boolean(access.increaseContrast);
    }
    if ($('accessibility-transparent-glass')) $('accessibility-transparent-glass').checked = Boolean(access.transparentGlass);
    if ($('accessibility-increase-contrast')) $('accessibility-increase-contrast').checked = Boolean(access.increaseContrast);
    if ($('window-tiling-toggle')) $('window-tiling-toggle').checked = config.windows?.tiling !== false;
    if ($('window-escape-toggle')) $('window-escape-toggle').checked = config.windows?.escapeCloses !== false;
    if ($('spotlight-apps-toggle')) $('spotlight-apps-toggle').checked = config.spotlight?.apps !== false;
    if ($('spotlight-content-toggle')) $('spotlight-content-toggle').checked = config.spotlight?.appContent !== false;
    if ($('notifications-dnd-toggle')) $('notifications-dnd-toggle').checked = Boolean(config.notifications?.doNotDisturb);
    if ($('developer-disable-extra-features')) $('developer-disable-extra-features').checked = Boolean(config.developer?.disableExtraFeatures);
    if ($('developer-selectable-ui-text')) $('developer-selectable-ui-text').checked = Boolean(config.developer?.selectableUIText);
    if ($('developer-disable-strict-plugin-security')) $('developer-disable-strict-plugin-security').checked = Boolean(config.developer?.disableStrictPluginSecurity);
    if ($('developer-allow-system-icons')) $('developer-allow-system-icons').checked = Boolean(config.developer?.allowSystemIconEditing);
    if ($('developer-multi-instance')) $('developer-multi-instance').checked = Boolean(config.developer?.multiInstance);
    if ($('developer-devtools')) $('developer-devtools').checked = Boolean(config.developer?.devTools);
    if ($('developer-force-rtl')) $('developer-force-rtl').checked = Boolean(config.developer?.forceRTL);
    if ($('developer-unrestricted-apps')) $('developer-unrestricted-apps').checked = Boolean(config.developer?.unrestrictedApps);
    // The switch only exists once strict security has been switched off.
    if ($('developer-unrestricted-row')) $('developer-unrestricted-row').hidden = !(config.developer?.enabled && config.developer?.disableStrictPluginSecurity);
    if ($('developer-incognito-mode')) $('developer-incognito-mode').checked = Boolean(state.incognitoConfigMode);
    // Without Developer Mode nothing else on the page applies, so nothing else is editable.
    const developerOn = Boolean(config.developer?.enabled);
    const panel = $('set-developer');
    if (panel) {
        panel.classList.toggle('developer-locked', !developerOn);
        panel.querySelectorAll('input,button').forEach((control) => {
            // The per-application rows are drawn, and locked, by the application manager.
            if (control.id === 'developer-mode-toggle' || control.closest('#developer-instance-apps,#developer-security-list')) return;
            // Incognito can always be switched off again.
            const keep = control.id === 'developer-incognito-mode' && state.incognitoConfigMode;
            control.disabled = !developerOn && !keep;
            if (control.id === 'developer-open-devtools') control.disabled = !(developerOn && config.developer?.devTools);
        });
        panel.querySelectorAll('.card-row:not(.developer-instance-row)').forEach((row) => row.classList.toggle('developer-row-locked', !developerOn && !row.querySelector('#developer-mode-toggle') && !(state.incognitoConfigMode && row.querySelector('#developer-incognito-mode'))));
    }
    applyDeveloperPreferences(config);
    const developerPreview = $('developer-time-preview');
    if (developerPreview) {
        const now = virtualNow(config);
        developerPreview.textContent = now.toLocaleString(config.language || 'zh-CN', { hour12: false });
    }
    applyDockSize();
}

// The Dock is drawn at the configured size unless the window is too narrow to fit it.
// The clamp is display-only: the saved preference is never rewritten, so the Dock
// returns to its chosen size as soon as there is room again.
// Running applications that have no launcher of their own in the Dock.
function runningOnlyApps() {
    const inDock = new Set((state.config?.dockApps || []).map((app) => app.action).filter(Boolean));
    return [...(state.runningApps || new Map()).entries()].filter(([id, app]) => !inDock.has(`pluginApp:${id}`) && !app.accessory);
}
const windowVisible = (id) => isWindowRunning($(id));
// Developer Tools has no launcher in the Dock by default: like any running application it
// gets an icon there for as long as its window exists.
const devToolsRunningOnly = () => windowVisible('devtools-window') && !(state.config?.dockApps || []).some((app) => app?.action === 'openDevTools');
const dockAppKey = (app) => (typeof app?.action === 'string' && app.action.startsWith('pluginApp:') ? `plugin:${app.action.slice('pluginApp:'.length)}`
    : app?.action === 'toggleSettings' ? 'settings' : app?.action === 'openDevTools' ? 'devtools' : app?.nameKey === 'appFinder' ? 'finder' : '');
export function updateDockIndicators() {
    const show = state.config?.dock?.showIndicators !== false;
    document.querySelectorAll('#dock .dock-app-item').forEach((item) => {
        const app = state.config.dockApps[Number(item.dataset.index)];
        let running = false;
        if (show && app) {
            if (typeof app.action === 'string' && app.action.startsWith('pluginApp:')) running = state.runningApps.has(app.action.slice('pluginApp:'.length));
            else if (app.action === 'toggleSettings') running = windowVisible('settings-window');
            else if (app.action === 'openDevTools') running = windowVisible('devtools-window');
            else if (app.nameKey === 'appFinder') running = windowVisible('trash-window');
        }
        item.classList.toggle('running', running);
    });
    document.querySelectorAll('#dock .dock-running-item').forEach((item) => item.classList.toggle('running', show));
}
// Called when an application opens or closes. Rebuilds the Dock only if a temporary
// icon has to appear or disappear; otherwise just moves the indicator dots.
export function syncDockRunningApps() {
    const wanted = runningOnlyApps().map(([id]) => id).join('\n');
    const shown = [...document.querySelectorAll('#dock .dock-running-item[data-plugin-id]')].map((item) => item.dataset.pluginId).join('\n');
    const devToolsShown = Boolean(document.querySelector('#dock .dock-running-item[data-kind="system-running"]'));
    if (wanted === shown && devToolsShown === devToolsRunningOnly()) updateDockIndicators(); else renderDock();
}
export function dockFitMaxSize() {
    const iconCount = Math.max(1, (state.config?.dockApps?.length || 0) + (state.config?.dockFolders?.length || 0) + 1 + runningOnlyApps().length + (devToolsRunningOnly() ? 1 : 0));
    const available = Math.max(260, window.innerWidth - 72);
    const fixed = 42 + Math.max(0, iconCount - 1) * 4;
    return Math.max(30, Math.min(90, Math.floor((available - fixed) / iconCount)));
}
export function effectiveDockSize() {
    return Math.min(clamp(Number(state.config?.dock?.size) || 56, 30, 90), dockFitMaxSize());
}
export function applyDockSize() {
    document.documentElement.style.setProperty('--dock-size', `${effectiveDockSize()}px`);
}

export function renderAbout() {
    const about = state.config.aboutMac;
    if (!about) return;
    const pairs = [
        ['about-os-name', about.osName], ['about-model', about.model], ['about-chip', about.chip],
        ['about-memory', about.memory], ['about-disk', about.disk], ['edit-os-name', about.osName],
        ['edit-os-version', about.osVersion], ['edit-model', about.model], ['edit-chip', about.chip],
        ['edit-memory', about.memory], ['edit-disk', about.disk]
    ];
    pairs.forEach(([id, value]) => {
        const el = $(id);
        if (!el) return;
        if (el instanceof HTMLInputElement) el.value = value;
        else el.textContent = value;
    });
}

const DESKTOP_ITEM_WIDTH = 80;
const DESKTOP_ITEM_HEIGHT = 104;

function clampDesktopPosition(cx, cy) {
    const safeLeft = 8;
    const safeRight = 8;
    const safeTop = 34;
    const safeBottom = Math.max(22, Number(state.config?.dock?.size || 56) + 28);
    const maxLeft = Math.max(safeLeft, window.innerWidth - DESKTOP_ITEM_WIDTH - safeRight);
    const maxTop = Math.max(safeTop, window.innerHeight - DESKTOP_ITEM_HEIGHT - safeBottom);
    const left = clamp(window.innerWidth / 2 + cx, safeLeft, maxLeft);
    const top = clamp(window.innerHeight / 2 + cy, safeTop, maxTop);
    return { cx: left - window.innerWidth / 2, cy: top - window.innerHeight / 2 };
}

function positionDesktopItem(el, cx, cy) {
    const safe = clampDesktopPosition(cx, cy);
    el.style.position = 'absolute';
    el.style.left = `calc(50% + ${safe.cx}px)`;
    el.style.top = `calc(50% + ${safe.cy}px)`;
    return safe;
}

function bindDesktopPointer(el, app, idx) {
    el.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const rect = el.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        let moved = false;

        el.style.zIndex = '100';
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;

        const updateTrashTarget = (clientX, clientY) => {
            const trash = document.querySelector('.dock-trash-item');
            if (!trash) return false;
            const r = trash.getBoundingClientRect();
            const over = clientX >= r.left - 5 && clientX <= r.right + 5 && clientY >= r.top - 5 && clientY <= r.bottom + 5;
            trash.classList.toggle('trash-drop-ready', over);
            return over;
        };
        const onMove = (moveEvent) => {
            const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
            if (distance >= 5 && !moved) {
                moved = true;
                document.body.classList.add('global-app-drag-active');
                window.dispatchEvent(new CustomEvent('macos-app-drag-state', { detail: { active: true } }));
            }
            if (!moved) return;
            el.style.left = `${moveEvent.clientX - offsetX}px`;
            el.style.top = `${moveEvent.clientY - offsetY}px`;
            updateTrashTarget(moveEvent.clientX, moveEvent.clientY);
        };

        const onUp = async (upEvent) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            el.style.zIndex = '';
            document.body.classList.remove('global-app-drag-active');
            window.dispatchEvent(new CustomEvent('macos-app-drag-state', { detail: { active: false } }));

            document.querySelector('.dock-trash-item')?.classList.remove('trash-drop-ready');
            if (!moved) {
                app.lastAccessedAt = Date.now();
                await saveConfig();
                if (app.action?.startsWith('pluginApp:')) {
                    window.dispatchEvent(new CustomEvent('macos-open-plugin-app', { detail: { id: app.action.slice('pluginApp:'.length) } }));
                } else navigateTo(app.url);
                return;
            }

            if (updateTrashTarget(upEvent?.clientX ?? -1, upEvent?.clientY ?? -1)) {
                document.querySelector('.dock-trash-item')?.classList.remove('trash-drop-ready');
                const [removed] = state.config.desktopApps.splice(idx, 1);
                if (removed) moveAppToTrash(removed, 'desk', idx);
                await saveConfig();
                renderDesktopIcons();
                renderDock();
                renderSettingsLists();
                return;
            }

            const finalLeft = parseFloat(el.style.left);
            const finalTop = parseFloat(el.style.top);
            let cx = finalLeft - window.innerWidth / 2;
            let cy = finalTop - window.innerHeight / 2;
            if (state.config.desktop?.snapToGrid !== false) {
                cx = Math.round(cx / 90) * 90;
                cy = Math.round(cy / 110) * 110;
            }
            const safe = clampDesktopPosition(cx, cy);
            const resolved = resolveDesktopIconPosition(safe.cx, safe.cy, idx);
            state.config.desktopApps[idx].cx = resolved.cx;
            state.config.desktopApps[idx].cy = resolved.cy;
            positionDesktopItem(el, resolved.cx, resolved.cy);
            await saveConfig();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

export function renderDesktopIcons() {
    const container = $('desktop-grid');
    if (!container) return;
    if (unchanged('desktop', [listSignature(state.config.desktopApps), environmentSignature(), window.innerWidth, window.innerHeight, state.config.dock?.size].join('|'), container)) return;
    container.replaceChildren();

    state.config.desktopApps.forEach((app, idx) => {
        if (!runtimeLauncherVisible(app)) return;
        const item = createElement('div', {
            className: 'link-item desk-item',
            attrs: { title: getAppName(app) },
            dataset: { index: idx }
        });
        const cx = Number.isFinite(app.cx) ? app.cx : (idx * 100 - window.innerWidth / 3);
        const cy = Number.isFinite(app.cy) ? app.cy : (idx * 120 - window.innerHeight / 3);
        const resolved = resolveDesktopIconPosition(cx, cy, idx);
        positionDesktopItem(item, resolved.cx, resolved.cy);

        const icon = createElement('div', { className: 'link-icon' });
        icon.style.cssText = 'width:64px;height:64px;margin-bottom:5px;';
        icon.appendChild(createAppIcon(app, { location: 'desktop' }));
        const name = createElement('div', { className: 'link-name', text: getAppName(app) });
        name.style.cssText = 'text-shadow:0 1px 3px rgba(0,0,0,.8);color:white;font-size:13px;text-align:center;';
        item.append(icon, name);
        bindDesktopPointer(item, app, idx);
        container.appendChild(item);
    });
    scheduleBootVisualCache();
}

export function renderDock() {
    const container = $('dock');
    if (!container) return;
    const signature = [listSignature(state.config.dockApps), listSignature(state.config.dockFolders), Boolean(state.config.trashItems?.length), environmentSignature(),
        runningOnlyApps().map(([id, info]) => `${id}:${info.name}:${(info.icon || '').length}`).join(','), devToolsRunningOnly()].join('|');
    if (unchanged('dock', signature, container)) { updateDockIndicators(); applyDockSize(); return; }
    container.replaceChildren();

    runtimeEntries(state.config.dockApps || []).forEach(({ app, index: idx }) => {
        const item = createElement('div', {
            className: 'dock-item dock-app-item',
            attrs: { draggable: 'true', 'data-title': getAppName(app) },
            dataset: { index: idx, kind: 'app', appKey: dockAppKey(app) }
        });
        const icon = createElement('div', { className: 'dock-icon' });
        icon.appendChild(createAppIcon(app, { location: 'dock' }));
        item.appendChild(icon);
        container.appendChild(item);
    });

    // An application without a Dock launcher still shows up here while it is running.
    runningOnlyApps().forEach(([id, info]) => {
        const item = createElement('div', { className: 'dock-item dock-running-item', attrs: { draggable: 'true', 'data-title': info.name }, dataset: { kind: 'running', pluginId: id, appKey: `plugin:${id}` } });
        const icon = createElement('div', { className: 'dock-icon' });
        icon.appendChild(createAppIcon({ name: info.name, action: `pluginApp:${id}`, icon: info.icon || 'assets/icons/noicon.svg', useBg: !info.icon }, { location: 'dock' }));
        item.appendChild(icon);
        container.appendChild(item);
    });
    if (devToolsRunningOnly()) {
        const name = t('devTools', '开发者工具');
        const item = createElement('div', { className: 'dock-item dock-running-item', attrs: { 'data-title': name }, dataset: { kind: 'system-running', appKey: 'devtools' } });
        const icon = createElement('div', { className: 'dock-icon' });
        icon.appendChild(createAppIcon({ name, action: 'openDevTools', icon: 'assets/icons/开发者工具.svg', isSystem: true }, { location: 'dock' }));
        item.appendChild(icon);
        container.appendChild(item);
    }
    container.appendChild(createDockUtilities());
    updateDockIndicators();
    applyDockSize();
    scheduleBootVisualCache();
    // New icons start at their resting size; events.js puts them back into the wave if
    // the pointer is still over the Dock.
    window.dispatchEvent(new CustomEvent('macos-dock-rendered'));
}

export function renderSpotlightLinks() {
    const container = $('quick-links');
    if (!container) return;
    if (unchanged('spotlight', `${listSignature(state.config.quickLinks)}|${environmentSignature()}`, container)) return;
    container.replaceChildren();

    runtimeEntries(state.config.quickLinks || []).forEach(({ app, index: idx }) => {
        const item = createElement('div', { className: 'link-item', attrs: { draggable: 'true' }, dataset: { index: idx } });
        const icon = createElement('div', { className: 'link-icon' });
        icon.appendChild(createAppIcon(app, { location: 'spotlight' }));
        item.append(icon, createElement('div', { className: 'link-name', text: getAppName(app) }));
        container.appendChild(item);
    });
    scheduleBootVisualCache();
}

export function renderLaunchpadGrid() {
    const container = $('launchpad-grid');
    if (!container) return;
    // Launchpad is drawn when it opens. While it is closed nobody can see it, so the many
    // “launchers changed” notifications cost nothing.
    if (!$('launchpad')?.classList.contains('active')) { drawn.delete('launchpad'); return; }
    const query = (state.launchpadQuery || '').trim().toLocaleLowerCase(state.config.language || undefined);
    const dev = state.config.developer || {};
    if (unchanged('launchpad', [listSignature(state.config.launchpadApps), environmentSignature(), query, state.launchpadJiggle, window.innerWidth, window.innerHeight,
        state.config.dock?.size, dev.enabled, dev.launchpadCols, dev.launchpadRows].join('|'), container)) return;
    container.replaceChildren();

    const entries = state.config.launchpadApps
        .map((app, index) => ({ app, index }))
        .filter(({ app }) => runtimeLauncherVisible(app))
        .filter(({ app }) => !query || getAppName(app).toLocaleLowerCase(state.config.language || undefined).includes(query));

    if (!entries.length) {
        container.appendChild(createElement('div', { className: 'empty-placeholder launchpad-empty', text: t('emptyApps', '没有应用') }));
        if ($('lp-dots')) $('lp-dots').replaceChildren();
        scheduleBootVisualCache();
        return;
    }

    // macOS keeps a broad seven-column field on desktop-sized windows and uses the
    // vertical space aggressively (five rows around ~1000px high) instead of
    // bunching the icons into the center.
    const gridWidth = Math.min(window.innerWidth * 0.74, 1500);
    const autoCols = clamp(Math.floor((gridWidth + 30) / (112 + 30)), 3, 7);
    const availableHeight = Math.max(300, window.innerHeight - (Number(state.config.dock?.size || 56) + 180));
    const autoRows = clamp(Math.floor((availableHeight + 40) / 150), 2, 5);
    const cols = dev.enabled && Number(dev.launchpadCols) > 0 ? clamp(Number(dev.launchpadCols), 3, 10) : autoCols;
    const rows = dev.enabled && Number(dev.launchpadRows) > 0 ? clamp(Number(dev.launchpadRows), 2, 8) : autoRows;
    document.documentElement.style.setProperty('--lp-cols', cols);
    document.documentElement.style.setProperty('--lp-rows', rows);
    const pageSize = cols * rows;

    for (let start = 0; start < entries.length; start += pageSize) {
        const page = createElement('div', { className: 'launchpad-page' });
        entries.slice(start, start + pageSize).forEach(({ app, index: idx }) => {
            const item = createElement('div', {
                className: `lp-item${state.launchpadJiggle ? ' jiggling' : ''}`,
                attrs: { draggable: (!query && !state.launchpadJiggle) ? 'true' : 'false' },
                dataset: { index: idx }
            });
            if (!query && state.launchpadJiggle && !isProtectedApp(app, 'launchpad')) {
                item.appendChild(createElement('div', { className: 'delete-badge', text: '×', dataset: { index: idx } }));
            }
            const icon = createElement('div', { className: 'lp-icon' });
            icon.appendChild(createAppIcon(app, { location: 'launchpad' }));
            item.append(icon, createElement('div', { className: 'lp-name', text: getAppName(app) }));
            page.appendChild(item);
        });
        container.appendChild(page);
    }

    const dots = $('lp-dots');
    if (dots) {
        dots.replaceChildren();
        container.querySelectorAll('.launchpad-page').forEach((_, index) => {
            dots.appendChild(createElement('div', { className: `dot${index === 0 ? ' active' : ''}` }));
        });
    }
    scheduleBootVisualCache();
}
function makeSettingsRow(app, idx, type) {
    const row = createElement('div', { className: 'edit-row', attrs: { draggable: 'true' }, dataset: { index: idx, type } });
    row.appendChild(createElement('div', { className: 'drag-handle', text: '≡' }));

    const localAsset = isLocalAssetIcon(app);
    const systemUnlocked = devFlag('allowSystemIconEditing');
    const localAssetLocked = localAsset && !systemUnlocked;
    const iconControl = createElement(localAssetLocked ? 'div' : 'label', {
        className: `edit-icon-btn${localAssetLocked ? ' locked' : ''}`,
        attrs: { title: localAssetLocked ? t('systemIconLocked', '系统图标不可修改') : t('btnUploadIcon', '点击修改图标') }
    });
    iconControl.appendChild(createAppIcon(app, { location: type === 'dock' ? 'dock' : 'settings' }));
    if (!localAssetLocked) {
        const file = createElement('input', { className: 'settings-icon-upload', attrs: { type: 'file', accept: 'image/*', hidden: '' }, dataset: { type, index: idx } });
        iconControl.appendChild(file);
    }
    row.appendChild(iconControl);

    const info = createElement('div', { className: 'edit-item-info' });
    info.append(
        createElement('div', { className: 'edit-item-name', text: getAppName(app) }),
        createElement('div', { className: 'edit-item-url', text: app.url || t('sysReserved', '系统保留') })
    );
    row.appendChild(info);

    if (isExternalIcon(app) || (localAsset && systemUnlocked)) {
        // Complete icons (built-in ones and applications) have no plate unless one is asked for.
        const optIn = localAsset || isApplicationIcon(app);
        const toggle = createElement('label', { className: 'bg-toggle' });
        const checkbox = createElement('input', { className: 'settings-bg-toggle', attrs: { type: 'checkbox' }, dataset: { type, index: idx, bgProp: optIn ? 'forceBg' : 'useBg' } });
        checkbox.checked = optIn ? Boolean(app.forceBg) : app.useBg !== false;
        toggle.append(checkbox, document.createTextNode(` ${t('useBg', '底板')}`));
        row.appendChild(toggle);
    }

    if (typeof app.icon === 'string' && app.icon.startsWith('data:image/')) {
        row.appendChild(createElement('button', {
            className: 'mac-btn icon-restore-btn settings-icon-restore',
            text: t('restoreIcon', '还原图标'),
            dataset: { type, index: idx }
        }));
    }

    if (isProtectedApp(app, type)) {
        row.appendChild(createElement('span', { className: 'sys-tag', text: t('sysReserved', '系统保留') }));
    } else {
        row.appendChild(createElement('button', { className: 'del-btn settings-delete', text: t('btnDelete', '删除'), dataset: { type, index: idx } }));
    }
    return row;
}

// The five launcher lists in System Settings are only drawn while that window is open;
// changes made while it is closed are picked up when it opens.
let settingsListsPending = true;
export function flushSettingsLists() { if (settingsListsPending) renderSettingsLists(); }
export function renderSettingsLists() {
    if (!isWindowRunning($('settings-window')) || $('settings-window').classList.contains('hidden')) { settingsListsPending = true; return; }
    settingsListsPending = false;
    const configs = [
        ['desk-edit-list', 'desk', state.config.desktopApps],
        ['dock-edit-list', 'dock', state.config.dockApps],
        ['lp-edit-list', 'lp', state.config.launchpadApps],
        ['sl-edit-list', 'sl', state.config.quickLinks],
        ['dock-folder-edit-list', 'folder', state.config.dockFolders || []]
    ];
    configs.forEach(([id, type, list]) => {
        const container = $(id);
        if (!container) return;
        if (unchanged(`settings:${type}`, `${listSignature(list)}|${environmentSignature()}`, container) && list.length) return;
        // Rows keep their index into the stored array, so hidden launchers leave gaps
        // in the numbering but never shift what an edit applies to.
        container.replaceChildren(...list.map((app, idx) => (runtimeLauncherVisible(app) ? makeSettingsRow(app, idx, type) : null)).filter(Boolean));
    });
}

export function updateEngineUI() {
    const engineKey = state.spotlightEngine || state.config.searchEngine || 'google';
    const engine = ENGINES[engineKey] || ENGINES.google;
    const input = $('search-input');
    if (input) input.placeholder = engine.name === 'Google' ? t('spotlightSearch', 'Spotlight 搜索...') : `${engine.name} ${t('search', '搜索')}...`;
}

export function renderAll() {
    syncControlState();
    renderAbout();
    renderDesktopIcons();
    renderDock();
    renderSpotlightLinks();
    renderLaunchpadGrid();
    renderSettingsLists();
    applyTranslations();
    updateEngineUI();
}

export function renderForType(type) {
    if (type === 'dock') renderDock();
    else if (type === 'lp' || type === 'launchpad') renderLaunchpadGrid();
    else if (type === 'sl' || type === 'spotlight') renderSpotlightLinks();
    else if (type === 'folder' || type === 'dockFolder') renderDock();
    else renderDesktopIcons();
    renderSettingsLists();
}

export function getArrayForType(type) {
    return appArray(type);
}
