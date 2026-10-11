// Application packages (macos-app-package-v3): validation, sanitising, compiling and
// the stored / cached copies of a package.

import { normalizeUrlSchemes } from './plugin-links.js';
import { state } from './state.js';
import { normalizeApplicationWidgets } from './config.js';
import { t } from './i18n.js';
import { $, safeDataImage } from './utils.js';
import { accentHex } from './accent.js';
import { normalizeNativeTree } from './plugin-native-ui.js';
import { APP_ASSET_INDEX_PREFIX, APP_ASSET_PREFIX, APP_COMPILED_PREFIX, APP_PACKAGE_PREFIX, APP_PERMISSIONS, MAX_CSS_STRICT, MAX_HTML_STRICT, MAX_PACKAGE_RELAXED, MAX_PACKAGE_STRICT, MAX_SCRIPT_STRICT, NATIVE_NODE_LIMIT } from './plugin-constants.js';
import { appLanguage, appStrict, applicationUnrestricted, compiledPackageCache } from './plugin-core.js';

export function cleanId(value) {
    return String(value || '').trim().replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);
}
export function pluginState() {
    state.config.plugins ||= { installed: [], apps: [], activeLimitOverlay: 'builtin', bundledSeen: [] };
    state.config.plugins.installed ||= [];
    state.config.plugins.apps ||= [];
    return state.config.plugins;
}
export function cleanPackagePath(value) {
    const raw = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
    if (!raw || raw.startsWith('/') || raw.includes('\0')) return '';
    const parts = raw.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return '';
    return parts.join('/').slice(0, 220);
}
function dirname(path) {
    const parts = cleanPackagePath(path).split('/');
    parts.pop();
    return parts.join('/');
}
function resolvePackagePath(baseFile, ref) {
    const value = String(ref || '').trim();
    if (!value || value.startsWith('#') || /^(?:data:|blob:|https?:)/i.test(value)) return value;
    const base = dirname(baseFile).split('/').filter(Boolean);
    for (const part of value.replaceAll('\\', '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') { if (!base.length) return ''; base.pop(); }
        else base.push(part);
    }
    return cleanPackagePath(base.join('/'));
}
function packageSize(raw) {
    try { return new Blob([JSON.stringify(raw)]).size; } catch { return Infinity; }
}
function fileRecord(raw, path) {
    if (typeof raw === 'string') return { path, mime: guessMime(path), encoding: 'text', data: raw };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const mime = String(raw.mime || guessMime(path)).slice(0, 120);
    if (typeof raw.text === 'string') return { path, mime, encoding: 'text', data: raw.text };
    if (typeof raw.base64 === 'string' && /^[A-Za-z0-9+/=\r\n]*$/.test(raw.base64)) return { path, mime, encoding: 'base64', data: raw.base64.replace(/\s+/g, '') };
    return null;
}
export function guessMime(path) {
    const ext = String(path || '').toLowerCase().split('.').pop();
    return ({
        html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
        svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
        ico: 'image/x-icon', avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
        txt: 'text/plain', md: 'text/markdown', woff2: 'font/woff2', woff: 'font/woff', otf: 'font/otf', ttf: 'font/ttf'
    })[ext] || 'application/octet-stream';
}
export function dataUrlForRecord(record) {
    if (!record) return '';
    if (record.encoding === 'base64') return `data:${record.mime || 'application/octet-stream'};base64,${record.data}`;
    try { return `data:${record.mime || 'text/plain'};charset=utf-8,${encodeURIComponent(record.data)}`; } catch { return ''; }
}

