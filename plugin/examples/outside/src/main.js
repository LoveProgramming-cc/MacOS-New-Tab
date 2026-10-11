// 窗外 / Outside — the weather, on the desktop itself.
//
// The window is frameless, transparent, as large as the desktop and on the desktop level:
// behind every other window, over the wallpaper, the icons and the widgets. It takes the
// pointer nowhere (macos.window.setHitRegion), so every click goes through to the desktop;
// only the settings panel, while it is open, takes the pointer — and for that time the
// window comes in front of the others, or the panel would be hidden behind them.

const DEFAULTS = {
  mode: 'live', scene: 'snow', intensity: 1, wind: 0, city: null,
  pile: true, pointer: false, flashes: true, tint: true, haze: true, eco: false, paused: false
};
const settings = { ...DEFAULTS };
let weather = null;            // last live reading: { code, temp, isDay, windSpeed, windDir, fetchedAt }
let weatherState = 'idle';     // idle | loading | ok | error
let frame = null;
let firstRun = false;

const $ = (sel) => root.querySelector(sel);
const panel = $('#panel');
const save = () => macos.storage.set('settings', { ...settings }).catch(() => {});

// ---- what the sky shows ---------------------------------------------------------------------
function current() {
  const hour = new Date().getHours();
  const localNight = hour < 6 || hour >= 19;
  if (settings.mode === 'live' && weather && weatherState !== 'error') {
    const reading = fromCode(weather.code);
    return {
      scene: reading.scene, label: reading.label, live: true,
      intensity: Math.min(2.4, reading.level * settings.intensity),
      wind: windLean(weather.windSpeed, weather.windDir), night: !weather.isDay
    };
  }
  // Live weather still on its way: a quiet clear sky rather than a guess.
  const scene = settings.mode === 'live' && weatherState !== 'error' ? 'clear' : settings.scene;
  return { scene, label: sceneName(scene), live: false, intensity: settings.intensity, wind: settings.wind, night: localNight };
}

function apply() {
  const now = current();
  setSky({
    scene: now.scene, intensity: now.intensity, wind: now.wind, night: now.night,
    pile: settings.pile, flashes: settings.flashes, tint: settings.tint, haze: settings.haze, eco: settings.eco
  });
  if (settings.paused || !visible) stopSky(settings.paused); else startSky();
  tellPeers();
  renderPanel();
  publishStatusItem();
  publishWidget();
}

function statusLine() {
  const now = current();
  const prefix = settings.paused ? `${T('paused', 'Paused')} · ` : '';
  if (settings.mode === 'manual') return `${prefix}${T('manualLine', 'Your pick')} · ${now.label}`;
  if (!settings.city) return `${prefix}${T('pickCity', 'Choose a city for live weather')}`;
  if (weatherState === 'loading' && !weather) return `${prefix}${settings.city.name} · ${T('loading', 'Fetching the weather…')}`;
  if (weatherState === 'error') return `${prefix}${T('fetchFailed', 'Could not get the weather')} · ${now.label}`;
  if (!weather) return `${prefix}${settings.city.name}`;
  const temp = Number.isFinite(weather.temp) ? ` · ${Math.round(weather.temp)}°` : '';
  return `${prefix}${settings.city.name}${temp} · ${now.label}`;
}

// ---- live weather ------------------------------------------------------------------------------
async function refreshWeather({ force = false } = {}) {
  if (settings.mode !== 'live' || !settings.city) return;
  if (!force && weather && weather.city === cityKey() && Date.now() - weather.fetchedAt < 14 * 60 * 1000) { weatherState = 'ok'; apply(); return; }
  weatherState = 'loading'; renderPanel();
  try {
    weather = { ...(await fetchWeather(settings.city)), city: cityKey() };
    weatherState = 'ok';
    macos.storage.set('weather', weather).catch(() => {});
  } catch (error) {
    weatherState = 'error';
    macos.log('weather failed', String(error?.message || error));
  }
  apply();
}
const cityKey = () => (settings.city ? `${settings.city.lat},${settings.city.lon}` : '');
setInterval(() => refreshWeather(), 15 * 60 * 1000);

