import { state } from './state.js';
import { t } from './i18n.js';
import { createElement } from './utils.js';
import { dev, devEmit, devPreview } from './dev-hooks.js';
import {
    beginManagedWindowDrag, bringManagedWindowToFront, closeManagedWindow, managedWindowList, minimizeManagedWindow, registerManagedWindow,
    restoreManagedWindow, toggleZoomManagedWindow
} from './window-manager.js';
import {
    applicationPermissionLog, devApplications, devManifestWindow, devNativeUi, devPackageOf, devReloadApplication, devSendEvent, devSetOverride,
    devSetWindowSize, devStorage, devWhenReady, devWindowSizeOf, installApplicationPackage, openPluginApp, validateApplicationPlugin
} from './plugin-system.js';
import { showMacAlert, showMacConfirm } from './dialog.js';
import { formatBytes } from './storage-settings.js';
import { upgradeNativeSelect } from './glass-select.js';
import { performancePanel, tasksPanel } from './devtools-monitor.js';

// Developer Tools: a window for building applications and for watching how the desktop
// works. It exists only while Developer Mode ▸ Developer Tools is on; with it off none
// of the instrumentation in dev-hooks.js records anything.
//
//   Applications  load an app straight from its source folder and reload it when a file
//                 changes; pack a folder into an installable package; simulate conditions
//                 (language, appearance, window size, display scale, refused permissions,
//                 offline, full storage) per application; which permissions it really used
//   Replay        record the input events the system sends an application, and play them
//                 back — after changing its code — to bring it to the same state
//   Console       macos.log output, errors and crashes, every API call with its duration
//                 and result, and the events the host sends; calls that break the
//                 performance budget (an interface update over one frame, too many calls
//                 a second) are marked
//   Interface     the live node tree of a native app, with the element highlighted
//   Storage       an application's key/value entries and files, editable
//   Task Manager  the running application windows and what each costs the desktop; Show,
//                 Reload, Quit (devtools-monitor.js)
//   Performance   the last minute as charts: frame rate, slowest frame, long tasks, memory,
//                 and the traffic between applications and the system (devtools-monitor.js)
//   System        frame rate and long tasks, the window registry, how often each desktop
//                 surface was redrawn or skipped, internal events and configuration saves
//   Configuration the normalised configuration, optionally only where it differs from the
//                 defaults; diagnostics export

