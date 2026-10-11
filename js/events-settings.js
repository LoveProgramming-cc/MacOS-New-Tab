// System Settings: its tabs and search, the custom selects, and every switch and button
// on its pages.

import { state } from './state.js';
import { saveConfig, importConfig, setIncognitoConfigMode } from './config.js';
import { applyTranslations, loadLanguage, t, updateCustomSelectLabel } from './i18n.js';
import { applyTheme } from './theme.js';
import { applyDockSize, getArrayForType, isProtectedApp, renderAbout, renderAll, renderDesktopIcons, renderDock, renderForType, renderLaunchpadGrid, renderSettingsLists, renderSpotlightLinks, syncControlState, updateEngineUI } from './render.js';
import { $, createElement, normalizeUrl, readFileAsIconDataUrl, readFileAsText } from './utils.js';
import { renderWidgets, renderWidgetSettings, resetWidgetMediaCache, syncWidgetRuntimeState } from './widgets.js';
import { openGlassMenu } from './glass-select.js';
import { moveAppToTrash } from './trash.js';
import { showMacAlert, showMacConfirm } from './dialog.js';
import { rebaseDeveloperClock, resetDeveloperClock } from './time.js';
import { applyDeveloperPreferences, devFlag, extraFeaturesDisabled } from './developer.js';
import { renderApplicationManager, renderPluginManager, syncPluginRuntimeState } from './plugin-system.js';
import { toggleMissionControl } from './mission-control.js';
import { clearNotifications } from './notifications.js';
import { ACCENT_COLORS, ACCENT_OPTIONS, applyAccentColor, systemAccentSetting } from './accent.js';
import { syncDeveloperTools } from './devtools.js';
import { selectBingMonth, selectBingYear, setBingDailyWallpaper, setLiveWallpaperRate } from './wallpaper-gallery.js';
import { resetDockWave } from './events-dock.js';

const tabAvailable = (tab) => Boolean(tab) && !(tab.hasAttribute('data-extra-feature') && extraFeaturesDisabled(state.config));
// With extra features switched off their settings pages do not exist; never leave one open.
export function syncExtraFeatureEntries() {
    const active = document.querySelector('.settings-sidebar .tab.active');
    if (active && !tabAvailable(active)) activateSettingsTab('set-general');
}

export function activateSettingsTab(targetId) {
    const targetTab = document.querySelector(`.settings-sidebar .tab[data-target="${targetId}"]`);
    if (!tabAvailable(targetTab)) return;
    document.querySelectorAll('.settings-sidebar .tab').forEach((tab) => tab.classList.toggle('active', tab === targetTab));
    document.querySelectorAll('.set-panel').forEach((panel) => panel.classList.toggle('active', panel.id === targetId));
    // What each application used of its permissions is read when the page is shown.
    if (targetId === 'set-applications') renderApplicationManager();
    const title = $('settings-title');
    if (title) {
        title.dataset.i18n = targetTab.dataset.i18n || '';
        title.textContent = targetTab.textContent;
    }
    applyTranslations();
}

