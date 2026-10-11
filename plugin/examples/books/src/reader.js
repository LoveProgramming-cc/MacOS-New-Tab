// Books — the reader view and page preparation.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- view: reader
// The reader is laid out in pixels from the window size: an html node needs a definite
// size (a percentage of a parent without one leaves the frame at its 300 × 150 default).
const READER_TOP = 46; const READER_BOTTOM = 40; const PANE_WIDTH = 280; const PANE_TOP = 46; const NAV_WIDTH = 48; const SAFE = 6;
function readerGeometry() {
  const stage = Math.max(260, Math.round(win.width - (paneOpen ? PANE_WIDTH + 1 : 0) - NAV_WIDTH * 2));
  return { bodyHeight: Math.max(220, Math.round(win.height - READER_TOP - READER_BOTTOM - SAFE)), stageWidth: stage - (stage % 2) };
}

// Pagination. A chapter is flowed into CSS columns exactly one page tall; a spread shows
// one or two of them side by side, and turning the page slides the columns across. How
// many columns a chapter needs is found by laying the same HTML out with the same CSS in
// this sandbox's own document (same engine, same fonts), so the reader's frame never
// has to scroll and never cuts a line in half.
const PAGE_TOP = 30; const PAGE_BOTTOM = 42;
function pageLayout() {
  const { bodyHeight: H, stageWidth: W } = readerGeometry();
  const r = lib.reader;
  const n = r.columns === 'single' ? 1 : r.columns === 'double' ? 2 : (W >= 960 && W / H >= 1.3 ? 2 : 1);
  const maxText = n === 2 ? ({ narrow: 420, normal: 520, wide: 640 }[r.width] || 520) : ({ narrow: 520, normal: 660, wide: 860 }[r.width] || 660);
  const slot = W / n;
  const c = Math.round(Math.max(180, Math.min(maxText, slot - (n === 2 ? 64 : 80))));
  const g = slot - c;
  return { W, H, n, c, g, a: g / 2, slot, colH: H - PAGE_TOP - PAGE_BOTTOM, key: [W, H, n, c, r.font, r.size, r.spacing, r.justify ? 1 : 0].join('|') };
}
// Pictures get an exact size from the dimensions recorded at import, so the layout is
// the same whether or not the picture itself has been loaded.
function imageBox(img, L) {
  const w = img.w || 600; const h = img.h || 800;
  if (w <= 48 && h <= 48) return { w, h, inline: true };
  const width = Math.max(8, Math.floor(Math.min(w, L.c, (L.colH * 0.94 * w) / h)));
  return { w: width, h: Math.max(8, Math.round((width * h) / w)), inline: false };
}
function pageCss(th, L, shift = 0, imgs = [], scroll = false) {
  const r = lib.reader;
  const font = (FONTS.find((item) => item.value === r.font) || FONTS[0]).stack;
  const leading = { compact: 1.4, normal: 1.6, loose: 1.9 }[r.spacing] || 1.6;
  const images = imgs.map((img, i) => {
    const box = imageBox(img, L);
    return `.bk-flow .bki-${i} { width: ${box.w}px; height: ${box.h}px;${box.inline ? ' display: inline-block; margin: 0 0.1em; vertical-align: -0.15em;' : ''} }`;
  }).join('\n');
  const flow = scroll
    ? `overflow-y: auto; overflow-x: hidden; height: ${L.H - PAGE_TOP}px;`
    : `height: ${L.colH}px; column-width: ${L.c}px; column-gap: ${L.g}px; column-fill: auto; transform: translateX(${-shift}px);`;
  return `html, body { margin: 0; padding: 0; overflow: hidden; background: ${th.bg}; }
.bk-frame { position: relative; width: ${L.W}px; height: ${L.H}px; overflow: hidden; margin: 0; padding: 0; background: ${th.bg}; }
.bk-flow { position: absolute; top: ${PAGE_TOP}px; left: ${L.a}px; width: ${L.c}px; margin: 0; padding: 0; box-sizing: content-box; ${flow}
  color: ${th.fg}; font-family: ${font}; font-size: ${r.size}px; line-height: ${leading}; font-weight: 400; font-style: normal; letter-spacing: normal; word-spacing: normal; text-transform: none; text-indent: 0; white-space: normal;
  text-align: ${r.justify ? 'justify' : 'start'}; hyphens: auto; -webkit-hyphens: auto; overflow-wrap: break-word; widows: 1; orphans: 1; -webkit-font-smoothing: antialiased; }
.bk-flow p { margin: 0 0 0.8em; padding: 0; }
.bk-flow div, .bk-flow span { margin: 0; padding: 0; }
.bk-flow h1, .bk-flow h2, .bk-flow h3, .bk-flow h4, .bk-flow h5, .bk-flow h6 { line-height: 1.25; margin: 1.1em 0 0.6em; padding: 0; font-weight: 700; text-align: start; break-after: avoid; }
.bk-flow h1 { font-size: 1.6em; } .bk-flow h2 { font-size: 1.35em; } .bk-flow h3 { font-size: 1.15em; } .bk-flow h4, .bk-flow h5, .bk-flow h6 { font-size: 1em; }
.bk-flow > :first-child, .bk-flow > :first-child > :first-child { margin-top: 0; }
.bk-flow > :last-child, .bk-flow > :last-child > :last-child { margin-bottom: 0; }
.bk-flow .bk-img { display: block; margin: 0.6em auto; padding: 0; border: 0; break-inside: avoid; object-fit: contain; }
.bk-flow figure { margin: 1em 0; padding: 0; break-inside: avoid; }
.bk-flow figcaption { font-size: 0.85em; color: ${th.muted}; text-align: center; }
.bk-flow blockquote { margin: 1em 0 1em 0.4em; padding: 0 0 0 1em; border-left: 3px solid ${th.rule}; color: ${th.muted}; }
.bk-flow hr { border: 0; border-top: 1px solid ${th.rule}; margin: 1.5em 25%; height: 0; }
.bk-flow pre, .bk-flow code, .bk-flow kbd, .bk-flow samp { font-family: ui-monospace, Menlo, monospace; font-size: 0.88em; }
.bk-flow pre { white-space: pre-wrap; background: ${th.code}; padding: 0.8em 1em; border-radius: 6px; margin: 0 0 0.8em; }
.bk-flow table { border-collapse: collapse; margin: 1em 0; font-size: 0.92em; max-width: 100%; }
.bk-flow td, .bk-flow th { border: 1px solid ${th.rule}; padding: 0.3em 0.6em; }
.bk-flow ul, .bk-flow ol { margin: 0 0 0.8em; padding: 0 0 0 1.6em; } .bk-flow li { margin: 0.2em 0; }
.bk-flow dl { margin: 0 0 0.8em; } .bk-flow dt { font-weight: 700; } .bk-flow dd { margin: 0 0 0.6em 1.4em; }
.bk-flow sup, .bk-flow sub { line-height: 0; font-size: 0.72em; }
.bk-flow ruby rt { font-size: 0.55em; }
.bk-folio { position: absolute; bottom: 14px; width: ${L.c}px; text-align: center; font: 500 11px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: ${th.muted}; }
.bk-folio-0 { left: ${L.a}px; } .bk-folio-1 { left: ${L.a + L.slot}px; }
::selection { background: ${th.selection}; }
${images}`;
}

