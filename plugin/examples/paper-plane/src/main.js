// 纸飞机 / Paper Plane — letters to your future self.
//
// Write a few lines, fold them into a paper plane and throw it off the desktop. On the day you
// chose it glides back in, lands on the Dock and waits for you to open it.
//
// state: hidden | prompt | compose | aim | flying | arriving | landed | reading | mailbox

const $ = (sel) => root.querySelector(sel);
const DAY = 86400000;
const DELAYS = [
  { id: 'test', ms: 60000, key: 'delayTest', fallback: '1 minute (try it)' },
  { id: '1d', ms: DAY, key: 'delay1d', fallback: 'Tomorrow' },
  { id: '3d', ms: 3 * DAY, key: 'delay3d', fallback: 'In 3 days' },
  { id: '1w', ms: 7 * DAY, key: 'delay1w', fallback: 'In a week' },
  { id: '1m', ms: 30 * DAY, key: 'delay1m', fallback: 'In a month' },
  { id: '6m', ms: 182 * DAY, key: 'delay6m', fallback: 'In six months' },
  { id: '1y', ms: 365 * DAY, key: 'delay1y', fallback: 'In a year' },
  { id: 'someday', random: [7, 365], key: 'delaySomeday', fallback: 'Someday (a surprise)' }
];
const PAPERS = [
  { id: 'white', color: '#fbfaf5' }, { id: 'blue', color: '#e3edff' }, { id: 'pink', color: '#ffe3ea' },
  { id: 'yellow', color: '#fff3c4' }, { id: 'green', color: '#e1f3e1' }
];

let letters = [];
let state = 'hidden';
let draft = { text: '', delay: '1m', paper: 'white' };
let current = null;          // the letter being read, re-sent or flown
let reflyDelay = '';
let promptTimer = 0; let aimTimer = 0;

const lang = () => macos.i18n.language() || 'en-US';
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
const formatDate = (ms) => new Intl.DateTimeFormat(lang(), { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(ms));
const formatShort = (ms) => new Intl.DateTimeFormat(lang(), { month: 'short', day: 'numeric' }).format(new Date(ms));
function relative(ms) {
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  const diff = ms - Date.now(); const abs = Math.abs(diff);
  if (abs < 3600000) return rtf.format(Math.round(diff / 60000), 'minute');
  if (abs < 2 * DAY) return rtf.format(Math.round(diff / 3600000), 'hour');
  if (abs < 60 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  if (abs < 730 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), 'month');
  return rtf.format(Math.round(diff / (365 * DAY)), 'year');
}
const firstLine = (text) => String(text || '').trim().split('\n')[0].slice(0, 60) || '…';

// ---- letters in storage ------------------------------------------------------------------------
async function load() {
  const saved = await macos.storage.get('letters').catch(() => null);
  letters = Array.isArray(saved) ? saved : [];
  const d = await macos.storage.get('draft').catch(() => null);
  if (d && typeof d === 'object') draft = { ...draft, ...d };
}
function saveLetters() {
  macos.storage.set('letters', letters).catch((e) => macos.log('save failed', String(e)));
  publish();
  armArrival();
}

// ---- landing while nobody is looking ---------------------------------------------------------------
// A letter in the air is also a notification scheduled with the system for the moment it is
// due: it is shown even when no new tab is open, and opening it opens this application, where
// the plane then lands. A letter that has been read, deleted or sent on again takes its
// notification with it.
function announceLanding(letter) {
  if (letter.status !== 'flying' || letter.due <= Date.now()) return;
  macos.notifications.schedule({
    id: letter.id, at: letter.due, tag: `landed:${letter.id}`,
    title: T('landedTitle', 'A paper plane has landed'),
    body: fill(T('landedBody', 'A letter from you, written {date}. Open it to unfold it.'), { date: formatDate(letter.written) })
  }).catch((e) => macos.log('schedule failed', String(e)));
}
const forgetLanding = (letter) => macos.notifications.cancel(letter.id).catch(() => {});
// Letters thrown before this version, or scheduled in another language: brought up to date.
async function syncLandings() {
  const have = new Set((await macos.notifications.scheduled().catch(() => [])).map((n) => n.id));
  for (const id of have) if (!letters.some((l) => l.id === id && l.status === 'flying')) macos.notifications.cancel(id).catch(() => {});
  for (const letter of flying()) announceLanding(letter);
}
// While it runs, the plane lands at the minute it is due, not at the next look.
let arrivalTimer = 0;
function armArrival() {
  clearTimeout(arrivalTimer);
  const next = flying()[0];
  if (next) arrivalTimer = setTimeout(checkArrivals, Math.max(500, Math.min(next.due - Date.now() + 300, 2_000_000_000)));
}
let draftTimer = 0;
function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => macos.storage.set('draft', draft).catch(() => {}), 400); }
const flying = () => letters.filter((l) => l.status === 'flying').sort((a, b) => a.due - b.due);
const kept = () => letters.filter((l) => l.status === 'kept').sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
const dueNow = () => flying().filter((l) => l.due <= Date.now());
function dueFor(delayId) {
  const d = DELAYS.find((x) => x.id === delayId) || DELAYS[4];
  if (d.random) return { due: Date.now() + Math.round(rnd(d.random[0], d.random[1]) * DAY), secret: true };
  return { due: Date.now() + d.ms, secret: false };
}

