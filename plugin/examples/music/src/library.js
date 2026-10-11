// Music — the library: adding files, playlists, folders, export and import.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- library
function songFromFile(file) {
  const base = String(file.name || 'Untitled').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/^\d{1,3}[\s._-]+(?=\S)/, '').trim() || 'Untitled';
  const parts = base.split(/\s+[-–—]\s+/);
  const tags = file.tags || {};
  const song = {
    id: uid('s'), fileId: file.id, artId: file.artworkId || '',
    title: tags.title || (parts.length > 1 ? parts.slice(1).join(' - ') : base).trim(),
    artist: tags.artist || (parts.length > 1 ? parts[0].trim() : ''), album: tags.album || '', albumArtist: tags.albumArtist || '', track: tags.track || '', year: tags.year || '',
    duration: file.duration || 0, size: file.size, type: file.type, fileName: file.name, added: Date.now(), plays: 0, loved: false, video: isVideo(file)
  };
  library.songs[song.id] = song;
  return song;
}
const isVideo = (file) => /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
// Videos are songs with a picture: same library, same queue; Now Playing shows the video.
const isAudio = (file) => /^audio\//.test(file.type) || /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba)$/i.test(file.name) || isVideo(file);
const isImage = (file) => /^image\//.test(file.type);
const isArchive = (file) => /\.zip$/i.test(file.name) || file.type === 'application/zip';