// ---------------------------------------------------------------- page preparation
const chapterCache = new Map();   // `${bookId}:${s}` -> [part html…]
const partCache = new Map();      // `${bookId}:${s}:${p}` -> { template, measureHtml, imgs, text }
const layoutCache = new Map();    // part key + layout key -> { count, anchors, imageCols, scroll }
const spreadCache = new Map();    // part key + layout key + spread -> frame html
const imageCache = new Map();     // fileId -> data: URL
const pageErrors = new Map();
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const partKey = (book, s, p) => `${book.id}:${s}:${p}`;
const layoutKey = (book, s, p, L) => `${partKey(book, s, p)}|${L.key}`;
const spreadKey = (book, s, p, k, L) => `${layoutKey(book, s, p, L)}|${k}`;
function remember(map, key, value, limit) {
  map.delete(key); map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}
function forgetBook(id) {
  for (const map of [chapterCache, partCache, layoutCache, spreadCache, pageErrors]) for (const key of [...map.keys()]) if (key.startsWith(`${id}:`)) map.delete(key);
}
async function loadChapter(book, s) {
  const key = `${book.id}:${s}`;
  if (chapterCache.has(key)) return chapterCache.get(key);
  const text = await macos.files.read(book.spine[s].fileId, { as: 'text' });
  const parts = String(text).split(PART_MARK);
  remember(chapterCache, key, parts, 6);
  return parts;
}
// Stored parts reference pictures as bkimg:<file id>|<width>|<height>.
function parsePart(raw) {
  const imgs = [];
  const template = String(raw).replace(/<img src="bkimg:([^"|]*)(?:\|(\d+)\|(\d+))?"([^>]*)>/g, (match, id, w, h, rest) => {
    const i = imgs.push({ id, w: Number(w) || 0, h: Number(h) || 0 }) - 1;
    return `<img class="bk-img bki-${i}" src="@@SRC${i}@@"${rest}>`;
  });
  const measureHtml = template.replace(/<img class="bk-img bki-(\d+)"[^>]*>/g, '<span class="bk-img bki-$1"></span>');
  const text = template.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  return { template, measureHtml, imgs, text };
}
async function loadPart(book, s, p) {
  const key = partKey(book, s, p);
  if (partCache.has(key)) return partCache.get(key);
  const parts = await loadChapter(book, s);
  const part = parsePart(parts[p] ?? '');
  remember(partCache, key, part, 8);
  return part;
}

