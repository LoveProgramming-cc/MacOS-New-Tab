// What she does: rest, look at the pointer when it comes close, wander, stand on things, fall
// off them, and react to being picked up and put down.
// `mode` says who is in charge of the sprite right now:
//   idle — resting (and free to look around or start something)
//   act  — a one-off gesture (waving, thinking, …)
//   walk — walking somewhere
//   fall — on her way down to whatever is underneath
//   drag — being carried by the user

const SIZES = { small: 0.42, medium: 0.55, large: 0.75 };
const pet = { mode: 'idle', visible: true, frame: null, lookTimer: 0, nextIdea: 0, perch: null, carrier: '', weather: 'clear' };
const settings = { size: 'medium', wander: true, look: true, gravity: true, ride: true, click: 'waving' };
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.random() * (max - min);

function rest() {
  pet.mode = 'idle';
  play('idle', { hold: [700, 2600] });
  planNextIdea();
}
// The gestures on the sheet, and how often each plays when it is chosen:
//   waving · jumping · running (thinking it over) · review (leaning in for a closer look)
//   waiting (holding a hand out) · failed (drooping)
const GESTURE_LOOPS = { waving: 2, jumping: 1, running: 3, review: 2, waiting: 2, failed: 1 };
const GESTURES = Object.keys(GESTURE_LOOPS);
async function act(name, loops = GESTURE_LOOPS[name] || 1) {
  pet.mode = 'act';
  clearTimeout(pet.lookTimer);
  const finished = await play(name, { loops });
  if (finished && pet.mode === 'act') rest();
}

// ---- looking at the pointer (permission: pointer) ----------------------------------------
// Only when it comes close: across the desktop she minds her own business, and breathes.
const headOf = (frame) => ({ x: frame.width / 2, y: frame.height * 0.32 });
function lookAt(x, y) {
  if (pet.mode !== 'idle' || !pet.frame || !settings.look) return;
  const head = headOf(pet.frame);
  const dx = x - head.x; const dy = y - head.y;
  const distance = Math.hypot(dx, dy);
  // On her (she would squint), or further away than about two of her.
  if (distance < pet.frame.width * 0.55 || distance > Math.max(150, pet.frame.height * 1.9)) return;
  lookToward((Math.atan2(dx, -dy) * 180) / Math.PI);
  clearTimeout(pet.lookTimer);
  pet.lookTimer = setTimeout(() => { if (pet.mode === 'idle') play('idle', { hold: [700, 2600] }); }, 1100);
}

