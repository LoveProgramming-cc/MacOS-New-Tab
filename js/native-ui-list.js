// Lists and tables of the native UI: virtualised rows, selection, outlines (rows with
// children), sections with a pinned title, and dragging rows — within a list, onto
// another list, or into the gap between two rows. Part of the renderer in
// plugin-native-ui.js, which supplies what is shared with the other controls.

import { createElement } from './utils.js';
import { showNativeMenu } from './native-ui-menu.js';

const OVERSCAN = 6;

export function createListSupport({ frame, elementNode, fire, translate, setImage, setMask, sync }) {
    const virtual = new WeakMap(); // list/table element -> virtual row controller
    const rowsOf = (node) => (node.type === 'table' ? node.rows || [] : listLayout(node).rows);
    function selectionOf(node) {
        if (node.multiple) return node.values || [];
        return node.value ? [node.value] : [];
    }

    // ---- outlines and sections
    // A list is drawn from a flat run of rows. Nested items (`children`) and `sections` are
    // flattened into that run here: only what is open is in it, each row knowing its depth,
    // its parent and its section.
    const layouts = new WeakMap(); // list node -> { rows, subtitle, structured, headers }
    function listLayout(node) {
        let layout = layouts.get(node);
        if (layout) return layout;
        const items = node.items || [];
        const hasSubtitle = (list) => list.some((item) => item.subtitle || (item.children && hasSubtitle(item.children)));
        const nested = (list) => list.some((item) => item.children || item.expandable);
        const sections = node.sections;
        if (!sections && !nested(items)) layout = { rows: items, subtitle: items.some((item) => item.subtitle), structured: false, headers: [] };
        else {
            const rows = []; const headers = [];
            const open = new Set(node.expanded || []); const shut = new Set(node.collapsed || []);
            const walk = (list, depth, parentId, sectionId, outline) => {
                for (const item of list) {
                    const branch = Boolean(item.children || item.expandable);
                    const expanded = branch && open.has(item.id);
                    const row = { ...item, indent: depth + (item.indent || 0), parentId, sectionId, outline };
                    delete row.children;
                    if (branch) { row.branch = true; row.disclosure = expanded ? 'open' : 'closed'; }
                    rows.push(row);
                    if (expanded && item.children) walk(item.children, depth + 1, item.id, sectionId, outline);
                }
            };
            if (sections) {
                for (const section of sections) {
                    const collapsed = Boolean(section.collapsible) && shut.has(section.id);
                    headers.push(rows.length);
                    rows.push({ id: section.id, header: true, section: true, title: section.title, titleKey: section.titleKey, detail: section.detail, collapsible: section.collapsible, collapsed });
                    if (!collapsed) walk(section.items, 0, '', section.id, nested(section.items));
                }
            } else walk(items, 0, '', '', true);
            layout = { rows, headers, structured: true, subtitle: sections ? sections.some((section) => hasSubtitle(section.items)) : hasSubtitle(items) };
        }
        layouts.set(node, layout);
        return layout;
    }
    function toggleListState(el, node, key, id, on) {
        const ids = new Set(node[key] || []);
        if (on) ids.add(id); else ids.delete(id);
        node[key] = [...ids];
        layouts.delete(node);
        virtual.get(el)?.refresh(true);
        return node[key];
    }
    function toggleBranch(el, node, id, open) {
        const row = rowsOf(node).find((entry) => entry.id === id);
        if (!row?.branch) return false;
        const next = open ?? row.disclosure !== 'open';
        if (next === (row.disclosure === 'open')) return false;
        const expandedIds = toggleListState(el, node, 'expanded', id, next);
        // What was selected inside a branch that closes is no longer on screen.
        if (!next) {
            const visible = new Set(rowsOf(node).map((entry) => entry.id));
            if (node.multiple) node.values = (node.values || []).filter((value) => visible.has(value));
            else if (node.value && !visible.has(node.value)) node.value = id;
            virtual.get(el)?.paintSelection();
        }
        fire(node, 'expand', { itemId: id, expanded: next, expandedIds: [...expandedIds] });
        return true;
    }
    function toggleSection(el, node, id) {
        const header = rowsOf(node).find((entry) => entry.section && entry.id === id);
        if (!header?.collapsible) return;
        const collapsedIds = toggleListState(el, node, 'collapsed', id, !header.collapsed);
        // Folded from its pinned title: the list comes back to where that section now ends.
        const top = rowsOf(node).findIndex((entry) => entry.section && entry.id === id) * rowHeightOf(node);
        if (!header.collapsed && el.scrollTop > top) el.scrollTop = top;
        fire(node, 'section', { sectionId: id, collapsed: !header.collapsed, collapsedIds: [...collapsedIds] });
    }

    // ---- where a drag would land
    // A dropTarget list takes drops on its rows; with dropPosition 'between' or 'both' also
    // in the gaps between them, shown as an insertion line. `source` is the rows being
    // dragged ({ node, ids }) or null for files coming from outside the application.
    const dropMarker = createElement('div', { className: 'plugin-native-drop-marker' });
    let shownDrop = null;
    function locateDrop(clientX, clientY, source = null) {
        const hit = document.elementFromPoint(clientX, clientY);
        const listEl = hit?.closest?.('.plugin-native-list,.plugin-native-table');
        const target = listEl && frame.contains(listEl) ? elementNode.get(listEl) : null;
        if (!target?.dropTarget) return null;
        const rows = rowsOf(target); const height = rowHeightOf(target);
        const mode = target.dropPosition || 'on';
        const own = (row) => Boolean(source && source.node === target && source.ids.includes(row.id));
        const found = (row, index, position) => ({ node: target, el: listEl, itemId: row.header ? '' : row.id, position, row: index,
            index: position === 'after' ? index + 1 : index, parentId: position === 'on' ? (row.header ? '' : row.id) : row.parentId || '',
            sectionId: row.section ? row.id : row.sectionId || '', indent: position === 'on' ? 0 : row.indent || 0 });
        if (mode === 'on') {
            const rowEl = hit.closest('[data-item-id]');
            const index = rowEl ? rows.findIndex((row) => row.id === rowEl.dataset.itemId && !row.header) : -1;
            const row = rows[index];
            return row && row.drop !== false && !own(row) ? found(row, index, 'on') : null;
        }
        if (!rows.length) return { node: target, el: listEl, itemId: '', position: 'after', row: -1, index: 0, parentId: '', sectionId: '', indent: 0 };
        const offset = clientY - virtual.get(listEl).sizer.getBoundingClientRect().top;
        const index = Math.max(0, Math.min(rows.length - 1, Math.floor(offset / height)));
        const row = rows[index];
        const part = offset >= rows.length * height ? 1 : (offset - index * height) / height;
        if (row.header) return row.section ? found(row, index, 'on') : null;
        if (own(row)) return null;
        const onRow = mode === 'both' && part >= .25 && part <= .75 && row.drop !== false && !row.disabled;
        const position = onRow ? 'on' : part < .5 ? 'before' : 'after';
        // Just under an open row with children is the place before its first child.
        const child = rows[index + 1];
        if (position === 'after' && child?.parentId === row.id) return own(child) ? null : found(child, index + 1, 'before');
        return found(row, index, position);
    }
    function clearDrop() {
        shownDrop?.rowEl?.classList.remove('drop-hover');
        dropMarker.remove();
        shownDrop = null;
    }
    function showDrop(drop) {
        if (shownDrop && drop && shownDrop.node === drop.node && shownDrop.row === drop.row && shownDrop.position === drop.position && (drop.position === 'on' ? shownDrop.rowEl?.isConnected : dropMarker.isConnected)) return;
        clearDrop();
        if (!drop) return;
        shownDrop = drop;
        const sizer = virtual.get(drop.el).sizer;
        if (drop.position === 'on') {
            const row = rowsOf(drop.node)[drop.row];
            drop.rowEl = [...sizer.children].find((child) => (row.header ? child.dataset.sectionId : child.dataset.itemId) === row.id) || null;
            drop.rowEl?.classList.add('drop-hover');
        } else {
            dropMarker.style.top = `${drop.index * rowHeightOf(drop.node) - 1}px`;
            dropMarker.style.insetInlineStart = `${6 + drop.indent * 18}px`;
            sizer.appendChild(dropMarker);
        }
    }
    const dropDetail = (drop) => ({ itemId: drop.itemId, position: drop.position, index: drop.index, parentId: drop.parentId, sectionId: drop.sectionId });

    // ---- virtualised rows shared by list and table
    function rowHeightOf(node) {
        if (node.rowHeight) return node.rowHeight;
        if (node.type === 'table') return 28;
        return listLayout(node).subtitle ? 46 : 32;
    }
    function buildListRow(node, item, selected) {
        if (item.header) {
            const header = createElement('div', { className: `plugin-native-list-header${item.collapsible ? ' collapsible' : ''}` });
            if (item.section) header.dataset.sectionId = item.id;
            if (item.collapsible) header.appendChild(createElement('span', { className: `plugin-native-list-disclosure ${item.collapsed ? 'closed' : 'open'}`, text: '›' }));
            header.appendChild(createElement('span', { className: 'plugin-native-list-header-title', text: translate(item.titleKey, item.title) }));
            if (item.detail) header.appendChild(createElement('span', { className: 'plugin-native-list-header-detail', text: item.detail }));
            return header;
        }
        const row = createElement('div', { className: `plugin-native-list-row${selected ? ' selected' : ''}${item.disabled ? ' disabled' : ''}${item.emphasis ? ' emphasis' : ''}`, attrs: { role: 'option', 'aria-selected': selected ? 'true' : 'false' }, dataset: { itemId: item.id } });
        if (item.indent) row.style.paddingInlineStart = `${10 + item.indent * 18}px`;
        if (item.branch) row.setAttribute('aria-expanded', item.disclosure === 'open' ? 'true' : 'false');
        if (item.disclosure) row.appendChild(createElement('span', { className: `plugin-native-list-disclosure ${item.disclosure}`, text: '›' }));
        // In an outline, rows without a chevron keep its place so titles line up.
        else if (item.outline) row.appendChild(createElement('span', { className: 'plugin-native-list-disclosure spacer' }));
        if (item.icon) {
            const img = createElement(item.tint ? 'span' : 'img', { className: `plugin-native-list-icon${item.tint ? ' tinted' : ''}`, attrs: item.tint ? {} : { alt: '' } });
            if (node.iconSize) { img.style.width = img.style.height = `${node.iconSize}px`; }
            if (item.tint) setMask(img, item.icon); else setImage(img, item.icon);
            row.appendChild(img);
        }
        const body = createElement('div', { className: 'plugin-native-list-body' });
        body.appendChild(createElement('div', { className: 'plugin-native-list-title', text: translate(item.titleKey, item.title) }));
        if (item.subtitle) body.appendChild(createElement('div', { className: 'plugin-native-list-subtitle', text: item.subtitle }));
        row.appendChild(body);
        if (item.detail) row.appendChild(createElement('span', { className: 'plugin-native-list-detail', text: item.detail }));
        if (item.badge) row.appendChild(createElement('span', { className: 'plugin-native-list-badge', text: item.badge }));
        return row;
    }
    function tableTemplate(node) {
        return (node.columns || []).map((column) => column.width).join(' ') || 'minmax(0, 1fr)';
    }
    function buildTableRow(node, row, selected) {
        const el = createElement('div', { className: `plugin-native-table-row${selected ? ' selected' : ''}${row.disabled ? ' disabled' : ''}${row.emphasis ? ' emphasis' : ''}`, attrs: { role: 'row', 'aria-selected': selected ? 'true' : 'false' }, dataset: { itemId: row.id } });
        el.style.gridTemplateColumns = tableTemplate(node);
        (node.columns || []).forEach((column, index) => {
            const cell = createElement('div', { className: `plugin-native-table-cell${column.muted ? ' muted' : ''}`, attrs: { role: 'cell' } });
            if (column.align) cell.style.textAlign = column.align;
            if (index === 0 && row.icon) { const img = createElement('img', { className: 'plugin-native-table-icon', attrs: { alt: '' } }); setImage(img, row.icon); cell.appendChild(img); }
            cell.appendChild(createElement('span', { text: row.cells[column.id] ?? '' }));
            el.appendChild(cell);
        });
        return el;
    }
    function createVirtualRows(el, node) {
        const sizer = createElement('div', { className: 'plugin-native-rows' });
        const empty = createElement('div', { className: 'plugin-native-list-empty' });
        let header = null;
        if (node.type === 'table') { header = createElement('div', { className: 'plugin-native-table-header', attrs: { role: 'row' } }); el.appendChild(header); }
        // The title of the section being read stays at the top of a sectioned list.
        const pin = createElement('div', { className: 'plugin-native-list-pin' });
        if (node.type === 'list') el.appendChild(pin);
        el.append(sizer, empty);
        let from = -1; let to = -1; let frameRequest = 0; let atEnd = false; let lastScrollEvent = 0; let pinned = '';
        const updatePin = (rows, height, top) => {
            const headers = node.type === 'list' && node.sections && node.stickyHeaders !== false ? listLayout(node).headers : [];
            let current = -1; let next = -1;
            for (const index of headers) { if (index * height <= top) current = index; else { next = index; break; } }
            // Nothing to pin while the header itself is still in place at the very top.
            if (current < 0 || top <= current * height) { if (pinned) { pin.replaceChildren(); pinned = ''; } return; }
            const header = rows[current];
            const key = `${header.id}\n${header.collapsed}\n${header.title}\n${header.detail || ''}\n${height}`;
            if (key !== pinned) {
                const copy = buildListRow(node, header, false);
                copy.classList.add('pinned'); copy.style.height = `${height}px`;
                pin.replaceChildren(copy); pinned = key;
            }
            pin.style.top = `${node.insetTop || 0}px`;
            // The next section's title pushes this one out.
            pin.firstElementChild.style.transform = next >= 0 && next * height - top < height ? `translateY(${Math.round(next * height - top - height)}px)` : '';
        };
        const controller = {
            header, sizer,
            // insetTop: room above the first row for a bar that floats over the list.
            headerHeight: () => (header && node.header !== false ? header.offsetHeight || 26 : 0) + (node.insetTop || 0),
            refresh(force = false) {
                const rows = rowsOf(node);
                const height = rowHeightOf(node);
                sizer.style.height = `${rows.length * height + (node.insetBottom || 0)}px`;
                sizer.style.marginTop = node.insetTop ? `${node.insetTop}px` : '';
                // A classic scroll bar starts below a bar floating over the list (and ends above
                // one at the bottom) instead of running underneath it.
                el.style.setProperty('--scroll-track-top', `${controller.headerHeight()}px`);
                el.style.setProperty('--scroll-track-bottom', `${node.insetBottom || 0}px`);
                el.classList.toggle('plugin-native-inset-scroll', Boolean(node.insetTop || node.insetBottom));
                empty.style.paddingTop = node.insetTop ? `${node.insetTop}px` : '';
                empty.hidden = rows.length > 0 || !node.placeholder;
                empty.textContent = translate(node.placeholderKey, node.placeholder ?? '');
                // Without an explicit size the control shows up to 12 rows and scrolls beyond that.
                if (node.height === undefined && node.grow === undefined) el.style.height = `${Math.min(rows.length, 12) * height + controller.headerHeight() + (rows.length ? 2 : 44)}px`;
                const viewport = el.clientHeight || 600;
                const top = Math.max(0, el.scrollTop - controller.headerHeight());
                if (force) pinned = '';
                updatePin(rows, height, el.scrollTop);
                const start = Math.max(0, Math.floor(top / height) - OVERSCAN);
                const end = Math.min(rows.length, Math.ceil((top + viewport) / height) + OVERSCAN);
                if (!force && start === from && end === to) return;
                from = start; to = end;
                const selected = new Set(selectionOf(node));
                const fragment = document.createDocumentFragment();
                for (let index = start; index < end; index += 1) {
                    const item = rows[index];
                    const row = node.type === 'table' ? buildTableRow(node, item, selected.has(item.id)) : buildListRow(node, item, selected.has(item.id));
                    row.style.top = `${index * height}px`;
                    row.style.height = `${height}px`;
                    if (node.striped && index % 2 === 1) row.classList.add('striped');
                    fragment.appendChild(row);
                }
                sizer.replaceChildren(fragment);
            },
            // Selection changes restyle the rows in place. Rebuilding them here would detach
            // the row under the pointer between the two clicks of a double click.
            paintSelection() {
                const selected = new Set(selectionOf(node));
                for (const row of sizer.children) {
                    if (!row.dataset.itemId) continue;
                    const on = selected.has(row.dataset.itemId);
                    row.classList.toggle('selected', on);
                    row.setAttribute('aria-selected', on ? 'true' : 'false');
                }
            },
            reveal(index) {
                const height = rowHeightOf(node);
                const top = index * height; const viewport = (el.clientHeight || 600) - controller.headerHeight();
                if (top < el.scrollTop) el.scrollTop = top;
                else if (top + height > el.scrollTop + viewport) el.scrollTop = top + height - viewport;
            }
        };
        el.addEventListener('scroll', () => {
            if (!frameRequest) frameRequest = requestAnimationFrame(() => { frameRequest = 0; controller.refresh(); });
            reportScroll(el, node, (value) => { atEnd = value; }, () => atEnd, () => lastScrollEvent, (value) => { lastScrollEvent = value; });
        }, { passive: true });
        new ResizeObserver(() => controller.refresh(true)).observe(el);
        return controller;
    }
    // Scroll areas under a floating bar draw their own scroll bar (.plugin-native-inset-scroll):
    // it shows while scrolling and fades once the scrolling stops, like the system's.
    const scrollFade = new WeakMap();
    function reportScroll(el, node, setAtEnd, getAtEnd, getLast, setLast) {
        if (!el.classList.contains('scrolling')) el.classList.add('scrolling');
        clearTimeout(scrollFade.get(el));
        scrollFade.set(el, setTimeout(() => el.classList.remove('scrolling'), 900));
        const nearEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
        if (nearEnd && !getAtEnd()) fire(node, 'reachend');
        setAtEnd(nearEnd);
        if (!node.scrollEvents) return;
        const now = performance.now();
        if (now - getLast() < 120) return;
        setLast(now);
        fire(node, 'scroll', { scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atEnd: nearEnd });
    }

    function selectRow(el, node, id, event = {}) {
        const rows = rowsOf(node);
        const ids = rows.map((row) => row.id);
        const hit = rows.find((row) => row.id === id);
        if (!hit || hit.disabled || hit.header) return false;
        if (node.multiple) {
            let values = [...(node.values || [])];
            if (event.shiftKey && node.anchor && ids.includes(node.anchor)) {
                const [a, b] = [ids.indexOf(node.anchor), ids.indexOf(id)].sort((x, y) => x - y);
                values = ids.slice(a, b + 1);
            } else if (event.metaKey || event.ctrlKey) {
                values = values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
                node.anchor = id;
            } else { values = [id]; node.anchor = id; }
            node.values = values;
        } else node.value = id;
        virtual.get(el)?.paintSelection();
        return true;
    }
    function bindRows(el, node) {
        el.tabIndex = 0;
        let suppressClick = false;
        el.addEventListener('click', (event) => {
            const sortHeader = event.target.closest('.plugin-native-table-heading.sortable');
            if (sortHeader) {
                const column = sortHeader.dataset.column;
                node.sort = { column, direction: node.sort?.column === column && node.sort.direction === 'asc' ? 'desc' : 'asc' };
                sync(el, node, ['sort']);
                fire(node, 'sort', { column, direction: node.sort.direction });
                return;
            }
            const sectionHeader = event.target.closest('[data-section-id]');
            if (sectionHeader) { toggleSection(el, node, sectionHeader.dataset.sectionId); return; }
            const row = event.target.closest('[data-item-id]');
            if (!row) return;
            if (suppressClick) { suppressClick = false; return; }
            // The chevron expands / collapses a row without selecting it. Rows with children
            // are opened here; a row that only carries `disclosure` is the application's to open.
            if (event.target.closest('.plugin-native-list-disclosure:not(.spacer)')) {
                if (!toggleBranch(el, node, row.dataset.itemId)) fire(node, 'disclose', { itemId: row.dataset.itemId });
                return;
            }
            if (selectRow(el, node, row.dataset.itemId, event)) fire(node, 'select', { itemId: row.dataset.itemId });
        });
        el.addEventListener('dblclick', (event) => {
            const row = event.target.closest('[data-item-id]');
            if (row && !row.classList.contains('disabled')) fire(node, 'activate', { itemId: row.dataset.itemId });
        });
        el.addEventListener('keydown', (event) => {
            const rows = rowsOf(node);
            if (!rows.length) return;
            const current = selectionOf(node);
            const index = rows.findIndex((row) => row.id === current[current.length - 1]);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                let next = Math.max(0, Math.min(rows.length - 1, index + delta));
                while (rows[next]?.header && next + delta >= 0 && next + delta < rows.length) next += delta;
                if (selectRow(el, node, rows[next].id, { shiftKey: event.shiftKey })) { virtual.get(el)?.reveal(next); fire(node, 'select', { itemId: rows[next].id }); }
            } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && index >= 0 && node.type === 'list' && listLayout(node).structured) {
                // Outline: → opens a row, or steps into it; ← closes it, or steps out to its parent.
                const row = rows[index];
                const forward = (event.key === 'ArrowRight') !== (getComputedStyle(el).direction === 'rtl');
                const step = (to) => { if (to >= 0 && selectRow(el, node, rows[to].id)) { virtual.get(el)?.reveal(to); fire(node, 'select', { itemId: rows[to].id }); } };
                if (forward && row.branch && row.disclosure === 'closed') toggleBranch(el, node, row.id, true);
                else if (forward && row.branch && rows[index + 1]?.parentId === row.id) step(index + 1);
                else if (!forward && row.branch && row.disclosure === 'open') toggleBranch(el, node, row.id, false);
                else if (!forward && row.parentId) step(rows.findIndex((entry) => entry.id === row.parentId));
                else return;
                event.preventDefault();
            } else if (event.key === 'Enter' && index >= 0) fire(node, 'activate', { itemId: rows[index].id });
        });
        el.addEventListener('contextmenu', (event) => {
            const row = event.target.closest('[data-item-id]');
            const menu = row && (rowsOf(node).find((item) => item.id === row.dataset.itemId)?.menu || node.itemMenu);
            if (!menu) return;
            event.preventDefault(); event.stopPropagation();
            const id = row.dataset.itemId;
            if (!selectionOf(node).includes(id)) { selectRow(el, node, id); fire(node, 'select', { itemId: id }); }
            showNativeMenu(menu, event.clientX, event.clientY, translate).then((choice) => { if (choice) fire(node, 'menu', { menuId: choice, itemId: id }); });
        });
        // Dragging rows. Inside a reorderable list a drag moves the row to a new position
        // ('reorder'). Rows of a draggable list can also be dropped on any list marked
        // dropTarget in the same app, which reports 'rowdrop' on that list:
        // { itemId: target row, position: 'on' | 'before' | 'after', index, parentId, sectionId,
        //   sourceId: source list, items: dragged row ids }.
        // Outlines and sectioned lists are not `reorderable` (a flat position says too little
        // there): they move rows with draggable + dropTarget + dropPosition instead.
        el.addEventListener('mousedown', (event) => {
            const reorderable = Boolean(node.reorderable) && !(node.type === 'list' && listLayout(node).structured);
            if (event.button !== 0 || (!reorderable && !node.draggable)) return;
            const row = event.target.closest('[data-item-id]');
            if (!row || event.target.closest('.plugin-native-list-disclosure:not(.spacer)')) return;
            const id = row.dataset.itemId;
            const item = rowsOf(node).find((entry) => entry.id === id);
            if (!item || item.header || item.disabled || (item.drag === false && !reorderable)) return;
            const startX = event.clientX; const startY = event.clientY; const height = rowHeightOf(node);
            let dragging = false; let reorderIndex = -1; let drop = null; let ids = [id];
            const marker = createElement('div', { className: 'plugin-native-drop-marker' });
            const ghost = createElement('div', { className: 'plugin-native-drag-ghost' });
            const move = (moveEvent) => {
                if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
                if (!dragging) {
                    dragging = true;
                    const selected = selectionOf(node);
                    if (selected.includes(id)) ids = rowsOf(node).map((entry) => entry.id).filter((entry) => selected.includes(entry));
                    ghost.textContent = ids.length > 1 ? `${ids.length} × ${translate(item.titleKey, item.title ?? '') || id}` : (translate(item.titleKey, item.title ?? '') || item.cells?.[node.columns?.[1]?.id] || id);
                    document.body.appendChild(ghost);
                    el.classList.add('reordering');
                }
                ghost.style.left = `${moveEvent.clientX}px`; ghost.style.top = `${moveEvent.clientY}px`;
                drop = null; reorderIndex = -1; marker.remove();
                const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                const listEl = hit?.closest?.('.plugin-native-list,.plugin-native-table');
                const targetNode = listEl && frame.contains(listEl) ? elementNode.get(listEl) : null;
                if (targetNode === node && reorderable && ids.length === 1) {
                    const box = virtual.get(el).sizer.getBoundingClientRect();
                    reorderIndex = Math.max(0, Math.min(rowsOf(node).length, Math.round((moveEvent.clientY - box.top) / height)));
                    marker.style.top = `${reorderIndex * height - 1}px`;
                    virtual.get(el).sizer.appendChild(marker);
                } else if (node.draggable && item.drag !== false) drop = locateDrop(moveEvent.clientX, moveEvent.clientY, { node, ids });
                showDrop(drop);
            };
            const up = () => {
                document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true);
                marker.remove(); ghost.remove(); el.classList.remove('reordering');
                clearDrop();
                if (!dragging) return;
                suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
                if (drop) {
                    fire(drop.node, 'rowdrop', { ...dropDetail(drop), sourceId: node.id || '', items: ids });
                    return;
                }
                if (reorderIndex < 0) return;
                const rows = rowsOf(node); const from = rows.findIndex((entry) => entry.id === id);
                const to = reorderIndex > from ? reorderIndex - 1 : reorderIndex;
                if (from < 0 || to === from || to < 0) return;
                const [moved] = rows.splice(from, 1); rows.splice(to, 0, moved);
                virtual.get(el)?.refresh(true);
                fire(node, 'reorder', { itemId: id, index: to, order: rows.map((entry) => entry.id) });
            };
            document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
        });
    }

    return {
        virtual, rowsOf, selectionOf, tableTemplate, createVirtualRows, bindRows, reportScroll,
        /** The rows of a list are recomputed after its items, sections or open rows changed. */
        invalidate: (node) => layouts.delete(node),
        dropHint(clientX, clientY) {
            const drop = locateDrop(clientX, clientY);
            showDrop(drop);
            return drop ? { targetId: drop.node.id || '', ...dropDetail(drop) } : null;
        },
        clearDropHint: clearDrop
    };
}
