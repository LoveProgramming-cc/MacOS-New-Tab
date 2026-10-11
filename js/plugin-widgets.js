// Application widgets (macos.widgets): published by the application, drawn by the host.

import { state } from './state.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { extraFeaturesDisabled } from './developer.js';
import { restoreManagedWindow } from './window-manager.js';
import { accentHex, hexToRgbList, systemAccentSetting } from './accent.js';
import { createNativeRenderer, normalizeNativeTree } from './plugin-native-ui.js';
import { getBlobRecord } from './plugin-blobs.js';
import { APP_WIDGET_PREFIX } from './plugin-constants.js';
import { appLanguage, applicationUnrestricted, frontInstance, isPrivateNetworkHost, jsonSize, permissionAllowed, postWhenReady, requirePermission } from './plugin-core.js';
import { openPluginApp } from './plugin-system.js';
import { appAssetStorageKey, cleanPackagePath, compiledForPlugin, dataUrlForRecord, imageSourceKind, nativeLocaleDictionary, pluginState, sanitizeCss, sanitizeHtml, storageGet, storageSet } from './plugin-package.js';
import { runtimeHasImageAsset } from './plugin-files.js';

// ---- widgets --------------------------------------------------------------------------
// An application may offer widgets (manifest "widgets", permission: widgets). A widget is
// a picture of the application's content that the host draws: while it runs, the
// application publishes a small native UI tree per size with macos.widgets.set(); the
// host keeps it and shows it on the desktop or in the widget centre whether or not the
// application is open. A widget is only a way in: nothing of the application runs for
// it. Clicking one opens the application and sends it 'widget' { id, size, action }
// (action: the id of the button that was clicked, '' for the widget itself).
const WIDGET_NODE_TYPES = new Set(['stack', 'group', 'zstack', 'grid', 'card', 'text', 'button', 'image', 'progress', 'canvas', 'spacer', 'separator']);
const WIDGET_LIMIT = { nodes: 160, bytes: 150_000 };
const WIDGET_SIZE_NAMES = ['small', 'medium', 'large'];
export const widgetContentCache = new Map(); // appId -> { [widgetId]: { [size]: tree } }
const widgetLocaleCache = new Map();  // appId -> locales of the package
const widgetImageUrls = new Map();    // appId -> Map(source -> object / data url)
export const widgetsChanged = (appId, widgetId = '') => window.dispatchEvent(new CustomEvent('macos-app-widgets-changed', { detail: { appId, widgetId } }));