// ---- showing and hiding the window ----------------------------------------------------------------
let showing = false;
async function show() {
  showing = true;
  await macos.window.focus().catch(() => {});
  setTimeout(() => { showing = false; }, 400);
}
function clearStage() {
  for (const el of root.querySelectorAll('.card')) { el.hidden = true; el.classList.remove('folding', 'shake'); }
  planeEl.hidden = true; planeEl.classList.remove('bob', 'away', 'arrive', 'appear', 'dragging');
  $('#badge').hidden = true;
  bubbleEl.hidden = true;
  clearTimeout(promptTimer); clearTimeout(aimTimer);
}
async function hide() {
  cancelFlight();
  clearStage();
  state = 'hidden';
  updateShape();
  await macos.window.minimize().catch(() => {});
  // Something may have become due while the window was busy.
  setTimeout(checkArrivals, 1500);
}
function say(parts) {
  bubbleEl.replaceChildren(...parts.map((p) => {
    if (p === '\n') return document.createElement('br');
    if (typeof p === 'string') return document.createTextNode(p);
    const b = document.createElement('b'); b.textContent = p.bold; return b;
  }));
  bubbleEl.hidden = false;
  requestAnimationFrame(updateShape);
}
function setPaper(id) { stage.dataset.paper = id || 'white'; }
async function centerCard() {
  await refreshFrame();
  const s = screenOf();
  await setLayout('card', { x: s.width / 2, y: s.top + (s.height - s.top) / 2 - 20 });
}

