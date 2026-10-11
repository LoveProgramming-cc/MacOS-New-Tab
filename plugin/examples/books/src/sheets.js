// Books — sheets: finished, info, settings, storage.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- view: sheets
function sheet(id, width, children) {
  return { type: 'stack', id, direction: 'vertical', align: 'center', justify: 'center', background: 'rgba(0,0,0,0.28)', transition: 'fade', children: [
    { type: 'stack', id: `${id}-card`, direction: 'vertical', gap: 10, width, padding: 18, radius: 12, material: 'glass', children }
  ] };
}
function finishedView() {
  const book = bookOf(finishedSheet);
  if (!book) return { type: 'spacer' };
  return sheet('finished-sheet', 340, [
    { type: 'stack', direction: 'horizontal', gap: 14, align: 'center', children: [
      { type: 'image', src: artOf(book), width: 60, height: 90, radius: 3, fit: 'cover', border: true },
      { type: 'stack', direction: 'vertical', gap: 3, grow: 1, minWidth: 0, children: [
        { type: 'text', text: T('youFinished', 'You finished'), variant: 'caption', color: 'secondary' },
        { type: 'text', text: book.title, fontSize: 16, fontWeight: 'bold', lines: 2 },
        { type: 'text', text: authorOf(book), color: 'secondary', lines: 1 }
      ] }
    ] },
    { type: 'stack', direction: 'horizontal', gap: 8, justify: 'end', margin: [6, 0, 0, 0], children: [
      { type: 'button', id: 'finished-stay', label: T('keepReading', 'Keep Reading') },
      { type: 'button', id: 'finished-library', label: T('backToLibrary', 'Library'), variant: 'primary' }
    ] }
  ]);
}
function infoSheet() {
  const book = bookOf(infoEdit.id);
  if (!book) return { type: 'spacer' };
  const dates = new Intl.DateTimeFormat(macos.i18n.language(), { dateStyle: 'medium' });
  const size = book.size ? `${(book.size / 1_048_576).toFixed(book.size > 10_485_760 ? 0 : 1)} MB` : '';
  const facts = [
    book.publisher && `${T('publisher', 'Publisher')}: ${book.publisher}`,
    book.language && `${T('language', 'Language')}: ${book.language}`,
    book.kind === 'comic' ? fmt('pageCount', '{n} pages', { n: book.pages.length }) : fmt('chapterCount', '{n} chapters', { n: book.toc.length || book.spine.length }),
    size, `${T('added', 'Added')}: ${dates.format(book.added || Date.now())}`
  ].filter(Boolean);
  return sheet('info-sheet', 440, [
    { type: 'stack', direction: 'horizontal', gap: 16, align: 'start', children: [
      { type: 'stack', direction: 'vertical', gap: 8, align: 'center', children: [
        { type: 'image', id: 'info-cover', src: artOf(book), width: 110, height: 164, radius: 4, fit: 'cover', border: true, tooltip: T('coverHint', 'Click or drop an image to change the cover') },
        ...(book.customCover ? [{ type: 'button', id: 'info-reset-cover', label: T('restoreCover', 'Restore Cover'), variant: 'plain', fontSize: 11 }] : [])
      ] },
      { type: 'stack', direction: 'vertical', gap: 6, grow: 1, minWidth: 0, children: [
        { type: 'text', text: T('colTitle', 'Title'), variant: 'caption' }, { type: 'input', id: 'info-title', value: infoEdit.title, maxLength: 200 },
        { type: 'text', text: T('colAuthor', 'Author'), variant: 'caption' }, { type: 'input', id: 'info-author', value: infoEdit.author, maxLength: 200 },
        { type: 'stack', direction: 'vertical', gap: 1, margin: [4, 0, 0, 0], children: facts.map((fact) => ({ type: 'text', text: fact, variant: 'muted', fontSize: 11, lines: 1 })) }
      ] }
    ] },
    ...(book.description ? [{ type: 'text', text: book.description, variant: 'muted', lines: 6, selectable: true }] : []),
    { type: 'stack', direction: 'horizontal', gap: 8, justify: 'end', margin: [6, 0, 0, 0], children: [
      { type: 'button', id: 'info-cancel', label: T('cancel', 'Cancel') }, { type: 'button', id: 'info-save', label: T('save', 'Save'), variant: 'primary' }
    ] }
  ]);
}
function settingsSheet() {
  const chosen = lib.accent || DEFAULT_ACCENT;
  const megabytes = usage ? `${(usage.bytes / 1_048_576).toFixed(usage.bytes > 104_857_600 ? 0 : 1)} MB` : '…';
  return sheet('settings-sheet', 380, [
    { type: 'text', text: T('settings', 'Settings'), fontSize: 15, fontWeight: 'bold' },
    { type: 'text', text: T('appAppearance', 'Appearance'), variant: 'caption' },
    { type: 'segmented', id: 'appearance', alignSelf: 'start', value: appearance, options: [{ value: 'system', label: T('appearanceSystem', 'Automatic') }, { value: 'light', label: T('appearanceLight', 'Light') }, { value: 'dark', label: T('appearanceDark', 'Dark') }] },
    { type: 'separator' },
    { type: 'text', text: T('accentColor', 'Accent colour'), variant: 'caption' },
    { type: 'stack', direction: 'horizontal', gap: 9, align: 'center', children: Object.entries(ACCENTS).map(([name, color]) => (
      { type: 'button', id: `accent-${name}`, shape: 'circle', width: 20, height: 20, background: color, color: 'white', fontSize: 11, fontWeight: 'bold', label: chosen === name ? '✓' : '', tooltip: T(`accent_${name}`, name) }
    )) },
    { type: 'text', variant: 'muted', text: accentSetting === 'multicolor' ? T('accentOwnHint', 'Used while the system accent colour is Multicolor.') : T('accentOverriddenHint', 'The system accent colour is set to a fixed colour, which currently overrides this choice.') },
    { type: 'separator' },
    { type: 'text', text: T('dailyGoal', 'Daily reading goal'), variant: 'caption' },
    { type: 'stack', direction: 'horizontal', gap: 10, align: 'center', children: [
      { type: 'slider', id: 'goal-slider', grow: 1, min: 5, max: 120, step: 5, value: lib.goal },
      { type: 'text', id: 'goal-value', text: fmt('nMinutes', '{n} min', { n: lib.goal }), width: 60, textAlign: 'end' }
    ] },
    { type: 'text', variant: 'muted', text: T('goalHint', 'Time counts while a book is open in the front window and you are turning pages.') },
    { type: 'separator' },
    { type: 'text', text: T('storage', 'Storage'), variant: 'caption' },
    { type: 'text', text: fmt('storageSummary', '{count} books · {size} stored in this app', { count: allBooks().length, size: megabytes }) },
    { type: 'stack', direction: 'horizontal', gap: 8, align: 'center', children: [{ type: 'button', id: 'manage-storage', label: T('manageStorage', 'Manage Storage…') }] },
    { type: 'text', variant: 'muted', text: T('manageStorageHint', 'See which books take up space — largest, finished, never opened — and delete exactly what you choose.') },
    { type: 'stack', direction: 'horizontal', gap: 8, justify: 'end', margin: [6, 0, 0, 0], children: [
      { type: 'button', id: 'settings-done', label: T('done', 'Done'), variant: 'primary' }
    ] }
  ]);
}

