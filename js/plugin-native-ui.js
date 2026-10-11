// Host-rendered Native App UI.
//
// A native application never touches the desktop DOM. It describes its interface as a
// tree of plain JSON nodes; this module validates every field and builds the real
// controls. Text only ever reaches the DOM through textContent, every style value is
// checked against a closed vocabulary, canvas drawing is a whitelisted display list and
// free-form HTML is confined to a script-less sandboxed frame, so a package cannot
// inject markup, CSS or script into the desktop.

import { createElement } from './utils.js';
import { motionScale } from './dev-hooks.js';
import { ALIGN, BACKGROUND_TYPES, CANVAS_TOKEN_ALPHA, CANVAS_TOKEN_COLORS, CONTAINER_TYPES, FONT_FAMILIES, FONT_WEIGHTS, GRID_ALIGN, JUSTIFY, TRANSITIONS, TRANSITION_EASING, TRANSITION_MS, cleanStyles, countNodes, cssColor, cssLength, normalizeFields, normalizeNode } from './native-ui-schema.js';
import { menuJustClosedBy, presentMenu, showNativeMenu } from './native-ui-menu.js';
import { createListSupport } from './native-ui-list.js';

export * from './native-ui-schema.js';
export * from './native-ui-menu.js';

const EDITABLE = 'input,textarea,select';
const TRANSLATED_KEYS = ['text', 'textKey', 'label', 'labelKey', 'placeholder', 'options', 'items', 'columns', 'rows'];

/**
 * Renders and maintains one native app's control tree inside `frame`.
 *  - translate(key, fallback): localised string for the app
 *  - resolveSource(value): Promise<string> usable image URL for a package path, file id or data URL
 *  - emit(detail): forwards a control event ({ id, event, value, ... }) to the app
 */