async function addFiles(files, { coverTarget = false, playlistId = '' } = {}) {
  const list = playlistId ? playlistOf(playlistId) : currentPlaylist();
  for (const file of files) {
    if (isAudio(file)) {
      const song = songFromFile(file);
      if (list && !list.songIds.includes(song.id)) list.songIds.push(song.id);
    } else if (isImage(file) && list && (coverTarget || files.length === 1)) await setCover(list, file.id);
    else if (isArchive(file)) await importArchive(file.id);
    else await macos.files.remove(file.id).catch(() => {});   // not something this app keeps
  }
  save(); render();
}
async function setCover(list, fileId) {
  const old = list.coverFileId;
  list.coverFileId = fileId;
  if (old && old !== fileId) await macos.files.remove(old).catch(() => {});
  save(); render();
}
async function deleteSongs(ids) {
  for (const id of ids) {
    const song = library.songs[id];
    if (!song) continue;
    if (currentSong()?.id === id) await stop();
    delete library.songs[id];
    library.playlists.forEach((item) => { item.songIds = item.songIds.filter((songId) => songId !== id); });
    library.history = library.history.filter((songId) => songId !== id);
    player.queue = player.queue.filter((songId, index) => songId !== id || index === player.index);
    player.original = player.original.filter((songId) => songId !== id);
    await macos.files.remove(song.fileId).catch(() => {});
    if (song.artId) await macos.files.remove(song.artId).catch(() => {});
    for (const entry of song.subtitleFiles || []) await macos.files.remove(entry.fileId).catch(() => {});
  }
  save(); render();
}
async function createPlaylist(folderId = '') {
  const name = await macos.dialog.prompt(T('newPlaylistPrompt', 'Name of the new playlist:'), { title: T('newPlaylist', 'New Playlist'), value: T('untitledPlaylist', 'Untitled Playlist') });
  if (name == null) return;
  const item = { id: uid('p'), name: name.trim().slice(0, 80) || T('untitledPlaylist', 'Untitled Playlist'), coverFileId: '', songIds: [], folderId };
  library.playlists.push(item);
  const folder = library.folders.find((entry) => entry.id === folderId);
  if (folder) folder.collapsed = false;
  save(); go('playlist', item.id);
}
async function createFolder() {
  const name = await macos.dialog.prompt(T('newFolderPrompt', 'Name of the new folder:'), { title: T('newFolder', 'New Playlist Folder'), value: T('untitledFolder', 'Untitled Folder') });
  if (name == null) return;
  library.folders.push({ id: uid('f'), name: name.trim().slice(0, 80) || T('untitledFolder', 'Untitled Folder'), collapsed: false });
  save(); render();
}
async function renameThing(item, title) {
  const name = await macos.dialog.prompt(T('renamePrompt', 'New name:'), { title, value: item.name });
  if (name == null || !name.trim()) return;
  item.name = name.trim().slice(0, 80);
  save(); render();
}
async function deletePlaylist(id) {
  const item = playlistOf(id);
  if (!item) return;
  const ok = await macos.dialog.confirm(T('deletePlaylistQuestion', 'Delete the playlist “{name}”?').replace('{name}', item.name), { detail: T('deletePlaylistDetail', 'The songs stay in your library.'), confirmLabel: T('delete', 'Delete'), danger: true });
  if (!ok) return;
  library.playlists = library.playlists.filter((entry) => entry.id !== id);
  if (item.coverFileId) await macos.files.remove(item.coverFileId).catch(() => {});
  save();
  if (route.kind === 'playlist' && route.id === id) go('playlists'); else render();
}
function setPlaylistFolder(playlistId, folderId) {
  const item = playlistOf(playlistId);
  if (!item || item.folderId === folderId) return;
  item.folderId = folderId;
  const folder = folderOf(folderId);
  if (folder) folder.collapsed = false;
  save(); render();
}
async function deleteFolder(id) {
  const folder = library.folders.find((entry) => entry.id === id);
  if (!folder) return;
  const ok = await macos.dialog.confirm(T('deleteFolderQuestion', 'Delete the folder “{name}”?').replace('{name}', folder.name), { detail: T('deleteFolderDetail', 'Its playlists are kept and move out of the folder.'), confirmLabel: T('delete', 'Delete'), danger: true });
  if (!ok) return;
  library.playlists.forEach((item) => { if (item.folderId === id) item.folderId = ''; });
  library.folders = library.folders.filter((entry) => entry.id !== id);
  save();
  if (route.kind === 'folder' && route.id === id) go('playlists'); else render();
}
async function movePlaylist(id) {
  const item = playlistOf(id);
  if (!item) return;
  const choice = await macos.ui.showMenu([
    ...library.folders.map((folder) => ({ id: folder.id, label: folder.name, checked: item.folderId === folder.id })),
    ...(library.folders.length ? [{ separator: true }] : []),
    { id: ':none', label: T('noFolder', 'No Folder'), checked: !item.folderId }, { id: ':new', label: T('newFolder', 'New Playlist Folder') }
  ]);
  if (!choice) return;
  if (choice === ':new') { await createFolder(); item.folderId = library.folders.at(-1)?.id || ''; }
  else item.folderId = choice === ':none' ? '' : choice;
  save(); render();
}
async function addToPlaylist(songIds) {
  const choice = await macos.ui.showMenu([...library.playlists.filter((item) => item.id !== currentPlaylist()?.id).map((item) => ({ id: item.id, label: item.name })), { separator: true }, { id: ':new', label: T('newPlaylist', 'New Playlist') }]);
  if (!choice) return;
  let target = playlistOf(choice);
  if (choice === ':new') {
    const name = await macos.dialog.prompt(T('newPlaylistPrompt', 'Name of the new playlist:'), { title: T('newPlaylist', 'New Playlist'), value: T('untitledPlaylist', 'Untitled Playlist') });
    if (name == null) return;
    target = { id: uid('p'), name: name.trim().slice(0, 80) || T('untitledPlaylist', 'Untitled Playlist'), coverFileId: '', songIds: [], folderId: '' };
    library.playlists.push(target);
  }
  if (!target) return;
  songIds.forEach((id) => { if (!target.songIds.includes(id)) target.songIds.push(id); });
  save(); render();
}