async function widgetContentOf(appId) {
    if (!widgetContentCache.has(appId)) {
        const stored = (await storageGet([APP_WIDGET_PREFIX + appId]))[APP_WIDGET_PREFIX + appId];
        widgetContentCache.set(appId, stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {});
    }
    return widgetContentCache.get(appId);
}
function assertWidgetTree(node) {
    if (!WIDGET_NODE_TYPES.has(node.type)) throw new Error(`A widget cannot contain a "${node.type}" node`);
    for (const child of node.children || []) assertWidgetTree(child);
}
export async function handleWidgetRequest(record, method, payload) {
    const { plugin } = record;
    requirePermission(plugin, 'widgets');
    const content = await widgetContentOf(plugin.id);
    const save = async (widgetId = '') => { await storageSet({ [APP_WIDGET_PREFIX + plugin.id]: content }); widgetsChanged(plugin.id, widgetId); };
    if (method === 'widgets.list') {
        const placed = [...(state.config.widgets?.desktop || []).map((widget) => ({ widget, location: 'desktop' })), ...(state.config.widgets?.center || []).map((widget) => ({ widget, location: 'center' }))]
            .filter(({ widget }) => widget.type === 'app' && widget.appId === plugin.id);
        return (plugin.widgets || []).map((widget) => ({ id: widget.id, sizes: [...widget.sizes], placed: placed.filter((entry) => entry.widget.variant === widget.id).map((entry) => ({ size: entry.widget.size, location: entry.location })) }));
    }
    if (method === 'widgets.clear') {
        if (payload?.id == null) for (const key of Object.keys(content)) delete content[key]; else delete content[String(payload.id)];
        await save(String(payload?.id || ''));
        return true;
    }
    if (method === 'widgets.set') {
        const declared = (plugin.widgets || []).find((widget) => widget.id === String(payload?.id || ''));
        if (!declared) throw new Error(`Unknown widget "${payload?.id}": declare it under "widgets" in the manifest`);
        const raw = payload?.content;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Widget content must be a UI tree, or { small, medium, large } trees');
        // One tree for every size, or a tree per size.
        const bySize = typeof raw.type === 'string' ? Object.fromEntries(declared.sizes.map((size) => [size, raw])) : raw;
        const next = {};
        for (const size of declared.sizes) {
            if (!bySize[size]) continue;
            const normalized = normalizeNativeTree(structuredClone(bySize[size]), {
                maxNodes: WIDGET_LIMIT.nodes,
                validSource: (value) => { const kind = imageSourceKind(value); return kind === 'asset' ? runtimeHasImageAsset(record, value) : kind === 'remote' ? permissionAllowed(plugin, 'network') : Boolean(kind); },
                sanitizeHtml: () => '', sanitizeCss: () => ''
            });
            if (!normalized?.root) throw new Error(`Widget "${declared.id}" (${size}): the UI tree is not valid`);
            assertWidgetTree(normalized.root);
            next[size] = normalized.root;
        }
        if (jsonSize(next) > WIDGET_LIMIT.bytes && !applicationUnrestricted(plugin)) throw new Error(`Widget content is larger than ${Math.round(WIDGET_LIMIT.bytes / 1000)} KB`);
        if (JSON.stringify(content[declared.id] || {}) === JSON.stringify(next)) return true;
        content[declared.id] = next;
        await save(declared.id);
        return true;
    }
    throw new Error(`Unknown plugin API method: ${method}`);
}
const widgetsAvailable = (plugin) => Boolean(plugin?.widgets?.length) && !extraFeaturesDisabled(state.config) && permissionAllowed(plugin, 'widgets');
const widgetDictionary = (plugin) => nativeLocaleDictionary(widgetLocaleCache.get(plugin.id), appLanguage(plugin));
const widgetLabel = (plugin, declared) => String((declared.titleKey && widgetDictionary(plugin)?.[declared.titleKey]) || declared.title || plugin.name);
/** What installed applications offer the widget gallery: [{ type: 'app', appId, variant, size, category, title, appName }]. */
export function applicationWidgetTemplates() {
    return pluginState().apps.filter(widgetsAvailable).flatMap((plugin) => plugin.widgets.flatMap((declared) => WIDGET_SIZE_NAMES.filter((size) => declared.sizes.includes(size))
        .map((size) => ({ type: 'app', appId: plugin.id, variant: declared.id, size, category: `app:${plugin.id}`, title: widgetLabel(plugin, declared), appName: plugin.name }))));
}
/** Applications that offer widgets: [{ id, name, icon }] (the gallery's categories). */
export const applicationWidgetApps = () => pluginState().apps.filter(widgetsAvailable).map(({ id, name, icon }) => ({ id, name, icon }));
/** The sizes an application's widget comes in ([] when it is not on offer any more). */
export function applicationWidgetSizes(appId, widgetId) {
    const plugin = pluginState().apps.find((app) => app.id === appId);
    return widgetsAvailable(plugin) ? [...(plugin.widgets.find((widget) => widget.id === widgetId)?.sizes || [])] : [];
}
export function applicationWidgetTitle(appId, widgetId) {
    const plugin = pluginState().apps.find((app) => app.id === appId);
    const declared = plugin?.widgets?.find((widget) => widget.id === widgetId);
    return plugin ? (declared ? widgetLabel(plugin, declared) : plugin.name) : '';
}
/** Loads what widget titles and contents are translated with. Resolves true when something new was loaded. */
export async function prepareApplicationWidgets() {
    const missing = pluginState().apps.filter((plugin) => widgetsAvailable(plugin) && !widgetLocaleCache.has(plugin.id));
    await Promise.all(missing.map(async (plugin) => {
        try { widgetLocaleCache.set(plugin.id, (await compiledForPlugin(plugin)).runtime?.locales || {}); } catch { widgetLocaleCache.set(plugin.id, {}); }
    }));
    return missing.length > 0;
}
async function widgetImageSource(plugin, value) {
    const kind = imageSourceKind(value);
    if (kind === 'data') return String(value);
    if (kind === 'remote') { try { return permissionAllowed(plugin, 'network') && !isPrivateNetworkHost(new URL(value).hostname) ? String(value) : ''; } catch { return ''; } }
    if (!kind) return '';
    if (!widgetImageUrls.has(plugin.id)) widgetImageUrls.set(plugin.id, new Map());
    const urls = widgetImageUrls.get(plugin.id);
    if (urls.has(value)) return urls.get(value);
    const pending = (async () => {
        if (kind === 'file') { const stored = await getBlobRecord(plugin.id, String(value).slice(5)); return stored ? URL.createObjectURL(stored.blob) : ''; }
        const clean = cleanPackagePath(value);
        const asset = (await compiledForPlugin(plugin)).runtime?.assets?.[clean];
        if (!asset) return '';
        if (!asset.stored) return dataUrlForRecord(asset);
        const stored = (await storageGet([appAssetStorageKey(plugin.id, clean)]))[appAssetStorageKey(plugin.id, clean)];
        return stored ? dataUrlForRecord(stored) : '';
    })().catch(() => '');
    urls.set(value, pending);
    return pending;
}
/** Opens the application a widget belongs to and tells it what was clicked. */
export async function openApplicationWidget(appId, widgetId, size, action = '') {
    if (!pluginState().apps.some((app) => app.id === appId)) return false;
    await openPluginApp(appId, { announce: false });
    const record = frontInstance(appId);
    if (!record) return false;
    restoreManagedWindow(record.window);
    postWhenReady(record, { type: 'event', name: 'widget', detail: { id: String(widgetId), size: String(size), action: String(action || '') } });
    return true;
}
/**
 * Draws an application's widget into a widget card (again, when called for a card that
 * already shows one). `preview` cards (the gallery) do not react to clicks.
 */
