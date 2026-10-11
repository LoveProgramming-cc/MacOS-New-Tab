import { state } from './state.js';
import { $ } from './utils.js';
import { t } from './i18n.js';
import { showMacAlert, showMacConfirm } from './dialog.js';
import { readFileAsText } from './utils.js';
import { extraFeaturesDisabled } from './developer.js';

// Drag-and-drop import. Every "choose a file" button in Settings keeps working exactly
// as before; this only adds a second way in:
//   - dropping a file on a file button (or its settings row) feeds that button's input;
//   - dropping an image on the desktop offers to make it the wallpaper;
//   - dropping an application / overlay package or a settings backup on the desktop
//     runs the matching importer.
// Drops are routed into the existing <input type="file"> change handlers, so validation
// and error reporting stay in one place.

const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
const ZONE_CONTAINERS = '.card-row,.add-box,.limit-overlay-image-actions,.edit-row';

function fileInputs(root) {
    return [...root.querySelectorAll('input[type="file"]')].filter((input) => !input.hasAttribute('webkitdirectory') && !input.disabled);
}
function dropZoneFor(target) {
    const label = target.closest?.('label');
    if (label && fileInputs(label).length === 1) return { zone: label, input: fileInputs(label)[0] };
    const container = target.closest?.(ZONE_CONTAINERS);
    if (container && fileInputs(container).length === 1) return { zone: container, input: fileInputs(container)[0] };
    return null;
}
function accepts(input, file) {
    const accept = (input.getAttribute('accept') || '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
    if (!accept.length) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return accept.some((rule) => (rule.startsWith('.') ? name.endsWith(rule) : rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : type === rule));
}
function feed(input, files) {
    const transfer = new DataTransfer();
    (input.multiple ? files : files.slice(0, 1)).forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function importFromDesktop(file) {
    const name = file.name;
    if (file.type.startsWith('image/')) {
        const ok = await showMacConfirm(t('dropWallpaperQuestion', '要将“{name}”设为墙纸吗？').replace('{name}', name), {
            title: t('changeWallpaper', '更改墙纸'),
            detail: t('dropWallpaperLibrary', '图片会加入“墙纸”设置中的“你的照片”。'),
            confirmLabel: t('setWallpaper', '设为墙纸')
        });
        if (ok) feed($('wallpaper-add-photo'), [file]);
        return;
    }
    if (file.type.startsWith('video/')) {
        const ok = await showMacConfirm(t('dropLiveWallpaperQuestion', '要将“{name}”设为动态壁纸吗？').replace('{name}', name), {
            title: t('liveWallpaper', '动态壁纸'),
            detail: t('dropLiveWallpaperDetail', '视频会保存在本机，并作为桌面背景循环播放。'),
            confirmLabel: t('setWallpaper', '设为墙纸')
        });
        if (ok) feed($('wallpaper-add-video'), [file]);
        return;
    }
    if (name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
        let parsed = null;
        try { parsed = JSON.parse(await readFileAsText(file)); } catch { /* reported below */ }
        // Applications and overlay plug-ins are extra features; with those switched off the
        // desktop does not know them at all.
        const extras = !extraFeaturesDisabled(state.config);
        if (extras && (parsed?.format === 'macos-app-package-v3' || parsed?.kind === 'app')) return feed($('application-plugin-import'), [file]);
        if (extras && parsed?.kind === 'limit-overlay') return feed($('limit-plugin-import'), [file]);
        if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.dockApps) || Array.isArray(parsed.launchpadApps) || parsed.widgets)) {
            const ok = await showMacConfirm(t('dropConfigQuestion', '要用“{name}”替换当前的全部设置吗？').replace('{name}', name), {
                title: t('importBackup', '导入备份'), detail: t('dropConfigWarning', '当前设置将被覆盖。'), confirmLabel: t('importBackup', '导入备份'), danger: true
            });
            if (ok) feed($('config-upload'), [file]);
            return;
        }
    }
    const message = extraFeaturesDisabled(state.config)
        ? t('dropUnsupportedBasic', '无法导入“{name}”。可以拖入图片（设为墙纸）或设置备份。')
        : t('dropUnsupported', '无法导入“{name}”。可以拖入图片（设为墙纸）、应用程序包、遮罩插件或设置备份。');
    await showMacAlert(message.replace('{name}', name), { title: t('error', '错误') });
}

export function bindFileDropImport() {
    let activeZone = null;
    const clear = () => {
        activeZone?.classList.remove('file-drop-zone', 'file-drop-ready');
        activeZone = null;
        document.body.classList.remove('desktop-file-drop');
    };
    const overDesktop = (target) => !target.closest?.('.window,.plugin-app-window,#launchpad.active,.mac-dialog-overlay,#widget-gallery,#widget-center');

    document.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        // Without this the browser would navigate the tab to whatever file is dropped.
        event.preventDefault();
        const hit = dropZoneFor(event.target);
        if (hit?.zone !== activeZone) clear();
        if (hit) {
            activeZone = hit.zone;
            activeZone.classList.add('file-drop-zone', 'file-drop-ready');
            event.dataTransfer.dropEffect = 'copy';
        } else if (overDesktop(event.target)) {
            document.body.dataset.dropHint = extraFeaturesDisabled(state.config)
                ? t('dropHintDesktopBasic', '松开以导入：图片设为墙纸，或恢复设置备份')
                : t('dropHintDesktop', '松开以导入：图片设为墙纸，或安装应用程序 / 插件 / 设置备份');
            document.body.classList.add('desktop-file-drop');
            event.dataTransfer.dropEffect = 'copy';
        } else {
            document.body.classList.remove('desktop-file-drop');
            event.dataTransfer.dropEffect = 'none';
        }
    });
    document.addEventListener('dragleave', (event) => { if (hasFiles(event) && !event.relatedTarget) clear(); });
    document.addEventListener('dragend', clear);
    document.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        const hit = dropZoneFor(event.target);
        const desktop = !hit && overDesktop(event.target);
        clear();
        const files = [...event.dataTransfer.files];
        if (!files.length) return;
        if (hit) {
            const usable = files.filter((file) => accepts(hit.input, file));
            if (usable.length) feed(hit.input, usable);
            else showMacAlert(t('dropWrongType', '这里不能使用该类型的文件。'), { title: t('error', '错误') });
        } else if (desktop) importFromDesktop(files[0]).catch((error) => showMacAlert(error?.message || String(error), { title: t('error', '错误') }));
    });
}
