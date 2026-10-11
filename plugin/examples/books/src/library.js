// Books — library actions: import, delete, collections, export.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- library actions
const isBookFile = (file) => /\.(epub|cbz|zip)$/i.test(file.name || '') || ['application/epub+zip', 'application/zip', 'application/x-cbz', 'application/vnd.comicbook+zip'].includes(file.type);
const isImage = (file) => /^image\//.test(file.type || '') || isImagePath(file.name || '');

async function importFiles(files) {
  const queue = []; const skipped = [];
  for (const file of files) {
    if (isBookFile(file)) queue.push(file);
    else { skipped.push(file.name); await macos.files.remove(file.id).catch(() => {}); }
  }
  const failures = []; const added = [];
  for (let i = 0; i < queue.length; i += 1) {
    const file = queue[i];
    importing = { done: i, total: queue.length, name: file.name };
    render();
    if (allBooks().some((book) => book.sourceName === file.name && book.size === file.size)) {
      skipped.push(`${file.name} (${T('alreadyInLibrary', 'already in the library')})`);
      await macos.files.remove(file.id).catch(() => {});
      continue;
    }
    let pkg = null;
    try {
      pkg = new Package(await macos.archive.extract(file.id));
      const report = (i, n) => { importing.sub = n ? i / n : 0; patch('import-progress', { value: importing.done + importing.sub, max: Math.max(1, importing.total) }); };
      let book;
      if (pkg.get('META-INF/container.xml')) book = await importEpub(file, pkg, report);
      else if (pkg.images().length) book = await importComic(file, pkg, report);
      else throw new Error(T('notABook', 'This file is neither an EPUB book nor a comic archive.'));
      books[book.id] = book;
      if (route.kind === 'coll' && collectionOf()) collectionOf().bookIds.push(book.id);
      added.push(book);
      save(book); save();
    } catch (error) {
      failures.push(`${file.name}: ${String(error?.message || error)}`);
      await macos.files.remove(file.id).catch(() => {});
    } finally {
      if (pkg) await pkg.cleanup();
    }
  }
  importing = null; render();
  if (skipped.length) notify({ title: T('someSkipped', 'Some files were skipped'), body: skipped.join(', ').slice(0, 200) });
  if (failures.length) await macos.dialog.alert(failures.join('\n'), { title: T('importFailed', 'Import failed') });
  else if (added.length) notify({ title: added.length === 1 ? added[0].title : fmt('booksAdded', '{n} books added', { n: added.length }), body: added.length === 1 ? T('bookAdded', 'Added to your library.') : '' });
}
const pick = (options) => macos.dialog.openFile({ store: true, ...options });
async function importDialog() {
  try {
    const files = await pick({ accept: '.epub,.cbz,.zip,application/epub+zip,application/zip', multiple: true });
    if (files?.length) await importFiles(files);
  } catch (error) { storing = null; importing = null; render(); await macos.dialog.alert(String(error?.message || error), { title: T('importFailed', 'Import failed') }); }
}

