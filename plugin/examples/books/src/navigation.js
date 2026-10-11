// Books — moving through a book.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- navigation
let lastActive = Date.now();
let navToken = 0;
function goTo(book, pos, turn = '') {
  if (!book) return;
  const f = Math.max(0, Math.min(0.999999, pos.f || 0));
  if (pos.s === book.pos.s && pos.p === book.pos.p && Math.abs(f - (book.pos.f || 0)) < 1e-9) return;
  // The page on screen loses its own arrival transition before it is replaced.
  if (currentPageId) patch(currentPageId, { transition: null });
  book.pos = { s: pos.s, p: pos.p, f };
  book.opened = Date.now();
  reading.turn = turn;
  save(book); render();
}
function finishBook(book) {
  if (!book.finished) { book.finished = true; book.finishedAt = Date.now(); save(book); }
  finishedSheet = book.id; render();
}
async function step(delta) {
  const book = readingBook();
  if (!book) return;
  const token = ++navToken;
  if (book.kind === 'comic') {
    const next = book.pos.p + delta;
    if (next < 0) return;
    if (next >= book.pages.length) return finishBook(book);
    return goTo(book, { s: 0, p: next, f: 0 }, delta > 0 ? 'next' : 'prev');
  }
  const L = pageLayout();
  const { s, p } = book.pos;
  const info = await ensureLayout(book, s, p, L);
  if (token !== navToken || readingBook() !== book) return;
  const target = (spreadOf(book, info, L) + delta) * L.n;
  if (target >= 0 && target < info.count) return goTo(book, { s, p, f: target / info.count }, delta > 0 ? 'next' : 'prev');
  const index = segIndex(book) + delta;
  if (index >= segCount(book)) return finishBook(book);
  if (index < 0) return;
  const at = posAt(book, index);
  if (delta > 0) return goTo(book, { ...at, f: 0 }, 'next');
  const prev = await ensureLayout(book, at.s, at.p, L);
  if (token !== navToken || readingBook() !== book) return;
  goTo(book, { ...at, f: (Math.ceil(prev.count / L.n) - 1) * L.n / prev.count }, 'prev');
}
// Go to a part, at an anchor inside it if there is one.
async function jumpTo(book, s, p, anchor = '', turn = '') {
  const token = ++navToken;
  let f = 0;
  if (anchor && book.kind !== 'comic') {
    const info = await ensureLayout(book, s, p);
    if (token !== navToken || readingBook() !== book) return;
    if (info.anchors[anchor] != null) f = info.anchors[anchor] / info.count;
  }
  goTo(book, { s, p, f }, turn);
}
function chapterStep(delta) {
  const book = readingBook();
  if (!book) return;
  if (book.kind === 'comic') return goTo(book, { s: 0, p: Math.max(0, Math.min(book.pages.length - 1, book.pos.p + delta * 10)), f: 0 }, delta > 0 ? 'next' : 'prev');
  const L = pageLayout();
  const here = [book.pos.s, book.pos.p, book.pos.f || 0];
  const starts = [...book.toc.map((entry) => ({ s: entry.s, p: entry.p || 0, a: entry.a || '', at: [entry.s, entry.p || 0, anchorFraction(book, entry, L)] })),
    ...book.spine.map((_, s) => ({ s, p: 0, a: '', at: [s, 0, 0] }))].sort((x, y) => cmpPos(x.at, y.at));
  const target = delta > 0 ? starts.find((entry) => cmpPos(entry.at, here) > 1e-9) : [...starts].reverse().find((entry) => cmpPos(entry.at, here) < -1e-9);
  if (target) jumpTo(book, target.s, target.p, target.a, delta > 0 ? 'next' : 'prev');
}
function posFromFraction(book, x) {
  if (book.kind === 'comic') return { s: 0, p: Math.max(0, Math.min(book.pages.length - 1, Math.round(x * (book.pages.length - 1)))), f: 0 };
  let rest = Math.max(0, Math.min(1, x)) * totalChars(book);
  for (let s = 0; s < book.spine.length; s += 1) {
    for (let p = 0; p < book.spine[s].parts.length; p += 1) {
      const size = book.spine[s].parts[p];
      const last = s === book.spine.length - 1 && p === book.spine[s].parts.length - 1;
      if (rest < size || last) return { s, p, f: size ? Math.max(0, Math.min(0.999, rest / size)) : 0 };
      rest -= size;
    }
  }
  return { s: 0, p: 0, f: 0 };
}
function openBook(id) {
  const book = bookOf(id);
  if (!book) return;
  book.pos = { s: 0, p: 0, f: 0, ...book.pos };
  if (book.finished && charsBefore(book) / Math.max(1, totalChars(book)) > 0.98) book.pos = { s: 0, p: 0, f: 0 };
  reading = { id, turn: '' };
  appearanceOpen = false; finishedSheet = '';
  book.opened = Date.now();
  lastActive = Date.now();
  save(book); render();
}
function closeBook() { reading = null; appearanceOpen = false; finishedSheet = ''; render(); }
function toggleBookmark() {
  const book = readingBook();
  if (!book) return;
  book.bookmarks = book.bookmarks || [];
  const existing = bookmarkAt(book);
  if (existing) book.bookmarks = book.bookmarks.filter((mark) => mark !== existing);
  else {
    let label = chapterTitle(book);
    const L = pageLayout();
    const info = layoutCache.get(layoutKey(book, book.pos.s, book.pos.p, L));
    const f = info && book.kind !== 'comic' ? (spreadOf(book, info, L) * L.n) / info.count : (book.pos.f || 0);
    const part = partCache.get(partKey(book, book.pos.s, book.pos.p));
    if (part?.text && book.kind !== 'comic') {
      const start = Math.floor(part.text.length * f);
      const snippet = part.text.slice(start, start + 80).trim();
      const rest = snippet.startsWith(label) ? snippet.slice(label.length).trim() : snippet;
      if (rest) label = `${label} — ${rest.slice(0, 40)}…`;
    }
    book.bookmarks.push({ id: uid('m'), s: book.pos.s, p: book.pos.p, f, label, at: Date.now() });
  }
  save(book); render();
}
function showPane(tab) {
  const book = readingBook();
  if (!book) return;
  if (tab) paneTab = tab;
  paneOpen = true; render();
  // Bring the current chapter into view in a long table of contents.
  const index = book.kind === 'comic' ? book.pos.p : tocIndexAt(book);
  if (paneTab === 'toc' && index >= 0) setTimeout(() => { try { macos.ui.scrollTo('toc', { itemId: `t:${index}` })?.catch?.(() => {}); } catch {} }, 60);
}
function setReader(changes) { lib.reader = { ...lib.reader, ...changes }; save(); render(); }

