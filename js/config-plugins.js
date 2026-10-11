// Normalising the plug-ins part of a configuration: limit overlays and applications.

import { clamp, deepClone } from './utils.js';
import { normalizeIcon, stringOr } from './config-normalize.js';
import { normalizeApplicationWidgets } from './config-widgets.js';

function sanitizePluginCss(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/@import\s+[^;]+;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none').slice(0, 80000);
}

function sanitizePluginHtml(value) {
    if (typeof value !== 'string') return '';
    // Full DOM sanitization also happens when the overlay is mounted. Strip the most
    // dangerous constructs here so imported configs cannot keep executable markup.
    return value
        .replace(/<\/?(?:script|iframe|object|embed|link|meta)[^>]*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .slice(0, 80000);
}

function normalizeLimitPlugin(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = stringOr(raw.id, '').trim().replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);
    const name = stringOr(raw.name, '').trim().slice(0, 120);
    const version = stringOr(raw.version, '1.0.0').trim().slice(0, 40) || '1.0.0';
    const kind = raw.kind === 'limit-overlay' ? 'limit-overlay' : '';
    const actions = Array.isArray(raw.actions) ? [...new Set(raw.actions.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))].slice(0, 20) : [];
    const html = sanitizePluginHtml(raw.overlay?.html ?? raw.html ?? '');
    const css = sanitizePluginCss(raw.overlay?.css ?? raw.css ?? '');
    if (!id || !name || kind !== 'limit-overlay' || !actions.includes('delay5') || !html.includes('data-macos-action="delay5"') && !html.includes("data-macos-action='delay5'")) return null;
    return { id, name, version, kind, actions, overlay: { html, css } };
}

function normalizeApplicationMenus(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0,10).map((menu)=>{
        if (!menu || typeof menu !== 'object') return null;
        const title=stringOr(menu.title,'').slice(0,80); const titleKey=stringOr(menu.titleKey,'').slice(0,120);
        if (!title && !titleKey) return null;
        const items=(Array.isArray(menu.items)?menu.items:[]).slice(0,40).map((item)=>{
            if (item === '-' || item?.separator === true) return {separator:true};
            if(!item || typeof item!=='object') return null;
            const command=stringOr(item.command,'').replace(/[^a-z0-9._-]/gi,'-').slice(0,80);
            const label=stringOr(item.label,'').slice(0,120); const labelKey=stringOr(item.labelKey,'').slice(0,120);
            if(!command || (!label&&!labelKey)) return null;
            return {command,label,labelKey,shortcut:stringOr(item.shortcut,'').slice(0,30),danger:Boolean(item.danger),disabled:Boolean(item.disabled)};
        }).filter(Boolean);
        return {title,titleKey,items};
    }).filter(Boolean);
}