const L = (key, fallback) => t(key, fallback);
const el = (tag, className = '', text = '') => createElement(tag, { className, ...(text !== '' ? { text } : {}) });
const button = (label, onClick, className = '') => { const node = createElement('button', { className: `mac-btn ${className}`.trim(), text: label, attrs: { type: 'button' } }); node.addEventListener('click', onClick); return node; };
function select(options, value, onChange) {
    const node = createElement('select', { className: 'devtools-select' });
    for (const [optionValue, label] of options) node.appendChild(createElement('option', { text: label, attrs: { value: optionValue } }));
    node.value = value;
    node.addEventListener('change', () => onChange(node.value));
    // Shown as the system's pop-up button; the <select> stays as the value holder.
    const wrap = createElement('span', { className: 'devtools-select-wrap' });
    wrap.appendChild(node);
    upgradeNativeSelect(node);
    return wrap;
}
function checkbox(label, checked, onChange) {
    const wrap = createElement('label', { className: 'devtools-check' });
    const input = createElement('input', { attrs: { type: 'checkbox' } });
    input.checked = Boolean(checked);
    input.addEventListener('change', () => onChange(input.checked));
    wrap.append(input, document.createTextNode(label));
    return wrap;
}
const clockOf = (at) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`; };

let win = null; let body = null; let toolbar = null; let title = null;
let current = 'apps';
let dispose = null;          // cleanup of the panel on screen
let onEntry = null;          // live feed for the panel on screen
let onTick = null;           // once a second while the window is visible

// ---------------------------------------------------------------------------------
// Applications: load from a folder, reload on change, simulated conditions
// ---------------------------------------------------------------------------------
const TEXT_FILES = /\.(html?|css|m?js|json|svg|txt|md)$/i;
const MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', md: 'text/markdown', woff2: 'font/woff2', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };
const folders = new Map();   // application id -> { handle, signature, watch, error }
async function* walk(directory, prefix = '') {
    for await (const [name, entry] of directory.entries()) {
        if (name.startsWith('.')) continue;
        if (entry.kind === 'directory') yield* walk(entry, `${prefix}${name}/`);
        else yield [`${prefix}${name}`, entry];
    }
}
async function folderSignature(handle) {
    const parts = [];
    for await (const [path, entry] of walk(handle)) { const file = await entry.getFile(); parts.push(`${path}:${file.lastModified}:${file.size}`); }
    return parts.sort().join('|');
}
function toBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}
// The same package plugin/tools/pack.py writes, built in the page from the folder.
async function packFolder(handle) {
    let manifest = null; const files = {}; const parts = [];
    for await (const [path, entry] of walk(handle)) {
        const file = await entry.getFile();
        parts.push(`${path}:${file.lastModified}:${file.size}`);
        if (path === 'app.json') { manifest = JSON.parse(await file.text()); continue; }
        const mime = MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
        files[path] = TEXT_FILES.test(path) ? { mime, text: await file.text() } : { mime, base64: toBase64(new Uint8Array(await file.arrayBuffer())) };
    }
    if (!manifest) throw new Error(L('devNoManifest', '这个文件夹里没有 app.json。'));
    return { pkg: { format: 'macos-app-package-v3', ...manifest, files }, signature: parts.sort().join('|') };
}
/** Installs the application in `handle` (a directory handle) and opens or reloads it. */
export async function devLoadFolder(handle, { open = true } = {}) {
    const { pkg, signature } = await packFolder(handle);
    const plugin = await installApplicationPackage(pkg, { source: handle.name });
    folders.set(plugin.id, { handle, signature, watch: folders.get(plugin.id)?.watch ?? true, error: '' });
    if (open) await devReloadApplication(plugin.id);
    return plugin;
}
let watching = false;
async function watchFolders() {
    if (watching || !dev.enabled) return;
    watching = true;
    try {
        for (const [id, folder] of folders) {
            if (!folder.watch) continue;
            let signature;
            try { signature = await folderSignature(folder.handle); } catch (error) { folder.error = error?.message || String(error); continue; }
            if (signature === folder.signature) continue;
            folder.signature = signature;
            try {
                await devLoadFolder(folder.handle);
                folder.error = '';
                devEmit('system', { name: 'reloaded', app: id, text: folder.handle.name });
            } catch (error) {
                folder.error = error?.message || String(error);
                devEmit('crash', { app: id, level: 'error', text: `${L('devReloadFailed', '重新载入失败')}: ${folder.error}` });
            }
            if (current === 'apps') show('apps');
        }
    } finally { watching = false; }
}
setInterval(() => { if (folders.size) watchFolders(); }, 1200);

function downloadPackage(pkg) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }));
    createElement('a', { attrs: { href: url, download: `${String(pkg.id || 'app').replace(/[^a-z0-9._-]/gi, '-')}.macos-app.json` } }).click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/** Packs the application in `handle` into an installable package and saves it (what plugin/tools/pack.py does). */
export async function devPackFolder(handle) {
    const { pkg } = await packFolder(handle);
    validateApplicationPlugin(pkg); // the same checks installing it would run
    downloadPackage(pkg);
    return pkg;
}
const packedNote = (pkg) => L('devPacked', '已导出 {name} {version}：{files} 个文件，{size}。').replace('{name}', pkg.name || pkg.id).replace('{version}', pkg.version || '')
    .replace('{files}', String(Object.keys(pkg.files || {}).length)).replace('{size}', formatBytes(JSON.stringify(pkg).length));
const WINDOW_SIZES = [[800, 600], [1024, 768], [1280, 800], [1440, 900]];
const ZOOMS = [['', '100%'], ['0.75', '75%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']];
const sizeChoice = new Map(); // application id -> the preset last applied
const LANGUAGES = [['', '—'], ['zh-CN', '简体中文'], ['en-US', 'English'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['ar', 'العربية']];
function appsPanel() {
    toolbar.append(
        button(L('devLoadFolder', '从文件夹载入…'), async () => {
            if (typeof window.showDirectoryPicker !== 'function') return showMacAlert(L('devNoPicker', '这个浏览器不支持选择文件夹。'), { title: L('devTools', '开发者工具') });
            let handle;
            try { handle = await window.showDirectoryPicker({ mode: 'read' }); } catch { return; }
            try { await devLoadFolder(handle); } catch (error) { await showMacAlert(error?.message || String(error), { title: L('devLoadFailed', '无法载入应用程序') }); }
            show('apps');
        }, 'blue'),
        button(L('devPackFolder', '打包文件夹…'), async () => {
            if (typeof window.showDirectoryPicker !== 'function') return showMacAlert(L('devNoPicker', '这个浏览器不支持选择文件夹。'), { title: L('devTools', '开发者工具') });
            let handle;
            try { handle = await window.showDirectoryPicker({ mode: 'read' }); } catch { return; }
            try { const pkg = await devPackFolder(handle); await showMacAlert(packedNote(pkg), { title: L('devPackFolder', '打包文件夹…') }); }
            catch (error) { await showMacAlert(error?.message || String(error), { title: L('devPackFailed', '无法打包') }); }
        })
    );
    body.appendChild(el('div', 'devtools-note', L('devAppsNote', '从源码文件夹载入的应用程序会像安装包一样安装，并在文件有改动时自动重新载入（只在本页面打开期间有效；刷新页面后需重新选择文件夹）。')));
    const apps = devApplications();
    if (!apps.length) body.appendChild(el('div', 'devtools-empty', L('noApplicationsInstalled', '尚未安装应用程序插件。')));
    for (const app of apps) {
        const folder = folders.get(app.id);
        const card = el('div', 'mac-card devtools-app');
        const head = el('div', 'devtools-app-head');
        const icon = el('span', 'devtools-app-icon'); if (app.icon) icon.appendChild(createElement('img', { attrs: { src: app.icon, alt: '' } }));
        const info = el('div', 'devtools-app-info');
        info.append(el('strong', '', app.name), el('span', 'developer-setting-note', [
            `${app.id} · v${app.version} · ${app.runtime}`,
            app.instances.length ? `${app.instances.length} ${L('devInstances', '个窗口')}` : L('devNotRunning', '未运行'),
            folder ? `${L('devFromFolder', '文件夹')}: ${folder.handle.name}` : app.bundled ? L('devBundled', '内置') : ''
        ].filter(Boolean).join(' · ')));
        const actions = el('div', 'devtools-app-actions');
        if (folder) actions.appendChild(checkbox(L('devWatch', '有改动时重新载入'), folder.watch, (on) => { folder.watch = on; }));
        // The installable package: packed afresh from the folder, or the one that is installed.
        actions.appendChild(button(L('devExportPackage', '导出安装包'), async () => {
            try { if (folder) await devPackFolder(folder.handle); else downloadPackage(await devPackageOf(app.id)); }
            catch (error) { await showMacAlert(error?.message || String(error), { title: L('devPackFailed', '无法打包') }); }
        }));
        actions.appendChild(button(app.instances.length ? L('reloadApp', '重新载入') : L('open', '打开'), async () => {
            try { if (folder) await devLoadFolder(folder.handle); else if (app.instances.length) await devReloadApplication(app.id); else await openPluginApp(app.id); }
            catch (error) { await showMacAlert(error?.message || String(error), { title: app.name }); }
            show('apps');
        }));
        head.append(icon, info, actions);
        card.appendChild(head);
        if (folder?.error) card.appendChild(el('div', 'devtools-error', folder.error));

        // Simulated conditions.
        const override = { language: '', theme: '', deny: [], offline: false, storageFull: false, zoom: '', ...(dev.overrides.get(app.id) || {}) };
        const apply = () => devSetOverride(app.id, { ...override, deny: [...override.deny] });
        const conditions = el('div', 'devtools-conditions');
        const field = (label, control) => { const wrap = el('div', 'devtools-field'); wrap.append(el('span', '', label), control); return wrap; };
        conditions.append(
            field(L('language', '显示语言'), select(LANGUAGES.map(([value, label]) => [value, value ? label : L('devFollowSystem', '跟随系统')]), override.language, (value) => { override.language = value; apply(); })),
            field(L('devAppearance', '外观'), select([['', L('devFollowSystem', '跟随系统')], ['light', L('wallpaperScopeLight', '浅色')], ['dark', L('wallpaperScopeDark', '深色')]], override.theme, (value) => { override.theme = value; apply(); })),
            field(L('devWindowSize', '窗口尺寸'), select((() => {
                const manifest = devManifestWindow(app.id) || { width: 640, height: 480, minWidth: 360, minHeight: 260 };
                return [['', '—'], [`${manifest.minWidth}x${manifest.minHeight}`, `${L('devSizeMin', '最小')} ${manifest.minWidth}×${manifest.minHeight}`], [`${manifest.width}x${manifest.height}`, `${L('devSizeDefault', '默认')} ${manifest.width}×${manifest.height}`],
                    ...WINDOW_SIZES.map(([width, height]) => [`${width}x${height}`, `${width}×${height}`])];
            })(), sizeChoice.get(app.id) || '', (value) => {
                sizeChoice.set(app.id, value);
                const [width, height] = value.split('x').map(Number);
                if (!width || !height) return;
                devSetWindowSize(app.id, width, height);
                const got = devWindowSizeOf(app.id);
                // The window cannot be larger than the desktop: say what it really became.
                if (got && (got.width !== width || got.height !== height)) devEmit('system', { app: app.id, name: 'window size', text: `${width}×${height} → ${got.width}×${got.height}` });
            })),
            field(L('devZoom', '缩放比例'), select(ZOOMS, String(override.zoom || ''), (value) => { override.zoom = value; apply(); })),
            checkbox(L('devOffline', '模拟断网'), override.offline, (on) => { override.offline = on; apply(); }),
            checkbox(L('devStorageFull', '模拟储存已满'), override.storageFull, (on) => { override.storageFull = on; apply(); })
        );
        if (app.permissions.length) {
            const deny = el('div', 'devtools-deny');
            deny.appendChild(el('span', 'developer-setting-note', L('devDeny', '拒绝权限：')));
            for (const permission of app.permissions) deny.appendChild(checkbox(permission, override.deny.includes(permission), (on) => { override.deny = on ? [...new Set([...override.deny, permission])] : override.deny.filter((name) => name !== permission); apply(); }));
            conditions.appendChild(deny);
        }
        card.appendChild(conditions);
        // What it really used of its permissions.
        const usage = el('div', 'devtools-usage');
        card.appendChild(usage);
        applicationPermissionLog(app.id).then((log) => {
            const names = [...new Set([...app.permissions, ...Object.keys(log)])];
            usage.appendChild(el('span', 'developer-setting-note', `${L('permissionUsage', '权限使用记录')} · ${L('securityLevel', '安全级别')}: ${app.security}`));
            for (const name of names) {
                const use = log[name];
                const chip = el('span', `devtools-usage-chip${use?.count ? '' : ' unused'}${use?.denied ? ' denied' : ''}`, use?.count ? `${name} ×${use.count}` : name);
                chip.title = [use?.count ? `${L('devLastUsed', '最近使用')}: ${new Date(use.last).toLocaleString()}` : L('permissionNeverUsed', '从未使用'),
                    use?.denied ? `${L('devRefused', '被拒绝')} ×${use.denied}: ${new Date(use.lastDenied).toLocaleString()}` : '', app.permissions.includes(name) ? '' : L('permissionUndeclared', '未声明')].filter(Boolean).join('\n');
                usage.appendChild(chip);
            }
        }).catch(() => {});
        body.appendChild(card);
    }
}

// ---------------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------------
const consoleFilter = { app: '', kinds: { log: true, api: true, event: false, system: false }, errorsOnly: false, paused: false };
function entryVisible(entry) {
    const kind = entry.kind === 'crash' || entry.kind === 'perf' ? 'log' : entry.kind === 'config' ? 'system' : entry.kind;
    if (!consoleFilter.kinds[kind]) return false;
    if (consoleFilter.errorsOnly && entry.level !== 'error' && entry.level !== 'warn') return false;
    return !consoleFilter.app || (entry.app || '').split('#')[0] === consoleFilter.app;
}
function entryRow(entry) {
    const row = el('div', `devtools-log-row kind-${entry.kind}${entry.level === 'error' ? ' error' : entry.level === 'warn' ? ' warn' : ''}`);
    const text = entry.kind === 'api' ? `${entry.name}(${entry.args === '{}' ? '' : entry.args || ''}) → ${entry.text ?? ''}` : [entry.name, entry.text].filter((part) => part !== undefined && part !== '').join('  ');
    row.append(el('span', 'devtools-log-time', clockOf(entry.at)), el('span', 'devtools-log-app', entry.app || '—'), el('span', 'devtools-log-kind', entry.kind),
        el('span', 'devtools-log-text', text), el('span', 'devtools-log-ms', entry.ms != null ? `${entry.ms} ms` : ''));
    row.title = text;
    row.addEventListener('click', () => row.classList.toggle('expanded'));
    return row;
}
function consolePanel() {
    const list = el('div', 'devtools-log scrollbar');
    const refill = () => { list.replaceChildren(...dev.entries.filter(entryVisible).slice(-500).map(entryRow)); list.scrollTop = list.scrollHeight; };
    const apps = devApplications();
    toolbar.append(
        select([['', L('devAllApps', '所有应用程序')], ...apps.map((app) => [app.id, app.name])], consoleFilter.app, (value) => { consoleFilter.app = value; refill(); }),
        ...[['log', L('devKindLog', '日志')], ['api', L('devKindApi', '接口调用')], ['event', L('devKindEvent', '事件')], ['system', L('devKindSystem', '系统')]].map(([kind, label]) => checkbox(label, consoleFilter.kinds[kind], (on) => { consoleFilter.kinds[kind] = on; refill(); })),
        checkbox(L('devErrorsOnly', '仅错误'), consoleFilter.errorsOnly, (on) => { consoleFilter.errorsOnly = on; refill(); }),
        checkbox(L('devPause', '暂停'), consoleFilter.paused, (on) => { consoleFilter.paused = on; if (!on) refill(); }),
        button(L('clear', '清除'), () => { dev.entries.length = 0; refill(); })
    );
    body.classList.add('devtools-body-fill');
    body.appendChild(list);
    refill();
    onEntry = (entry) => {
        if (consoleFilter.paused || !entryVisible(entry)) return;
        const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        list.appendChild(entryRow(entry));
        while (list.childElementCount > 600) list.firstElementChild.remove();
        if (pinned) list.scrollTop = list.scrollHeight;
    };
}

// ---------------------------------------------------------------------------------
// Interface inspector
// ---------------------------------------------------------------------------------
let inspected = '';
let highlight = null; let ghost = null;
// The filled highlight lives inside the window that owns the element, so whatever is in
// front of that window covers it too; a bare outline on top marks the spot regardless.
function showHighlight(target) {
    highlight?.remove(); ghost?.remove(); highlight = null; ghost = null;
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    const host = target.closest('.plugin-app-window, .window') || document.body;
    const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
    const inside = host === target ? { left: 0, top: 0 } : { left: rect.left - origin.left - host.clientLeft, top: rect.top - origin.top - host.clientTop };
    highlight = el('div', 'devtools-highlight');
    Object.assign(highlight.style, { left: `${inside.left}px`, top: `${inside.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    host.appendChild(highlight);
    ghost = el('div', 'devtools-highlight-ghost');
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.appendChild(ghost);
}
function inspectorPanel() {
    const natives = devApplications().flatMap((app) => app.instances.filter((instance) => instance.native).map((instance) => [instance.key, `${app.name}${instance.instance > 1 ? ` #${instance.instance}` : ''}`]));
    if (!natives.some(([key]) => key === inspected)) inspected = natives[0]?.[0] || '';
    toolbar.append(
        select(natives.length ? natives : [['', L('devNoNative', '没有正在运行的原生应用程序')]], inspected, (value) => { inspected = value; show('ui'); }),
        button(L('devRefresh', '刷新'), () => show('ui')),
        checkbox(L('devLayoutBounds', '显示布局边界'), document.body.classList.contains('dev-show-layout'), (on) => document.body.classList.toggle('dev-show-layout', on))
    );
    const ui = devNativeUi(inspected);
    if (!ui) { body.appendChild(el('div', 'devtools-empty', L('devInspectHint', '打开一个原生应用程序，这里会显示它的界面节点树。'))); return; }
    body.classList.add('devtools-body-fill');
    const split = el('div', 'devtools-split');
    const tree = el('div', 'devtools-tree scrollbar');
    const details = el('pre', 'devtools-details scrollbar');
    details.textContent = L('devPickNode', '点按一个节点查看它的属性。');
    let rows = 0;
    const add = (node, depth) => {
        if (!node || rows > 3000) return;
        rows += 1;
        const target = ui.elementFor(node);
        const row = el('div', 'devtools-tree-row');
        row.style.paddingLeft = `${8 + depth * 14}px`;
        const label = node.label || node.text || node.placeholder || '';
        row.append(el('span', 'devtools-node-type', node.type), ...(node.id ? [el('span', 'devtools-node-id', `#${node.id}`)] : []),
            ...(label ? [el('span', 'devtools-node-text', `“${String(label).slice(0, 40)}”`)] : []),
            el('span', 'devtools-node-size', target ? `${target.offsetWidth}×${target.offsetHeight}` : ''),
            ...(node.type === 'list' || node.type === 'table' ? [el('span', 'devtools-node-size', `${(node.items || node.rows || []).length} ${L('devRows', '行')}`)] : []));
        row.addEventListener('mouseenter', () => showHighlight(target));
        row.addEventListener('click', () => {
            tree.querySelector('.selected')?.classList.remove('selected'); row.classList.add('selected');
            const { children, items, rows: tableRows, commands, html, css, ...props } = node;
            const rect = target?.getBoundingClientRect();
            details.textContent = JSON.stringify({ ...props, ...(children ? { children: children.length } : {}), ...(items ? { items: items.length } : {}), ...(tableRows ? { rows: tableRows.length } : {}),
                ...(commands ? { commands: commands.length } : {}), ...(html != null ? { html: `${html.length} chars` } : {}), ...(css ? { css: `${css.length} chars` } : {}),
                ...(rect ? { $frame: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } } : {}) }, null, 2);
        });
        tree.appendChild(row);
        (node.children || []).forEach((child) => add(child, depth + 1));
    };
    add(ui.tree(), 0);
    tree.addEventListener('mouseleave', () => showHighlight(null));
    toolbar.appendChild(el('span', 'devtools-toolbar-note', `${ui.nodeCount()} / ${ui.nodeLimit()} ${L('devNodes', '个节点')}`));
    split.append(tree, details);
    body.appendChild(split);
    dispose = () => showHighlight(null);
}

// ---------------------------------------------------------------------------------
// Storage browser
// ---------------------------------------------------------------------------------
let storageApp = ''; let storagePool = '';
async function storagePanel() {
    const apps = devApplications();
    if (!apps.some((app) => app.id === storageApp)) storageApp = apps[0]?.id || '';
    const pools = storageApp ? devStorage.pools(storageApp) : [];
    if (!pools.includes(storagePool)) storagePool = pools[0] || '';
    toolbar.append(
        select(apps.length ? apps.map((app) => [app.id, app.name]) : [['', '—']], storageApp, (value) => { storageApp = value; storagePool = ''; show('storage'); }),
        select(pools.map((pool, index) => [pool, index ? `${L('devInstance', '实例')} ${index + 1}` : L('devMainPool', '应用程序（实例 1）')]), storagePool, (value) => { storagePool = value; show('storage'); }),
        button(L('devRefresh', '刷新'), () => show('storage'))
    );
    if (!storagePool) { body.appendChild(el('div', 'devtools-empty', L('noApplicationsInstalled', '尚未安装应用程序插件。'))); return; }
    const pool = storagePool;
    const [entries, files] = await Promise.all([devStorage.entries(pool).catch(() => ({})), devStorage.files(pool).catch(() => [])]);
    if (current !== 'storage' || pool !== storagePool) return;
    body.appendChild(el('div', 'devtools-note', L('devStorageNote', '这里的修改直接写入储存。正在运行的应用程序通常只在启动时读取，重新载入后才会看到改动。')));

    body.appendChild(el('h3', '', `${L('devKeyValue', '键值数据')} · ${Object.keys(entries).length}`));
    const keys = el('div', 'mac-card devtools-table');
    const editor = el('div', 'devtools-editor');
    const edit = (key, value) => {
        const name = createElement('input', { className: 'mac-input', attrs: { type: 'text', placeholder: L('devKey', '键') } }); name.value = key;
        const area = createElement('textarea', { className: 'mac-input devtools-json', attrs: { spellcheck: 'false' } }); area.value = value === undefined ? '' : JSON.stringify(value, null, 2);
        const status = el('span', 'devtools-toolbar-note');
        editor.replaceChildren(name, area, el('div', 'devtools-editor-actions'));
        editor.lastElementChild.append(status, button(L('cancel', '取消'), () => editor.replaceChildren()), button(L('save', '保存'), async () => {
            try { await devStorage.set(pool, name.value.trim(), JSON.parse(area.value)); show('storage'); }
            catch (error) { status.textContent = error?.message || String(error); status.classList.add('devtools-error-text'); }
        }, 'blue'));
        area.focus();
    };
    for (const [key, value] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
        const row = el('div', 'card-row devtools-row');
        const text = JSON.stringify(value) ?? '';
        row.append(el('span', 'devtools-key', key), el('span', 'devtools-value', devPreview(value, 90)), el('span', 'storage-row-size', formatBytes(text.length)),
            button(L('edit', '编辑'), () => edit(key, value)),
            button(L('btnDelete', '删除'), async () => { await devStorage.remove(pool, key); show('storage'); }));
        keys.appendChild(row);
    }
    if (!Object.keys(entries).length) keys.appendChild(el('div', 'card-row developer-setting-note', L('devNoEntries', '没有键值数据。')));
    const addRow = el('div', 'card-row devtools-row'); addRow.append(el('span', 'devtools-value', ''), button(L('devAddEntry', '新建条目'), () => edit('', null)));
    keys.appendChild(addRow);
    body.append(keys, editor);

    const total = files.reduce((sum, file) => sum + (file.size || 0), 0);
    body.appendChild(el('h3', '', `${L('devFiles', '文件')} · ${files.length} · ${formatBytes(total)}`));
    const list = el('div', 'mac-card devtools-table');
    for (const file of [...files].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 400)) {
        const row = el('div', 'card-row devtools-row');
        row.append(el('span', 'devtools-key', file.name || file.id), el('span', 'devtools-value', `${file.type || ''} · ${file.id}`), el('span', 'storage-row-size', formatBytes(file.size)),
            button(L('exportPlugin', '导出'), () => devStorage.exportFile(pool, file.id)),
            button(L('btnDelete', '删除'), async () => { await devStorage.removeFile(pool, file.id); show('storage'); }));
        list.appendChild(row);
    }
    if (!files.length) list.appendChild(el('div', 'card-row developer-setting-note', L('devNoFiles', '没有文件。')));
    body.appendChild(list);
}

// ---------------------------------------------------------------------------------
// Record and replay
// ---------------------------------------------------------------------------------
const recordings = new Map(); // instance key -> [{ t, name, detail }]
let replayApp = ''; let replaySpeed = '1'; let replayReload = true;
let playback = null;          // { key, cancelled } while a recording is played back
async function playRecording(key, mark) {
    const events = recordings.get(key) || [];
    if (!events.length || playback) return;
    playback = { key, cancelled: false };
    const run = playback;
    try {
        if (replayReload) await devReloadApplication(key.split('#')[0]);
        if (!(await devWhenReady(key))) throw new Error(L('devReplayNotRunning', '应用程序没有在运行。'));
        dev.replaying = true;
        let previous = 0;
        for (const [index, event] of events.entries()) {
            // As fast as possible still leaves the application a moment to act on each event.
            const wait = replaySpeed === '0' ? 30 : Math.max(0, event.t - previous) / Number(replaySpeed);
            previous = event.t;
            await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10_000)));
            if (run.cancelled) break;
            if (!devSendEvent(key, event.name, event.detail)) throw new Error(L('devReplayNotRunning', '应用程序没有在运行。'));
            mark(index);
        }
        devEmit('system', { app: key, name: 'replayed', text: `${events.length} events` });
    } finally { dev.replaying = false; playback = null; }
}
function replayPanel() {
    const instances = devApplications().flatMap((app) => (app.instances.length ? app.instances : [{ key: app.id, instance: 1 }]).map((instance) => [instance.key, `${app.name}${instance.instance > 1 ? ` #${instance.instance}` : ''}`]));
    // Unless one was chosen: the application being recorded, else one that is running.
    if (!instances.some(([key]) => key === replayApp)) replayApp = dev.recorder?.app || devApplications().flatMap((app) => app.instances)[0]?.key || instances[0]?.[0] || '';
    const key = replayApp;
    const recording = dev.recorder?.app === key;
    const events = recording ? dev.recorder.events : recordings.get(key) || [];
    const status = el('span', 'devtools-toolbar-note');
    toolbar.append(
        select(instances.length ? instances : [['', '—']], key, (value) => { replayApp = value; show('replay'); }),
        button(recording ? L('devRecordStop', '■ 停止') : L('devRecord', '● 录制'), () => {
            if (recording) { recordings.set(key, dev.recorder.events); dev.recorder = null; }
            else if (key) dev.recorder = { app: key, start: performance.now(), events: [] };
            show('replay');
        }, recording ? 'blue' : ''),
        (() => {
            const replay = button(L('devReplay', '▶ 回放'), async () => {
                if (playback) { playback.cancelled = true; return; }
                const rows = [...body.querySelectorAll('.devtools-replay-row')];
                rows.forEach((row) => row.classList.remove('played'));
                status.textContent = ''; status.classList.remove('devtools-error-text');
                replay.textContent = L('devReplayStop', '停止回放');
                // Each event is ticked off in the list as it is sent.
                try { await playRecording(key, (index) => { rows[index]?.classList.add('played');
                    // Scrolls the list only (scrollIntoView would also move the page under a window that is partly off screen).
                    const row = rows[index]; const list = row?.parentElement;
                    if (row) { const box = list.getBoundingClientRect(); const at = row.getBoundingClientRect(); if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom; else if (at.top < box.top) list.scrollTop -= box.top - at.top; } }); }
                catch (error) { status.textContent = error?.message || String(error); status.classList.add('devtools-error-text'); }
                finally { replay.textContent = L('devReplay', '▶ 回放'); }
            });
            return replay;
        })(),
        select([['1', L('devSpeedReal', '原速')], ['4', '×4'], ['0', L('devSpeedFast', '尽快')]], replaySpeed, (value) => { replaySpeed = value; }),
        checkbox(L('devReplayReload', '回放前重新载入'), replayReload, (on) => { replayReload = on; }),
        button(L('exportPlugin', '导出'), () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'macos-app-recording-v1', app: key.split('#')[0], events }, null, 2)], { type: 'application/json' }));
            createElement('a', { attrs: { href: url, download: `${key.split('#')[0]}.recording.json` } }).click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        }),
        (() => {
            const label = createElement('label', { className: 'mac-btn', text: L('devImport', '导入') });
            const input = createElement('input', { attrs: { type: 'file', accept: 'application/json,.json', hidden: '' } });
            input.addEventListener('change', async () => {
                try {
                    const parsed = JSON.parse(await input.files[0].text());
                    if (parsed?.format !== 'macos-app-recording-v1' || !Array.isArray(parsed.events)) throw new Error(L('devRecordingInvalid', '这不是一份录制文件。'));
                    recordings.set(key, parsed.events.filter((event) => event && typeof event.name === 'string').map((event) => ({ t: Number(event.t) || 0, name: event.name, detail: event.detail ?? {} })));
                    show('replay');
                } catch (error) { status.textContent = error?.message || String(error); status.classList.add('devtools-error-text'); }
            });
            label.appendChild(input);
            return label;
        })(),
        button(L('clear', '清除'), () => { recordings.delete(key); if (recording) dev.recorder.events.length = 0; show('replay'); }),
        status
    );
    body.appendChild(el('div', 'devtools-note', L('devReplayNote', '录制的是系统发给应用程序的输入事件：控件事件、按键、菜单命令、聚焦搜索结果、状态栏和通知的点按。回放时按原来的间隔重新发给应用程序，用来在改完代码后回到同一个状态。输入框里显示的文字不会跟着变化，应用程序收到的值是一样的。')));
    if (!events.length) { body.appendChild(el('div', 'devtools-empty', recording ? L('devRecordingHint', '正在录制。操作一下应用程序。') : L('devNoRecording', '还没有录制。选一个应用程序，点按“录制”。'))); }
    const list = el('div', 'devtools-log devtools-replay scrollbar');
    events.forEach((event) => {
        const row = el('div', 'devtools-log-row devtools-replay-row');
        row.append(el('span', 'devtools-log-time', `+${(event.t / 1000).toFixed(2)} s`), el('span', 'devtools-log-kind', event.name), el('span', 'devtools-log-text', devPreview(event.detail, 200)));
        row.title = JSON.stringify(event.detail);
        list.appendChild(row);
    });
    if (events.length) { body.classList.add('devtools-body-fill'); body.appendChild(list); }
    // While recording, new events show up as they are sent.
    if (recording) onTick = () => { if (dev.recorder?.app === key && dev.recorder.events.length !== list.childElementCount && !playback) show('replay'); };
}