async function chooseCity(city) {
  settings.city = city; settings.mode = 'live'; weather = null; save();
  results.replaceChildren();
  cityField.value = city.name;
  await refreshWeather({ force: true });
}

// ---- the window: the whole desktop -----------------------------------------------------------
async function fitWindow() {
  try {
    let f = await macos.window.getFrame();
    const screen = f.screen || { width: f.width, height: f.height, top: 0 };
    const top = screen.top || 0;
    const width = Math.round(screen.width); const height = Math.round(screen.height - top);
    if (Math.round(f.x) !== 0 || Math.round(f.y) !== top) f = (await macos.window.moveTo(0, top)) || f;
    if (Math.round(f.width) !== width || Math.round(f.height) !== height) {
      await macos.window.resize(width, height);
      f = (await macos.window.moveTo(0, top)) || (await macos.window.getFrame());
    }
    frame = f;
  } catch (error) { macos.log('fit failed', String(error)); }
  layout();
}
function layout() {
  const w = window.innerWidth || frame?.width || 800;
  const h = window.innerHeight || frame?.height || 600;
  setViewSize(w, h);
  placeSurfaces();
  updateShape();
}
window.addEventListener('resize', () => layout());
macos.on('screenchange', () => fitWindow());

// ---- what the weather falls on (permission: windows) --------------------------------------------
// The Dock and the windows on the desktop, as the system reports them: snow settles on the
// top of each, rain splashes there, and all of it follows them as they move. Without the
// permission there is the Dock as it was when the window was last fitted, and the ground.
let desktop = null;
function placeSurfaces() {
  if (!frame) return;
  const ox = frame.x; const oy = frame.y;
  const list = [{ id: 'ground', kind: 'ground', x: 0, y: window.innerHeight || frame.height, w: window.innerWidth || frame.width }];
  const dock = desktop ? desktop.dock : frame.screen?.dock;
  if (dock) list.push({ id: 'dock', kind: 'dock', x: dock.x - ox, y: dock.y - oy, w: dock.width, r: dock.radius || 0, z: 1e9 });
  const windows = (desktop?.windows || []).filter((w) => !w.own && !w.frameless && w.level === 'normal');
  for (const w of windows) list.push({ id: `window:${w.id}`, kind: 'window', x: w.x - ox, y: w.y - oy, w: w.width, r: w.radius || 0, z: w.z });
  // The pet's head: rain splashes on it, snow sits on it until she shakes it off. She told us
  // where in her window it is.
  for (const w of desktop?.windows || []) {
    if (w.app !== PET || !petHead) continue;
    const width = petHead.w * w.width;
    list.push({ id: `pet:${w.id}`, kind: 'pet', x: w.x + petHead.x * w.width - ox, y: w.y + petHead.y * w.height - oy, w: width, r: width / 2, z: 1e9 });
  }
  setBlockers(windows.map((w) => ({ x: w.x - ox, y: w.y - oy, w: w.width, h: w.height, z: w.z })));
  setSurfaces(list);
}
macos.on('desktopchange', (next) => { desktop = next; placeSurfaces(); });
async function watchDesktop() {
  try { desktop = await macos.desktop.watch(true); } catch { desktop = null; }
  placeSurfaces();
}

// ---- working with Hoshino (manifest: "peers") ------------------------------------------------------
// The pet tells the weather where her feet are, and the snow there is kicked up; the weather
// tells her what it is doing, so she can hold a hand out into the rain.
const PET = 'hoshino-pet';
let petHead = null;            // { x, y, w } as fractions of her window
let told = '';
// Something came down on her: said at most once every few seconds for each kind of thing.
const hitSaid = {};
function petHit(kind) {
  const now = performance.now();
  if (now - (hitSaid[kind] || 0) < (kind === 'snowcap' ? 2500 : 5000)) return;
  hitSaid[kind] = now;
  macos.apps.send(PET, { type: 'hit', kind }).catch(() => {});
}
function tellPeers(force) {
  const now = current();
  const key = `${now.scene}|${now.night}|${settings.paused}`;
  if (!force && key === told) return;
  told = key;
  macos.apps.send(PET, { type: 'weather', scene: settings.paused ? 'clear' : now.scene, night: Boolean(now.night) }).catch(() => {});
}
macos.on('peerchange', ({ id, running }) => { if (id !== PET) return; if (running) tellPeers(true); else { petHead = null; placeSurfaces(); } });
macos.on('message', ({ from, message }) => {
  if (from !== PET || !message || !frame) return;
  if (message.type === 'hello') {
    const head = message.head;
    petHead = head && [head.x, head.y, head.w].every(Number.isFinite) ? { x: head.x, y: head.y, w: head.w } : null;
    tellPeers(true); placeSurfaces();
  }
  if (message.type === 'shake') shakeOffPet();
  // Her feet, in desktop coordinates: a step scuffs the snow, a landing scatters it.
  if (message.type === 'step' || message.type === 'land') {
    const x = Number(message.x) - frame.x; const y = Number(message.y) - frame.y;
    if (Number.isFinite(x) && Number.isFinite(y)) sweep(x, y, Number(message.vx) || 0, message.type === 'land' ? 34 : 16, message.type === 'land' ? 0.9 : 0.55);
  }
});

