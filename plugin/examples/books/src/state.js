// Books — a native-runtime app.
//
// An EPUB is a zip archive: macos.archive.extract() unpacks it into the host file store,
// this script reads the package document (OPF), the table of contents and every chapter,
// and turns each chapter into clean, sanitised HTML split into page-sized parts. Those
// parts are written back to the file store; pictures stay there as stored files. While
// reading, one part at a time is shown in an `html` node, with its pictures turned into
// data: URLs on the way in. A CBZ comic is a zip of page images and is shown with
// `image` nodes. As in Music, the whole interface is one function of state, view(),
// handed to macos.ui.render().

const T = (key, fallback) => macos.i18n.t(key, fallback);
const fmt = (key, fallback, vars) => Object.entries(vars).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), T(key, fallback));
const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ICON = (name) => `assets/icons/${name}.svg`;
const compare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const PART_MARK = '\n<!--bk:part-->\n';
const FORMAT = 2;   // storage format of chapters: 2 = large parts with picture sizes, paginated in columns
const patch = (id, props) => { try { const result = macos.ui.patch(id, props); result?.catch?.(() => {}); } catch {} };
const notify = (options) => { try { const result = macos.notifications.show(options); result?.catch?.(() => {}); } catch {} };

// ---------------------------------------------------------------- state
let lib = {
  bookIds: [], collections: [], accent: '', goal: 15, stats: {}, goalNotified: '', sort: 'recent', view: 'grid',
  reader: { theme: 'auto', font: 'serif', size: 19, spacing: 'normal', width: 'normal', justify: false, columns: 'auto' }
};
const books = {};                 // id -> book record (each stored under its own storage key)
let route = { kind: 'now', id: '' };   // now | all | finished | comics | coll
let query = '';
let win = { width: 1040, height: 700 };
let systemTheme = 'light';
let reading = null;               // { id, turn: '' | 'next' | 'prev' } while a book is open
let paneOpen = false;             // the contents / bookmarks pane of the reader
let paneTab = 'toc';
let appearanceOpen = false;
let infoEdit = null;              // { id, title, author } while Get Info is open
let settingsOpen = false;
let finishedSheet = '';           // id of the book just finished
let importing = null;             // { done, total, name } while books are being unpacked
let storing = null;               // { done, total } while the host stores dropped / picked files
let usage = null;

const ACCENTS = { red: '#ff5257', pink: '#f74f9e', orange: '#f7821b', yellow: '#f5b60a', green: '#62ba46', blue: '#0a84ff', purple: '#a550a7', graphite: '#8c8c8c' };
const DEFAULT_ACCENT = 'orange';
let accentSetting = macos.context.accentSetting || 'multicolor';
// Light, dark or following the system: the app's own choice, which the host remembers.
let appearance = macos.context.appearance || 'system';

const THEMES = {
  white: { bg: '#ffffff', fg: '#1d1d1f', muted: '#86868b', rule: '#e3e3e6', code: '#f3f3f5', selection: 'rgba(255,149,0,0.28)' },
  sepia: { bg: '#f8f1e3', fg: '#4f3d2b', muted: '#9a8670', rule: '#e4d7bf', code: '#efe5d2', selection: 'rgba(214,126,40,0.28)' },
  gray: { bg: '#4a4a4d', fg: '#ebebed', muted: '#acacb0', rule: '#5f5f63', code: '#404043', selection: 'rgba(255,179,64,0.35)' },
  night: { bg: '#141414', fg: '#d0d0d2', muted: '#7d7d82', rule: '#2c2c2e', code: '#1f1f21', selection: 'rgba(255,159,10,0.35)' }
};
const THEME_ORDER = ['auto', 'white', 'sepia', 'gray', 'night'];
const SERIF_CJK = '"Songti SC", "Hiragino Mincho ProN", "STSong", serif';
const SANS_CJK = '"PingFang SC", "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif';
const FONTS = [
  { value: 'serif', label: 'New York', stack: `ui-serif, "New York", "Iowan Old Style", Georgia, ${SERIF_CJK}` },
  { value: 'iowan', label: 'Iowan Old Style', stack: `"Iowan Old Style", Georgia, ${SERIF_CJK}` },
  { value: 'palatino', label: 'Palatino', stack: `Palatino, "Palatino Linotype", "Book Antiqua", ${SERIF_CJK}` },
  { value: 'georgia', label: 'Georgia', stack: `Georgia, ${SERIF_CJK}` },
  { value: 'charter', label: 'Charter', stack: `Charter, "Bitstream Charter", Georgia, ${SERIF_CJK}` },
  { value: 'athelas', label: 'Athelas', stack: `Athelas, Georgia, ${SERIF_CJK}` },
  { value: 'system', label: 'San Francisco', stack: `-apple-system, BlinkMacSystemFont, "Helvetica Neue", ${SANS_CJK}` },
  { value: 'avenir', label: 'Avenir Next', stack: `"Avenir Next", Avenir, ${SANS_CJK}` },
  { value: 'seravek', label: 'Seravek', stack: `Seravek, "Gill Sans", ${SANS_CJK}` }
];

