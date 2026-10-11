// Native UI: the vocabulary (node types, tokens, numeric ranges) and the validation that
// turns what an application sends into a clean tree.

export const CONTAINER_TYPES = new Set(['stack', 'group', 'zstack', 'split', 'card', 'toolbar', 'grid', 'scroll']);
// Surfaces a pointer can grab to move a window that has no title bar.
export const BACKGROUND_TYPES = new Set([...CONTAINER_TYPES, 'spacer', 'separator', 'video']);
const MATERIALS = new Set(['glass', 'bar', 'sidebar', 'content', 'clear']);
// How a node arrives when it is added to an interface that is already on screen, and —
// played backwards — how it leaves. The host runs these; an application only names one.
export const TRANSITIONS = {
    'slide-up': { translate: ['0 100%', '0 0'] }, 'slide-down': { translate: ['0 -100%', '0 0'] },
    'slide-left': { translate: ['100% 0', '0 0'] }, 'slide-right': { translate: ['-100% 0', '0 0'] },
    fade: { opacity: [0, 1] }, scale: { opacity: [0, 1], scale: ['0.94', '1'] }
};
export const TRANSITION_MS = 360;
export const TRANSITION_EASING = 'cubic-bezier(.22,.8,.24,1)';
export const NATIVE_UI_TYPES = new Set([
    ...CONTAINER_TYPES, 'text', 'button', 'input', 'textarea', 'switch', 'checkbox', 'slider', 'progress',
    'select', 'segmented', 'list', 'table', 'image', 'video', 'canvas', 'html', 'spacer', 'separator'
]);

const COLOR_TOKENS = {
    accent: 'var(--native-accent)', blue: '#0a84ff', red: 'var(--native-red)', orange: '#ff9f0a', yellow: '#ffd60a',
    green: '#30d158', teal: '#40c8e0', purple: '#bf5af2', pink: '#ff375f', gray: '#8e8e93',
    text: 'var(--native-text)', secondary: 'var(--native-secondary)', tertiary: 'var(--native-tertiary)',
    control: 'var(--native-control)', controlStrong: 'var(--native-control-hover)', fill: 'var(--native-fill)',
    separator: 'var(--native-border)', clear: 'transparent', transparent: 'transparent', white: '#fff', black: '#000'
};
export const CANVAS_TOKEN_COLORS = { accent: '#0a84ff', blue: '#0a84ff', red: '#ff453a', orange: '#ff9f0a', yellow: '#ffd60a', green: '#30d158', teal: '#40c8e0', purple: '#bf5af2', pink: '#ff375f', gray: '#8e8e93', clear: 'transparent', transparent: 'transparent', white: '#fff', black: '#000' };
export const CANVAS_TOKEN_ALPHA = { text: 1, secondary: 0.62, tertiary: 0.42, control: 0.2, controlStrong: 0.3, fill: 0.18, separator: 0.18 };
export const FONT_WEIGHTS = { thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 };
export const FONT_FAMILIES = {
    system: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,"PingFang SC",sans-serif',
    mono: 'ui-monospace,SFMono-Regular,Menlo,monospace',
    rounded: 'ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,sans-serif'
};
export const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
export const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };
export const GRID_ALIGN = { start: 'start', center: 'center', end: 'end', stretch: 'stretch' };
const TEXT_VARIANTS = new Set(['title', 'headline', 'body', 'caption', 'muted', 'display', 'mono']);
const BUTTON_VARIANTS = new Set(['primary', 'danger', 'plain', 'tinted']);
const BUTTON_SHAPES = new Set(['circle', 'pill']);
const INPUT_TYPES = new Set(['text', 'number', 'password', 'search', 'email', 'url']);
const BOOLEAN_KEYS = ['ltr', 'checked', 'disabled', 'hidden', 'selectable', 'wrap', 'vertical', 'readOnly', 'hover', 'scrollEvents', 'multiple', 'reorderable', 'pointer', 'header', 'striped', 'iconTint', 'plain', 'draggable', 'dropTarget', 'showOnHover', 'dismissable', 'selectionEvents', 'stickyHeaders'];
const NUMERIC_KEYS = {
    grow: [0, 20], gap: [0, 64], span: [1, 12], rowSpan: [1, 12], opacity: [0, 1], fontSize: [8, 120], lines: [1, 20], min: [-1e9, 1e9], max: [-1e9, 1e9],
    step: [0, 1e9], rows: [1, 40], maxLength: [1, 200000], iconSize: [8, 256], insetBottom: [0, 400], insetTop: [0, 400]
};
const INTEGER_KEYS = new Set(['span', 'rowSpan', 'lines', 'rows', 'maxLength']);
const MAX_ROWS = 20000;

