// The sky: one canvas the size of the desktop. Particles are kept in plain arrays and drawn in
// batches (one path per kind) so a full storm stays cheap. Counts move towards their target a
// little every frame, so one weather turns into the next instead of switching.

const canvas = root.querySelector('#sky');
const ctx = canvas.getContext('2d');

const shade = root.querySelector('#shade');
const view = { w: 0, h: 0, dpr: 1 };
const sky = {
  scene: 'clear', intensity: 1, wind: 0, night: false,
  pile: true, flashes: true, tint: true, haze: true, reduceMotion: false, eco: false, slow: false,
  pointer: null,                                           // { x, y, vx, at } while tracking
  running: false
};

const SCENES = {
  clear:     { motes: 1, stars: 1, meteorsRare: true },
  cloudy:    { clouds: 1, tint: 0.03 },
  drizzle:   { rain: 0.35, clouds: 0.6, tint: 0.05, light: true },
  rain:      { rain: 1, clouds: 0.8, tint: 0.09 },
  storm:     { rain: 1.6, clouds: 1.1, tint: 0.17, lightning: true, gust: 0.35 },
  snow:      { snow: 1, clouds: 0.45, tint: 0.04 },
  blizzard:  { snow: 2.3, clouds: 0.9, tint: 0.11, gust: 0.75 },
  fog:       { fog: 1, tint: 0.02 },
  sakura:    { petals: 1, motes: 0.4 },
  leaves:    { leaves: 1 },
  fireflies: { fireflies: 1, stars: 0.6, night: true },
  meteors:   { meteors: 1, stars: 1.4, night: true }
};

// ---- how much the machine can take --------------------------------------------------------------
// The canvas covers the desktop, so every frame it draws is a frame the whole desktop is
// composited again, frosted glass and all. The sky therefore watches what its own frames cost
// and how often the browser misses one, and steps down when it is too much: fewer pixels
// first, then fewer particles and fewer frames. It steps up again, carefully, when there is
// room. "Low Power" in the panel keeps it on the lowest step.
const QUALITY = [
  { dpr: 1.5, count: 1, rate: 1 },
  { dpr: 1.25, count: 0.75, rate: 1 },
  { dpr: 1, count: 0.55, rate: 0.8 },
  { dpr: 1, count: 0.4, rate: 0.6 }
];
const governor = { level: 0, cost: 0, frames: 0, late: 0, since: 0, calm: 0, retryAt: 0, retryWait: 30 };
const quality = () => QUALITY[sky.eco ? QUALITY.length - 1 : governor.level];
function setLevel(level) {
  level = Math.max(0, Math.min(QUALITY.length - 1, level));
  if (level === governor.level) return;
  governor.level = level;
  if (view.w) setViewSize(view.w, view.h);
}
// One drawn frame: what it cost here, and whether the browser was late delivering it.
function measure(cost, late) {
  const g = governor;
  g.cost += cost; g.frames += 1; if (late) g.late += 1;
  if (clock - g.since < 3) return;
  const average = g.cost / g.frames; const lateShare = g.late / g.frames;
  g.cost = 0; g.frames = 0; g.late = 0; g.since = clock;
  if (average > 9 || lateShare > 0.3) {
    // Too much. If this is right after a step up, wait longer before trying that again.
    if (clock < g.retryAt + 12) g.retryWait = Math.min(600, g.retryWait * 2);
    g.calm = 0; setLevel(g.level + 1);
  } else if (average < 3.5 && lateShare < 0.06) {
    g.calm += 3;
    if (g.level > 0 && g.calm >= g.retryWait) { g.calm = 0; g.retryAt = clock; setLevel(g.level - 1); }
  } else g.calm = 0;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const params = () => SCENES[sky.scene] || SCENES.clear;
const isNight = () => sky.night || Boolean(params().night);
const areaScale = () => clamp((view.w * view.h) / (1440 * 900), 0.35, 3);
const motion = () => (sky.reduceMotion ? 0.6 : 1);
const windNow = (t) => sky.wind + (params().gust || 0) * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);

// ---- what things land on ---------------------------------------------------------------------
// The bottom of the screen, the top of the Dock and the top edge of every window: each is a
// surface with its own lying snow, one height per 4 px column counted from its left end.
// The moment a window moves, everything on it breaks off and falls — onto whatever is
// underneath, where it lies again. The Dock's snow stays where it lies on the screen while the
// Dock grows and shrinks, and what loses its footing falls the same way.
const COL = 4;
const MAX_DEPTH = { ground: 26, dock: 16, window: 12, pet: 5 };
const surfaces = new Map();      // id -> { id, kind, x, y, w, r, z, pile }
let surfaceList = [];            // highest on the screen first
let blockers = [];               // windows, for "is this point behind a window?"
let dockSpan = null;             // [left, right] of the Dock: nothing lies on the ground under it

