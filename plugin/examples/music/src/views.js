// Music — the interface: sidebar, lists, player bar, Now Playing, sheets.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- view
function iconButton(id, icon, extra = {}) {
  return { type: 'button', id, icon: ICON(icon), iconTint: true, iconSize: 16, variant: 'plain', width: 30, height: 30, shape: 'circle', ...extra };
}

function sidebar() {
  // Library rows neither move nor accept drops; playlists can be dragged, and playlists,
  // folders and “All Playlists” accept them.
  const navItem = (id, title, icon, drop = false) => ({ id, title, icon: ICON(icon), tint: true, drag: false, drop });
  const playlistRow = (item, indent) => ({
    id: `playlist:${item.id}`, title: item.name, icon: playlistCover(item), indent,
    menu: [
      { id: 'play', label: T('play', 'Play') }, { id: 'shuffle', label: T('shuffle', 'Shuffle') }, { separator: true },
      { id: 'rename', label: T('rename', 'Rename…') }, { id: 'move', label: T('moveToFolder', 'Move to Folder…') }, { id: 'export', label: T('exportPlaylist', 'Export Playlist…') },
      { separator: true }, { id: 'delete', label: T('deletePlaylist', 'Delete Playlist'), danger: true }
    ]
  });
  const items = [
    { id: 'h:library', title: T('library', 'Library'), header: true },
    navItem('recent:', T('recentlyAdded', 'Recently Added'), 'nav-recent'), navItem('artists:', T('artists', 'Artists'), 'nav-artists'),
    navItem('albums:', T('albums', 'Albums'), 'nav-albums'), navItem('songs:', T('songs', 'Songs'), 'nav-songs'), navItem('favorites:', T('favorites', 'Favourites'), 'nav-favorites'),
    { id: 'h:playlists', title: T('playlists', 'Playlists'), header: true },
    navItem('playlists:', T('allPlaylists', 'All Playlists'), 'nav-playlists', true)
  ];
  for (const folder of library.folders) {
    items.push({ id: `folder:${folder.id}`, title: folder.name, icon: ICON('nav-folder'), tint: true, disclosure: folder.collapsed ? 'closed' : 'open', drag: false,
      menu: [{ id: 'new-in-folder', label: T('newPlaylist', 'New Playlist') }, { id: 'rename-folder', label: T('rename', 'Rename…') }, { separator: true }, { id: 'delete-folder', label: T('deleteFolder', 'Delete Folder'), danger: true }] });
    if (!folder.collapsed) library.playlists.filter((item) => item.folderId === folder.id).forEach((item) => items.push(playlistRow(item, 1)));
  }
  library.playlists.filter((item) => !library.folders.some((folder) => folder.id === item.folderId)).forEach((item) => items.push(playlistRow(item, 0)));
  const selectedRow = ['album', 'artist'].includes(route.kind) ? `${route.kind}s:` : routeKey();
  return { type: 'stack', id: 'sidebar', direction: 'vertical', gap: 6, width: 214, padding: [8, 8, 10, 10], children: [
    { type: 'list', id: 'nav', grow: 1, plain: true, value: selectedRow, rowHeight: 30, iconSize: 20, draggable: true, dropTarget: true, items },
    ...(importing ? [{ type: 'stack', id: 'import-status', direction: 'vertical', gap: 5, padding: [2, 4, 4, 4], children: [
      { type: 'text', id: 'import-label', variant: 'caption', lines: 1, text: importLabel() },
      { type: 'progress', id: 'import-progress', value: importing.done, max: Math.max(1, importing.total) }
    ] }] : []),
    { type: 'stack', direction: 'horizontal', gap: 6, children: [
      { type: 'button', id: 'add-menu', label: T('new', 'New'), icon: ICON('plus'), iconTint: true, iconSize: 13, variant: 'tinted', grow: 1 },
      { type: 'button', id: 'import-songs', label: T('import', 'Import'), variant: 'plain', grow: 1 }
    ] }
  ] };
}

const importLabel = () => (importing?.exporting ? T('exportingProgress', 'Exporting {done} of {total}…') : T('importingProgress', 'Importing {done} of {total}…')).replace('{done}', String(importing?.done ?? 0)).replace('{total}', String(importing?.total ?? 0));