// The measuring surface: a hidden element of this sandbox with a shadow root, so the
// page CSS applies to the measured copy and nothing else.
let measureRoot = null;
function measureSurface() {
  if (measureRoot) return measureRoot;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;';
  (document.body || document.documentElement).appendChild(host);
  measureRoot = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  return measureRoot;
}
function measurePart(part, L) {
  const root = measureSurface();
  if (!root) return null;
  const css = pageCss(themeColors(), L, 0, part.imgs);
  let adopted = false;
  try { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); root.adoptedStyleSheets = [sheet]; adopted = true; } catch {}
  root.innerHTML = `${adopted ? '' : `<style>${css}</style>`}<div class="bk-frame"><div class="bk-flow">${part.measureHtml}</div></div>`;
  const flow = root.querySelector('.bk-flow');
  const box = flow?.getBoundingClientRect();
  const width = flow ? flow.scrollWidth : 0;
  if (!width || !box?.height) { root.innerHTML = ''; return null; }
  const count = Math.max(1, Math.round((width + L.g) / L.slot));
  const colOf = (el) => Math.max(0, Math.min(count - 1, Math.floor((el.getBoundingClientRect().left - box.left + 1) / L.slot)));
  const anchors = {};
  for (const el of root.querySelectorAll('.bk-flow [id]')) anchors[el.id] = colOf(el);
  const imageCols = part.imgs.map((_, i) => { const el = root.querySelector(`.bki-${i}`); return el ? colOf(el) : -1; });
  root.innerHTML = '';
  return { count, anchors, imageCols, scroll: false };
}
async function ensureLayout(book, s, p, L = pageLayout()) {
  const key = layoutKey(book, s, p, L);
  if (layoutCache.has(key)) return layoutCache.get(key);
  const part = await loadPart(book, s, p);
  // Should this sandbox not lay anything out, the part is shown as one scrolling page.
  const info = measurePart(part, L) || { count: 1, anchors: {}, imageCols: part.imgs.map(() => 0), scroll: true };
  remember(layoutCache, key, info, 40);
  return info;
}
const colFor = (book, info, pos = book.pos) => Math.max(0, Math.min(info.count - 1, Math.floor((pos.f || 0) * info.count + 1e-6)));
const spreadOf = (book, info, L, pos = book.pos) => Math.floor(colFor(book, info, pos) / L.n);
async function imageUrl(fileId) {
  if (imageCache.has(fileId)) return imageCache.get(fileId);
  const url = await macos.files.read(fileId, { as: 'dataUrl' });
  remember(imageCache, fileId, url, 30);
  return url;
}
// Page numbers count from the start of the spine item (usually one chapter).
function pageOffset(book, s, p, L) {
  let offset = 0;
  for (let q = 0; q < p; q += 1) { const info = layoutCache.get(layoutKey(book, s, q, L)); if (!info || info.scroll) return null; offset += info.count; }
  return offset;
}
async function ensureSpread(book, s, p, k, L) {
  const key = spreadKey(book, s, p, k, L);
  if (spreadCache.has(key)) return spreadCache.get(key);
  const part = await loadPart(book, s, p);
  const info = await ensureLayout(book, s, p, L);
  const lo = k * L.n; const hi = lo + L.n;
  // Only the pictures on this spread are inlined; the rest keep their size, empty.
  const srcs = await Promise.all(part.imgs.map((img, i) => ((info.scroll || (info.imageCols[i] >= lo && info.imageCols[i] < hi)) && img.id ? imageUrl(img.id).catch(() => '') : '')));
  const body = part.template.replace(/@@SRC(\d+)@@/g, (match, i) => srcs[Number(i)] || TRANSPARENT);
  const offset = info.scroll ? null : pageOffset(book, s, p, L);
  let folios = '';
  if (offset != null) for (let i = 0; i < L.n; i += 1) if (lo + i < info.count) folios += `<div class="bk-folio bk-folio-${i}">${offset + lo + i + 1}</div>`;
  const html = `<div class="bk-frame"><div class="bk-flow">${body}</div>${folios}</div>`;
  remember(spreadCache, key, html, 10);
  return html;
}

