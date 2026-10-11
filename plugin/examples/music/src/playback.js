// Music — playback: queue, shuffle, repeat, fades.
// (Part of one script: the files listed under entry.script run in order and share a scope.)

// ---------------------------------------------------------------- playback
function shuffled(ids) {
  const list = [...ids];
  for (let i = list.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
// Pausing and resuming fade over this long when the user switched that on; songs blend
// into each other over library.crossfade seconds (0: they simply follow one another).
const FADE_SECONDS = 0.45;
const crossfadeSeconds = () => Math.max(0, Math.min(12, Number(library.crossfade) || 0));
async function load({ from = null } = {}) {
  const song = currentSong();
  if (!song) return;
  // A picture cannot be blended, so videos start and end with a cut.
  const crossfade = from && !from.video && !song.video ? crossfadeSeconds() : 0;
  player.crossing = false;
  player.time = 0; player.duration = song.duration || 0; player.paused = false;
  library.history = [song.id, ...library.history.filter((id) => id !== song.id)].slice(0, 60);
  song.lastPlayed = Date.now();
  save();
  render();
  try {
    // Subtitles: the tracks inside the video come first, then the files added for this song.
    await macos.audio.load(song.fileId, { crossfade, subtitles: song.subtitleFiles || [], subtitle: song.subtitleOff ? -1 : song.subtitleIndex ?? 0 });
    macos.audio.setMetadata({ title: song.title, artist: song.artist || '', album: song.album || '', artwork: song.artId ? `blob:${song.artId}` : '' }).catch(() => {});
  } catch (error) { player.paused = true; render(); await macos.dialog.alert(String(error?.message || error), { title: song.title }); }
}
// Start playing `ids`. With shuffle on, the chosen song (if any) comes first and the
// rest follow in random order; the original order is kept so shuffle can be undone.
function playSongs(ids, startId = '') {
  if (!ids.length) return;
  player.original = [...ids];
  if (library.shuffle) {
    const first = startId || ids[Math.floor(Math.random() * ids.length)];
    player.queue = [first, ...shuffled(ids.filter((id) => id !== first))];
    player.index = 0;
  } else { player.queue = [...ids]; player.index = Math.max(0, ids.indexOf(startId)); }
  load();
}
function setShuffle(on) {
  library.shuffle = on;
  const current = player.queue[player.index];
  if (current) {
    if (on) { const rest = player.queue.slice(player.index + 1); player.queue = [...player.queue.slice(0, player.index + 1), ...shuffled(rest)]; }
    else if (player.original.includes(current)) { player.queue = [...player.original]; player.index = player.original.indexOf(current); }
  }
  save(); render();
}
function next({ auto = false } = {}) {
  if (!player.queue.length) return;
  const from = player.paused ? null : currentSong();
  if (auto && library.repeat === 'one') return load({ from });
  if (player.index < player.queue.length - 1) { player.index += 1; return load({ from }); }
  if (library.repeat === 'all' || !auto) {
    if (library.shuffle) player.queue = shuffled(player.queue);
    player.index = 0;
    return load({ from });
  }
  player.paused = true; player.time = 0; render();
}
function previous() {
  if (!player.queue.length) return;
  if (player.time > 3) return macos.audio.seek(0);
  const from = player.paused ? null : currentSong();
  player.index = (player.index - 1 + player.queue.length) % player.queue.length;
  load({ from });
}
async function toggle() {
  if (!currentSong()) return playSongs((isDetail() ? visibleSongs() : allSongs()).map((song) => song.id));
  const fade = library.fade ? FADE_SECONDS : 0;
  if (player.paused) await macos.audio.play({ fade }); else await macos.audio.pause({ fade });
}
async function stop() {
  await macos.audio.stop().catch(() => {});
  player = { original: [], queue: [], index: -1, paused: true, time: 0, duration: 0, subtitles: [], subtitle: -1 };
}
function enqueue(ids, { nextUp = false } = {}) {
  if (!currentSong()) return playSongs(ids);
  if (nextUp) player.queue.splice(player.index + 1, 0, ...ids); else player.queue.push(...ids);
  player.original.push(...ids.filter((id) => !player.original.includes(id)));
  render();
}

macos.on('audio', (event) => {
  if (event.type === 'action') {
    if (event.action === 'play' || event.action === 'pause') toggle();
    if (event.action === 'nexttrack') next();
    if (event.action === 'previoustrack') previous();
    return;
  }
  if (event.type === 'ended') { const song = currentSong(); if (song) { song.plays = (song.plays || 0) + 1; save(); } next({ auto: true }); return; }
  if (event.type === 'error') { player.paused = true; render(); return; }
  const wasPaused = player.paused;
  if (Array.isArray(event.subtitles)) { player.subtitles = event.subtitles; player.subtitle = event.subtitle; }
  player.paused = event.paused; player.time = event.currentTime; if (event.duration) player.duration = event.duration;
  // With cross-fading on, the next song starts under the end of this one.
  const blend = crossfadeSeconds();
  if (blend && event.type === 'timeupdate' && !event.paused && !player.crossing && event.duration > blend * 2 + 1 && event.duration - event.currentTime <= blend
    && !currentSong()?.video && (player.index < player.queue.length - 1 || library.repeat !== 'off')) {
    player.crossing = true;
    const song = currentSong(); if (song) { song.plays = (song.plays || 0) + 1; save(); }
    next({ auto: true });
    return;
  }
  if (event.type === 'loadedmetadata') {
    const song = currentSong();
    if (song && event.duration && Math.abs((song.duration || 0) - event.duration) > 1) { song.duration = event.duration; save(); }
  }
  // Progress ticks only touch three controls; everything else re-renders through view().
  if (event.type === 'timeupdate' && wasPaused === event.paused) {
    macos.ui.patch('time', { text: clock(player.time) });
    macos.ui.patch('seek', { value: Math.round(player.time), max: Math.max(1, Math.round(player.duration)) });
    macos.ui.patch('duration', { text: clock(player.duration) });
    tickStatusPanel();
  } else render();
});

// The menu bar item: what is playing, with its cover, the transport controls and the place
// in the song — a panel the system draws under the item (statusItem `panel`). A right-click
// opens the short menu instead.
let statusSignature = '';
let statusSecond = -1;
const remaining = () => (player.duration ? `-${clock(Math.max(0, player.duration - player.time))}` : '');
function statusPanel(song) {
  const control = (id, icon, size, disabled) => ({ type: 'button', id, icon: ICON(icon), iconTint: true, iconSize: size, variant: 'plain', shape: 'circle', width: size + 18, height: size + 18, disabled });
  return { type: 'stack', direction: 'horizontal', gap: 14, align: 'center', width: 356, children: [
    { type: 'image', id: 'show', src: artOf(song), width: 116, height: 116, radius: 10, fit: 'cover', tooltip: T('showMusic', 'Show Music') },
    { type: 'stack', direction: 'vertical', gap: 2, grow: 1, minWidth: 0, children: [
      { type: 'text', text: song ? song.title : T('notPlaying', 'Not Playing'), fontSize: 14, fontWeight: 'semibold', lines: 1 },
      { type: 'text', text: song ? [song.artist, song.album].filter(Boolean).join(' — ') || ' ' : ' ', fontSize: 12, color: 'secondary', lines: 1 },
      { type: 'stack', direction: 'horizontal', justify: 'center', align: 'center', gap: 16, margin: [8, 0, 4, 0], children: [
        control('previous', 'previous', 18, !song),
        control('toggle', player.paused || !song ? 'play' : 'pause', 24, false),
        control('next', 'next', 18, !song)
      ] },
      { type: 'slider', id: 'panel-seek', min: 0, max: Math.max(1, Math.round(player.duration)), step: 1, value: Math.round(player.time), disabled: !song },
      { type: 'stack', direction: 'horizontal', children: [
        { type: 'text', id: 'panel-time', text: clock(player.time), fontSize: 11, color: 'secondary', grow: 1 },
        { type: 'text', id: 'panel-left', text: remaining(), fontSize: 11, color: 'secondary' }
      ] }
    ] }
  ] };
}
function updateStatusItem() {
  const song = currentSong();
  const signature = `${song?.id || ''}|${song?.artId || ''}|${library.defaultArtId}|${player.paused}|${Math.round(player.duration)}|${macos.i18n.language()}`;
  if (signature === statusSignature) return;
  statusSignature = signature;
  const line = song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''}` : T('notPlaying', 'Not Playing');
  macos.statusItem.set({
    icon: ICON('nav-songs'), tooltip: line, panel: statusPanel(song),
    items: [
      { id: 'now', label: line, disabled: true },
      { separator: true },
      { id: 'toggle', label: player.paused || !song ? T('play', 'Play') : T('pause', 'Pause') },
      { id: 'next', label: T('menuNext', 'Next'), disabled: !song },
      { id: 'previous', label: T('menuPrevious', 'Previous'), disabled: !song },
      { separator: true },
      { id: 'show', label: T('showMusic', 'Show Music') }
    ]
  }).catch(() => {});
}
// The place in the song, once a second.
function tickStatusPanel() {
  const second = Math.round(player.time);
  if (second === statusSecond) return;
  statusSecond = second;
  macos.statusItem.patch([
    { id: 'panel-seek', props: { value: second, max: Math.max(1, Math.round(player.duration)) } },
    { id: 'panel-time', props: { text: clock(player.time) } },
    { id: 'panel-left', props: { text: remaining() } }
  ]).catch(() => {});
}