function collectionView() {
  const rows = route.kind === 'albums'
    ? albums().map((album) => ({ id: album.id, title: album.title, subtitle: `${album.artist} · ${album.songs.length} ${T('songsCount', 'songs')}`, icon: artOf(album.songs.find((song) => song.artId)) }))
    : route.kind === 'artists'
      ? artists().map((artist) => ({ id: artist.id, title: artist.title, subtitle: `${artist.songs.length} ${T('songsCount', 'songs')}`, icon: artOf(artist.songs.find((song) => song.artId)) }))
      : library.playlists.filter((item) => route.kind !== 'folder' || item.folderId === route.id).map((item) => ({ id: item.id, title: item.name, subtitle: `${item.songIds.filter((id) => library.songs[id]).length} ${T('songsCount', 'songs')}${library.folders.find((folder) => folder.id === item.folderId) ? ` · ${library.folders.find((folder) => folder.id === item.folderId).name}` : ''}`, icon: playlistCover(item) }));
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle ? rows.filter((row) => `${row.title}\n${row.subtitle}`.toLocaleLowerCase().includes(needle)) : rows;
  const title = route.kind === 'albums' ? T('albums', 'Albums') : route.kind === 'artists' ? T('artists', 'Artists') : route.kind === 'folder' ? (folderOf()?.name || '') : T('allPlaylists', 'All Playlists');
  return [
    { type: 'stack', id: 'collection-header', direction: 'horizontal', align: 'center', gap: 10, padding: [16, 18, 10, 20], ...bar(BAR.collection), children: [
      { type: 'text', id: 'collection-title', text: title, fontSize: 26, fontWeight: 'bold', grow: 1 },
      { type: 'input', id: 'search', inputType: 'search', value: query, placeholder: T('search', 'Search'), width: 190 }
    ] },
    { type: 'list', id: 'collection', grow: 1, plain: true, rowHeight: 60, iconSize: 46, margin: [0, 10, 0, 10], insetTop: BAR.collection, insetBottom: 86, items: filtered,
      placeholder: route.kind === 'folder' ? T('emptyFolder', 'This folder is empty. Drag playlists onto it in the sidebar.') : route.kind === 'playlists' ? T('noPlaylists', 'No playlists yet. Use “New” to create one.') : T('emptyHint', 'Drop audio files here, or choose “Import”.') }
  ];
}

// The header of a page is a frosted bar floating over its list (material: "bar"): the
// rows scroll underneath it, and the list leaves that much room above its first row.
const BAR = { collection: 62, plain: 112, cover: 180 };
const bar = (height) => ({ height, material: 'bar', alignSelf: 'start', justifySelf: 'stretch' });
function detailView() {
  const list = currentPlaylist();
  const songs = visibleSongs();
  const playing = currentSong();
  const total = songs.reduce((sum, song) => sum + (song.duration || 0), 0);
  const sort = sorts[routeKey()];
  const titles = { songs: T('songs', 'Songs'), recent: T('recentlyAdded', 'Recently Added'), favorites: T('favorites', 'Favourites') };
  const title = list ? list.name : route.kind === 'album' ? route.id.split(' ⧸ ')[0] : route.kind === 'artist' ? route.id : titles[route.kind];
  const subtitle = route.kind === 'album' ? route.id.split(' ⧸ ')[1] : '';
  const cover = list ? playlistCover(list) : (route.kind === 'album' || route.kind === 'artist') ? artOf(baseSongs().find((song) => song.artId)) : '';
  const meta = busy || `${songs.length} ${T('songsCount', 'songs')}${songs.length ? ` · ${longClock(total)}` : ''}`;
  const manualOrder = Boolean(list) && !sort && !query.trim();
  const songMenu = [
    { id: 'play', label: T('play', 'Play') }, { id: 'play-next', label: T('playNext', 'Play Next') }, { id: 'queue', label: T('addToQueue', 'Add to Queue') }, { separator: true },
    { id: 'add-to', label: T('addToPlaylist', 'Add to Playlist…') }, { id: 'love', label: T('toggleFavourite', 'Favourite / Unfavourite') }, { id: 'info', label: T('getInfo', 'Get Info…') }, { id: 'export-song', label: T('exportSong', 'Export Song…') }, { separator: true },
    ...(list ? [{ id: 'remove', label: T('removeFromPlaylist', 'Remove from Playlist') }] : []),
    { id: 'delete', label: T('deleteFromLibrary', 'Delete from Library'), danger: true }
  ];
  const actions = { type: 'stack', direction: 'horizontal', gap: 8, align: 'center', children: [
    iconButton('shuffle-all', 'shuffle', { variant: undefined, background: 'fill', color: 'accent', width: 34, height: 34, disabled: !songs.length, tooltip: T('shuffle', 'Shuffle') }),
    { type: 'button', id: 'play-all', label: T('play', 'Play'), icon: ICON('play'), iconTint: true, iconSize: 12, shape: 'pill', background: 'fill', color: 'accent', fontWeight: 'semibold', height: 34, minWidth: 110, disabled: !songs.length },
    iconButton('more', 'ellipsis', { variant: undefined, background: 'fill', width: 34, height: 34, tooltip: T('more', 'More') })
  ] };
  const tools = { type: 'stack', id: 'tools', direction: 'horizontal', gap: 6, align: 'center', children: [
    iconButton('sort', 'sort', { tooltip: T('sort', 'Sort'), color: sort ? 'accent' : undefined }),
    { type: 'input', id: 'search', inputType: 'search', value: query, placeholder: list ? T('findInPlaylist', 'Find in Playlist') : T('search', 'Search'), width: 190 }
  ] };
  const heading = list
    ? { type: 'input', id: 'title', value: list.name, placeholder: T('playlistName', 'Playlist name'), fontSize: 26, fontWeight: 'bold', maxLength: 80, background: 'clear', border: 'clear' }
    : { type: 'text', id: 'title-static', text: title, fontSize: 26, fontWeight: 'bold', lines: 1 };
  const header = cover
    ? { type: 'stack', id: 'header', direction: 'horizontal', gap: 20, align: 'end', padding: [14, 18, 14, 20], ...bar(BAR.cover), children: [
      { type: 'image', id: 'cover', src: cover, width: 150, height: 150, radius: 12, fit: 'cover', tooltip: list ? T('coverHint', 'Click or drop an image to change the cover') : '' },
      // The column is as tall as the cover: search at its top, the title block at its bottom.
      // (Sized by its content and bottom-aligned, it grew out of the top of the bar.)
      { type: 'stack', direction: 'vertical', gap: 5, grow: 1, minWidth: 0, alignSelf: 'stretch', children: [
        { type: 'stack', direction: 'horizontal', justify: 'end', children: [tools] },
        { type: 'spacer', grow: 1 },
        heading,
        ...(subtitle ? [{ type: 'text', id: 'subtitle', text: subtitle, fontSize: 17, color: 'accent', lines: 1 }] : []),
        { type: 'text', id: 'meta', variant: 'muted', lines: 1, text: meta },
        actions
      ] }
    ] }
    : { type: 'stack', id: 'header', direction: 'vertical', gap: 8, padding: [16, 18, 12, 20], ...bar(BAR.plain), children: [
      { type: 'stack', direction: 'horizontal', align: 'center', gap: 10, children: [{ ...heading, grow: 1 }, tools] },
      { type: 'stack', direction: 'horizontal', align: 'center', gap: 12, children: [actions, { type: 'text', id: 'meta', variant: 'muted', lines: 1, text: meta, grow: 1 }] }
    ] };
  return [
    header,
    { type: 'list', id: 'songs', grow: 1, plain: true, multiple: true, reorderable: manualOrder, draggable: true, rowHeight: 52, iconSize: 40, margin: [0, 10, 0, 10], insetTop: cover ? BAR.cover : BAR.plain, insetBottom: 86,
      placeholder: query.trim() ? T('noResults', 'No results') : T('emptyHint', 'Drop audio files here, or choose “Import”.'),
      items: songs.map((song) => ({ id: song.id, icon: artOf(song), title: song.title, subtitle: [song.artist, song.album].filter(Boolean).join(' — ') || T('unknownArtist', 'Unknown Artist'),
        detail: `${song.loved ? '♥  ' : ''}${song.duration ? clock(song.duration) : ''}`, emphasis: playing?.id === song.id })),
      itemMenu: songMenu }
  ];
}