const newSurface = (id, kind) => ({ id, kind, x: 0, y: 0, w: 0, r: 0, z: 0, pile: new Float32Array(0) });
const columnsFor = (w) => Math.max(1, Math.ceil(w / COL) + 1);
// The surface's own line under x: flat, and following the rounded corners down at the ends.
function lineAt(s, x) {
  if (!s.r) return s.y;
  const d = Math.min(x - s.x, s.x + s.w - x);
  if (d >= s.r) return s.y;
  const k = s.r - Math.max(0, d);
  return s.y + s.r - Math.sqrt(Math.max(0, s.r * s.r - k * k));
}
// Snow thins out towards the ends of a surface (and towards the Dock on the ground), so a
// drift never ends in a wall.
function taperAt(s, x) {
  let d = Math.min(x - s.x, s.x + s.w - x);
  let reach = Math.max(s.r, 10);
  if (s.kind === 'ground') {
    if (!dockSpan) return 1;
    if (x >= dockSpan[0] && x <= dockSpan[1]) return 0;
    d = x < dockSpan[0] ? dockSpan[0] - x : x - dockSpan[1]; reach = 22;
  }
  if (d >= reach) return 1;
  const t = Math.max(0, d / reach);
  return t * t * (3 - 2 * t);
}
const columnOf = (s, x) => clamp(Math.floor((x - s.x) / COL), 0, s.pile.length - 1);
const depthAt = (s, x) => (s.pile[columnOf(s, x)] || 0) * taperAt(s, x);
const topAt = (s, x) => lineAt(s, x) - depthAt(s, x);
// Behind a window in front of that surface? The sky is drawn behind every window.
function hidden(x, y, z) {
  for (const b of blockers) if (b.z > z && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  return false;
}
// What something falling from y0 to y1 at x comes down on, or null.
function landing(x, y0, y1) {
  for (const s of surfaceList) {
    if (x < s.x || x > s.x + s.w) continue;
    const top = topAt(s, x);
    if (y1 < top || y0 > top + 8) continue;
    if (hidden(x, top - 1, s.z)) continue;
    return { s, y: top };
  }
  return null;
}
function addSnow(s, x, amount) {
  if (clock < (s.quiet || 0)) return;          // it has only just moved: nothing settles yet
  const i = columnOf(s, x); const max = MAX_DEPTH[s.kind];
  for (let k = -2; k <= 2; k += 1) {
    const j = i + k;
    if (j < 0 || j >= s.pile.length) continue;
    s.pile[j] = Math.min(max, s.pile[j] + amount * (k === 0 ? 1 : k * k === 1 ? 0.55 : 0.2));
  }
}
// Snow that has lost its footing: clumps that fall, and lie again where they come down.
// `depth` is what lay in that column; a clump carries it as `mass` (what addSnow is given).
function shed(s, column, depth, push = 0) {
  if (depth < 0.5 || puffs.length > 900) return;
  const x = s.x + column * COL;
  puffs.push({ x: x + rnd(-2, 2), y: lineAt(s, x) - rnd(0, depth), vx: push + rnd(-40, 40), vy: rnd(-60, 20), age: 0, r: clamp(1 + depth * 0.22, 1.2, 3.4), mass: depth / 2.5, from: s.id });
}
function shedAll(s, push = 0) {
  for (let i = 0; i < s.pile.length; i += 1) { if (s.pile[i] > 0) { shed(s, i, s.pile[i] * taperAt(s, s.x + i * COL), push + rnd(-30, 30)); s.pile[i] = 0; } }
  // Petals and leaves lying there go with it.
  for (let i = resting.length - 1; i >= 0; i -= 1) if (resting[i].s === s) { toss(resting[i], push * 0.4 + rnd(-30, 30), rnd(-40, 10)); resting.splice(i, 1); }
}
// A petal or leaf back in the air: thrown, or dropped by what it lay on.
function toss(q, vx, vy) {
  if (tossed.length > 220) return;
  tossed.push({ ...q, vx, vy, age: 0, alpha: 1, from: q.s?.id, s: null });
}
// The surfaces as they are now: [{ id, kind, x, y, w, h, r, z }] in canvas coordinates.
function setSurfaces(list) {
  const seen = new Set();
  for (const next of list) {
    seen.add(next.id);
    let s = surfaces.get(next.id);
    if (!s) { s = newSurface(next.id, next.kind); surfaces.set(next.id, s); s.pile = new Float32Array(columnsFor(next.w)); }
    else if (s.kind === 'window' || s.kind === 'pet') {
      // It moved (or changed size): everything on it breaks off at once, and falls.
      if (next.x !== s.x || next.y !== s.y || next.w !== s.w) {
        shedAll(s, clamp((next.x - s.x) * -3, -160, 160));
        s.quiet = clock + 0.4;
        if (columnsFor(next.w) !== s.pile.length) s.pile = new Float32Array(columnsFor(next.w));
      }
    } else if (columnsFor(next.w) !== s.pile.length || next.x !== s.x) {
      // A different width (or the Dock moved): the snow stays where it is on the screen, and
      // what is no longer over the surface falls.
      const pile = new Float32Array(columnsFor(next.w));
      const shift = Math.round((next.x - s.x) / COL);
      for (let i = 0; i < s.pile.length; i += 1) {
        const j = i - shift;
        if (j >= 0 && j < pile.length) pile[j] = s.pile[i]; else shed(s, i, s.pile[i] * taperAt(s, s.x + i * COL));
      }
      s.pile = pile;
    }
    Object.assign(s, { x: next.x, y: next.y, w: next.w, r: next.r || 0, z: next.z || 0 });
  }
  for (const [id, s] of surfaces) {
    if (seen.has(id)) continue;
    shedAll(s);
    surfaces.delete(id);
  }
  // Nothing lies on the ground under the Dock: where the Dock grew, the ground is swept.
  const dock = surfaces.get('dock'); const ground = surfaces.get('ground');
  const span = dock ? [dock.x, dock.x + dock.w] : null;
  if (ground && span) {
    for (let i = Math.max(0, Math.floor(span[0] / COL)); i <= Math.min(ground.pile.length - 1, Math.ceil(span[1] / COL)); i += 1) {
      if (ground.pile[i] > 0) { shed(ground, i, dockSpan ? ground.pile[i] * taperAt(ground, i * COL) : 0); ground.pile[i] = 0; }
    }
  }
  dockSpan = span;
  surfaceList = [...surfaces.values()].sort((a, b) => a.y - b.y);
  if (!sky.running) draw();
}
function setBlockers(list) { blockers = list; }

// ---- particles -----------------------------------------------------------------------------
const drops = []; const flakes = []; const petals = []; const leaves = []; const flies = [];
const motes = []; const meteors = []; const splashes = []; const puffs = []; const resting = []; const tossed = [];
let stars = []; let clouds = []; let fogs = [];
let bolt = null; let flash = 0; let nextBolt = 3; let nextMeteor = 6;

function newDrop(top) {
  const z = rnd(0.45, 1);
  return { x: rnd(-view.w * 0.25, view.w * 1.25), y: top ? rnd(-view.h * 0.2, -10) : rnd(-view.h, view.h), z, len: rnd(12, 26) * z, speed: rnd(950, 1350) * z };
}
function newFlake(top) {
  const z = rnd(0.35, 1);
  return { x: rnd(-view.w * 0.2, view.w * 1.2), y: top ? rnd(-60, -6) : rnd(-20, view.h), z, r: rnd(1.3, 3.8) * z, speed: rnd(35, 85) * z, phase: rnd(0, 6.28), sway: rnd(12, 34) };
}
const PETAL_COLORS = ['#ffd1dc', '#ffc0cf', '#ffb3c6', '#fbd3e0', '#ffe4ec'];
const LEAF_COLORS = ['#e2722b', '#d9502f', '#e8a33d', '#b8572a', '#c9862f', '#9c3d23'];
function newPetal(top) {
  return { x: rnd(-view.w * 0.15, view.w * 1.1), y: top ? rnd(-50, -8) : rnd(-20, view.h), size: rnd(4, 7.5), speed: rnd(32, 62),
    rot: rnd(0, 6.28), vr: rnd(-2, 2), flip: rnd(0, 6.28), vf: rnd(2, 5), phase: rnd(0, 6.28), sway: rnd(20, 50), color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)], push: 0 };
}
function newLeaf(top) {
  return { x: rnd(-view.w * 0.15, view.w * 1.1), y: top ? rnd(-60, -10) : rnd(-20, view.h), size: rnd(8, 14), speed: rnd(45, 85),
    rot: rnd(0, 6.28), vr: rnd(-3, 3), flip: rnd(0, 6.28), vf: rnd(2.5, 6), phase: rnd(0, 6.28), sway: rnd(30, 70), color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)], push: 0 };
}
function newFly() {
  return { x: rnd(0, view.w), y: rnd(view.h * 0.35, view.h * 0.95), vx: rnd(-20, 20), vy: rnd(-10, 10), phase: rnd(0, 6.28), rate: rnd(0.6, 1.6), size: rnd(0.7, 1.25) };
}
function newMote() {
  return { x: rnd(0, view.w), y: rnd(0, view.h), vx: rnd(-6, 6), vy: rnd(-5, 3), phase: rnd(0, 6.28), r: rnd(0.8, 2) };
}
function makeStars() {
  const n = Math.round(130 * areaScale());
  stars = Array.from({ length: n }, () => ({ x: rnd(0, view.w), y: rnd(0, view.h * 0.6), r: rnd(0.4, 1.5), phase: rnd(0, 6.28), rate: rnd(0.6, 2.2) }));
}