export function createNativeRenderer({ frame, tree, styles = {}, maxNodes, validSource, sanitizeHtml, sanitizeCss, translate, resolveSource, emit, attachMedia = () => {}, detachMedia = () => {}, motion = () => true }) {
    const nodeElement = new WeakMap(); // node -> element (for nodes without an id)
    const elements = new Map();    // id -> element
    const nodes = new Map();       // id -> node
    const elementNode = new WeakMap();
    const parents = new WeakMap(); // node -> parent node
    const images = new Map();      // canvas image cache: source -> HTMLImageElement
    const styleTable = { ...styles };
    let root = null;
    let mounting = false;          // the first build of a tree never animates

    const env = { validSource, sanitizeHtml, sanitizeCss };
    const ctx = (budget = Infinity) => ({ count: 0, maxNodes: budget, styles: styleTable, ...env });
    // Events carry the control's current value so apps rarely need a separate ui.get().
    const fire = (node, event, extra = {}) => {
        if (!node.id) return;
        const value = node.type === 'text' || node.type === 'button' ? {} : valueOf(node.id);
        emit({ id: node.id, event, ...value, ...extra });
    };

    function setStyle(el, property, value) {
        if (value === undefined || value === null || value === '') el.style.removeProperty(property);
        else el.style.setProperty(property, String(value));
    }
    // [top, right, bottom, left] as an application writes it for a left-to-right layout;
    // applied as block / inline spacing, so a mirrored layout swaps left and right.
    const applySpacing = (el, name, value) => {
        const [top, right = top, bottom = top, left = right] = value || [];
        setStyle(el, `${name}-block`, value ? `${top}px ${bottom}px` : undefined);
        setStyle(el, `${name}-inline`, value ? `${left}px ${right}px` : undefined);
    };
    function setImage(img, source) {
        if (!source) { img.removeAttribute('src'); return; }
        img.dataset.source = source;
        resolveSource(source).then((url) => { if (url && img.dataset.source === source) img.src = url; }).catch(() => {});
    }

    // A monochrome glyph painted with the element's background colour through a mask.
    function setMask(el, source) {
        el.dataset.source = source;
        resolveSource(source).then((url) => {
            if (!url || el.dataset.source !== source) return;
            const value = `url("${url.replace(/"/g, '%22')}") center / contain no-repeat`;
            el.style.setProperty('-webkit-mask', value); el.style.setProperty('mask', value);
        }).catch(() => {});
    }

    // Classes shared by every node type. Applied again after the type-specific part of
    // sync(), because text and button nodes rebuild their class list there.
    function applyClasses(el, node) {
        el.classList.toggle('plugin-native-glass', node.material === 'glass');
        el.classList.toggle('plugin-native-ltr', node.ltr === true);
        // Shown only while the pointer is over the parent container (hover affordances).
        el.classList.toggle('plugin-native-hover-reveal', Boolean(node.showOnHover));
        if (node.dismissable) dismissables.add(el);
        for (const material of ['bar', 'sidebar', 'content', 'clear']) el.classList.toggle(`plugin-native-material-${material}`, node.material === material);
    }

    function applyCommon(el, node) {
        for (const [key, property] of [['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['minHeight', 'min-height'], ['maxWidth', 'max-width'], ['maxHeight', 'max-height']]) {
            setStyle(el, property, node[key] === undefined ? undefined : cssLength(node[key]));
        }
        setStyle(el, 'flex', node.grow !== undefined ? `${node.grow} 1 0%` : ((node.width !== undefined || node.height !== undefined) && node.type !== 'spacer' ? '0 0 auto' : undefined));
        setStyle(el, 'align-self', node.alignSelf ? ALIGN[node.alignSelf] : undefined);
        setStyle(el, 'justify-self', node.justifySelf ? GRID_ALIGN[node.justifySelf] : (node.alignSelf && GRID_ALIGN[node.alignSelf] ? GRID_ALIGN[node.alignSelf] : undefined));
        setStyle(el, 'grid-column', node.span ? `span ${node.span}` : undefined);
        setStyle(el, 'grid-row', node.rowSpan ? `span ${node.rowSpan}` : undefined);
        applySpacing(el, 'padding', node.padding);
        applySpacing(el, 'margin', node.margin);
        setStyle(el, 'background', node.gradient ? `linear-gradient(to bottom, ${node.gradient.map(cssColor).join(', ')})` : (node.background ? cssColor(node.background) : undefined));
        setStyle(el, 'color', node.color ? cssColor(node.color) : undefined);
        setStyle(el, 'border', node.border === true ? '1px solid var(--native-border)' : (node.border ? `1px solid ${cssColor(node.border)}` : undefined));
        setStyle(el, 'border-radius', node.radius === 'full' ? '999px' : (node.radius !== undefined ? `${node.radius}px` : undefined));
        setStyle(el, 'opacity', node.opacity);
        setStyle(el, 'font-size', node.fontSize !== undefined ? `${node.fontSize}px` : undefined);
        setStyle(el, 'font-weight', node.fontWeight !== undefined ? (FONT_WEIGHTS[node.fontWeight] || node.fontWeight) : undefined);
        setStyle(el, 'text-align', node.textAlign);
        setStyle(el, 'font-family', node.font ? FONT_FAMILIES[node.font] : undefined);
        el.hidden = Boolean(node.hidden);
        applyClasses(el, node);
        if (node.tooltip) el.title = node.tooltip; else el.removeAttribute('title');
        if (node.id) el.dataset.nativeId = node.id; else delete el.dataset.nativeId;
    }

    function control(el) {
        return el.matches(EDITABLE + ',progress') ? el : el.querySelector(EDITABLE + ',progress');
    }
    function valueOf(id) {
        const el = elements.get(id);
        const node = nodes.get(id);
        if (!el || !node) return {};
        if (node.type === 'segmented') return { value: node.value ?? '' };
        if (node.type === 'select') return { value: String(node.value ?? node.options?.[0]?.value ?? ''), disabled: Boolean(node.disabled) };
        if (node.type === 'list' || node.type === 'table') { const values = selectionOf(node); return { value: values[values.length - 1] ?? '', values: [...values] }; }
        const input = control(el);
        if (!input) return node.type === 'text' || node.type === 'button' ? { text: el.textContent || '' } : {};
        return { value: input.value, checked: Boolean(input.checked), disabled: Boolean(input.disabled), ...selectionOfControl(input) };
    }
    // The selection of a text control: where it starts and ends in `value`, and what it holds.
    function selectionOfControl(input) {
        if (!input || !('selectionStart' in input) || input.selectionStart == null) return {};
        const start = input.selectionStart; const end = input.selectionEnd;
        return { selectionStart: start, selectionEnd: end, selectionDirection: input.selectionDirection || 'none', selectionText: input.value.slice(start, end).slice(0, 200000) };
    }
    function textControl(id) {
        const { node, el } = requireNode(id);
        const input = control(el);
        if (!input || !('selectionStart' in input) || (node.type !== 'input' && node.type !== 'textarea')) throw new Error(`Native UI: "${id}" is not a text control`);
        return { node, input };
    }

    const label = (node) => translate(node.labelKey, node.label ?? node.text ?? '');

    // ---- rich text
    function renderRuns(el, node) {
        el.replaceChildren(...node.runs.map((run) => {
            const span = createElement(run.link ? 'a' : (run.code ? 'code' : 'span'), { text: run.text });
            if (run.bold) span.style.fontWeight = '600';
            if (run.italic) span.style.fontStyle = 'italic';
            if (run.underline || run.strike) span.style.textDecoration = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].join(' ').trim();
            if (run.color) span.style.color = cssColor(run.color);
            if (run.link) { span.className = 'plugin-native-link'; span.dataset.link = run.link; span.setAttribute('role', 'link'); }
            return span;
        }));
    }

    // ---- lists and tables (native-ui-list.js)
    const lists = createListSupport({ frame, elementNode, fire, translate, setImage, setMask, sync: (el, node, changed) => sync(el, node, changed) });
    const { virtual, rowsOf, selectionOf, tableTemplate, createVirtualRows, bindRows, reportScroll } = lists;

    // ---- canvas
    function canvasColor(value, style) {
        if (value === 'accent') return style.getPropertyValue('--native-accent').trim() || CANVAS_TOKEN_COLORS.accent;
        if (Object.hasOwn(CANVAS_TOKEN_COLORS, value)) return CANVAS_TOKEN_COLORS[value];
        if (Object.hasOwn(CANVAS_TOKEN_ALPHA, value)) {
            const channels = style.color.match(/[\d.]+/g) || [0, 0, 0];
            return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${CANVAS_TOKEN_ALPHA[value]})`;
        }
        return value;
    }
    function canvasImage(source, redraw) {
        let image = images.get(source);
        if (!image) {
            image = new Image();
            images.set(source, image);
            if (images.size > 200) images.delete(images.keys().next().value);
            image.onload = redraw;
            resolveSource(source).then((url) => { if (url) image.src = url; }).catch(() => {});
        }
        return image.complete && image.naturalWidth ? image : null;
    }
    function draw(canvas, node) {
        const width = canvas.clientWidth || (typeof node.width === 'number' ? node.width : 300);
        const height = canvas.clientHeight || (typeof node.height === 'number' ? node.height : 150);
        const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
        const context = canvas.getContext('2d');
        const style = getComputedStyle(canvas);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = context.strokeStyle = style.color;
        let depth = 0;
        for (const [name, ...args] of node.commands || []) {
            try {
                if (name === 'fillStyle' || name === 'strokeStyle') context[name] = canvasColor(args[0], style);
                else if (['lineWidth', 'globalAlpha', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'].includes(name)) context[name] = args[0];
                else if (name === 'font') context.font = `${args[1] || 400} ${args[0]}px ${FONT_FAMILIES[args[2] || 'system']}`;
                else if (name === 'shadow') { context.shadowColor = canvasColor(args[0], style); context.shadowBlur = args[1]; context.shadowOffsetX = args[2] || 0; context.shadowOffsetY = args[3] || 0; }
                else if (name === 'drawImage') { const image = canvasImage(args[0], () => draw(canvas, node)); if (image) context.drawImage(image, args[1], args[2], args[3], args[4]); }
                else if (name === 'save') { if (depth < 64) { depth += 1; context.save(); } }
                else if (name === 'restore') { if (depth > 0) { depth -= 1; context.restore(); } }
                else context[name](...args);
            } catch { /* one bad command never stops the drawing */ }
        }
        while (depth > 0) { depth -= 1; context.restore(); }
    }

    // ---- sandboxed static HTML
    function htmlDocument(node) {
        const style = getComputedStyle(frame);
        const dark = (style.colorScheme || '').includes('dark');
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}">`
            + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:">'
            + `<style>html,body{margin:0;background:transparent}body{padding:12px;font:13px/1.55 ${FONT_FAMILIES.system};color:${style.color};overflow-wrap:anywhere}`
            + `a{color:${style.getPropertyValue('--native-accent').trim() || '#0a84ff'};text-decoration:none}`
            + 'img{max-width:100%;height:auto}pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}'
            + 'pre{padding:10px;border-radius:8px;background:rgba(127,127,127,.14);overflow:auto}blockquote{margin:0;padding-left:12px;border-left:3px solid rgba(127,127,127,.35);opacity:.85}'
            + 'h1,h2,h3{line-height:1.25}table{border-collapse:collapse}td,th{border:1px solid rgba(127,127,127,.3);padding:4px 8px}hr{border:0;border-top:1px solid rgba(127,127,127,.3)}</style>'
            + `<style>${node.css || ''}</style></head><body>${node.html || ''}</body></html>`;
    }

    // Type-specific content. `changed` is null on first build, otherwise the changed keys;
    // user-editable state (value/checked) is only overwritten when the app changed it.
    function sync(el, node, changed = null) {
        const touched = (...keys) => !changed || keys.some((key) => changed.includes(key));
        applyCommon(el, node);
        switch (node.type) {
        case 'stack': case 'group': case 'toolbar': case 'card': case 'scroll': {
            if (node.type !== 'toolbar' && node.type !== 'card') {
                const horizontal = node.direction === 'horizontal';
                el.classList.toggle('horizontal', horizontal);
                el.classList.toggle('vertical', !horizontal);
            }
            if (node.type === 'scroll') {
                el.classList.toggle('both', node.direction === 'both');
                // insetTop / insetBottom: bars floating over the scroll area; its scroll bar runs between them.
                setStyle(el, '--scroll-track-top', node.insetTop ? `${node.insetTop}px` : undefined);
                setStyle(el, '--scroll-track-bottom', node.insetBottom ? `${node.insetBottom}px` : undefined);
                el.classList.toggle('plugin-native-inset-scroll', Boolean(node.insetTop || node.insetBottom));
            }
            setStyle(el, '--native-gap', node.gap !== undefined ? `${node.gap}px` : undefined);
            setStyle(el, 'align-items', node.align ? ALIGN[node.align] : undefined);
            setStyle(el, 'justify-content', node.justify ? JUSTIFY[node.justify] : undefined);
            setStyle(el, 'flex-wrap', node.wrap ? 'wrap' : undefined);
            break;
        }
        case 'zstack': {
            setStyle(el, 'align-items', node.align && GRID_ALIGN[node.align] ? GRID_ALIGN[node.align] : undefined);
            setStyle(el, 'justify-items', node.justify && GRID_ALIGN[node.justify] ? GRID_ALIGN[node.justify] : undefined);
            break;
        }
        case 'grid': {
            setStyle(el, 'grid-template-columns', Array.isArray(node.columns) ? node.columns.join(' ') : `repeat(${node.columns || 2}, minmax(0, 1fr))`);
            setStyle(el, 'grid-auto-rows', node.rowHeight === undefined ? undefined : (node.rowHeight === 'auto' ? 'auto' : `${node.rowHeight}px`));
            setStyle(el, '--native-gap', node.gap !== undefined ? `${node.gap}px` : undefined);
            setStyle(el, 'align-items', node.align && GRID_ALIGN[node.align] ? GRID_ALIGN[node.align] : undefined);
            setStyle(el, 'justify-items', node.justify && GRID_ALIGN[node.justify] ? GRID_ALIGN[node.justify] : undefined);
            break;
        }
        case 'text': {
            el.className = `plugin-native-text${node.variant ? ` ${node.variant}` : ''}${node.selectable ? ' selectable' : ''}${node.lines ? ' clamped' : ''}`;
            setStyle(el, '--native-lines', node.lines);
            if (touched('text', 'textKey', 'runs')) {
                if (node.runs) renderRuns(el, node);
                else el.textContent = translate(node.textKey, node.text ?? '');
            }
            break;
        }
        case 'button': {
            el.className = `plugin-native-button${node.variant ? ` ${node.variant}` : ''}${node.shape ? ` ${node.shape}` : ''}`;
            el.disabled = Boolean(node.disabled);
            if (touched('label', 'labelKey', 'text', 'icon', 'iconSize', 'iconTint')) {
                el.replaceChildren();
                if (node.icon) {
                    // iconTint draws a monochrome glyph in the button's text colour (so it
                    // follows the theme); otherwise the image is shown as it is.
                    const img = createElement(node.iconTint ? 'span' : 'img', { className: `plugin-native-button-icon${node.iconTint ? ' tinted' : ''}`, attrs: node.iconTint ? {} : { alt: '' } });
                    if (node.iconSize) { img.style.width = `${node.iconSize}px`; img.style.height = `${node.iconSize}px`; }
                    if (node.iconTint) setMask(img, node.icon); else setImage(img, node.icon);
                    el.appendChild(img);
                }
                const text = label(node);
                if (text) el.appendChild(createElement('span', { text }));
                if (!text && node.alt) el.setAttribute('aria-label', node.alt);
            }
            break;
        }
        case 'input': case 'textarea': {
            el.disabled = Boolean(node.disabled);
            el.readOnly = Boolean(node.readOnly);
            if (node.type === 'input') el.type = node.inputType || 'text';
            else el.rows = node.rows || 4;
            if (node.maxLength) el.maxLength = node.maxLength; else el.removeAttribute('maxlength');
            el.placeholder = translate(node.placeholderKey, node.placeholder ?? '');
            if (touched('value') && el.value !== (node.value ?? '')) el.value = node.value ?? '';
            break;
        }
        case 'switch': case 'checkbox': {
            const input = el.querySelector('input');
            input.disabled = Boolean(node.disabled);
            if (touched('checked')) input.checked = Boolean(node.checked);
            const text = label(node);
            let caption = el.querySelector('.plugin-native-control-label');
            if (text && !caption) { caption = createElement('span', { className: 'plugin-native-control-label' }); el.appendChild(caption); }
            if (caption) { caption.textContent = text; caption.hidden = !text; }
            break;
        }
        case 'slider': {
            el.disabled = Boolean(node.disabled);
            el.min = String(node.min ?? 0); el.max = String(node.max ?? 100); el.step = String(node.step || 1);
            // A thumb the user is dragging is never moved from under the pointer.
            if (touched('value', 'min', 'max') && !el.matches(':active')) el.value = String(node.value ?? node.min ?? 0);
            break;
        }
        case 'progress': {
            el.max = Number(node.max ?? 100);
            if (node.value === undefined) el.removeAttribute('value'); else el.value = Number(node.value) || 0;
            break;
        }
        case 'select': {
            // A pop-up button in the system's style; its menu is the same one context menus use.
            const chosen = (node.options || []).find((option) => option.value === String(node.value ?? '')) || node.options?.[0];
            el.firstElementChild.textContent = chosen ? translate(chosen.labelKey, chosen.label) : '';
            el.classList.toggle('disabled', Boolean(node.disabled));
            el.setAttribute('aria-disabled', node.disabled ? 'true' : 'false');
            break;
        }
        case 'segmented': {
            if (touched('options')) {
                el.replaceChildren(...(node.options || []).map((option) => createElement('button', { text: translate(option.labelKey, option.label), attrs: { type: 'button' }, dataset: { value: option.value } })));
            }
            el.querySelectorAll('button').forEach((button) => {
                button.classList.toggle('active', button.dataset.value === String(node.value ?? ''));
                button.disabled = Boolean(node.disabled);
            });
            break;
        }
        case 'list': case 'table': {
            const rows = virtual.get(el);
            if (node.type === 'table' && rows.header) {
                rows.header.hidden = node.header === false;
                rows.header.style.gridTemplateColumns = tableTemplate(node);
                rows.header.replaceChildren(...(node.columns || []).map((column) => {
                    const sorted = node.sort?.column === column.id;
                    const heading = createElement('div', { className: `plugin-native-table-heading${column.sortable ? ' sortable' : ''}${sorted ? ' sorted' : ''}`, text: `${translate(column.titleKey, column.title)}${sorted ? (node.sort.direction === 'asc' ? ' ▴' : ' ▾') : ''}`, attrs: { role: 'columnheader' }, dataset: { column: column.id } });
                    if (column.align) heading.style.textAlign = column.align;
                    return heading;
                }));
            }
            lists.invalidate(node);
            el.classList.toggle('reorderable', Boolean(node.reorderable));
            el.classList.toggle('plain', Boolean(node.plain));
            rows.refresh(true);
            break;
        }
        case 'image': {
            el.alt = node.alt || '';
            setStyle(el, 'object-fit', node.fit);
            if (touched('src', 'asset')) setImage(el, node.src);
            break;
        }
        case 'video': setStyle(el, '--native-video-fit', node.fit); attachMedia(el); break;
        case 'canvas': requestAnimationFrame(() => { if (el.isConnected) draw(el, node); }); break;
        case 'html':
            if (touched('html', 'css')) { delete el.dataset.loaded; el.srcdoc = htmlDocument(node); }
            // Keyboard input stays with the app unless the node asks to be selectable
            // (see bindNativeKeyboard in plugin-system.js).
            el.toggleAttribute('data-keeps-focus', Boolean(node.selectable));
            break;
        case 'separator': el.classList.toggle('vertical', Boolean(node.vertical)); break;
        default: break;
        }
        applyClasses(el, node);
    }

    function build(node, parent = null) {
        let el;
        switch (node.type) {
        case 'stack': case 'group': el = createElement('div', { className: 'plugin-native-stack' }); break;
        case 'zstack': el = createElement('div', { className: 'plugin-native-zstack' }); break;
        case 'split': el = createElement('div', { className: 'plugin-native-split' }); break;
        case 'card': el = createElement('section', { className: 'plugin-native-card' }); break;
        case 'toolbar': el = createElement('div', { className: 'plugin-native-toolbar' }); break;
        case 'grid': el = createElement('div', { className: 'plugin-native-grid' }); break;
        case 'scroll': {
            el = createElement('div', { className: 'plugin-native-scroll plugin-native-stack' });
            let atEnd = false; let last = 0;
            el.addEventListener('scroll', () => reportScroll(el, node, (value) => { atEnd = value; }, () => atEnd, () => last, (value) => { last = value; }), { passive: true });
            break;
        }
        case 'text':
            el = createElement('div', { className: 'plugin-native-text' });
            el.addEventListener('click', (event) => {
                const link = event.target.closest('[data-link]');
                if (link) fire(node, 'link', { href: link.dataset.link });
                else if (node.id && !node.selectable) fire(node, 'click');
            });
            break;
        case 'button':
            el = createElement('button', { attrs: { type: 'button' } });
            // Like AppKit buttons, a click does not move keyboard focus onto the button,
            // so app-level key handling keeps working after the mouse is used.
            el.addEventListener('mousedown', (event) => event.preventDefault());
            el.addEventListener('click', () => fire(node, 'click'));
            break;
        case 'input': case 'textarea':
            el = createElement(node.type === 'input' ? 'input' : 'textarea', { className: node.type === 'input' ? 'plugin-native-input' : 'plugin-native-input plugin-native-textarea' });
            el.addEventListener('input', () => { node.value = el.value; fire(node, 'input'); });
            // selectionEvents: report where the caret / selection is whenever it moves.
            { let last = ''; let timer = 0;
              const report = () => { if (!node.selectionEvents) return; clearTimeout(timer); timer = setTimeout(() => { const key = `${el.selectionStart}:${el.selectionEnd}`; if (key !== last) { last = key; fire(node, 'selection'); } }, 60); };
              for (const type of ['select', 'keyup', 'mouseup', 'focus']) el.addEventListener(type, report); }
            el.addEventListener('change', () => fire(node, 'change'));
            el.addEventListener('focus', () => fire(node, 'focus'));
            el.addEventListener('blur', () => fire(node, 'blur'));
            if (node.type === 'input') el.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) fire(node, 'submit'); });
            break;
        case 'switch': case 'checkbox': {
            el = createElement('label', { className: node.type === 'switch' ? 'plugin-native-switch' : 'plugin-native-checkbox' });
            const input = createElement('input', { attrs: { type: 'checkbox' } });
            el.appendChild(input);
            if (node.type === 'switch') el.appendChild(createElement('span'));
            input.addEventListener('change', () => { node.checked = input.checked; fire(node, 'change'); });
            break;
        }
        case 'slider':
            el = createElement('input', { className: 'plugin-native-slider', attrs: { type: 'range' } });
            el.addEventListener('input', () => { node.value = el.value; fire(node, 'input'); });
            el.addEventListener('change', () => fire(node, 'change'));
            break;
        case 'progress': el = createElement('progress', { className: 'plugin-native-progress' }); break;
        case 'select': {
            el = createElement('div', { className: 'plugin-native-select', attrs: { role: 'button', tabindex: '0', 'aria-haspopup': 'listbox' } });
            el.append(createElement('span', { className: 'plugin-native-select-label' }), createElement('span', { className: 'plugin-native-select-chevron', attrs: { 'aria-hidden': 'true' } }));
            const open = () => {
                if (node.disabled || !(node.options || []).length || menuJustClosedBy(el)) return;
                const current = String(node.value ?? node.options[0].value);
                const rect = el.getBoundingClientRect();
                presentMenu(node.options.map((option) => ({ id: option.value, label: option.label, labelKey: option.labelKey, checked: option.value === current })), rect.left, rect.bottom + 4, translate, { minWidth: rect.width, anchor: el })
                    .then((choice) => { if (choice == null || choice === current) return; node.value = choice; sync(el, node, ['value']); fire(node, 'change'); });
            };
            el.addEventListener('mousedown', (event) => event.preventDefault());
            el.addEventListener('click', open);
            el.addEventListener('keydown', (event) => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open(); } });
            break;
        }
        case 'segmented':
            el = createElement('div', { className: 'plugin-native-segmented', attrs: { role: 'tablist' } });
            el.addEventListener('mousedown', (event) => event.preventDefault());
            el.addEventListener('click', (event) => {
                const button = event.target.closest('button[data-value]');
                if (!button || button.disabled || node.value === button.dataset.value) return;
                node.value = button.dataset.value;
                sync(el, node, ['value']);
                fire(node, 'change');
            });
            break;
        case 'list': case 'table':
            el = createElement('div', { className: node.type === 'list' ? 'plugin-native-list' : 'plugin-native-table', attrs: { role: node.type === 'list' ? 'listbox' : 'table' } });
            virtual.set(el, createVirtualRows(el, node));
            bindRows(el, node);
            break;
        case 'image':
            el = createElement('img', { className: 'plugin-native-image', attrs: { draggable: 'false' } });
            el.addEventListener('click', () => fire(node, 'click'));
            break;
        case 'video':
            el = createElement('div', { className: 'plugin-native-video' });
            el.addEventListener('click', () => fire(node, 'click'));
            el.addEventListener('dblclick', () => fire(node, 'activate'));
            break;
        case 'canvas': {
            el = createElement('canvas', { className: 'plugin-native-canvas' });
            new ResizeObserver(() => { if (el.isConnected) draw(el, node); }).observe(el);
            const point = (event) => { const rect = el.getBoundingClientRect(); return { x: Math.round((event.clientX - rect.left) * 10) / 10, y: Math.round((event.clientY - rect.top) * 10) / 10, button: event.button, buttons: event.buttons }; };
            let pending = null;
            el.addEventListener('pointerdown', (event) => { if (node.pointer) { try { el.setPointerCapture(event.pointerId); } catch {} fire(node, 'pointerdown', point(event)); } });
            el.addEventListener('pointerup', (event) => { if (node.pointer) fire(node, 'pointerup', point(event)); });
            el.addEventListener('pointermove', (event) => {
                if (!node.pointer || (!event.buttons && !node.hover)) return;
                const first = !pending; pending = point(event);
                if (first) requestAnimationFrame(() => { const detail = pending; pending = null; fire(node, 'pointermove', detail); });
            });
            break;
        }
        case 'html':
            el = createElement('iframe', { className: 'plugin-native-html', attrs: { sandbox: '', referrerpolicy: 'no-referrer', title: node.alt || '' } });
            el.addEventListener('load', () => { el.dataset.loaded = '1'; });
            break;
        case 'separator': el = createElement('div', { className: 'plugin-native-separator' }); break;
        default: el = createElement('div', { className: 'plugin-native-spacer' }); break;
        }
        el.addEventListener('contextmenu', (event) => {
            if (!node.contextMenu || event.defaultPrevented) return;
            event.preventDefault(); event.stopPropagation();
            showNativeMenu(node.contextMenu, event.clientX, event.clientY, translate).then((choice) => { if (choice) fire(node, 'menu', { menuId: choice }); });
        });
        el.addEventListener('mouseenter', () => { if (node.hover) fire(node, 'hoverstart'); });
        el.addEventListener('mouseleave', () => { if (node.hover) fire(node, 'hoverend'); });
        elementNode.set(el, node);
        nodeElement.set(node, el);
        if (parent) parents.set(node, parent);
        if (node.id) { elements.set(node.id, el); nodes.set(node.id, node); }
        sync(el, node, null);
        (node.children || []).forEach((child) => el.appendChild(build(child, node)));
        if (node.transition && !mounting && motion()) enter(el, node);
        return el;
    }

    // Transitions. Arriving: the node plays its transition in. Leaving: it plays the same
    // transition backwards and is only then taken out — which needs somewhere to be in
    // the meantime, so it applies to layers of a zstack; anywhere else a node just goes.
    // A layer that is replaced while another one slides in over it stays underneath until
    // the newcomer has settled, the way a pushed page covers the one before it.
    function animate(el, node, reverse) {
        return el.animate(TRANSITIONS[node.transition], { id: 'host-transition', duration: TRANSITION_MS * motionScale(), easing: TRANSITION_EASING, fill: 'both', direction: reverse ? 'reverse' : 'normal' });
    }
    // An `html` node is a frame, and a frame paints nothing until its document has loaded.
    // A layer that arrives with one inside waits at its starting position for that (briefly
    // — never long enough to feel stuck), so it slides in with its content instead of
    // sliding in blank and filling in on the way.
    function framesReady(el) {
        const frames = [...(el.matches('iframe') ? [el] : []), ...el.querySelectorAll('iframe')].filter((frame) => frame.dataset.loaded !== '1');
        if (!frames.length) return null;
        return Promise.race([
            Promise.all(frames.map((frame) => new Promise((resolve) => frame.addEventListener('load', resolve, { once: true })))),
            new Promise((resolve) => setTimeout(resolve, 260))
        ]);
    }
    const arrivals = new WeakMap(); // element -> promise settled when its arrival is over
    function enter(el, node) {
        el.style.zIndex = '1';
        const animation = animate(el, node, false);
        const waiting = framesReady(el);
        if (waiting) { animation.pause(); waiting.then(() => { try { animation.play(); } catch { /* already cancelled */ } }); }
        arrivals.set(el, new Promise((resolve) => {
            const settle = () => { try { animation.cancel(); } catch { /* done */ } el.style.removeProperty('z-index'); resolve(); };
            animation.onfinish = settle; animation.oncancel = () => { el.style.removeProperty('z-index'); resolve(); };
        }));
    }
    function discard(el) {
        if (el.matches('.plugin-native-video')) detachMedia(el);
        el.querySelectorAll('.plugin-native-video').forEach((video) => detachMedia(video));
        el.remove();
    }
    // covered: a promise for the arrival of the layer that replaces this one, if any.
    function leave(node, el, parent, covered = null) {
        const animated = Boolean(el?.isConnected) && parent?.type === 'zstack' && motion() && (Boolean(covered) || Boolean(node.transition));
        forget(node, animated);
        if (!animated) { el?.remove(); return; }
        // Leaving layers sit after the live ones, so child positions keep matching the tree.
        if (el.nextElementSibling) el.parentNode.appendChild(el);
        el.classList.add('plugin-native-leaving');
        el.inert = true;
        if (!node.transition) { Promise.race([covered, new Promise((resolve) => setTimeout(resolve, TRANSITION_MS * motionScale() + 400))]).then(() => discard(el)); return; }
        el.style.zIndex = '2';
        const animation = animate(el, node, true);
        animation.onfinish = animation.oncancel = () => discard(el);
    }

    function forget(node, keepMedia = false) {
        // The media player leaves a video node before the node leaves the document (or,
        // for a node that animates out, when that animation is over).
        if (node.type === 'video' && !keepMedia) detachMedia(nodeElement.get(node));
        if (node.id && nodes.get(node.id) === node) { nodes.delete(node.id); elements.delete(node.id); }
        (node.children || []).forEach((child) => forget(child, keepMedia));
    }
    function requireNode(id) {
        const key = String(id ?? '');
        const node = nodes.get(key);
        const el = elements.get(key);
        if (!node || !el) throw new Error(`Native UI: unknown id "${key}"`);
        return { node, el };
    }
    function normalizeIncoming(raw, budget) {
        const node = normalizeNode(raw, ctx(Math.max(0, budget)), 0);
        if (!node) throw new Error('Native UI: invalid node description');
        return node;
    }
    const budgetWithout = (node) => maxNodes - (countNodes(root) - countNodes(node));

    function setFields(node, next) {
        const changed = [];
        for (const key of new Set([...Object.keys(node), ...Object.keys(next)])) {
            if (key === 'children' || key === 'anchor') continue;
            if (JSON.stringify(node[key]) !== JSON.stringify(next[key])) changed.push(key);
        }
        for (const key of Object.keys(node)) if (key !== 'children' && key !== 'anchor') delete node[key];
        Object.assign(node, next);
        return changed;
    }

    // Declarative update: make the existing tree match `next`, touching only what differs.
    // Children are matched by id, or by position and type when they have none, so
    // focused inputs, scroll positions and media keep their state across updates.
    function reconcile(node, el, next) {
        const nextChildren = next.children;
        const fields = { ...next }; delete fields.children;
        // What the user opened in an outline, or folded in a sectioned list, stays that way
        // unless the application says otherwise.
        if (node.type === 'list') for (const key of ['expanded', 'collapsed']) if (fields[key] === undefined && node[key]) fields[key] = node[key];
        // Events reach the app asynchronously, so its idea of a field's text can be a
        // keystroke behind. The control the user is typing in keeps its own value.
        if ((node.type === 'input' || node.type === 'textarea') && el === document.activeElement) fields.value = node.value;
        const changed = setFields(node, fields);
        if (changed.length) sync(el, node, changed);
        if (!CONTAINER_TYPES.has(node.type)) return;
        const oldChildren = node.children || [];
        const oldElements = new Map(oldChildren.map((child) => [child, nodeElement.get(child)]));
        const byId = new Map(oldChildren.filter((child) => child.id).map((child) => [child.id, child]));
        const unkeyed = oldChildren.filter((child) => !child.id);
        const used = new Set();
        const result = [];
        for (const incoming of nextChildren || []) {
            let match = incoming.id ? byId.get(incoming.id) : unkeyed.find((child) => !used.has(child) && child.type === incoming.type);
            if (match && (match.type !== incoming.type || used.has(match))) match = null;
            if (match) {
                used.add(match);
                reconcile(match, oldElements.get(match), incoming);
                result.push([match, oldElements.get(match)]);
            } else result.push([incoming, build(incoming, node)]);
        }
        const arriving = result.filter(([child, childEl]) => !oldChildren.includes(child) && arrivals.has(childEl)).map(([, childEl]) => arrivals.get(childEl));
        const covered = arriving.length ? Promise.all(arriving) : null;
        for (const child of oldChildren) if (!used.has(child)) leave(child, oldElements.get(child), node, covered);
        node.children = result.map(([child]) => child);
        result.forEach(([, childEl], index) => { if (el.children[index] !== childEl) el.insertBefore(childEl, el.children[index] || null); });
    }

    function mount(nextTree) {
        detachMedia(null);
        elements.clear(); nodes.clear();
        root = nextTree;
        // A root that sets its own padding owns the whole content area edge to edge.
        frame.classList.toggle('plugin-native-app-frame-flush', root.padding !== undefined);
        mounting = true;
        try { frame.replaceChildren(build(root)); } finally { mounting = false; }
    }

    // dismissable: a popover. A press anywhere else in the window reports `dismiss`, with
    // the id of what was pressed (so the app can tell its own toggle button apart).
    const dismissables = new Set();
    const pressOutside = (event) => {
        for (const el of dismissables) {
            const node = elementNode.get(el);
            if (!el.isConnected || !node?.dismissable || !node.id || nodes.get(node.id) !== node) { dismissables.delete(el); continue; }
            if (!el.contains(event.target)) fire(node, 'dismiss', { targetId: event.target.closest?.('[data-native-id]')?.dataset.nativeId || '' });
        }
    };
    (frame.closest('.plugin-app-window') || frame).addEventListener('pointerdown', pressOutside, true);

    const api = {
        valueOf,
        patch(id, props = {}) {
            const { node, el } = requireNode(id);
            if (!props || typeof props !== 'object') return false;
            const merged = { ...node };
            for (const [key, value] of Object.entries(props)) {
                if (key === 'type' || key === 'id' || key === 'children') continue;
                if (value === null) delete merged[key]; else merged[key] = value;
            }
            delete merged.children;
            const next = normalizeFields(merged, ctx());
            if (!next) return false;
            const changed = setFields(node, next);
            // An explicit value/checked always wins, even when it equals what the app last set.
            for (const key of ['value', 'checked', 'values', 'commands']) if (key in props && !changed.includes(key)) changed.push(key);
            sync(el, node, changed);
            return true;
        },
        replace(id, raw) {
            const { node, el } = requireNode(id);
            const next = normalizeIncoming(raw, budgetWithout(node));
            const parent = parents.get(node);
            if (!parent) { forget(node); mount(next); return true; }
            parent.children[parent.children.indexOf(node)] = next;
            const built = build(next, parent);
            el.before(built);
            leave(node, el, parent, arrivals.get(built) || null);
            return true;
        },
        append(parentId, raw, index = null) {
            const { node, el } = requireNode(parentId);
            if (!CONTAINER_TYPES.has(node.type)) throw new Error('Native UI: only containers can have children');
            const next = normalizeIncoming(raw, maxNodes - countNodes(root));
            const at = Number.isInteger(index) ? Math.max(0, Math.min(node.children.length, index)) : node.children.length;
            // Before the child now at that position, or before any layer that is on its way out.
            const before = (node.children[at] && nodeElement.get(node.children[at])) || el.querySelector(':scope > .plugin-native-leaving');
            node.children.splice(at, 0, next);
            el.insertBefore(build(next, node), before);
            return true;
        },
        setChildren(parentId, list) {
            const { node, el } = requireNode(parentId);
            if (!CONTAINER_TYPES.has(node.type)) throw new Error('Native UI: only containers can have children');
            let budget = maxNodes - (countNodes(root) - (countNodes(node) - 1));
            const children = (Array.isArray(list) ? list : []).map((raw) => { const child = normalizeIncoming(raw, budget); budget -= countNodes(child); return child; });
            reconcile(node, el, { ...node, children });
            return true;
        },
        remove(id) {
            const { node, el } = requireNode(id);
            const parent = parents.get(node);
            if (!parent) throw new Error('Native UI: the root node cannot be removed');
            parent.children.splice(parent.children.indexOf(node), 1);
            leave(node, el, parent);
            return true;
        },
        // Whole-tree declarative update (diffed against what is on screen).
        render(raw) {
            const next = normalizeIncoming(raw, maxNodes);
            if (!root || root.type !== next.type || (root.id || '') !== (next.id || '')) mount(next);
            else {
                reconcile(root, frame.firstElementChild, next);
                frame.classList.toggle('plugin-native-app-frame-flush', root.padding !== undefined);
            }
            return true;
        },
        defineStyles(map) {
            Object.assign(styleTable, cleanStyles(map));
            return true;
        },
        // Text controls: put the selection somewhere, or type over it (undo keeps working).
        setSelection(id, { start = 0, end = start, direction = 'none', reveal = true } = {}) {
            const { input } = textControl(id);
            const length = input.value.length;
            const from = Math.max(0, Math.min(length, Math.round(Number(start) || 0)));
            const to = Math.max(from, Math.min(length, Math.round(Number(end) || 0)));
            if (reveal) { input.blur(); input.focus({ preventScroll: false }); }
            input.setSelectionRange(from, to, ['forward', 'backward'].includes(direction) ? direction : 'none');
            // A textarea scrolls its caret into view when it is focused with the range in place.
            if (reveal && input.tagName === 'TEXTAREA') { input.blur(); input.focus(); }
            return valueOf(id);
        },
        replaceSelection(id, text, { select = 'end' } = {}) {
            const { node, input } = textControl(id);
            const insert = String(text ?? '').slice(0, 500000);
            const start = input.selectionStart;
            input.focus({ preventScroll: true });
            // insertText goes through the browser's editing, so the user can undo it.
            let done = false;
            try { done = document.execCommand('insertText', false, insert); } catch { done = false; }
            if (!done) { input.setRangeText(insert, input.selectionStart, input.selectionEnd, 'end'); node.value = input.value; fire(node, 'input'); }
            if (select === 'all') input.setSelectionRange(start, start + insert.length);
            else if (select === 'start') input.setSelectionRange(start, start);
            node.value = input.value;
            return valueOf(id);
        },
        focus(id) {
            const { el } = requireNode(id);
            (control(el) || el).focus({ preventScroll: true });
            return true;
        },
        scrollTo(id, { top = null, itemId = null } = {}) {
            const { node, el } = requireNode(id);
            if (itemId != null && virtual.get(el)) { const index = rowsOf(node).findIndex((row) => row.id === String(itemId)); if (index >= 0) virtual.get(el).reveal(index); }
            else if (Number.isFinite(Number(top))) el.scrollTop = Number(top);
            return true;
        },
        // Language or appearance changed: re-resolve translated strings and theme-dependent
        // surfaces without touching what the user typed.
        refresh() {
            frame.querySelectorAll('*').forEach((el) => {
                const node = elementNode.get(el);
                if (!node) return;
                if (node.type === 'html') el.srcdoc = htmlDocument(node);
                else if (node.type === 'canvas') draw(el, node);
                else sync(el, node, TRANSLATED_KEYS);
            });
        },
        // Developer Tools: the live tree (read-only for the caller) and the element of a node.
        tree: () => root,
        elementFor: (node) => nodeElement.get(node) || null,
        nodeCount: () => countNodes(root),
        nodeLimit: () => maxNodes,
        /** A press landed inside an `html` node's frame, whose pointer events the page never sees. */
        pressedInside(el) { pressOutside({ target: el }); },
        /** True for bare layout surfaces (not controls): places a window can be dragged by. */
        isBackground(el) {
            // The nearest element that is a node: a video node's player, a button's glyph
            // and the like are parts of their node.
            let owner = el;
            while (owner && owner !== frame && !elementNode.has(owner)) owner = owner.parentElement;
            const node = owner && elementNode.get(owner);
            if (!node) return owner === frame;
            return BACKGROUND_TYPES.has(node.type) || (node.type === 'text' && !node.id && !node.selectable) || (node.type === 'image' && !node.id);
        },
        idForElement(el) {
            return el?.closest?.('[data-native-id]')?.dataset.nativeId || '';
        },
        itemIdForElement(el) {
            return el?.closest?.('[data-item-id]')?.dataset.itemId || '';
        },
        /** Files dragged in from outside: shows where they would land on a dropTarget list. */
        dropHint: (clientX, clientY) => lists.dropHint(clientX, clientY),
        clearDropHint: () => lists.clearDropHint()
    };

    mount(tree);
    return api;
}