// Clicks go through everything except the open panel. (setHitRegion, not setShape: a shape
// would cut the picture too, and the weather is drawn over the whole window.)
let shapeSent = '';
function updateShape() {
  let rects = [];
  if (!panel.hidden) {
    const r = panel.getBoundingClientRect();
    rects = [[Math.floor(r.left) - 2, Math.floor(r.top) - 2, Math.ceil(r.width) + 4, Math.ceil(r.height) + 4]];
  }
  const key = JSON.stringify(rects);
  if (key === shapeSent) return;
  shapeSent = key;
  macos.window.setHitRegion(rects).catch(() => {});
}

// ---- running only while it can be seen ---------------------------------------------------------
// (It keeps running while a window is dragged — its snow has to fall off — at half the frames.)
let visible = true;
macos.on('hostdragchange', ({ active }) => setSky({ slow: Boolean(active) }));
macos.on('visibilitychange', ({ visible: v }) => { visible = v !== false; apply(); });
macos.on('themechange', ({ theme }) => panel.classList.toggle('dark', theme === 'dark'));

// ---- the pointer: umbrella, broom and lantern (permission: pointer) ------------------------------
async function setPointer(on) {
  if (on) {
    const status = await macos.permissions.status().catch(() => ({}));
    if (status.pointer && status.pointer !== 'granted' && !(await macos.permissions.request(['pointer']).catch(() => false))) on = false;
  }
  try { await macos.window.trackPointer(on); } catch { on = false; }
  settings.pointer = on;
  if (!on) setSky({ pointer: null });
  save(); renderPanel(); publishStatusItem();
}
let lastPointer = null;
macos.on('pointerposition', ({ x, y }) => {
  const at = performance.now();
  const vx = lastPointer ? ((x - lastPointer.x) / Math.max(16, at - lastPointer.at)) * 1000 : 0;
  lastPointer = { x, y, at };
  setSky({ pointer: { x, y, vx, at } });
});

// ---- the panel ---------------------------------------------------------------------------------
const cityField = $('#city');
const results = $('#results');
const sceneGrid = $('#manual');

function openPanel() {
  if (!panel.hidden) return;
  panel.hidden = false;
  macos.window.setLevel('floating').catch(() => {});
  renderPanel();
  requestAnimationFrame(updateShape);
  setTimeout(updateShape, 220);
}
function closePanel() {
  if (panel.hidden) return;
  panel.hidden = true;
  results.replaceChildren();
  updateShape();
  macos.window.setLevel('desktop').catch(() => {});
}
function togglePanel() { if (panel.hidden) { macos.window.focus().catch(() => {}); openPanel(); } else closePanel(); }

function translateStatic() {
  root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T(el.dataset.t, el.textContent); });
  cityField.placeholder = T('cityPlaceholder', 'City, e.g. Singapore');
  $('#close').title = T('close', 'Close');
  $('#credit').textContent = T('credit', 'Weather data: Open-Meteo');
  sceneGrid.replaceChildren(...SCENE_ORDER.map((scene) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'scene'; button.dataset.scene = scene;
    const icon = document.createElement('b'); icon.textContent = SCENE_EMOJI[scene];
    const label = document.createElement('span'); label.textContent = sceneName(scene);
    button.append(icon, label);
    button.addEventListener('click', () => { settings.mode = 'manual'; settings.scene = scene; save(); apply(); });
    return button;
  }));
}