// Books imported before pagination are rebuilt from their original file, keeping the
// reader's place, bookmarks and any edits to title, author and cover.
async function upgradeBook(book) {
  const total = Math.max(1, totalChars(book));
  const progress = charsBefore(book) / total;
  const marks = (book.bookmarks || []).map((mark) => ({ ...mark, x: charsBefore(book, mark) / total }));
  const pkg = new Package(await macos.archive.extract(book.sourceId));
  let fresh;
  try { fresh = await importEpub({ id: book.sourceId, name: book.sourceName, size: book.size }, pkg, () => {}); } finally { await pkg.cleanup(); }
  const oldFiles = book.files || [];
  Object.assign(book, { spine: fresh.spine, toc: fresh.toc, files: fresh.files, coverId: fresh.coverId, cpm: fresh.cpm, format: fresh.format });
  book.pos = posFromFraction(book, progress);
  book.bookmarks = marks.map(({ x, ...mark }) => ({ ...mark, ...posFromFraction(book, x) }));
  for (const id of oldFiles) if (!book.files.includes(id) && id !== book.sourceId && id !== book.customCover) await macos.files.remove(id).catch(() => {});
  forgetBook(book.id);
  save(book);
}
async function upgradeBooks() {
  const old = allBooks().filter((book) => book.kind === 'epub' && book.format !== FORMAT && book.sourceId);
  for (let i = 0; i < old.length; i += 1) {
    importing = { done: i, total: old.length, name: old[i].title, upgrading: true }; render();
    try { await upgradeBook(old[i]); } catch (error) { macos.log('upgrade failed', old[i].title, String(error?.message || error)); }
  }
  if (old.length) { importing = null; render(); }
}