let preparing = '';
function prepareCurrent() {
  const book = readingBook();
  if (!book || book.kind === 'comic') return;
  const L = pageLayout(); const { s, p } = book.pos;
  const info = layoutCache.get(layoutKey(book, s, p, L));
  const target = info ? spreadKey(book, s, p, spreadOf(book, info, L), L) : layoutKey(book, s, p, L);
  if (info && spreadCache.has(target)) { prefetchAround(book, L); return; }
  if (preparing === target || pageErrors.has(partKey(book, s, p))) return;
  preparing = target;
  (async () => {
    const measured = await ensureLayout(book, s, p, L);
    await ensureSpread(book, s, p, spreadOf(book, measured, L), L);
  })().then(() => { preparing = ''; render(); }).catch((error) => {
    preparing = ''; pageErrors.set(partKey(book, s, p), String(error?.message || error)); render();
  });
}
// Have the neighbouring spreads ready before they are asked for.
let prefetchTimer = 0;
function prefetchAround(book, L) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    try {
      const { s, p } = book.pos;
      const info = await ensureLayout(book, s, p, L);
      const k = spreadOf(book, info, L); const spreads = Math.ceil(info.count / L.n);
      if (k + 1 < spreads) await ensureSpread(book, s, p, k + 1, L);
      else if (segIndex(book) + 1 < segCount(book)) { const at = posAt(book, segIndex(book) + 1); await ensureSpread(book, at.s, at.p, 0, L); }
      if (k > 0) await ensureSpread(book, s, p, k - 1, L);
      else if (segIndex(book) > 0) { const at = posAt(book, segIndex(book) - 1); const prev = await ensureLayout(book, at.s, at.p, L); await ensureSpread(book, at.s, at.p, Math.ceil(prev.count / L.n) - 1, L); }
    } catch {}
  }, 150);
}

// Where the table-of-contents entries and bookmarks fall, in the current layout.
function anchorFraction(book, entry, L = pageLayout()) {
  if (!entry.a) return 0;
  const info = layoutCache.get(layoutKey(book, entry.s, entry.p || 0, L));
  return info && info.anchors[entry.a] != null ? info.anchors[entry.a] / info.count : 0;
}
function bookmarkAt(book, pos = book.pos) {
  const marks = book.bookmarks || [];
  if (book.kind === 'comic') return marks.find((mark) => mark.p === pos.p) || null;
  const L = pageLayout();
  const info = layoutCache.get(layoutKey(book, pos.s, pos.p, L));
  if (!info) return marks.find((mark) => mark.s === pos.s && mark.p === pos.p && Math.abs((mark.f || 0) - (pos.f || 0)) < 0.002) || null;
  const lo = spreadOf(book, info, L, pos) * L.n;
  return marks.find((mark) => mark.s === pos.s && mark.p === pos.p && colFor(book, info, mark) >= lo && colFor(book, info, mark) < lo + L.n) || null;
}
// Pages from the end of this spread to the start of the next chapter.
function pagesLeftInChapter(book, L, info) {
  if (!info || info.scroll) return null;
  const start = spreadOf(book, info, L) * L.n; const end = start + L.n;
  const here = [book.pos.s, book.pos.p, (start + 0.5) / info.count];
  let next = null;
  for (const entry of book.toc) {
    const at = [entry.s, entry.p || 0, anchorFraction(book, entry, L)];
    if (cmpPos(at, here) > 0 && (!next || cmpPos(at, next) < 0)) next = at;
  }
  if (next && next[0] === book.pos.s && next[1] === book.pos.p) return Math.max(0, Math.round(next[2] * info.count) - end);
  const partChars = book.spine[book.pos.s].parts[book.pos.p] || 1;
  const perColumn = partChars / info.count;
  let columns = info.count - end;
  let index = segIndex(book) + 1;
  const stop = next ? segIndex(book, { s: next[0], p: next[1] }) : segCount(book);
  for (; index < stop; index += 1) { const at = posAt(book, index); columns += (book.spine[at.s].parts[at.p] || 0) / perColumn; }
  return Math.max(0, Math.ceil(columns));
}