// Pre-rendered soft sprites: a firefly glow and a cloud puff, drawn with drawImage.
function sprite(size, paint) {
  const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size); return c;
}
const glow = sprite(64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,210,1)'); r.addColorStop(0.18, 'rgba(230,255,140,0.85)'); r.addColorStop(0.45, 'rgba(190,255,90,0.22)'); r.addColorStop(1, 'rgba(160,255,80,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});
const puff = (rgb) => sprite(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, `rgba(${rgb},0.9)`); r.addColorStop(0.55, `rgba(${rgb},0.45)`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});
const puffSprite = puff('255,255,255');
const greyPuff = puff('92,100,116');
// A cloud is seven soft blobs. They are painted once into a small picture of the cloud (half
// size: it is all blur anyway), and that one picture is drawn each frame.
function cloudPicture(c, dark) {
  const pad = 140; const scale = 0.5;
  const picture = document.createElement('canvas');
  picture.width = Math.ceil((c.w + pad * 2) * scale); picture.height = Math.ceil(340 * scale);
  const g = picture.getContext('2d');
  g.scale(scale, scale);
  for (const [img, share] of [[puffSprite, 1 - dark], [greyPuff, dark]]) {
    if (share <= 0) continue;
    g.globalAlpha = share;
    for (const b of c.blobs) g.drawImage(img, c.w / 2 + pad + b.dx - b.r, 170 + b.dy - b.r, b.r * 2, b.r * 2);
  }
  c.picture = picture; c.dark = dark;
}
function makeCloud(x) {
  const w = rnd(260, 520);
  const blobs = Array.from({ length: 7 }, (_, i) => ({ dx: (i / 6 - 0.5) * w + rnd(-20, 20), dy: rnd(-26, 20) - Math.sin((i / 6) * Math.PI) * 26, r: rnd(70, 130) }));
  return { x: x ?? rnd(-w, view.w), y: rnd(-40, view.h * 0.16), w, blobs, speed: rnd(6, 16), alpha: 0, peak: rnd(0.55, 1) };
}
function makeFog() {
  return { x: rnd(-200, view.w + 200), y: rnd(view.h * 0.3, view.h * 1.05), r: rnd(220, 480), speed: rnd(-10, 10), alpha: 0, peak: rnd(0.5, 1) };
}

// ---- keeping the population near its target -----------------------------------------------
// Weather that is over does not finish falling: what the new scene has none of fades in a
// third of a second.
function quickFade(list, target, dt) {
  if (target > 0 || !list.length) { list.fade = 1; return; }
  list.fade = (list.fade ?? 1) - dt * 3.5;
  if (list.fade <= 0) { list.length = 0; list.fade = 1; }
}
function settle(list, target, make, perFrame) {
  // Too few: a few new ones each frame, from the top. Too many: the extra ones are not reborn.
  for (let i = 0; i < perFrame && list.length < target; i += 1) list.push(make(true));
  return list.length > target;
}

// ---- lightning -----------------------------------------------------------------------------
function makeBolt() {
  const x0 = rnd(view.w * 0.1, view.w * 0.9);
  const y1 = rnd(view.h * 0.45, view.h * 0.85);
  const path = [[x0, -10]];
  const branches = [];
  let x = x0; let y = -10;
  while (y < y1) {
    y += rnd(14, 34); x += rnd(-26, 26);
    path.push([x, Math.min(y, y1)]);
    if (Math.random() < 0.12) {
      const b = [[x, y]]; let bx = x; let by = y; const dir = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 5; k += 1) { bx += dir * rnd(8, 26); by += rnd(10, 26); b.push([bx, by]); }
      branches.push(b);
    }
  }
  return { path, branches, life: 0.32 };
}