const loveButton = (song, iconSize, size) => ({ type: 'button', id: 'love-now', icon: ICON(song.loved ? 'star-fill' : 'star'), iconTint: true, iconSize, shape: 'circle', variant: 'plain', width: size, height: size,
  color: song.loved ? 'accent' : 'secondary', showOnHover: !song.loved, tooltip: T('toggleFavourite', 'Favourite / Unfavourite') });

function playerBar() {
  const playing = currentSong();
  const repeatIcon = library.repeat === 'one' ? 'repeat-one' : 'repeat';
  // Playback controls and the timeline keep their order in a right-to-left layout.
  return { type: 'stack', id: 'player', ltr: true, direction: 'horizontal', gap: 8, align: 'center', padding: [8, 14, 8, 12], margin: [0, 14, 12, 14], radius: 16, material: 'glass', alignSelf: 'end', justifySelf: 'stretch', children: [
    iconButton('toggle-shuffle', 'shuffle', { color: library.shuffle ? 'accent' : 'secondary', tooltip: T('shuffle', 'Shuffle') }),
    iconButton('prev', 'previous', { disabled: !playing, iconSize: 18 }),
    iconButton('toggle', player.paused ? 'play' : 'pause', { iconSize: 20, width: 36, height: 36, disabled: !playing && !allSongs().length }),
    iconButton('next', 'next', { disabled: !playing, iconSize: 18 }),
    iconButton('toggle-repeat', repeatIcon, { color: library.repeat === 'off' ? 'secondary' : 'accent', tooltip: T('repeat', 'Repeat') }),
    // Pointing at the cover offers the full-window Now Playing view.
    { type: 'zstack', id: 'now-art-wrap', width: 38, height: 38, margin: [0, 2, 0, 6], children: [
      { type: 'image', id: 'now-art', src: artOf(playing), width: 38, height: 38, radius: 6, fit: 'cover' },
      ...(playing ? [{ type: 'button', id: 'open-now', icon: ICON('expand'), iconTint: true, iconSize: 16, shape: 'circle', width: 38, height: 38, radius: 6, background: 'rgba(0,0,0,0.5)', color: 'white', showOnHover: true, tooltip: showNow ? T('closeNowPlaying', 'Back') : T('nowPlaying', 'Now Playing') }] : [])
    ] },
    { type: 'stack', direction: 'vertical', gap: 1, grow: 1, minWidth: 0, children: [
      // The star appears while the pointer is on the title row; a favourite keeps it lit.
      { type: 'stack', id: 'now-row', direction: 'horizontal', gap: 3, align: 'center', minWidth: 0, children: [
        { type: 'text', id: 'now', lines: 1, fontSize: 12.5, fontWeight: 'semibold', text: playing ? playing.title : T('notPlaying', 'Not Playing') },
        ...(playing ? [loveButton(playing, 13, 18)] : [])
      ] },
      { type: 'text', id: 'now-artist', lines: 1, fontSize: 11, color: 'secondary', text: playing ? [playing.artist, playing.album].filter(Boolean).join(' — ') : '' },
      { type: 'stack', direction: 'horizontal', gap: 8, align: 'center', children: [
        { type: 'text', id: 'time', text: clock(player.time), fontSize: 10, color: 'secondary', width: 30, textAlign: 'end' },
        { type: 'slider', id: 'seek', grow: 1, min: 0, max: Math.max(1, Math.round(player.duration)), step: 1, value: Math.round(player.time), disabled: !playing },
        { type: 'text', id: 'duration', text: clock(player.duration), fontSize: 10, color: 'secondary', width: 30 }
      ] }
    ] },
    iconButton('toggle-queue', 'queue', { color: showQueue ? 'accent' : undefined, tooltip: T('upNext', 'Playing Next') }),
    // The volume controls give way when the queue panel narrows the content area.
    iconButton('mute', library.volume > 0 ? 'volume' : 'mute', { hidden: showQueue }),
    { type: 'slider', id: 'volume', width: 70, min: 0, max: 100, step: 1, value: Math.round(library.volume * 100), hidden: showQueue }
  ] };
}