const APP_PLUGIN_PERMISSIONS = new Set(['storage', 'network', 'openExternal', 'clipboard', 'clipboardRead', 'menu', 'files', 'notifications', 'audio', 'statusItem', 'widgets', 'pointer', 'windows']);
function normalizeApplicationPlugin(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.kind !== 'app') return null;
    const id = stringOr(raw.id, '').trim().replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);
    const name = stringOr(raw.name, '').trim().slice(0, 120);
    if (!id || !name) return null;
    const version = stringOr(raw.version, '1.0.0').trim().slice(0, 40) || '1.0.0';
    const icon = normalizeIcon(raw.icon, '');
    const permissions = [...new Set((Array.isArray(raw.permissions) ? raw.permissions : [])
        .map((x) => String(x || '').trim()).filter((x) => APP_PLUGIN_PERMISSIONS.has(x)))];
    const win = raw.window && typeof raw.window === 'object' ? raw.window : {};
    const frameless = win.titlebar === 'none';
    const width = clamp(Number(win.width) || 640, frameless ? 40 : 260, 1280);
    const height = clamp(Number(win.height) || 480, frameless ? 40 : 220, 900);
    const minWidth = clamp(Number(win.minWidth) || Math.min(360, width), frameless ? 40 : 220, width);
    const minHeight = clamp(Number(win.minHeight) || Math.min(260, height), frameless ? 40 : 160, height);
    const appearance = ['system','light','dark'].includes(win.appearance) ? win.appearance : 'system';
    const material = ['glass','solid','transparent'].includes(win.material) ? win.material : 'glass';
    const titlebarHeight = clamp(Number(win.titlebarHeight) || 36, 32, 72);
    const borderRadius = clamp(Number(win.borderRadius) || 12, 8, 28);
    const showTitle = win.showTitle !== false;
    const titlebar = frameless ? 'none' : win.titlebar === 'hidden' ? 'hidden' : 'standard';
    const level = ['floating', 'desktop'].includes(win.level) ? win.level : 'normal';
    const showInDock = win.showInDock !== false;
    const resize = win.resizable === false || frameless ? 'none' : (['both', 'horizontal', 'vertical', 'none'].includes(win.resize) ? win.resize : 'both');
    const maxWidth = Number(win.maxWidth) > 0 ? clamp(Number(win.maxWidth), width, 10000) : 0;
    const maxHeight = Number(win.maxHeight) > 0 ? clamp(Number(win.maxHeight), height, 10000) : 0;
    const accent = stringOr(raw.accentColor, '').trim().toLowerCase();
    const packageStored = Boolean(raw.packageStored);
    const packagePath = typeof raw.packagePath === 'string' && /^plugin\/[a-z0-9._\/-]+\.json$/i.test(raw.packagePath) && !raw.packagePath.includes('..') ? raw.packagePath : '';
    if (!packageStored && !packagePath) return null;
    return {
        id, name, version, kind: 'app',
        description: stringOr(raw.description, '').trim().slice(0, 400),
        runtime: raw.runtime === 'native' ? 'native' : 'web',
        icon, permissions, menus: normalizeApplicationMenus(raw.menus),
        window: { width, height, minWidth, minHeight, resizable: resize !== 'none', resize, maxWidth, maxHeight, appearance, material, titlebarHeight, borderRadius, showTitle, titlebar, level, showInDock },
        bundled: Boolean(raw.bundled), packageStored, packagePath,
        // Widgets it offers for the desktop and the widget centre.
        widgets: normalizeApplicationWidgets(raw.widgets, permissions),
        // URL schemes it answers to (macos.openURL, the 'openurl' event).
        urlSchemes: [...new Set((Array.isArray(raw.urlSchemes) ? raw.urlSchemes : []).map((item) => String(item || '').trim().toLowerCase()))].filter((scheme) => /^[a-z][a-z0-9+.-]{1,31}$/.test(scheme)).slice(0, 4),
        // Other applications it exchanges messages with (macos.apps.send) — both must name each other.
        peers: [...new Set((Array.isArray(raw.peers) ? raw.peers : []).map((item) => String(item || '').trim()))].filter((peer) => /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(peer) && peer !== id).slice(0, 8),
        // The application has a settings interface of its own (it receives the 'settings' event).
        settings: raw.settings === true,
        // The accent the application uses while the system accent is set to multicolor.
        accentColor: /^(?:blue|purple|pink|red|orange|yellow|green|graphite|#[0-9a-f]{6})$/.test(accent) ? accent : '',
        // Extra entries for the application's own menu (the bold app name in the menu bar).
        appMenu: normalizeApplicationMenus([{ title: 'app', items: raw.appMenu }])[0]?.items || [],
        // Launch-at-startup is a user preference stored beside the app record. It is never
        // read from an application package.
        autoStart: raw.autoStart === true,
        // Multiple instances are likewise the user's choice (Developer settings), never the
        // package's: whether further windows of the app may be opened, and whether those
        // use the app's storage or a storage pool of their own.
        multiInstance: raw.multiInstance === true,
        instanceStorage: raw.instanceStorage === 'separate' ? 'separate' : 'shared',
        // Exempt from the host's limits and permission declarations. Set by hand in
        // Developer settings only; see applicationUnrestricted() in plugin-system.js.
        unrestricted: raw.unrestricted === true,
        // Runs under the relaxed limits instead of strict security. Likewise chosen by hand,
        // per application, and only effective while Developer ▸ Disable strict security is on.
        relaxed: raw.relaxed === true,
        // Declared permissions the user switched off for this application (System Settings ▸ Applications).
        deniedPermissions: [...new Set((Array.isArray(raw.deniedPermissions) ? raw.deniedPermissions : []).map(String).filter((name) => permissions.includes(name)))],
        // The appearance the application last chose for itself with macos.window.setAppearance
        // ('' while it never chose: the manifest's window.appearance applies). Kept here so its
        // window opens in that appearance straight away.
        appearance: ['system', 'light', 'dark'].includes(raw.appearance) ? raw.appearance : '',
        // Whether the user lets it show notifications (System Settings ▸ Notifications).
        notifications: raw.notifications !== false
    };
}

