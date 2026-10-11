// Books — events, the widget and start-up.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- events
const bookFromId = (id) => { const parts = String(id).split('|'); return parts.length === 3 ? parts[2] : ''; };

macos.on('ui', async ({ id, event, value, values = [], checked, menuId, itemId, sourceId, items = [], column, direction, targetId }) => {
  lastActive = Date.now();
  // Sidebar
  if (id === 'nav') {
    if (event === 'rowdrop') {
      const target = String(itemId || '');
      if (sourceId === 'books' && target.startsWith('coll:')) {
        const item = collectionOf(target.slice(5));
        if (item) { items.forEach((bookId) => { if (books[bookId] && !item.bookIds.includes(bookId)) item.bookIds.push(bookId); }); save(); render(); }
      }
      return;
    }
    const raw = String(event === 'menu' ? itemId : value || '');
    const [kind, ...rest] = raw.split(':'); const target = rest.join(':');
    if (event === 'select' && ['now', 'all', 'finished', 'comics', 'coll'].includes(kind)) go(kind, target);
    if (event === 'menu' && kind === 'coll') { if (menuId === 'rename') renameCollection(target); if (menuId === 'delete') deleteCollection(target); }
    return;
  }
  // Library list view
  if (id === 'books') {
    if (event === 'activate') openBook(itemId);
    if (event === 'menu') bookAction(menuId, values.length && values.includes(itemId) ? values : [itemId], itemId);
    return;
  }
  // Covers in the grid and on Reading Now
  if (id.startsWith('cover|') || id.startsWith('title|')) {
    const bookId = bookFromId(id);
    if (event === 'click') openBook(bookId);
    if (event === 'menu') bookAction(menuId, [bookId], bookId);
    return;
  }
  if (id.startsWith('continue|') && event === 'click') return openBook(id.slice(9));
  if (id === 'search' && event === 'input') { query = String(value || ''); render(); return; }

  // Reader
  if (id === 'toc' && (event === 'select' || event === 'activate')) {
    const book = readingBook(); const index = Number(String(value || itemId).slice(2));
    if (!book || Number.isNaN(index)) return;
    if (book.kind === 'comic') goTo(book, { s: 0, p: index, f: 0 });
    else if (book.toc[index]) jumpTo(book, book.toc[index].s, book.toc[index].p || 0, book.toc[index].a || '');
    return;
  }
  if (id === 'bookmarks') {
    const book = readingBook(); const mark = (book?.bookmarks || []).find((entry) => `b:${entry.id}` === (itemId || value));
    if (!mark) return;
    if (event === 'activate' || event === 'select' || (event === 'menu' && menuId === 'bm-go')) goTo(book, { s: mark.s, p: mark.p, f: mark.f || 0 });
    if (event === 'menu' && menuId === 'bm-delete') { book.bookmarks = book.bookmarks.filter((entry) => entry !== mark); save(book); render(); }
    return;
  }
  // A press outside the appearance popover closes it (its own toolbar button toggles it).
  if (id === 'appearance' && event === 'dismiss') { if (targetId !== 'r-appearance' && appearanceOpen) { appearanceOpen = false; render(); } return; }
  if (id === 'storage-filter' && event === 'change' && storage) { storage.filter = STORAGE_FILTERS[value] ? value : 'all'; storage.selected = []; render(); return; }
  if (id === 'storage-table' && storage) {
    if (event === 'select') { storage.selected = values; render(); }
    else if (event === 'sort') { storage.sort = { column, direction }; render(); }
    return;
  }
  if (id === 'appearance' && event === 'change') {
    appearance = ['light', 'dark'].includes(value) ? value : 'system';
    macos.window.setAppearance(appearance).catch(() => {});
    render(); return;
  }
  if (id === 'pane-tab' && event === 'change') { paneTab = value === 'bookmarks' ? 'bookmarks' : 'toc'; render(); return; }
  if (id === 'r-scrub') {
    const book = readingBook();
    if (!book) return;
    const pos = book.kind === 'comic' ? { s: 0, p: Number(value), f: 0 } : posFromFraction(book, Number(value) / 1000);
    if (event === 'input') {
      patch('r-chapter', { text: chapterTitle(book, pos) });
      patch('r-left', { text: `${progressOf({ ...book, finished: false, opened: 1 }, pos)}%` });
    }
    if (event === 'change') goTo(book, pos);
    return;
  }
  if (id === 'font' && event === 'change') return setReader({ font: String(value) });
  if (id === 'spacing' && event === 'change') return setReader({ spacing: String(value) });
  if (id === 'columns' && event === 'change') return setReader({ columns: String(value) });
  if (id === 'width' && event === 'change') return setReader({ width: String(value) });
  if (id === 'justify' && event === 'change') return setReader({ justify: Boolean(checked) });
  if (id === 'goal-slider') {
    if (event === 'input') patch('goal-value', { text: fmt('nMinutes', '{n} min', { n: Number(value) }) });
    if (event === 'change') { lib.goal = Number(value) || 15; save(); render(); }
    return;
  }
  if (infoEdit && (id === 'info-title' || id === 'info-author')) {
    if (event === 'input') infoEdit[id.slice(5)] = String(value || '');
    if (event !== 'submit') return;
    id = 'info-save'; event = 'click';
  }
  if (event !== 'click') return;

  if (id.startsWith('accent-') && ACCENTS[id.slice(7)]) {
    lib.accent = id.slice(7) === DEFAULT_ACCENT ? '' : id.slice(7);
    macos.window.setAccentColor(lib.accent || null).catch(() => {});
    save(); render();
  }
  else if (id.startsWith('theme-')) setReader({ theme: id.slice(6) });
  else if (id === 'size-up') setReader({ size: Math.min(34, lib.reader.size + 1) });
  else if (id === 'size-down') setReader({ size: Math.max(12, lib.reader.size - 1) });
  else if (id === 'settings-done') { settingsOpen = false; render(); }
  else if (id === 'manage-storage') openStorage();
  else if (id === 'clean-storage') cleanStorage();
  else if (id === 'storage-done') { storage = null; render(); }
  else if (id === 'storage-select-all' && storage) { const shown = storageRows().map((row) => row.id); storage.selected = storage.selected.length === shown.length ? [] : shown; render(); }
  else if (id === 'storage-delete' && storage) { await deleteBooks(storage.selected.filter((bookId) => books[bookId])); if (storage) { storage.selected = []; await refreshStorage(); } }
  else if (id === 'import' || id === 'import-empty') importDialog();
  else if (id === 'add-menu') {
    const choice = await macos.ui.showMenu([{ id: 'collection', label: T('newCollection', 'New Collection') }, { separator: true }, { id: 'import', label: T('importBooks', 'Import Books…') }]);
    if (choice === 'collection') createCollection(); if (choice === 'import') importDialog();
  }
  else if (id === 'view-grid' || id === 'view-list') { lib.view = id.slice(5); save(); render(); }
  else if (id === 'sort') sortMenu();
  else if (id === 'r-back' || id === 'finished-library') closeBook();
  else if (id === 'finished-stay') { finishedSheet = ''; render(); }
  else if (id === 'r-pane') { if (paneOpen) { paneOpen = false; render(); } else showPane(); }
  else if (id === 'r-appearance') { appearanceOpen = !appearanceOpen; render(); }
  else if (id === 'r-bookmark') toggleBookmark();
  else if (id === 'r-more') readerMoreMenu();
  else if (id === 'r-prev') step(-1);
  else if (id === 'r-next') step(1);
  else if (id === 'info-cancel') { infoEdit = null; render(); }
  else if (id === 'info-cover') {
    try {
      const file = await pick({ accept: 'image/*' });
      const book = infoEdit && bookOf(infoEdit.id);
      if (file && book && isImage(file)) await setCustomCover(book, file.id); else if (file) macos.files.remove(file.id).catch(() => {});
    } catch (error) { await macos.dialog.alert(String(error?.message || error), { title: T('chooseCover', 'Choose Cover') }); }
  }
  else if (id === 'info-reset-cover') { const book = infoEdit && bookOf(infoEdit.id); if (book) await setCustomCover(book, ''); }
  else if (id === 'info-save' && infoEdit) {
    const book = bookOf(infoEdit.id);
    if (book) { book.title = infoEdit.title.trim().slice(0, 200) || book.title; book.author = infoEdit.author.trim().slice(0, 200); save(book); }
    infoEdit = null; render();
  }
});

