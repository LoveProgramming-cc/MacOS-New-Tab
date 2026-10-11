import { createElement } from './utils.js';

// Small DOM primitives shared by Settings and the first-generation plugin manager.
// They deliberately return plain DOM nodes and use the existing CSS design tokens,
// so future features do not need to reimplement the same macOS controls.
export const UI_TOKENS = Object.freeze({
    glassClass: 'mac-acrylic',
    windowClass: 'window',
    cardClass: 'mac-card',
    buttonClass: 'mac-btn',
    switchClass: 'mac-switch',
    checkboxClass: 'mac-checkbox'
});

export function createButton(label, { primary = false, danger = false, className = '', onClick = null, type = 'button' } = {}) {
    const button = createElement('button', {
        className: `${UI_TOKENS.buttonClass}${primary ? ' blue' : ''}${danger ? ' danger' : ''}${className ? ` ${className}` : ''}`,
        text: label,
        attrs: { type }
    });
    if (onClick) button.addEventListener('click', onClick);
    return button;
}

export function createSwitch({ checked = false, disabled = false, ariaLabel = '' } = {}) {
    const label = createElement('label', { className: UI_TOKENS.switchClass });
    const input = createElement('input', { attrs: { type: 'checkbox', 'aria-label': ariaLabel || undefined } });
    input.checked = checked;
    input.disabled = disabled;
    label.append(input, createElement('span', { className: 'slider' }));
    return { root: label, input };
}

export function createCheckbox(labelText, { checked = false, disabled = false } = {}) {
    const label = createElement('label', { className: 'mac-checkbox-row' });
    const input = createElement('input', { className: UI_TOKENS.checkboxClass, attrs: { type: 'checkbox' } });
    input.checked = checked;
    input.disabled = disabled;
    label.append(input, createElement('span', { text: labelText }));
    return { root: label, input };
}

export function createSlider({ min = 0, max = 100, step = 1, value = 0, ariaLabel = '' } = {}) {
    return createElement('input', { attrs: { type: 'range', min, max, step, value, 'aria-label': ariaLabel || undefined } });
}

export function createGlassSurface(className = '') {
    return createElement('div', { className: `${UI_TOKENS.glassClass}${className ? ` ${className}` : ''}` });
}

export function createStack({ className = '', gap = 8, horizontal = false } = {}) {
    const stack = createElement('div', { className });
    stack.style.display = 'flex';
    stack.style.flexDirection = horizontal ? 'row' : 'column';
    stack.style.gap = `${gap}px`;
    return stack;
}

export function createWindowShell(title, { className = '' } = {}) {
    const root = createElement('div', { className: `${UI_TOKENS.windowClass} ${UI_TOKENS.glassClass}${className ? ` ${className}` : ''}` });
    const header = createElement('div', { className: 'ui-kit-window-header' });
    const controls = createElement('div', { className: 'window-controls' });
    ['close', 'minimize', 'maximize'].forEach((name) => controls.appendChild(createElement('div', { className: `btn ${name}` })));
    header.append(controls, createElement('strong', { text: title }));
    const body = createElement('div', { className: 'ui-kit-window-body' });
    root.append(header, body);
    return { root, header, body };
}