// ---- what she can stand on (permission: windows) -----------------------------------------
// The bottom of the screen, the top of the Dock, and the top and bottom edge of every window
// and of every widget on the desktop (macos.desktop). Her feet are a little above the bottom
// of her own window.
let desktop = null;
const footInset = (frame) => Math.round(frame.height * 0.06);
const feetOf = (frame) => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height - footInset(frame) });
const solidWindows = () => (desktop?.windows || []).filter((w) => !w.own && !w.frameless && w.level === 'normal');
// Behind a window in front of the one the edge belongs to: nothing to stand on there.
const covered = (x, y, z) => solidWindows().some((w) => w.z > z && x > w.x && x < w.x + w.width && y > w.y && y < w.y + w.height);
function ledges() {
  if (!desktop || !pet.frame) return [];
  const { screen, dock } = desktop;
  const inset = footInset(pet.frame);
  const ground = screen.height - 2 - inset;
  const list = [{ id: 'ground', edge: 'top', y: ground, x0: 0, x1: screen.width, z: Infinity }];
  if (dock) list.push({ id: 'dock', edge: 'top', y: dock.y, x0: dock.x + 6, x1: dock.x + dock.width - 6, z: Infinity });
  for (const w of solidWindows()) {
    const x0 = w.x + Math.min(w.radius, 12); const x1 = w.x + w.width - Math.min(w.radius, 12);
    for (const [edge, y] of [['top', w.y], ['bottom', w.y + w.height]]) {
      // She has to fit: below the menu bar, above the bottom of the screen.
      if (y + inset - pet.frame.height < screen.top || y > ground) continue;
      list.push({ id: w.id, edge, y, x0, x1, z: w.z });
    }
  }
  // Widgets lie under every window: an edge of one is free only where no window is over it.
  for (const w of desktop.widgets || []) {
    const x0 = w.x + Math.min(w.radius, 14); const x1 = w.x + w.width - Math.min(w.radius, 14);
    for (const [edge, y] of [['top', w.y], ['bottom', w.y + w.height]]) {
      if (y + inset - pet.frame.height < screen.top || y > ground) continue;
      list.push({ id: w.id, edge, y, x0, x1, z: -1, still: true });
    }
  }
  return list;
}
const holds = (ledge, feet) => feet.x >= ledge.x0 && feet.x <= ledge.x1 && !covered(feet.x, ledge.y - 2, ledge.z);
const sameLedge = (a, b) => Boolean(a && b) && a.id === b.id && a.edge === b.edge;
function supportAt(feet) {
  const under = ledges().filter((ledge) => Math.abs(ledge.y - feet.y) <= 5 && holds(ledge, feet));
  return under.find((ledge) => sameLedge(ledge, pet.perch)) || under[0] || null;
}
const ledgeBelow = (feet) => ledges().filter((ledge) => ledge.y > feet.y + 5 && holds(ledge, feet)).sort((a, b) => a.y - b.y)[0] || null;

// Standing on something: exactly on its line and, when she rides along, attached to it — the
// system then moves her with the window, in the same frame.
async function perchOn(ledge) {
  if (ledge) {
    const y = ledge.y + footInset(pet.frame) - pet.frame.height;
    if (Math.abs(y - pet.frame.y) >= 1) pet.frame = await macos.window.moveTo(pet.frame.x, y);
  }
  const carrier = ledge && settings.ride && ledge.id !== 'ground' && !ledge.still ? `${ledge.id}|${ledge.edge}` : '';
  if (carrier !== pet.carrier) {
    pet.carrier = carrier;
    await macos.window.attach(carrier ? ledge.id : null, { edge: ledge?.edge }).catch(() => { pet.carrier = ''; });
  }
  pet.perch = ledge;
}
// Nothing under her feet: down she goes, to the next edge underneath or the bottom of the screen.
let settling = false;
async function settle() {
  if (settling || !desktop || !pet.frame || pet.mode === 'drag' || pet.mode === 'walk') return;
  settling = true;
  let dropped = 0;
  try {
    for (let tries = 0; tries < 5; tries += 1) {
      const feet = feetOf(pet.frame);
      const on = supportAt(feet);
      if (on) { await perchOn(on); break; }
      if (!settings.gravity) { await perchOn(null); break; }
      const to = ledgeBelow(feet);
      if (!to) { await perchOn(null); break; }
      pet.mode = 'fall';
      clearTimeout(pet.lookTimer);
      pet.perch = null;
      if (pet.carrier) { pet.carrier = ''; await macos.window.attach(null).catch(() => {}); }
      lookToward(180);
      const drop = to.y - feet.y;
      dropped += drop;
      pet.frame = await macos.window.moveTo(pet.frame.x, to.y + footInset(pet.frame) - pet.frame.height, { duration: Math.max(90, Math.min(900, Math.sqrt(drop / 1500) * 1000)), easing: 'in' });
      if (pet.mode !== 'fall') return;   // caught on the way down
    }
  } finally { settling = false; }
  if (pet.mode !== 'fall') return;
  savePosition(pet.frame);
  const feet = feetOf(pet.frame);
  tell('land', { x: feet.x, y: feet.y });
  // A long way down hurts her pride; a hop is a hop.
  if (dropped > 260) act('failed'); else if (dropped > 40) act('jumping'); else rest();
}
// The desktop changed (a window moved, closed, came in front): is she still standing on something?
let settleTimer = 0;
function settleSoon() {
  if (settleTimer) return;
  settleTimer = setTimeout(() => { settleTimer = 0; settle(); }, 140);
}