// ---- writing ---------------------------------------------------------------------------------------
async function compose() {
  cancelFlight(); clearStage();
  state = 'compose';
  current = null;
  setPaper(draft.paper);
  await centerCard();
  await show();
  $('#text').value = draft.text || '';
  fillCompose();
  $('#compose').hidden = false;
  updateShape();
  setTimeout(() => $('#text').focus(), 60);
}
// Everything on the sheet that is in the system's language (drawn again when that changes).
function fillCompose() {
  $('#compose-date').textContent = formatDate(Date.now());
  $('#text').placeholder = T('placeholder', 'Dear me, by the time you read this…');
  renderChips($('#delays'), draft.delay, (id) => { draft.delay = id; saveDraft(); });
  renderPapers();
}
function renderChips(container, selected, onPick) {
  container.replaceChildren(...DELAYS.map((d) => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = `chip${d.id === selected ? ' on' : ''}`; chip.textContent = T(d.key, d.fallback);
    chip.addEventListener('click', () => { container.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); chip.classList.add('on'); onPick(d.id); });
    return chip;
  }));
}
function renderPapers() {
  $('#papers').replaceChildren(...PAPERS.map((p) => {
    const dot = document.createElement('button');
    dot.type = 'button'; dot.className = `dot${p.id === draft.paper ? ' on' : ''}`; dot.style.background = p.color;
    dot.title = T(`paper_${p.id}`, p.id);
    dot.addEventListener('click', () => { draft.paper = p.id; setPaper(p.id); saveDraft(); renderPapers(); });
    return dot;
  }));
}
$('#text').addEventListener('input', (e) => { draft.text = e.target.value; saveDraft(); });
$('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendDraft(); } });
$('#fold').addEventListener('click', () => sendDraft());

function sendDraft() {
  const text = $('#text').value.trim();
  if (!text) { const card = $('#compose'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); $('#text').focus(); return; }
  const { due, secret } = dueFor(draft.delay);
  const letter = { id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, paper: draft.paper, written: Date.now(), sent: Date.now(), due, secret, delay: draft.delay, status: 'flying', flights: 1 };
  letters.push(letter);
  saveLetters();
  announceLanding(letter);
  draft = { ...draft, text: '' };
  macos.storage.set('draft', draft).catch(() => {});
  foldAndAim(letter, $('#compose'));
}

// ---- folding, aiming, throwing ------------------------------------------------------------------------
async function foldAndAim(letter, card) {
  state = 'folding';
  current = letter;
  setPaper(letter.paper);
  card.classList.add('folding');
  await wait(380);
  resetAngle(1);
  planeEl.hidden = false; planeEl.classList.add('appear');
  await wait(420);
  card.hidden = true; card.classList.remove('folding');
  const c = planeCenter();
  await setLayout('park', c);
  planeEl.classList.remove('appear'); planeEl.classList.add('bob');
  state = 'aim';
  sayAim();
  clearTimeout(aimTimer);
  aimTimer = setTimeout(() => { if (state === 'aim') launch(null); }, 30000);
}

async function launch(velocity) {
  clearTimeout(aimTimer);
  state = 'flying';
  bubbleEl.hidden = true;
  const c = planeCenter();
  let vx; let vy;
  if (velocity && Math.hypot(velocity.vx, velocity.vy) > 160) {
    vx = velocity.vx * 1.15; vy = velocity.vy * 1.15;
  } else {                                   // a gentle push towards the farther side
    const toRight = c.x < screenOf().width / 2;
    vx = (toRight ? 1 : -1) * 460; vy = -160;
  }
  let flight = await fly(c.x, c.y, vx, vy);
  if (flight.result === 'landed') {           // thrown at the ground: it shakes itself off and goes
    await wait(900);
    if (state !== 'flying') return;
    flight = await takeOff();
  }
  if (flight.result === 'cancelled') return;
  const letter = current;
  if (letter) {
    const when = letter.secret ? T('someday', 'someday') : letter.due - Date.now() < 2 * DAY ? relative(letter.due) : formatDate(letter.due);
    macos.notifications.show({ title: T('sentTitle', 'Your paper plane is on its way'), body: fill(T('sentBody', 'It will land {when}.'), { when }), tag: 'sent' }).catch(() => {});
  }
  current = null;
  hide();
}

// ---- arrivals --------------------------------------------------------------------------------------------
function landingSpot() {
  const s = screenOf(); const d = s.dock;
  const x = d && d.width > 200 ? rnd(d.x + 90, d.x + d.width - 90) : rnd(s.width * 0.3, s.width * 0.7);
  return { x, y: groundY(x, 'park') };
}
let arrivingLetter = null;
async function arrive(letter) {
  cancelFlight(); clearStage();
  state = 'arriving';
  arrivingLetter = letter;
  // Landing in front of the user says it all; behind another tab the notification still does.
  if (document.visibilityState === 'visible') forgetLanding(letter);
  setPaper(letter.paper);
  await refreshFrame();
  await show();
  const spot = landingSpot();
  const ok = await arriveAt(spot);
  if (!ok || state !== 'arriving') return;
  state = 'landed';
  planeEl.classList.add('bob');
  $('#badge').hidden = false;
  sayLanded();
}
const sayLanded = () => arrivingLetter && say([{ bold: fill(T('fromYouAgo', 'From you, {ago}'), { ago: relative(arrivingLetter.written) }) }, '\n', T('openHint', 'Click to unfold it')]);
const sayAim = () => say([{ bold: T('aimTitle', 'Throw it!') }, '\n', T('aimHint', 'Grab the plane and fling it off the desktop.')]);
const sayOffer = () => say([{ bold: T('offerTitle', 'Write to your future self?') }, '\n', T('offerHint', 'Click the plane')]);
function checkArrivals() {
  if (state !== 'hidden') return;
  const [next] = dueNow();
  if (next) arrive(next);
}
setInterval(checkArrivals, 20000);

// ---- reading --------------------------------------------------------------------------------------------
async function read(letter, { fromBox = false } = {}) {
  cancelFlight(); clearStage();
  state = 'reading';
  current = letter;
  reflyDelay = '';
  setPaper(letter.paper);
  if (letter.status === 'flying') { letter.status = 'kept'; letter.openedAt = Date.now(); saveLetters(); }
  forgetLanding(letter);
  await centerCard();
  await show();
  $('#letter-body').textContent = letter.text;
  $('#refly').hidden = true;
  $('#letter-delete').hidden = !fromBox;
  $('#letter-keep').dataset.fromBox = fromBox ? '1' : '';
  fillLetter();
  $('#letter').hidden = false;
  updateShape();
}
function fillLetter() {
  const letter = current; if (!letter) return;
  const fromBox = Boolean($('#letter-keep').dataset.fromBox);
  $('#letter-title').textContent = fill(T('fromYouOn', 'From you, {date}'), { date: formatDate(letter.written) });
  const flights = letter.flights > 1 ? ` · ${fill(T('flights', 'flown {n} times'), { n: letter.flights })}` : '';
  $('#letter-sub').textContent = `${fill(T('wroteAgo', 'Written {ago}'), { ago: relative(letter.written) })}${flights}`;
  $('#letter-keep').textContent = fromBox ? T('back', 'Back') : T('keep', 'Keep in mailbox');
  $('#letter-refly').textContent = !$('#refly').hidden && reflyDelay ? T('reflyGo', 'Fold and throw') : T('refly', 'Fly it again');
  if (!$('#refly').hidden) renderChips($('#refly-delays'), reflyDelay, (id) => { reflyDelay = id; $('#letter-refly').textContent = T('reflyGo', 'Fold and throw'); });
}
$('#letter-keep').addEventListener('click', () => {
  if ($('#letter-keep').dataset.fromBox) { mailbox(); return; }
  current = null; hide();
});
$('#letter-refly').addEventListener('click', () => {
  const letter = current; if (!letter) return;
  if ($('#refly').hidden) {
    $('#refly').hidden = false;
    renderChips($('#refly-delays'), '', (id) => { reflyDelay = id; $('#letter-refly').textContent = T('reflyGo', 'Fold and throw'); });
    updateShape();
    return;
  }
  if (!reflyDelay) { $('#refly-delays').animate?.([{ translate: '-5px 0' }, { translate: '5px 0' }, { translate: '0 0' }], 240); return; }
  const { due, secret } = dueFor(reflyDelay);
  Object.assign(letter, { status: 'flying', due, secret, sent: Date.now(), delay: reflyDelay, flights: (letter.flights || 1) + 1 });
  delete letter.openedAt;
  saveLetters();
  announceLanding(letter);
  foldAndAim(letter, $('#letter'));
});
$('#letter-delete').addEventListener('click', async () => {
  const letter = current; if (!letter) return;
  const ok = await macos.dialog.confirm(T('deleteAsk', 'Throw this letter away for good?'), { confirmLabel: T('delete', 'Delete'), danger: true }).catch(() => false);
  if (!ok) return;
  letters = letters.filter((l) => l.id !== letter.id);
  forgetLanding(letter);
  saveLetters();
  mailbox();
});

// ---- the mailbox -------------------------------------------------------------------------------------------
async function mailbox() {
  cancelFlight(); clearStage();
  state = 'mailbox';
  current = null;
  setPaper('white');
  await centerCard();
  await show();
  fillMailbox();
  $('#mailbox').hidden = false;
  updateShape();
}
function fillMailbox() {
  const inAir = flying(); const box = kept();
  $('#mailbox-sub').textContent = fill(T('mailboxSub', '{kept} landed · {flying} in the air'), { kept: box.length, flying: inAir.length });
  const item = (icon, t1, t2, onClick) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = `box-item${onClick ? '' : ' sealed'}`;
    const i = document.createElement('span'); i.className = 'ico'; i.textContent = icon;
    const txt = document.createElement('span'); txt.className = 'txt';
    const a = document.createElement('div'); a.className = 't1'; a.textContent = t1;
    const c = document.createElement('div'); c.className = 't2'; c.textContent = t2;
    txt.append(a, c); b.append(i, txt);
    if (onClick) b.addEventListener('click', onClick); else b.disabled = true;
    return b;
  };
  const empty = (text) => { const d = document.createElement('div'); d.className = 'empty'; d.textContent = text; return d; };
  $('#received').replaceChildren(...(box.length ? box.map((l) => item('✉️', firstLine(l.text), `${formatDate(l.written)} · ${fill(T('landedAgo', 'landed {ago}'), { ago: relative(l.openedAt || l.due) })}`, () => read(l, { fromBox: true }))) : [empty(T('noneReceived', 'Nothing has landed yet.'))]));
  $('#flying').replaceChildren(...(inAir.length ? inAir.map((l) => item('✈️', T('sealed', 'Sealed — no peeking'), `${fill(T('sentOn', 'sent {date}'), { date: formatShort(l.sent || l.written) })} · ${l.secret ? T('landsSomeday', 'lands someday') : fill(T('landsOn', 'lands {when}'), { when: relative(l.due) })}`, null)) : [empty(T('noneFlying', 'No planes in the air.'))]));
}

