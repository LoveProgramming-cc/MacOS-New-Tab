// Music — widgets, events and start-up.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- widgets
// "Recently Played" for the desktop and the widget centre (manifest: widgets). Music hands
// the host a picture of it whenever it changes; the host draws that picture whether or
// not Music is open, and a click opens Music with the 'widget' event. Nothing here keeps
// Music running.
const WIDGET_GRADIENT = ['#fb5c74', '#fa233b'];
const WIDGET_DIM = 'rgba(255,255,255,0.72)';
const widgetSongs = () => {
  const played = library.history.map((id) => library.songs[id]).filter(Boolean);
  const rest = allSongs().filter((song) => !library.history.includes(song.id)).sort((a, b) => (b.added || 0) - (a.added || 0));
  return [...played, ...rest].slice(0, 4);
};
const widgetNote = { type: 'text', text: '♫', fontSize: 21, fontWeight: 'bold', color: 'white' };
const widgetPlay = (song) => ({ type: 'button', id: `play:${song.id}`, label: T('play', 'Play'), icon: ICON('play'), iconTint: true, iconSize: 10, shape: 'pill', background: 'rgba(255,255,255,0.24)', color: 'white', fontWeight: 'semibold', height: 28, alignSelf: 'start' });
function widgetContent() {
  const songs = widgetSongs();
  const caption = { type: 'text', text: T('widgetRecent', 'Recently Played').toLocaleUpperCase(), fontSize: 10.5, fontWeight: 'semibold', color: WIDGET_DIM, lines: 1 };
  if (!songs.length) {
    const empty = { type: 'stack', direction: 'vertical', gradient: WIDGET_GRADIENT, padding: 14, gap: 4, children: [
      { type: 'stack', direction: 'horizontal', children: [{ type: 'text', text: T('library', 'Library'), fontSize: 15, fontWeight: 'bold', color: 'white', grow: 1 }, widgetNote] },
      { type: 'spacer' },
      { type: 'text', text: T('widgetEmpty', 'Add music and it appears here.'), fontSize: 12, color: WIDGET_DIM }
    ] };
    return { small: empty, medium: empty, large: empty };
  }
  const [first] = songs;
  const title = (song, extra = {}) => ({ type: 'text', text: song.title, color: 'white', fontWeight: 'semibold', lines: 1, ...extra });
  const row = (song) => ({ type: 'stack', direction: 'horizontal', gap: 10, align: 'center', children: [
    { type: 'image', src: artOf(song), width: 44, height: 44, radius: 5, fit: 'cover' },
    { type: 'stack', direction: 'vertical', gap: 0, grow: 1, minWidth: 0, children: [title(song, { fontSize: 13 }), { type: 'text', text: artistOf(song), fontSize: 11, color: WIDGET_DIM, lines: 1 }] },
    { type: 'button', id: `play:${song.id}`, icon: ICON('play'), iconTint: true, iconSize: 10, shape: 'circle', width: 26, height: 26, background: 'white', color: '#fa233b', tooltip: T('play', 'Play') }
  ] });
  return {
    small: { type: 'stack', direction: 'vertical', gradient: WIDGET_GRADIENT, padding: 14, gap: 6, children: [
      { type: 'stack', direction: 'horizontal', align: 'start', children: [{ type: 'image', src: artOf(first), width: 56, height: 56, radius: 6, fit: 'cover' }, { type: 'spacer' }, widgetNote] },
      title(first, { fontSize: 12.5 }),
      { type: 'spacer' },
      widgetPlay(first)
    ] },
    medium: { type: 'stack', direction: 'horizontal', gradient: WIDGET_GRADIENT, padding: 14, gap: 14, align: 'stretch', children: [
      { type: 'image', src: artOf(first), width: 132, height: 132, radius: 8, fit: 'cover' },
      { type: 'stack', direction: 'vertical', gap: 3, grow: 1, minWidth: 0, children: [
        { type: 'stack', direction: 'horizontal', align: 'start', children: [{ ...caption, grow: 1, margin: [5, 0, 0, 0] }, widgetNote] },
        title(first, { fontSize: 17, fontWeight: 'bold', lines: 2 }),
        { type: 'text', text: artistOf(first), fontSize: 12, color: WIDGET_DIM, lines: 1 },
        { type: 'spacer' },
        widgetPlay(first)
      ] }
    ] },
    large: { type: 'stack', direction: 'vertical', gradient: WIDGET_GRADIENT, padding: 0, gap: 0, children: [
      { type: 'stack', direction: 'horizontal', gap: 14, padding: [14, 14, 12, 14], align: 'stretch', children: [
        { type: 'image', src: artOf(first), width: 92, height: 92, radius: 7, fit: 'cover' },
        { type: 'stack', direction: 'vertical', gap: 2, grow: 1, minWidth: 0, children: [
          { type: 'stack', direction: 'horizontal', align: 'start', children: [title(first, { fontSize: 16, fontWeight: 'bold', lines: 2, grow: 1 }), widgetNote] },
          { type: 'text', text: artistOf(first), fontSize: 12, color: WIDGET_DIM, lines: 1 },
          { type: 'spacer' },
          widgetPlay(first)
        ] }
      ] },
      { type: 'stack', direction: 'vertical', gap: 9, grow: 1, padding: [10, 14, 12, 14], background: 'rgba(0,0,0,0.09)', children: [caption, ...songs.slice(1, 4).map(row)] }
    ] }
  };
}
let widgetSignature = '';
function publishWidgets() {
  const content = widgetContent();
  const signature = JSON.stringify(content);
  if (signature === widgetSignature) return;
  widgetSignature = signature;
  macos.widgets.set('recent', content).catch((error) => macos.log('widget failed', String(error)));
}
macos.on('widget', ({ action }) => {
  const id = String(action || '').startsWith('play:') ? action.slice(5) : '';
  if (id && library.songs[id]) { const ids = widgetSongs().map((song) => song.id); playSongs(ids.includes(id) ? ids : [id], id); }
});
macos.on('statusitem', ({ id, event, value }) => {
  // The panel's slider: the time follows the thumb, the song follows when it is let go.
  if (id === 'panel-seek') { if (event === 'input') macos.statusItem.patch('panel-time', { text: clock(value) }); if (event === 'change') macos.audio.seek(Number(value)); return; }
  if (id === 'toggle') toggle();
  if (id === 'next') next();
  if (id === 'previous') previous();
  if (id === 'show') macos.window.focus();
});
// music://song/<id> and music://playlist/<id>: how other applications (macos.openURL) point at something here.
macos.on('openurl', ({ url }) => {
  const match = /^music:\/\/(song|playlist)\/([^/?#]+)/i.exec(String(url || ''));
  if (!match) return;
  const key = decodeURIComponent(match[2]);
  if (match[1] === 'song' && library.songs[key]) { go('songs'); playSongs(allSongs().map((song) => song.id), key); }
  if (match[1] === 'playlist' && playlistOf(key)) go('playlist', key);
});
macos.on('search', ({ id }) => {
  const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (kind === 'song' && library.songs[key]) { go('songs'); playSongs(allSongs().map((song) => song.id), key); }
  if (kind === 'playlist' && playlistOf(key)) go('playlist', key);
});

// ---------------------------------------------------------------- events
const pick = (options) => macos.dialog.openFile({ store: true, ...options });
const importSongs = async () => {
  try { const files = await pick({ accept: 'audio/*,video/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.mp4,.m4v,.mov,.webm,.mkv', multiple: true }); if (files?.length) await addFiles(files); }
  catch (error) { importing = null; render(); await macos.dialog.alert(String(error?.message || error), { title: T('importFailed', 'Import failed') }); }
};
const importPlaylistFile = async () => {
  try { const file = await pick({ accept: '.zip,application/zip' }); if (file) await importArchive(file.id); }
  catch (error) { await macos.dialog.alert(String(error?.message || error), { title: T('importFailed', 'Import failed') }); }
};

async function sortMenu() {
  const key = routeKey(); const sort = sorts[key];
  const fields = [['title', T('colTitle', 'Title')], ['artist', T('colArtist', 'Artist')], ['album', T('colAlbum', 'Album')], ['time', T('colTime', 'Time')], ['added', T('dateAdded', 'Date Added')], ['plays', T('plays', 'Plays')]];
  const choice = await macos.ui.showMenu([
    { id: ':default', label: currentPlaylist() ? T('playlistOrder', 'Playlist Order') : T('defaultOrder', 'Default Order'), checked: !sort }, { separator: true },
    ...fields.map(([id, label]) => ({ id, label, checked: sort?.field === id })), { separator: true },
    { id: ':asc', label: T('ascending', 'Ascending'), checked: Boolean(sort) && !sort.descending, disabled: !sort }, { id: ':desc', label: T('descending', 'Descending'), checked: Boolean(sort?.descending), disabled: !sort }
  ]);
  if (!choice) return;
  if (choice === ':default') delete sorts[key];
  else if (choice === ':asc' || choice === ':desc') sort.descending = choice === ':desc';
  else sorts[key] = { field: choice, descending: sort?.field === choice ? !sort.descending : false };
  render();
}
// Subtitles of the video that is playing: off, one of its tracks, or a file to add.
async function subtitleMenu() {
  const song = currentSong();
  if (!song) return;
  const choice = await macos.ui.showMenu([
    { id: 'off', label: T('subtitlesOff', 'Off'), checked: player.subtitle < 0 },
    ...player.subtitles.map((track, index) => ({ id: `track:${index}`, label: track.label, checked: index === player.subtitle })),
    { separator: true }, { id: 'add', label: T('addSubtitleFile', 'Add Subtitle File…') }
  ]);
  if (!choice) return;
  let state = null;
  if (choice === 'add') {
    const file = await pick({ accept: '.srt,.vtt,.ass,.ssa,.lrc,text/vtt' }).catch(() => null);
    if (!file) return;
    try { state = await macos.audio.addSubtitle({ fileId: file.id }); }
    catch (error) { await macos.files.remove(file.id).catch(() => {}); return macos.dialog.alert(T('subtitleUnreadable', 'No subtitles could be read from that file.'), { title: file.name }); }
    song.subtitleFiles = [...(song.subtitleFiles || []), { fileId: file.id }];
  } else state = await macos.audio.setSubtitle(choice === 'off' ? -1 : Number(choice.slice(6)));
  player.subtitles = state.subtitles; player.subtitle = state.subtitle;
  song.subtitleOff = state.subtitle < 0; song.subtitleIndex = Math.max(0, state.subtitle);
  save(); render();
}
async function moreMenu() {
  const list = currentPlaylist();
  const choice = await macos.ui.showMenu([
    { id: 'add', label: T('addSongs', 'Add Songs…') },
    ...(list ? [{ id: 'cover', label: T('chooseCover', 'Choose Cover…') }, { id: 'rename', label: T('rename', 'Rename…') }, { id: 'move', label: T('moveToFolder', 'Move to Folder…') }] : []),
    { separator: true }, { id: 'queue', label: T('addToQueue', 'Add to Queue'), disabled: !visibleSongs().length },
    { id: 'export', label: list ? T('exportPlaylist', 'Export Playlist…') : T('exportSongs', 'Export as Playlist…'), disabled: !visibleSongs().length },
    ...(list ? [{ separator: true }, { id: 'delete', label: T('deletePlaylist', 'Delete Playlist'), danger: true }] : [])
  ]);
  if (choice === 'add') importSongs();
  if (choice === 'cover') chooseCover();
  if (choice === 'rename') renameThing(list, T('rename', 'Rename…'));
  if (choice === 'move') movePlaylist(list.id);
  if (choice === 'queue') enqueue(visibleSongs().map((song) => song.id));
  if (choice === 'export') (list ? exportPlaylist(list.id) : exportSongList(route.kind === 'album' ? route.id.split(' ⧸ ')[0] : route.kind === 'artist' ? route.id : T('songs', 'Songs'), visibleSongs()));
  if (choice === 'delete') deletePlaylist(list.id);
}
async function chooseCover() {
  const list = currentPlaylist();
  if (!list) return;
  const file = await pick({ accept: 'image/*' });
  if (file) (isImage(file) ? setCover(list, file.id) : macos.files.remove(file.id));
}

macos.on('ui', async ({ id, event, value, checked, values = [], menuId, itemId, order, sourceId, items = [], column, direction }) => {
  if (id === 'nav' && event === 'rowdrop') {
    // Something was dragged onto a sidebar row: a playlist onto a folder (or out of one),
    // or songs onto a playlist.
    const [targetKind, ...targetRest] = String(itemId).split(':'); const targetId = targetRest.join(':');
    if (sourceId === 'nav') {
      const playlistId = String(items[0] || '').replace(/^playlist:/, '');
      if (targetKind === 'folder') setPlaylistFolder(playlistId, targetId);
      else if (targetKind === 'playlists') setPlaylistFolder(playlistId, '');
      else if (targetKind === 'playlist') setPlaylistFolder(playlistId, playlistOf(targetId)?.folderId || '');
    } else if (targetKind === 'playlist' && playlistOf(targetId)) {
      const target = playlistOf(targetId);
      items.filter((songId) => library.songs[songId]).forEach((songId) => { if (!target.songIds.includes(songId)) target.songIds.push(songId); });
      save(); render();
    }
    return;
  }
  if (id === 'nav') {
    const [kind, ...rest] = String(event === 'menu' || event === 'disclose' ? itemId : value).split(':'); const target = rest.join(':');
    if (event === 'select') go(kind, target);
    // The chevron folds a folder without leaving the current view.
    if (event === 'disclose' && kind === 'folder') { const folder = folderOf(target); if (folder) { folder.collapsed = !folder.collapsed; save(); render(); } }
    if (event === 'menu' && kind === 'playlist') {
      const item = playlistOf(target); const ids = (item?.songIds || []).filter((songId) => library.songs[songId]);
      if (menuId === 'play') playSongs(ids, library.shuffle ? '' : ids[0]);
      if (menuId === 'shuffle') { library.shuffle = true; playSongs(ids); }
      if (menuId === 'rename') renameThing(item, T('rename', 'Rename…'));
      if (menuId === 'move') movePlaylist(target);
      if (menuId === 'export') exportPlaylist(target);
      if (menuId === 'delete') deletePlaylist(target);
    }
    if (event === 'menu' && kind === 'folder') {
      if (menuId === 'new-in-folder') createPlaylist(target);
      if (menuId === 'rename-folder') renameThing(library.folders.find((item) => item.id === target), T('rename', 'Rename…'));
      if (menuId === 'delete-folder') deleteFolder(target);
    }
    return;
  }
  if (id === 'collection' && event === 'select') return go(route.kind === 'albums' ? 'album' : route.kind === 'artists' ? 'artist' : 'playlist', value);
  if (id === 'songs') {
    const ids = visibleSongs().map((song) => song.id);
    if (event === 'activate') playSongs(ids, itemId);
    if (event === 'reorder' && currentPlaylist()) { currentPlaylist().songIds = order; save(); render(); }
    if (event === 'menu') {
      const targets = values.length ? values : [itemId];
      if (menuId === 'play') playSongs(ids, itemId);
      if (menuId === 'play-next') enqueue(targets, { nextUp: true });
      if (menuId === 'queue') enqueue(targets);
      if (menuId === 'add-to') addToPlaylist(targets);
      if (menuId === 'love') { const on = !targets.every((songId) => library.songs[songId]?.loved); targets.forEach((songId) => { if (library.songs[songId]) library.songs[songId].loved = on; }); save(); render(); }
      if (menuId === 'info') { const song = library.songs[itemId]; if (song) { editing = { id: song.id, title: song.title, artist: song.artist || '', album: song.album || '' }; render(); } }
      if (menuId === 'export-song') exportSongs(targets);
      if (menuId === 'remove' && currentPlaylist()) { currentPlaylist().songIds = currentPlaylist().songIds.filter((songId) => !targets.includes(songId)); save(); render(); }
      if (menuId === 'delete') {
        const ok = await macos.dialog.confirm(T('deleteSongsQuestion', 'Delete {count} song(s) from the library?').replace('{count}', String(targets.length)), { detail: T('deleteSongsDetail', 'The audio files stored in this app are removed. This cannot be undone.'), confirmLabel: T('delete', 'Delete'), danger: true });
        if (ok) deleteSongs(targets);
      }
    }
    return;
  }
  if (id === 'queue') {
    const position = Number(String(itemId || '').slice(2));
    if (event === 'activate' || (event === 'menu' && menuId === 'queue-play')) { player.index = position; load(); }
    if (event === 'menu' && menuId === 'queue-remove') { player.queue.splice(position, 1); render(); }
    if (event === 'reorder') { player.queue = [...player.queue.slice(0, player.index + 1), ...order.map((key) => player.queue[Number(key.slice(2))])]; render(); }
    return;
  }
  if (id === 'history' && event === 'activate') {
    const songId = library.history[Number(String(itemId).slice(2))];
    if (library.songs[songId]) { player.queue.splice(player.index + 1, 0, songId); player.index += 1; if (!player.original.includes(songId)) player.original.push(songId); load(); }
    return;
  }
  if (id === 'storage-group' && event === 'change' && storage) { storage.group = ['playlists', 'folders'].includes(value) ? value : 'songs'; storage.selected = []; storage.sort = { column: 'size', direction: 'desc' }; render(); return; }
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
  if (id === 'fade-toggle' && event === 'change') { library.fade = Boolean(checked); save(); return; }
  if (id === 'crossfade-slider') {
    const seconds = Math.max(0, Math.min(12, Math.round(Number(value) || 0)));
    macos.ui.patch('crossfade-value', { text: seconds ? T('nSeconds', '{n} s').replace('{n}', String(seconds)) : T('off', 'Off') });
    if (event === 'change') { library.crossfade = seconds; save(); }
    return;
  }
  if (id === 'np-tab' && event === 'change') { nowTab = value === 'history' ? 'history' : 'queue'; render(); return; }
  if (id === 'search' && event === 'input') { query = String(value || ''); render(); return; }
  if (id === 'title' && (event === 'change' || event === 'submit') && currentPlaylist()) { currentPlaylist().name = String(value || '').trim().slice(0, 80) || T('untitledPlaylist', 'Untitled Playlist'); save(); render(); return; }
  if (editing && ['info-title', 'info-artist', 'info-album'].includes(id) && event === 'input') { editing[id.slice(5)] = String(value || ''); return; }
  if (editing && event === 'submit' && id.startsWith('info-')) id = 'info-save', event = 'click';
  if (id === 'seek') { if (event === 'input') macos.ui.patch('time', { text: clock(value) }); if (event === 'change') macos.audio.seek(Number(value)); return; }
  if (id === 'volume' && event === 'input') { const wasMuted = library.volume === 0; library.volume = Number(value) / 100; macos.audio.setVolume(library.volume); save(); if (wasMuted !== (library.volume === 0)) render(); return; }
  if (event !== 'click') return;
  if (id.startsWith('accent-') && ACCENTS[id.slice(7)]) {
    library.accent = id.slice(7) === DEFAULT_ACCENT ? '' : id.slice(7);
    macos.window.setAccentColor(library.accent || null).catch(() => {});
    save(); render();
  }
  else if (id === 'settings-done') { settingsOpen = false; render(); }
  else if (id === 'manage-storage') openStorage();
  else if (id === 'clean-storage') cleanStorage();
  else if (id === 'storage-done') { storage = null; render(); }
  else if (id === 'storage-select-all' && storage) { const shown = storageRows().map((row) => row.id); storage.selected = storage.selected.length === shown.length ? [] : shown; render(); }
  else if (id === 'storage-delete' && storage) deleteFromStorage();
  else if (id === 'open-now') { showNow = !showNow && Boolean(currentSong()); render(); }
  else if (id === 'close-now') { showNow = false; render(); }
  else if (id === 'subtitles') subtitleMenu();
  else if (id === 'love-now') { const song = currentSong(); if (song) { song.loved = !song.loved; save(); render(); } }
  else if (id === 'clear-history') { library.history = []; save(); render(); }
  else if (id === 'choose-default-art') {
    try {
      const file = await pick({ accept: 'image/*' });
      if (file && isImage(file)) { const old = library.defaultArtId; library.defaultArtId = file.id; if (old) macos.files.remove(old).catch(() => {}); save(); render(); }
      else if (file) macos.files.remove(file.id).catch(() => {});
    } catch (error) { await macos.dialog.alert(String(error?.message || error), { title: T('defaultArtwork', 'Default artwork') }); }
  }
  else if (id === 'reset-default-art') { const old = library.defaultArtId; library.defaultArtId = ''; if (old) macos.files.remove(old).catch(() => {}); save(); render(); }
  else if (id === 'add-menu') {
    const choice = await macos.ui.showMenu([{ id: 'playlist', label: T('newPlaylist', 'New Playlist') }, { id: 'folder', label: T('newFolder', 'New Playlist Folder') }, { separator: true }, { id: 'import', label: T('importPlaylist', 'Import Playlist…') }]);
    if (choice === 'playlist') createPlaylist(route.kind === 'folder' ? route.id : ''); if (choice === 'folder') createFolder(); if (choice === 'import') importPlaylistFile();
  }
  else if (id === 'import-songs') importSongs();
  else if (id === 'cover') chooseCover();
  else if (id === 'sort') sortMenu();
  else if (id === 'more') moreMenu();
  else if (id === 'play-all') { const ids = visibleSongs().map((song) => song.id); playSongs(ids, library.shuffle ? '' : ids[0]); }
  else if (id === 'shuffle-all') { library.shuffle = true; save(); playSongs(visibleSongs().map((song) => song.id)); }
  else if (id === 'toggle-shuffle') setShuffle(!library.shuffle);
  else if (id === 'toggle-repeat') { library.repeat = { off: 'all', all: 'one', one: 'off' }[library.repeat] || 'off'; save(); render(); }
  else if (id === 'toggle-queue') { showQueue = !showQueue; render(); }
  else if (id === 'clear-queue') { player.queue = player.queue.slice(0, player.index + 1); render(); }
  else if (id === 'mute') { library.volume = library.volume > 0 ? 0 : 0.8; macos.audio.setVolume(library.volume); save(); render(); }
  else if (id === 'toggle') toggle();
  else if (id === 'prev') previous();
  else if (id === 'next') next();
  else if (id === 'info-cancel') { editing = null; render(); }
  else if (id === 'info-save' && editing) {
    const song = library.songs[editing.id];
    if (song) { song.title = editing.title.trim().slice(0, 200) || song.title; song.artist = editing.artist.trim().slice(0, 200); song.album = editing.album.trim().slice(0, 200); save(); }
    editing = null; render();
  }
});

// Files dragged onto the window are already in the file store when this fires.
macos.on('drop', ({ files, rejected, targetId, itemId }) => {
  if (rejected?.length) macos.notifications.show({ title: T('someSkipped', 'Some files were skipped'), body: rejected.map((item) => item.name).join(', ').slice(0, 200) });
  // Dropping on a playlist in the sidebar adds straight to that playlist.
  const playlistId = targetId === 'nav' && String(itemId).startsWith('playlist:') ? String(itemId).slice(9) : '';
  addFiles(files, { coverTarget: targetId === 'cover', playlistId });
});

// The host stores imported files one by one (tags, artwork, duration); show how far it is.
macos.on('fileprogress', ({ done, total, source }) => {
  if (done >= total) { importing = null; render(); return; }
  const first = !importing;
  importing = { done, total, exporting: source === 'export' };
  if (first) return render();
  macos.ui.patch('import-label', { text: importLabel() });
  macos.ui.patch('import-progress', { value: done, max: Math.max(1, total) });
});

// Storage housekeeping.
async function refreshStorage() {
  const files = new Map((await macos.files.list().catch(() => [])).map((file) => [file.id, file.size || 0]));
  if (storage) storage.files = files;
  usage = { count: files.size, bytes: [...files.values()].reduce((sum, size) => sum + size, 0) };
  render();
}
async function openStorage() {
  settingsOpen = false;
  storage = { files: new Map(), group: 'songs', filter: 'all', sort: { column: 'size', direction: 'desc' }, selected: [] };
  await refreshStorage();
}
async function cleanStorage() {
  const keep = referencedFiles();
  const unused = (await macos.files.list()).filter((file) => !keep.has(file.id));
  for (const file of unused) await macos.files.remove(file.id).catch(() => {});
  await refreshStorage();
}
async function deleteFromStorage() {
  const { songs, playlists, folders } = storageSelection();
  if (!songs.length && !playlists.length && !folders.length) return;
  const size = megabytesOf(sumBytes(songs));
  const question = storage.group === 'songs' ? T('storageDeleteQuestion', 'Delete {count} songs and free {size}?').replace('{count}', String(songs.length))
    : storage.group === 'playlists' ? T('storageDeletePlaylistsQuestion', 'Delete {lists} playlists with their {count} songs and free {size}?').replace('{lists}', String(playlists.length)).replace('{count}', String(songs.length))
      : T('storageDeleteFoldersQuestion', 'Delete {folders} folders with their {lists} playlists and {count} songs, and free {size}?').replace('{folders}', String(folders.length)).replace('{lists}', String(playlists.length)).replace('{count}', String(songs.length));
  const ok = await macos.dialog.confirm(question.replace('{size}', size), { title: T('manageStorageTitle', 'Storage'), danger: true, confirmLabel: T('delete', 'Delete'),
    detail: T('storageDeleteDetail', 'They are removed from the library and from every playlist. This cannot be undone.') });
  if (!ok) return;
  await deleteSongs(songs.map((song) => song.id));
  for (const item of playlists) if (item.coverFileId) await macos.files.remove(item.coverFileId).catch(() => {});
  const gonePlaylists = new Set(playlists.map((item) => item.id)); const goneFolders = new Set(folders.map((item) => item.id));
  library.playlists = library.playlists.filter((item) => !gonePlaylists.has(item.id));
  library.folders = library.folders.filter((item) => !goneFolders.has(item.id));
  if ((route.kind === 'playlist' && gonePlaylists.has(route.id)) || (route.kind === 'folder' && goneFolders.has(route.id))) route = { kind: 'songs', id: '' };
  save();
  storage.selected = [];
  await refreshStorage();
}

async function openSettings() {
  settingsOpen = true; render();
  try { usage = await macos.files.usage(); if (settingsOpen) render(); } catch {}
}
macos.on('settings', openSettings);
macos.on('accentchange', (info) => { accentSetting = info.accentSetting || 'multicolor'; if (settingsOpen) render(); });

macos.on('keydown', async ({ key, editing: typing, metaKey, ctrlKey, targetId }) => {
  // Returning true tells the host Escape was used here; otherwise it closes the window.
  if (key === 'Escape' && storage) { storage = null; render(); return true; }
  if (key === 'Escape' && settingsOpen) { settingsOpen = false; render(); return true; }
  if (key === 'Escape' && showNow && !editing) { showNow = false; render(); return true; }
  if (key === 'Escape' && editing) { editing = null; render(); return true; }
  if (key === 'Escape' && currentSong() && !player.paused) return true;   // music is playing: Escape does not quit
  if (typing || metaKey || ctrlKey) return;
  if (key === ' ') toggle();
  if ((key === 'Backspace' || key === 'Delete') && targetId === 'songs' && currentPlaylist()) {
    const { values = [] } = await macos.ui.get('songs');
    if (values.length) { currentPlaylist().songIds = currentPlaylist().songIds.filter((id) => !values.includes(id)); save(); render(); }
  }
});

macos.on('menucommand', ({ command }) => {
  if (command === 'import-songs') importSongs();
  if (command === 'new-playlist') createPlaylist();
  if (command === 'new-folder') createFolder();
  if (command === 'export-playlist' && currentPlaylist()) exportPlaylist(currentPlaylist().id);
  if (command === 'toggle') toggle();
  if (command === 'next') next();
  if (command === 'previous') previous();
  if (command === 'shuffle') setShuffle(!library.shuffle);
  if (command === 'repeat') { library.repeat = { off: 'all', all: 'one', one: 'off' }[library.repeat] || 'off'; save(); render(); }
});
macos.on('languagechange', () => { render(); updateStatusItem(); publishWidgets(); });

if (library.accent) macos.window.setAccentColor(library.accent).catch(() => {});
await macos.audio.setVolume(library.volume).catch(() => {});
await macos.ui.render(view());
publishSearch();
updateStatusItem();
publishWidgets();
const REQUIRED_PERMISSIONS = ['storage', 'files', 'audio'];
// What the app cannot work without. If the user switched one of these off, ask once: the
// system's dialog leads to the switch in System Settings.
macos.permissions.status().then((status) => {
  const missing = REQUIRED_PERMISSIONS.filter((name) => status[name] === 'denied');
  if (missing.length) macos.permissions.request(missing);
}).catch(() => {});
