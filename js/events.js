import { state } from './state.js';
import { ENGINES } from './constants.js';
import { saveConfig } from './config.js';
import { loadLanguage, t } from './i18n.js';
import { applyTheme } from './theme.js';
import { syncDockRunningApps, updateDockIndicators, flushSettingsLists, applyDockSize, renderAll, renderDesktopIcons, renderDock, renderLaunchpadGrid, renderSettingsLists, renderSpotlightLinks, updateEngineUI } from './render.js';
import { $, debounce, navigateTo } from './utils.js';
import { renderWidgets } from './widgets.js';
import { closeGlassSelectMenu, upgradeNativeSelects } from './glass-select.js';
import { bindTrashFinderEvents, finderMenus, hideTrashContextMenu, openFinder } from './trash.js';
import { showMacAlert } from './dialog.js';
import { virtualNow } from './time.js';
import { applyDeveloperPreferences, extraFeaturesDisabled } from './developer.js';
import { bindPluginManagerEvents, openPluginApp, renderPluginManager } from './plugin-system.js';
import { bringManagedWindowToFront, beginManagedWindowDrag, closeManagedWindow, configureWindowTiling, isWindowRunning, minimizeManagedWindow, refitZoomedWindows, registerManagedWindow, restoreManagedWindow, toggleZoomManagedWindow } from './window-manager.js';
import { missionControlOpen, toggleMissionControl } from './mission-control.js';
import { bindNotificationCenter } from './notifications.js';
import { bindSpotlightSearch } from './spotlight-search.js';
import { bindApplicationMenu, refreshActiveApplication } from './app-menu.js';
import { bindFileDropImport } from './file-drop.js';
import { bindStorageSettings } from './storage-settings.js';
import { openDeveloperTools } from './devtools.js';
import { bindWallpaperSettings, renderWallpaperSettings } from './wallpaper-gallery.js';
import { activateSettingsTab, bindCustomSelects, bindSettingsActions, bindSettingsListEvents, bindSettingsTabs, renderAccentPicker, syncExtraFeatureEntries } from './events-settings.js';
import { bindAppClicks, bindDockFolderReorder, bindGlobalTrashDropTarget, bindLaunchpadGestures, bindMainDragAndDrop, hideLaunchpadDeleteDialog } from './events-launchers.js';
import { bindDockMagnification, bindDockSeparatorResize, bindRunningAppPinning, resetDockWave } from './events-dock.js';
import { bindDesktopContextMenu, closeDesktopFloatingSubmenu } from './events-desktop.js';

export * from './events-settings.js';
export * from './events-launchers.js';
export * from './events-dock.js';
export * from './events-desktop.js';

function centerWindowElement(win) {
    if (!win) return;
    // Windows are positioned in viewport pixels. Clear any stale right/bottom/transform
    // left behind by an older version before measuring, otherwise a perfectly centred
    // left/top can still render off-centre.
    win.style.removeProperty('right');
    win.style.removeProperty('bottom');
    win.style.removeProperty('transform');
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const rect = win.getBoundingClientRect();
    const width = rect.width || win.offsetWidth || 600;
    const height = rect.height || win.offsetHeight || 400;
    const left = Math.round((viewportWidth - width) / 2);
    const top = Math.round((viewportHeight - height) / 2);
    win.style.left = `${Math.max(0, left)}px`;
    win.style.top = `${Math.max(26, top)}px`;
}

export function openWindow(id) {
    const win = $(id);
    if (!win) return;
    // A minimised window flies back out of the Dock where it was; an open one just comes forward.
    if (win.dataset.minimized === '1') return restoreManagedWindow(win);
    const wasHidden = win.classList.contains('hidden');
    win.classList.remove('hidden');
    if (id === 'settings-window') flushSettingsLists();
    if (wasHidden && win.dataset.maximized !== '1') {
        // Measure the real rendered size instead of relying on stale hard-coded dimensions.
        // Center synchronously, then once more after layout in case a scrollbar/header changed it.
        centerWindowElement(win);
        requestAnimationFrame(() => { if (win.dataset.maximized !== '1') centerWindowElement(win); });
    }
    bringToFront(win);
}