export function mountApplicationWidget(card, widget, { preview = false } = {}) {
    card.querySelector(':scope > .app-widget-frame')?.remove();
    const plugin = pluginState().apps.find((app) => app.id === widget.appId);
    const declared = plugin?.widgets?.find((item) => item.id === widget.variant);
    const frame = createElement('div', { className: 'app-widget-frame plugin-native-app-frame' });
    card.classList.add('widget-app');
    card.dataset.appId = widget.appId || '';
    card.prepend(frame);
    if (plugin) {
        const own = systemAccentSetting() === 'multicolor' ? accentHex(plugin.accentColor) : '';
        if (own) { frame.style.setProperty('--app-accent', own); frame.style.setProperty('--app-accent-rgb', hexToRgbList(own)); }
    }
    const placeholder = (hint) => {
        const box = createElement('div', { className: 'app-widget-placeholder' });
        if (plugin?.icon) box.appendChild(createElement('img', { attrs: { src: plugin.icon, alt: '', draggable: 'false' } }));
        box.append(createElement('div', { className: 'app-widget-placeholder-title', text: plugin ? widgetLabel(plugin, declared || { title: plugin.name }) : t('appWidgetMissing', '应用程序已移除') }));
        if (hint) box.appendChild(createElement('div', { className: 'app-widget-placeholder-hint', text: hint }));
        frame.replaceChildren(box);
    };
    const open = (action = '') => { if (!preview && plugin) openApplicationWidget(plugin.id, widget.variant, widget.size, action); };
    if (!preview && !card.dataset.appWidgetBound) {
        card.dataset.appWidgetBound = '1';
        // The card itself is the way into the application; its buttons report themselves.
        card.addEventListener('click', (event) => {
            if (event.defaultPrevented || state.widgetEditMode || card.dataset.justDragged || event.target.closest('button,.widget-remove')) return;
            const current = pluginState().apps.find((app) => app.id === card.dataset.appId);
            if (current) openApplicationWidget(current.id, card.dataset.widgetVariant, card.dataset.widgetSize, '');
        });
    }
    if (!plugin || !declared || !widgetsAvailable(plugin)) { placeholder(plugin ? t('appWidgetUnavailable', '这个小组件现在不可用') : ''); return Promise.resolve(); }
    placeholder('');
    return Promise.all([widgetContentOf(plugin.id), prepareApplicationWidgets()]).then(([content]) => {
        if (!frame.isConnected && card.isConnected) return; // drawn again meanwhile
        const tree = content[declared.id]?.[widget.size];
        if (!tree) { placeholder(t('appWidgetOpenHint', '打开应用程序后显示内容')); return; }
        frame.replaceChildren();
        createNativeRenderer({
            frame, tree: structuredClone(tree), maxNodes: WIDGET_LIMIT.nodes,
            validSource: (value) => Boolean(imageSourceKind(value)), sanitizeHtml: () => '', sanitizeCss: () => '',
            translate: (key, fallback) => String(widgetDictionary(plugin)?.[key] ?? fallback ?? key),
            resolveSource: (value) => widgetImageSource(plugin, value),
            motion: () => false,
            emit: ({ id, event }) => { if (event === 'click') open(id); }
        });
    }).catch(() => placeholder(''));
}
