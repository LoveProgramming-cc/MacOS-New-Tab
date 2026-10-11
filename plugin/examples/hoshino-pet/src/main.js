// Hoshino — a desktop pet. A frameless, transparent window that floats above the other
// windows and has no Dock icon; she is reached through her menu bar item (and her own
// right-click menu). Her place, size and habits are kept in storage.

const T = (key, fallback) => macos.i18n.t(key, fallback);

// Each of her (the user may allow several windows) remembers her own place.
const INSTANCE = Number(macos.context?.instance) || 1;
const PLACE = INSTANCE > 1 ? `position-${INSTANCE}` : 'position';
async function savePosition(frame) {
  if (frame) await macos.storage.set(PLACE, { x: frame.x, y: frame.y }).catch(() => {});
}
async function saveSettings() { await macos.storage.set('settings', { ...settings }).catch(() => {}); }

async function applySize() {
  const scale = SIZES[settings.size] || SIZES.medium;
  const before = pet.frame;
  const width = Math.round(CELL.width * scale); const height = Math.round(CELL.height * scale);
  await macos.window.resize(width, height);
  // Keep her feet where they were.
  if (before) pet.frame = await macos.window.moveTo(before.x + (before.width - width) / 2, before.y + before.height - height + Math.round(height * 0.06) - Math.round(before.height * 0.06));
  else pet.frame = await macos.window.getFrame();
}

// Where she goes when she has no place yet, or is called back: standing on the right end
// of the Dock, or in the bottom right corner when there is no Dock.
function homeOf(frame) {
  const dock = frame.screen.dock;
  if (dock) return { x: dock.x + dock.width - frame.width - 18 - (INSTANCE - 1) * frame.width * 0.8, y: dock.y + footInset(frame) - frame.height };
  return { x: frame.screen.width - frame.width - 40, y: frame.screen.height - frame.height - 20 };
}
async function comeBack() {
  const frame = await macos.window.getFrame();
  const home = homeOf(frame);
  pet.mode = 'walk';
  if (pet.carrier) { pet.carrier = ''; await macos.window.attach(null).catch(() => {}); }
  play(home.x >= frame.x ? 'running-right' : 'running-left');
  const result = await macos.window.moveTo(home.x, home.y, { duration: Math.min(1600, 300 + Math.hypot(home.x - frame.x, home.y - frame.y)), easing: 'ease' });
  pet.frame = result;
  if (pet.mode !== 'walk') return;
  savePosition(result);
  pet.mode = 'idle';
  await settle();
  act('jumping');
}

// ---- permissions she can do without, asked for when the user turns the habit on -------------
async function allowed(name) {
  const status = await macos.permissions.status().catch(() => ({}));
  return status[name] === 'granted' || Boolean(await macos.permissions.request([name]).catch(() => false));
}
async function setLooking(on) {
  if (on && !(await allowed('pointer'))) on = false;
  settings.look = on;
  await macos.window.trackPointer(on).catch(() => { settings.look = false; });
  saveSettings(); refreshMenus();
}
macos.on('pointerposition', ({ x, y }) => lookAt(x, y));

// The windows around her: what she stands on, falls to and rides along with.
async function watchDesktop() {
  try { desktop = await macos.desktop.watch(true); } catch { desktop = null; }
}
macos.on('desktopchange', (next) => {
  desktop = next;
  // Carried along by a window, her place changes without her doing.
  const own = next.windows.find((w) => w.own);
  if (own && pet.frame && pet.mode !== 'walk' && pet.mode !== 'fall' && pet.mode !== 'drag') pet.frame = { ...pet.frame, x: own.x, y: own.y, width: own.width, height: own.height, screen: next.screen };
  settleSoon();
});
// What she was standing on closed or was minimised.
macos.on('detached', ({ frame }) => { pet.carrier = ''; pet.perch = null; if (frame) pet.frame = frame; settleSoon(); });

macos.on('message', ({ from, message }) => {
  if (from !== WEATHER_APP || !message) return;
  weatherRuns = true;
  if (message.type === 'weather') weatherChanged(String(message.scene || 'clear'));
  if (message.type === 'hit') struck(String(message.kind || ''));
});
macos.on('peerchange', ({ id, running }) => { if (id !== WEATHER_APP) return; weatherRuns = running; if (running) hello(); else pet.weather = 'clear'; });
// Where her head is in her window, so the weather knows where to rain on her.
const hello = () => tell('hello', { head: { x: 0.27, y: 0.13, w: 0.46 } });