function pageNode(book, th) {
  const L = pageLayout();
  const transition = reading.turn === 'next' ? 'slide-left' : reading.turn === 'prev' ? 'slide-right' : '';
  const { s, p } = book.pos;
  let id; let child;
  if (book.kind === 'comic') {
    id = `page:${p}`;
    child = { type: 'image', id: `page-img:${p}`, src: `blob:${book.pages[p]}`, fit: 'contain', width: L.W, height: L.H, alt: chapterTitle(book) };
  } else {
    const info = layoutCache.get(layoutKey(book, s, p, L));
    const k = info ? spreadOf(book, info, L) : 0;
    id = `page:${s}.${p}.${k}`;
    const html = info ? spreadCache.get(spreadKey(book, s, p, k, L)) : null;
    const error = pageErrors.get(partKey(book, s, p));
    if (html != null) child = { type: 'html', id: `page-html:${s}.${p}.${k}`, html, css: pageCss(th, L, k * L.W, partCache.get(partKey(book, s, p))?.imgs || [], info.scroll), width: L.W, height: L.H };
    else if (error) child = { type: 'stack', width: L.W, height: L.H, align: 'center', justify: 'center', children: [{ type: 'text', text: error, color: th.muted }] };
    else child = { type: 'stack', width: L.W, height: L.H, align: 'center', justify: 'center', children: [{ type: 'progress', width: 140 }] };
  }
  currentPageId = id;
  return { type: 'stack', id, direction: 'vertical', gap: 0, width: L.W, height: L.H, background: th.bg, ...(transition ? { transition } : {}), children: [child] };
}
let currentPageId = '';

function readerPane(book) {
  // The pane is a sidebar in its own right: full height, showing the window material
  // (frosted wallpaper) like the library's sidebar, beside the page rather than on it.
  const listHeight = Math.max(120, win.height - PANE_TOP - 56);
  const comic = book.kind === 'comic';
  const tocIndex = tocIndexAt(book);
  const marks = [...(book.bookmarks || [])].sort((a, b) => charsBefore(book, a) - charsBefore(book, b));
  const dates = new Intl.DateTimeFormat(macos.i18n.language(), { dateStyle: 'medium' });
  const contents = comic
    ? { type: 'list', id: 'toc', height: listHeight, plain: true, rowHeight: 64, iconSize: 46, value: `t:${book.pos.p}`,
      items: book.pages.map((fileId, index) => ({ id: `t:${index}`, icon: `blob:${fileId}`, title: fmt('pageN', 'Page {n}', { n: index + 1 }) })) }
    : { type: 'list', id: 'toc', height: listHeight, plain: true, rowHeight: 30, value: tocIndex >= 0 ? `t:${tocIndex}` : '', placeholder: T('noContents', 'This book has no table of contents.'),
      items: book.toc.map((entry, index) => ({ id: `t:${index}`, title: entry.title, indent: Math.min(3, entry.depth || 0) })) };
  return { type: 'stack', id: 'r-panel', direction: 'vertical', width: PANE_WIDTH, height: 'fill', gap: 10, padding: [PANE_TOP, 8, 8, 10], material: 'sidebar', radius: 0, children: [
    { type: 'segmented', id: 'pane-tab', value: paneTab, options: [{ value: 'toc', label: comic ? T('pages', 'Pages') : T('contents', 'Contents') }, { value: 'bookmarks', label: T('bookmarks', 'Bookmarks') }] },
    paneTab === 'toc' ? contents : { type: 'list', id: 'bookmarks', height: listHeight, plain: true, rowHeight: 46, iconSize: 16, placeholder: T('noBookmarks', 'No bookmarks yet. Use the bookmark button to mark a page.'),
      items: marks.map((mark) => ({ id: `b:${mark.id}`, icon: ICON('bookmark-fill'), tint: true, title: mark.label, subtitle: `${progressOf({ ...book, finished: false, opened: 1 }, mark)}% · ${dates.format(mark.at)}` })),
      itemMenu: [{ id: 'bm-go', label: T('goToBookmark', 'Go to Bookmark') }, { separator: true }, { id: 'bm-delete', label: T('delete', 'Delete'), danger: true }] }
  ] };
}