function queuePanel() {
  const upcoming = player.queue.slice(player.index + 1).map((id, offset) => ({ song: library.songs[id], position: player.index + 1 + offset })).filter((entry) => entry.song);
  return { type: 'stack', id: 'queue-panel', direction: 'vertical', gap: 6, width: 250, padding: [14, 10, 0, 10], children: [
    { type: 'stack', direction: 'horizontal', align: 'center', children: [
      { type: 'text', text: T('upNext', 'Playing Next'), fontSize: 15, fontWeight: 'bold', grow: 1 },
      { type: 'button', id: 'clear-queue', label: T('clear', 'Clear'), variant: 'plain', color: 'accent', disabled: !upcoming.length }
    ] },
    { type: 'list', id: 'queue', grow: 1, plain: true, reorderable: true, rowHeight: 46, iconSize: 34, insetBottom: 86, placeholder: T('queueEmpty', 'Nothing is queued.'),
      items: upcoming.map((entry) => ({ id: `q:${entry.position}`, icon: artOf(entry.song), title: entry.song.title, subtitle: entry.song.artist || '' })),
      itemMenu: [{ id: 'queue-play', label: T('play', 'Play') }, { id: 'queue-remove', label: T('removeFromQueue', 'Remove from Queue') }] }
  ] };
}

