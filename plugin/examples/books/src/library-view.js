// Books — the library: sidebar, bookshelf, Reading Now.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- view: library
function iconButton(id, icon, extra = {}) {
  return { type: 'button', id, icon: ICON(icon), iconTint: true, iconSize: 16, variant: 'plain', width: 30, height: 30, shape: 'circle', ...extra };
}
const SIDEBAR_WIDTH = 214;

function sidebar() {
  const nav = (id, title, icon) => ({ id, title, icon: ICON(icon), tint: true, drag: false, drop: false });
  const items = [
    { id: 'h:library', title: T('library', 'Library'), header: true },
    nav('now:', T('readingNow', 'Reading Now'), 'nav-reading'),
    nav('all:', T('allBooks', 'All Books'), 'nav-all'),
    nav('finished:', T('finished', 'Finished'), 'nav-finished'),
    ...(allBooks().some((book) => book.kind === 'comic') ? [nav('comics:', T('comics', 'Comics'), 'nav-comics')] : []),
    { id: 'h:collections', title: T('collections', 'Collections'), header: true },
    ...lib.collections.map((item) => ({
      id: `coll:${item.id}`, title: item.name, icon: ICON('nav-collection'), tint: true, drag: false,
      detail: String(item.bookIds.filter((id) => books[id]).length),
      menu: [{ id: 'rename', label: T('rename', 'Rename…') }, { separator: true }, { id: 'delete', label: T('deleteCollection', 'Delete Collection'), danger: true }]
    })),
    ...(lib.collections.length ? [] : [{ id: 'coll-empty', title: T('noCollections', 'No collections'), disabled: true, drag: false, drop: false }])
  ];
  const busy = importing || storing;
  return { type: 'stack', id: 'sidebar', direction: 'vertical', gap: 6, width: SIDEBAR_WIDTH, padding: [8, 8, 10, 10], children: [
    { type: 'list', id: 'nav', grow: 1, plain: true, value: `${route.kind}:${route.id}`, rowHeight: 30, iconSize: 20, dropTarget: true, items },
    ...(busy ? [{ type: 'stack', id: 'import-status', direction: 'vertical', gap: 5, padding: [2, 4, 4, 4], children: [
      { type: 'text', id: 'import-label', variant: 'caption', lines: 1, text: importLabel() },
      { type: 'progress', id: 'import-progress', value: busy.done + (busy.sub || 0), max: Math.max(1, busy.total) }
    ] }] : []),
    { type: 'stack', direction: 'horizontal', gap: 6, children: [
      { type: 'button', id: 'add-menu', label: T('newButton', 'New'), icon: ICON('plus'), iconTint: true, iconSize: 13, variant: 'tinted', grow: 1 },
      { type: 'button', id: 'import', label: T('import', 'Import'), variant: 'plain', grow: 1 }
    ] }
  ] };
}
function importLabel() {
  if (importing?.upgrading) return fmt('upgradingBook', 'Updating “{name}” for the new page layout… ({done}/{total})', { name: importing.name, done: importing.done + 1, total: importing.total });
  if (importing) return fmt('importingBook', 'Importing “{name}”… ({done}/{total})', { name: importing.name, done: importing.done + 1, total: importing.total });
  if (storing) return fmt('storingProgress', 'Copying {done} of {total}…', { done: storing.done, total: storing.total });
  return '';
}

function layout() {
  const content = Math.max(360, win.width - SIDEBAR_WIDTH - 44);
  const gap = 22;
  const cols = Math.max(2, Math.floor((content + gap) / (128 + gap)));
  const cardWidth = (content - gap * (cols - 1)) / cols;
  return { cols, gap, coverHeight: Math.round(cardWidth * 1.48) };
}

function bookMenu(book) {
  return [
    { id: 'open', label: T('open', 'Open') },
    { id: 'info', label: T('getInfo', 'Get Info…') },
    { separator: true },
    { id: 'add-to', label: T('addToCollection', 'Add to Collection…') },
    ...(route.kind === 'coll' ? [{ id: 'remove-from', label: T('removeFromCollection', 'Remove from Collection') }] : []),
    { id: 'finished', label: book?.finished ? T('markUnfinished', 'Mark as Still Reading') : T('markFinished', 'Mark as Finished') },
    { id: 'export', label: T('exportBook', 'Export Book…') },
    { separator: true },
    { id: 'delete', label: T('deleteBook', 'Delete from Library…'), danger: true }
  ];
}

