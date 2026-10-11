import { state } from './state.js';
import { clamp } from './utils.js';

export const WIDGET_PIXEL_SIZE = {
    small: { width: 160, height: 160 },
    medium: { width: 332, height: 160 },
    large: { width: 332, height: 332 }
};
export const DESKTOP_ICON_SIZE = { width: 80, height: 104 };
export const WIDGET_GRID = { unit: 160, gap: 12, left: 20, top: 48 };

export function widgetPixels(widget) {
    return WIDGET_PIXEL_SIZE[widget?.size] || WIDGET_PIXEL_SIZE.small;
}

function boundsFor(width, height) {
    const top = 34;
    const left = 8;
    const right = 8;
    const bottom = Math.max(22, Number(state.config?.dock?.size || 56) + 28);
    return {
        minLeft: left,
        minTop: top,
        maxLeft: Math.max(left, window.innerWidth - width - right),
        maxTop: Math.max(top, window.innerHeight - height - bottom)
    };
}

export function clampRelativePosition(cx, cy, width, height) {
    const b = boundsFor(width, height);
    const left = clamp(window.innerWidth / 2 + Number(cx || 0), b.minLeft, b.maxLeft);
    const top = clamp(window.innerHeight / 2 + Number(cy || 0), b.minTop, b.maxTop);
    return { cx: left - window.innerWidth / 2, cy: top - window.innerHeight / 2, left, top };
}

// Where each desktop widget is on screen now (id -> rect). Stored positions are kept as the
// user placed them; this layout fits them to the current window: a window too small for the
// saved arrangement (another device, a resized browser) moves widgets to the nearest free
// grid cell instead of piling them up at the edge, and nothing is rewritten.
let displayed = new Map();
/** Records where a widget was put, on a desktop of the current size. */
export function setWidgetPosition(widget, pos) {
    widget.cx = pos.cx; widget.cy = pos.cy;
    widget.vw = Math.round(window.innerWidth); widget.vh = Math.round(window.innerHeight);
}
// Where a widget asks to be on this desktop: as far from the nearest edges as it was on the
// desktop it was placed on — a widget in the top-left stays in the top-left of a smaller
// window, one in the bottom-right keeps to the bottom-right.
function requestedPosition(widget) {
    const cx = Number(widget?.cx || 0); const cy = Number(widget?.cy || 0);
    const vw = Number(widget?.vw) || window.innerWidth; const vh = Number(widget?.vh) || window.innerHeight;
    const size = widgetPixels(widget);
    const left = vw / 2 + cx; const top = vh / 2 + cy;
    const x = left + size.width / 2 <= vw / 2 ? left : window.innerWidth - (vw - left);
    const y = top + size.height / 2 <= vh / 2 ? top : window.innerHeight - (vh - top);
    return { cx: x - window.innerWidth / 2, cy: y - window.innerHeight / 2 };
}
export function widgetRect(widget) {
    const shown = widget?.id && displayed.get(widget.id);
    if (shown) return shown;
    const size = widgetPixels(widget);
    const asked = requestedPosition(widget);
    const pos = clampRelativePosition(asked.cx, asked.cy, size.width, size.height);
    return { left: pos.left, top: pos.top, right: pos.left + size.width, bottom: pos.top + size.height, width: size.width, height: size.height };
}

export function rectsOverlap(a, b, gap = 4) {
    return !(a.right + gap <= b.left || a.left >= b.right + gap || a.bottom + gap <= b.top || a.top >= b.bottom + gap);
}

function widgetSpans(widget) {
    if (widget?.size === 'large') return { x: 2, y: 2 };
    if (widget?.size === 'medium') return { x: 2, y: 1 };
    return { x: 1, y: 1 };
}

function gridMetrics() {
    const stride = WIDGET_GRID.unit + WIDGET_GRID.gap;
    const bottom = Math.max(22, Number(state.config?.dock?.size || 56) + 28);
    const usableW = Math.max(WIDGET_GRID.unit, window.innerWidth - WIDGET_GRID.left - 12);
    const usableH = Math.max(WIDGET_GRID.unit, window.innerHeight - WIDGET_GRID.top - bottom);
    return {
        stride,
        cols: Math.max(1, Math.floor((usableW + WIDGET_GRID.gap) / stride)),
        rows: Math.max(1, Math.floor((usableH + WIDGET_GRID.gap) / stride))
    };
}