// Now Playing: the whole window. Cover (or the video itself) on the left with the
// transport, Playing Next and History on the right.
function songRows(ids, prefix) {
  return ids.map((id, index) => ({ song: library.songs[id], key: `${prefix}:${index}` })).filter((entry) => entry.song)
    .map((entry) => ({ id: entry.key, icon: artOf(entry.song), title: entry.song.title, subtitle: entry.song.artist || T('unknownArtist', 'Unknown Artist'), detail: entry.song.duration ? clock(entry.song.duration) : '' }));
}
function nowPlayingView() {
  const playing = currentSong();
  const closeButton = iconButton('close-now', 'chevron-down', { variant: undefined, background: 'fill', width: 28, height: 28, alignSelf: 'start', justifySelf: 'start', margin: [8, 0, 0, 84], tooltip: T('closeNowPlaying', 'Back') });
  if (playing?.video) {
    // A video takes the whole window; the player bar comes up while the pointer is over it.
    return { type: 'zstack', id: 'now-playing', background: 'black', transition: 'slide-up', children: [
      { type: 'video', id: 'np-video', fit: 'contain' },
      { ...closeButton, background: 'rgba(255,255,255,0.24)', color: 'white' },
      iconButton('subtitles', 'captions', { variant: undefined, background: player.subtitle >= 0 ? 'accent' : 'rgba(255,255,255,0.24)', color: 'white', width: 28, height: 28, alignSelf: 'start', justifySelf: 'end', margin: [8, 14, 0, 0], showOnHover: true, tooltip: T('subtitles', 'Subtitles') }),
      { ...playerBar(), showOnHover: true }
    ] };
  }
  const repeatIcon = library.repeat === 'one' ? 'repeat-one' : 'repeat';
  const upcoming = player.queue.slice(player.index + 1);
  return { type: 'zstack', id: 'now-playing', transition: 'slide-up', children: [
    { type: 'image', id: 'np-backdrop', src: artOf(playing), fit: 'cover', width: 'fill', height: 'fill' },
    { type: 'stack', id: 'np-body', material: 'glass', radius: 0, direction: 'horizontal', gap: 36, align: 'stretch', padding: [54, 36, 30, 36], children: [
      { type: 'stack', id: 'np-left', direction: 'vertical', grow: 1, minWidth: 0, align: 'center', justify: 'center', gap: 14, children: [
        { type: 'image', id: 'np-art', src: artOf(playing), width: 290, height: 290, radius: 12, fit: 'cover' },
        { type: 'stack', direction: 'horizontal', width: 340, align: 'center', gap: 8, margin: [8, 0, 0, 0], children: [
          { type: 'stack', direction: 'vertical', gap: 1, grow: 1, minWidth: 0, children: [
            { type: 'text', id: 'now', lines: 1, fontSize: 17, fontWeight: 'bold', text: playing ? playing.title : T('notPlaying', 'Not Playing') },
            { type: 'text', id: 'now-artist', lines: 1, fontSize: 13, color: 'secondary', text: playing ? [playing.artist, playing.album].filter(Boolean).join(' — ') || T('unknownArtist', 'Unknown Artist') : '' }
          ] },
          ...(playing ? [{ ...loveButton(playing, 16, 28), showOnHover: false, variant: undefined, background: 'fill' }] : [])
        ] },
        { type: 'stack', ltr: true, direction: 'horizontal', width: 340, gap: 8, align: 'center', children: [
          { type: 'text', id: 'time', text: clock(player.time), fontSize: 10, color: 'secondary', width: 30, textAlign: 'end' },
          { type: 'slider', id: 'seek', grow: 1, min: 0, max: Math.max(1, Math.round(player.duration)), step: 1, value: Math.round(player.time), disabled: !playing },
          { type: 'text', id: 'duration', text: clock(player.duration), fontSize: 10, color: 'secondary', width: 30 }
        ] },
        { type: 'stack', ltr: true, direction: 'horizontal', gap: 20, align: 'center', children: [
          iconButton('toggle-shuffle', 'shuffle', { color: library.shuffle ? 'accent' : 'secondary', iconSize: 18, width: 36, height: 36 }),
          iconButton('prev', 'previous', { disabled: !playing, iconSize: 24, width: 44, height: 44 }),
          iconButton('toggle', player.paused ? 'play' : 'pause', { iconSize: 30, width: 52, height: 52, disabled: !playing }),
          iconButton('next', 'next', { disabled: !playing, iconSize: 24, width: 44, height: 44 }),
          iconButton('toggle-repeat', repeatIcon, { color: library.repeat === 'off' ? 'secondary' : 'accent', iconSize: 18, width: 36, height: 36 })
        ] }
      ] },
      { type: 'stack', id: 'np-right', direction: 'vertical', width: 340, gap: 10, children: [
        { type: 'stack', direction: 'horizontal', align: 'center', gap: 8, children: [
          { type: 'segmented', id: 'np-tab', value: nowTab, options: [{ value: 'queue', label: T('upNext', 'Playing Next') }, { value: 'history', label: T('history', 'History') }] },
          { type: 'spacer' },
          { type: 'button', id: nowTab === 'queue' ? 'clear-queue' : 'clear-history', label: T('clear', 'Clear'), variant: 'plain', color: 'accent', disabled: nowTab === 'queue' ? !upcoming.length : !library.history.length }
        ] },
        nowTab === 'queue'
          ? { type: 'list', id: 'queue', grow: 1, plain: true, reorderable: true, rowHeight: 48, iconSize: 36, placeholder: T('queueEmpty', 'Nothing is queued.'),
            items: upcoming.map((id, offset) => ({ song: library.songs[id], position: player.index + 1 + offset })).filter((entry) => entry.song)
              .map((entry) => ({ id: `q:${entry.position}`, icon: artOf(entry.song), title: entry.song.title, subtitle: entry.song.artist || '', detail: entry.song.duration ? clock(entry.song.duration) : '' })),
            itemMenu: [{ id: 'queue-play', label: T('play', 'Play') }, { id: 'queue-remove', label: T('removeFromQueue', 'Remove from Queue') }] }
          : { type: 'list', id: 'history', grow: 1, plain: true, rowHeight: 48, iconSize: 36, placeholder: T('historyEmpty', 'Songs you play appear here.'), items: songRows(library.history, 'h') }
      ] }
    ] },
    closeButton
  ] };
}