// ---------------------------------------------------------------- export / import
const safeName = (text) => String(text || 'untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'untitled';
const extension = (song) => (String(song.fileName || '').match(/\.[a-z0-9]{1,5}$/i)?.[0] || '.mp3').toLowerCase();
const exportName = (song) => `${safeName(song.artist ? `${song.artist} - ${song.title}` : song.title)}${extension(song)}`;

// One .zip per playlist: playlist.json + cover + the audio files, in order.
async function exportSongList(name, songs, coverFileId = '') {
  if (!songs.length) return;
  status(T('exporting', 'Exporting…'));
  try {
    const entries = [];
    const manifest = { format: 'macos-music-playlist-v1', name, cover: '', songs: [] };
    if (coverFileId) {
      const info = await macos.files.info(coverFileId);
      if (info) { manifest.cover = `cover${(info.name.match(/\.[a-z0-9]{1,5}$/i)?.[0] || '.png').toLowerCase()}`; entries.push({ path: manifest.cover, fileId: coverFileId }); }
    }
    songs.forEach((song, index) => {
      const path = `songs/${String(index + 1).padStart(2, '0')} ${exportName(song)}`;
      manifest.songs.push({ path, title: song.title, artist: song.artist || '', album: song.album || '', duration: song.duration || 0, loved: Boolean(song.loved) });
      entries.push({ path, fileId: song.fileId });
    });
    entries.unshift({ path: 'playlist.json', text: JSON.stringify(manifest, null, 2) });
    await macos.archive.create({ name: `${safeName(name)}.zip`, entries });
  } catch (error) {
    await macos.dialog.alert(String(error?.message || error), { title: T('exportFailed', 'Export failed') });
  } finally { status(''); }
}
const exportPlaylist = (id) => { const item = playlistOf(id); if (item) exportSongList(item.name, item.songIds.map((songId) => library.songs[songId]).filter(Boolean), item.coverFileId); };
async function exportSongs(ids) {
  for (const id of ids) { const song = library.songs[id]; if (song) await macos.files.export(song.fileId, exportName(song)); }
}
async function importArchive(fileId) {
  status(T('importing', 'Importing…'));
  try {
    const entries = await macos.archive.extract(fileId);
    let manifest = null;
    try { manifest = JSON.parse(entries.find((entry) => entry.path === 'playlist.json')?.text || 'null'); } catch {}
    const byPath = new Map(entries.filter((entry) => entry.file).map((entry) => [entry.path, entry.file]));
    const item = { id: uid('p'), name: String(manifest?.name || T('importedPlaylist', 'Imported Playlist')).slice(0, 80), coverFileId: '', songIds: [], folderId: '' };
    const used = new Set();
    for (const described of (manifest?.format === 'macos-music-playlist-v1' ? manifest.songs : [])) {
      const file = byPath.get(described.path);
      if (!file) continue;
      const song = songFromFile(file);
      song.title = String(described.title || song.title).slice(0, 200); song.artist = String(described.artist || song.artist).slice(0, 200); song.album = String(described.album || song.album).slice(0, 200); song.loved = Boolean(described.loved);
      item.songIds.push(song.id); used.add(described.path);
    }
    if (manifest?.cover && byPath.get(manifest.cover)) { item.coverFileId = byPath.get(manifest.cover).id; used.add(manifest.cover); }
    // A plain zip of audio files (no manifest) still becomes a playlist.
    for (const [path, file] of byPath) {
      if (used.has(path)) continue;
      if (isAudio(file)) item.songIds.push(songFromFile(file).id);
      else if (isImage(file) && !item.coverFileId) item.coverFileId = file.id;
      else await macos.files.remove(file.id).catch(() => {});
    }
    if (item.songIds.length) { library.playlists.push(item); route = { kind: 'playlist', id: item.id }; query = ''; }
    else if (item.coverFileId) await macos.files.remove(item.coverFileId).catch(() => {});
  } catch (error) {
    await macos.dialog.alert(String(error?.message || error), { title: T('importFailed', 'Import failed') });
  } finally {
    await macos.files.remove(fileId).catch(() => {});
    busy = ''; save(); render();
  }
}