function gridRect(col, row, widget) {
    const spans = widgetSpans(widget);
    const size = widgetPixels(widget);
    const left = WIDGET_GRID.left + col * (WIDGET_GRID.unit + WIDGET_GRID.gap);
    const top = WIDGET_GRID.top + row * (WIDGET_GRID.unit + WIDGET_GRID.gap);
    return { left, top, right: left + size.width, bottom: top + size.height, width: size.width, height: size.height, col, row, spanX: spans.x, spanY: spans.y };
}

function candidateIsFree(rect, ignoreId = '', others = null) {
    if (others) return !others.some((other) => rectsOverlap(rect, other, 6));
    return !(state.config?.widgets?.desktop || []).some((other) => {
        if (!other || other.id === ignoreId) return false;
        return rectsOverlap(rect, widgetRect(other), 6);
    });
}

/** Resolve a requested widget position to the nearest non-overlapping macOS-like grid cell. */
export function resolveWidgetGridPosition(widget, requestedCx = widget?.cx || 0, requestedCy = widget?.cy || 0, ignoreId = widget?.id || '', others = null) {
    const metrics = gridMetrics();
    const spans = widgetSpans(widget);
    const size = widgetPixels(widget);
    const requested = clampRelativePosition(requestedCx, requestedCy, size.width, size.height);
    const desiredCol = clamp(Math.round((requested.left - WIDGET_GRID.left) / metrics.stride), 0, Math.max(0, metrics.cols - spans.x));
    const desiredRow = clamp(Math.round((requested.top - WIDGET_GRID.top) / metrics.stride), 0, Math.max(0, metrics.rows - spans.y));

    // The visible grid first; when it is full, cells past its right and bottom edges, so a
    // widget is out of view rather than on top of another one.
    let cols = metrics.cols; let rows = metrics.rows;
    const tryCell = (col, row) => {
        if (col < 0 || row < 0 || col + spans.x > cols || row + spans.y > rows) return null;
        const rect = gridRect(col, row, widget);
        return candidateIsFree(rect, ignoreId, others) ? rect : null;
    };

    let found = tryCell(desiredCol, desiredRow);
    if (!found) {
        const maxRing = Math.max(metrics.cols, metrics.rows) + 2;
        for (let ring = 1; ring <= maxRing && !found; ring += 1) {
            const candidates = [];
            for (let dx = -ring; dx <= ring; dx += 1) {
                candidates.push([desiredCol + dx, desiredRow - ring], [desiredCol + dx, desiredRow + ring]);
            }
            for (let dy = -ring + 1; dy < ring; dy += 1) {
                candidates.push([desiredCol - ring, desiredRow + dy], [desiredCol + ring, desiredRow + dy]);
            }
            candidates.sort((a, b) => {
                const da = (a[0] - desiredCol) ** 2 + (a[1] - desiredRow) ** 2;
                const db = (b[0] - desiredCol) ** 2 + (b[1] - desiredRow) ** 2;
                return da - db;
            });
            for (const [col, row] of candidates) {
                found = tryCell(col, row);
                if (found) break;
            }
        }
    }

    for (let extra = 2; !found && extra <= 64; extra *= 2) {
        cols = metrics.cols + extra; rows = metrics.rows + extra;
        for (let row = 0; row < rows && !found; row += 1) for (let col = 0; col < cols && !found; col += 1) found = tryCell(col, row);
    }
    if (!found) {
        const fallback = clampRelativePosition(requestedCx, requestedCy, size.width, size.height);
        return { cx: fallback.cx, cy: fallback.cy, left: fallback.left, top: fallback.top, width: size.width, height: size.height };
    }
    return {
        cx: found.left - window.innerWidth / 2,
        cy: found.top - window.innerHeight / 2,
        left: found.left,
        top: found.top,
        width: found.width,
        height: found.height,
        col: found.col,
        row: found.row
    };
}

export function widgetGridPositionFromPoint(widget, clientX, clientY, ignoreId = widget?.id || '') {
    const size = widgetPixels(widget);
    const cx = clientX - size.width / 2 - window.innerWidth / 2;
    const cy = clientY - size.height / 2 - window.innerHeight / 2;
    return resolveWidgetGridPosition(widget, cx, cy, ignoreId);
}

