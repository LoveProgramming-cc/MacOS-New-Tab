import { createElement } from './utils.js';
import { t } from './i18n.js';
import { bringManagedWindowToFront, managedWindowList } from './window-manager.js';

// Mission Control: every open window laid out side by side, so the one you want can be
// picked by sight. The windows themselves move (they stay live); nothing is copied.
//
//   toggleMissionControl()    ⌃↑ / F3, the Window menu, or the Mission Control launcher
//
// A click on a window brings it to the front; a click on the desktop or Escape leaves
// everything as it was. Minimised windows stay in the Dock.

const GAP = 34;
const LABEL = 30;
let session = null;

export const missionControlOpen = () => Boolean(session);

/** The desktop between the menu bar and the Dock, with room to breathe. */
function stage() {
    const dock = document.getElementById('dock-plate')?.getBoundingClientRect();
    const bottom = dock?.height ? dock.top - 14 : innerHeight - 14;
    return { left: 28, top: 26 + 30, width: Math.max(200, innerWidth - 56), height: Math.max(160, bottom - 56) };
}
// Rows of windows scaled to one common factor: the grid that lets them be largest wins.
function layout(windows, area) {
    let best = null;
    for (let rows = 1; rows <= windows.length; rows += 1) {
        const perRow = Math.ceil(windows.length / rows);
        const lines = Array.from({ length: rows }, (_unused, row) => windows.slice(row * perRow, (row + 1) * perRow)).filter((line) => line.length);
        const rowHeight = (area.height - GAP * (lines.length - 1)) / lines.length - LABEL;
        const tallest = Math.max(...windows.map((item) => item.height));
        let scale = Math.min(1, rowHeight / tallest);
        for (const line of lines) scale = Math.min(scale, (area.width - GAP * (line.length - 1)) / line.reduce((sum, item) => sum + item.width, 0));
        if (scale > 0 && (!best || scale > best.scale + 0.001)) best = { scale, lines };
    }
    if (!best) return [];
    const { scale, lines } = best;
    const slots = [];
    const rowHeights = lines.map((line) => Math.max(...line.map((item) => item.height)) * scale + LABEL);
    let y = area.top + (area.height - (rowHeights.reduce((sum, height) => sum + height, 0) + GAP * (lines.length - 1))) / 2;
    lines.forEach((line, index) => {
        const width = line.reduce((sum, item) => sum + item.width * scale, 0) + GAP * (line.length - 1);
        let x = area.left + (area.width - width) / 2;
        for (const item of line) {
            slots.push({ item, scale, left: x, top: y + (rowHeights[index] - LABEL - item.height * scale) / 2, width: item.width * scale, height: item.height * scale });
            x += item.width * scale + GAP;
        }
        y += rowHeights[index] + GAP;
    });
    return slots;
}

export function closeMissionControl(chosen = null) {
    if (!session) return;
    const { entries, backdrop, onKey } = session;
    session = null;
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('mission-control-open');
    backdrop.classList.add('leaving');
    for (const { element, shield, label } of entries) {
        shield.remove(); label.remove();
        element.style.translate = ''; element.style.scale = '';
    }
    // The transition back runs on the windows' own (now cleared) translate / scale.
    setTimeout(() => {
        backdrop.remove();
        if (!session) for (const { element } of entries) element.classList.remove('mission-control-window');
    }, 360);
    if (chosen) bringManagedWindowToFront(chosen);
}

export function openMissionControl() {
    if (session || document.body.classList.contains('launchpad-open') || document.body.classList.contains('widget-gallery-open')) return false;
    const windows = managedWindowList().filter((item) => (item.state === 'open' || item.state === 'zoomed') && !item.element.dataset.windowLevel)
        .map((item) => { const rect = item.element.getBoundingClientRect(); return { ...item, rect, width: rect.width, height: rect.height }; })
        .filter((item) => item.width > 0 && item.height > 0);
    if (!windows.length) return false;
    // Left to right as they sit on the desktop, so a window is found roughly where it was.
    windows.sort((a, b) => (a.rect.left + a.rect.width / 2) - (b.rect.left + b.rect.width / 2));

    const backdrop = createElement('div', { className: 'mission-control-backdrop' });
    backdrop.addEventListener('click', () => closeMissionControl());
    document.body.appendChild(backdrop);
    document.body.classList.add('mission-control-open');

    const entries = layout(windows, stage()).map(({ item, scale, left, top, width, height }) => {
        const { element, rect } = item;
        element.classList.add('mission-control-window');
        void element.offsetWidth; // the transition starts from where the window is
        element.style.translate = `${(left + width / 2 - (rect.left + rect.width / 2)).toFixed(1)}px ${(top + height / 2 - (rect.top + rect.height / 2)).toFixed(1)}px`;
        element.style.scale = scale.toFixed(4);
        // The window is a picture of itself here: a shield takes the click that picks it.
        const shield = createElement('div', { className: 'mission-control-shield', attrs: { role: 'button', 'aria-label': item.name } });
        shield.addEventListener('click', (event) => { event.stopPropagation(); closeMissionControl(element); });
        element.appendChild(shield);
        const label = createElement('div', { className: 'mission-control-label', text: item.name });
        Object.assign(label.style, { left: `${left + width / 2}px`, top: `${top + height + 8}px` });
        document.body.appendChild(label);
        return { element, shield, label };
    });
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        closeMissionControl();
    };
    document.addEventListener('keydown', onKey, true);
    session = { entries, backdrop, onKey };
    backdrop.title = t('missionControl', '调度中心');
    return true;
}
export function toggleMissionControl() { if (session) closeMissionControl(); else openMissionControl(); }
// The layout is for the desktop as it was: resizing the browser window, or a window
// opening, closing or minimising, ends the overview.
window.addEventListener('resize', () => closeMissionControl());
window.addEventListener('macos-window-visibility-changed', () => closeMissionControl());