// Files dragged onto the window are already in the file store when this fires.
macos.on('drop', ({ files = [], rejected, targetId }) => {
  lastActive = Date.now();
  if (rejected?.length) notify({ title: T('someSkipped', 'Some files were skipped'), body: rejected.map((item) => item.name).join(', ').slice(0, 200) });
  // A picture dropped on the cover in Get Info becomes that book's cover.
  const book = infoEdit && bookOf(infoEdit.id);
  if (book && files.length === 1 && isImage(files[0])) { setCustomCover(book, files[0].id); return; }
  if (files.length) importFiles(files);
});
macos.on('fileprogress', ({ done, total }) => {
  if (done >= total) { storing = null; render(); return; }
  const first = !storing;
  storing = { done, total };
  if (first || importing) return render();
  patch('import-label', { text: importLabel() });
  patch('import-progress', { value: done, max: Math.max(1, total) });
});

macos.on('keydown', ({ key, shiftKey, metaKey, ctrlKey, altKey, editing, targetId }) => {
  lastActive = Date.now();
  if (key === 'Escape') {
    // true: Escape was used here. Otherwise (the plain library) the host closes the window.
    if (storage) { storage = null; render(); return true; }
    if (settingsOpen) { settingsOpen = false; render(); return true; }
    if (infoEdit) { infoEdit = null; render(); return true; }
    if (finishedSheet) { finishedSheet = ''; render(); return true; }
    if (appearanceOpen) { appearanceOpen = false; render(); return true; }
    if (reading) { closeBook(); return true; }
    return false;
  }
  if (editing || metaKey || ctrlKey || altKey) return;
  if (reading && !infoEdit && !settingsOpen && !finishedSheet) {
    if (key === 'ArrowRight' || key === 'PageDown' || (key === ' ' && !shiftKey)) step(1);
    if (key === 'ArrowLeft' || key === 'PageUp' || (key === ' ' && shiftKey)) step(-1);
    return;
  }
  if ((key === 'Backspace' || key === 'Delete') && targetId === 'books') {
    macos.ui.get('books').then(({ values = [], value } = {}) => {
      const ids = values.length ? values : value ? [value] : [];
      if (!ids.length) return;
      if (route.kind === 'coll') removeFromCollection(ids); else deleteBooks(ids);
    }).catch(() => {});
  }
});