// ---------------------------------------------------------------------------------
// System monitor
// ---------------------------------------------------------------------------------
let frames = 0; let fps = 0; let frameLoop = 0;
const longTasks = [];
try { new PerformanceObserver((list) => { if (dev.enabled) for (const entry of list.getEntries()) longTasks.push({ at: Date.now(), ms: Math.round(entry.duration) }); if (longTasks.length > 200) longTasks.splice(0, longTasks.length - 200); }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
function systemPanel() {
    const stats = el('div', 'devtools-stats');
    const windows = el('div', 'mac-card devtools-table');
    const renders = el('div', 'mac-card devtools-table');
    const events = el('div', 'devtools-log devtools-log-short scrollbar');
    const stat = (label, value) => { const box = el('div', 'devtools-stat'); box.append(el('strong', '', value), el('span', '', label)); return box; };
    const refresh = () => {
        const recent = longTasks.filter((task) => Date.now() - task.at < 10_000);
        const heap = performance.memory ? formatBytes(performance.memory.usedJSHeapSize) : '—';
        stats.replaceChildren(
            stat(L('devFps', '帧率'), `${fps}`), stat(L('devLongTasks', '长任务（10 秒内）'), recent.length ? `${recent.length} · ${Math.max(...recent.map((task) => task.ms))} ms` : '0'),
            stat(L('devDomNodes', 'DOM 节点'), String(document.getElementsByTagName('*').length)), stat(L('devHeap', 'JS 内存'), heap),
            stat(L('devAnimations', '运行中的动画'), String(document.getAnimations().length)), stat(L('devSlowMotion', '动画速度'), dev.slowMotion > 1 ? `÷${dev.slowMotion}` : '×1')
        );
        windows.replaceChildren(...managedWindowList().map((item) => {
            const row = el('div', 'card-row devtools-row');
            row.append(el('span', 'devtools-key', item.name), el('span', 'devtools-value', `${item.state} · z ${item.z} · ${item.bounds[2]}×${item.bounds[3]} @ ${item.bounds[0]},${item.bounds[1]} · ${L('devResize', '调整')}: ${item.resize}${item.max[0] || item.max[1] ? ` · max ${item.max[0] || '∞'}×${item.max[1] || '∞'}` : ''}`));
            row.addEventListener('mouseenter', () => showHighlight(item.state === 'open' || item.state === 'zoomed' ? item.element : null));
            row.addEventListener('mouseleave', () => showHighlight(null));
            return row;
        }));
        renders.replaceChildren(...[...dev.counters.entries()].map(([surface, count]) => {
            const row = el('div', 'card-row devtools-row');
            row.append(el('span', 'devtools-key', surface), el('span', 'devtools-value', `${L('devDrawn', '重绘')} ${count.drawn} · ${L('devSkipped', '跳过（内容未变）')} ${count.skipped}`));
            return row;
        }));
        if (!dev.counters.size) renders.appendChild(el('div', 'card-row developer-setting-note', L('devNoRenders', '还没有记录。操作一下桌面、程序坞或启动台。')));
    };
    const isSystem = (entry) => entry.kind === 'system' || entry.kind === 'config';
    events.replaceChildren(...dev.entries.filter(isSystem).slice(-200).map(entryRow));
    body.append(stats, el('h3', '', L('devWindows', '窗口')), windows, el('h3', '', L('devRenders', '界面重绘')), renders, el('h3', '', L('devInternalEvents', '内部事件与配置保存')), events);
    refresh();
    events.scrollTop = events.scrollHeight;
    onTick = refresh;
    onEntry = (entry) => { if (!isSystem(entry)) return; events.appendChild(entryRow(entry)); while (events.childElementCount > 300) events.firstElementChild.remove(); events.scrollTop = events.scrollHeight; };
    const count = () => { frames += 1; frameLoop = requestAnimationFrame(count); };
    frames = 0; frameLoop = requestAnimationFrame(count);
    dispose = () => { cancelAnimationFrame(frameLoop); showHighlight(null); };
}

// ---------------------------------------------------------------------------------
// Configuration inspector
// ---------------------------------------------------------------------------------
let configDiffOnly = false;
const isObject = (value) => value && typeof value === 'object';
function differs(value, base) {
    if (isObject(value) && isObject(base) && Array.isArray(value) === Array.isArray(base)) {
        const keys = new Set([...Object.keys(value), ...Object.keys(base)]);
        return [...keys].some((key) => differs(value[key], base[key]));
    }
    return JSON.stringify(value) !== JSON.stringify(base);
}
function valueNode(key, value, base, depth) {
    const changed = differs(value, base);
    if (configDiffOnly && !changed) return null;
    if (isObject(value)) {
        const node = createElement('details', { className: `devtools-config-node${changed ? ' changed' : ''}` });
        if (depth < 1) node.open = true;
        const size = Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
        node.appendChild(createElement('summary', { text: `${key} ${size}` }));
        // Children are built when the branch is first opened.
        let built = false;
        const build = () => {
            if (built) return; built = true;
            for (const [childKey, child] of Object.entries(value)) { const childNode = valueNode(childKey, child, isObject(base) ? base[childKey] : undefined, depth + 1); if (childNode) node.appendChild(childNode); }
        };
        if (node.open) build(); else node.addEventListener('toggle', build, { once: true });
        return node;
    }
    const row = el('div', `devtools-config-leaf${changed ? ' changed' : ''}`);
    const text = typeof value === 'string' ? (value.length > 120 ? `"${value.slice(0, 80)}…" (${formatBytes(value.length)})` : JSON.stringify(value)) : String(value);
    row.append(el('span', 'devtools-key', key), el('span', 'devtools-value', text));
    return row;
}
function diagnostics() {
    const shorten = (value) => JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'string' && item.length > 200 ? `${item.slice(0, 60)}… (${item.length} chars)` : item)));
    return {
        generated: new Date().toISOString(), userAgent: navigator.userAgent, extension: (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })(),
        viewport: [innerWidth, innerHeight, devicePixelRatio], config: shorten(state.config),
        applications: devApplications(), windows: managedWindowList().map(({ element, ...rest }) => rest),
        renders: Object.fromEntries(dev.counters), longTasks: longTasks.slice(-50), log: dev.entries.slice(-800)
    };
}
function configPanel() {
    toolbar.append(
        checkbox(L('devDiffOnly', '只看与默认值不同的项'), configDiffOnly, (on) => { configDiffOnly = on; show('config'); }),
        button(L('devExportDiagnostics', '导出诊断信息'), () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics(), null, 2)], { type: 'application/json' }));
            const anchor = createElement('a', { attrs: { href: url, download: `newtab-diagnostics-${Date.now()}.json` } }); anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        }),
        button(L('devClearCaches', '清除首屏缓存'), async () => {
            const ok = await showMacConfirm(L('devClearCachesQuestion', '清除首屏缓存？'), { title: L('devTools', '开发者工具'), detail: L('devClearCachesDetail', '下次打开新标签页时会重新生成。不影响设置和数据。'), confirmLabel: L('clear', '清除'), cancelLabel: L('cancel', '取消') });
            if (!ok) return;
            const keys = []; for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (/^macOS_(first_paint|boot_visual|bg_cache|accent_cache|theme_cache|bing_|spotlight_start_cache)/.test(key)) keys.push(key); }
            keys.forEach((key) => localStorage.removeItem(key));
            devEmit('system', { name: 'caches cleared', text: `${keys.length} keys` });
        })
    );
    const tree = el('div', 'devtools-config');
    for (const [key, value] of Object.entries(state.config)) { const node = valueNode(key, value, state.defaults?.[key], 0); if (node) tree.appendChild(node); }
    if (!tree.childElementCount) tree.appendChild(el('div', 'devtools-empty', L('devNoDiff', '当前配置与默认值完全相同。')));
    body.appendChild(tree);
}