// Manage Storage: every book with what it occupies (its original file, the pages and
// pictures unpacked from it, its cover), so space is freed by choice — the largest books,
// the finished ones, those never opened — instead of all or nothing.
let storage = null;               // { files: Map(id -> size), filter, sort, selected }
const sizeText = (bytes) => (bytes >= 1_048_576_000 ? `${(bytes / 1_073_741_824).toFixed(2)} GB` : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(bytes > 104_857_600 ? 0 : 1)} MB` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`);
const bookFileIds = (book) => [...new Set([...(book.files || []), book.sourceId, book.customCover, book.coverId].filter(Boolean))];
const bookBytes = (book) => bookFileIds(book).reduce((sum, id) => sum + (storage?.files.get(id) || 0), 0) || book.size || 0;
const STALE_MS = 90 * 86_400_000;
const STORAGE_FILTERS = {
  all: () => true,
  finished: (book) => Boolean(book.finished),
  never: (book) => !book.opened,
  stale: (book) => Boolean(book.opened) && !book.finished && Date.now() - book.opened > STALE_MS,
  comics: (book) => book.kind === 'comic'
};
function storageRows() {
  const { filter, sort } = storage;
  const dates = new Intl.DateTimeFormat(macos.i18n.language(), { dateStyle: 'medium' });
  const value = { title: (book) => book.title, author: (book) => authorOf(book), opened: (book) => book.opened || 0, size: bookBytes }[sort.column] || bookBytes;
  return allBooks().filter(STORAGE_FILTERS[filter] || STORAGE_FILTERS.all)
    .sort((a, b) => (typeof value(a) === 'number' ? value(a) - value(b) : compare(value(a), value(b))) * (sort.direction === 'desc' ? -1 : 1))
    .map((book) => ({ id: book.id, icon: artOf(book), cells: {
      title: book.title, author: authorOf(book),
      opened: book.finished ? T('finished', 'Finished') : book.opened ? dates.format(book.opened) : T('neverOpened', 'Never'),
      size: sizeText(bookBytes(book))
    } }));
}
function storageSheet() {
  const owned = new Set(allBooks().flatMap(bookFileIds));
  let originals = 0; let pages = 0; let unused = 0; let unusedCount = 0;
  const sources = new Set(allBooks().map((book) => book.sourceId).filter(Boolean));
  for (const [id, size] of storage.files) {
    if (!owned.has(id)) { unused += size; unusedCount += 1; } else if (sources.has(id)) originals += size; else pages += size;
  }
  const total = originals + pages + unused;
  const rows = storageRows();
  const selected = storage.selected.filter((id) => books[id] && rows.some((row) => row.id === id));
  const selectedBytes = selected.reduce((sum, id) => sum + bookBytes(books[id]), 0);
  const parts = [[T('storageOriginals', 'Book files'), originals, 'accent'], [T('storagePages', 'Pages and pictures'), pages, 'teal'], [T('storageUnused', 'Unused files'), unused, 'gray']].filter((part) => part[1] > 0);
  const W = 624; let x = 0;
  const bar = [['fillStyle', 'fill'], ['beginPath'], ['roundRect', 0, 0, W, 12, 4], ['fill'], ['save'], ['beginPath'], ['roundRect', 0, 0, W, 12, 4], ['clip'],
    ...parts.flatMap(([, bytes, color]) => { const w = Math.max(3, (bytes / Math.max(1, total)) * W); const cmd = [['fillStyle', color], ['fillRect', x, 0, w - 1, 12]]; x += w; return cmd; }), ['restore']];
  const count = (key) => allBooks().filter(STORAGE_FILTERS[key]).length;
  return sheet('storage-sheet', 660, [
    { type: 'stack', direction: 'horizontal', align: 'center', children: [
      { type: 'text', text: T('storage', 'Storage'), fontSize: 15, fontWeight: 'bold', grow: 1 },
      { type: 'text', text: sizeText(total), color: 'secondary' }
    ] },
    { type: 'canvas', id: 'storage-bar', width: W, height: 12, commands: bar },
    { type: 'stack', direction: 'horizontal', gap: 14, children: parts.map(([label, bytes, color]) => ({ type: 'stack', direction: 'horizontal', gap: 5, align: 'center', children: [
      { type: 'stack', width: 8, height: 8, radius: 'full', background: color, children: [] }, { type: 'text', text: `${label}  ${sizeText(bytes)}`, fontSize: 11, color: 'secondary' }
    ] })) },
    { type: 'segmented', id: 'storage-filter', value: storage.filter, alignSelf: 'start', options: [
      { value: 'all', label: `${T('filterAll', 'All')} ${count('all')}` }, { value: 'finished', label: `${T('finished', 'Finished')} ${count('finished')}` },
      { value: 'never', label: `${T('filterNever', 'Never Opened')} ${count('never')}` }, { value: 'stale', label: `${T('filterStale', 'Not Opened in 3 Months')} ${count('stale')}` },
      { value: 'comics', label: `${T('comics', 'Comics')} ${count('comics')}` }
    ] },
    { type: 'table', id: 'storage-table', height: 262, multiple: true, values: selected, rowHeight: 38, iconSize: 28, sort: storage.sort, placeholder: T('storageNothing', 'Nothing here.'),
      columns: [{ id: 'title', title: T('colTitle', 'Title'), width: '2fr', sortable: true }, { id: 'author', title: T('colAuthor', 'Author'), width: '1.4fr', sortable: true, muted: true },
        { id: 'opened', title: T('lastOpened', 'Last Opened'), width: 110, sortable: true, muted: true }, { id: 'size', title: T('colSize', 'Size'), width: 84, align: 'end', sortable: true }],
      rows },
    { type: 'stack', direction: 'horizontal', gap: 8, align: 'center', margin: [4, 0, 0, 0], children: [
      { type: 'button', id: 'storage-select-all', label: selected.length === rows.length && rows.length ? T('selectNone', 'Select None') : T('selectAllShown', 'Select All Shown'), disabled: !rows.length },
      ...(unusedCount ? [{ type: 'button', id: 'clean-storage', label: `${T('cleanStorage', 'Remove Unused Files')} (${sizeText(unused)})` }] : []),
      { type: 'spacer' },
      { type: 'button', id: 'storage-delete', variant: 'danger', disabled: !selected.length,
        label: selected.length ? fmt('deleteSelectedN', 'Delete {count} · {size}', { count: selected.length, size: sizeText(selectedBytes) }) : T('deleteSelected', 'Delete Selected') },
      { type: 'button', id: 'storage-done', label: T('done', 'Done'), variant: 'primary' }
    ] }
  ]);
}
async function refreshStorage() {
  const files = new Map((await macos.files.list().catch(() => [])).map((file) => [file.id, file.size || 0]));
  if (storage) storage.files = files;
  usage = { count: files.size, bytes: [...files.values()].reduce((sum, size) => sum + size, 0) };
  render();
}
async function openStorage() {
  settingsOpen = false;
  storage = { files: new Map(), filter: 'all', sort: { column: 'size', direction: 'desc' }, selected: [] };
  await refreshStorage();
}
async function cleanStorage() {
  const owned = new Set(allBooks().flatMap(bookFileIds));
  for (const file of (await macos.files.list()).filter((entry) => !owned.has(entry.id))) await macos.files.remove(file.id).catch(() => {});
  await refreshStorage();
}

function view() {
  return { type: 'zstack', id: 'root', padding: 0, height: 'fill', children: [
    reading && readingBook() ? readerView() : libraryView(),
    ...(infoEdit ? [infoSheet()] : []),
    ...(settingsOpen ? [settingsSheet()] : []),
    ...(storage ? [storageSheet()] : [])
  ] };
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    const book = readingBook();
    if (book) prepareCurrent();
    const tree = view();
    // A page arrives with a slide once; afterwards it carries no transition, so that
    // when it is replaced it simply stays underneath the next page as that one slides in.
    if (reading) reading.turn = '';
    macos.ui.render(tree).catch((error) => macos.log('render failed', String(error)));
  });
}
function go(kind, id = '') { route = { kind, id }; query = ''; render(); }