// A sheet: a dimmed layer over the window with one floating card.
// The card is never taller than the window: what does not fit scrolls inside it.
function sheet(id, width, children) {
  return { type: 'stack', id, direction: 'vertical', align: 'center', justify: 'center', padding: 14, background: 'rgba(0,0,0,0.28)', children: [
    { type: 'stack', id: `${id}-card`, direction: 'vertical', width, maxWidth: 'fill', maxHeight: 'fill', radius: 12, material: 'glass', children: [
      { type: 'scroll', id: `${id}-scroll`, children: [{ type: 'stack', direction: 'vertical', gap: 10, padding: 18, children }] }
    ] }
  ] };
}
function infoSheet() {
  return sheet('sheet', 360, [
    { type: 'text', text: T('getInfo', 'Get Info…').replace('…', ''), fontSize: 15, fontWeight: 'bold' },
    { type: 'text', text: T('colTitle', 'Title'), variant: 'caption' }, { type: 'input', id: 'info-title', value: editing.title },
    { type: 'text', text: T('colArtist', 'Artist'), variant: 'caption' }, { type: 'input', id: 'info-artist', value: editing.artist },
    { type: 'text', text: T('colAlbum', 'Album'), variant: 'caption' }, { type: 'input', id: 'info-album', value: editing.album },
    { type: 'stack', direction: 'horizontal', gap: 8, justify: 'end', margin: [6, 0, 0, 0], children: [
      { type: 'button', id: 'info-cancel', label: T('cancel', 'Cancel') }, { type: 'button', id: 'info-save', label: T('save', 'Save'), variant: 'primary' }
    ] }
  ]);
}
// Settings… in the application menu arrives as the 'settings' event (manifest: "settings": true).
function settingsSheet() {
  const chosen = library.accent || DEFAULT_ACCENT;
  const megabytes = usage ? `${(usage.bytes / 1_048_576).toFixed(usage.bytes > 104_857_600 ? 0 : 1)} MB` : '…';
  return sheet('settings-sheet', 380, [
    { type: 'text', text: T('settings', 'Settings'), fontSize: 15, fontWeight: 'bold' },
    { type: 'text', text: T('appearance', 'Appearance'), variant: 'caption' },
    { type: 'segmented', id: 'appearance', alignSelf: 'start', value: appearance, options: [{ value: 'system', label: T('appearanceSystem', 'Automatic') }, { value: 'light', label: T('appearanceLight', 'Light') }, { value: 'dark', label: T('appearanceDark', 'Dark') }] },
    { type: 'separator' },
    { type: 'text', text: T('accentColor', 'Accent colour'), variant: 'caption' },
    { type: 'stack', direction: 'horizontal', gap: 9, align: 'center', children: Object.entries(ACCENTS).map(([name, color]) => (
      { type: 'button', id: `accent-${name}`, shape: 'circle', width: 20, height: 20, background: color, color: 'white', fontSize: 11, fontWeight: 'bold', label: chosen === name ? '✓' : '', tooltip: T(`accent_${name}`, name) }
    )) },
    { type: 'text', variant: 'muted', text: accentSetting === 'multicolor' ? T('accentOwnHint', 'Used while the system accent colour is Multicolor.') : T('accentOverriddenHint', 'The system accent colour is set to a fixed colour, which currently overrides this choice.') },
    { type: 'separator' },
    { type: 'text', text: T('playback', 'Playback'), variant: 'caption' },
    { type: 'switch', id: 'fade-toggle', checked: Boolean(library.fade), label: T('fadePause', 'Fade when pausing and resuming') },
    { type: 'stack', direction: 'horizontal', gap: 10, align: 'center', children: [
      { type: 'text', text: T('crossfade', 'Crossfade songs'), grow: 1 },
      { type: 'slider', id: 'crossfade-slider', width: 130, min: 0, max: 12, step: 1, value: crossfadeSeconds() },
      { type: 'text', id: 'crossfade-value', text: crossfadeSeconds() ? T('nSeconds', '{n} s').replace('{n}', String(crossfadeSeconds())) : T('off', 'Off'), width: 44, textAlign: 'end' }
    ] },
    { type: 'separator' },
    { type: 'text', text: T('defaultArtwork', 'Default artwork'), variant: 'caption' },
    { type: 'stack', direction: 'horizontal', gap: 10, align: 'center', children: [
      { type: 'image', id: 'default-art-preview', src: defaultArt(), width: 44, height: 44, radius: 6, fit: 'cover' },
      { type: 'button', id: 'choose-default-art', label: T('chooseImage', 'Choose Image…') },
      { type: 'button', id: 'reset-default-art', label: T('restoreDefault', 'Restore Default'), disabled: !library.defaultArtId }
    ] },
    { type: 'text', variant: 'muted', text: T('defaultArtworkHint', 'Shown for songs that have no cover of their own.') },
    { type: 'separator' },
    { type: 'text', text: T('storage', 'Storage'), variant: 'caption' },
    { type: 'text', text: T('storageSummary', '{count} songs · {size} stored in this app').replace('{count}', String(allSongs().length)).replace('{size}', megabytes) },
    { type: 'stack', direction: 'horizontal', gap: 8, align: 'center', children: [
      { type: 'button', id: 'manage-storage', label: T('manageStorage', 'Manage Storage…') }
    ] },
    { type: 'text', variant: 'muted', text: T('manageStorageHint', 'See what takes up space — largest, never played, not played for a long time — and delete exactly what you choose.') },
    { type: 'text', variant: 'muted', text: T('backupHint', 'To back up or move everything in Music at once, use System Settings ▸ Storage ▸ Export Data…') },
    { type: 'stack', direction: 'horizontal', gap: 8, justify: 'end', margin: [6, 0, 0, 0], children: [
      { type: 'button', id: 'settings-done', label: T('done', 'Done'), variant: 'primary' }
    ] }
  ]);
}