export function bindSettingsTabs() {
    const tabs = [...document.querySelectorAll('.settings-sidebar .tab')];
    tabs.forEach((tab) => tab.addEventListener('click', () => activateSettingsTab(tab.dataset.target)));

    const search = $('settings-search-input') || document.querySelector('.search-box-sidebar input');
    const results = $('settings-search-results');
    let resultEntries = [];
    const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase(state.config?.language || undefined);

    const rebuildResults = () => {
        if (!search || !results) return;
        const query = normalized(search.value);
        if (!query) {
            tabs.forEach((tab) => { tab.style.display = ''; });
            results.classList.add('hidden');
            results.replaceChildren();
            resultEntries = [];
            return;
        }

        tabs.forEach((tab) => { tab.style.display = 'none'; });
        const seen = new Set();
        resultEntries = [];
        for (const tab of tabs) {
            const panel = $(tab.dataset.target);
            if (!panel || !tabAvailable(tab)) continue;
            const sectionLabel = tab.textContent.trim();
            const candidates = [panel, ...panel.querySelectorAll('h3,.card-row,.add-box,.developer-setting-note,.widget-settings-hint,.screen-time-settings-hero,.screen-time-manager-label')];
            for (const node of candidates) {
                if (node.closest?.('[data-extra-feature]') && extraFeaturesDisabled(state.config)) continue;
                const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                const haystack = normalized(`${sectionLabel} ${text}`);
                if (!text || !haystack.includes(query)) continue;
                const titleNode = node.matches?.('h3') ? node : node.querySelector?.('[data-i18n],strong') || node.closest?.('.mac-card')?.previousElementSibling;
                const title = (titleNode?.textContent || text).replace(/\s+/g, ' ').trim().slice(0, 72);
                const key = `${tab.dataset.target}:${title}`;
                if (seen.has(key)) continue;
                seen.add(key);
                resultEntries.push({ tabId: tab.dataset.target, node, sectionLabel, title });
                if (resultEntries.length >= 18) break;
            }
            if (resultEntries.length >= 18) break;
        }

        results.replaceChildren();
        if (!resultEntries.length) {
            results.appendChild(createElement('div', { className: 'settings-search-empty', text: t('noSearchResults', '没有找到设置') }));
        } else {
            resultEntries.forEach((entry, index) => {
                const button = createElement('button', { className: 'settings-search-result', attrs: { type: 'button' }, dataset: { searchIndex: index } });
                button.append(createElement('span', { className: 'settings-search-result-title', text: entry.title }), createElement('span', { className: 'settings-search-result-section', text: entry.sectionLabel }));
                results.appendChild(button);
            });
        }
        results.classList.remove('hidden');
    };

    search?.addEventListener('input', rebuildResults);
    search?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { search.value = ''; rebuildResults(); search.blur(); }
    });
    results?.addEventListener('click', (event) => {
        const button = event.target.closest('.settings-search-result');
        if (!button) return;
        const entry = resultEntries[Number(button.dataset.searchIndex)];
        if (!entry) return;
        search.value = '';
        rebuildResults();
        activateSettingsTab(entry.tabId);
        requestAnimationFrame(() => {
            const target = entry.node?.closest?.('.card-row,.add-box,.mac-card,h3') || entry.node;
            target?.scrollIntoView?.({ block: 'center', behavior: devFlag('disableAnimations') ? 'auto' : 'smooth' });
            target?.classList?.add('settings-search-highlight');
            setTimeout(() => target?.classList?.remove('settings-search-highlight'), 1400);
        });
    });
}

export function bindCustomSelects() {
    document.querySelectorAll('.mac-custom-select:not(.widget-glass-select)').forEach((select) => {
        select.addEventListener('click', (event) => {
            event.stopPropagation();
            let options = [];
            try { options = JSON.parse(select.dataset.options || '[]'); } catch { return; }
            const records = options.map((option) => ({
                ...option,
                label: option.labelKey ? t(option.labelKey, option.label || option.value) : (option.label || option.value)
            }));
            openGlassMenu(select, records, select.dataset.value, async (value) => {
                select.dataset.value = value;
                updateCustomSelectLabel(select);
                await applySelectChange(select.id, value);
            });
        });
    });
}