export async function cacheDisplayIcon(dataUrl) {
    if (!safeDataImage(dataUrl)) return '';
    // Keep launcher metadata tiny. Large source icons remain inside the separately
    // stored package; only this <=256px display copy is carried in desktop config.
    try {
        const image = new Image();
        image.decoding = 'async';
        image.src = dataUrl;
        await image.decode();
        const sourceW = Math.max(1, image.naturalWidth || image.width || 1);
        const sourceH = Math.max(1, image.naturalHeight || image.height || 1);
        if (Math.max(sourceW, sourceH) <= 256 && String(dataUrl).length <= 180_000) return dataUrl;
        const scale = Math.min(1, 256 / Math.max(sourceW, sourceH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceW * scale));
        canvas.height = Math.max(1, Math.round(sourceH * scale));
        const ctx = canvas.getContext('2d', { alpha: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
    } catch {
        // A malformed or excessively exotic icon must never make importing the
        // application fail. The package still installs and receives a generic icon.
        return '';
    }
}
function packageFileMap(rawFiles) {
    const map = new Map();
    if (!rawFiles || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) return map;
    for (const [key, value] of Object.entries(rawFiles)) {
        const path = cleanPackagePath(key);
        if (!path || map.has(path)) continue;
        const record = fileRecord(value, path);
        if (record) map.set(path, record);
    }
    return map;
}
function textFile(files, path) {
    const record = files.get(cleanPackagePath(path));
    if (!record || record.encoding !== 'text') return '';
    return String(record.data || '');
}
export function sanitizeCss(value, { strict = true, files = null, baseFile = '' } = {}) {
    let css = String(value || '');
    if (strict) {
        css = css
            .replace(/@import\s+[^;]+;?/gi, '')
            .replace(/(?:-webkit-)?backdrop-filter\s*:[^;}{]+;?/gi, '')
            .replace(/filter\s*:\s*blur\([^)]*\)[^;}{]*;?/gi, '');
    }
    css = css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, _quote, ref) => {
        if (/^(?:data:|blob:)/i.test(ref)) return match;
        if (/^https?:/i.test(ref)) return strict ? 'none' : match;
        const resolved = resolvePackagePath(baseFile, ref);
        if (files?.has(resolved)) return `url("macos-asset://${encodeURIComponent(resolved)}")`;
        return strict ? 'none' : match;
    });
    return css.slice(0, strict ? MAX_CSS_STRICT : 800_000);
}
export function sanitizeHtml(value, { strict = true, files = null, baseFile = '' } = {}) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '').slice(0, strict ? MAX_HTML_STRICT : 800_000);
    // Scripts always come from the declared entry point so execution order and crash isolation remain deterministic.
    template.content.querySelectorAll('script,style').forEach((node) => node.remove());
    if (strict) template.content.querySelectorAll('iframe,object,embed,link,meta').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
        [...node.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = String(attr.value || '').trim();
            if (name.startsWith('on')) { node.removeAttribute(attr.name); return; }
            if (name === 'style') {
                if (strict) node.setAttribute('style', sanitizeCss(value, { strict: true, files, baseFile }));
                return;
            }
            if (name !== 'src' && name !== 'href' && name !== 'poster') return;
            if (!value || value.startsWith('#') || /^data:image\//i.test(value)) return;
            if (/^https?:/i.test(value)) { if (strict) node.removeAttribute(attr.name); return; }
            const resolved = resolvePackagePath(baseFile, value);
            if (files?.has(resolved)) node.setAttribute(attr.name, `macos-asset://${encodeURIComponent(resolved)}`);
            else if (strict) node.removeAttribute(attr.name);
        });
    });
    return template.innerHTML;
}
function entryRecords(raw) {
    const entry = raw?.entry && typeof raw.entry === 'object' ? raw.entry : null;
    if (!entry) return null;
    const html = cleanPackagePath(entry.html);
    const ui = cleanPackagePath(entry.ui);
    // entry.script: one file, or several that are run in order as one script (they share a scope).
    const scripts = (Array.isArray(entry.script) ? entry.script : [entry.script]).map(cleanPackagePath).filter(Boolean).slice(0, 24);
    const script = scripts[0] || '';
    const css = (Array.isArray(entry.css) ? entry.css : [entry.css]).map(cleanPackagePath).filter(Boolean);
    return { html, ui, css, script, scripts };
}
function normalizeWindow(rawWindow = {}) {
    // "none": no title bar and no window buttons at all — a frameless surface such as a desktop
    // pet, which moves itself (macos.window.beginDrag / moveTo) and may be very small.
    const frameless = rawWindow.titlebar === 'none';
    const smallest = frameless ? 40 : 260;
    const width = Math.max(smallest, Math.min(1280, Number(rawWindow.width) || 640));
    const height = Math.max(frameless ? 40 : 220, Math.min(900, Number(rawWindow.height) || 480));
    const minWidth = Math.max(frameless ? 40 : 220, Math.min(width, Number(rawWindow.minWidth) || Math.min(360, width)));
    const minHeight = Math.max(frameless ? 40 : 160, Math.min(height, Number(rawWindow.minHeight) || Math.min(260, height)));
    const appearance = ['system', 'light', 'dark'].includes(rawWindow.appearance) ? rawWindow.appearance : 'system';
    const material = ['glass', 'solid', 'transparent'].includes(rawWindow.material) ? rawWindow.material : 'glass';
    const titlebarHeight = Math.max(32, Math.min(72, Number(rawWindow.titlebarHeight) || 36));
    const borderRadius = Math.max(8, Math.min(28, Number(rawWindow.borderRadius) || 12));
    const showTitle = rawWindow.showTitle !== false;
    // "hidden": no title strip; the traffic lights float over the content (System Settings style).
    const titlebar = frameless ? 'none' : rawWindow.titlebar === 'hidden' ? 'hidden' : 'standard';
    // level "floating": stays above every ordinary window. showInDock false: no Dock icon while
    // it runs (an accessory, reached through its menu bar item instead).
    const level = ['floating', 'desktop'].includes(rawWindow.level) ? rawWindow.level : 'normal';
    const showInDock = rawWindow.showInDock !== false;
    // resize: which edges the user may drag — "both", "horizontal", "vertical" or "none"
    // (resizable: false is the same as "none"). maxWidth / maxHeight cap manual resizing
    // and the size the green button zooms to; 0 means "as large as the screen allows".
    const resize = rawWindow.resizable === false || frameless ? 'none' : (['both', 'horizontal', 'vertical', 'none'].includes(rawWindow.resize) ? rawWindow.resize : 'both');
    const maxWidth = Number(rawWindow.maxWidth) > 0 ? Math.max(width, Math.min(10000, Number(rawWindow.maxWidth))) : 0;
    const maxHeight = Number(rawWindow.maxHeight) > 0 ? Math.max(height, Math.min(10000, Number(rawWindow.maxHeight))) : 0;
    return { width, height, minWidth, minHeight, resizable: resize !== 'none', resize, maxWidth, maxHeight, appearance, material, titlebarHeight, borderRadius, showTitle, titlebar, level, showInDock };
}
function normalizeAppMenus(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 10).map((menu) => {
        if (!menu || typeof menu !== 'object') return null;
        const title = String(menu.title || '').trim().slice(0,80);
        const titleKey = typeof menu.titleKey === 'string' ? menu.titleKey.slice(0,120) : '';
        if (!title && !titleKey) return null;
        const items = (Array.isArray(menu.items) ? menu.items : []).slice(0,40).map((item) => {
            if (item === '-' || item?.separator === true) return { separator:true };
            if (!item || typeof item !== 'object') return null;
            const command = cleanId(item.command);
            const label = String(item.label || '').trim().slice(0,120);
            const labelKey = typeof item.labelKey === 'string' ? item.labelKey.slice(0,120) : '';
            if (!command || (!label && !labelKey)) return null;
            return { command, label, labelKey, shortcut:String(item.shortcut || '').slice(0,30), danger:Boolean(item.danger), disabled:Boolean(item.disabled) };
        }).filter(Boolean);
        return { title, titleKey, items };
    }).filter(Boolean);
}