// ---------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------

function cleanId(value) {
    // Any printable text is a valid id (names, paths, non-Latin titles); ids are only ever
    // used as map keys and data attributes, never spliced into selectors or markup.
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}
function cleanColor(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (Object.hasOwn(COLOR_TOKENS, text)) return text;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text;
    if (/^(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s/deg-]{1,60}\)$/i.test(text)) return text;
    return '';
}
export function cssColor(value) {
    return Object.hasOwn(COLOR_TOKENS, value) ? COLOR_TOKENS[value] : value;
}
function cleanLength(value, max = 6000) {
    if (value === 'fill' || value === 'auto') return value;
    if (typeof value === 'string' && /^\d{1,3}(?:\.\d+)?%$/.test(value.trim())) return value.trim();
    const number = Number(value);
    if (value === null || value === '' || !Number.isFinite(number)) return undefined;
    return Math.max(0, Math.min(max, number));
}
export function cssLength(value) {
    if (value === 'fill') return '100%';
    return typeof value === 'number' ? `${value}px` : value;
}
function cleanTrack(value) {
    if (value === 'auto') return 'auto';
    if (typeof value === 'string' && /^\d{1,3}(?:\.\d+)?fr$/.test(value.trim())) return `minmax(0, ${value.trim()})`;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? `${Math.min(6000, number)}px` : '';
}
function cleanSpacing(value) {
    const list = (Array.isArray(value) ? value : [value]).map(Number);
    if (![1, 2, 4].includes(list.length) || list.some((item) => !Number.isFinite(item))) return undefined;
    return list.map((item) => Math.max(0, Math.min(400, item)));
}
function clampNumber(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : undefined;
}
function cleanOptions(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 500).map((option) => {
        if (typeof option === 'string' || typeof option === 'number') return { value: String(option).slice(0, 240), label: String(option).slice(0, 240) };
        if (!option || typeof option !== 'object') return null;
        return {
            value: String(option.value ?? '').slice(0, 240),
            label: String(option.label ?? option.value ?? '').slice(0, 240),
            labelKey: typeof option.labelKey === 'string' ? option.labelKey.slice(0, 120) : ''
        };
    }).filter(Boolean);
}
// An entry with `submenu` (a list of the same shape, two levels deep at most) opens a further
// menu beside it instead of being a choice itself.
export function cleanMenu(value, depth = 0) {
    if (!Array.isArray(value)) return undefined;
    const items = value.slice(0, 40).map((item) => {
        if (item === '-' || item?.separator === true) return { separator: true };
        if (!item || typeof item !== 'object') return null;
        const submenu = depth < 2 && Array.isArray(item.submenu) ? cleanMenu(item.submenu, depth + 1) : undefined;
        const id = cleanId(item.id) || (submenu ? `submenu-${depth}` : '');
        const label = String(item.label ?? '').slice(0, 120);
        const labelKey = typeof item.labelKey === 'string' ? item.labelKey.slice(0, 120) : '';
        if (!id || (!label && !labelKey)) return null;
        const out = { id, label };
        if (submenu) out.submenu = submenu;
        if (labelKey) out.labelKey = labelKey;
        if (item.danger === true) out.danger = true;
        if (item.disabled === true) out.disabled = true;
        if (item.checked === true) out.checked = true;
        return out;
    }).filter(Boolean);
    return items.length ? items : undefined;
}
function cleanIdList(value) {
    return Array.isArray(value) ? [...new Set(value.map(cleanId).filter(Boolean))].slice(0, MAX_ROWS) : [];
}
const MAX_TREE_DEPTH = 8;
// `budget` is shared by a whole list: nested rows and the rows of every section count
// towards the same limit as a flat list's.
function cleanListItems(value, ctx, budget = { left: MAX_ROWS }, depth = 0) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (budget.left <= 0) return null;
        if (typeof item === 'string') { budget.left -= 1; return { id: cleanId(item) || item.slice(0, 80), title: item.slice(0, 300) }; }
        if (!item || typeof item !== 'object') return null;
        const id = cleanId(item.id);
        if (!id) return null;
        budget.left -= 1;
        const out = { id, title: String(item.title ?? '').slice(0, 300) };
        // children: rows nested under this one (an outline). The host draws the chevron and
        // keeps what is open in the list's `expanded`. expandable: a chevron for a row whose
        // children are only supplied once it is opened.
        if (Array.isArray(item.children) && depth < MAX_TREE_DEPTH) out.children = cleanListItems(item.children, ctx, budget, depth + 1);
        else if (item.expandable === true) out.expandable = true;
        if (typeof item.titleKey === 'string') out.titleKey = item.titleKey.slice(0, 120);
        if (item.subtitle != null) out.subtitle = String(item.subtitle).slice(0, 400);
        if (item.detail != null) out.detail = String(item.detail).slice(0, 80);
        if (item.badge != null) out.badge = String(item.badge).slice(0, 40);
        if (typeof item.icon === 'string' && ctx.validSource(item.icon)) out.icon = item.icon;
        if (item.disabled === true) out.disabled = true;
        if (item.emphasis === true) out.emphasis = true;
        // tint: the icon is a monochrome glyph drawn in the accent colour (white when selected).
        if (item.tint === true) out.tint = true;
        const menu = cleanMenu(item.menu);
        if (menu) out.menu = menu; // overrides the list's itemMenu for this row
        // header: a non-selectable section caption. indent: nesting depth (folders).
        // disclosure: draws a chevron ('open' / 'closed') for rows that expand.
        if (item.header === true) out.header = true;
        const indent = clampNumber(item.indent, 0, 6);
        if (indent) out.indent = Math.round(indent);
        if (item.disclosure === 'open' || item.disclosure === 'closed') out.disclosure = item.disclosure;
        // Per-row opt-out for lists with draggable / dropTarget.
        if (item.drag === false) out.drag = false;
        if (item.drop === false) out.drop = false;
        return out;
    }).filter(Boolean);
}
function cleanSections(value, ctx) {
    if (!Array.isArray(value)) return [];
    const budget = { left: MAX_ROWS };
    return value.slice(0, 2000).map((section) => {
        if (!section || typeof section !== 'object') return null;
        const id = cleanId(section.id);
        if (!id || budget.left <= 0) return null;
        budget.left -= 1;
        const out = { id, title: String(section.title ?? '').slice(0, 300), items: cleanListItems(section.items, ctx, budget) };
        if (typeof section.titleKey === 'string') out.titleKey = section.titleKey.slice(0, 120);
        if (section.detail != null) out.detail = String(section.detail).slice(0, 80);
        if (section.collapsible === true) out.collapsible = true;
        return out;
    }).filter(Boolean);
}
function cleanColumns(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 24).map((column) => {
        if (!column || typeof column !== 'object') return null;
        const id = cleanId(column.id);
        if (!id) return null;
        const out = { id, title: String(column.title ?? '').slice(0, 120) };
        if (typeof column.titleKey === 'string') out.titleKey = column.titleKey.slice(0, 120);
        out.width = cleanTrack(column.width ?? '1fr') || 'minmax(0, 1fr)';
        if (['start', 'center', 'end'].includes(column.align)) out.align = column.align;
        if (column.sortable === true) out.sortable = true;
        if (column.muted === true) out.muted = true;
        return out;
    }).filter(Boolean);
}
function cleanRows(value, ctx) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_ROWS).map((row) => {
        if (!row || typeof row !== 'object') return null;
        const id = cleanId(row.id);
        if (!id) return null;
        const cells = {};
        if (row.cells && typeof row.cells === 'object') {
            for (const [key, cell] of Object.entries(row.cells).slice(0, 24)) if (cell != null && typeof cell !== 'object') cells[cleanId(key)] = String(cell).slice(0, 600);
        }
        const out = { id, cells };
        if (typeof row.icon === 'string' && ctx.validSource(row.icon)) out.icon = row.icon;
        if (row.disabled === true) out.disabled = true;
        if (row.emphasis === true) out.emphasis = true;
        const menu = cleanMenu(row.menu);
        if (menu) out.menu = menu;
        if (row.drag === false) out.drag = false;
        if (row.drop === false) out.drop = false;
        return out;
    }).filter(Boolean);
}
function cleanRuns(value) {
    if (!Array.isArray(value)) return undefined;
    return value.slice(0, 600).map((run) => {
        if (typeof run === 'string') return { text: run.slice(0, 4000) };
        if (!run || typeof run !== 'object' || run.text == null) return null;
        const out = { text: String(run.text).slice(0, 4000) };
        for (const key of ['bold', 'italic', 'underline', 'strike', 'code']) if (run[key] === true) out[key] = true;
        const color = cleanColor(run.color);
        if (color) out.color = color;
        if (typeof run.link === 'string' && /^https?:\/\/[^\s]{1,2000}$/i.test(run.link)) out.link = run.link;
        return out;
    }).filter(Boolean);
}