// Accent colour swatches (System Settings ▸ Appearance).
export function renderAccentPicker() {
    const host = $('accent-color-picker');
    if (!host) return;
    const current = systemAccentSetting();
    if (!host.childElementCount) {
        host.replaceChildren(...ACCENT_OPTIONS.map((name) => {
            const swatch = createElement('button', { className: 'accent-swatch', attrs: { type: 'button', role: 'radio' }, dataset: { accent: name } });
            if (ACCENT_COLORS[name]) swatch.style.background = ACCENT_COLORS[name];
            return swatch;
        }));
        host.addEventListener('click', async (event) => {
            const swatch = event.target.closest('.accent-swatch');
            if (!swatch || swatch.dataset.accent === systemAccentSetting()) return;
            state.config.accentColor = swatch.dataset.accent;
            applyAccentColor();
            renderAccentPicker();
            await saveConfig();
        });
    }
    const label = (name) => t(`accent_${name}`, name);
    host.querySelectorAll('.accent-swatch').forEach((swatch) => {
        const selected = swatch.dataset.accent === current;
        swatch.classList.toggle('selected', selected);
        swatch.setAttribute('aria-checked', selected ? 'true' : 'false');
        swatch.title = label(swatch.dataset.accent);
    });
    if ($('accent-color-note')) $('accent-color-note').textContent = current === 'multicolor'
        ? t('accentMulticolorHint', '多色：系统使用蓝色，应用程序使用各自的强调色。')
        : t('accentFixedHint', '{name}：系统和所有应用程序统一使用此颜色。').replace('{name}', label(current));
}

async function applySelectChange(id, value) {
    if (id === 'bing-year-select') return selectBingYear(value);
    if (id === 'bing-month-select') return selectBingMonth(value);
    if (id === 'live-wallpaper-rate') return setLiveWallpaperRate(value);
    if (id === 'lang-select') {
        state.config.language = value;
        await saveConfig();
        await loadLanguage(value);
        window.dispatchEvent(new CustomEvent('macos-language-change', { detail: { language: state.config.language || value } }));
        renderAll();
        renderAccentPicker();
        renderWidgets({ includeSettings: true });
        renderPluginManager();
        renderApplicationManager();
        return;
    }
    if (id === 'subtitle-size' || id === 'subtitle-background' || id === 'subtitle-position') {
        const subtitles = ((state.config.accessibility ||= {}).subtitles ||= {});
        subtitles[id.slice(9)] = value;
        await saveConfig();
        window.dispatchEvent(new CustomEvent('macos-subtitle-style-change'));
        return;
    }
    if (id === 'theme-select') {
        state.config.themeMode = value;
        await saveConfig();
        syncControlState();
        await applyTheme();
        return;
    }
    if (id === 'engine-select-main') {
        state.config.searchEngine = value;
        await saveConfig();
        syncControlState();
        updateEngineUI();
        return;
    }
    if (id === 'shortcut-modifier') {
        state.config.shortcuts.spotlightModifier = value;
        await saveConfig();
        syncControlState();
        return;
    }
    if (id === 'developer-time-scale') {
        rebaseDeveloperClock({ scale: Number(value) || 1 });
        await saveConfig();
        syncControlState();
        await applyTheme();
        return;
    }
    if (id === 'developer-slow-motion') {
        state.config.developer ||= {};
        state.config.developer.slowMotion = [1, 2, 4, 10].includes(Number(value)) ? Number(value) : 1;
        await saveConfig();
        applyDeveloperPreferences();
        syncControlState();
        return;
    }
    if (id === 'developer-instance-limit') {
        state.config.developer ||= {};
        state.config.developer.instanceLimit = Math.max(2, Math.min(8, Math.floor(Number(value) || 4)));
        await saveConfig();
        syncControlState();
        return;
    }
    if (id === 'developer-launchpad-rows' || id === 'developer-launchpad-cols') {
        state.config.developer ||= {};
        const key = id.endsWith('rows') ? 'launchpadRows' : 'launchpadCols';
        state.config.developer[key] = Math.max(0, Math.floor(Number(value) || 0));
        await saveConfig();
        syncControlState();
        renderLaunchpadGrid();
    }
}