function appMetadata(raw, icon = '') {
    const id = cleanId(raw?.id);
    const name = String(raw?.name || '').trim().slice(0, 120);
    const version = String(raw?.version || '1.0.0').trim().slice(0, 40) || '1.0.0';
    if (!id || !name || raw?.kind !== 'app') throw new Error(t('appPluginInvalidMeta', '应用程序插件必须提供 id、name 和 kind=app。'));
    const permissions = [...new Set((Array.isArray(raw.permissions) ? raw.permissions : []).map((x) => String(x || '').trim()).filter((x) => APP_PERMISSIONS.has(x)))];
    return {
        id, name, version, kind: 'app', description: String(raw.description || '').trim().slice(0, 400), icon,
        runtime: raw.runtime === 'native' ? 'native' : 'web',
        permissions, menus: normalizeAppMenus(raw.menus), appMenu: normalizeAppMenus([{ title: 'app', items: raw.appMenu }])[0]?.items || [],
        window: normalizeWindow(raw.window || {}), bundled: Boolean(raw.bundled),
        settings: raw.settings === true, widgets: normalizeApplicationWidgets(raw.widgets, permissions), urlSchemes: normalizeUrlSchemes(raw.urlSchemes),
        peers: [...new Set((Array.isArray(raw.peers) ? raw.peers : []).map((item) => cleanId(item)))].filter((peer) => peer && peer !== id).slice(0, 8),
        accentColor: accentHex(raw.accentColor) ? String(raw.accentColor).trim().toLowerCase() : ''
    };
}