// ---- the plane under the pointer -----------------------------------------------------------------------------
planeEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !['aim', 'landed', 'prompt'].includes(state)) return;
  event.preventDefault();
  const startX = event.screenX; const startY = event.screenY;
  let moved = false;
  const onMove = (e) => {
    if (e.pointerId !== event.pointerId) return;
    if (!moved && Math.hypot(e.screenX - startX, e.screenY - startY) > 4) { moved = true; planeEl.classList.add('dragging'); planeEl.classList.remove('bob'); bubbleEl.hidden = true; updateShape(); }
  };
  window.addEventListener('pointermove', onMove, true);
  const done = async (frame) => {
    window.removeEventListener('pointermove', onMove, true);
    planeEl.classList.remove('dragging');
    // Flicked off faster than the window follows, the last of the way is seen by the system
    // only: the frame says how far it went and how fast the pointer was going when it let go.
    if (frame && win && Math.hypot(frame.x - win.x, frame.y - win.y) > 4) moved = true;
    if (frame) win = frame; else await refreshFrame();
    if (!moved) { clicked(); return; }
    bubbleEl.hidden = true;
    if (state === 'aim') {
      launch(frame?.velocity ? { vx: frame.velocity.x, vy: frame.velocity.y } : null);
    } else {
      planeEl.classList.add('bob');
      if (state === 'landed') sayLanded();
    }
  };
  macos.window.beginDrag(event).then(done, () => done(null));
});
function clicked() {
  if (state === 'landed' && arrivingLetter) { const letter = arrivingLetter; arrivingLetter = null; read(letter); }
  else if (state === 'prompt') compose();
  else if (state === 'aim') launch(null);
}
bubbleEl.addEventListener('click', () => { if (state === 'landed' || state === 'prompt') clicked(); });