export function bindSettingsListEvents() {
    const lists = [
        ['desk-edit-list', 'desk'], ['dock-edit-list', 'dock'], ['lp-edit-list', 'lp'], ['sl-edit-list', 'sl'], ['dock-folder-edit-list', 'folder']
    ];
    lists.forEach(([id, type]) => {
        const container = $(id);
        if (!container) return;
        container.addEventListener('click', async (event) => {
            const restore = event.target.closest('.settings-icon-restore');
            if (restore) {
                const index = Number(restore.dataset.index);
                const array = getArrayForType(type);
                if (!array[index]) return;
                array[index].icon = array[index].originalIcon || '';
                array[index].forceBg = false;
                await saveConfig();
                renderForType(type);
                return;
            }

            const button = event.target.closest('.settings-delete');
            if (!button) return;
            const index = Number(button.dataset.index);
            const array = getArrayForType(type);
            if (!array[index] || isProtectedApp(array[index], type)) return;
            const [removed] = array.splice(index, 1);
            if (['desk', 'dock', 'lp', 'folder', 'sl'].includes(type)) moveAppToTrash(removed, type, index);
            await saveConfig();
            renderForType(type);
            if (['desk', 'dock', 'lp', 'folder', 'sl'].includes(type)) renderDock();
        });

        container.addEventListener('change', async (event) => {
            const target = event.target;
            const index = Number(target.dataset.index);
            const array = getArrayForType(type);
            if (!array[index]) return;
            if (target.classList.contains('settings-bg-toggle')) {
                const prop = target.dataset.bgProp === 'forceBg' ? 'forceBg' : 'useBg';
                array[index][prop] = target.checked;
                await saveConfig();
                renderForType(type);
                return;
            }
            if (target.classList.contains('settings-icon-upload') && target.files?.[0]) {
                const localSystemIcon = typeof array[index].icon === 'string' && array[index].icon.startsWith('assets/');
                if (localSystemIcon && !devFlag('allowSystemIconEditing')) return;
                if (localSystemIcon && !array[index].originalIcon) array[index].originalIcon = array[index].icon;
                array[index].icon = await readFileAsIconDataUrl(target.files[0]);
                await saveConfig();
                renderForType(type);
            }
        });

        container.addEventListener('dragstart', (event) => {
            const row = event.target.closest('.edit-row');
            if (!row) return;
            if (event.target.closest('input,button,label,.edit-icon-btn')) { event.preventDefault(); return; }
            state.drag = { type: `settings-${type}`, index: Number(row.dataset.index), item: row, handledDrop: false };
            queueMicrotask(() => row.classList.add('dragging'));
        });
        container.addEventListener('dragover', (event) => {
            if (state.drag?.type !== `settings-${type}`) return;
            event.preventDefault();
            const row = event.target.closest('.edit-row');
            if (row && row !== state.drag.item) row.classList.add('drag-over');
        });
        container.addEventListener('dragleave', (event) => event.target.closest('.edit-row')?.classList.remove('drag-over'));
        container.addEventListener('drop', async (event) => {
            if (state.drag?.type !== `settings-${type}`) return;
            event.preventDefault();
            const row = event.target.closest('.edit-row');
            if (!row) return;
            const array = getArrayForType(type);
            const sourceIndex = state.drag.index;
            const targetIndex = Number(row.dataset.index);
            const [moved] = array.splice(sourceIndex, 1);
            const adjusted = Math.max(0, targetIndex - (sourceIndex < targetIndex ? 1 : 0));
            array.splice(adjusted, 0, moved);
            await saveConfig();
            state.drag = null;
            renderForType(type);
        });
        container.addEventListener('dragend', () => {
            container.querySelectorAll('.dragging,.drag-over').forEach((row) => row.classList.remove('dragging', 'drag-over'));
            if (state.drag?.type === `settings-${type}`) state.drag = null;
        });
    });
}

async function addCustom(type) {
    const name = $(`new-${type}-name`)?.value.trim();
    const input = $(`new-${type}-url`);
    const url = normalizeUrl(input?.value || '');
    const useBg = type === 'folder' ? false : $(`new-${type}-bg`)?.checked !== false;
    if (!name || !url) {
        await showMacAlert(t('invalidUrl', '请输入有效的名称和网址'), { title: t('error', '错误') });
        return;
    }
    const app = { name: name.slice(0, 120), enName: '', url, isSystem: false, useBg, addedAt: Date.now(), lastAccessedAt: 0 };
    if (type === 'folder') app.icon = 'assets/images/Folder.png';
    const array = getArrayForType(type);
    if (type === 'dock') {
        const settingsIndex = array.findIndex((item) => item.action === 'toggleSettings');
        array.splice(settingsIndex >= 0 ? settingsIndex : array.length, 0, app);
    } else {
        array.push(app);
    }
    $(`new-${type}-name`).value = '';
    input.value = '';
    await saveConfig();
    renderForType(type);
}