// ---- the weather (the "Outside" application, when it runs too) ---------------------------
// The two applications name each other as peers. She tells it where her feet are — it kicks
// the snow up there — and it tells her what the weather is doing.
const WEATHER_APP = 'outside-weather';
let weatherRuns = false;
function tell(type, detail = {}) {
  if (!weatherRuns && type !== 'hello') return;
  macos.apps.send(WEATHER_APP, { type, ...detail }).then((there) => { weatherRuns = Boolean(there); }, () => { weatherRuns = false; });
}
const FALLING = new Set(['drizzle', 'rain', 'snow', 'blizzard', 'sakura', 'leaves']);
// Something from the sky came down on her head.
function struck(kind) {
  if (!pet.visible) return;
  // Snow that has piled up on her is shaken off, whatever she was doing (short of falling).
  if (kind === 'snowcap') { if (pet.mode === 'idle' || pet.mode === 'act') { act('jumping'); setTimeout(() => tell('shake'), 180); } return; }
  if (pet.mode !== 'idle') return;
  clearTimeout(pet.lookTimer);
  if (kind === 'rain') { lookToward(0); pet.lookTimer = setTimeout(() => { if (pet.mode === 'idle') act('waiting', 2); }, 900); }
  else if (kind === 'snow') { lookToward(Math.random() < 0.5 ? 337.5 : 22.5); pet.lookTimer = setTimeout(() => { if (pet.mode === 'idle') rest(); }, 1200); }
  else act('review', 1);                                       // a petal, a leaf: what was that?
}
function weatherChanged(scene) {
  const before = pet.weather;
  pet.weather = scene;
  if (scene === before || pet.mode !== 'idle' || !pet.visible) return;
  if (scene === 'storm') act('failed');                       // thunder
  else if (FALLING.has(scene)) act('waiting', 3);             // a hand out to catch it
  else if (scene === 'fireflies' || scene === 'meteors') act('review', 3);
  else if (FALLING.has(before) || before === 'storm') act('jumping');   // it stopped
}