// ---- the little plane that offers itself when you open the app with nothing to read --------------------------------
async function offer() {
  cancelFlight(); clearStage();
  state = 'arriving';
  setPaper(draft.paper);
  await refreshFrame();
  await show();
  const s = screenOf(); const d = s.dock;
  const x = d ? d.x + d.width - 110 : s.width - 180;
  const ok = await arriveAt({ x, y: groundY(x, 'park') });
  if (!ok || state !== 'arriving') return;
  state = 'prompt';
  planeEl.classList.add('bob');
  sayOffer();
  promptTimer = setTimeout(async () => {
    if (state !== 'prompt') return;
    state = 'flying'; bubbleEl.hidden = true;
    const flight = await takeOff();
    if (flight.result !== 'cancelled') hide();
  }, 14000);
}

// ---- buttons with data-act, keys ---------------------------------------------------------------------------------
root.addEventListener('click', (e) => {
  const act = e.target.closest?.('[data-act]')?.dataset.act;
  if (act === 'hide') hide();
  else if (act === 'close-letter') ($('#letter-keep').dataset.fromBox ? mailbox() : hide());
  else if (act === 'compose') compose();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (state === 'reading' && $('#letter-keep').dataset.fromBox) mailbox();
  else if (['compose', 'reading', 'mailbox', 'prompt', 'aim'].includes(state)) { if (state === 'aim') launch(null); else hide(); }
});
// Cards are carried by their heading.
root.querySelectorAll('.grab').forEach((head) => head.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button')) return;
  macos.window.beginDrag(event).then((f) => { if (f) win = f; }, () => {});
}));

// ---- menus, Spotlight, widget, notifications ------------------------------------------------------------------------
function command(id) {
  if (id === 'compose') compose();
  else if (id === 'mailbox') mailbox();
  else if (id === 'quit') macos.window.close();
}
macos.on('statusitem', ({ id }) => command(id || 'compose'));
// A notification was opened: the plane it announced comes in to land (or is waiting already).
macos.on('notificationclick', () => {
  if (['arriving', 'landed', 'reading'].includes(state)) { show(); return; }
  const [next] = dueNow();
  if (next) arrive(next); else mailbox();
});
macos.on('widget', ({ action }) => command(action === 'compose' ? 'compose' : 'mailbox'));
macos.on('search', ({ id }) => {
  const letter = letters.find((l) => `letter:${l.id}` === id && l.status === 'kept');
  if (letter) read(letter, { fromBox: true }); else mailbox();
});
// Opening the application again (Launchpad, Spotlight) while it waits out of sight.
macos.on('reopen', () => {
  if (showing || state !== 'hidden') return;
  const [next] = dueNow();
  if (next) arrive(next); else compose();
});
// The system's language changed: everything on screen is said again in the new one, and the
// notifications waiting with the system are rewritten.
macos.on('languagechange', () => {
  translateStatic();
  if (state === 'compose') fillCompose();
  else if (state === 'reading') fillLetter();
  else if (state === 'mailbox') fillMailbox();
  else if (state === 'landed') sayLanded();
  else if (state === 'aim') sayAim();
  else if (state === 'prompt') sayOffer();
  publish(true);
  syncLandings();
});

