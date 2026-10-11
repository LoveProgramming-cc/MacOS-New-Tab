// The sprite sheet: 8 columns × 11 rows of 192 × 208 cells. Rows 0–8 are animations, rows 9
// and 10 are sixteen still poses looking in every direction (0° = up, clockwise).

const COLUMNS = 8;
const ROWS = 11;
const CELL = { width: 192, height: 208 };
const CLIPS = {
  idle: { row: 0, frames: 6, fps: 6 },
  'running-right': { row: 1, frames: 8, fps: 12 },
  'running-left': { row: 2, frames: 8, fps: 12 },
  waving: { row: 3, frames: 4, fps: 7 },
  jumping: { row: 4, frames: 5, fps: 9 },
  failed: { row: 5, frames: 8, fps: 9 },
  waiting: { row: 6, frames: 6, fps: 6 },
  running: { row: 7, frames: 6, fps: 8 },
  review: { row: 8, frames: 6, fps: 6 }
};

const spriteEl = root.querySelector('#sprite');
function showCell(column, row) {
  spriteEl.style.backgroundPosition = `${(column / (COLUMNS - 1)) * 100}% ${(row / (ROWS - 1)) * 100}%`;
  fitShape(column, row);
}

// ---- only she takes clicks ------------------------------------------------------------------
// The window is cut to the shape of the pose on screen (macos.window.setShape), so a click
// beside her goes to the desktop underneath. Each cell is measured once, in blocks of 8 × 8
// sprite pixels, one block wider all round so she is easy to grab.
const BLOCK = 8;
const GRID = { width: CELL.width / BLOCK, height: CELL.height / BLOCK };
const masks = new Map();   // "column,row" -> [[x, y, w, h]] in blocks
let sheet = null;
let shapeShown = '';
let shapeSent = '';
async function loadShapes() {
  try {
    const image = new Image();
    image.src = await macos.assets.url('assets/sprites.webp');
    await image.decode();
    sheet = image;
  } catch { sheet = null; }   // without it the whole window takes clicks, as before
}
function maskOf(column, row) {
  const key = `${column},${row}`;
  if (masks.has(key)) return masks.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = CELL.width; canvas.height = CELL.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(sheet, column * CELL.width, row * CELL.height, CELL.width, CELL.height, 0, 0, CELL.width, CELL.height);
  const pixels = context.getImageData(0, 0, CELL.width, CELL.height).data;
  // A block counts as soon as one pixel in it shows: a single strand of hair is never cut off.
  const covered = new Uint8Array(GRID.width * GRID.height);
  for (let y = 0; y < CELL.height; y += 1) {
    for (let x = 0; x < CELL.width; x += 1) if (pixels[(y * CELL.width + x) * 4 + 3] > 8) covered[Math.floor(y / BLOCK) * GRID.width + Math.floor(x / BLOCK)] = 1;
  }
  const solid = (x, y) => x >= 0 && y >= 0 && x < GRID.width && y < GRID.height && covered[y * GRID.width + x] === 1;
  const grown = (x, y) => { for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (solid(x + dx, y + dy)) return true; return false; };
  // Runs of covered blocks per line; a run equal to the one on the line above extends it.
  const rects = []; let above = new Map();
  for (let y = 0; y < GRID.height; y += 1) {
    const here = new Map();
    for (let x = 0; x < GRID.width; x += 1) {
      if (!grown(x, y)) continue;
      const start = x;
      while (x + 1 < GRID.width && grown(x + 1, y)) x += 1;
      const runKey = `${start}:${x}`;
      const rect = above.get(runKey);
      if (rect) { rect[3] += 1; here.set(runKey, rect); } else { const next = [start, y, x - start + 1, 1]; rects.push(next); here.set(runKey, next); }
    }
    above = here;
  }
  masks.set(key, rects);
  return rects;
}
function fitShape(column, row) {
  if (!sheet) return;
  const scale = spriteEl.clientWidth / CELL.width;
  if (!scale) return;
  const key = `${column},${row},${scale}`;
  if (key === shapeShown) return;
  shapeShown = key;
  const unit = BLOCK * scale;
  let rects;
  try { rects = maskOf(column, row).map(([x, y, w, h]) => [x * unit, y * unit, w * unit, h * unit]); } catch { sheet = null; return; }
  // Neighbouring frames often have the same outline: only a different one is sent.
  const outline = JSON.stringify(rects);
  if (outline === shapeSent) return;
  shapeSent = outline;
  // A system without window shapes: the whole window takes clicks, and nothing more is asked.
  macos.window.setShape(rects).catch(() => { sheet = null; });
}

// One clip plays at a time. play() resolves true when it finished its loops, false when
// something else took over first.
const player = { name: '', frame: 0, timer: 0, finish: null, paused: false, resume: null };
function stopClip() {
  clearTimeout(player.timer);
  player.timer = 0;
  const finish = player.finish;
  player.finish = null; player.resume = null; player.name = '';
  finish?.(false);
}
/**
 * loops: how many times (Infinity = until replaced). hold: [min, max] ms to rest on the
 * first frame between loops (breathing and blinking look calmer with pauses).
 */
function play(name, { loops = Infinity, hold = null, fps = null } = {}) {
  stopClip();
  const clip = CLIPS[name];
  if (!clip) return Promise.resolve(false);
  return new Promise((resolve) => {
    player.name = name; player.frame = 0; player.finish = resolve;
    let left = loops;
    const delay = 1000 / (fps || clip.fps);
    const tick = () => {
      if (player.name !== name) return;
      if (player.paused) { player.resume = tick; return; }
      showCell(player.frame, clip.row);
      player.frame += 1;
      if (player.frame < clip.frames) { player.timer = setTimeout(tick, delay); return; }
      player.frame = 0;
      left -= 1;
      if (left <= 0) {
        player.timer = setTimeout(() => { if (player.name !== name) return; player.finish = null; player.name = ''; resolve(true); }, delay);
        return;
      }
      const rest = hold ? hold[0] + Math.random() * (hold[1] - hold[0]) : 0;
      player.timer = setTimeout(tick, delay + rest);
    };
    tick();
  });
}
/** A still pose looking towards `angle` degrees (0 = up, 90 = right, 180 = down). */
function lookToward(angle) {
  stopClip();
  const index = Math.round((((angle % 360) + 360) % 360) / 22.5) % 16;
  showCell(index % 8, index < 8 ? 9 : 10);
}
/** Stops the clock while she cannot be seen; the clip carries on where it was. */
function pauseSprite(paused) {
  player.paused = paused;
  if (!paused && player.resume) { const resume = player.resume; player.resume = null; resume(); }
}