// ---- one frame -----------------------------------------------------------------------------
// The canvas covers the desktop, so every frame it draws is a frame the whole desktop is
// composited again, frosted glass and all. It therefore draws no more often than the scene
// needs: fast weather 30 times a second, drifting clouds, fog and dust 15 times.
// No more frames than what is on screen needs: rain and lightning 30 a second, snow, petals
// and leaves 24, drifting clouds, fog, stars and dust 12 — less on a lower quality step, and
// half of it while a window is being dragged (the desktop is busy enough then).
function frameRate() {
  const fast = drops.length || splashes.length || meteors.length || bolt || flash > 0;
  const steady = flakes.length || petals.length || leaves.length || puffs.length || tossed.length || flies.length;
  return (fast ? 30 : steady ? 24 : 12) * quality().rate * (sky.slow ? 0.5 : 1);
}
let last = 0; let clock = 0; let frameId = 0; let lastCall = 0;
function step(now) {
  frameId = 0;
  if (!sky.running) return;
  frameId = requestAnimationFrame(step);
  // The browser calls every 16.7 ms when it keeps up; more than two of those is a missed frame.
  const late = lastCall > 0 && now - lastCall > 36 && now - lastCall < 400;
  lastCall = now;
  if (last && now - last < 1000 / frameRate() - 2) { if (late && !sky.slow) governor.late += 1; return; }
  const dt = Math.min(0.08, last ? (now - last) / 1000 : 0.016) * motion();
  last = now; clock += dt;
  const started = performance.now();
  update(dt);
  draw();
  measure(performance.now() - started, late && !sky.slow);
}