function bookCard(book, section, L) {
  const status = statusText(book);
  return { type: 'stack', id: `card|${section}|${book.id}`, direction: 'vertical', gap: 4, minWidth: 0, children: [
    { type: 'image', id: `cover|${section}|${book.id}`, src: artOf(book), width: 'fill', height: L.coverHeight, radius: 4, fit: 'cover', border: true, tooltip: book.title, contextMenu: bookMenu(book) },
    { type: 'text', id: `title|${section}|${book.id}`, text: book.title, lines: 2, fontSize: 12.5, fontWeight: 'semibold', margin: [4, 0, 0, 0] },
    { type: 'stack', direction: 'horizontal', gap: 6, align: 'center', children: [
      { type: 'text', text: authorOf(book), lines: 1, fontSize: 11, color: 'secondary', grow: 1, minWidth: 0 },
      { type: 'text', text: status, fontSize: 11, fontWeight: book.opened && !book.finished ? 'regular' : 'semibold', color: !book.opened ? 'accent' : 'secondary' }
    ] }
  ] };
}
const bookGrid = (list, section) => {
  const L = layout();
  return { type: 'grid', id: `grid|${section}`, columns: L.cols, gap: L.gap, rowHeight: 'auto', children: list.map((book) => bookCard(book, section, L)) };
};

// The page title is a frosted bar floating over the page (material: "bar"): the books
// scroll underneath it. The page leaves room for it at the top (barHeight).
const barHeight = (meta) => (meta ? 82 : 64);
function headerBar(title, meta, { tools = true } = {}) {
  return { type: 'stack', id: 'lib-header', direction: 'horizontal', align: 'center', gap: 8, padding: [16, 18, 12, 22], height: barHeight(meta), material: 'bar', alignSelf: 'start', justifySelf: 'stretch', children: [
    { type: 'stack', direction: 'vertical', gap: 1, grow: 1, minWidth: 0, children: [
      { type: 'text', id: 'lib-title', text: title, fontSize: 26, fontWeight: 'bold', lines: 1 },
      ...(meta ? [{ type: 'text', id: 'lib-meta', text: meta, variant: 'muted', lines: 1 }] : [])
    ] },
    ...(tools ? [
      iconButton('view-grid', 'grid', { color: lib.view === 'grid' ? 'accent' : 'secondary', tooltip: T('asGrid', 'Show as Grid') }),
      iconButton('view-list', 'list', { color: lib.view === 'list' ? 'accent' : 'secondary', tooltip: T('asList', 'Show as List') }),
      iconButton('sort', 'sort', { tooltip: T('sort', 'Sort') }),
      { type: 'input', id: 'search', inputType: 'search', value: query, placeholder: T('search', 'Search'), width: 180 }
    ] : [])
  ] };
}

function emptyLibrary() {
  return { type: 'stack', id: 'empty', direction: 'vertical', grow: 1, align: 'center', justify: 'center', gap: 10, padding: 30, children: [
    { type: 'image', src: 'assets/icon.png', width: 96, height: 96 },
    { type: 'text', text: T('emptyTitle', 'Your library is empty'), fontSize: 20, fontWeight: 'bold' },
    { type: 'text', text: T('emptyHint', 'Drop EPUB books or CBZ comics onto this window, or choose Import.'), variant: 'muted', textAlign: 'center' },
    { type: 'button', id: 'import-empty', label: T('importBooks', 'Import Books…'), variant: 'primary', margin: [6, 0, 0, 0] }
  ] };
}