// ---- wandering ---------------------------------------------------------------------------
// Along whatever she is standing on, and no further than its ends.
async function walkTo(target, speedScale = 1) {
  const frame = pet.frame;
  pet.mode = 'walk';
  const right = target > frame.x;
  play(right ? 'running-right' : 'running-left');
  const speed = 95 * (SIZES[settings.size] / SIZES.medium) * speedScale;
  const duration = (Math.abs(target - frame.x) / speed) * 1000;
  // Every step is reported, so the snow she walks through is scuffed aside.
  const started = performance.now();
  const steps = setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / Math.max(1, duration));
    tell('step', { x: frame.x + (target - frame.x) * t + frame.width / 2, y: frame.y + frame.height - footInset(frame), vx: (right ? 1 : -1) * speed });
  }, 130);
  const result = await macos.window.moveTo(target, frame.y, { duration }).finally(() => clearInterval(steps));
  pet.frame = result;
  return result;
}
// The nearest other edge whose end she would walk past on her way to `target`, if it is
// within a jump: { ledge, from: where to jump from, x: where to land }.
function stepOnTheWay(frame, target) {
  const feet = feetOf(frame); const half = frame.width / 2;
  const goal = target + half; const dir = Math.sign(goal - feet.x);
  let best = null;
  for (const ledge of ledges()) {
    if (sameLedge(ledge, pet.perch) || Math.abs(ledge.y - feet.y) <= 5 || ledge.x1 - ledge.x0 < frame.width * 0.6) continue;
    const rise = feet.y - ledge.y;
    if (rise > frame.height * 1.35 || rise < -frame.height * 1.6) continue;
    const end = dir > 0 ? ledge.x0 : ledge.x1;            // the end she comes to first
    const away = (end - feet.x) * dir;
    if (away <= 10 || (goal - end) * dir < 0) continue;   // behind her, or beyond where she is going
    const x = end + dir * half * 0.9;
    if (covered(x, ledge.y - 2, ledge.z)) continue;
    if (!best || away < best.away) best = { ledge, from: end - dir * 12, x, away };
  }
  return best;
}
async function walk() {
  const frame = await macos.window.getFrame();
  pet.frame = frame;
  const perch = pet.perch && ledges().find((ledge) => sameLedge(ledge, pet.perch));
  const half = frame.width / 2;
  const [minX, maxX] = perch
    ? [Math.max(0, perch.x0 - half + 8), Math.min(frame.screen.width - frame.width, perch.x1 - half - 8)]
    : [0, frame.screen.width - frame.width];
  const distance = between(90, 320) * (Math.random() < 0.5 ? -1 : 1);
  let target = Math.max(minX, Math.min(maxX, frame.x + distance));
  if (Math.abs(target - frame.x) < 40) target = Math.max(minX, Math.min(maxX, frame.x - distance));
  if (Math.abs(target - frame.x) < 40) { rest(); return; }
  // Something to climb on the way — the Dock, when she walks along the ground towards it, or
  // the edge of a window not much higher or lower: she walks up to it and jumps on. The Dock
  // she never walks past; a window she takes more often than not.
  const step = stepOnTheWay(frame, target);
  if (step && (step.ledge.id === 'dock' || Math.random() < 0.65)) {
    const near = await walkTo(step.from - half);
    if (pet.mode !== 'walk' || near.cancelled) return;
    await hop(step);
    return;
  }
  const result = await walkTo(target);
  if (pet.mode !== 'walk') return; // picked up on the way
  if (!result.cancelled) savePosition(result);
  rest();
  settle();
}

// A jump onto another edge within reach: from the ground onto the Dock, from the Dock onto the
// bottom of a window, down from a widget.
function reachable() {
  const frame = pet.frame; const feet = feetOf(frame); const half = frame.width / 2;
  const out = [];
  for (const ledge of ledges()) {
    if (sameLedge(ledge, pet.perch) || Math.abs(ledge.y - feet.y) <= 5 || ledge.x1 - ledge.x0 < frame.width * 0.6) continue;
    const rise = feet.y - ledge.y;
    if (rise > frame.height * 1.35 || rise < -260) continue;
    const x = Math.max(ledge.x0 + half * 0.5, Math.min(ledge.x1 - half * 0.5, feet.x + between(-40, 40)));
    if (Math.abs(x - feet.x) > 230 || Math.abs(x - feet.x) < 12 || covered(x, ledge.y - 2, ledge.z)) continue;
    out.push({ ledge, x });
  }
  return out;
}
async function hop({ ledge, x }) {
  const frame = pet.frame; const feet = feetOf(frame); const inset = footInset(frame);
  pet.mode = 'walk';
  clearTimeout(pet.lookTimer);
  if (pet.carrier) { pet.carrier = ''; await macos.window.attach(null).catch(() => {}); }
  pet.perch = null;
  tell('land', { x: feet.x, y: feet.y });   // she pushes off
  play('jumping', { loops: 1, fps: 12 });
  const apex = Math.min(feet.y, ledge.y) - frame.height * 0.45;
  const toX = x - frame.width / 2; const midX = frame.x + (toX - frame.x) * 0.55;
  let result = await macos.window.moveTo(midX, apex + inset - frame.height, { duration: 300, easing: 'out' });
  if (pet.mode === 'walk' && !result.cancelled) result = await macos.window.moveTo(toX, ledge.y + inset - frame.height, { duration: 150 + Math.min(260, Math.abs(ledge.y - apex) * 1.6), easing: 'in' });
  pet.frame = result;
  if (pet.mode !== 'walk') return;
  savePosition(result);
  const landed = feetOf(result);
  tell('land', { x: landed.x, y: landed.y });
  pet.mode = 'idle';
  await settle();
  if (pet.mode === 'idle') rest();
}
// "Wander about", by herself or asked to: a walk along where she stands, or a jump elsewhere.
function wander() {
  const jumps = reachable();
  if (jumps.length && Math.random() < 0.4) return hop(pick(jumps)).catch(rest);
  return walk().catch(rest);
}