export function closeLaunchpad() {
    const lp = $('launchpad');
    lp?.classList.remove('active');
    document.body.classList.remove('launchpad-open');
    state.launchpadJiggle = false;
    clearTimeout(state.launchpadLongPressTimer);
    resetLaunchpadSearch();
}

export function toggleLaunchpad() {
    const lp = $('launchpad');
    if (!lp) return;
    const active = lp.classList.toggle('active');
    document.body.classList.toggle('launchpad-open', active);
    if (!active) {
        state.launchpadJiggle = false;
        resetLaunchpadSearch();
    }
    renderLaunchpadGrid();
    if (active) setTimeout(() => $('launchpad-search')?.focus({ preventScroll: true }), 80);
}

export function performAppAction(app) {
    if (!app) return;
    if (app.action === 'toggleLaunchpad') return toggleLaunchpad();
    // The Dock's Finder opens the Finder window; chrome://bookmarks is one click away in its sidebar.
    if (app.nameKey === 'appFinder' && /^chrome:/i.test(String(app.url || ''))) {
        const finderWindow = $('trash-window');
        // An open or minimised Finder comes back as it was; a closed one opens on Applications.
        return isWindowRunning(finderWindow) ? restoreManagedWindow(finderWindow) : openFinder('applications');
    }
    if (app.action === 'toggleSettings') return openWindow('settings-window');
    if (app.action === 'openDevTools') return openDeveloperTools();
    if (typeof app.action === 'string' && app.action.startsWith('pluginApp:')) { if (extraFeaturesDisabled(state.config)) return; return openPluginApp(app.action.slice('pluginApp:'.length)); }
    if (app.url) navigateTo(app.url);
}

export function bringToFront(element) {
    bringManagedWindowToFront(element);
}

export function closeMenus() {
    $('apple-dropdown')?.classList.add('hidden');
    $('engine-menu')?.classList.add('hidden');
    closeGlassSelectMenu();
    $('desktop-context-menu')?.classList.add('hidden');
    hideTrashContextMenu();
    $('widget-context-menu')?.classList.add('hidden');
    closeDesktopFloatingSubmenu();
}

function resetLaunchpadSearch() {
    state.launchpadQuery = '';
    const input = $('launchpad-search');
    if (input) input.value = '';
}

function bindMenuEvents() {
    $('apple-menu-btn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = $('apple-dropdown');
        menu.classList.toggle('hidden');
        if (!menu.classList.contains('hidden')) bringToFront(menu);
    });
    $('btn-about-mac')?.addEventListener('click', () => openWindow('about-window'));
    $('btn-sys-settings')?.addEventListener('click', () => openWindow('settings-window'));
    $('btn-devtools')?.addEventListener('click', () => openDeveloperTools());
    $('developer-open-devtools')?.addEventListener('click', () => openDeveloperTools());
    document.addEventListener('click', closeMenus);

    $('spotlight-btn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const spotlight = $('spotlight');
        spotlight.classList.toggle('hidden');
        if (!spotlight.classList.contains('hidden')) {
            bringToFront(spotlight);
            $('search-input')?.focus();
        }
    });

    document.querySelectorAll('.btn.close').forEach((button) => {
        button.addEventListener('click', () => closeManagedWindow($(button.dataset.target)));
    });

    const aboutImage = document.querySelector('#about-window img');
    aboutImage?.addEventListener('error', () => {
        if (aboutImage.dataset.fallbackApplied === '1') return;
        aboutImage.dataset.fallbackApplied = '1';
        aboutImage.src = 'assets/images/MacPro.png';
    });

    document.querySelector('#about-window .mac-btn')?.addEventListener('click', () => {
        openWindow('settings-window');
        activateSettingsTab('set-about');
    });

    window.addEventListener('macos-plugin-menu-command', (event) => {
        if (event.detail?.command === 'system.launchpad') toggleLaunchpad();
    });
}

