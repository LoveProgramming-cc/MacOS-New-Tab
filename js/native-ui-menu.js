// Native UI: context menus and pop-up menus.

import { createElement } from './utils.js';
import { cleanMenu } from './native-ui-schema.js';

let openMenu = null;
// The control whose menu was just closed by a press on that control (see `anchor` below).
let menuClosedBy = { anchor: null, at: 0 };
/** True when `anchor`'s own menu was closed by the press this click belongs to: the click must not open it again. */
export function menuJustClosedBy(anchor) {
    const hit = menuClosedBy.anchor === anchor && performance.now() - menuClosedBy.at < 500;
    if (hit) menuClosedBy = { anchor: null, at: 0 };
    return hit;
}
function closeNativeMenu(result = null) {
    if (!openMenu) return;
    const { el, resolve, cleanup, children } = openMenu;
    openMenu = null;
    cleanup();
    for (const child of children) child.remove();
    el.remove();
    resolve(result);
}
// `above`: { centerX, top } — instead of opening at the pointer, the menu sits centred above
// that line (the Dock's menus), so it never covers, or hides behind, what was clicked.
export function showNativeMenu(items, x, y, translate = (_key, fallback) => fallback, options = {}) {
    const list = cleanMenu(items);
    return list ? presentMenu(list, x, y, translate, options) : Promise.resolve(null);
}
// The menu itself, for an already validated list of { id, label, labelKey, checked, danger, disabled } | { separator }.
// `anchor` is the control the menu belongs to: pressing it while the menu is open closes the menu.
export function presentMenu(list, x, y, translate, { above = null, onClose = null, minWidth = 0, anchor = null } = {}) {
    closeNativeMenu(null);
    return new Promise((resolve) => {
        const children = [];          // open submenus, outermost first
        const closeFrom = (level) => { for (const child of children.splice(level)) { child.remove(); child.owner?.classList.remove('open'); } };
        const place = (el, left, top) => {
            const rect = el.getBoundingClientRect();
            el.style.left = `${Math.max(6, Math.min(left, innerWidth - rect.width - 6))}px`;
            el.style.top = `${Math.max(28, Math.min(top, innerHeight - rect.height - 6))}px`;
        };
        const build = (items, level) => {
            const el = createElement('div', { className: 'plugin-context-menu mac-acrylic window-shadow', attrs: { role: 'menu' } });
            for (const item of items) {
                if (item.separator) { el.appendChild(createElement('div', { className: 'plugin-context-separator' })); continue; }
                const row = createElement('button', { className: `plugin-context-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}${item.submenu ? ' has-submenu' : ''}`, attrs: { type: 'button', role: 'menuitem' } });
                row.appendChild(createElement('span', { text: translate(item.labelKey, item.label) }));
                row.disabled = Boolean(item.disabled);
                if (item.submenu) {
                    // Beside its entry: to the right, or to the left when there is no room.
                    const open = () => {
                        if (row.classList.contains('open') || row.disabled) return;
                        closeFrom(level);
                        const sub = build(item.submenu, level + 1);
                        sub.owner = row; row.classList.add('open');
                        document.body.appendChild(sub);
                        children.push(sub);
                        const box = row.getBoundingClientRect(); const width = sub.getBoundingClientRect().width;
                        place(sub, box.right + width + 2 > innerWidth ? box.left - width + 2 : box.right - 2, box.top - 5);
                    };
                    row.addEventListener('pointerenter', open);
                    row.addEventListener('click', (event) => { event.stopPropagation(); open(); });
                } else {
                    row.addEventListener('pointerenter', () => closeFrom(level));
                    row.addEventListener('click', (event) => { event.stopPropagation(); closeNativeMenu(item.id); });
                }
                el.appendChild(row);
            }
            if (items.some((item) => item.checked)) el.classList.add('has-check');
            return el;
        };
        const el = build(list, 0);
        if (minWidth) el.style.minWidth = `${Math.min(420, Math.round(minWidth))}px`;
        document.body.appendChild(el);
        const rect = el.getBoundingClientRect();
        if (above) { el.classList.add('plugin-context-menu-above'); x = above.centerX - rect.width / 2; y = above.top - rect.height; }
        place(el, x, y);
        const outside = (event) => {
            if (el.contains(event.target) || children.some((child) => child.contains(event.target))) return;
            if (anchor?.contains(event.target)) menuClosedBy = { anchor, at: performance.now() };
            closeNativeMenu(null);
        };
        const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeNativeMenu(null); } };
        const dismiss = () => closeNativeMenu(null);
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', key, true);
        window.addEventListener('blur', dismiss);
        window.addEventListener('resize', dismiss);
        const cleanup = () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', key, true);
            window.removeEventListener('blur', dismiss);
            window.removeEventListener('resize', dismiss);
            try { onClose?.(); } catch { /* no-op */ }
        };
        openMenu = { el, resolve, cleanup, children };
    });
}