macos.on('menucommand', async ({ command }) => {
  lastActive = Date.now();
  const book = readingBook();
  const selected = async () => {
    if (book) return book.id;
    if (route.kind !== 'now' && lib.view === 'list') { try { const state = await macos.ui.get('books'); return state?.value || ''; } catch {} }
    return '';
  };
  if (command === 'import') importDialog();
  if (command === 'new-collection') createCollection();
  if (command === 'info') { const id = await selected(); if (id) showInfo(id); }
  if (command === 'export-book') { const id = await selected(); if (id) exportBook(id); }
  if (command === 'library' && reading) closeBook();
  if (!book) return;
  if (command === 'toc') { if (paneOpen && paneTab === 'toc') { paneOpen = false; render(); } else showPane('toc'); }
  if (command === 'bookmarks') { if (paneOpen && paneTab === 'bookmarks') { paneOpen = false; render(); } else showPane('bookmarks'); }
  if (command === 'appearance') { appearanceOpen = !appearanceOpen; render(); }
  if (command === 'bigger') setReader({ size: Math.min(34, lib.reader.size + 1) });
  if (command === 'smaller') setReader({ size: Math.max(12, lib.reader.size - 1) });
  if (command === 'next-page') step(1);
  if (command === 'prev-page') step(-1);
  if (command === 'next-chapter') chapterStep(1);
  if (command === 'prev-chapter') chapterStep(-1);
  if (command === 'bookmark') toggleBookmark();
});