// Where an image shown by a native control may come from.
//   package asset path      assets/cover.png
//   stored file             blob:<file id>           (macos.files, dropped or picked files)
//   inline image            data:image/...
//   remote image            https://...              (needs the network permission)
export function imageSourceKind(value) {
    const text = String(value || '');
    if (/^blob:[a-z0-9-]{6,80}$/i.test(text)) return 'file';
    if (safeDataImage(text)) return text.length <= 3_000_000 ? 'data' : '';
    if (/^https:\/\/[^\s]{1,2000}$/i.test(text)) return 'remote';
    return cleanPackagePath(text) ? 'asset' : '';
}
function normalizeNativeUiTree(raw, files, { strict = true } = {}) {
    const normalized = normalizeNativeTree(raw, {
        maxNodes: strict ? NATIVE_NODE_LIMIT.strict : NATIVE_NODE_LIMIT.relaxed,
        validSource: (value) => {
            const kind = imageSourceKind(value);
            if (kind !== 'asset') return Boolean(kind);
            const clean = cleanPackagePath(value);
            return Boolean(files.has(clean) && /^image\//i.test(files.get(clean)?.mime || ''));
        },
        sanitizeHtml: (html) => sanitizeHtml(html, { strict: true, files: null }),
        sanitizeCss: (css) => sanitizeCss(css, { strict: true, files: null })
    });
    if (!normalized) throw new Error(t('appPluginInvalidNativeUI', '原生应用的 UI 描述无效。'));
    return normalized;
}
function compileApplicationLocales(raw, files) {
    const result = {};
    if (!raw?.locales || typeof raw.locales !== 'object' || Array.isArray(raw.locales)) return result;
    for (const [locale, pathValue] of Object.entries(raw.locales).slice(0, 16)) {
        const path = cleanPackagePath(pathValue); const text = path && textFile(files, path);
        if (!text) continue;
        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
            result[String(locale).slice(0,32)] = Object.fromEntries(Object.entries(parsed).slice(0,1200).map(([key,value]) => [String(key).slice(0,160), String(value).slice(0,1200)]));
        } catch {}
    }
    return result;
}
export function nativeLocaleDictionary(locales, language) {
    const lang = String(language || 'en-US');
    return locales?.[lang] || locales?.[lang.split('-')[0]] || locales?.['en-US'] || locales?.en || Object.values(locales || {})[0] || {};
}
export function nativeTranslate(record, key, fallback = '') {
    if (!key) return String(fallback ?? '');
    const dict = nativeLocaleDictionary(record.runtimeApp?.locales, appLanguage(record.plugin));
    return String(dict?.[key] ?? fallback ?? key);
}