let published = '';
function publish(force) {
  const air = flying(); const box = kept();
  const next = air[0];
  const nextText = next ? (next.secret ? T('nextSecret', 'Next one: a surprise') : fill(T('nextOn', 'Next lands {when}'), { when: relative(next.due) })) : T('noneFlying', 'No planes in the air.');
  const status = {
    icon: 'assets/status.svg', template: true, title: '', tooltip: nextText,
    items: [
      { id: 'compose', label: T('menuCompose', 'Write a Letter…') },
      { id: 'mailbox', label: fill(T('menuMailbox', 'Mailbox ({n})'), { n: box.length }) },
      { separator: true },
      { id: 'info-air', label: fill(T('inAirCount', '{n} in the air'), { n: air.length }), disabled: true },
      { id: 'info-next', label: nextText, disabled: true },
      { separator: true },
      { id: 'quit', label: T('quit', 'Quit Paper Plane') }
    ]
  };
  const white = (text, extra) => ({ type: 'text', text, color: 'white', lines: 1, ...extra });
  const widget = {
    small: { type: 'stack', direction: 'vertical', gradient: ['#ffb36b', '#e8743b'], padding: 14, gap: 2, children: [
      white('✈️', { fontSize: 26 }),
      { type: 'spacer' },
      white(String(air.length), { fontSize: 36, fontWeight: 'semibold' }),
      white(T('widgetInAir', 'letters in the air'), { fontSize: 12, fontWeight: 'medium' }),
      white(nextText, { fontSize: 11, opacity: 0.85 })
    ] },
    medium: { type: 'stack', direction: 'horizontal', gradient: ['#ffb36b', '#e8743b'], padding: 16, gap: 14, children: [
      { type: 'stack', direction: 'vertical', grow: 1, gap: 3, children: [
        white(T('appName', 'Paper Plane'), { fontSize: 14, fontWeight: 'semibold' }),
        white(fill(T('inAirCount', '{n} in the air'), { n: air.length }), { fontSize: 22, fontWeight: 'semibold' }),
        white(nextText, { fontSize: 12 }),
        { type: 'spacer' },
        white(fill(T('menuMailbox', 'Mailbox ({n})'), { n: box.length }), { fontSize: 12, opacity: 0.85 })
      ] },
      { type: 'stack', direction: 'vertical', justify: 'center', children: [
        { type: 'button', id: 'compose', label: T('widgetWrite', 'Write'), shape: 'pill' }
      ] }
    ] }
  };
  const search = box.map((l) => ({ id: `letter:${l.id}`, title: firstLine(l.text), subtitle: `${T('appName', 'Paper Plane')} · ${formatDate(l.written)}`, keywords: l.text.slice(0, 200) }));
  const key = JSON.stringify([status, widget, search]);
  if (!force && key === published) return;
  published = key;
  macos.statusItem.set(status).catch(() => {});
  macos.widgets.set('sky', widget).catch(() => {});
  macos.search.setItems(search).catch(() => {});
}
setInterval(() => publish(), 60000);

function translateStatic() {
  root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T(el.dataset.t, el.textContent); });
}

// ---- start ---------------------------------------------------------------------------------------------------------
translateStatic();
clearStage();
await load();
await refreshFrame();
updateShape();
publish(true);
syncLandings();
armArrival();

// Opened by the user, or started with every new tab (the user's setting in System Settings)?
// Started that way it waits quietly in the menu bar. The host says which it was.
const autoStarted = macos.context?.launchReason === 'autostart';
macos.storage.remove('launches').catch(() => {});   // what version 1.0 guessed this from

const [due] = dueNow();
if (due) arrive(due);
else if (!autoStarted) offer();
else hide();
