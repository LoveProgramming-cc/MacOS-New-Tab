// Calculator logic. The window, keypad and display are host-rendered native controls
// (see ui.json); this script only keeps state and patches two text nodes.
const KEYS = {
  'k-clear': 'clear', 'k-sign': 'sign', 'k-percent': 'percent', 'k-back': 'back',
  'k-div': '/', 'k-mul': '*', 'k-sub': '-', 'k-add': '+', 'k-eq': '=', 'k-dot': '.',
  'k-0': '0', 'k-1': '1', 'k-2': '2', 'k-3': '3', 'k-4': '4', 'k-5': '5', 'k-6': '6', 'k-7': '7', 'k-8': '8', 'k-9': '9'
};
let display = '0';
let stored = null;
let op = null;
let replace = true;

const pretty = (n) => {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
  const plain = String(rounded);
  return plain.length > 11 ? Number(rounded).toExponential(6) : plain;
};
const number = () => Number(display) || 0;
const symbol = (value) => value === '*' ? '×' : value === '/' ? '÷' : value === '-' ? '−' : value;
const paint = () => macos.ui.batch([
  // Long results shrink instead of being cut off.
  { id: 'value', props: { text: display, fontSize: display.length > 9 ? Math.max(20, Math.floor(41 * 9 / display.length)) : 41 } },
  { id: 'history', props: { text: stored !== null && op ? `${pretty(stored)} ${symbol(op)}` : '' } },
  { id: 'k-clear', props: { label: replace && stored === null ? 'AC' : 'C' } }
]);
const calculate = () => {
  if (stored === null || !op) return number();
  const b = number();
  if (op === '+') return stored + b;
  if (op === '-') return stored - b;
  if (op === '*') return stored * b;
  if (op === '/') return b === 0 ? NaN : stored / b;
  return b;
};
async function press(key) {
  if (/^\d$/.test(key)) {
    if (!replace && display.replace(/[-.]/g, '').length >= 15) return;
    display = replace ? key : (display === '0' ? key : display + key);
    replace = false;
  } else if (key === '.') {
    if (replace) { display = '0.'; replace = false; }
    else if (!display.includes('.')) display += '.';
  } else if (key === 'back') {
    if (!replace) { display = display.length > 1 && display !== '-0' ? display.slice(0, -1) : '0'; if (display === '-') display = '0'; }
  } else if (key === 'clear') {
    // C clears the entry being typed; AC (nothing being typed) clears everything.
    if (replace) { stored = null; op = null; }
    display = '0'; replace = true;
  } else if (key === 'sign') {
    display = pretty(-number());
  } else if (key === 'percent') {
    display = pretty(number() / 100); replace = true;
  } else if (['+', '-', '*', '/'].includes(key)) {
    if (stored !== null && !replace) display = pretty(calculate());
    stored = number(); op = key; replace = true;
  } else if (key === '=') {
    display = pretty(calculate()); stored = null; op = null; replace = true;
    try { await macos.storage.set('lastResult', display); } catch {}
  }
  await paint();
}

macos.on('ui', ({ id, event }) => {
  if (event === 'click' && KEYS[id]) press(KEYS[id]);
});
// Native apps receive keyboard input from the host while their window has focus.
macos.on('keydown', ({ key, metaKey, ctrlKey, altKey }) => {
  if (metaKey || ctrlKey || altKey) return;
  const escape = key === 'Escape';   // Escape clears; returning true keeps the host from closing the window
  if (key === 'Enter') key = '=';
  else if (key === 'Escape') key = 'clear';
  else if (key === 'Backspace') key = 'back';
  else if (key === 'x' || key === 'X') key = '*';
  else if (key === '%') key = 'percent';
  if (/^[0-9.+\-*/=]$/.test(key) || ['clear', 'back', 'percent'].includes(key)) press(key);
  return escape;
});
// The keypad is drawn in the window's appearance. Dark until the user picks another one
// from the View menu; the choice is the application's own and the host remembers it.
const FUNCTION_KEYS = ['k-clear', 'k-sign', 'k-percent'];
const OPERATOR_KEYS = ['k-div', 'k-mul', 'k-sub', 'k-add', 'k-eq'];
const PALETTE = {
  dark: { text: '#f7f7f7', digit: 'rgba(91,91,94,0.92)', fn: 'rgba(124,124,126,0.96)' },
  light: { text: '#1d1d1f', digit: 'rgba(255,255,255,0.78)', fn: 'rgba(120,120,128,0.30)' }
};
const paintTheme = (theme) => {
  const colors = PALETTE[theme === 'light' ? 'light' : 'dark'];
  return macos.ui.batch([
    { id: 'value', props: { color: colors.text } },
    ...Object.keys(KEYS).filter((id) => !OPERATOR_KEYS.includes(id)).map((id) => ({ id, props: { color: colors.text, background: FUNCTION_KEYS.includes(id) ? colors.fn : colors.digit } }))
  ]);
};
macos.on('themechange', ({ theme }) => { paintTheme(theme); });
macos.on('menucommand', async ({ command }) => {
  if (command.startsWith('appearance-')) { try { await macos.window.setAppearance(command.slice(11)); } catch {} return; }
  if (command === 'copy-result') { try { await macos.clipboard.writeText(display); } catch {} }
  if (command === 'clear') { replace = true; stored = null; op = null; press('clear'); }
});

if (macos.context.theme === 'light') await paintTheme('light');
try {
  const saved = await macos.storage.get('lastResult');
  if (saved && saved !== 'Error') { display = String(saved); await paint(); }
} catch {}