function renderPanel() {
  const now = current();
  $('#now-emoji').textContent = sceneEmoji(now.scene, now.night);
  $('#now-line').textContent = statusLine();
  if (panel.hidden) return;
  root.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
  $('#live').hidden = settings.mode !== 'live';
  sceneGrid.hidden = settings.mode !== 'manual';
  sceneGrid.querySelectorAll('.scene').forEach((b) => b.classList.toggle('on', b.dataset.scene === settings.scene));
  if (document.activeElement !== cityField && settings.city && !cityField.value) cityField.value = settings.city.name;
  const updated = $('#updated');
  if (weatherState === 'loading') updated.textContent = T('loading', 'Fetching the weather…');
  else if (weatherState === 'error') updated.textContent = T('fetchFailedShort', 'Offline — showing your pick');
  else if (weather) updated.textContent = `${T('updated', 'Updated')} ${new Date(weather.fetchedAt).toLocaleTimeString(macos.i18n.language(), { hour: '2-digit', minute: '2-digit' })}`;
  else updated.textContent = '';
  $('#intensity').value = String(settings.intensity);
  const wind = $('#wind');
  wind.value = String(now.live ? now.wind : settings.wind);
  wind.disabled = now.live;
  wind.closest('.row').classList.toggle('off', now.live);
  wind.title = now.live ? T('windLive', 'Live: follows the real wind') : '';
  $('#opt-pile').checked = settings.pile;
  $('#opt-pointer').checked = settings.pointer;
  $('#opt-flashes').checked = settings.flashes;
  $('#opt-tint').checked = settings.tint;
  $('#opt-haze').checked = !settings.haze;
  $('#opt-eco').checked = settings.eco;
  $('#pause').textContent = settings.paused ? T('resume', 'Resume') : T('pause', 'Pause');
  requestAnimationFrame(updateShape);
}

$('#close').addEventListener('click', closePanel);
root.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => {
  settings.mode = b.dataset.mode; save(); apply();
  if (settings.mode === 'live') { if (settings.city) refreshWeather(); else cityField.focus(); }
}));
async function runSearch() {
  const query = cityField.value.trim();
  if (!query) return;
  const note = (text) => { const div = document.createElement('div'); div.className = 'note'; div.textContent = text; results.replaceChildren(div); updateShape(); };
  note(T('searching', 'Searching…'));
  try {
    const found = await searchCities(query);
    if (!found.length) { note(T('noCity', 'No city by that name.')); return; }
    results.replaceChildren(...found.map((city) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = city.name;
      const small = document.createElement('small'); small.textContent = city.region; button.append(small);
      button.addEventListener('click', () => chooseCity(city));
      return button;
    }));
  } catch (error) { note(T('searchFailed', 'Search failed — check the network permission.')); }
  updateShape();
}
$('#search').addEventListener('click', runSearch);
cityField.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runSearch(); } });
$('#refresh').addEventListener('click', () => refreshWeather({ force: true }));
$('#intensity').addEventListener('input', (e) => { settings.intensity = Number(e.target.value); apply(); });
$('#intensity').addEventListener('change', save);
$('#wind').addEventListener('input', (e) => { settings.wind = Number(e.target.value); apply(); });
$('#wind').addEventListener('change', save);
$('#opt-pile').addEventListener('change', (e) => { settings.pile = e.target.checked; save(); apply(); });
$('#opt-pointer').addEventListener('change', (e) => setPointer(e.target.checked));
$('#opt-flashes').addEventListener('change', (e) => { settings.flashes = e.target.checked; save(); apply(); });
$('#opt-tint').addEventListener('change', (e) => { settings.tint = e.target.checked; save(); apply(); });
$('#opt-haze').addEventListener('change', (e) => { settings.haze = !e.target.checked; save(); apply(); });
$('#opt-eco').addEventListener('change', (e) => { settings.eco = e.target.checked; save(); apply(); });
$('#pause').addEventListener('click', () => { settings.paused = !settings.paused; save(); apply(); });
$('#credit').addEventListener('click', () => macos.openExternal('https://open-meteo.com/').catch(() => {}));

