// A widget's context menu and its quick editor.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { reflowDesktopAppsAroundWidgets, resolveWidgetGridPosition, reflowDesktopWidgetsToGrid, setWidgetPosition } from './desktop-layout.js';
import { renderDesktopIcons } from './render.js';
import { upgradeNativeSelects, syncNativeGlassSelects } from './glass-select.js';
import { secondsBaseEnabled } from './developer.js';
import { applicationWidgetSizes } from './plugin-system.js';
import { clone, deleteWidget, findPlacedWidget, moveWidgetBetweenLocations, renderDesktopWidgets, renderWidgetCenter, widgetTitle } from './widgets.js';
import { advancePhotoWidget, ensurePhotoSources, getMedia, importCompressedPhotos, mediaCache, normalizePhotoSource, photoSourceId, restartPhotoSchedulers, setMedia, setPhotoSelectedIndex } from './widget-photos.js';
import { weatherLocationFor, weatherLocations } from './widget-content.js';
import { renderWidgetSettings } from './widget-settings.js';

let quickEditorDraft = null;
let contextWidgetRef = null;
let widgetFloatingSubmenu = null;
export function widgetLocationOf(id) {
    if ((state.config.widgets?.desktop || []).some((w) => w.id === id)) return 'desktop';
    if ((state.config.widgets?.center || []).some((w) => w.id === id)) return 'center';
    return null;
}

export function hideWidgetContextMenu() {
    const menu = $('widget-context-menu');
    if (menu) menu.classList.add('hidden');
    widgetFloatingSubmenu?.remove();
    widgetFloatingSubmenu = null;
    contextWidgetRef = null;
}

function contextMenuButton(label, action, extraClass = '') {
    return createElement('button', { className: `widget-context-item ${extraClass}`.trim(), text: label, dataset: { action } });
}

