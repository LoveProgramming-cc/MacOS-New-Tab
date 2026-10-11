// The window is the paper plane. It changes size with what it shows — a sheet of paper, a
// plane resting with a speech bubble, a plane in the air — and is moved across the desktop
// one frame at a time while it flies. Only what is drawn takes clicks (macos.window.setHitRegion;
// not setShape, which would also cut the shadows off the paper).

const T = (key, fallback) => macos.i18n.t(key, fallback);
const stage = root.querySelector('#stage');
const planeEl = root.querySelector('#plane');
const artEl = root.querySelector('#plane-art');
const bubbleEl = root.querySelector('#bubble');

// For each layout: the window size, and where the plane's centre sits in it.
const LAYOUTS = {
  card: { w: 492, h: 572, cx: 246, cy: 286 },
  park: { w: 280, h: 170, cx: 140, cy: 122 },
  fly:  { w: 150, h: 100, cx: 75, cy: 50 }
};
const PLANE_HALF_HEIGHT = 24;   // from the plane's centre down to its keel

let layout = 'card';
let win = null;                 // last known window frame (screen coordinates)
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function refreshFrame() {
  try { win = await macos.window.getFrame(); } catch {}
  return win;
}
function screenOf() {
  const s = win?.screen || {};
  return { width: s.width || 1440, height: s.height || 900, top: s.top || 0, dock: s.dock || null };
}
// Where the plane's centre may be, so that the window stays on the desktop.
function boundsOf(name = layout) {
  const L = LAYOUTS[name]; const s = screenOf();
  return { minX: L.cx, maxX: s.width - (L.w - L.cx), minY: s.top + L.cy, maxY: s.height - (L.h - L.cy) };
}
// The ground under x: the top of the Dock, or the bottom of the screen.
function groundY(x, name = layout) {
  const s = screenOf(); const d = s.dock;
  const floor = d && x >= d.x && x <= d.x + d.width ? d.y : s.height;
  return Math.min(floor - PLANE_HALF_HEIGHT, boundsOf(name).maxY);
}
function planeCenter() {
  const L = LAYOUTS[layout];
  return { x: (win?.x || 0) + L.cx, y: (win?.y || 0) + L.cy };
}

async function setLayout(name, center) {
  const L = LAYOUTS[name];
  layout = name;
  stage.classList.remove('layout-card', 'layout-park', 'layout-fly');
  stage.classList.add(`layout-${name}`);
  const b = boundsOf(name);
  const cx = clamp(center.x, b.minX, b.maxX); const cy = clamp(center.y, b.minY, b.maxY);
  try {
    await macos.window.resize(L.w, L.h);
    win = await macos.window.moveTo(Math.round(cx - L.cx), Math.round(cy - L.cy));
  } catch (error) { macos.log('layout failed', String(error)); await refreshFrame(); }
  updateShape();
}

// One move per frame at most; a move that is still on its way is not queued behind.
let moving = false; let pendingMove = null;
function placePlane(cx, cy) {
  const L = LAYOUTS[layout];
  const x = Math.round(cx - L.cx); const y = Math.round(cy - L.cy);
  if (win) { win.x = x; win.y = y; }
  if (moving) { pendingMove = [cx, cy]; return; }
  moving = true;
  macos.window.moveTo(x, y).catch(() => {}).finally(() => {
    moving = false;
    if (pendingMove) { const [a, b] = pendingMove; pendingMove = null; placePlane(a, b); }
  });
}

function setAngle(vx, vy) {
  const dir = vx < 0 ? -1 : 1;
  let deg = (Math.atan2(vy, vx) * 180) / Math.PI;
  if (dir < 0) deg -= 180;
  deg = ((deg + 540) % 360) - 180;
  artEl.style.setProperty('--angle', `${clamp(deg, -70, 70).toFixed(1)}deg`);
  artEl.style.setProperty('--dir', String(dir));
}
function resetAngle(dir = 1) { artEl.style.setProperty('--angle', '0deg'); artEl.style.setProperty('--dir', String(dir)); }

// ---- what takes clicks ----------------------------------------------------------------------
let shapeSent = '';
function updateShape() {
  const rects = [];
  for (const el of [planeEl, bubbleEl, ...root.querySelectorAll('.card')]) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) rects.push([Math.floor(r.left) - 4, Math.floor(r.top) - 4, Math.ceil(r.width) + 8, Math.ceil(r.height) + 8]);
  }
  const key = JSON.stringify(rects);
  if (key === shapeSent) return;
  shapeSent = key;
  macos.window.setHitRegion(rects).catch(() => {});
}

// ---- free flight ----------------------------------------------------------------------------
// A glider: gravity, lift that grows with the square of the speed (level flight at about
// 300 px/s), and drag. Thrown hard it climbs, slows, and noses down again.
const GRAVITY = 330;
const LIFT = GRAVITY / (300 * 300);
const DRAG = LIFT / 5.5;