function collectionView() {
  const list = routeBooks();
  const titles = { all: T('allBooks', 'All Books'), finished: T('finished', 'Finished'), comics: T('comics', 'Comics') };
  const title = route.kind === 'coll' ? (collectionOf()?.name || '') : titles[route.kind];
  const meta = list.length === 1 ? T('oneBook', '1 book') : fmt('bookCount', '{n} books', { n: list.length });
  const placeholder = query.trim() ? T('noResults', 'No results')
    : route.kind === 'coll' ? T('emptyCollection', 'Drag books here from the list view, or use “Add to Collection…”.')
      : route.kind === 'finished' ? T('noFinished', 'Books you finish appear here.') : T('emptyHint', 'Drop EPUB books or CBZ comics onto this window, or choose Import.');
  // A grid builds real nodes for every book; past a few hundred the virtualised list is the right tool.
  const asList = lib.view === 'list' || list.length > 300;
  const body = asList
    ? { type: 'list', id: 'books', grow: 1, plain: true, multiple: true, draggable: true, rowHeight: 60, iconSize: 46, margin: [0, 10, 0, 10], insetTop: barHeight(meta), placeholder,
      items: list.map((book) => ({ id: book.id, icon: artOf(book), title: book.title, subtitle: authorOf(book), detail: statusText(book) })), itemMenu: bookMenu(null) }
    : list.length
      ? { type: 'scroll', id: `scroll|${route.kind}|${route.id}`, grow: 1, insetTop: barHeight(meta), children: [{ type: 'stack', direction: 'vertical', padding: [4 + barHeight(meta), 22, 30, 22], children: [bookGrid(list, 'lib')] }] }
      : { type: 'stack', grow: 1, align: 'center', justify: 'center', padding: 30, children: [{ type: 'text', text: placeholder, variant: 'muted', textAlign: 'center' }] };
  return [headerBar(title, meta), body];
}