function showWidgetContextMenu(event, card) {
    const widget = findPlacedWidget(card?.dataset.widgetId);
    if (!widget) return;
    event.preventDefault();
    event.stopPropagation();
    const location = card.dataset.widgetLocation || widgetLocationOf(widget.id) || 'center';
    contextWidgetRef = { id: widget.id, location, x: event.clientX, y: event.clientY };
    const menu = $('widget-context-menu');
    if (!menu) return;
    menu.replaceChildren();
    // A photo widget that cycles through its pictures can be moved on by hand.
    if (widget.type === 'photo') {
        const source = mediaCache?.photoSources?.[photoSourceId(widget)];
        if (source?.mode === 'cycle' && (source.photos?.length || 0) > 1) menu.appendChild(contextMenuButton(t('widgetNextPhoto', '切换为下一张照片'), 'next-photo'));
    }
    // What an application's widget shows is the application's business; it has nothing to set here.
    if (widget.type !== 'app') menu.appendChild(contextMenuButton(t('widgetEdit', '设置…'), 'edit'));
    const appSizes = widget.type === 'app' ? applicationWidgetSizes(widget.appId, widget.variant) : null;

    const sizeRow = createElement('div', { className: 'widget-context-item widget-context-has-submenu' });
    sizeRow.append(createElement('span', { className: 'widget-context-label', text: t('changeSize', '改变大小') }), createElement('span', { className: 'widget-context-chevron', text: '›' }));
    sizeRow.addEventListener('mouseenter', () => {
        widgetFloatingSubmenu?.remove();
        const choices = (widget.type === 'calendar' ? [['small','widgetSize_small'], ['medium','widgetSize_medium']] : [['small','widgetSize_small'], ['medium','widgetSize_medium'], ['large','widgetSize_large']]).filter(([size]) => !appSizes || appSizes.includes(size));
        const submenu = createElement('div', { className: 'widget-context-submenu floating-context-submenu mac-acrylic window-shadow' });
        choices.forEach(([size,key]) => submenu.appendChild(contextMenuButton(t(key, size), `size:${size}`, widget.size === size ? 'selected' : '')));
        document.body.appendChild(submenu);
        const rowRect = sizeRow.getBoundingClientRect();
        const subRect = submenu.getBoundingClientRect();
        const left = rowRect.right + subRect.width <= window.innerWidth - 8 ? rowRect.right - 3 : rowRect.left - subRect.width + 3;
        submenu.style.left = `${Math.max(8, left)}px`;
        submenu.style.top = `${Math.max(28, Math.min(rowRect.top, window.innerHeight - subRect.height - 8))}px`;
        widgetFloatingSubmenu = submenu;
    });
    if (!appSizes || appSizes.length > 1) menu.appendChild(sizeRow);
    menu.appendChild(contextMenuButton(location === 'center' ? t('moveToDesktop', '移到桌面') : t('moveToCenter', '移到小组件中心'), 'move'));
    menu.appendChild(createElement('div', { className: 'widget-context-separator' }));
    menu.appendChild(contextMenuButton(t('removeWidget', '移除小组件'), 'remove', 'danger'));
    menu.classList.remove('hidden');
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - margin)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - margin)}px`;
}

function choiceGroup(title, entries, selected, datasetKey) {
    const wrap = createElement('div', { className: 'widget-quick-field' });
    wrap.appendChild(createElement('div', { className: 'widget-quick-label', text: title }));
    const row = createElement('div', { className: 'widget-quick-choice-row' });
    entries.forEach(([value,label]) => {
        row.appendChild(createElement('button', {
            className: `widget-quick-choice${selected === value ? ' selected' : ''}`,
            text: label,
            attrs: { type: 'button' },
            dataset: { quickKey: datasetKey, quickValue: value }
        }));
    });
    wrap.appendChild(row);
    return wrap;
}


function quickInfoRow(label, control) {
    const wrap = createElement('div', { className: 'widget-quick-field' });
    wrap.appendChild(createElement('div', { className: 'widget-quick-label', text: label }));
    wrap.appendChild(control);
    return wrap;
}

function quickCheckbox(label, key, checked) {
    const row = createElement('label', { className: 'mac-checkbox-row widget-quick-check-row' });
    const input = createElement('input', { className: 'mac-checkbox widget-quick-checkbox', attrs: { type: 'checkbox' }, dataset: { quickCheck: key } });
    input.checked = Boolean(checked);
    row.append(input, createElement('span', { text: label }));
    return row;
}

function updateQuickEditorConditionalControls() {
    const interval = document.querySelector('[data-quick-block="photo-interval"]');
    const events = document.querySelector('[data-quick-block="photo-events"]');
    if (interval) interval.classList.toggle('disabled', quickEditorDraft?.photoScheduleMode !== 'interval');
    if (events) events.classList.toggle('disabled', quickEditorDraft?.photoScheduleMode !== 'events');
    interval?.querySelectorAll('input,button').forEach((el) => {
        const isNumber = el.matches?.('[data-quick-input="photoIntervalValue"]');
        el.disabled = quickEditorDraft?.photoScheduleMode !== 'interval' || (isNumber && quickEditorDraft?.photoIntervalUnit === 'days');
    });
    events?.querySelectorAll('input').forEach((el) => { el.disabled = quickEditorDraft?.photoScheduleMode !== 'events'; });
}

async function attachQuickPhotoPicker(button, { directory = false } = {}) {
    if (!button) return;
    const input = createElement('input', { attrs: { type: 'file', accept: 'image/*', hidden: '', multiple: directory ? '' : undefined } });
    if (directory) {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.setAttribute('multiple', '');
    }
    button.parentElement?.appendChild(input);
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        if (!quickEditorDraft?.photoSource) return;
        const files = [...(input.files || [])].filter((file) => file.type.startsWith('image/')).slice(0, 80);
        if (!files.length) return;
        button.disabled = true;
        const status = document.querySelector('[data-quick-photo-status]');
        const progress = document.querySelector('[data-quick-photo-progress]');
        if (progress) { progress.classList.remove('hidden'); progress.max = files.length; progress.value = 0; }
        const photos = await importCompressedPhotos(files, (current, total) => {
            if (status) status.textContent = t('photoImportProgress', '正在导入 {current}/{total}').replace('{current}', String(current)).replace('{total}', String(total));
            if (progress) { progress.max = total; progress.value = current; }
        });
        progress?.classList.add('hidden');
        button.disabled = false;
        if (!photos.length) return;
        quickEditorDraft.photoSource.photos = directory ? photos : [photos[0]];
        quickEditorDraft.photoSource.selectedIndex = 0;
        quickEditorDraft.photoPhotosChanged = true;
        quickEditorDraft.photoSource.mode = directory && photos.length > 1 ? 'cycle' : 'single';
        quickEditorDraft.photoMode = quickEditorDraft.photoSource.mode;
        document.querySelectorAll('[data-quick-key="photoMode"]').forEach((el) => el.classList.toggle('selected', el.dataset.quickValue === quickEditorDraft.photoMode));
        if (status) status.textContent = t('photoCount', '{count} 张照片').replace('{count}', String(quickEditorDraft.photoSource.photos.length));
        input.value = '';
    });
}

function makeQuickPhotoControls(source) {
    const fragment = document.createDocumentFragment();
    const status = createElement('div', { className: 'widget-quick-info', text: source.photos.length ? t('photoCount', '{count} 张照片').replace('{count}', String(source.photos.length)) : t('widgetPhotoEmpty', '尚未选择照片'), dataset: { quickPhotoStatus: '1' } });
    const pickRow = createElement('div', { className: 'widget-quick-choice-row' });
    const single = createElement('button', { className: 'mac-btn', text: t('choosePhoto', '选择照片…'), attrs: { type: 'button' } });
    const album = createElement('button', { className: 'mac-btn', text: t('chooseFolder', '选择相册/文件夹…'), attrs: { type: 'button' } });
    pickRow.append(single, album);
    const progress = createElement('progress', { className: 'widget-quick-photo-progress hidden', attrs: { max: '1', value: '0' }, dataset: { quickPhotoProgress: '1' } });
    fragment.append(quickInfoRow(t('photoSource', '照片源'), pickRow), status, progress);
    attachQuickPhotoPicker(single, { directory: false });
    attachQuickPhotoPicker(album, { directory: true });

    fragment.appendChild(choiceGroup(t('photoDisplayMode', '显示方式'), [
        ['single', t('singlePhoto', '单张')], ['cycle', t('photoCycle', '轮播')]
    ], source.mode, 'photoMode'));
    fragment.appendChild(choiceGroup(t('photoSchedule', '切换方式'), [
        ['manual', t('photoManual', '手动')], ['interval', t('photoInterval', '定时')], ['events', t('photoEvent', '事件触发')]
    ], source.schedule.mode, 'photoScheduleMode'));

    const interval = createElement('div', { className: 'widget-quick-field widget-quick-dependent', dataset: { quickBlock: 'photo-interval' } });
    interval.appendChild(createElement('div', { className: 'widget-quick-label', text: t('photoIntervalSettings', '定时间隔') }));
    const intervalRow = createElement('div', { className: 'widget-quick-choice-row' });
    const value = createElement('input', { className: 'mac-input widget-quick-number', attrs: { type: 'number', min: '1', max: source.schedule.intervalUnit === 'seconds' ? '86400' : '1440', value: String(source.schedule.intervalValue) }, dataset: { quickInput: 'photoIntervalValue' } });
    intervalRow.appendChild(value);
    interval.appendChild(intervalRow);
    interval.appendChild(choiceGroup('', [
        ['seconds', t('seconds', '秒')], ['minutes', t('minutes', '分钟')], ['hours', t('hours', '小时')], ['days', t('days', '每天')]
    ], source.schedule.intervalUnit, 'photoIntervalUnit'));
    fragment.appendChild(interval);

    const events = createElement('div', { className: 'widget-quick-field widget-quick-dependent', dataset: { quickBlock: 'photo-events' } });
    events.appendChild(createElement('div', { className: 'widget-quick-label', text: t('photoEventTriggers', '事件触发条件（可多选）') }));
    events.append(
        quickCheckbox(t('photoEventDayNight', '白天/黑夜切换时'), 'dayNight', source.schedule.events.dayNight),
        quickCheckbox(t('photoEventAppearance', '系统主题或桌面壁纸改变时'), 'appearance', source.schedule.events.appearance),
        quickCheckbox(t('photoEventNewTab', '打开新标签页时'), 'newTab', source.schedule.events.newTab)
    );
    fragment.appendChild(events);
    return fragment;
}

function closeWidgetQuickEditor() {
    $('widget-quick-editor')?.classList.add('hidden');
    quickEditorDraft = null;
}

async function openWidgetQuickEditor(widgetId, location = widgetLocationOf(widgetId)) {
    const widget = findPlacedWidget(widgetId);
    if (!widget || !location) return;
    quickEditorDraft = { id: widget.id, location, size: widget.size, variant: widget.variant, weatherLocationId: widget.weatherLocationId || '' };
    const fields = $('widget-quick-editor-fields');
    const title = $('widget-quick-editor-title');
    if (!fields || !title) return;
    title.textContent = `${widgetTitle(widget)} · ${t('widgetEdit', '设置')}`;
    fields.replaceChildren();
    const sizeChoices = widget.type === 'calendar'
        ? [['small', t('widgetSize_small', '小')], ['medium', t('widgetSize_medium', '中')]]
        : [['small', t('widgetSize_small', '小')], ['medium', t('widgetSize_medium', '中')], ['large', t('widgetSize_large', '大')]];
    fields.appendChild(choiceGroup(t('changeSize', '大小'), sizeChoices, widget.size, 'size'));

    if (widget.type === 'calendar') {
        fields.appendChild(choiceGroup(t('widgetStyle', '样式'), [
            ['month', t('widgetCalendarMonth', '月历')], ['upNext', t('widgetCalendarUpNext', '接下来')]
        ], widget.variant, 'variant'));
    } else if (widget.type === 'clock') {
        fields.appendChild(choiceGroup(t('widgetStyle', '样式'), [
            ['digital', t('widgetClockDigital', '数字')], ['analog', t('widgetClockAnalog', '模拟')], ['world', t('widgetWorldClock', '世界时钟')]
        ], widget.variant, 'variant'));
    } else if (widget.type === 'weather') {
        const locations = weatherLocations().map((loc) => [loc.id, loc.label]);
        fields.appendChild(choiceGroup(t('weatherLocation', '地点'), locations, weatherLocationFor(widget)?.id || '', 'weatherLocationId'));
        fields.appendChild(choiceGroup(t('widgetStyle', '样式'), [
            ['current', t('widgetWeatherCurrent', '当前')], ['forecast', t('widgetWeatherForecast', '预报')], ['detailed', t('widgetWeatherDetailed', '详细')]
        ], widget.variant, 'variant'));
    } else if (widget.type === 'photo') {
        const media = await ensurePhotoSources();
        const sourceId = photoSourceId(widget);
        const source = normalizePhotoSource(media.photoSources[sourceId]);
        quickEditorDraft.photoSourceId = sourceId;
        quickEditorDraft.photoSource = clone(source);
        quickEditorDraft.photoMode = source.mode;
        quickEditorDraft.photoScheduleMode = source.schedule.mode;
        quickEditorDraft.photoIntervalValue = source.schedule.intervalValue;
        quickEditorDraft.photoIntervalUnit = source.schedule.intervalUnit;
        quickEditorDraft.photoEvents = clone(source.schedule.events);
        fields.appendChild(makeQuickPhotoControls(source));
        queueMicrotask(updateQuickEditorConditionalControls);
    } else if (widget.type === 'screenTime') {
        quickEditorDraft.screenTimeEnabled = state.config.widgets?.screenTime?.enabled !== false;
        fields.appendChild(choiceGroup(t('widgetStyle', '样式'), [
            ['summary', t('screenTimeSummary', '摘要')], ['detailed', t('widgetScreenTimeDetailed', '详细')]
        ], widget.variant, 'variant'));
        fields.appendChild(quickCheckbox(t('screenTimeActivity', 'App 与网页活动'), 'screenTimeEnabled', quickEditorDraft.screenTimeEnabled));
    } else if (widget.type === 'battery') {
        fields.appendChild(createElement('div', { className: 'widget-quick-info', text: t('batteryQuickHint', '显示浏览器可读取的此电脑电池状态。') }));
    }
    $('widget-quick-editor')?.classList.remove('hidden');
}

async function applyWidgetQuickEditor() {
    if (!quickEditorDraft) return closeWidgetQuickEditor();
    const widget = findPlacedWidget(quickEditorDraft.id);
    if (!widget) return closeWidgetQuickEditor();
    widget.size = quickEditorDraft.size;
    widget.variant = quickEditorDraft.variant;
    if (widget.type === 'calendar') {
        widget.size = widget.size === 'medium' ? 'medium' : 'small';
        widget.variant = widget.size === 'medium' ? 'upNext' : 'month';
    }
    if (widget.type === 'weather' && quickEditorDraft.weatherLocationId) widget.weatherLocationId = quickEditorDraft.weatherLocationId;
    if (widget.type === 'photo' && quickEditorDraft.photoSource) {
        const media = await getMedia();
        const source = normalizePhotoSource(quickEditorDraft.photoSource);
        source.mode = quickEditorDraft.photoMode === 'cycle' ? 'cycle' : 'single';
        source.schedule.mode = ['manual','interval','events'].includes(quickEditorDraft.photoScheduleMode) ? quickEditorDraft.photoScheduleMode : 'manual';
        source.schedule.intervalValue = Math.max(1, Math.min(1440, Number(quickEditorDraft.photoIntervalValue) || 30));
        source.schedule.intervalUnit = ['seconds','minutes','hours','days'].includes(quickEditorDraft.photoIntervalUnit) ? quickEditorDraft.photoIntervalUnit : (secondsBaseEnabled() ? 'seconds' : 'minutes');
        source.schedule.events = { ...source.schedule.events, ...(quickEditorDraft.photoEvents || {}) };
        const sourceId = quickEditorDraft.photoSourceId || photoSourceId(widget);
        media.photoSources[sourceId] = source;
        await setMedia(media);
        if (quickEditorDraft.photoPhotosChanged) await setPhotoSelectedIndex(sourceId, 0);
    }
    if (widget.type === 'screenTime') state.config.widgets.screenTime.enabled = quickEditorDraft.screenTimeEnabled !== false;
    if (quickEditorDraft.location === 'desktop') {
        const pos = resolveWidgetGridPosition(widget, widget.cx, widget.cy, widget.id);
        setWidgetPosition(widget, pos);
        reflowDesktopWidgetsToGrid();
        reflowDesktopAppsAroundWidgets();
    }
    await saveConfig();
    closeWidgetQuickEditor();
    await restartPhotoSchedulers();
    renderWidgetCenter();
    renderDesktopWidgets();
    renderWidgetSettings();
    renderDesktopIcons();
}

export function bindWidgetManagement() {
    $('widget-center-list')?.addEventListener('click', async (event) => {
        const remove = event.target.closest('.widget-remove');
        if (!remove) return;
        const card = remove.closest('.widget-card');
        if (card) await deleteWidget('center', card.dataset.widgetId);
    });
    $('desktop-widget-layer')?.addEventListener('click', async (event) => {
        const remove = event.target.closest('.widget-remove');
        if (!remove) return;
        const card = remove.closest('.widget-card');
        if (card) await deleteWidget('desktop', card.dataset.widgetId);
    });

    [['widget-center-list','center'], ['desktop-widget-layer','desktop']].forEach(([id]) => {
        $(id)?.addEventListener('contextmenu', (event) => {
            const card = event.target.closest('.widget-card');
            if (!card) return;
            showWidgetContextMenu(event, card);
        });
    });

    const handleContextAction = async (action) => {
        if (!action || !contextWidgetRef) return;
        const ref = { ...contextWidgetRef };
        const widget = findPlacedWidget(ref.id);
        if (!widget) return hideWidgetContextMenu();
        if (action === 'edit') { hideWidgetContextMenu(); await openWidgetQuickEditor(ref.id, ref.location); return; }
        if (action === 'next-photo') { hideWidgetContextMenu(); await advancePhotoWidget(widget, 'manual'); return; }
        if (action.startsWith('size:')) {
            widget.size = action.split(':')[1];
            if (widget.type === 'calendar') { widget.size = widget.size === 'medium' ? 'medium' : 'small'; widget.variant = widget.size === 'medium' ? 'upNext' : 'month'; }
            if (ref.location === 'desktop') {
                const pos = resolveWidgetGridPosition(widget, widget.cx, widget.cy, widget.id);
                setWidgetPosition(widget, pos);
                reflowDesktopWidgetsToGrid(); reflowDesktopAppsAroundWidgets();
            }
            await saveConfig(); hideWidgetContextMenu();
            renderWidgetCenter(); renderDesktopWidgets(); renderWidgetSettings(); renderDesktopIcons(); return;
        }
        if (action === 'move') { hideWidgetContextMenu(); await moveWidgetBetweenLocations(ref.id, ref.location, ref.location === 'center' ? 'desktop' : 'center', ref.x, ref.y); return; }
        if (action === 'remove') { hideWidgetContextMenu(); await deleteWidget(ref.location, ref.id); }
    };
    $('widget-context-menu')?.addEventListener('click', async (event) => {
        const item = event.target.closest('[data-action]');
        if (item) await handleContextAction(item.dataset.action);
    });
    document.addEventListener('click', async (event) => {
        const floatingItem = event.target.closest('.floating-context-submenu [data-action]');
        if (floatingItem && contextWidgetRef) { event.stopPropagation(); await handleContextAction(floatingItem.dataset.action); return; }
        if (!event.target.closest('#widget-context-menu,.floating-context-submenu')) hideWidgetContextMenu();
    });
    document.addEventListener('scroll', hideWidgetContextMenu, true);
    window.addEventListener('resize', hideWidgetContextMenu);

    $('widget-quick-editor-fields')?.addEventListener('click', (event) => {
        const choice = event.target.closest('.widget-quick-choice');
        if (!choice || !quickEditorDraft) return;
        const key = choice.dataset.quickKey;
        const value = choice.dataset.quickValue;
        quickEditorDraft[key] = value;
        if (key === 'photoMode' && quickEditorDraft.photoSource) quickEditorDraft.photoSource.mode = value;
        if (key === 'photoScheduleMode' && quickEditorDraft.photoSource) quickEditorDraft.photoSource.schedule.mode = value;
        if (key === 'photoIntervalUnit' && quickEditorDraft.photoSource) { quickEditorDraft.photoSource.schedule.intervalUnit = value; if (value === 'days') quickEditorDraft.photoIntervalValue = 1; }
        choice.parentElement.querySelectorAll('.widget-quick-choice').forEach((button) => button.classList.toggle('selected', button === choice));
        updateQuickEditorConditionalControls();
    });
    $('widget-quick-editor-fields')?.addEventListener('input', (event) => {
        if (!quickEditorDraft) return;
        const input = event.target.closest('[data-quick-input]');
        if (input?.dataset.quickInput === 'photoIntervalValue') quickEditorDraft.photoIntervalValue = Number(input.value) || 1;
    });
    $('widget-quick-editor-fields')?.addEventListener('change', (event) => {
        if (!quickEditorDraft) return;
        const check = event.target.closest('[data-quick-check]');
        if (!check) return;
        const key = check.dataset.quickCheck;
        if (key === 'screenTimeEnabled') quickEditorDraft.screenTimeEnabled = check.checked;
        else {
            quickEditorDraft.photoEvents ||= {};
            quickEditorDraft.photoEvents[key] = check.checked;
        }
    });
    $('widget-quick-editor-cancel')?.addEventListener('click', closeWidgetQuickEditor);
    $('widget-quick-editor-save')?.addEventListener('click', applyWidgetQuickEditor);
    $('widget-quick-editor')?.addEventListener('mousedown', (event) => {
        if (event.target === event.currentTarget) closeWidgetQuickEditor();
    });

    $('widget-management-list')?.addEventListener('click', async (event) => {
        const btn = event.target.closest('.widget-manager-delete');
        if (btn) await deleteWidget(btn.dataset.location, btn.dataset.widgetId);
    });
    $('widget-management-list')?.addEventListener('change', async (event) => {
        const select = event.target.closest('.widget-manager-weather-location');
        if (!select) return;
        const widget = findPlacedWidget(select.dataset.widgetId);
        if (!widget || widget.type !== 'weather') return;
        widget.weatherLocationId = select.value;
        await saveConfig();
        renderWidgetCenter();
        renderDesktopWidgets();
    });
    upgradeNativeSelects($('set-widgets'));
    syncNativeGlassSelects($('set-widgets'));
}