async function deleteBooks(ids) {
  const list = ids.map(bookOf).filter(Boolean);
  if (!list.length) return;
  const ok = await macos.dialog.confirm(list.length === 1 ? fmt('deleteBookQuestion', 'Delete “{name}” from your library?', { name: list[0].title }) : fmt('deleteBooksQuestion', 'Delete {n} books from your library?', { n: list.length }),
    { detail: T('deleteBookDetail', 'The book files stored in this app are removed, along with your place and bookmarks. This cannot be undone.'), confirmLabel: T('delete', 'Delete'), danger: true });
  if (!ok) return;
  for (const book of list) {
    if (reading?.id === book.id) reading = null;
    delete books[book.id];
    lib.collections.forEach((item) => { item.bookIds = item.bookIds.filter((id) => id !== book.id); });
    for (const id of [...(book.files || []), book.sourceId, book.customCover].filter(Boolean)) await macos.files.remove(id).catch(() => {});
    await macos.storage.remove(`book:${book.id}`).catch(() => {});
    forgetBook(book.id);
  }
  save(); render();
}
async function exportBook(id) {
  const book = bookOf(id);
  if (book?.sourceId) await macos.files.export(book.sourceId, book.sourceName || `${book.title}.epub`).catch((error) => macos.dialog.alert(String(error?.message || error), { title: T('exportFailed', 'Export failed') }));
}
function toggleFinished(ids) {
  const list = ids.map(bookOf).filter(Boolean);
  const on = !list.every((book) => book.finished);
  for (const book of list) { book.finished = on; book.finishedAt = on ? Date.now() : 0; if (on) book.opened = book.opened || Date.now(); save(book); }
  render();
}
async function createCollection(bookIds = []) {
  const name = await macos.dialog.prompt(T('newCollectionPrompt', 'Name of the new collection:'), { title: T('newCollection', 'New Collection'), value: T('untitledCollection', 'Untitled Collection') });
  if (name == null) return null;
  const item = { id: uid('c'), name: name.trim().slice(0, 80) || T('untitledCollection', 'Untitled Collection'), bookIds: [...bookIds] };
  lib.collections.push(item);
  save(); go('coll', item.id);
  return item;
}
async function addToCollection(bookIds) {
  const choice = await macos.ui.showMenu([
    ...lib.collections.filter((item) => !(route.kind === 'coll' && item.id === route.id)).map((item) => ({ id: item.id, label: item.name })),
    ...(lib.collections.length ? [{ separator: true }] : []), { id: ':new', label: T('newCollection', 'New Collection') }
  ]);
  if (!choice) return;
  if (choice === ':new') return createCollection(bookIds);
  const target = collectionOf(choice);
  if (!target) return;
  bookIds.forEach((id) => { if (books[id] && !target.bookIds.includes(id)) target.bookIds.push(id); });
  save(); render();
}
function removeFromCollection(bookIds) {
  const item = collectionOf();
  if (!item) return;
  item.bookIds = item.bookIds.filter((id) => !bookIds.includes(id));
  save(); render();
}
async function renameCollection(id) {
  const item = collectionOf(id);
  if (!item) return;
  const name = await macos.dialog.prompt(T('renamePrompt', 'New name:'), { title: T('rename', 'Rename…'), value: item.name });
  if (name == null || !name.trim()) return;
  item.name = name.trim().slice(0, 80); save(); render();
}
async function deleteCollection(id) {
  const item = collectionOf(id);
  if (!item) return;
  const ok = await macos.dialog.confirm(fmt('deleteCollectionQuestion', 'Delete the collection “{name}”?', { name: item.name }), { detail: T('deleteCollectionDetail', 'The books stay in your library.'), confirmLabel: T('delete', 'Delete'), danger: true });
  if (!ok) return;
  lib.collections = lib.collections.filter((entry) => entry.id !== id);
  save();
  if (route.kind === 'coll' && route.id === id) go('all'); else render();
}
function showInfo(id) { const book = bookOf(id); if (book) { infoEdit = { id, title: book.title, author: book.author || '' }; render(); } }
async function setCustomCover(book, fileId) {
  const old = book.customCover;
  book.customCover = fileId;
  if (old && old !== fileId) await macos.files.remove(old).catch(() => {});
  save(book); render();
}
async function bookAction(menuId, ids, primaryId) {
  if (menuId === 'open') openBook(primaryId);
  if (menuId === 'info') showInfo(primaryId);
  if (menuId === 'add-to') addToCollection(ids);
  if (menuId === 'remove-from') removeFromCollection(ids);
  if (menuId === 'finished') toggleFinished(ids);
  if (menuId === 'export') for (const id of ids) await exportBook(id);
  if (menuId === 'delete') deleteBooks(ids);
}
async function sortMenu() {
  const options = [['recent', T('sortRecent', 'Recently Read')], ['title', T('colTitle', 'Title')], ['author', T('colAuthor', 'Author')], ['added', T('dateAdded', 'Date Added')]];
  const choice = await macos.ui.showMenu(options.map(([id, label]) => ({ id, label, checked: lib.sort === id })));
  if (choice) { lib.sort = choice; save(); render(); }
}
async function readerMoreMenu() {
  const book = readingBook();
  if (!book) return;
  const choice = await macos.ui.showMenu([
    { id: 'info', label: T('getInfo', 'Get Info…') },
    { id: 'show-bookmarks', label: T('showBookmarks', 'Show Bookmarks') },
    { separator: true },
    { id: 'add-to', label: T('addToCollection', 'Add to Collection…') },
    { id: 'finished', label: book.finished ? T('markUnfinished', 'Mark as Still Reading') : T('markFinished', 'Mark as Finished') },
    { id: 'export', label: T('exportBook', 'Export Book…') },
    { separator: true },
    { id: 'start', label: T('startOver', 'Go to Beginning'), disabled: segIndex(book) === 0 },
    { id: 'library', label: T('backToLibrary', 'Library') }
  ]);
  if (choice === 'show-bookmarks') showPane('bookmarks');
  else if (choice === 'start') goTo(book, { s: 0, p: 0 }, 'prev');
  else if (choice === 'library') closeBook();
  else if (choice) bookAction(choice, [book.id], book.id);
}
async function openSettings() {
  settingsOpen = true; render();
  try { usage = await macos.files.usage(); if (settingsOpen) render(); } catch {}
}