// Canvas display list. Each command is [name, ...args]; only the operations below exist
// and every argument is type-checked, so a drawing can never run script.
const NUM = 'n'; const TEXT = 't'; const COLOR = 'c'; const SOURCE = 's';
const CANVAS_OPS = {
    fillStyle: [COLOR], strokeStyle: [COLOR], lineWidth: [NUM], globalAlpha: [NUM], font: [NUM, 'weight?', 'family?'],
    textAlign: [['left', 'right', 'center', 'start', 'end']], textBaseline: [['top', 'middle', 'alphabetic', 'bottom', 'hanging']],
    lineCap: [['butt', 'round', 'square']], lineJoin: [['miter', 'round', 'bevel']], setLineDash: ['dash'],
    shadow: [COLOR, NUM, 'n?', 'n?'],
    fillRect: [NUM, NUM, NUM, NUM], strokeRect: [NUM, NUM, NUM, NUM], clearRect: [NUM, NUM, NUM, NUM],
    beginPath: [], closePath: [], fill: [], stroke: [], clip: [], save: [], restore: [],
    moveTo: [NUM, NUM], lineTo: [NUM, NUM], rect: [NUM, NUM, NUM, NUM], roundRect: [NUM, NUM, NUM, NUM, NUM],
    arc: [NUM, NUM, NUM, NUM, NUM, 'b?'], ellipse: [NUM, NUM, NUM, NUM, NUM, NUM, NUM], quadraticCurveTo: [NUM, NUM, NUM, NUM], bezierCurveTo: [NUM, NUM, NUM, NUM, NUM, NUM],
    translate: [NUM, NUM], scale: [NUM, NUM], rotate: [NUM],
    fillText: [TEXT, NUM, NUM, 'n?'], strokeText: [TEXT, NUM, NUM, 'n?'], drawImage: [SOURCE, NUM, NUM, NUM, NUM]
};
function cleanCommands(value, ctx) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const command of value.slice(0, 20000)) {
        if (!Array.isArray(command)) continue;
        const spec = CANVAS_OPS[command[0]];
        if (!spec) continue;
        const args = [];
        let valid = true;
        for (let i = 0; i < spec.length && valid; i += 1) {
            const kind = spec[i]; const arg = command[i + 1];
            const optional = typeof kind === 'string' && kind.endsWith('?');
            if (arg === undefined && optional) break;
            if (Array.isArray(kind)) { if (kind.includes(arg)) args.push(arg); else valid = false; }
            else if (kind === NUM || kind === 'n?') { const n = Number(arg); if (Number.isFinite(n)) args.push(Math.max(-1e5, Math.min(1e5, n))); else valid = false; }
            else if (kind === TEXT) args.push(String(arg ?? '').slice(0, 2000));
            else if (kind === COLOR) { const color = cleanColor(arg); if (color) args.push(color); else valid = false; }
            else if (kind === SOURCE) { if (typeof arg === 'string' && ctx.validSource(arg)) args.push(arg); else valid = false; }
            else if (kind === 'weight?') { const n = Object.hasOwn(FONT_WEIGHTS, arg) ? FONT_WEIGHTS[arg] : Number(arg); args.push(Number.isFinite(n) ? Math.max(100, Math.min(900, n)) : 400); }
            else if (kind === 'family?') args.push(Object.hasOwn(FONT_FAMILIES, arg) ? arg : 'system');
            else if (kind === 'b?') args.push(arg === true);
            else if (kind === 'dash') args.push((Array.isArray(arg) ? arg : []).slice(0, 8).map(Number).filter((n) => Number.isFinite(n) && n >= 0));
        }
        if (valid) out.push([command[0], ...args]);
    }
    return out;
}