function update(dt) {
  const p = params();
  const k = sky.intensity * areaScale() * quality().count;
  const wind = windNow(clock);
  const ptr = sky.pointer && performance.now() - sky.pointer.at < 1500 ? sky.pointer : null;

  // Rain ---------------------------------------------------------------------------------
  const dropTarget = Math.round(430 * (p.rain || 0) * k);
  const dropsExtra = settle(drops, dropTarget, newDrop, 14);
  quickFade(drops, dropTarget, dt);
  for (let i = drops.length - 1; i >= 0; i -= 1) {
    const d = drops[i];
    d.vx = wind * d.speed * 0.32;
    d.x += d.vx * dt; d.y += d.speed * dt;
    let hit = false;
    if (ptr && d.y < ptr.y && d.y > ptr.y - 90) {
      const dx = d.x - ptr.x; const dy = d.y - ptr.y;
      if (dx * dx + dy * dy < 72 * 72) { hit = true; if (Math.random() < 0.6) splash(d.x, d.y, d.z * 0.8); }
    }
    const y0 = d.y - d.speed * dt;
    const on = hit ? null : landing(d.x, y0, d.y);
    if (on) { hit = true; if (d.x > 0 && d.x < view.w && Math.random() < 0.55) splash(d.x, on.y, d.z); if (on.s.kind === 'pet') petHit('rain'); }
    if (hit || d.y > view.h + 40) {
      if (dropsExtra && drops.length > dropTarget) { drops.splice(i, 1); continue; }
      Object.assign(d, newDrop(true));
    }
  }

  // Snow ---------------------------------------------------------------------------------
  const flakeTarget = Math.round(330 * (p.snow || 0) * k);
  const flakesExtra = settle(flakes, flakeTarget, newFlake, 6);
  quickFade(flakes, flakeTarget, dt);
  for (let i = flakes.length - 1; i >= 0; i -= 1) {
    const f = flakes[i];
    f.phase += dt * 1.3;
    f.x += (wind * 120 * f.z + Math.cos(f.phase) * f.sway * 0.6) * dt;
    f.y += f.speed * dt;
    let gone = false;
    if (ptr) {
      const dx = f.x - ptr.x; const dy = f.y - ptr.y;
      if (dy < 0 && dx * dx + dy * dy < 70 * 70) { const d = Math.hypot(dx, dy) || 1; f.x += (dx / d) * 90 * dt; f.y -= f.speed * dt * 0.9; }
    }
    // A flake adds a little: a drift takes minutes to build, not seconds.
    const on = landing(f.x, f.y - f.speed * dt - 1, f.y);
    if (on) {
      if (sky.pile && f.x > 0 && f.x < view.w) addSnow(on.s, f.x, 0.42 * f.z * (0.6 + 0.4 * Math.min(2, sky.intensity)));
      // On the pet's head it lies only so deep before she is told to shake it off.
      if (on.s.kind === 'pet') petHit(on.s.pile[on.s.pile.length >> 1] > MAX_DEPTH.pet * 0.7 ? 'snowcap' : 'snow');
      gone = true;
    }
    if (gone || f.y > view.h + 20 || f.x < -view.w * 0.3 || f.x > view.w * 1.3) {
      if (flakesExtra && flakes.length > flakeTarget) { flakes.splice(i, 1); continue; }
      Object.assign(f, newFlake(true));
    }
  }

  // Lying snow belongs to snowy weather: when the weather changes it is gone in a few seconds.
  // The pointer sweeps it.
  if (!p.snow || !sky.pile) for (const s of surfaceList) for (let i = 0; i < s.pile.length; i += 1) if (s.pile[i] > 0) s.pile[i] = Math.max(0, s.pile[i] - (5 + s.pile[i] * 1.6) * dt);
  if (ptr) sweep(ptr.x, ptr.y, ptr.vx, 34, Math.min(1, 7 * dt));
  if (Math.random() < 0.2) smoothPile();

  // Petals and leaves ---------------------------------------------------------------------
  tumble(petals, Math.round(70 * (p.petals || 0) * k), newPetal, dt, wind, ptr, 1);
  tumble(leaves, Math.round(42 * (p.leaves || 0) * k), newLeaf, dt, wind, ptr, 1.3);
  for (let i = resting.length - 1; i >= 0; i -= 1) { resting[i].life -= dt; if (resting[i].life <= 0 || !surfaces.has(resting[i].s.id)) resting.splice(i, 1); }

  // Fireflies ------------------------------------------------------------------------------
  const flyTarget = Math.round(42 * (p.fireflies || 0) * k);
  while (flies.length < flyTarget) flies.push(newFly());
  if (flies.length > flyTarget) flies.length = flyTarget;
  for (const f of flies) {
    f.phase += dt * f.rate;
    f.vx += rnd(-40, 40) * dt; f.vy += rnd(-30, 30) * dt;
    if (ptr) { const dx = ptr.x - f.x; const dy = ptr.y - f.y; const d = Math.hypot(dx, dy); if (d < 320 && d > 30) { f.vx += (dx / d) * 26 * dt; f.vy += (dy / d) * 26 * dt; } }
    f.vx = clamp(f.vx * (1 - 0.4 * dt), -38, 38); f.vy = clamp(f.vy * (1 - 0.4 * dt), -26, 26);
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.x < -20) f.x = view.w + 20; if (f.x > view.w + 20) f.x = -20;
    if (f.y < view.h * 0.25) f.vy += 12 * dt; if (f.y > view.h - 60) f.vy -= 30 * dt;
  }

  // Sunlit dust ------------------------------------------------------------------------------
  const moteTarget = isNight() ? 0 : Math.round(46 * (p.motes || 0) * Math.min(1.4, k));
  while (motes.length < moteTarget) motes.push(newMote());
  if (motes.length > moteTarget) motes.length = moteTarget;
  for (const m of motes) {
    m.phase += dt * 0.8; m.x += (m.vx + wind * 14) * dt; m.y += (m.vy + Math.sin(m.phase) * 4) * dt;
    if (m.x < -10) m.x = view.w + 10; if (m.x > view.w + 10) m.x = -10; if (m.y < -10) m.y = view.h; if (m.y > view.h + 10) m.y = 0;
  }

  // Shooting stars ----------------------------------------------------------------------------
  const wantsMeteors = p.meteors ? 1 : p.meteorsRare && isNight() ? 0.04 : 0;
  nextMeteor -= dt;
  if (wantsMeteors && nextMeteor <= 0) {
    const fromLeft = Math.random() < 0.5; const speed = rnd(700, 1100);
    const angle = rnd(0.35, 0.6);
    meteors.push({ x: fromLeft ? rnd(-50, view.w * 0.6) : rnd(view.w * 0.4, view.w + 50), y: rnd(-30, view.h * 0.25),
      vx: (fromLeft ? 1 : -1) * Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rnd(0.6, 1.1), age: 0, len: rnd(90, 190) });
    nextMeteor = p.meteors ? rnd(0.35, 1.6) / Math.max(0.3, sky.intensity) : rnd(18, 45);
  }
  for (let i = meteors.length - 1; i >= 0; i -= 1) { const m = meteors[i]; m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt; if (m.age > m.life) meteors.splice(i, 1); }

  // Clouds and fog ----------------------------------------------------------------------------
  // "No fog or clouds" in the panel: the weather falls from a clear sky.
  const cloudTarget = !sky.haze ? 0 : Math.round(7 * (p.clouds || 0) * Math.min(1.6, sky.intensity) * Math.sqrt(areaScale()));
  const fogTarget = !sky.haze ? 0 : Math.round(10 * (p.fog || 0) * Math.sqrt(areaScale()));
  while (clouds.length < cloudTarget) clouds.push(makeCloud());
  // Clouds and fog that are no longer wanted fade where they are.
  for (let i = cloudTarget; i < clouds.length; i += 1) clouds[i].alpha -= dt * 0.35;
  for (let i = fogTarget; i < fogs.length; i += 1) fogs[i].alpha -= dt * 0.35;
  for (let i = 0; i < Math.min(cloudTarget, clouds.length); i += 1) clouds[i].alpha = Math.min(clouds[i].peak, clouds[i].alpha + dt * 0.3);
  for (let i = 0; i < Math.min(fogTarget, fogs.length); i += 1) fogs[i].alpha = Math.min(fogs[i].peak, fogs[i].alpha + dt * 0.3);
  if (!cloudTarget) for (const c of clouds) c.alpha -= dt * 1.4;
  if (!fogTarget) for (const f of fogs) f.alpha -= dt * 1.4;
  for (const list of [clouds, fogs]) for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].alpha <= 0 && i >= (list === clouds ? cloudTarget : fogTarget)) list.splice(i, 1);
  for (let i = clouds.length - 1; i >= 0; i -= 1) {
    const c = clouds[i]; c.x += (c.speed + wind * 30) * dt;
    const out = c.x - c.w > view.w + 300 || c.x + c.w < -300;
    if (out) { if (i >= cloudTarget) clouds.splice(i, 1); else Object.assign(c, makeCloud(wind >= 0 ? -c.w - 200 : view.w + c.w + 200)); }
  }
  while (fogs.length < fogTarget) fogs.push(makeFog());
  for (const f of fogs) { f.x += (f.speed + wind * 18) * dt; if (f.x < -f.r * 1.5) f.x = view.w + f.r; if (f.x > view.w + f.r * 1.5) f.x = -f.r; }

  // Lightning ----------------------------------------------------------------------------------
  if (p.lightning) {
    nextBolt -= dt;
    if (nextBolt <= 0) {
      if (!sky.reduceMotion) bolt = makeBolt();
      if (sky.flashes && !sky.reduceMotion) flash = 1;
      nextBolt = rnd(4, 13) / Math.max(0.5, sky.intensity);
    }
  }
  if (bolt) { bolt.life -= dt; if (bolt.life <= 0) bolt = null; }
  flash = Math.max(0, flash - dt * 3.2);

  // Splashes -------------------------------------------------------------------------------------
  for (let i = splashes.length - 1; i >= 0; i -= 1) {
    const sp = splashes[i]; sp.life -= dt; sp.vy += 900 * dt; sp.x += sp.vx * dt; sp.y += sp.vy * dt;
    if (sp.life <= 0) splashes.splice(i, 1);
  }
  // Clumps of snow in the air: they fall, and lie again where they come down (not on what
  // they have only just left).
  for (let i = puffs.length - 1; i >= 0; i -= 1) {
    const c = puffs[i]; const y0 = c.y;
    c.age += dt; c.vy += 520 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 1 - 1.2 * dt;
    const on = c.vy > 0 ? landing(c.x, y0, c.y) : null;
    if (on && !(on.s.id === c.from && c.age < 0.7)) { if (c.mass && p.snow && sky.pile) addSnow(on.s, c.x, c.mass); puffs.splice(i, 1); continue; }
    if (c.y > view.h + 20 || c.age > 8) puffs.splice(i, 1);
  }
  // Petals and leaves thrown back into the air: they flutter down and lie again.
  for (let i = tossed.length - 1; i >= 0; i -= 1) {
    const q = tossed[i]; const y0 = q.y;
    q.age += dt; q.vy = Math.min(120, q.vy + 220 * dt); q.vx *= 1 - 1.5 * dt;
    q.x += (q.vx + Math.cos(q.phase + q.age * 3) * 18) * dt; q.y += q.vy * dt; q.rot += q.vr * dt; q.flip += q.vf * dt;
    if (!wanted(q)) q.alpha -= dt * 3.5;
    const on = q.vy > 0 ? landing(q.x, y0 - 1, q.y + 1) : null;
    if (on && on.s.kind !== 'pet' && !(on.s.id === q.from && q.age < 0.7)) {
      if (resting.length < 180 && q.alpha > 0.5) resting.push({ ...q, s: on.s, ox: q.x - on.s.x, up: rnd(1, 3), life: rnd(2.5, 5) });
      tossed.splice(i, 1); continue;
    }
    if (q.alpha <= 0 || q.y > view.h + 30 || q.age > 10) tossed.splice(i, 1);
  }
}
// Is this petal or leaf still part of the weather?
const wanted = (q) => Boolean(q.leaf ? params().leaves : params().petals);