// Reading Now: the book in progress, the daily goal and what to read next.
const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const minutesOn = (key) => Math.floor((lib.stats[key] || 0) / 60);
function ringCommands(fraction) {
  const c = 46; const r = 37; const start = -Math.PI / 2;
  return [
    ['lineWidth', 9], ['lineCap', 'round'], ['strokeStyle', 'separator'], ['beginPath'], ['arc', c, c, r, 0, Math.PI * 2], ['stroke'],
    ...(fraction > 0 ? [['strokeStyle', 'accent'], ['beginPath'], ['arc', c, c, r, start, start + Math.PI * 2 * Math.min(1, fraction)], ['stroke']] : []),
    ['fillStyle', 'text'], ['font', 17, 'bold', 'rounded'], ['textAlign', 'center'], ['textBaseline', 'middle'], ['fillText', `${Math.min(999, Math.round(fraction * 100))}%`, c, c + 1]
  ];
}
function weekCommands() {
  const days = [...Array(7)].map((_, i) => { const date = new Date(); date.setDate(date.getDate() - 6 + i); return date; });
  const values = days.map((date) => minutesOn(dayKey(date)));
  const top = Math.max(lib.goal, ...values, 1);
  const narrow = new Intl.DateTimeFormat(macos.i18n.language(), { weekday: 'narrow' });
  const commands = [['font', 9, 'semibold'], ['textAlign', 'center'], ['textBaseline', 'alphabetic']];
  const goalY = 44 - (lib.goal / top) * 38;
  commands.push(['strokeStyle', 'secondary'], ['lineWidth', 1], ['setLineDash', [2, 3]], ['beginPath'], ['moveTo', 0, goalY], ['lineTo', 182, goalY], ['stroke'], ['setLineDash', []]);
  days.forEach((date, i) => {
    const x = 6 + i * 25; const h = Math.max(2, (values[i] / top) * 38);
    commands.push(['fillStyle', values[i] >= lib.goal ? 'accent' : i === 6 ? 'secondary' : 'separator'], ['beginPath'], ['roundRect', x, 44 - h, 14, h, 3], ['fill']);
    commands.push(['fillStyle', i === 6 ? 'text' : 'secondary'], ['fillText', narrow.format(date), x + 7, 58]);
  });
  return commands;
}
function goalCard(narrow = false) {
  const today = minutesOn(dayKey());
  const thisYear = String(new Date().getFullYear());
  const finishedThisYear = allBooks().filter((book) => book.finished && book.finishedAt && new Date(book.finishedAt).getFullYear() === Number(thisYear)).length;
  return { type: 'stack', id: 'goal', direction: 'horizontal', gap: 16, padding: 16, radius: 12, background: 'fill', width: narrow ? 'fill' : 340, align: 'center', children: [
    { type: 'canvas', id: 'goal-ring', width: 92, height: 92, commands: ringCommands(today / Math.max(1, lib.goal)) },
    { type: 'stack', direction: 'vertical', gap: 3, grow: 1, minWidth: 0, children: [
      { type: 'text', text: T('todaysReading', 'Today’s Reading'), fontSize: 12, fontWeight: 'semibold', color: 'secondary' },
      { type: 'text', id: 'goal-minutes', text: fmt('minutesOfGoal', '{n} of {goal} min', { n: today, goal: lib.goal }), fontSize: 19, fontWeight: 'bold' },
      { type: 'canvas', id: 'goal-week', width: 182, height: 62, commands: weekCommands() },
      { type: 'text', text: fmt('finishedThisYear', '{n} finished in {year}', { n: finishedThisYear, year: thisYear }), variant: 'caption', color: 'secondary' }
    ] }
  ] };
}
function heroCard(book) {
  const pct = progressOf(book);
  return { type: 'stack', id: 'hero', direction: 'horizontal', gap: 18, padding: 16, radius: 12, background: 'fill', grow: 1, minWidth: 0, align: 'center', children: [
    { type: 'image', id: `cover|hero|${book.id}`, src: artOf(book), width: 104, height: 154, radius: 4, fit: 'cover', border: true, contextMenu: bookMenu(book) },
    { type: 'stack', direction: 'vertical', gap: 4, grow: 1, minWidth: 200, children: [
      { type: 'text', text: T('continueReading', 'Continue Reading').toLocaleUpperCase(), fontSize: 10.5, fontWeight: 'semibold', color: 'secondary' },
      { type: 'text', text: book.title, fontSize: 20, fontWeight: 'bold', lines: 2 },
      { type: 'text', text: authorOf(book), color: 'secondary', lines: 1 },
      { type: 'progress', value: pct, max: 100, maxWidth: 300, margin: [6, 0, 2, 0] },
      { type: 'text', text: `${pct}% · ${chapterTitle(book)}`, variant: 'caption', color: 'secondary', lines: 1 },
      { type: 'button', id: `continue|${book.id}`, label: T('continue', 'Continue'), variant: 'primary', shape: 'pill', alignSelf: 'start', margin: [6, 0, 0, 0] }
    ] }
  ] };
}
function nowView() {
  const list = allBooks();
  const narrow = win.width - SIDEBAR_WIDTH - 44 < 720;
  if (!list.length) return [headerBar(T('readingNow', 'Reading Now'), '', { tools: false }), emptyLibrary()];
  const inProgress = list.filter((book) => book.opened && !book.finished).sort((a, b) => (b.opened || 0) - (a.opened || 0));
  const fresh = list.filter((book) => !book.opened).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 12);
  const section = (title, items, name) => (items.length ? [
    { type: 'text', text: title, fontSize: 17, fontWeight: 'bold', margin: [10, 0, 2, 0] }, bookGrid(items, name)
  ] : []);
  return [
    headerBar(T('readingNow', 'Reading Now'), '', { tools: false }),
    { type: 'scroll', id: 'scroll|now', grow: 1, insetTop: barHeight(''), children: [{ type: 'stack', direction: 'vertical', gap: 12, padding: [2 + barHeight(''), 22, 30, 22], children: [
      { type: 'stack', id: 'now-top', direction: narrow ? 'vertical' : 'horizontal', gap: 16, align: 'stretch', children: [
        ...(inProgress[0] ? [heroCard(inProgress[0])] : [{ type: 'stack', grow: 1, justify: 'center', padding: 16, radius: 12, background: 'fill', children: [
          { type: 'text', text: T('nothingInProgress', 'Open a book to start reading. Your place is kept for every book.'), variant: 'muted' }] }]),
        goalCard(narrow)
      ] },
      ...section(T('alsoReading', 'Also Reading'), inProgress.slice(1, 13), 'also'),
      ...section(T('recentlyAdded', 'Recently Added'), fresh, 'fresh')
    ] }] }
  ];
}

function libraryView() {
  return { type: 'split', id: 'layout', children: [
    sidebar(),
    // Page first, its title bar over it.
    { type: 'zstack', id: `main:${route.kind === 'now' ? 'now' : 'books'}`, minWidth: 0, children: (route.kind === 'now' ? nowView() : collectionView()).reverse() }
  ] };
}