export function normalizePlugins(rawPlugins, basePlugins) {
    const raw = rawPlugins && typeof rawPlugins === 'object' && !Array.isArray(rawPlugins) ? rawPlugins : {};
    const base = basePlugins && typeof basePlugins === 'object' && !Array.isArray(basePlugins) ? basePlugins : {};
    const installed = (Array.isArray(raw.installed) ? raw.installed : (Array.isArray(base.installed) ? base.installed : []))
        .map(normalizeLimitPlugin).filter(Boolean).slice(0, 24);

    // Whole-system configuration exports remain schema-compatible across Developer Beta
    // builds. Bundled applications are host components, so when an older export carries
    // stale bundled metadata (for example the old Calculator window dimensions), use the
    // current default.json metadata for that same bundled id. An explicitly empty apps
    // array is still respected so uninstalling a bundled launcher/app is not undone.
    const baseApps = (Array.isArray(base.apps) ? base.apps : []).map(normalizeApplicationPlugin).filter(Boolean);
    const baseById = new Map(baseApps.filter((app) => app.bundled).map((app) => [app.id, app]));
    const rawHasApps = Array.isArray(raw.apps);
    const rawApps = rawHasApps ? raw.apps.map(normalizeApplicationPlugin).filter(Boolean) : [];
    let apps;
    if (!rawHasApps) {
        apps = baseApps;
    } else if (raw.apps.length > 0 && rawApps.length === 0) {
        // A non-empty but wholly invalid app list is corruption/old schema, not an
        // intentional uninstall. Repair it from the current default schema.
        apps = baseApps;
    } else {
        apps = rawApps.map((app) => {
            const currentBundled = baseById.get(app.id);
            if (currentBundled && currentBundled.version !== app.version) return { ...deepClone(currentBundled), autoStart: app.autoStart, multiInstance: app.multiInstance, instanceStorage: app.instanceStorage, unrestricted: app.unrestricted, relaxed: app.relaxed, notifications: app.notifications, appearance: app.appearance,
                deniedPermissions: app.deniedPermissions.filter((name) => currentBundled.permissions.includes(name)) };
            return app;
        });
    }
    apps = apps.slice(0, 40);

    const requested = stringOr(raw.activeLimitOverlay, stringOr(base.activeLimitOverlay, 'builtin'));
    const activeLimitOverlay = requested === 'builtin' || installed.some((plugin) => plugin.id === requested) ? requested : 'builtin';
    return {
        installed, apps, activeLimitOverlay,
        // Bundled applications this profile has already been offered. A bundled app is
        // installed (with its launcher) the first time it is seen and never again, so
        // uninstalling one sticks while apps added by a later build still appear.
        bundledSeen: [...new Set((Array.isArray(raw.bundledSeen) ? raw.bundledSeen : []).map((id) => String(id || '').slice(0, 80)).filter(Boolean))].slice(0, 200)
    };
}
