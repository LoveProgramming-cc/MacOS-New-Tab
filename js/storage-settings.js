import { state } from './state.js';
import { t } from './i18n.js';
import { $, createElement } from './utils.js';
import { showMacAlert, showMacConfirm } from './dialog.js';
import { extraFeaturesDisabled } from './developer.js';
import { applicationStorageReport, eraseApplicationData, exportApplicationData, importApplicationData } from './plugin-system.js';
import { listWallpapers } from './wallpaper-store.js';
import { removeWallpaperItem } from './wallpaper-gallery.js';

// System Settings ▸ Storage: what the extension keeps on this computer, by owner.
//   Applications — each one's own size (its package) plus the data and files it stored.
//                  Data can be erased here as a whole; finer cleaning is the application's
//                  own business, in its own settings.
//   Wallpapers   — the pictures and videos in the wallpaper library, removable one by one.
//   System data  — settings, custom icons and caches.

const COLORS = { apps: '#ff5257', wallpapers: '#0a84ff', system: '#8c8c8c' };

export function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1000) return `${Math.round(value)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = value / 1000; let unit = 0;
    while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1; }
    return `${amount >= 100 ? Math.round(amount) : amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
}
function localCacheBytes() {
    let total = 0;
    try { for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); total += key.length + (localStorage.getItem(key)?.length || 0); } } catch { /* unavailable */ }
    return total;
}
const wallpaperInUse = (item) => (item.kind === 'video'
    ? Boolean(state.config.liveWallpaper?.enabled) && state.config.liveWallpaper.id === item.id
    : !state.config.liveWallpaper?.enabled && !state.config.useBingWallpaper && Object.values(state.config.wallpaperPhotoIds || {}).includes(item.id));