/** One-time/resize reconciliation: every desktop widget ends in a unique grid slot. */
export function reflowDesktopWidgetsToGrid() {
    const widgets = state.config?.widgets?.desktop || [];
    let changed = false;
    const original = widgets.map((widget) => ({ id: widget.id, cx: widget.cx, cy: widget.cy }));
    // Resolve in visual order while temporarily moving unresolved widgets far away.
    const resolved = [];
    for (const widget of widgets) {
        const saved = state.config.widgets.desktop;
        state.config.widgets.desktop = resolved;
        const pos = resolveWidgetGridPosition(widget, widget.cx || 0, widget.cy || 0, widget.id);
        state.config.widgets.desktop = saved;
        if (Math.abs(Number(widget.cx || 0) - pos.cx) > .5 || Math.abs(Number(widget.cy || 0) - pos.cy) > .5) changed = true;
        setWidgetPosition(widget, pos);
        resolved.push(widget);
    }
    return changed || original.some((old, i) => old.id !== widgets[i]?.id);
}

/** Lays every desktop widget out for the current window, in order, without overlaps. */
export function layoutDesktopWidgets() {
    const placed = [];
    const next = new Map();
    for (const widget of state.config?.widgets?.desktop || []) {
        if (!widget?.id) continue;
        const asked = requestedPosition(widget);
        const pos = resolveWidgetGridPosition(widget, asked.cx, asked.cy, widget.id, placed);
        const rect = { left: pos.left, top: pos.top, right: pos.left + pos.width, bottom: pos.top + pos.height, width: pos.width, height: pos.height };
        placed.push(rect);
        next.set(widget.id, rect);
    }
    displayed = next;
    return next;
}

function iconRectAt(cx, cy) {
    const pos = clampRelativePosition(cx, cy, DESKTOP_ICON_SIZE.width, DESKTOP_ICON_SIZE.height);
    return { left: pos.left, top: pos.top, right: pos.left + DESKTOP_ICON_SIZE.width, bottom: pos.top + DESKTOP_ICON_SIZE.height, cx: pos.cx, cy: pos.cy };
}

function occupiedWidgetRects() {
    return (state.config?.widgets?.desktop || []).map(widgetRect);
}

export function iconPositionIsFree(cx, cy, ignoreIndex = -1) {
    const rect = iconRectAt(cx, cy);
    if (occupiedWidgetRects().some((wr) => rectsOverlap(rect, wr, 6))) return false;
    const apps = state.config?.desktopApps || [];
    for (let i = 0; i < apps.length; i += 1) {
        if (i === ignoreIndex) continue;
        const app = apps[i];
        if (!Number.isFinite(app.cx) || !Number.isFinite(app.cy)) continue;
        if (rectsOverlap(rect, iconRectAt(app.cx, app.cy), 4)) return false;
    }
    return true;
}

export function resolveDesktopIconPosition(cx, cy, ignoreIndex = -1) {
    const start = iconRectAt(cx, cy);
    if (iconPositionIsFree(start.cx, start.cy, ignoreIndex)) return { cx: start.cx, cy: start.cy };
    const stepX = 90, stepY = 110;
    for (let ring = 1; ring <= 12; ring += 1) {
        const candidates = [];
        for (let x = -ring; x <= ring; x += 1) candidates.push([x, -ring], [x, ring]);
        for (let y = -ring + 1; y < ring; y += 1) candidates.push([-ring, y], [ring, y]);
        candidates.sort((a,b) => (a[0]**2+a[1]**2) - (b[0]**2+b[1]**2));
        for (const [gx, gy] of candidates) {
            const candidate = iconRectAt(start.cx + gx * stepX, start.cy + gy * stepY);
            if (iconPositionIsFree(candidate.cx, candidate.cy, ignoreIndex)) return { cx: candidate.cx, cy: candidate.cy };
        }
    }
    return { cx: start.cx, cy: start.cy };
}

export function reflowDesktopAppsAroundWidgets() {
    let changed = false;
    (state.config?.desktopApps || []).forEach((app, index) => {
        if (!Number.isFinite(app.cx) || !Number.isFinite(app.cy)) return;
        const resolved = resolveDesktopIconPosition(app.cx, app.cy, index);
        if (Math.abs(resolved.cx - app.cx) > 0.5 || Math.abs(resolved.cy - app.cy) > 0.5) {
            app.cx = resolved.cx;
            app.cy = resolved.cy;
            changed = true;
        }
    });
    return changed;
}

export function clampWidgetToDesktop(widget) {
    const size = widgetPixels(widget);
    const pos = clampRelativePosition(widget.cx || 0, widget.cy || 0, size.width, size.height);
    widget.cx = pos.cx;
    widget.cy = pos.cy;
    return widget;
}
