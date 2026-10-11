import { state } from './state.js';
import { loadConfig, saveConfig } from './config.js';
import { loadLanguage, loadLocaleCatalog, syncLanguageOptions, applyTranslations } from './i18n.js';
import { applyTheme, refreshWallpaperCaches, startThemeObservers } from './theme.js';
import { syncControlState, renderAbout, renderDock, renderDesktopIcons, renderSpotlightLinks, renderLaunchpadGrid, renderSettingsLists, updateEngineUI } from './render.js';
import { $ } from './utils.js';
import { retireBootVisualSnapshot, scheduleBootVisualCache } from './boot-cache.js';
import { applyDeveloperPreferences } from './developer.js';

function cachedSpotlightShouldOpen() {
    try { return localStorage.getItem('macOS_spotlight_start_cache') !== 'false'; }
    catch { return true; }
}

function focusSpotlightInput() {
    const input = $('search-input');
    if (!input || state.config?.spotlightFocusOnOpen !== true || state.config?.showSpotlightOnStart === false) return;
    const focus = () => {
        if ($('spotlight')?.classList.contains('hidden')) return;
        try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
    };
    input.setAttribute('autofocus', '');
    const forceFocus = () => {
        try { window.focus(); } catch {}
        focus();
    };
    forceFocus();
    requestAnimationFrame(forceFocus);
    // Chrome may briefly restore omnibox focus after a custom new-tab document starts.
    // Retry across that startup window instead of making one early focus call.
    [0, 45, 110, 220, 380, 620, 950, 1350, 1800].forEach((delay) => setTimeout(forceFocus, delay));
    window.addEventListener('pageshow', forceFocus, { once: true });
    window.addEventListener('focus', () => setTimeout(forceFocus, 0), { once: true });
}

function placeSpotlightWithoutHeavyModules() {
    const spotlight = $('spotlight');
    if (!spotlight) return;
    const shouldOpen = state.config?.showSpotlightOnStart !== false && cachedSpotlightShouldOpen();
    spotlight.classList.toggle('hidden', !shouldOpen);
    if (!shouldOpen) return;
    const width = spotlight.offsetWidth || 650;
    const height = spotlight.offsetHeight || 100;
    spotlight.style.left = `${Math.round((innerWidth - width) / 2)}px`;
    spotlight.style.top = `${Math.round(Math.max(56, (innerHeight - height) * 0.42))}px`;
    spotlight.style.zIndex = '6001';
    if (state.config?.spotlightFocusOnOpen) focusSpotlightInput();
}

function afterPaint(task) {
    requestAnimationFrame(() => setTimeout(task, 0));
}
function whenIdle(task, timeout = 1800) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout });
    else setTimeout(task, 50);
}

async function bootstrap() {
    // preload.js + boot-ui.js paint a complete cached desktop first. When that cache
    // exists, keep it untouched until config, locale and live widget content are ready.
    try {
        const hadBootVisual = document.body.classList.contains('boot-visual-snapshot-active');
        await loadConfig();
        applyDeveloperPreferences();

        if (!hadBootVisual) {
            renderDesktopIcons();
            renderDock();
            renderSpotlightLinks();
        }
        placeSpotlightWithoutHeavyModules();

        requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('wallpaper-transitions-enabled')));
        startThemeObservers();
        Promise.resolve(applyTheme()).catch((error) => console.debug('theme init failed', error));

        const requestedLanguage = state.config.language || 'zh-CN';
        const localePromise = loadLanguage(requestedLanguage).then(() => {
            if (state.config.language !== requestedLanguage) saveConfig().catch(() => {});
            applyTranslations();
            if (!hadBootVisual) {
                renderDesktopIcons();
                renderDock();
                renderSpotlightLinks();
            }
        }).catch((error) => console.debug('locale init failed', error));

        afterPaint(async () => {
            try {
                const [events, widgets] = await Promise.all([
                    import('./events.js'),
                    import('./widgets.js')
                ]);
                events.bindPersistentEvents();
                await Promise.resolve(widgets.bindWidgetEvents());
                widgets.renderWidgets({ includeGallery: false, includeSettings: false, reconcile: false });

                // Locale affects widget labels. The cached desktop remains visible while
                // the live widget tree hydrates and, if needed, rerenders translated text.
                await localePromise;
                await widgets.waitForWidgetContent(4200);
                if (state.config.language !== 'zh-CN') {
                    widgets.renderWidgetCenter();
                    widgets.renderDesktopWidgets({ reconcile: false });
                    await widgets.waitForWidgetContent(4200);
                }

                requestAnimationFrame(() => {
                    // This is the first visible live-state mutation when a boot snapshot
                    // existed. All three surfaces update in the same frame.
                    renderDesktopIcons();
                    renderDock();
                    renderSpotlightLinks();
                    document.body.classList.add('live-widgets-content-ready');
                    retireBootVisualSnapshot();
                    if (state.config?.spotlightFocusOnOpen) focusSpotlightInput();
                    scheduleBootVisualCache(650);
                });

                // New-tab photo rotation happens after the complete initial state is visible.
                // The next photo is predecoded and only its tiny playback index is persisted.
                whenIdle(() => widgets.triggerPhotoEvent('newTab').catch(() => {}), 2400);

                whenIdle(() => {
                    try {
                        // Hydrate hidden/heavy surfaces without rebuilding the already-correct
                        // visible desktop a second time. This avoids a late Dock/icon repaint.
                        syncControlState();
                        renderAbout();
                        renderLaunchpadGrid();
                        renderSettingsLists();
                        applyTranslations();
                        updateEngineUI();
                        widgets.renderWidgetSettings();
                    } catch (error) { console.debug('idle surface render failed', error); }
                }, 2200);
            } catch (error) {
                console.error('deferred UI bootstrap failed:', error);
                retireBootVisualSnapshot();
            }
        });

        whenIdle(() => refreshWallpaperCaches(), 2200);
        whenIdle(() => loadLocaleCatalog().then(() => syncLanguageOptions()).catch(() => {}), 2600);
    } catch (error) {
        console.error('macOS New Tab bootstrap failed:', error);
        retireBootVisualSnapshot();
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