// ---- menus -------------------------------------------------------------------------------
let canMultiply = false;      // the user allowed several windows of her, and there is room for one more
function menuItems() {
  const gesture = { waving: T('wave', 'Say Hello'), jumping: T('jump', 'Jump'), running: T('think', 'Think It Over'), review: T('review', 'Take a Closer Look'), waiting: T('reach', 'Hold Out a Hand'), failed: T('droop', 'Sulk') };
  return [
    { label: T('actions', 'Do Something'), submenu: [
      ...GESTURES.map((name) => ({ id: `do:${name}`, label: gesture[name] })),
      { separator: true },
      { id: 'wander-now', label: T('wanderNow', 'Take a Walk') }
    ] },
    { label: T('onClick', 'When Clicked'), submenu: [
      ...GESTURES.map((name) => ({ id: `click:${name}`, label: gesture[name], checked: settings.click === name })),
      { separator: true },
      { id: 'click:random', label: T('random', 'Something Random'), checked: settings.click === 'random' }
    ] },
    { label: T('habits', 'Habits'), submenu: [
      { id: 'wander', label: T('wander', 'Wander Around'), checked: settings.wander },
      { id: 'look', label: T('lookAtPointer', 'Look at the Pointer When It Is Near'), checked: settings.look },
      { id: 'gravity', label: T('gravity', 'Fall When Nothing Is Underneath'), checked: settings.gravity },
      { id: 'ride', label: T('ride', 'Ride Along with Windows'), checked: settings.ride }
    ] },
    { label: T('size', 'Size'), submenu: ['small', 'medium', 'large'].map((size) => ({ id: `size:${size}`, label: T(`size${size[0].toUpperCase()}${size.slice(1)}`, size), checked: settings.size === size })) },
    { separator: true },
    { id: 'come-back', label: T('comeBack', 'Come Back') },
    ...(canMultiply ? [{ id: 'another', label: T('another', 'One More Hoshino') }] : []),
    { id: 'visibility', label: pet.visible ? T('hide', 'Hide') : T('show', 'Show') },
    { id: 'quit', label: T('quit', 'Quit') }
  ];
}
function refreshMenus() {
  macos.instances.canOpen().then((can) => { if (Boolean(can) !== canMultiply) { canMultiply = Boolean(can); refreshMenus(); } }, () => {});
  macos.statusItem.set({ icon: 'assets/status.svg', template: true, tooltip: T('tooltip', 'Hoshino'), items: menuItems() }).catch(() => {});
}
async function command(id) {
  if (id.startsWith('do:')) { if (!pet.visible) await macos.window.focus(); if (pet.mode === 'idle' || pet.mode === 'act') act(id.slice(3)); }
  else if (id === 'wander-now') { if (!pet.visible) await macos.window.focus(); if (pet.mode === 'idle' || pet.mode === 'act') { pet.mode = 'idle'; wander(); } }
  else if (id.startsWith('click:')) { settings.click = id.slice(6); saveSettings(); refreshMenus(); }
  else if (id === 'another') { await macos.instances.open().catch(() => false); setTimeout(refreshMenus, 1500); }
  else if (id === 'wander') { settings.wander = !settings.wander; saveSettings(); refreshMenus(); }
  else if (id === 'look') await setLooking(!settings.look);
  else if (id === 'gravity' || id === 'ride') {
    settings[id] = !settings[id];
    if (settings[id] && !desktop && (await allowed('windows'))) await watchDesktop();
    saveSettings(); refreshMenus();
    // Letting go of the window, or taking hold of it; and down she goes if she was in the air.
    pet.carrier = ''; await macos.window.attach(null).catch(() => {});
    settle();
  }
  else if (id.startsWith('size:')) { settings.size = id.slice(5); saveSettings(); refreshMenus(); await applySize(); savePosition(pet.frame); settle(); }
  else if (id === 'come-back') { if (!pet.visible) await macos.window.focus(); comeBack(); }
  else if (id === 'visibility') { if (pet.visible) await macos.window.minimize(); else await macos.window.focus(); }
  else if (id === 'quit') macos.window.close();
}
macos.on('statusitem', ({ id }) => { if (id) command(id); });
petEl.addEventListener('contextmenu', async (event) => {
  event.preventDefault();
  const choice = await macos.ui.showMenu(menuItems(), { x: event.clientX, y: event.clientY }).catch(() => null);
  if (choice) command(String(choice));
});

// The menus are in the system's language: rebuilt when it changes.
macos.on('languagechange', refreshMenus);

// ---- the desktop around her -------------------------------------------------------------
macos.on('visibilitychange', ({ visible }) => {
  pet.visible = visible;
  pauseSprite(!visible);
  refreshMenus();
});
// The browser window changed size. If that pushed her back onto the desktop she stumbles;
// either way she looks for her footing again.
macos.on('screenchange', ({ frame, moved }) => {
  if (pet.mode === 'drag') return;
  pet.frame = frame;
  savePosition(frame);
  if (moved && (pet.mode === 'idle' || pet.mode === 'act')) act('failed');
  settleSoon();
});

// ---- start --------------------------------------------------------------------------------
await loadShapes();
Object.assign(settings, (await macos.storage.get('settings').catch(() => null)) || {});
if (!SIZES[settings.size]) settings.size = 'medium';
await applySize();
const saved = await macos.storage.get(PLACE).catch(() => null);
const start = saved && Number.isFinite(saved.x) ? saved : homeOf(pet.frame);
pet.frame = await macos.window.moveTo(start.x, start.y);
refreshMenus();
if (settings.look) await setLooking(true);
await watchDesktop();
hello();
act('waving');
settle();