function splash(x, y, z) {
  if (splashes.length > 260) return;
  const n = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i += 1) splashes.push({ x, y: y - 1, vx: rnd(-70, 70) * z, vy: rnd(-170, -70) * z, life: rnd(0.12, 0.28), r: rnd(0.6, 1.3) });
}

// Something passes through the snow at (x, y): the pointer, a pet's feet. `share` of what lies
// within `reach` flies off, in the direction it was moving.
function sweep(x, y, vx, reach, share) {
  for (const s of surfaceList) {
    if (x < s.x - reach || x > s.x + s.w + reach) continue;
    const line = lineAt(s, clamp(x, s.x, s.x + s.w));
    if (y < line - depthAt(s, x) - 26 || y > line + 18) continue;
    const dir = vx > 30 ? 1 : vx < -30 ? -1 : (Math.random() < 0.5 ? -1 : 1);
    for (let i = Math.max(0, Math.floor((x - reach - s.x) / COL)); i <= Math.min(s.pile.length - 1, Math.floor((x + reach - s.x) / COL)); i += 1) {
      const taken = s.pile[i] * share;
      if (taken < 0.05) continue;
      s.pile[i] -= taken;
      if (puffs.length < 900 && taken > 0.25) {
        const px = s.x + i * COL;
        // Swept snow is swept away: it flies off and does not lie again where it comes down
        // (unlike snow that slid off a window, which does).
        puffs.push({ x: px, y: topAt(s, px), vx: dir * rnd(60, 220) + rnd(-40, 40), vy: rnd(-230, -90), age: 0, r: clamp(1 + taken * 0.3, 1, 2.8), mass: 0, from: '' });
      }
    }
    // Petals and leaves lying there fly up too.
    for (let i = resting.length - 1; i >= 0; i -= 1) {
      const q = resting[i];
      if (q.s !== s || Math.abs(s.x + q.ox - x) > reach) continue;
      toss(q, dir * rnd(50, 170) + rnd(-30, 30), rnd(-190, -80)); resting.splice(i, 1);
    }
  }
}

function smoothPile() {
  for (const s of surfaceList) {
    const pile = s.pile;
    for (let i = 1; i < pile.length - 1; i += 1) {
      const avg = (pile[i - 1] + pile[i] * 2 + pile[i + 1]) / 4;
      pile[i] += (avg - pile[i]) * 0.5;
    }
  }
}

function tumble(list, target, make, dt, wind, ptr, weight) {
  const extra = settle(list, target, make, 2);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const q = list[i];
    // No longer wanted: fade where it is.
    if (i >= target) { q.alpha = (q.alpha ?? 1) - dt * (target ? 0.9 : 3.5); if (q.alpha <= 0) { list.splice(i, 1); continue; } }
    q.phase += dt * 1.1; q.rot += q.vr * dt; q.flip += q.vf * dt;
    let gust = 0;
    if (ptr) {
      const dx = q.x - ptr.x; const dy = q.y - ptr.y;
      if (dx * dx + dy * dy < 90 * 90) gust = (ptr.vx || 0) * 0.9 + Math.sign(dx || 1) * 60;
    }
    q.push = q.push * (1 - 2.2 * dt) + gust * dt * 4;
    q.x += (wind * 90 + Math.cos(q.phase) * q.sway + q.push) * dt;
    q.y += q.speed * weight * dt * (0.7 + 0.3 * Math.abs(Math.sin(q.flip)));
    const on = q.x > 0 && q.x < view.w ? landing(q.x, q.y - 90 * dt - 2, q.y + 2) : null;
    if (on) {
      const leaf = list === leaves;
      // On the pet it does not stay: it slides off her hair. Anywhere else it lies a few seconds.
      if (on.s.kind === 'pet') { petHit(leaf ? 'leaf' : 'petal'); toss({ ...q, leaf, s: on.s }, rnd(-50, 50), rnd(-30, 0)); }
      else if (resting.length < 180) resting.push({ ...q, s: on.s, ox: q.x - on.s.x, up: rnd(1, 3), life: rnd(3, 6), leaf });
      if (extra && list.length > target) { list.splice(i, 1); continue; }
      Object.assign(q, make(true));
    } else if (q.y > view.h + 30 || q.x < -view.w * 0.3 || q.x > view.w * 1.3) {
      if (extra && list.length > target) { list.splice(i, 1); continue; }
      Object.assign(q, make(true));
    }
  }
}