// ---------------------------------------------------------------- persistence
try {
  const all = await macos.storage.get();
  if (all && typeof all === 'object') {
    const saved = all.library;
    if (saved && typeof saved === 'object') {
      lib = { ...lib, ...saved, reader: { ...lib.reader, ...(saved.reader || {}) }, collections: Array.isArray(saved.collections) ? saved.collections : [], stats: saved.stats && typeof saved.stats === 'object' ? saved.stats : {}, bookIds: Array.isArray(saved.bookIds) ? saved.bookIds : [] };
    }
    for (const [key, value] of Object.entries(all)) if (key.startsWith('book:') && value && typeof value === 'object' && value.id) books[value.id] = value;
  }
  // Should get() without a key not list everything, fetch the books one by one.
  for (const id of lib.bookIds) if (!books[id]) { const value = await macos.storage.get(`book:${id}`); if (value?.id) books[id] = value; }
} catch (error) { macos.log('load failed', String(error)); }

const dirtyBooks = new Set();
let libDirty = false;
let saveTimer = 0;
function save(book) {
  if (book) dirtyBooks.add(book.id); else libDirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
async function flush() {
  const ids = [...dirtyBooks]; dirtyBooks.clear();
  const writeLib = libDirty; libDirty = false;
  try {
    for (const id of ids) if (books[id]) await macos.storage.set(`book:${id}`, books[id]);
    if (writeLib) { lib.bookIds = Object.keys(books); await macos.storage.set('library', lib); }
  } catch (error) { macos.log('save failed', String(error)); }
  publishSearch();
  publishWidgets();
}
// Spotlight finds books by title and author; choosing one opens it (the 'search' event).
let searchSignature = '';
function publishSearch() {
  const items = Object.values(books).map((book) => ({ id: book.id, title: book.title || '', subtitle: book.author || '' })).filter((item) => item.title);
  const signature = JSON.stringify(items);
  if (signature === searchSignature) return;
  searchSignature = signature;
  macos.search.setItems(items).catch(() => {});
}

// ---------------------------------------------------------------- selectors
const allBooks = () => Object.values(books);
const bookOf = (id) => books[id] || null;
const collectionOf = (id = route.id) => lib.collections.find((item) => item.id === id) || null;
const readingBook = () => (reading ? bookOf(reading.id) : null);

const segCount = (book) => book.spine.reduce((sum, item) => sum + item.parts.length, 0);
function segIndex(book, pos = book.pos) {
  let index = 0;
  for (let s = 0; s < pos.s; s += 1) index += book.spine[s].parts.length;
  return index + pos.p;
}
function posAt(book, index) {
  let rest = Math.max(0, Math.min(segCount(book) - 1, index));
  for (let s = 0; s < book.spine.length; s += 1) {
    if (rest < book.spine[s].parts.length) return { s, p: rest };
    rest -= book.spine[s].parts.length;
  }
  return { s: 0, p: 0 };
}
const totalChars = (book) => book.spine.reduce((sum, item) => sum + item.parts.reduce((a, b) => a + b, 0), 0);
function charsBefore(book, pos = book.pos) {
  let chars = 0;
  for (let s = 0; s < pos.s; s += 1) chars += book.spine[s].parts.reduce((a, b) => a + b, 0);
  for (let p = 0; p < pos.p; p += 1) chars += book.spine[pos.s].parts[p] || 0;
  return chars + (pos.f || 0) * (book.spine[pos.s]?.parts[pos.p] || 0);
}
function progressOf(book, pos = book.pos) {
  if (book.finished) return 100;
  if (!book.opened) return 0;
  if (book.kind === 'comic') return Math.round(((pos.p + 1) / Math.max(1, book.pages.length)) * 100);
  return Math.min(99, Math.round((charsBefore(book, pos) / Math.max(1, totalChars(book))) * 100));
}
function statusText(book) {
  if (book.finished) return T('finished', 'Finished');
  if (!book.opened) return T('new', 'New');
  return `${progressOf(book)}%`;
}
const authorOf = (book) => book.author || T('unknownAuthor', 'Unknown Author');

const cmpPos = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// The table of contents in reading order, for "which chapter am I in".
function tocIndexAt(book, pos = book.pos) {
  const here = [pos.s, pos.p, (pos.f || 0) + 1e-6];
  let found = -1; let best = null;
  book.toc.forEach((entry, index) => {
    const at = [entry.s, entry.p || 0, anchorFraction(book, entry)];
    if (cmpPos(at, here) <= 0 && (!best || cmpPos(at, best) >= 0)) { found = index; best = at; }
  });
  return found;
}
function chapterTitle(book, pos = book.pos) {
  if (book.kind === 'comic') return fmt('pageOf', 'Page {n} of {total}', { n: pos.p + 1, total: book.pages.length });
  const index = tocIndexAt(book, pos);
  return index >= 0 ? book.toc[index].title : (book.spine[pos.s]?.title || book.title);
}

function sortBooks(list) {
  const by = lib.sort;
  const cmp = by === 'title' ? (a, b) => compare(a.title, b.title)
    : by === 'author' ? (a, b) => compare(authorOf(a), authorOf(b)) || compare(a.title, b.title)
      : by === 'added' ? (a, b) => (b.added || 0) - (a.added || 0)
        : (a, b) => (b.opened || b.added || 0) - (a.opened || a.added || 0);
  return [...list].sort(cmp);
}
function routeBooks() {
  let list = allBooks();
  if (route.kind === 'finished') list = list.filter((book) => book.finished);
  if (route.kind === 'comics') list = list.filter((book) => book.kind === 'comic');
  if (route.kind === 'coll') { const ids = collectionOf()?.bookIds || []; list = ids.map((id) => books[id]).filter(Boolean); }
  const needle = query.trim().toLocaleLowerCase();
  if (needle) list = list.filter((book) => `${book.title}\n${book.author}`.toLocaleLowerCase().includes(needle));
  return sortBooks(list);
}

// ---------------------------------------------------------------- covers
// Books without a cover of their own get a typographic one, drawn as SVG.
const PALETTES = [['#2f4858', '#f2d0a4'], ['#5b3758', '#f9d77e'], ['#344e41', '#e9e4c9'], ['#7a2e2e', '#f6dccb'], ['#1f3b73', '#f7b267'], ['#4a4e69', '#f2e9e4'], ['#264653', '#e9c46a'], ['#6d2e46', '#f6e7cb'], ['#3d405b', '#f4f1de'], ['#283618', '#fefae0']];
const coverCache = new Map();
const xmlEscape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
const isCjk = (ch) => /[぀-ヿ㐀-鿿豈-﫿가-힯]/.test(ch);
function wrapLines(text, maxLatin, maxCjk, maxLines) {
  const lines = [];
  if ([...text].filter(isCjk).length > text.length / 3) {
    const chars = [...text.replace(/\s+/g, '')];
    for (let i = 0; i < chars.length; i += maxCjk) lines.push(chars.slice(i, i + maxCjk).join(''));
  } else {
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > maxLatin) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.$/u, '')}…`; }
  return lines;
}
function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function generatedCover(book) {
  const key = `${book.id}\n${book.title}\n${book.author}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const [bg, ink] = PALETTES[hash(book.title || book.id) % PALETTES.length];
  const title = wrapLines(book.title || T('untitled', 'Untitled'), 14, 7, 5);
  const size = title.length > 3 ? 34 : 40;
  const top = 250 - (title.length * size * 1.2) / 2;
  const author = wrapLines(book.author || '', 26, 12, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="${bg}"/>`
    + `<rect x="22" y="22" width="356" height="556" fill="none" stroke="${ink}" stroke-opacity=".55" stroke-width="2"/>`
    + `<rect x="0" y="0" width="12" height="600" fill="#000" fill-opacity=".18"/>`
    + `<g font-family="Georgia, 'Songti SC', serif" fill="${ink}" text-anchor="middle">`
    + title.map((line, index) => `<text x="200" y="${Math.round(top + index * size * 1.2)}" font-size="${size}" font-weight="700">${xmlEscape(line)}</text>`).join('')
    + `<path d="M170 ${Math.round(top + title.length * size * 1.2 + 6)}h60" stroke="${ink}" stroke-width="2"/>`
    + author.map((line, index) => `<text x="200" y="${510 + index * 28}" font-size="22" font-style="italic">${xmlEscape(line)}</text>`).join('')
    + '</g></svg>';
  const url = `data:image/svg+xml;base64,${base64Utf8(svg)}`;
  coverCache.set(key, url);
  return url;
}
const artOf = (book) => (book.customCover ? `blob:${book.customCover}` : book.coverId ? `blob:${book.coverId}` : generatedCover(book));

// ---------------------------------------------------------------- reader theme
function themeColors() {
  const name = lib.reader.theme;
  if (name === 'auto' || !THEMES[name]) return systemTheme === 'dark' ? { ...THEMES.night, bg: '#1e1e1e' } : THEMES.white;
  return THEMES[name];
}