let token = 0;
export async function renderStorageSettings() {
    const appList = $('storage-app-list'); const wallpaperList = $('storage-wallpaper-list');
    if (!appList || !wallpaperList) return;
    const mine = ++token;
    const [report, wallpapers] = await Promise.all([
        applicationStorageReport().catch(() => ({ apps: [], otherBytes: 0 })),
        listWallpapers().catch(() => [])
    ]);
    if (mine !== token) return;
    const showApps = !extraFeaturesDisabled(state.config);
    const appTotal = report.apps.reduce((sum, app) => sum + app.appBytes + app.dataBytes, 0);
    const wallpaperTotal = wallpapers.reduce((sum, item) => sum + (Number(item.size) || 0) + (item.thumb?.length || 0), 0);
    const systemTotal = report.otherBytes + localCacheBytes();
    const total = appTotal + wallpaperTotal + systemTotal;

    // Summary bar.
    const parts = [
        { key: 'apps', label: t('storageApps', '应用程序'), bytes: appTotal },
        { key: 'wallpapers', label: t('tabWallpaper', '墙纸'), bytes: wallpaperTotal },
        { key: 'system', label: t('storageSystem', '系统数据'), bytes: systemTotal }
    ];
    if ($('storage-total')) $('storage-total').textContent = t('storageUsed', '已使用 {size}').replace('{size}', formatBytes(total));
    $('storage-bar')?.replaceChildren(...parts.filter((part) => part.bytes > 0).map((part) => {
        const segment = createElement('span', { attrs: { title: `${part.label} · ${formatBytes(part.bytes)}` } });
        segment.style.flex = `${Math.max(part.bytes / Math.max(1, total), 0.012)} 1 0`; segment.style.background = COLORS[part.key];
        return segment;
    }));
    $('storage-legend')?.replaceChildren(...parts.map((part) => {
        const item = createElement('span', { className: 'storage-legend-item' });
        const dot = createElement('i'); dot.style.background = COLORS[part.key];
        item.append(dot, document.createTextNode(`${part.label}  ${formatBytes(part.bytes)}`));
        return item;
    }));
    if ($('storage-system-size')) $('storage-system-size').textContent = formatBytes(systemTotal);

    // Applications, largest first.
    appList.replaceChildren(...(showApps ? report.apps : []).sort((a, b) => (b.appBytes + b.dataBytes) - (a.appBytes + a.dataBytes)).map((entry) => {
        const { plugin } = entry;
        const row = createElement('div', { className: 'card-row storage-row', dataset: { pluginId: plugin.id } });
        const icon = createElement('span', { className: 'storage-row-icon' });
        if (plugin.icon) icon.appendChild(createElement('img', { attrs: { src: plugin.icon, alt: '' } }));
        const info = createElement('div', { className: 'storage-row-info' });
        const files = entry.files ? ` · ${t('storageFiles', '{count} 个文件').replace('{count}', entry.files)}` : '';
        info.append(createElement('div', { className: 'storage-row-name', text: plugin.name }),
            createElement('div', { className: 'developer-setting-note', text: `${t('storageAppItself', '应用程序本身')} ${formatBytes(entry.appBytes)} · ${t('storageAppData', '数据')} ${formatBytes(entry.dataBytes)}${files}` }));
        const erase = createElement('button', { className: 'mac-btn', text: t('storageErase', '抹掉数据…'), attrs: { type: 'button' } });
        erase.disabled = entry.dataBytes <= 0;
        erase.addEventListener('click', async () => {
            const ok = await showMacConfirm(t('storageEraseQuestion', '确定要抹掉“{name}”的全部数据吗？').replace('{name}', plugin.name), {
                title: t('storageErase', '抹掉数据…').replace('…', ''), icon: plugin.icon || '', danger: true, confirmLabel: t('storageEraseConfirm', '抹掉'), cancelLabel: t('cancel', '取消'),
                detail: t('storageEraseDetail', '应用程序仍保持安装，但它存储的所有内容和文件都会被删除，且无法恢复。正在运行的窗口会被关闭。')
            });
            if (!ok) return;
            erase.disabled = true;
            await eraseApplicationData(plugin.id);
            renderStorageSettings();
        });
        // The data as one archive, and such an archive put back in place of the data.
        const exportData = createElement('button', { className: 'mac-btn', text: t('storageExport', '导出数据…'), attrs: { type: 'button' }, dataset: { action: 'export' } });
        exportData.disabled = entry.dataBytes <= 0;
        exportData.addEventListener('click', async () => {
            exportData.disabled = true;
            try { await exportApplicationData(plugin.id); }
            catch (error) { await showMacAlert(String(error?.message || error), { title: t('storageExportFailed', '无法导出'), icon: plugin.icon || '' }); }
            exportData.disabled = false;
        });
        const importData = createElement('button', { className: 'mac-btn', text: t('storageImport', '导入数据…'), attrs: { type: 'button' }, dataset: { action: 'import' } });
        const restore = async (file) => {
            const ok = await showMacConfirm(t('storageImportQuestion', '用这份数据替换“{name}”现有的全部数据吗？').replace('{name}', plugin.name), {
                title: t('storageImport', '导入数据…').replace('…', ''), icon: plugin.icon || '', danger: true, confirmLabel: t('storageImportConfirm', '替换'), cancelLabel: t('cancel', '取消'),
                detail: t('storageImportDetail', '应用程序现在存储的内容和文件会被删除，换成“{file}”里的内容。正在运行的窗口会被关闭。').replace('{file}', file.name)
            });
            if (!ok) return;
            importData.disabled = true;
            try { await importApplicationData(plugin.id, file); }
            catch (error) { await showMacAlert(String(error?.message || error), { title: t('storageImportFailed', '无法导入'), icon: plugin.icon || '' }); }
            renderStorageSettings();
        };
        importData.addEventListener('click', () => {
            const input = createElement('input', { attrs: { type: 'file', accept: '.zip,application/zip' } });
            input.addEventListener('change', () => { if (input.files?.[0]) restore(input.files[0]); });
            input.click();
        });
        row._restoreData = restore;
        const actions = createElement('div', { className: 'storage-row-actions' });
        actions.append(exportData, importData, erase);
        row.append(icon, info, createElement('span', { className: 'storage-row-size', text: formatBytes(entry.appBytes + entry.dataBytes) }), actions);
        return row;
    }));
    if (showApps && !report.apps.length) appList.appendChild(createElement('div', { className: 'card-row developer-setting-note', text: t('noApplicationsInstalled', '尚未安装应用程序插件。') }));

    // Wallpaper library, largest first.
    const sorted = [...wallpapers].sort((a, b) => (b.size || 0) - (a.size || 0));
    wallpaperList.replaceChildren(...sorted.map((item) => {
        const used = wallpaperInUse(item);
        const row = createElement('div', { className: 'card-row storage-row', dataset: { wallpaperId: item.id } });
        const thumb = createElement('span', { className: 'storage-row-icon storage-row-thumb' });
        thumb.appendChild(createElement('img', { attrs: { src: item.thumb, alt: '' } }));
        const info = createElement('div', { className: 'storage-row-info' });
        const kind = item.kind === 'video' ? t('storageVideo', '视频') : t('storagePhoto', '照片');
        info.append(createElement('div', { className: 'storage-row-name', text: item.name }),
            createElement('div', { className: 'developer-setting-note', text: used ? `${kind} · ${t('storageInUse', '使用中')}` : kind }));
        const remove = createElement('button', { className: 'mac-btn', text: t('btnDelete', '删除'), attrs: { type: 'button' } });
        remove.addEventListener('click', async () => { remove.disabled = true; await removeWallpaperItem(item.id); renderStorageSettings(); });
        row.append(thumb, info, createElement('span', { className: 'storage-row-size', text: formatBytes(item.size) }), remove);
        return row;
    }));
    if (!sorted.length) wallpaperList.appendChild(createElement('div', { className: 'card-row developer-setting-note', text: t('storageNoWallpapers', '还没有添加过照片或视频。内置壁纸和 Bing 壁纸不占用这里的空间。') }));
    const unused = sorted.filter((item) => !wallpaperInUse(item));
    const removeUnused = $('storage-remove-unused');
    if (removeUnused) {
        removeUnused.disabled = !unused.length;
        removeUnused.onclick = async () => {
            const ok = await showMacConfirm(t('storageRemoveUnusedQuestion', '删除 {count} 项未使用的墙纸？').replace('{count}', unused.length), { title: t('storageRemoveUnused', '删除未使用的墙纸'), danger: true, confirmLabel: t('btnDelete', '删除'), cancelLabel: t('cancel', '取消'),
                detail: t('storageRemoveUnusedDetail', '将释放 {size}。当前用作桌面背景的不会被删除。').replace('{size}', formatBytes(unused.reduce((sum, item) => sum + (item.size || 0), 0))) });
            if (!ok) return;
            for (const item of unused) await removeWallpaperItem(item.id);
            renderStorageSettings();
        };
    }
}

let bound = false;
export function bindStorageSettings() {
    if (bound) return; bound = true;
    const visible = () => $('set-storage')?.classList.contains('active') && !$('settings-window')?.classList.contains('hidden');
    document.querySelector('.settings-sidebar .tab[data-target="set-storage"]')?.addEventListener('click', () => renderStorageSettings());
    window.addEventListener('macos-window-visibility-changed', (event) => { if (event.detail?.element?.id === 'settings-window' && event.detail.visible && visible()) renderStorageSettings(); });
    window.addEventListener('macos-language-change', () => { if (visible()) renderStorageSettings(); });
}