// System windows are applications too: each has a Dock icon to minimise into, working
// traffic lights and its own name and menus in the menu bar.
function bindSystemWindows() {
    const dockIcon = (key) => () => document.querySelector(`#dock [data-app-key="${key}"] .dock-icon`);
    const aboutSystem = (name, icon) => () => showMacAlert(`${state.config.aboutMac?.osName || 'macOS NewTab'} ${state.config.aboutMac?.osVersion || ''}`.trim(), { title: name, icon });
    const describe = (win, build) => () => ({ window: win, quit: () => closeManagedWindow(win), menus: () => [], ...build() });
    const settings = $('settings-window'); const finder = $('trash-window'); const about = $('about-window');
    // Settings keeps its width and may only grow taller; Finder resizes freely; About is fixed.
    if (settings) registerManagedWindow(settings, { dockTarget: dockIcon('settings'), resize: () => ({ x: false, y: true }), app: describe(settings, () => {
        const name = t('appSystemSettings', '系统设置');
        return { id: 'system:settings', name, about: aboutSystem(name, 'assets/icons/系统设置.svg') };
    }) });
    if (finder) registerManagedWindow(finder, { dockTarget: dockIcon('finder'), app: describe(finder, () => {
        const name = t('appFinder', '访达');
        return { id: 'system:finder', name, about: aboutSystem(name, 'assets/icons/访达.svg'), menus: finderMenus,
            settings: () => { openWindow('settings-window'); activateSettingsTab('set-desktop'); } };
    }) });
    if (about) registerManagedWindow(about, { minimizable: false, zoomable: false, app: describe(about, () => ({ id: 'system:about', name: t('aboutMac', '关于本机') })) });

    document.querySelectorAll('.window .window-controls').forEach((controls) => {
        const win = controls.closest('.window');
        const fixed = win === about;
        const minimize = controls.querySelector('.btn.minimize'); const zoom = controls.querySelector('.btn.maximize');
        minimize?.classList.toggle('disabled', fixed); zoom?.classList.toggle('disabled', fixed);
        if (fixed) return;
        minimize?.addEventListener('click', () => minimizeManagedWindow(win));
        zoom?.addEventListener('click', () => toggleZoomManagedWindow(win));
    });
    bindApplicationMenu();
    refreshActiveApplication();
}

function bindSearchEngine() {
    $('spotlight-engine-trigger')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const trigger = event.currentTarget;
        const menu = $('engine-menu');
        const rect = trigger.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = `${rect.left - 10}px`;
        menu.style.top = `${rect.bottom + 10}px`;
        menu.classList.toggle('hidden');
        bringToFront(menu);
    });

    document.querySelectorAll('.engine-item').forEach((item) => {
        item.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!Object.hasOwn(ENGINES, item.dataset.engine)) return;
            // Spotlight's magnifying-glass menu is a per-tab override. The default
            // engine is changed only from Settings and therefore survives new tabs.
            state.spotlightEngine = item.dataset.engine;
            $('engine-menu')?.classList.add('hidden');
            updateEngineUI();
        });
    });

    $('search-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = $('search-input')?.value.trim();
        if (!query) return;
        const engineKey = state.spotlightEngine || state.config.searchEngine || 'google';
        const engine = ENGINES[engineKey] || ENGINES.google;
        navigateTo(engine.url + encodeURIComponent(query));
    });
}