// Every so often, when nothing is going on, she does something on her own.
function planNextIdea() {
  clearTimeout(pet.nextIdea);
  pet.nextIdea = setTimeout(haveIdea, between(8000, 20000));
}
function haveIdea() {
  if (pet.mode !== 'idle' || !pet.visible) { planNextIdea(); return; }
  const ideas = [
    ...(settings.wander ? ['walk', 'walk', 'walk'] : []),
    'running', 'running', 'review', 'review', 'waving', 'jumping',
    // Something is coming down: she keeps holding a hand out for it.
    ...(FALLING.has(pet.weather) ? ['waiting', 'waiting', 'waiting'] : ['waiting'])
  ];
  const idea = pick(ideas);
  if (idea === 'walk') wander();
  else act(idea);
}

// ---- being picked up ---------------------------------------------------------------------
const petEl = root.querySelector('#pet');
let clickTimer = 0;
petEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.screenX; const startY = event.screenY;
  let lastX = startX; let moved = false; let facing = '';
  let stillTimer = 0;
  // In her hand from the moment she is pressed: a walk, a jump or a fall that was under way
  // ends here and nothing new starts until she is let go.
  pet.mode = 'drag'; clearTimeout(pet.lookTimer);
  const moving = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    if (!moved && Math.hypot(moveEvent.screenX - startX, moveEvent.screenY - startY) < 4) return;
    if (!moved) { moved = true; petEl.classList.add('dragging'); }
    const dx = moveEvent.screenX - lastX; lastX = moveEvent.screenX;
    // Carried sideways she runs in the air; held still she waits to be put down.
    const want = dx > 1 ? 'running-right' : dx < -1 ? 'running-left' : facing;
    if (want && want !== facing) { facing = want; play(want); }
    clearTimeout(stillTimer);
    stillTimer = setTimeout(() => { if (pet.mode === 'drag') { facing = ''; play('waiting'); } }, 260);
  };
  window.addEventListener('pointermove', moving, true);
  macos.window.beginDrag(event).then(async (frame) => {
    frame ||= await macos.window.getFrame();
    window.removeEventListener('pointermove', moving, true);
    clearTimeout(stillTimer);
    petEl.classList.remove('dragging');
    pet.frame = frame;
    if (!moved) {
      // Only pressed: whatever the press interrupted is over, and she stands where she is.
      rest(); settle();
      clicked(); return;
    }
    savePosition(frame);
    pet.mode = 'idle';
    const feet = feetOf(frame);
    // Put down on something (or with nothing to fall to): a little hop. Otherwise she falls.
    if (!desktop || !settings.gravity || supportAt(feet) || !ledgeBelow(feet)) { await settle(); act(frame?.clamped ? 'failed' : 'jumping'); }
    else settle();
  }, () => { window.removeEventListener('pointermove', moving, true); petEl.classList.remove('dragging'); rest(); });
});
// A click does what the user chose for it (her menu: waving unless told otherwise, or a
// gesture picked at random); a double click jumps.
function clicked() {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = 0; act('jumping'); return; }
  clickTimer = setTimeout(() => {
    clickTimer = 0;
    if (pet.mode !== 'idle' && pet.mode !== 'act') return;
    act(settings.click === 'random' ? pick(GESTURES) : GESTURES.includes(settings.click) ? settings.click : 'waving');
  }, 260);
}