// Escape closes the panel; the weather itself is never closed by a stray key.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (document.activeElement === cityField && results.childElementCount) { results.replaceChildren(); updateShape(); return; }
  closePanel();
});

// Opening the application again (Launchpad, Spotlight) while it runs opens the panel.
// Clicking anywhere else (the window loses focus) closes it again, like a popover.
macos.on('reopen', () => openPanel());
macos.on('blur', () => { if (document.activeElement !== cityField || !cityField.value) closePanel(); });
macos.on('settings', () => { macos.window.focus().catch(() => {}); openPanel(); });

// ---- menus: the menu bar menu, the status item --------------------------------------------------
async function command(id) {
  if (id === 'live') { settings.mode = 'live'; save(); apply(); if (settings.city) refreshWeather(); else { macos.window.focus().catch(() => {}); openPanel(); cityField.focus(); } }
  else if (id.startsWith('scene:')) { settings.mode = 'manual'; settings.scene = id.slice(6); save(); apply(); }
  else if (id === 'panel') togglePanel();
  else if (id === 'pause') { settings.paused = !settings.paused; save(); apply(); }
  else if (id === 'pointer') setPointer(!settings.pointer);
  else if (id === 'quit') macos.window.close();
}
macos.on('menucommand', ({ command: id }) => command(String(id || '')));
macos.on('statusitem', ({ id }) => { if (id) command(String(id)); else togglePanel(); });

let statusSent = '';
function publishStatusItem() {
  const now = current();
  const items = [
    { id: 'now', label: statusLine(), disabled: true },
    { separator: true },
    { id: 'live', label: T('modeLive', 'Live Weather'), checked: settings.mode === 'live' },
    { separator: true },
    ...SCENE_ORDER.map((scene) => ({ id: `scene:${scene}`, label: `${SCENE_EMOJI[scene]}  ${sceneName(scene)}`, checked: settings.mode === 'manual' && settings.scene === scene })),
    { separator: true },
    { id: 'pointer', label: T('optPointer', 'Pointer is an umbrella'), checked: settings.pointer },
    { id: 'pause', label: settings.paused ? T('resume', 'Resume') : T('pause', 'Pause') },
    { id: 'panel', label: T('menuPanel', 'Weather Panel…') },
    { separator: true },
    { id: 'quit', label: T('quit', 'Quit Outside') }
  ];
  const title = now.live && Number.isFinite(weather?.temp) ? `${Math.round(weather.temp)}°` : '';
  const item = { icon: 'assets/status.svg', template: true, title, tooltip: statusLine(), items };
  const key = JSON.stringify(item);
  if (key === statusSent) return;
  statusSent = key;
  macos.statusItem.set(item).catch(() => {});
}

// ---- the widget ----------------------------------------------------------------------------------
const GRADIENTS = {
  clear: ['#4aa3ff', '#1f6fe0'], clearNight: ['#1d2a5a', '#0b1230'], cloudy: ['#8aa4c2', '#5b7290'], drizzle: ['#7b93ad', '#4f6681'],
  rain: ['#5d7590', '#34485f'], storm: ['#3f4a63', '#1d2333'], snow: ['#a9c3e0', '#7393b8'], blizzard: ['#b9c8da', '#7c8ea6'],
  fog: ['#b7bec7', '#8a939e'], sakura: ['#ffb6c9', '#ef7f9f'], leaves: ['#f0a04b', '#c2552c'], fireflies: ['#1d3324', '#0b1510'], meteors: ['#2a2457', '#0d0b26']
};
let widgetSent = '';
function publishWidget() {
  const now = current();
  const gradient = now.scene === 'clear' && now.night ? GRADIENTS.clearNight : GRADIENTS[now.scene] || GRADIENTS.clear;
  const place = settings.mode === 'live' && settings.city ? settings.city.name : T('manualLine', 'Your pick');
  const temp = now.live && Number.isFinite(weather?.temp) ? `${Math.round(weather.temp)}°` : sceneEmoji(now.scene, now.night);
  const white = (text, extra) => ({ type: 'text', text, color: 'white', lines: 1, ...extra });
  const small = { type: 'stack', direction: 'vertical', gradient, padding: 14, gap: 2, children: [
    white(place, { fontSize: 13, fontWeight: 'semibold' }),
    white(temp, { fontSize: 38, fontWeight: 'light' }),
    { type: 'spacer' },
    white(now.live ? sceneEmoji(now.scene, now.night) : '', { fontSize: 20 }),
    white(now.label, { fontSize: 12, fontWeight: 'medium' })
  ] };
  const medium = { type: 'stack', direction: 'horizontal', gradient, padding: 16, gap: 12, children: [
    { type: 'stack', direction: 'vertical', grow: 1, gap: 2, children: [
      white(place, { fontSize: 14, fontWeight: 'semibold' }),
      white(temp, { fontSize: 42, fontWeight: 'light' }),
      { type: 'spacer' },
      white(now.label, { fontSize: 13, fontWeight: 'medium' }),
      white(T('widgetOnDesktop', 'On your desktop now'), { fontSize: 11, opacity: 0.8 })
    ] },
    { type: 'text', text: sceneEmoji(now.scene, now.night), fontSize: 56 }
  ] };
  const content = { small, medium };
  const key = JSON.stringify(content);
  if (key === widgetSent) return;
  widgetSent = key;
  macos.widgets.set('now', content).catch(() => {});
}
macos.on('widget', () => openPanel());