export function compileApplicationPackage(raw, { strict = appStrict(pluginState().apps.find((app) => app.id === cleanId(raw?.id))) } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(t('appPluginInvalidRoot', '应用程序插件根节点必须是 JSON 对象。'));
    if (raw.format !== 'macos-app-package-v3') throw new Error(t('appPluginUnsupportedFormat', '应用程序必须使用 macos-app-package-v3 格式。'));
    // An application the user made unrestricted is not held to the package limits either.
    const free = !strict && applicationUnrestricted(pluginState().apps.find((app) => app.id === cleanId(raw.id)));
    const maxSize = free ? Infinity : strict ? MAX_PACKAGE_STRICT : MAX_PACKAGE_RELAXED;
    if (packageSize(raw) > maxSize) throw new Error(t('appPackageTooLarge', `应用程序包过大。当前安全模式上限为 ${Math.round(maxSize / 1_000_000)} MB。`));
    const files = packageFileMap(raw.files);
    const maxFiles = free ? Infinity : strict ? 160 : 1200;
    if (files.size > maxFiles) throw new Error(t('appPackageTooManyFiles', `应用程序包文件过多。当前模式最多允许 ${maxFiles} 个文件。`).replace('{count}', String(maxFiles)));
    const entry = entryRecords(raw);
    const mode = raw.runtime === 'native' ? 'native' : 'web';
    if (!entry?.script) throw new Error(t('appPluginNoEntry', '应用程序必须使用 entry + files 目录结构。'));
    let html = '', css = '', ui = null;
    if (mode === 'native') {
        if (!entry.ui) throw new Error(t('appPluginNoNativeUI', '原生应用必须声明 entry.ui。'));
        const uiText = textFile(files, entry.ui);
        if (!uiText) throw new Error(t('appPluginNoNativeUI', '原生应用缺少 UI 描述文件。'));
        let parsedUi; try { parsedUi = JSON.parse(uiText); } catch { throw new Error(t('appPluginInvalidNativeUI', '原生应用的 UI 描述无效。')); }
        ui = normalizeNativeUiTree(parsedUi, files, { strict });
    } else {
        if (!entry.html) throw new Error(t('appPluginNoEntry', 'Web 应用必须声明 entry.html。'));
        html = sanitizeHtml(textFile(files, entry.html), { strict, files, baseFile: entry.html });
        css = entry.css.map((path) => sanitizeCss(textFile(files, path), { strict, files, baseFile: path })).join('\n');
        if (!html) throw new Error(t('appPluginNoUI', '应用程序插件缺少有效的 HTML 入口。'));
    }
    const source = entry.scripts.map((path) => textFile(files, path)).join('\n;\n');
    const script = free ? source : source.slice(0, strict ? MAX_SCRIPT_STRICT : 1_000_000);
    const locales = compileApplicationLocales(raw, files);
    const assets = {};
    for (const [path, record] of files.entries()) {
        if (path === entry.html || path === entry.ui || entry.scripts.includes(path) || entry.css.includes(path) || Object.values(raw.locales || {}).includes(path)) continue;
        assets[path] = { mime: record.mime, encoding: record.encoding, data: record.data };
    }
    let icon = '';
    if (safeDataImage(raw.icon)) icon = raw.icon;
    else {
        const iconPath = cleanPackagePath(raw.icon);
        if (iconPath && files.has(iconPath) && /^image\//i.test(files.get(iconPath).mime || '')) icon = dataUrlForRecord(files.get(iconPath));
    }
    const metadata = appMetadata(raw, icon);
    metadata.runtime = mode;
    return { metadata, runtime: { mode, html, css, ui, script, assets, locales, strictSecurity: strict } };
}

export function validateLimitOverlayPlugin(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(t('pluginInvalidRoot', '插件根节点必须是 JSON 对象。'));
    const id = cleanId(raw.id);
    const name = String(raw.name || '').trim().slice(0, 120);
    const version = String(raw.version || '1.0.0').trim().slice(0, 40) || '1.0.0';
    const kind = raw.kind === 'limit-overlay' ? raw.kind : '';
    const actions = Array.isArray(raw.actions) ? [...new Set(raw.actions.map((x) => String(x || '').trim()).filter(Boolean))] : [];
    const html = sanitizeHtml(raw.overlay?.html ?? raw.html ?? '', { strict: true });
    const css = sanitizeCss(raw.overlay?.css ?? raw.css ?? '', { strict: false }).slice(0, 160_000);
    if (!id || !name || kind !== 'limit-overlay') throw new Error(t('pluginInvalidMeta', '插件缺少 id / name / kind=limit-overlay。'));
    if (!actions.includes('delay5')) throw new Error(t('pluginDelayRequired', '插件必须声明 delay5 动作。'));
    const probe = document.createElement('template'); probe.innerHTML = html;
    if (!probe.content.querySelector('[data-macos-action="delay5"]')) throw new Error(t('pluginDelayButtonRequired', '插件界面必须包含 data-macos-action="delay5" 的控件。'));
    return { id, name, version, kind, actions, overlay: { html, css } };
}

export function validateApplicationPlugin(raw) {
    return compileApplicationPackage(raw).metadata;
}

export function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));
}
export function storageSet(value) {
    return new Promise((resolve, reject) => chrome.storage.local.set(value, () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()));
}
export function storageRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}
export async function packageForPlugin(plugin) {
    if (plugin.packagePath) {
        const response = await fetch(chrome.runtime.getURL(plugin.packagePath));
        if (!response.ok) throw new Error(`Application package HTTP ${response.status}`);
        return await response.json();
    }
    if (plugin.packageStored) {
        const data = await storageGet([APP_PACKAGE_PREFIX + plugin.id]);
        if (data[APP_PACKAGE_PREFIX + plugin.id]) return data[APP_PACKAGE_PREFIX + plugin.id];
    }
    throw new Error(t('appPackageMissing', '应用程序包不存在或已损坏。'));
}
export async function savePackageForPlugin(id, raw) {
    await storageSet({ [APP_PACKAGE_PREFIX + id]: raw });
}
export function appAssetStorageKey(id, path) { return `${APP_ASSET_PREFIX}${id}:${path}`; }
export async function storeCompiledPackage(id, compiled, mode) {
    const assets = compiled?.runtime?.assets || {};
    const paths = Object.keys(assets);
    const payload = {};
    const descriptors = {};
    for (const path of paths) {
        const record = assets[path];
        payload[appAssetStorageKey(id, path)] = record;
        descriptors[path] = { mime: record?.mime || guessMime(path), stored: true };
    }
    const slim = { ...compiled, runtime: { ...compiled.runtime, assets: descriptors } };
    payload[APP_COMPILED_PREFIX + id + ':' + mode] = slim;
    payload[APP_ASSET_INDEX_PREFIX + id] = paths;
    await storageSet(payload);
    return slim;
}
export async function deletePackageForPlugin(id) {
    const indexKey = APP_ASSET_INDEX_PREFIX + id;
    const index = (await storageGet([indexKey]))[indexKey];
    const assetKeys = Array.isArray(index) ? index.map((path) => appAssetStorageKey(id, path)) : [];
    await storageRemove([APP_PACKAGE_PREFIX + id, APP_COMPILED_PREFIX + id + ':strict', APP_COMPILED_PREFIX + id + ':relaxed', indexKey, ...assetKeys]);
    compiledPackageCache.delete(id + ':strict'); compiledPackageCache.delete(id + ':relaxed');
}
export async function compiledForPlugin(plugin) {
    const strict = appStrict(plugin);
    const mode = strict ? 'strict' : 'relaxed';
    const cacheKey = `${plugin.id}:${mode}`;
    if (compiledPackageCache.has(cacheKey)) return compiledPackageCache.get(cacheKey);
    const storageKey = APP_COMPILED_PREFIX + plugin.id + ':' + mode;
    if (plugin.packageStored) {
        const stored = await storageGet([storageKey]);
        const cached = stored[storageKey];
        if (cached?.metadata?.id === plugin.id && cached?.metadata?.version === plugin.version && cached?.runtime) {
            compiledPackageCache.set(cacheKey, cached); return cached;
        }
    }
    const raw = await packageForPlugin(plugin);
    const compiled = compileApplicationPackage(raw, { strict });
    if (plugin.packageStored) {
        try {
            const slim = await storeCompiledPackage(plugin.id, compiled, mode);
            compiledPackageCache.set(cacheKey, slim);
            return slim;
        } catch { /* fall back to the in-memory compile for this session */ }
    }
    compiledPackageCache.set(cacheKey, compiled);
    return compiled;
}