// ---- drawing ---------------------------------------------------------------------------------
function draw() {
  const p = params();
  const night = isNight();
  ctx.clearRect(0, 0, view.w, view.h);

  // Stars at night.
  const starLevel = (p.stars || 0) * (night ? 1 : 0);
  if (starLevel) {
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = clamp((0.35 + 0.65 * Math.abs(Math.sin(clock * s.rate + s.phase))) * starLevel * (1 - s.y / (view.h * 0.75)), 0, 1);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Meteors.
  for (const m of meteors) {
    const a = clamp(1 - m.age / m.life, 0, 1);
    const sp = Math.hypot(m.vx, m.vy);
    const tx = m.x - (m.vx / sp) * m.len; const ty = m.y - (m.vy / sp) * m.len;
    const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(180,210,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
  }

  // Clouds.
  if (clouds.length) {
    const dark = sky.scene === 'storm' ? 0.85 : sky.scene === 'rain' || sky.scene === 'blizzard' ? 0.55 : night ? 0.6 : 0;
    for (const c of clouds) {
      if (c.alpha <= 0) continue;
      if (!c.picture || c.dark !== dark) cloudPicture(c, dark);
      ctx.globalAlpha = Math.min(1, 0.34 * c.alpha * Math.min(1.2, 0.5 + sky.intensity * 0.5) * 1.6);
      ctx.drawImage(c.picture, c.x - c.w / 2 - 140, c.y - 170, c.w + 280, 340);
    }
    ctx.globalAlpha = 1;
  }

  // Fog.
  if (fogs.length) {
    for (const f of fogs) { ctx.globalAlpha = 0.36 * f.alpha * Math.min(1.5, sky.intensity); ctx.drawImage(puffSprite, f.x - f.r, f.y - f.r * 0.6, f.r * 2, f.r * 1.2); }
    ctx.globalAlpha = 1;
  }

  // Sunlit dust.
  if (motes.length) {
    ctx.fillStyle = 'rgba(255,246,214,1)';
    for (const m of motes) { ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(m.phase)); ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // Rain: two depth layers, each one path.
  if (drops.length) {
    ctx.lineCap = 'round';
    const color = night ? '200,214,236' : '150,172,206';
    for (const [lo, hi, alpha, width] of [[0, 0.72, 0.42, 1], [0.72, 2, 0.7, 1.4]]) {
      ctx.strokeStyle = `rgba(${color},${alpha * (drops.fade ?? 1)})`; ctx.lineWidth = width; ctx.beginPath();
      for (const d of drops) {
        if (d.z < lo || d.z >= hi) continue;
        const f = d.len / d.speed;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.vx * f, d.y - d.speed * f);
      }
      ctx.stroke();
    }
  }
  if (splashes.length) {
    ctx.fillStyle = night ? 'rgba(210,222,240,0.7)' : 'rgba(190,206,228,0.75)';
    ctx.beginPath(); for (const s of splashes) { ctx.moveTo(s.x + s.r, s.y); ctx.arc(s.x, s.y, s.r, 0, 6.283); } ctx.fill();
  }

  // Snow.
  if (flakes.length) {
    for (const [lo, hi, alpha] of [[0, 0.65, 0.6], [0.65, 2, 0.92]]) {
      ctx.fillStyle = `rgba(255,255,255,${alpha * (flakes.fade ?? 1)})`; ctx.beginPath();
      for (const f of flakes) {
        if (f.z < lo || f.z >= hi) continue;
        // A small flake is a square nobody can tell from a circle, at a fraction of the cost.
        if (f.r < 1.7) ctx.rect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
        else { ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, 6.283); }
      }
      ctx.fill();
    }
  }
  drawPile();
  if (puffs.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); for (const s of puffs) { ctx.moveTo(s.x + s.r, s.y); ctx.arc(s.x, s.y, s.r, 0, 6.283); } ctx.fill();
  }

  // Petals and leaves, falling and lying.
  for (const q of resting) {
    q.x = q.s.x + q.ox; q.y = topAt(q.s, q.x) - q.up;
    if (hidden(q.x, q.y, q.s.z)) continue;
    ctx.globalAlpha = clamp(q.life / 0.8, 0, 1); q.leaf ? drawLeaf(q, 0.25) : drawPetal(q, 0.3);
  }
  ctx.globalAlpha = 1;
  for (const q of tossed) { ctx.globalAlpha = clamp(q.alpha, 0, 1); q.leaf ? drawLeaf(q) : drawPetal(q); }
  for (const q of petals) { ctx.globalAlpha = q.alpha ?? 1; drawPetal(q); }
  for (const q of leaves) { ctx.globalAlpha = q.alpha ?? 1; drawLeaf(q); }
  ctx.globalAlpha = 1;

  // Fireflies.
  if (flies.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) {
      const a = Math.max(0, Math.sin(f.phase * 2.2)) ** 2;
      if (a < 0.02) continue;
      const s = 58 * f.size; ctx.globalAlpha = a; ctx.drawImage(glow, f.x - s / 2, f.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // Lightning.
  if (bolt) {
    const a = clamp(bolt.life / 0.32, 0, 1);
    ctx.save();
    ctx.strokeStyle = `rgba(235,240,255,${a})`; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(170,190,255,0.9)'; ctx.shadowBlur = 18;
    for (const [line, width] of [[bolt.path, 2.4], ...bolt.branches.map((b) => [b, 1.1])]) {
      ctx.lineWidth = width; ctx.beginPath(); line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.restore();
  }
  if (flash > 0) {
    const a = flash > 0.7 ? 0.24 : flash > 0.45 ? 0.04 : flash > 0.3 ? 0.16 : flash * 0.3;
    ctx.fillStyle = `rgba(225,232,255,${a})`; ctx.fillRect(0, 0, view.w, view.h);
  }
}

// Each drift is drawn on its own: from where the snow starts to where it ends, lying on the
// surface's line (round at the corners) — and nothing at all where there is no snow.
function drawPile() {
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = 'rgba(200,214,235,0.9)'; ctx.lineWidth = 1; ctx.lineJoin = 'round';
  for (const s of surfaceList) {
    const n = s.pile.length;
    let i = 0;
    while (i < n) {
      if (s.pile[i] * taperAt(s, s.x + i * COL) < 0.5) { i += 1; continue; }
      let j = i; while (j + 1 < n && s.pile[j + 1] * taperAt(s, s.x + (j + 1) * COL) >= 0.5) j += 1;
      // One column further each way, where the depth is next to nothing: the drift ends thin.
      const a = Math.max(0, i - 1); const b = Math.min(n - 1, j + 1);
      const xs = (c) => Math.min(s.x + s.w, s.x + c * COL);
      ctx.beginPath();
      ctx.moveTo(xs(a), lineAt(s, xs(a)));
      for (let c = a + 1; c < b; c += 1) ctx.lineTo(xs(c), topAt(s, xs(c)));
      ctx.lineTo(xs(b), lineAt(s, xs(b)));
      const outline = new Path2D(); outline.moveTo(xs(a), lineAt(s, xs(a)));
      for (let c = a + 1; c < b; c += 1) outline.lineTo(xs(c), topAt(s, xs(c)));
      outline.lineTo(xs(b), lineAt(s, xs(b)));
      for (let c = b - 1; c > a; c -= 1) ctx.lineTo(xs(c), lineAt(s, xs(c)) + 0.5);
      ctx.closePath(); ctx.fill(); ctx.stroke(outline);
      i = j + 1;
    }
  }
}

function drawPetal(q, lying) {
  const squash = lying ?? Math.max(0.15, Math.abs(Math.cos(q.flip)));
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(1, squash);
  ctx.fillStyle = q.color; ctx.beginPath();
  ctx.moveTo(0, -q.size); ctx.bezierCurveTo(q.size * 0.9, -q.size * 0.6, q.size * 0.7, q.size * 0.8, 0, q.size);
  ctx.bezierCurveTo(-q.size * 0.7, q.size * 0.8, -q.size * 0.9, -q.size * 0.6, 0, -q.size); ctx.fill();
  ctx.restore();
}
function drawLeaf(q, lying) {
  const squash = lying ?? Math.max(0.2, Math.abs(Math.cos(q.flip)));
  const s = q.size;
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(squash, 1);
  ctx.fillStyle = q.color; ctx.beginPath();
  ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.85, -s * 0.2, 0, s); ctx.quadraticCurveTo(-s * 0.85, -s * 0.2, 0, -s); ctx.fill();
  ctx.strokeStyle = 'rgba(80,35,10,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 1.15); ctx.stroke();
  ctx.restore();
}

// ---- outside control -------------------------------------------------------------------------
function setViewSize(w, h) {
  // Soft, moving things: 1.5 device pixels per point is as sharp as they can look, at a little
  // over half the pixels of 2 — and fewer still on a lower quality step.
  const dpr = Math.min(quality().dpr, window.devicePixelRatio || 1);
  const changed = w !== view.w || h !== view.h;
  view.w = w; view.h = h; view.dpr = dpr;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (changed || !stars.length) makeStars();
  if (!sky.running) draw();
}
function setSky(next) {
  const changed = next.scene !== undefined && next.scene !== sky.scene;
  Object.assign(sky, next);
  // Another weather: what lies about from the old one does not outstay it.
  if (changed) for (const q of resting) if (!wanted(q)) q.life = Math.min(q.life, 0.4);
  if (next.eco !== undefined && view.w && Math.min(quality().dpr, window.devicePixelRatio || 1) !== view.dpr) setViewSize(view.w, view.h);
  paintShade();
}
// What never moves is not drawn on the canvas at all: the grey of a dull day, the warm light
// of a clear one and the mist along the ground are one CSS background behind it, painted when
// the weather changes and composited for nothing after that.
let shadeKey = '';
function paintShade() {
  const p = params(); const night = isNight();
  const layers = [];
  if (sky.running) {
    if (p.fog && sky.haze) layers.push(`linear-gradient(to bottom, rgba(235,238,242,0) 55%, rgba(235,238,242,${(0.4 * Math.min(1.5, sky.intensity)).toFixed(3)}) 100%)`);
    if (sky.scene === 'clear' && !night) layers.push('radial-gradient(circle at 92% -5%, rgba(255,236,170,0.22) 0, rgba(255,220,150,0.07) 22%, rgba(255,220,150,0) 55%)');
    const tint = sky.tint ? (p.tint || 0) * Math.min(1.4, 0.6 + sky.intensity * 0.5) + (p.night ? 0.26 : 0) : 0;
    if (tint > 0) layers.push(`linear-gradient(to bottom, rgba(18,26,44,${(tint * 1.35).toFixed(3)}), rgba(18,26,44,${(tint * 0.55).toFixed(3)}))`);
  }
  const key = layers.join(',');
  if (key === shadeKey) return;
  shadeKey = key;
  shade.style.background = key || 'none';
}
// The pet shook herself: whatever lay on her flies off.
function shakeOffPet() { for (const s of surfaceList) if (s.kind === 'pet') shedAll(s, rnd(-120, 120)); }
function startSky() {
  if (sky.running) return;
  sky.running = true; last = 0; lastCall = 0; paintShade();
  if (!frameId) frameId = requestAnimationFrame(step);
}
function stopSky(clear) {
  sky.running = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  if (clear) { ctx.clearRect(0, 0, view.w, view.h); paintShade(); }
}
// What lies on the ground and on the Dock is kept between visits (snow on windows is not:
// the windows will not be there).
function pileSnapshot() {
  const out = {};
  for (const id of ['ground', 'dock']) { const s = surfaces.get(id); if (s && s.pile.some((v) => v > 0.4)) out[id] = Array.from(s.pile, (v) => Math.round(v * 10) / 10); }
  return out;
}
function restorePile(saved, hoursAway) {
  const melt = Math.max(0, hoursAway) * 2.5;   // snow left behind melts a little while you are away
  for (const id of ['ground', 'dock']) {
    const s = surfaces.get(id); const values = saved?.[id];
    if (!s || !Array.isArray(values)) continue;
    for (let i = 0; i < Math.min(values.length, s.pile.length); i += 1) s.pile[i] = Math.max(0, (Number(values[i]) || 0) - melt);
  }
}
const snowing = () => Boolean(params().snow);