// ---- the snow you leave behind ----------------------------------------------------------------------
// Written only when the snow has changed: on a clear day nothing is stored at all.
let pileSaved = '';
function savePile() {
  const lying = pileSnapshot();
  const key = JSON.stringify(lying);
  if (key === pileSaved) return;
  pileSaved = key;
  macos.storage.set('pile', { lying, at: Date.now() }).catch(() => {});
}
setInterval(savePile, 20000);
macos.on('close', savePile);
macos.on('languagechange', () => { statusSent = ''; widgetSent = ''; translateStatic(); apply(); });

// ---- start ------------------------------------------------------------------------------------------
try {
  const info = await macos.system.getInfo();
  panel.classList.toggle('dark', info.theme === 'dark');
  setSky({ reduceMotion: Boolean(info.reduceMotion) });
} catch {}
translateStatic();
const saved = await macos.storage.get('settings').catch(() => null);
if (saved && typeof saved === 'object') Object.assign(settings, saved); else firstRun = true;
if (!SCENE_ORDER.includes(settings.scene)) settings.scene = DEFAULTS.scene;
weather = await macos.storage.get('weather').catch(() => null);
if (weather && weather.city !== cityKey()) weather = null;

await fitWindow();
await watchDesktop();

// First launch: guess the city from the time zone, and show the panel once.
if (!settings.city && settings.mode === 'live') {
  const guess = guessCityName();
  if (guess) {
    try { const [city] = await searchCities(guess); if (city) { settings.city = city; save(); } } catch {}
  }
}
apply();
// Snow left on the ground last time is still there — if it is still snowing.
const left = await macos.storage.get('pile').catch(() => null);
if (left?.lying && snowing()) restorePile(left.lying, (Date.now() - (left.at || Date.now())) / 3600000);
if (settings.pointer) setPointer(true);
refreshWeather();
if (firstRun) { save(); openPanel(); }

// What this application is, said once at every start until the user has heard enough: it
// exists to show what the system's interfaces can do, and it asks a lot of a slow machine.
if (!(await macos.storage.get('noticeDismissed').catch(() => true))) {
  macos.dialog.confirm(T('noticeBody', "Outside is a sample application that demonstrates this system’s application interfaces. It draws weather continuously in a window the size of the desktop, behind all other windows, which causes the entire desktop to be recomposited frequently. On devices with limited performance, the desktop may respond less smoothly while it is running."), {
    title: T('noticeTitle', "About Outside"), detail: T('noticeHint', "If performance is affected, turn on Low Power in the weather panel, or quit the application from its menu bar icon."),
    confirmLabel: T('noticeOk', 'OK'), cancelLabel: T('noticeNever', 'Don’t Show Again')
  }).then((ok) => { if (ok === false) macos.storage.set('noticeDismissed', true).catch(() => {}); }, () => {});
}