// ---------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------
// What a panel in another module is given to work with.
const panelKit = () => ({ body, toolbar, button, tick: (fn) => { onTick = fn; }, cleanup: (fn) => { dispose = fn; }, highlight: showHighlight });
const PANELS = [
    ['apps', 'devPanelApps', '应用程序', appsPanel], ['tasks', 'devPanelTasks', '任务管理器', () => tasksPanel(panelKit())], ['perf', 'devPanelPerformance', '性能监视器', () => performancePanel(panelKit())], ['console', 'devPanelConsole', '控制台', consolePanel], ['ui', 'devPanelInterface', '界面检查器', inspectorPanel],
    ['storage', 'devPanelStorage', '储存', storagePanel], ['replay', 'devPanelReplay', '录制与回放', replayPanel], ['system', 'devPanelSystem', '系统', systemPanel], ['config', 'devPanelConfig', '配置', configPanel]
];
function show(id) {
    if (!win) return;
    try { dispose?.(); } catch { /* panel cleanup */ }
    dispose = null; onEntry = null; onTick = null;
    current = PANELS.some(([panel]) => panel === id) ? id : 'apps';
    const [, key, fallback, render] = PANELS.find(([panel]) => panel === current);
    win.querySelectorAll('.devtools-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.panel === current));
    title.textContent = L(key, fallback);
    toolbar.replaceChildren(); body.replaceChildren(); body.className = 'devtools-body scrollbar';
    Promise.resolve(render()).catch((error) => body.appendChild(el('div', 'devtools-error', error?.message || String(error))));
}
function ensureWindow() {
    if (win) return win;
    win = createElement('div', { className: 'window hidden window-shadow hide-on-launchpad devtools-window', attrs: { id: 'devtools-window' } });
    const sidebar = el('div', 'devtools-sidebar mac-acrylic');
    const controls = el('div', 'window-controls');
    const close = el('div', 'btn close'); const minimize = el('div', 'btn minimize'); const zoom = el('div', 'btn maximize');
    controls.append(close, minimize, zoom);
    sidebar.appendChild(controls);
    for (const [id, key, fallback] of PANELS) {
        const tab = createElement('div', { className: 'devtools-tab', text: L(key, fallback), dataset: { panel: id, key, fallback } });
        tab.addEventListener('click', () => show(id));
        sidebar.appendChild(tab);
    }
    const main = el('div', 'devtools-main');
    const header = el('div', 'devtools-header');
    title = el('h2', 'devtools-title');
    toolbar = el('div', 'devtools-toolbar');
    header.append(title, toolbar);
    body = el('div', 'devtools-body scrollbar');
    main.append(header, body);
    win.append(sidebar, main);
    document.body.appendChild(win);
    Object.assign(win.style, { left: `${Math.max(20, Math.round((innerWidth - 900) / 2))}px`, top: `${Math.max(40, Math.round((innerHeight - 580) / 2))}px` });

    registerManagedWindow(win, { dockTarget: () => document.querySelector('#dock [data-app-key="devtools"] .dock-icon'), app: () => ({ id: 'system:devtools', name: L('devTools', '开发者工具'), window: win, quit: () => closeManagedWindow(win), menus: () => [] }) });
    close.addEventListener('click', () => closeManagedWindow(win));
    minimize.addEventListener('click', () => minimizeManagedWindow(win));
    zoom.addEventListener('click', () => toggleZoomManagedWindow(win));
    win.addEventListener('pointerdown', () => bringManagedWindowToFront(win), true);
    const drag = (handle) => handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('button,select,input,label,.btn,.devtools-tab,.mac-custom-select,.devtools-select-wrap')) return;
        beginManagedWindowDrag(win, handle, event, { minLeft: (rect) => 80 - rect.width, maxLeft: () => innerWidth - 80, minTop: () => 26, maxTop: () => innerHeight - 50 });
    });
    drag(sidebar); drag(header);

    dev.listeners.add((entry) => { if (onEntry && !win.classList.contains('hidden')) onEntry(entry); });
    setInterval(() => {
        fps = frames; frames = 0;
        if (onTick && !win.classList.contains('hidden') && dev.enabled) onTick();
    }, 1000);
    window.addEventListener('macos-language-change', () => {
        win.querySelectorAll('.devtools-tab').forEach((tab) => { tab.textContent = L(tab.dataset.key, tab.dataset.fallback); });
        if (!win.classList.contains('hidden')) show(current);
    });
    // Lists of applications follow what is running.
    window.addEventListener('macos-running-apps-changed', () => { if (!win.classList.contains('hidden') && (current === 'apps' || current === 'ui' || (current === 'replay' && !playback))) show(current); });
    return win;
}

/** Opens Developer Tools (only while Developer Mode ▸ Developer Tools is on). */
export function openDeveloperTools(panel = current) {
    if (!dev.enabled) return false;
    ensureWindow();
    restoreManagedWindow(win);
    show(panel);
    // The Dock gives a running Developer Tools an icon of its own.
    window.dispatchEvent(new CustomEvent('macos-window-visibility-changed', { detail: { element: win, visible: true } }));
    return true;
}
/** Developer Tools was switched off: the window goes away and stops receiving entries. */
export function syncDeveloperTools() {
    if (dev.enabled || !win) return;
    try { dispose?.(); } catch { /* panel cleanup */ }
    dispose = null; onEntry = null; onTick = null;
    document.body.classList.remove('dev-show-layout');
    closeManagedWindow(win);
    // Simulated conditions end with the tools: every application is told the real ones again.
    for (const id of [...dev.overrides.keys()]) devSetOverride(id, null);
    dev.recorder = null; if (playback) playback.cancelled = true;
}