// ---------------------------------------------------------------- widget
// "Continue Reading" for the desktop and the widget centre (manifest: widgets). The host
// draws what is published here whether or not Books is open; a click opens Books.
function widgetContent() {
  const list = allBooks();
  const book = list.filter((item) => item.opened && !item.finished).sort((a, b) => (b.opened || 0) - (a.opened || 0))[0]
    || list.filter((item) => !item.finished).sort((a, b) => (b.added || 0) - (a.added || 0))[0];
  const caption = { type: 'text', text: T('continueReading', 'Continue Reading').toLocaleUpperCase(), fontSize: 10.5, fontWeight: 'semibold', color: 'secondary', lines: 1 };
  if (!book) {
    const empty = { type: 'stack', direction: 'vertical', gap: 4, children: [caption, { type: 'spacer' }, { type: 'text', text: T('widgetEmpty', 'Add a book and it appears here.'), fontSize: 12, color: 'secondary' }] };
    return { small: empty, medium: empty };
  }
  const pct = progressOf(book);
  const today = minutesOn(dayKey());
  return {
    small: { type: 'stack', direction: 'vertical', gap: 6, children: [
      { type: 'stack', direction: 'horizontal', align: 'start', children: [
        { type: 'image', src: artOf(book), width: 54, height: 80, radius: 3, fit: 'cover', border: true },
        { type: 'spacer' },
        { type: 'text', text: `${pct}%`, fontSize: 17, fontWeight: 'bold', color: 'accent' }
      ] },
      { type: 'text', text: book.title, fontSize: 12, fontWeight: 'semibold', lines: 1 },
      { type: 'spacer' },
      { type: 'progress', value: pct, max: 100 }
    ] },
    medium: { type: 'stack', direction: 'horizontal', gap: 14, align: 'stretch', children: [
      { type: 'image', src: artOf(book), width: 88, height: 132, radius: 4, fit: 'cover', border: true },
      { type: 'stack', direction: 'vertical', gap: 3, grow: 1, minWidth: 0, children: [
        caption,
        { type: 'text', text: book.title, fontSize: 15, fontWeight: 'bold', lines: 2 },
        { type: 'text', text: authorOf(book), fontSize: 12, color: 'secondary', lines: 1 },
        { type: 'spacer' },
        { type: 'progress', value: pct, max: 100 },
        { type: 'stack', direction: 'horizontal', align: 'center', gap: 8, margin: [4, 0, 0, 0], children: [
          { type: 'button', id: `open:${book.id}`, label: T('continue', 'Continue'), variant: 'primary', shape: 'pill', height: 26 },
          { type: 'spacer' },
          { type: 'text', text: fmt('minutesOfGoal', '{n} of {goal} min', { n: today, goal: lib.goal }), fontSize: 11, color: 'secondary', lines: 1 }
        ] }
      ] }
    ] }
  };
}
let widgetSignature = '';
function publishWidgets() {
  const content = widgetContent();
  const signature = JSON.stringify(content);
  if (signature === widgetSignature) return;
  widgetSignature = signature;
  macos.widgets.set('reading', content).catch((error) => macos.log('widget failed', String(error)));
}
macos.on('widget', ({ action }) => { const id = String(action || '').startsWith('open:') ? action.slice(5) : ''; if (id && bookOf(id)) openBook(id); });

macos.on('settings', openSettings);
macos.on('search', ({ id }) => { if (bookOf(id)) openBook(id); });
// books://book/<id>: how other applications (macos.openURL) point at a book here.
macos.on('openurl', ({ url }) => { const id = decodeURIComponent(/^books:\/\/book\/([^/?#]+)/i.exec(String(url || ''))?.[1] || ''); if (id && bookOf(id)) openBook(id); });
macos.on('accentchange', (info) => { accentSetting = info.accentSetting || 'multicolor'; if (settingsOpen) render(); });
macos.on('themechange', ({ theme }) => { systemTheme = theme === 'dark' ? 'dark' : 'light'; render(); });
macos.on('languagechange', () => { render(); publishWidgets(); });
macos.on('resize', ({ width, height }) => { if (width === win.width && height === win.height) return; win = { width, height }; render(); });

// The daily goal counts time while a book is open in the visible, focused window and
// the reader has done something in the last three minutes.
let visible = true; let focused = true;
macos.on('visibilitychange', ({ visible: shown }) => { visible = shown; });
macos.on('focus', () => { focused = true; lastActive = Date.now(); });
macos.on('blur', () => { focused = false; });
setInterval(() => {
  if (!reading || !visible || !focused || Date.now() - lastActive > 180_000) return;
  const key = dayKey();
  const before = minutesOn(key);
  lib.stats[key] = (lib.stats[key] || 0) + 5;
  for (const day of Object.keys(lib.stats)) if (Date.now() - new Date(`${day}T00:00:00`).getTime() > 90 * 86_400_000) delete lib.stats[day];
  save();
  if (before < lib.goal && minutesOn(key) >= lib.goal && lib.goalNotified !== key) {
    lib.goalNotified = key;
    notify({ title: T('goalReached', 'Daily goal reached'), body: fmt('goalReachedBody', 'You read {n} minutes today.', { n: lib.goal }), tag: 'goal' });
  }
}, 5000);

// ---------------------------------------------------------------- start
try { const bounds = await macos.window.getBounds(); if (bounds?.width) win = { width: bounds.width, height: bounds.height }; } catch {}
try { const info = await macos.system.getInfo(); systemTheme = info?.theme === 'dark' ? 'dark' : 'light'; } catch {}
if (lib.accent) macos.window.setAccentColor(lib.accent).catch(() => {});
await macos.ui.render(view());
publishSearch();
publishWidgets();
const REQUIRED_PERMISSIONS = ['storage', 'files'];
// What the app cannot work without. If the user switched one of these off, ask once: the
// system's dialog leads to the switch in System Settings.
macos.permissions.status().then((status) => {
  const missing = REQUIRED_PERMISSIONS.filter((name) => status[name] === 'denied');
  if (missing.length) macos.permissions.request(missing);
}).catch(() => {});
upgradeBooks();
