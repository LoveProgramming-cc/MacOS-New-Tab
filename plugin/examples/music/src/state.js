// Music — a native-runtime app.
//
// Songs are never loaded into this sandbox. Imported audio files live in the host file
// store (macos.files), which also reads their tags and cover art; this script only keeps
// ids and metadata, and the host plays the audio (macos.audio). The whole interface is
// one function of state, view(), handed to macos.ui.render(), which diffs it against
// what is on screen.

const T = (key, fallback) => macos.i18n.t(key, fallback);
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ICON = (name) => `assets/icons/${name}.svg`;
const DEFAULT_ART = 'assets/cover.svg';

// ---------------------------------------------------------------- state
let library = { songs: {}, playlists: [], folders: [], volume: 0.8, shuffle: false, repeat: 'off', accent: '', defaultArtId: '', history: [], fade: false, crossfade: 0 };
let route = { kind: 'songs', id: '' };       // songs | recent | favorites | albums | artists | playlists | folder | album | artist | playlist
let query = '';
const sorts = {};                            // route key -> { field, descending }
let player = { original: [], queue: [], index: -1, paused: true, time: 0, duration: 0, subtitles: [], subtitle: -1 };
let showQueue = false;
let editing = null;                          // { id, title, artist, album } while the info sheet is open
let settingsOpen = false;
let showNow = false;                         // the full-window Now Playing view
let nowTab = 'queue';                        // queue | history
let importing = null;                        // { done, total } while the host is storing files
let usage = null;                            // { count, bytes } shown in Settings
let storage = null;                          // the Manage Storage sheet: { files: Map(id -> size), filter, sort, selected }
let busy = '';

// The accent is the app's own choice, and its own settings UI. It applies while the
// system accent is "multicolor"; a fixed system accent overrides it.
const ACCENTS = { red: '#ff5257', pink: '#f74f9e', orange: '#f7821b', yellow: '#f5b60a', green: '#62ba46', blue: '#0a84ff', purple: '#a550a7', graphite: '#8c8c8c' };
const DEFAULT_ACCENT = 'red';
let accentSetting = macos.context.accentSetting || 'multicolor';
// Light, dark or following the system: the app's own choice, which the host remembers.
let appearance = macos.context.appearance || 'system';

try {
  const saved = await macos.storage.get('library');
  if (saved && typeof saved === 'object') library = { ...library, ...saved, songs: saved.songs || {}, playlists: saved.playlists || [], folders: saved.folders || [], history: Array.isArray(saved.history) ? saved.history : [] };
} catch {}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { macos.storage.set('library', library).catch((error) => macos.log('save failed', String(error))); publishSearch(); publishWidgets(); }, 250);
}
// Spotlight finds songs and playlists; choosing one plays the song or opens the playlist
// (the 'search' event).
let searchSignature = '';
function publishSearch() {
  const items = [
    ...Object.values(library.songs).map((song) => ({ id: `song:${song.id}`, title: song.title || '', subtitle: [song.artist, song.album].filter(Boolean).join(' — ') })),
    ...library.playlists.map((item) => ({ id: `playlist:${item.id}`, title: item.name || '', subtitle: T('playlists', 'Playlists') }))
  ].filter((item) => item.title);
  const signature = JSON.stringify(items);
  if (signature === searchSignature) return;
  searchSignature = signature;
  macos.search.setItems(items).catch(() => {});
}

// ---------------------------------------------------------------- selectors
const routeKey = () => `${route.kind}:${route.id}`;
const playlistOf = (id = route.id) => library.playlists.find((item) => item.id === id) || null;
const currentPlaylist = () => (route.kind === 'playlist' ? playlistOf() : null);
const currentSong = () => library.songs[player.queue[player.index]] || null;
// Songs without a cover of their own show the user's default picture, if one was chosen in Settings.
const defaultArt = () => (library.defaultArtId ? `blob:${library.defaultArtId}` : DEFAULT_ART);
const artOf = (song) => (song?.artId ? `blob:${song.artId}` : defaultArt());
const allSongs = () => Object.values(library.songs);
const artistOf = (song) => song.artist || T('unknownArtist', 'Unknown Artist');
const albumOf = (song) => song.album || T('unknownAlbum', 'Unknown Album');
const albumKey = (song) => `${albumOf(song)} ⧸ ${song.albumArtist || artistOf(song)}`;

function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function longClock(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ${T('hours', 'hr')} ${minutes % 60} ${T('minutes', 'min')}` : `${minutes} ${T('minutes', 'min')}`;
}
const compare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });

function albums() {
  const map = new Map();
  for (const song of allSongs()) {
    const key = albumKey(song);
    if (!map.has(key)) map.set(key, { id: key, title: albumOf(song), artist: song.albumArtist || artistOf(song), songs: [] });
    map.get(key).songs.push(song);
  }
  return [...map.values()].sort((a, b) => compare(a.title, b.title));
}
function artists() {
  const map = new Map();
  for (const song of allSongs()) {
    const key = artistOf(song);
    if (!map.has(key)) map.set(key, { id: key, title: key, songs: [] });
    map.get(key).songs.push(song);
  }
  return [...map.values()].sort((a, b) => compare(a.title, b.title));
}
function playlistCover(item) {
  if (item.coverFileId) return `blob:${item.coverFileId}`;
  const first = item.songIds.map((id) => library.songs[id]).find((song) => song?.artId);
  return first ? `blob:${first.artId}` : defaultArt();
}

// Songs of the current detail route, before search / sort.
function baseSongs() {
  if (route.kind === 'playlist') return (playlistOf()?.songIds || []).map((id) => library.songs[id]).filter(Boolean);
  if (route.kind === 'album') return allSongs().filter((song) => albumKey(song) === route.id).sort((a, b) => (Number(a.track) || 999) - (Number(b.track) || 999) || compare(a.title, b.title));
  if (route.kind === 'artist') return allSongs().filter((song) => artistOf(song) === route.id).sort((a, b) => compare(albumOf(a), albumOf(b)) || (Number(a.track) || 999) - (Number(b.track) || 999));
  if (route.kind === 'favorites') return allSongs().filter((song) => song.loved).sort((a, b) => compare(a.title, b.title));
  if (route.kind === 'recent') return allSongs().sort((a, b) => (b.added || 0) - (a.added || 0));
  return allSongs().sort((a, b) => compare(a.title, b.title));
}
function visibleSongs() {
  let list = baseSongs();
  const needle = query.trim().toLocaleLowerCase();
  if (needle) list = list.filter((song) => `${song.title}\n${song.artist}\n${song.album}`.toLocaleLowerCase().includes(needle));
  const sort = sorts[routeKey()];
  if (sort) {
    const value = (song) => (sort.field === 'time' ? song.duration || 0 : sort.field === 'added' ? song.added || 0 : sort.field === 'plays' ? song.plays || 0 : sort.field === 'artist' ? artistOf(song) : sort.field === 'album' ? albumOf(song) : song.title);
    list = [...list].sort((a, b) => (typeof value(a) === 'number' ? value(a) - value(b) : compare(value(a), value(b))));
    if (sort.descending) list.reverse();
  }
  return list;
}
const isDetail = () => !['albums', 'artists', 'playlists', 'folder'].includes(route.kind);
const folderOf = (id = route.id) => library.folders.find((item) => item.id === id) || null;