export function bindSettingsActions() {
    [['add-desk-btn', 'desk'], ['add-dock-btn', 'dock'], ['add-lp-btn', 'lp'], ['add-sl-btn', 'sl'], ['add-folder-btn', 'folder']].forEach(([id, type]) => {
        $(id)?.addEventListener('click', () => addCustom(type));
    });

    $('save-about-btn')?.addEventListener('click', async () => {
        state.config.aboutMac = {
            osName: $('edit-os-name').value.trim(), osVersion: $('edit-os-version').value.trim(),
            model: $('edit-model').value.trim(), chip: $('edit-chip').value.trim(),
            memory: $('edit-memory').value.trim(), disk: $('edit-disk').value.trim()
        };
        await saveConfig();
        renderAbout();
        applyTranslations();
    });

    $('bing-wallpaper-toggle')?.addEventListener('change', (event) => setBingDailyWallpaper(event.target.checked));
    $('open-links-new-tab-toggle')?.addEventListener('change', async (event) => {
        state.config.openLinksInNewTab = event.target.checked;
        await saveConfig();
    });
    $('spotlight-on-start-toggle')?.addEventListener('change', async (event) => {
        if (!event.target.checked && state.config.spotlightFocusOnOpen) {
            event.target.checked = true;
            state.config.showSpotlightOnStart = true;
        } else state.config.showSpotlightOnStart = event.target.checked;
        await saveConfig();
        syncControlState();
    });
    $('spotlight-focus-on-open-toggle')?.addEventListener('change', async (event) => {
        state.config.spotlightFocusOnOpen = event.target.checked;
        if (event.target.checked) state.config.showSpotlightOnStart = true;
        await saveConfig();
        syncControlState();
    });
    $('developer-mode-toggle')?.addEventListener('change', async (event) => {
        rebaseDeveloperClock({ enabled: event.target.checked });
        await saveConfig();
        // Every developer switch is gated on this one, so each of them may have just
        // changed its effective value.
        applyDeveloperPreferences();
        syncDeveloperTools();
        syncControlState();
        syncExtraFeatureEntries();
        await syncWidgetRuntimeState();
        syncPluginRuntimeState({ forceClose: true });
        renderPluginManager();
        renderSettingsLists(); renderDesktopIcons(); renderDock(); renderLaunchpadGrid(); renderSpotlightLinks();
        renderWidgetSettings();
        await applyTheme();
    });
    $('developer-reset-time')?.addEventListener('click', async () => {
        resetDeveloperClock();
        await saveConfig();
        syncControlState();
        await applyTheme();
    });
    const developerFlagToggles = [
        ['developer-seconds-base', 'secondsBase'],
        ['developer-disable-extra-features', 'disableExtraFeatures'],
        ['developer-selectable-ui-text', 'selectableUIText'],
        ['developer-disable-strict-plugin-security', 'disableStrictPluginSecurity'],
        ['developer-allow-system-icons', 'allowSystemIconEditing'],
        ['developer-multi-instance', 'multiInstance'],
        ['developer-devtools', 'devTools'],
        ['developer-force-rtl', 'forceRTL']
    ];
    developerFlagToggles.forEach(([id, key]) => {
        $(id)?.addEventListener('change', async (event) => {
            state.config.developer ||= {};
            const checked = event.target.checked;
            state.config.developer[key] = checked;
            await saveConfig();
            applyDeveloperPreferences();
            syncControlState();
            if (key === 'allowSystemIconEditing') {
                renderSettingsLists(); renderDesktopIcons(); renderDock(); renderLaunchpadGrid();
            }
            if (key === 'secondsBase') renderWidgetSettings();
            if (key === 'multiInstance') renderApplicationManager();
            // Its launcher exists only while Developer Tools is on.
            if (key === 'devTools') { syncDeveloperTools(); renderDock(); renderLaunchpadGrid(); renderDesktopIcons(); renderSpotlightLinks(); renderSettingsLists(); }
            if (key === 'disableExtraFeatures') {
                syncExtraFeatureEntries();
                renderSettingsLists();
                await syncWidgetRuntimeState();
                syncPluginRuntimeState();
                renderPluginManager();
                renderApplicationManager();
                // Launchers are configuration, not deleted data. Hide them from every
                // live launcher surface while extra features are disabled, then reveal
                // the same entries again when the switch is turned off.
                renderDesktopIcons(); renderDock(); renderLaunchpadGrid(); renderSpotlightLinks();
            }
            if (key === 'disableStrictPluginSecurity') {
                // Unrestricted applications only exist while strict security is off.
                if (!checked && state.config.developer.unrestrictedApps) { state.config.developer.unrestrictedApps = false; await saveConfig(); syncControlState(); }
                // Security policy is fixed at sandbox creation time. Close running
                // application sandboxes so the next open gets the newly selected policy.
                syncPluginRuntimeState({ forceClose: true });
                renderPluginManager();
            }
        });
    });
    // Accessibility ▸ Display. Increased contrast implies reduced transparency, and
    // transparent glass is the opposite of both.
    [['accessibility-reduce-motion', 'disableAnimations'], ['accessibility-reduce-transparency', 'reduceTransparency'],
        ['accessibility-increase-contrast', 'increaseContrast'], ['accessibility-transparent-glass', 'transparentGlass']].forEach(([id, key]) => {
        $(id)?.addEventListener('change', async (event) => {
            const access = (state.config.accessibility ||= {});
            let checked = event.target.checked;
            if (key === 'reduceTransparency' && access.increaseContrast && !checked) checked = true;
            if (key === 'transparentGlass' && checked) { access.reduceTransparency = false; access.increaseContrast = false; }
            if ((key === 'reduceTransparency' || key === 'increaseContrast') && checked) access.transparentGlass = false;
            access[key] = checked;
            if (key === 'increaseContrast' && checked) access.reduceTransparency = true;
            await saveConfig();
            applyDeveloperPreferences();
            syncControlState();
            window.dispatchEvent(new CustomEvent('macos-appearance-change'));
        });
    });
    $('window-tiling-toggle')?.addEventListener('change', async (event) => {
        (state.config.windows ||= {}).tiling = event.target.checked;
        await saveConfig();
    });
    $('window-escape-toggle')?.addEventListener('change', async (event) => {
        (state.config.windows ||= {}).escapeCloses = event.target.checked;
        await saveConfig();
    });
    $('open-mission-control')?.addEventListener('click', () => toggleMissionControl());
    [['spotlight-apps-toggle', 'apps'], ['spotlight-content-toggle', 'appContent']].forEach(([id, key]) => {
        $(id)?.addEventListener('change', async (event) => { (state.config.spotlight ||= {})[key] = event.target.checked; await saveConfig(); });
    });
    $('notifications-dnd-toggle')?.addEventListener('change', async (event) => {
        (state.config.notifications ||= {}).doNotDisturb = event.target.checked;
        await saveConfig();
    });
    $('notifications-clear')?.addEventListener('click', () => clearNotifications());
    // Unrestricted applications: switched on only after the user has read what it means
    // and confirmed, twice, that it is their own decision.
    $('developer-unrestricted-apps')?.addEventListener('change', async (event) => {
        state.config.developer ||= {};
        let enabled = event.target.checked;
        if (enabled) {
            const first = await showMacConfirm(t('unrestrictedWarnTitle', '允许没有限制的应用程序？'), {
                title: t('developerUnrestricted', '没有限制的应用程序'), danger: true, confirmLabel: t('unrestrictedContinue', '我了解风险，继续'), cancelLabel: t('cancel', '取消'),
                detail: t('unrestrictedWarnDetail', '被你选中的应用程序将可以：\n• 不经声明使用所有接口——读取剪贴板、访问网络、读写它存储的文件、发送通知；\n• 访问本机和局域网内的地址（路由器、内网服务、本地开发服务器）；\n• 不受储存配额、文件大小和调用频率限制，可能占满磁盘或让页面卡死。\n\n它仍然运行在沙盒里，不能读取你的其他标签页或系统文件。\n\n如果是他人要求您开启，请务必再三考虑。')
            });
            const second = first && await showMacConfirm(t('unrestrictedIntentTitle', '这是你自己的决定吗？'), {
                title: t('developerUnrestricted', '没有限制的应用程序'), danger: true, confirmLabel: t('unrestrictedIntentConfirm', '是我自己要开启'), cancelLabel: t('cancel', '取消'),
                detail: t('unrestrictedIntentDetail', '只在你自己开发或完全信任某个应用程序时才需要这个开关。开启后不会对任何应用程序自动生效：你还需要在下方逐个选择。如果有网页、教程或其他人让你这样做，请取消。')
            });
            enabled = Boolean(second);
        }
        state.config.developer.unrestrictedApps = enabled;
        if (!enabled) (state.config.plugins?.apps || []).forEach((app) => { app.unrestricted = false; });
        await saveConfig();
        syncControlState();
        syncPluginRuntimeState({ forceClose: true });
        renderApplicationManager();
    });
    $('developer-incognito-mode')?.addEventListener('change', async (event) => {
        const enabled = event.target.checked;
        await setIncognitoConfigMode(enabled);
        if (!enabled) resetWidgetMediaCache();
        applyDeveloperPreferences();
        syncControlState();
        renderAll();
        renderWidgets({ includeSettings: true, reconcile: false });
        await applyTheme();
    });
    $('desktop-snap-toggle')?.addEventListener('change', async (event) => {
        state.config.desktop.snapToGrid = event.target.checked;
        await saveConfig();
        renderDesktopIcons();
    });
    $('dock-magnification')?.addEventListener('input', (event) => {
        state.config.dock.magnification = Number(event.target.value);
        if (state.config.dock.magnification <= 0) resetDockWave();
    });
    $('dock-magnification')?.addEventListener('change', async () => {
        await saveConfig();
        resetDockWave();
    });
    $('dock-icon-bg')?.addEventListener('change', async (event) => {
        state.config.dock.iconBg = event.target.checked;
        await saveConfig();
        renderDock();
        renderSettingsLists();
    });
    $('dock-light-bg-dark')?.addEventListener('change', async (event) => {
        state.config.dock.lightBgInDark = event.target.checked;
        await saveConfig();
        await applyTheme();
    });
    $('dock-size')?.addEventListener('input', (event) => {
        state.config.dock.size = Number(event.target.value);
        applyDockSize();
        resetDockWave();
    });
    $('dock-size')?.addEventListener('change', async () => {
        await saveConfig();
        renderDock();
    });

    $('shortcut-key')?.addEventListener('keydown', async (event) => {
        event.preventDefault();
        let value = event.key === ' ' ? 'Space' : event.key;
        if (value.length === 1) value = value.toUpperCase();
        else if (value !== 'Space') return;
        state.config.shortcuts.spotlightKey = value;
        event.currentTarget.value = value;
        await saveConfig();
    });

    $('export-btn')?.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'macOS_NewTab_Config.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    });

    $('config-upload')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            importConfig(JSON.parse(await readFileAsText(file)));
            await saveConfig();
            await loadLanguage(state.config.language);
            await applyTheme();
            renderAll();
            renderWidgets();
            await showMacAlert(t('importSuccess', '配置导入成功！'), { title: t('settingsImported', '设置已导入') });
        } catch (error) {
            await showMacAlert(`${t('importFail', '导入失败: ')}${error.message}`, { title: t('error', '错误') });
        } finally {
            event.target.value = '';
        }
    });
}