// Manage Storage: every song with what it occupies, so space is freed by choice — the
// largest files, what was never played, what has not been played for months — rather than
// all or nothing. Files nothing refers to any more are offered as one separate item.
const megabytesOf = (bytes) => (bytes >= 1_048_576_000 ? `${(bytes / 1_073_741_824).toFixed(2)} GB` : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(bytes > 104_857_600 ? 0 : 1)} MB` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`);
const songBytes = (song) => (storage?.files.get(song.fileId) ?? song.size ?? 0) + (storage?.files.get(song.artId) || 0);
const STALE_MS = 90 * 86_400_000;
const STORAGE_FILTERS = {
  all: () => true,
  video: (song) => Boolean(song.video),
  never: (song) => !song.plays && !song.lastPlayed,
  stale: (song) => Boolean(song.lastPlayed || song.plays) && Date.now() - (song.lastPlayed || song.added || 0) > STALE_MS,
  loose: (song) => !song.loved && !library.playlists.some((item) => item.songIds.includes(song.id))
};
function referencedFiles() {
  return new Set([library.defaultArtId, ...library.playlists.map((item) => item.coverFileId), ...allSongs().flatMap((song) => [song.fileId, song.artId, ...(song.subtitleFiles || []).map((entry) => entry.fileId)])].filter(Boolean));
}
// What a selection in the current view stands for: the songs to delete, and the
// playlists / folders that go with them.
const playlistSongs = (item) => [...new Set(item.songIds)].map((id) => library.songs[id]).filter(Boolean);
const folderPlaylists = (id) => library.playlists.filter((item) => item.folderId === id);
const folderSongs = (id) => [...new Set(folderPlaylists(id).flatMap((item) => item.songIds))].map((songId) => library.songs[songId]).filter(Boolean);
const sumBytes = (songs) => songs.reduce((sum, song) => sum + songBytes(song), 0);
function storageSelection(ids = storage.selected) {
  if (storage.group === 'songs') return { songs: ids.map((id) => library.songs[id]).filter(Boolean), playlists: [], folders: [] };
  const folders = storage.group === 'folders' ? ids.map((id) => library.folders.find((folder) => folder.id === id)).filter(Boolean) : [];
  const playlists = storage.group === 'folders' ? folders.flatMap((folder) => folderPlaylists(folder.id)) : ids.map((id) => playlistOf(id)).filter(Boolean);
  return { songs: [...new Set(playlists.flatMap((item) => item.songIds))].map((id) => library.songs[id]).filter(Boolean), playlists, folders };
}
function storageRows() {
  const { filter, sort } = storage;
  const order = (list, value) => list.sort((a, b) => (typeof value(a) === 'number' ? value(a) - value(b) : compare(value(a), value(b))) * (sort.direction === 'desc' ? -1 : 1));
  if (storage.group === 'playlists') {
    const value = { title: (item) => item.name, artist: (item) => playlistSongs(item).length, played: (item) => folderOf(item.folderId)?.name || '', size: (item) => sumBytes(playlistSongs(item)) }[sort.column];
    return order([...library.playlists], value).map((item) => ({ id: item.id, icon: playlistCover(item), cells: {
      title: item.name, artist: `${playlistSongs(item).length} ${T('songsCount', 'songs')}`, played: folderOf(item.folderId)?.name || '—', size: megabytesOf(sumBytes(playlistSongs(item))) } }));
  }
  if (storage.group === 'folders') {
    const value = { title: (item) => item.name, artist: (item) => folderPlaylists(item.id).length, played: (item) => folderSongs(item.id).length, size: (item) => sumBytes(folderSongs(item.id)) }[sort.column];
    return order([...library.folders], value).map((item) => ({ id: item.id, cells: {
      title: item.name, artist: `${folderPlaylists(item.id).length} ${T('playlistsCount', 'playlists')}`, played: `${folderSongs(item.id).length} ${T('songsCount', 'songs')}`, size: megabytesOf(sumBytes(folderSongs(item.id))) } }));
  }
  const dates = new Intl.DateTimeFormat(macos.i18n.language(), { dateStyle: 'medium' });
  const value = { title: (song) => song.title, artist: (song) => artistOf(song), played: (song) => song.lastPlayed || 0, size: songBytes }[sort.column] || songBytes;
  const list = allSongs().filter(STORAGE_FILTERS[filter] || STORAGE_FILTERS.all)
    .sort((a, b) => (typeof value(a) === 'number' ? value(a) - value(b) : compare(value(a), value(b))) * (sort.direction === 'desc' ? -1 : 1));
  return list.map((song) => ({ id: song.id, icon: artOf(song), cells: {
    title: song.title, artist: artistOf(song),
    played: song.lastPlayed ? dates.format(song.lastPlayed) : song.plays ? '—' : T('neverPlayed', 'Never'),
    size: megabytesOf(songBytes(song))
  } }));
}
function storageSheet() {
  const keep = referencedFiles();
  let audio = 0; let video = 0; let art = 0; let unused = 0; let unusedCount = 0;
  for (const song of allSongs()) { if (song.video) video += storage.files.get(song.fileId) ?? song.size ?? 0; else audio += storage.files.get(song.fileId) ?? song.size ?? 0; }
  for (const [id, size] of storage.files) {
    if (!keep.has(id)) { unused += size; unusedCount += 1; }
    else if (!allSongs().some((song) => song.fileId === id)) art += size;
  }
  const total = audio + video + art + unused;
  const rows = storageRows();
  const selected = storage.selected.filter((id) => rows.some((row) => row.id === id));
  const selectedBytes = sumBytes(storageSelection(selected).songs);
  const grouped = storage.group !== 'songs';
  const second = { songs: T('colArtist', 'Artist'), playlists: T('songsHeading', 'Songs'), folders: T('playlistsHeading', 'Playlists') }[storage.group];
  const third = { songs: T('lastPlayed', 'Last Played'), playlists: T('folderHeading', 'Folder'), folders: T('songsHeading', 'Songs') }[storage.group];
  const parts = [[T('storageAudio', 'Songs'), audio, 'accent'], [T('storageVideo', 'Videos'), video, 'purple'], [T('storageArt', 'Artwork'), art, 'orange'], [T('storageUnused', 'Unused files'), unused, 'gray']].filter((part) => part[1] > 0);
  const W = 624; let x = 0;
  const bar = [['fillStyle', 'fill'], ['beginPath'], ['roundRect', 0, 0, W, 12, 4], ['fill'], ['save'], ['beginPath'], ['roundRect', 0, 0, W, 12, 4], ['clip'],
    ...parts.flatMap(([, bytes, color]) => { const w = Math.max(3, (bytes / Math.max(1, total)) * W); const cmd = [['fillStyle', color], ['fillRect', x, 0, w - 1, 12]]; x += w; return cmd; }), ['restore']];
  const count = (key) => allSongs().filter(STORAGE_FILTERS[key]).length;
  return sheet('storage-sheet', 660, [
    { type: 'stack', direction: 'horizontal', align: 'center', children: [
      { type: 'text', text: T('manageStorageTitle', 'Storage'), fontSize: 15, fontWeight: 'bold', grow: 1 },
      { type: 'text', text: megabytesOf(total), color: 'secondary' }
    ] },
    { type: 'canvas', id: 'storage-bar', width: W, height: 12, commands: bar },
    { type: 'stack', direction: 'horizontal', gap: 14, children: parts.map(([label, bytes, color]) => ({ type: 'stack', direction: 'horizontal', gap: 5, align: 'center', children: [
      { type: 'stack', width: 8, height: 8, radius: 'full', background: color, children: [] }, { type: 'text', text: `${label}  ${megabytesOf(bytes)}`, fontSize: 11, color: 'secondary' }
    ] })) },
    // Songs one by one, or whole playlists / playlist folders at a time.
    { type: 'stack', direction: 'horizontal', gap: 10, align: 'center', children: [
      { type: 'text', text: T('storageShow', 'Show'), fontSize: 12, color: 'secondary' },
      { type: 'segmented', id: 'storage-group', value: storage.group, options: [
        { value: 'songs', label: `${T('songsHeading', 'Songs')} ${allSongs().length}` }, { value: 'playlists', label: `${T('playlistsHeading', 'Playlists')} ${library.playlists.length}` },
        { value: 'folders', label: `${T('foldersHeading', 'Folders')} ${library.folders.length}` }
      ] }
    ] },
    { type: 'segmented', id: 'storage-filter', value: storage.filter, alignSelf: 'start', hidden: grouped, options: [
      { value: 'all', label: `${T('filterAll', 'All')} ${count('all')}` }, { value: 'video', label: `${T('storageVideo', 'Videos')} ${count('video')}` },
      { value: 'never', label: `${T('filterNever', 'Never Played')} ${count('never')}` }, { value: 'stale', label: `${T('filterStale', 'Not Played in 3 Months')} ${count('stale')}` },
      { value: 'loose', label: `${T('filterLoose', 'Not in a Playlist')} ${count('loose')}` }
    ] },
    ...(grouped ? [{ type: 'text', variant: 'muted', text: storage.group === 'playlists' ? T('storagePlaylistHint', 'Deleting a playlist here deletes the playlist and the songs in it from the whole library.') : T('storageFolderHint', 'Deleting a folder here deletes its playlists and the songs in them from the whole library.') }] : []),
    { type: 'table', id: 'storage-table', height: grouped ? 240 : 262, multiple: true, values: selected, rowHeight: 34, iconSize: 24, sort: storage.sort, placeholder: T('storageNothing', 'Nothing here.'),
      columns: [{ id: 'title', title: grouped ? T('colName', 'Name') : T('colTitle', 'Title'), width: '2fr', sortable: true }, { id: 'artist', title: second, width: '1.4fr', sortable: true, muted: true },
        { id: 'played', title: third, width: 110, sortable: true, muted: true }, { id: 'size', title: T('colSize', 'Size'), width: 84, align: 'end', sortable: true }],
      rows },
    { type: 'stack', direction: 'horizontal', gap: 8, align: 'center', margin: [4, 0, 0, 0], children: [
      { type: 'button', id: 'storage-select-all', label: selected.length === rows.length && rows.length ? T('selectNone', 'Select None') : T('selectAllShown', 'Select All Shown'), disabled: !rows.length },
      ...(unusedCount ? [{ type: 'button', id: 'clean-storage', label: `${T('cleanStorage', 'Remove Unused Files')} (${megabytesOf(unused)})` }] : []),
      { type: 'spacer' },
      { type: 'button', id: 'storage-delete', variant: 'danger', disabled: !selected.length,
        label: selected.length ? T('deleteSelectedN', 'Delete {count} · {size}').replace('{count}', String(selected.length)).replace('{size}', megabytesOf(selectedBytes)) : T('deleteSelected', 'Delete Selected') },
      { type: 'button', id: 'storage-done', label: T('done', 'Done'), variant: 'primary' }
    ] }
  ]);
}

// split: sidebar | content | (queue). The sidebar shows the window material, the content
// and the queue are the opaque content background — the same arrangement as Finder and
// System Settings. The player floats over the content as glass.
function view() {
  return { type: 'zstack', id: 'root', padding: 0, height: 'fill', children: [
    showNow ? nowPlayingView() : { type: 'split', id: 'layout', children: [
      sidebar(),
      { type: 'zstack', id: 'content', children: [
        // The list, its header bar over it, the player over both.
        ...(isDetail() ? detailView() : collectionView()).reverse(),
        playerBar()
      ] },
      ...(showQueue ? [queuePanel()] : [])
    ] },
    ...(editing ? [infoSheet()] : []),
    ...(settingsOpen ? [settingsSheet()] : []),
    ...(storage ? [storageSheet()] : [])
  ] };
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; macos.ui.render(view()).catch((error) => macos.log('render failed', String(error))); updateStatusItem(); });
}
function status(text) { busy = text; render(); }
function go(kind, id = '') { route = { kind, id }; query = ''; render(); }