function withStyles(source, styles) {
    if (!styles || source.style == null) return source;
    const names = (Array.isArray(source.style) ? source.style : [source.style]).filter((name) => typeof name === 'string' && Object.hasOwn(styles, name));
    if (!names.length) return source;
    const merged = {};
    for (const name of names) Object.assign(merged, styles[name]);
    return { ...merged, ...source, style: names };
}

// Validates the fields of one node (not its children). `source` may be a raw node from a
// package or an already normalised node merged with a patch; both give the same result.
export function normalizeFields(raw, ctx) {
    const source = withStyles(raw, ctx.styles);
    const type = NATIVE_UI_TYPES.has(source.type) ? source.type : '';
    if (!type) return null;
    const out = { type };
    const id = cleanId(source.id);
    if (id) out.id = id;
    if (Array.isArray(source.style) && source.style.length) out.style = source.style.slice(0, 8);

    for (const key of ['text', 'label', 'placeholder', 'tooltip', 'alt']) if (typeof source[key] === 'string') out[key] = source[key].slice(0, key === 'text' ? 50000 : 600);
    for (const key of ['textKey', 'labelKey', 'placeholderKey']) if (typeof source[key] === 'string' && source[key]) out[key] = source[key].slice(0, 120);
    if (source.value != null && typeof source.value !== 'object') out.value = String(source.value).slice(0, type === 'textarea' ? 500000 : 2000);
    for (const key of BOOLEAN_KEYS) if (typeof source[key] === 'boolean') out[key] = source[key];

    // Layout
    for (const key of ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight']) {
        const length = cleanLength(source[key]);
        if (length !== undefined) out[key] = length;
    }
    for (const key of ['padding', 'margin']) {
        if (source[key] == null) continue;
        const spacing = cleanSpacing(source[key]);
        if (spacing) out[key] = spacing;
    }
    for (const [key, [min, max]] of Object.entries(NUMERIC_KEYS)) {
        if (source[key] == null || source[key] === '') continue;
        const number = clampNumber(source[key], min, max);
        if (number !== undefined) out[key] = INTEGER_KEYS.has(key) ? Math.round(number) : number;
    }
    if (source.rowHeight === 'auto' && type === 'grid') out.rowHeight = 'auto';
    else if (source.rowHeight != null) { const rowHeight = clampNumber(source.rowHeight, type === 'grid' ? 1 : 16, 2000); if (rowHeight !== undefined) out.rowHeight = rowHeight; }
    if (source.direction === 'horizontal' || source.direction === 'vertical' || (type === 'scroll' && source.direction === 'both')) out.direction = source.direction;
    if (Object.hasOwn(ALIGN, source.align)) out.align = source.align;
    if (Object.hasOwn(JUSTIFY, source.justify)) out.justify = source.justify;
    if (Object.hasOwn(ALIGN, source.alignSelf)) out.alignSelf = source.alignSelf;
    if (Object.hasOwn(GRID_ALIGN, source.justifySelf)) out.justifySelf = source.justifySelf;

    // Appearance
    for (const key of ['background', 'color']) { const color = cleanColor(source[key]); if (color) out[key] = color; }
    // gradient: two to four colours, top to bottom, in place of a flat background.
    if (Array.isArray(source.gradient)) { const colors = source.gradient.slice(0, 4).map(cleanColor).filter(Boolean); if (colors.length >= 2) out.gradient = colors; }
    if (source.border === true) out.border = true;
    else { const border = cleanColor(source.border); if (border) out.border = border; }
    if (source.radius === 'full') out.radius = 'full';
    else if (source.radius != null) { const radius = clampNumber(source.radius, 0, 200); if (radius !== undefined) out.radius = radius; }
    if (Object.hasOwn(FONT_WEIGHTS, source.fontWeight)) out.fontWeight = source.fontWeight;
    else if (source.fontWeight != null) { const weight = clampNumber(source.fontWeight, 100, 900); if (weight !== undefined) out.fontWeight = Math.round(weight / 100) * 100; }
    if (['start', 'center', 'end'].includes(source.textAlign)) out.textAlign = source.textAlign;
    if (Object.hasOwn(FONT_FAMILIES, source.font)) out.font = source.font;
    const menu = cleanMenu(source.contextMenu);
    if (menu) out.contextMenu = menu;
    if (MATERIALS.has(source.material)) out.material = source.material;
    if (Object.hasOwn(TRANSITIONS, source.transition)) out.transition = source.transition;

    // Type specific
    if (type === 'text') {
        if (TEXT_VARIANTS.has(source.variant)) out.variant = source.variant;
        const runs = cleanRuns(source.runs);
        if (runs?.length) out.runs = runs;
    }
    if (type === 'button') {
        if (BUTTON_VARIANTS.has(source.variant)) out.variant = source.variant;
        if (BUTTON_SHAPES.has(source.shape)) out.shape = source.shape;
        if (typeof source.icon === 'string' && ctx.validSource(source.icon)) out.icon = source.icon;
    }
    if (type === 'input' && INPUT_TYPES.has(source.inputType)) out.inputType = source.inputType;
    if (type === 'video' && (source.fit === 'cover' || source.fit === 'contain')) out.fit = source.fit;
    if (type === 'image') {
        const src = source.src ?? source.asset;
        if (typeof src === 'string' && ctx.validSource(src)) out.src = src;
        if (source.fit === 'cover' || source.fit === 'contain') out.fit = source.fit;
    }
    if (type === 'grid') {
        if (Array.isArray(source.columns)) { const tracks = source.columns.slice(0, 24).map(cleanTrack).filter(Boolean); if (tracks.length) out.columns = tracks; }
        else { const columns = clampNumber(source.columns, 1, 24); if (columns !== undefined) out.columns = Math.round(columns); }
    }
    if (type === 'select' || type === 'segmented') out.options = cleanOptions(source.options);
    if (type === 'list' || type === 'table') {
        if (type === 'list') {
            // sections: the list in titled groups, in place of `items`.
            if (Array.isArray(source.sections)) { out.sections = cleanSections(source.sections, ctx); out.items = []; }
            else out.items = cleanListItems(source.items, ctx);
            if (source.expanded != null) out.expanded = cleanIdList(source.expanded);
            if (source.collapsed != null) out.collapsed = cleanIdList(source.collapsed);
        } else {
            out.columns = cleanColumns(source.columns);
            out.rows = cleanRows(source.rows, ctx);
            if (source.sort && typeof source.sort === 'object') {
                const column = cleanId(source.sort.column);
                if (column) out.sort = { column, direction: source.sort.direction === 'desc' ? 'desc' : 'asc' };
            }
        }
        if (source.values != null) out.values = cleanIdList(source.values);
        // Where rows may be dropped on a dropTarget: 'on' a row (the default), 'between' rows,
        // or 'both'.
        if (source.dropPosition === 'between' || source.dropPosition === 'both') out.dropPosition = source.dropPosition;
        const itemMenu = cleanMenu(source.itemMenu);
        if (itemMenu) out.itemMenu = itemMenu;
    }
    if (type === 'canvas') out.commands = cleanCommands(source.commands, ctx);
    if (type === 'html') {
        out.html = ctx.sanitizeHtml(String(source.html ?? '').slice(0, 400000));
        out.css = ctx.sanitizeCss(String(source.css ?? '').slice(0, 100000));
    }
    return out;
}