function bindKeyboard() {
    // Mission Control: ⌃↑ or F3, wherever the keyboard focus is.
    document.addEventListener('keydown', (event) => {
        const combo = (event.key === 'ArrowUp' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) || (event.key === 'F3' && !event.metaKey && !event.ctrlKey && !event.altKey);
        if (!combo || event.repeat) return;
        event.preventDefault(); event.stopPropagation();
        if ($('launchpad')?.classList.contains('active')) return;
        toggleMissionControl();
    }, true);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (missionControlOpen()) return;
            if (!$('launchpad-delete-dialog')?.classList.contains('hidden')) {
                hideLaunchpadDeleteDialog();
                return;
            }
            if ($('launchpad')?.classList.contains('active')) {
                closeLaunchpad();
                renderLaunchpadGrid();
                return;
            }
            // System Settings ▸ Desktop & Windows: Esc may be told to leave windows alone.
            if (state.config.windows?.escapeCloses === false) return;
            const windows = [...document.querySelectorAll('.window:not(.hidden)')]
                .sort((a, b) => (Number.parseInt(getComputedStyle(b).zIndex, 10) || 0) - (Number.parseInt(getComputedStyle(a).zIndex, 10) || 0));
            windows[0]?.classList.add('hidden');
            return;
        }
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        const modifier = state.config.shortcuts?.spotlightModifier || 'Meta';
        const trigger = state.config.shortcuts?.spotlightKey === 'Space' ? ' ' : state.config.shortcuts?.spotlightKey;
        const modifierPressed = modifier === 'Meta' ? (event.metaKey || event.ctrlKey) : modifier === 'Alt' ? event.altKey : event.shiftKey;
        if (modifierPressed && trigger && event.key.toUpperCase() === trigger.toUpperCase()) {
            event.preventDefault();
            const spotlight = $('spotlight');
            spotlight.classList.toggle('hidden');
            if (!spotlight.classList.contains('hidden')) {
                bringToFront(spotlight);
                $('search-input')?.focus();
            }
        }
    });
}

function bindWindowDragging() {
    document.querySelectorAll('.window').forEach((win) => {
        // Activation and dragging share the same global window stack as plugin apps.
        // Pointer capture + translate3d prevents iframe surfaces underneath the window
        // from swallowing mousemove/mouseup and leaving stale drag listeners behind.
        win.addEventListener('pointerdown', (event) => {
            bringToFront(win);
            closeMenus();
            const interactive = 'input,button,.btn,.mac-switch,.tab,.edit-list,.link-item,.window-controls,.mac-custom-select,.engine-dropdown-container,.mac-card,.add-box,.dock-item,.lp-item,a,.delete-badge,.edit-icon-btn,label,.trash-finder-grid,.finder-side-item,.spotlight-result';
            if (event.button !== 0 || event.target.closest(interactive)) return;
            // The bottom-right corner is the resize grip of a resizable window.
            const box = win.getBoundingClientRect();
            if (getComputedStyle(win).resize !== 'none' && event.clientX > box.right - 18 && event.clientY > box.bottom - 18) return;
            beginManagedWindowDrag(win, win, event, {
                minLeft: (rect) => 80 - rect.width,
                maxLeft: () => window.innerWidth - 80,
                minTop: () => 26,
                maxTop: () => window.innerHeight - 50
            });
        }, { capture: true });
    });
}