function appearancePanel(th, comic) {
  const r = lib.reader;
  const swatch = { auto: systemTheme === 'dark' ? '#1e1e1e' : '#ffffff', ...Object.fromEntries(Object.entries(THEMES).map(([name, value]) => [name, value.bg])) };
  const ink = { auto: systemTheme === 'dark' ? '#d0d0d2' : '#1d1d1f', ...Object.fromEntries(Object.entries(THEMES).map(([name, value]) => [name, value.fg])) };
  const names = { auto: T('themeAuto', 'Automatic'), white: T('themeWhite', 'White'), sepia: T('themeSepia', 'Sepia'), gray: T('themeGray', 'Gray'), night: T('themeNight', 'Night') };
  return { type: 'stack', id: 'appearance', direction: 'vertical', gap: 12, width: 300, padding: 16, radius: 14, material: 'glass', alignSelf: 'start', justifySelf: 'end', margin: [46, 14, 0, 0], transition: 'fade', dismissable: true, children: [
    ...(comic ? [] : [{ type: 'stack', direction: 'horizontal', gap: 8, align: 'center', children: [
      { type: 'button', id: 'size-down', label: 'A', fontSize: 12, grow: 1, disabled: r.size <= 12, tooltip: T('menuSmaller', 'Smaller Text') },
      { type: 'text', id: 'size-value', text: `${r.size} pt`, fontSize: 12, color: 'secondary', width: 44, textAlign: 'center' },
      { type: 'button', id: 'size-up', label: 'A', fontSize: 19, fontWeight: 'semibold', grow: 1, disabled: r.size >= 34, tooltip: T('menuBigger', 'Bigger Text') }
    ] }]),
    { type: 'stack', direction: 'horizontal', justify: 'between', align: 'center', children: THEME_ORDER.map((name) => ({
      type: 'button', id: `theme-${name}`, shape: 'circle', width: 38, height: 38, background: swatch[name], color: ink[name], border: true,
      label: r.theme === name ? '✓' : name === 'auto' ? 'A' : 'Aa', fontSize: r.theme === name ? 15 : 12, fontWeight: 'semibold', tooltip: names[name]
    })) },
    ...(comic ? [] : [
      { type: 'select', id: 'font', value: r.font, options: FONTS.map(({ value, label }) => ({ value, label })) },
      { type: 'text', text: T('pageLayoutLabel', 'Pages'), variant: 'caption' },
      { type: 'segmented', id: 'columns', width: 'fill', value: r.columns || 'auto', options: [{ value: 'auto', label: T('columnsAuto', 'Automatic') }, { value: 'single', label: T('columnsSingle', 'Single') }, { value: 'double', label: T('columnsDouble', 'Two Pages') }] },
      { type: 'text', text: T('lineSpacing', 'Line Spacing'), variant: 'caption' },
      { type: 'segmented', id: 'spacing', width: 'fill', value: r.spacing, options: [{ value: 'compact', label: T('compact', 'Compact') }, { value: 'normal', label: T('normal', 'Normal') }, { value: 'loose', label: T('loose', 'Loose') }] },
      { type: 'text', text: T('pageWidth', 'Page Width'), variant: 'caption' },
      { type: 'segmented', id: 'width', width: 'fill', value: r.width, options: [{ value: 'narrow', label: T('narrow', 'Narrow') }, { value: 'normal', label: T('normal', 'Normal') }, { value: 'wide', label: T('wide', 'Wide') }] },
      { type: 'switch', id: 'justify', checked: r.justify, label: T('justify', 'Justify Text') }
    ])
  ] };
}

function readerStatus(book) {
  const pct = progressOf({ ...book, finished: false, opened: 1 });
  if (book.kind === 'comic') return `${pct}%`;
  const L = pageLayout();
  const left = pagesLeftInChapter(book, L, layoutCache.get(layoutKey(book, book.pos.s, book.pos.p, L)));
  if (left == null) return `${pct}%`;
  return `${left === 0 ? T('lastPageOfChapter', 'Last page in chapter') : left === 1 ? T('onePageLeft', '1 page left in chapter') : fmt('pagesLeftChapter', '{n} pages left in chapter', { n: left })} · ${pct}%`;
}
const scrubValue = (book) => (book.kind === 'comic' ? book.pos.p : Math.round((charsBefore(book) / Math.max(1, totalChars(book))) * 1000));