export function normalizeNode(raw, ctx, depth = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 24) return null;
    if (ctx.count >= ctx.maxNodes) throw new Error(`Native UI is limited to ${ctx.maxNodes} nodes`);
    const node = normalizeFields(raw, ctx);
    if (!node) return null;
    ctx.count += 1;
    if (CONTAINER_TYPES.has(node.type)) {
        node.children = (Array.isArray(raw.children) ? raw.children : []).map((child) => normalizeNode(child, ctx, depth + 1)).filter(Boolean);
    }
    return node;
}

export function countNodes(node) {
    return node ? 1 + (node.children || []).reduce((sum, child) => sum + countNodes(child), 0) : 0;
}

export function cleanStyles(value) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [name, props] of Object.entries(value).slice(0, 200)) {
        if (!/^[a-z0-9._-]{1,60}$/i.test(name) || !props || typeof props !== 'object' || Array.isArray(props)) continue;
        const { type, id, children, style, ...rest } = props;
        out[name] = rest;
    }
    return out;
}

const defaultEnv = { validSource: () => false, sanitizeHtml: () => '', sanitizeCss: () => '' };

/** A UI file is either a root node, or `{ "styles": { name: props }, "root": node }`. */
export function normalizeNativeTree(raw, { maxNodes = 2000, ...env } = {}) {
    const wrapped = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.root && !raw.type;
    const styles = cleanStyles(wrapped ? raw.styles : null);
    const ctx = { count: 0, maxNodes, styles, ...defaultEnv, ...env };
    const root = normalizeNode(wrapped ? raw.root : raw, ctx, 0);
    return root ? { root, styles } : null;
}

// ---------------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------------