function initClock() {
    const clock = $('clock');
    if (!clock) return;
    const update = () => {
        const now = virtualNow();
        const lang = state.config?.language || 'zh-CN';
        const weekday = now.toLocaleDateString(lang, { weekday: 'short' });
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const time = now.toLocaleTimeString(lang, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        clock.textContent = `${month}/${day} ${weekday} ${time}`;
        const preview = $('developer-time-preview');
        if (preview) preview.textContent = now.toLocaleString(lang, { hour12: false });
    };
    update();
    setInterval(update, 1000);
}

export function centerWindows() {
    document.querySelectorAll('.window:not(.hidden)').forEach(centerWindowElement);
}


export function bindPersistentEvents() {
    bindGlobalTrashDropTarget();
    document.addEventListener('contextmenu', (event) => {
        if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
    });
    window.addEventListener('macos-trash-updated', () => { renderDock(); renderDesktopIcons(); renderLaunchpadGrid(); renderSpotlightLinks(); renderSettingsLists(); });
    // System Settings draws its launcher lists when it becomes visible.
    window.addEventListener('macos-window-visibility-changed', (event) => {
        if (event.detail?.element?.id === 'settings-window' && event.detail.visible) flushSettingsLists();
        if (event.detail?.element?.id === 'devtools-window') syncDockRunningApps(); else updateDockIndicators();
    });
    window.addEventListener('macos-open-plugin-app', (event) => openPluginApp(event.detail?.id || ''));
    window.addEventListener('macos-finder-open-app', (event) => performAppAction(event.detail?.app));
    // Dock indicators: applications appear in the Dock while they run, and system
    // windows light the dot of their own Dock icon.
    window.addEventListener('macos-running-apps-changed', () => syncDockRunningApps());
    $('dock-show-indicators')?.addEventListener('change', async (event) => {
        state.config.dock.showIndicators = event.target.checked;
        await saveConfig();
        updateDockIndicators();
    });
    window.addEventListener('macos-plugin-launchers-updated', () => { renderDock(); renderDesktopIcons(); renderLaunchpadGrid(); renderSpotlightLinks(); renderSettingsLists(); });
    window.addEventListener('macos-appearance-change', () => renderDock());
    // The Dock's wave is laid out in pixels: it starts again when the layout is mirrored.
    window.addEventListener('macos-direction-change', () => { resetDockWave(); closeMenus(); });
    // Another new-tab page saved the configuration. config.js has already swapped
    // state.config; bring every surface in line, but never in the middle of a gesture.
    let externalRefreshTimer = 0;
    const refreshFromExternalConfig = async () => {
        clearTimeout(externalRefreshTimer);
        const busy = state.drag || document.querySelector('.dragging,.dock-drag-ghost')
            || ['global-app-drag-active', 'global-window-drag-active', 'widget-drag-active', 'dock-resizing'].some((name) => document.body.classList.contains(name));
        if (busy) { externalRefreshTimer = setTimeout(refreshFromExternalConfig, 400); return; }
        try {
            await loadLanguage(state.config.language);
            applyDeveloperPreferences();
            await applyTheme();
            renderAll();
            renderAccentPicker();
            renderWallpaperSettings();
            syncExtraFeatureEntries();
            renderWidgets({ includeSettings: true });
            renderPluginManager();
        } catch (error) { console.debug('external config refresh failed', error); }
    };
    window.addEventListener('macos-config-external-change', () => {
        clearTimeout(externalRefreshTimer);
        externalRefreshTimer = setTimeout(refreshFromExternalConfig, 60);
    });
    window.addEventListener('resize', debounce(() => {
        resetDockWave();
        applyDockSize();
        refitZoomedWindows();
        renderLaunchpadGrid();
        // Widgets first: desktop icons keep clear of where the widgets are now.
        renderWidgets();
        renderDesktopIcons();
    }, 100));

    bindFileDropImport();
    configureWindowTiling(() => state.config.windows?.tiling !== false);
    bindNotificationCenter();
    bindSpotlightSearch({ performAppAction, openSettingsTab: (id) => { openWindow('settings-window'); activateSettingsTab(id); } });
    // Other parts of the system ask for a page of System Settings with this event.
    window.addEventListener('macos-open-settings-tab', (event) => { openWindow('settings-window'); bringToFront($('settings-window')); activateSettingsTab(event.detail?.id || 'set-general'); });
    bindMenuEvents();
    bindSystemWindows();
    syncExtraFeatureEntries();
    renderAccentPicker();
    bindWallpaperSettings();
    bindStorageSettings();
    bindTrashFinderEvents();
    bindDesktopContextMenu();
    bindDockSeparatorResize();
    bindDockFolderReorder();
    bindSettingsTabs();
    upgradeNativeSelects($('set-widgets'));
    bindCustomSelects();
    document.addEventListener('scroll', closeMenus, true);
    document.addEventListener('wheel', closeMenus, { capture: true, passive: true });
    document.addEventListener('touchmove', closeMenus, { capture: true, passive: true });
    bindSearchEngine();
    bindAppClicks();
    bindLaunchpadGestures();
    ['dock', 'launchpad-grid', 'quick-links'].forEach((id) => { const el = $(id); if (el) bindMainDragAndDrop(el); });
    bindSettingsListEvents();
    bindSettingsActions();
    bindPluginManagerEvents();
    bindKeyboard();
    bindDockMagnification();
    bindRunningAppPinning();
    bindWindowDragging();
    initClock();
}