function readerView() {
  const book = readingBook();
  const th = themeColors();
  const marked = bookmarkAt(book);
  const { bodyHeight } = readerGeometry();
  const L = pageLayout();
  const btn = (id, icon, extra = {}) => iconButton(id, icon, { color: th.muted, ...extra });
  const atStart = book.kind === 'comic' ? book.pos.p === 0 : segIndex(book) === 0 && (book.pos.f || 0) < 1e-6;
  const scrubMax = book.kind === 'comic' ? Math.max(1, book.pages.length - 1) : 1000;
  // Sidebar (glass) | page column (the reading theme's paper). With the sidebar closed the
  // toolbar leaves room for the traffic lights; with it open they sit over the sidebar.
  return { type: 'zstack', id: 'reader', transition: 'scale', children: [
    { type: 'stack', id: 'r-main', direction: 'horizontal', gap: 0, height: 'fill', children: [
      ...(paneOpen ? [readerPane(book), { type: 'separator', id: 'r-divider', vertical: true }] : []),
      { type: 'stack', id: 'r-column', direction: 'vertical', gap: 0, grow: 1, minWidth: 0, height: 'fill', background: th.bg, children: [
        { type: 'stack', id: 'r-top', direction: 'horizontal', align: 'center', gap: 2, height: READER_TOP, padding: [0, 12, 0, paneOpen ? 12 : 82], children: [
          btn('r-back', 'chevron-left', { tooltip: T('backToLibrary', 'Library') }),
          btn('r-pane', 'toc', { color: paneOpen ? 'accent' : th.muted, tooltip: T('contentsAndBookmarks', 'Contents & Bookmarks') }),
          { type: 'text', id: 'r-title', text: book.title, grow: 1, minWidth: 0, textAlign: 'center', lines: 1, fontSize: 12.5, fontWeight: 'semibold', color: th.muted },
          btn('r-appearance', 'textformat', { color: appearanceOpen ? 'accent' : th.muted, tooltip: T('appearance', 'Appearance') }),
          btn('r-bookmark', marked ? 'bookmark-fill' : 'bookmark', { color: marked ? 'accent' : th.muted, tooltip: marked ? T('removeBookmark', 'Remove Bookmark') : T('menuBookmark', 'Add Bookmark') }),
          btn('r-more', 'ellipsis', { tooltip: T('more', 'More') })
        ] },
        // The pages run left to right whatever the language of the interface, and so do the
        // arrows that turn them (← back, → forward), as the arrow keys do.
        { type: 'stack', id: 'r-stage', ltr: true, direction: 'horizontal', gap: 0, height: bodyHeight, align: 'center', children: [
          btn('r-prev', 'chevron-left', { showOnHover: true, iconSize: 20, width: 36, height: 36, alignSelf: 'center', margin: [0, 4, 0, 8], disabled: atStart }),
          { type: 'zstack', id: 'r-pages', width: L.W, height: L.H, children: [pageNode(book, th)] },
          btn('r-next', 'chevron-right', { showOnHover: true, iconSize: 20, width: 36, height: 36, alignSelf: 'center', margin: [0, 8, 0, 4] })
        ] },
        { type: 'stack', id: 'r-bottom', direction: 'horizontal', align: 'center', gap: 14, height: READER_BOTTOM, padding: [0, 24, 2, 24], children: [
          { type: 'text', id: 'r-chapter', text: chapterTitle(book), lines: 1, fontSize: 11.5, color: th.muted, width: paneOpen ? 170 : 230 },
          { type: 'slider', id: 'r-scrub', ltr: true, grow: 1, min: 0, max: scrubMax, step: 1, value: scrubValue(book) },
          { type: 'text', id: 'r-left', text: readerStatus(book), lines: 1, fontSize: 11.5, color: th.muted, width: paneOpen ? 170 : 230, textAlign: 'end' }
        ] }
      ] }
    ] },
    ...(appearanceOpen ? [appearancePanel(th, book.kind === 'comic')] : []),
    ...(finishedSheet ? [finishedView()] : [])
  ] };
}
