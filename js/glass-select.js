import { $, createElement } from './utils.js';

let activeGlassAnchor = null;
// Pressing a selector whose menu is open closes the menu — on the press itself, as any
// press outside a menu does. The click that completes that press must not open it again,
// so the press is remembered here before anything has closed the menu.
let pressedOpenAnchor = { anchor: null, at: 0 };
document.addEventListener('pointerdown', (event) => {
    const dropdown = $('global-select-dropdown');
    if (activeGlassAnchor && dropdown && !dropdown.classList.contains('hidden') && activeGlassAnchor.contains(event.target)) pressedOpenAnchor = { anchor: activeGlassAnchor, at: performance.now() };
}, true);

function optionRecords(select) {
    return [...select.options].map((option) => ({
        value: option.value,
        label: option.textContent || option.label || option.value,
        disabled: option.disabled
    }));
}

export function closeGlassSelectMenu() {
    $('global-select-dropdown')?.classList.add('hidden');
    activeGlassAnchor = null;
}

export function openGlassMenu(anchor, options, currentValue, onSelect) {
    const dropdown = $('global-select-dropdown');
    if (!dropdown || !anchor) return false;
    // A second click on the same selector is a close gesture, not an immediate reopen.
    if (!dropdown.classList.contains('hidden') && activeGlassAnchor === anchor) {
        closeGlassSelectMenu();
        return false;
    }
    if (pressedOpenAnchor.anchor === anchor && performance.now() - pressedOpenAnchor.at < 800) { pressedOpenAnchor = { anchor: null, at: 0 }; closeGlassSelectMenu(); return false; }
    activeGlassAnchor = anchor;
    dropdown.replaceChildren();

    options.forEach((option) => {
        const item = createElement('div', {
            className: `menu-item glass-select-option${option.value === currentValue ? ' selected' : ''}${option.disabled ? ' disabled' : ''}`,
            text: option.label
        });
        if (!option.disabled) {
            item.addEventListener('click', async (event) => {
                event.stopPropagation();
                closeGlassSelectMenu();
                await onSelect?.(option.value, option);
            });
        }
        dropdown.appendChild(item);
    });

    const rect = anchor.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.width = `${Math.max(rect.width, 130)}px`;
    dropdown.style.zIndex = '1200000';
    dropdown.classList.remove('hidden');
    return true;
}

function syncNativeSelectProxy(select) {
    const proxy = select._glassSelectProxy;
    if (!proxy) return;
    const selected = select.selectedOptions?.[0] || select.options?.[select.selectedIndex] || select.options?.[0];
    const text = proxy.querySelector('.selected-text');
    if (text) text.textContent = selected?.textContent || selected?.label || '';
    proxy.dataset.value = select.value || '';
    proxy.classList.toggle('disabled', Boolean(select.disabled));
    proxy.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
}

export function upgradeNativeSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return null;
    if (select._glassSelectProxy?.isConnected) {
        syncNativeSelectProxy(select);
        return select._glassSelectProxy;
    }

    select.classList.add('glass-select-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const proxy = createElement('div', {
        className: 'mac-custom-select widget-glass-select',
        attrs: { role: 'button', tabindex: '0' }
    });
    proxy.append(
        createElement('span', { className: 'selected-text' }),
        createElement('span', { className: 'select-chevron', text: '▾' })
    );
    select.after(proxy);
    select._glassSelectProxy = proxy;

    const open = (event) => {
        event?.stopPropagation();
        if (select.disabled) return;
        openGlassMenu(proxy, optionRecords(select), select.value, async (value) => {
            if (select.value === value) return;
            select.value = value;
            syncNativeSelectProxy(select);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
    };
    proxy.addEventListener('click', open);
    proxy.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open(event);
        }
    });
    select.addEventListener('change', () => syncNativeSelectProxy(select));

    const observer = new MutationObserver(() => syncNativeSelectProxy(select));
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    select._glassSelectObserver = observer;
    syncNativeSelectProxy(select);
    return proxy;
}

export function upgradeNativeSelects(root = document) {
    if (!root) return;
    root.querySelectorAll('select.mac-input, select.widget-manager-weather-location').forEach(upgradeNativeSelect);
}

export function syncNativeGlassSelects(root = document) {
    if (!root) return;
    root.querySelectorAll('select.glass-select-source').forEach(syncNativeSelectProxy);
}