let flightToken = 0;
function cancelFlight() { flightToken += 1; }

/**
 * Flies from (x, y) with velocity (vx, vy) until the plane leaves the desktop through a side
 * ('exit') or comes to rest on the ground ('landed'). Resolves with { result, x, y }.
 */
async function fly(x, y, vx, vy, { maxTime = 11 } = {}) {
  const token = ++flightToken;
  planeEl.classList.remove('bob', 'away', 'arrive', 'appear');
  await setLayout('fly', { x, y });
  const b = boundsOf('fly');
  let last = performance.now(); let time = 0; let sliding = false;
  while (token === flightToken) {
    const now = await nextFrame();
    const dt = Math.min(0.04, (now - last) / 1000); last = now; time += dt;
    const v = Math.hypot(vx, vy) || 1;
    if (!sliding) {
      const nx = vx >= 0 ? vy / v : -vy / v; const ny = vx >= 0 ? -vx / v : vx / v;   // "up" relative to the plane
      const lift = LIFT * v * v * (time > maxTime ? 0.2 : 1);
      const drag = DRAG * v * v;
      vx += (nx * lift - (vx / v) * drag) * dt;
      vy += (GRAVITY + ny * lift - (vy / v) * drag) * dt + Math.sin(time * 7.3) * 9 * dt;
      const speed = Math.hypot(vx, vy);
      if (speed > 2600) { vx *= 2600 / speed; vy *= 2600 / speed; }
    } else {
      vx *= Math.max(0, 1 - 3.2 * dt); vy = 0;
    }
    x += vx * dt; y += vy * dt;
    // Out through a side of the desktop: it goes on into the distance.
    if ((x <= b.minX + 2 && vx < -60) || (x >= b.maxX - 2 && vx > 60)) {
      x = clamp(x, b.minX, b.maxX); placePlane(x, y);
      planeEl.classList.add('away');
      await wait(450);
      return { result: 'exit', x, y };
    }
    if (y < b.minY) { y = b.minY; vy = Math.abs(vy) * 0.3; }
    const ground = groundY(x, 'fly');
    if (y >= ground) {
      y = ground;
      if (!sliding && vy > 260) { vy = -vy * 0.25; vx *= 0.65; }
      else { sliding = true; }
    }
    if (sliding && Math.abs(vx) < 18) { placePlane(x, y); resetAngle(vx < 0 ? -1 : 1); return { result: 'landed', x, y }; }
    x = clamp(x, b.minX, b.maxX);
    placePlane(x, y);
    if (sliding) resetAngle(vx < 0 ? -1 : 1); else setAngle(vx, vy);
  }
  return { result: 'cancelled', x, y };
}

// A scripted glide in from one side of the desktop to a place on the ground.
async function arriveAt(target) {
  const token = ++flightToken;
  const s = screenOf(); const b = boundsOf('fly');
  const fromLeft = target.x > s.width / 2;
  const start = { x: fromLeft ? b.minX : b.maxX, y: clamp(s.top + 70 + Math.random() * s.height * 0.22, b.minY, b.maxY) };
  const end = { x: clamp(target.x, b.minX, b.maxX), y: groundY(target.x, 'fly') };
  const control = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - rnd(60, 160) };
  planeEl.hidden = false;
  planeEl.classList.remove('bob', 'away', 'appear');
  resetAngle(fromLeft ? 1 : -1);
  await setLayout('fly', start);
  planeEl.classList.add('arrive');
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const duration = clamp(distance / 340, 2.6, 5.2) * 1000;
  const t0 = performance.now();
  let prev = start;
  while (token === flightToken) {
    const now = await nextFrame();
    const t = Math.min(1, (now - t0) / duration);
    const s1 = 1 - (1 - t) ** 2;
    const q = 1 - s1;
    const x = q * q * start.x + 2 * q * s1 * control.x + s1 * s1 * end.x;
    const y = q * q * start.y + 2 * q * s1 * control.y + s1 * s1 * end.y + Math.sin(t * Math.PI * 3) * 16 * (1 - t);
    placePlane(x, y);
    if (Math.hypot(x - prev.x, y - prev.y) > 0.5) setAngle(x - prev.x, (y - prev.y) * (t > 0.85 ? (1 - t) / 0.15 : 1));
    prev = { x, y };
    if (t >= 1) break;
  }
  planeEl.classList.remove('arrive');
  if (token !== flightToken) return false;
  resetAngle(fromLeft ? 1 : -1);
  await setLayout('park', end);
  return true;
}

// Off it goes on its own: a hop, then up and out through the farther side.
async function takeOff() {
  const c = planeCenter(); const s = screenOf();
  const toRight = c.x < s.width / 2;
  return fly(c.x, c.y - 4, (toRight ? 1 : -1) * rnd(560, 680), -rnd(420, 520));
}
