// Developer Tools: the Task Manager and the Performance Monitor.
//
//   Task Manager         every running application window: what state it is in, how often it
//                        calls the system, how much of the main thread the system spends
//                        answering it, how many events it is sent, how large its native
//                        interface is — with Show, Reload and Quit. The system's own windows
//                        are listed below it.
//   Performance Monitor  the desktop as a whole, a minute back: frame rate, the slowest
//                        frame, long tasks, memory, DOM size, and the traffic between the
//                        applications and the system; then the applications by their share.
//
// What an application does inside its own sandbox cannot be seen from here (it is another
// document, often another process): these are the costs it causes on the desktop's side.

import { createElement } from './utils.js';
import { t } from './i18n.js';
import { closeManagedWindow, managedWindowList, restoreManagedWindow } from './window-manager.js';
import { appWindows } from './plugin-core.js';
import { closePluginWindow, devReloadApplication } from './plugin-system.js';
import { formatBytes } from './storage-settings.js';

const L = (key, fallback) => t(key, fallback);
const el = (tag, className = '', text = '') => createElement(tag, { className, ...(text !== '' ? { text } : {}) });

// ---- sampling ---------------------------------------------------------------------------
// Once a second, while one of the two panels is on screen: the frame loop's count and its
// longest gap, and each application's counters since the last look.
const HISTORY = 60;
const series = { fps: [], frame: [], long: [], heap: [], dom: [], calls: [], events: [], host: [] };
const rates = new Map();          // instance key -> { calls, events, host } per second
const seen = new Map();           // instance key -> the counters at the last sample
let frames = 0; let worst = 0; let lastFrame = 0; let loop = 0; let users = 0; let lastSample = 0;
const longTasks = [];
try { new PerformanceObserver((list) => { if (users) for (const entry of list.getEntries()) longTasks.push(entry.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
function frame(now) {
    if (lastFrame) worst = Math.max(worst, now - lastFrame);
    lastFrame = now; frames += 1;
    loop = requestAnimationFrame(frame);
}
function sample() {
    const now = performance.now();
    const seconds = lastSample ? Math.max(0.2, (now - lastSample) / 1000) : 1;
    // A pause (the tab was hidden, the tools were closed): the old minute says nothing about now.
    if (lastSample && now - lastSample > 5000) for (const list of Object.values(series)) list.length = 0;
    lastSample = now;
    let calls = 0; let events = 0; let host = 0;
    for (const [key, record] of appWindows) {
        const stats = record.stats || { calls: 0, events: 0, hostMs: 0 };
        const before = seen.get(key) || stats;
        const rate = { calls: Math.max(0, stats.calls - before.calls) / seconds, events: Math.max(0, stats.events - before.events) / seconds, host: Math.max(0, stats.hostMs - before.hostMs) / seconds };
        seen.set(key, { calls: stats.calls, events: stats.events, hostMs: stats.hostMs });
        rates.set(key, rate);
        calls += rate.calls; events += rate.events; host += rate.host;
    }
    for (const key of [...seen.keys()]) if (!appWindows.has(key)) { seen.delete(key); rates.delete(key); }
    const push = (name, value) => { const list = series[name]; list.push(value); if (list.length > HISTORY) list.shift(); };
    push('fps', Math.round(frames / seconds)); push('frame', Math.round(worst)); push('long', longTasks.length);
    push('heap', performance.memory ? performance.memory.usedJSHeapSize : 0); push('dom', document.getElementsByTagName('*').length);
    push('calls', Math.round(calls)); push('events', Math.round(events)); push('host', Math.round(host * 10) / 10);
    frames = 0; worst = 0; longTasks.length = 0;
}
function startSampling() {
    users += 1;
    if (users === 1) { frames = 0; worst = 0; lastFrame = 0; loop = requestAnimationFrame(frame); }
    return () => { users = Math.max(0, users - 1); if (!users) cancelAnimationFrame(loop); };
}
const number = (value, digits = 0) => (digits ? value.toFixed(digits) : String(Math.round(value)));

// ---- Task Manager -----------------------------------------------------------------------
const stateOf = (element) => (element.dataset.minimized === '1' ? ['minimized', L('devTaskMinimized', '已最小化')] : element.classList.contains('hidden') ? ['hidden', L('devTaskHidden', '已隐藏')] : ['open', L('devTaskOpen', '运行中')]);
export function tasksPanel({ body, toolbar, button, tick, cleanup, highlight }) {
    const summary = el('span', 'devtools-toolbar-note');
    toolbar.append(summary);
    const head = el('div', 'devtools-task-row devtools-task-head');
    for (const [label, cls] of [[L('devTaskApp', '应用程序'), 'name'], [L('devTaskState', '状态'), ''], [L('devTaskCalls', '接口调用/秒'), 'num'], [L('devTaskHost', '系统耗时'), 'num'], [L('devTaskEvents', '事件/秒'), 'num'], [L('devTaskNodes', '界面节点'), 'num'], ['', 'actions']]) head.appendChild(el('span', `devtools-task-cell ${cls}`.trim(), label));
    const apps = el('div', 'mac-card devtools-table devtools-tasks');
    const system = el('div', 'mac-card devtools-table devtools-tasks');
    const rows = new Map();   // instance key -> { row, cells }
    const appRow = (key, record) => {
        const row = el('div', 'devtools-task-row');
        const name = el('span', 'devtools-task-cell name');
        const icon = el('span', 'devtools-task-icon');
        if (record.plugin.icon) icon.appendChild(createElement('img', { attrs: { src: record.plugin.icon, alt: '', draggable: 'false' } }));
        const label = el('span', 'devtools-task-label');
        label.append(el('strong', '', record.instance > 1 ? `${record.plugin.name} #${record.instance}` : record.plugin.name), el('small', '', `${record.plugin.id} · ${record.nativeUi ? 'native' : 'web'}${record.window.dataset.windowLevel ? ` · ${record.window.dataset.windowLevel}` : ''}`));
        name.append(icon, label);
        const cells = { state: el('span', 'devtools-task-cell'), calls: el('span', 'devtools-task-cell num'), host: el('span', 'devtools-task-cell num'), events: el('span', 'devtools-task-cell num'), nodes: el('span', 'devtools-task-cell num') };
        const actions = el('span', 'devtools-task-cell actions');
        actions.append(
            button(L('devTaskShow', '显示'), () => restoreManagedWindow(record.window)),
            button(L('devTaskReload', '重新载入'), () => devReloadApplication(record.plugin.id).catch(() => {})),
            button(L('devTaskQuit', '退出'), () => closePluginWindow(key), 'danger')
        );
        row.append(name, cells.state, cells.calls, cells.host, cells.events, cells.nodes, actions);
        row.addEventListener('mouseenter', () => highlight(record.window.classList.contains('hidden') ? null : record.window));
        row.addEventListener('mouseleave', () => highlight(null));
        return { row, cells };
    };
    const refresh = () => {
        for (const [key, entry] of [...rows]) if (!appWindows.has(key)) { entry.row.remove(); rows.delete(key); }
        for (const [key, record] of appWindows) {
            if (!rows.has(key)) { const entry = appRow(key, record); rows.set(key, entry); apps.appendChild(entry.row); }
            const { row, cells } = rows.get(key);
            const [state, label] = record.window.classList.contains('plugin-app-crashed') ? ['crashed', L('devTaskCrashed', '已崩溃')] : stateOf(record.window);
            const rate = rates.get(key) || { calls: 0, events: 0, host: 0 };
            cells.state.textContent = label; row.dataset.state = state;
            cells.calls.textContent = number(rate.calls);
            cells.host.textContent = `${number(rate.host, 1)} ms/s`;
            cells.events.textContent = number(rate.events);
            cells.nodes.textContent = record.nativeUi ? String(record.nativeUi.nodeCount()) : '—';
            // The budget the Console warns about: more than 90 calls a second.
            cells.calls.classList.toggle('hot', rate.calls > 90); cells.host.classList.toggle('hot', rate.host > 100);
        }
        apps.querySelector('.devtools-empty')?.remove();
        if (!appWindows.size) apps.appendChild(el('div', 'devtools-empty', L('devTaskNone', '没有正在运行的应用程序。')));
        const windows = managedWindowList().filter((item) => !item.element.classList.contains('plugin-app-window') && item.state !== 'closed');
        system.replaceChildren(...windows.map((item) => {
            const row = el('div', 'devtools-task-row system');
            const name = el('span', 'devtools-task-cell name'); name.appendChild(el('strong', '', item.name));
            const actions = el('span', 'devtools-task-cell actions');
            actions.append(button(L('devTaskShow', '显示'), () => restoreManagedWindow(item.element)), button(L('close', '关闭'), () => { closeManagedWindow(item.element); refresh(); }));
            row.append(name, el('span', 'devtools-task-cell', stateOf(item.element)[1]), el('span', 'devtools-task-cell wide', `${item.bounds[2]}×${item.bounds[3]} @ ${item.bounds[0]},${item.bounds[1]} · z ${item.z}`), actions);
            return row;
        }));
        if (!windows.length) system.appendChild(el('div', 'devtools-empty', L('devTaskNoWindows', '没有打开的系统窗口。')));
        summary.textContent = L('devTaskSummary', '{apps} 个应用程序窗口 · {windows} 个系统窗口').replace('{apps}', String(appWindows.size)).replace('{windows}', String(windows.length));
    };
    // The headings are the first row of the table itself, so they stand over their columns.
    apps.appendChild(head);
    body.append(el('div', 'devtools-note', L('devTaskNote', '应用程序在自己沙盒里做的事从这里看不到；这里列的是它给桌面这一侧带来的负担：调用系统接口的次数、系统为它花掉的主线程时间、发给它的事件。')), apps, el('h3', '', L('devTaskSystemWindows', '系统窗口')), system);
    const stop = startSampling();
    sample(); refresh();
    tick(() => { sample(); refresh(); });
    cleanup(() => { stop(); highlight(null); });
}

// ---- Performance Monitor ----------------------------------------------------------------
function drawChart(canvas, values, { max = 0, color }) {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 200; const height = canvas.clientHeight || 46;
    if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (values.length < 2) return;
    const top = Math.max(max, ...values, 1) * 1.08;
    const x = (index) => width - (values.length - 1 - index) * (width / (HISTORY - 1));
    const y = (value) => height - 1 - (value / top) * (height - 3);
    ctx.beginPath();
    values.forEach((value, index) => (index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value))));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(x(values.length - 1), height); ctx.lineTo(x(0), height); ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
}
export function performancePanel({ body, tick, cleanup }) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff';
    const charts = [
        ['fps', L('devFps', '帧率'), (v) => `${v}`, { max: 60, color: '#34c759' }],
        ['frame', L('devPerfSlowest', '最慢一帧'), (v) => `${v} ms`, { max: 34, color: '#ff9f0a' }],
        ['long', L('devPerfLong', '长任务/秒'), (v) => `${v}`, { max: 2, color: '#ff453a' }],
        ['heap', L('devHeap', 'JS 内存'), (v) => (v ? formatBytes(v) : '—'), { color: '#bf5af2' }],
        ['dom', L('devDomNodes', 'DOM 节点'), (v) => `${v}`, { color: '#64d2ff' }],
        ['calls', L('devPerfCallsAll', '接口调用/秒（全部应用）'), (v) => `${v}`, { max: 30, color: accent }],
        ['host', L('devPerfHost', '系统为应用花的时间'), (v) => `${v} ms/s`, { max: 20, color: accent }],
        ['events', L('devPerfEvents', '发给应用的事件/秒'), (v) => `${v}`, { max: 30, color: accent }]
    ].map(([name, label, format, options]) => {
        const card = el('div', 'devtools-chart');
        const value = el('strong'); const canvas = createElement('canvas', { className: 'devtools-chart-canvas' });
        card.append(value, el('span', '', label), canvas);
        return { name, format, options, card, value, canvas };
    });
    const grid = el('div', 'devtools-charts');
    grid.append(...charts.map((chart) => chart.card));
    const shares = el('div', 'mac-card devtools-table');
    const refresh = () => {
        for (const chart of charts) {
            const values = series[chart.name];
            chart.value.textContent = values.length ? chart.format(values[values.length - 1]) : '—';
            drawChart(chart.canvas, values, chart.options);
        }
        // The applications by what the system spends on them, the busiest first.
        const list = [...appWindows].map(([key, record]) => ({ key, record, rate: rates.get(key) || { calls: 0, events: 0, host: 0 } })).sort((a, b) => (b.rate.host - a.rate.host) || (b.rate.calls - a.rate.calls));
        const most = Math.max(1, ...list.map((item) => item.rate.host));
        shares.replaceChildren(...list.map(({ record, rate }) => {
            const row = el('div', 'card-row devtools-row devtools-share');
            const bar = el('span', 'devtools-share-bar'); const fill = el('i'); fill.style.width = `${Math.round((rate.host / most) * 100)}%`; bar.appendChild(fill);
            row.append(el('span', 'devtools-key', record.instance > 1 ? `${record.plugin.name} #${record.instance}` : record.plugin.name), bar,
                el('span', 'devtools-value', `${number(rate.host, 1)} ms/s · ${number(rate.calls)} ${L('devPerfCallsUnit', '次调用')} · ${number(rate.events)} ${L('devPerfEventsUnit', '个事件')}`));
            return row;
        }));
        if (!list.length) shares.appendChild(el('div', 'card-row developer-setting-note', L('devTaskNone', '没有正在运行的应用程序。')));
    };
    body.append(el('div', 'devtools-note', L('devPerfNote', '最近一分钟，每秒一个采样。帧率低于显示器刷新率、最慢一帧超过 34 毫秒，说明桌面这一刻没跟上。')), grid, el('h3', '', L('devPerfByApp', '按应用程序')), shares);
    const stop = startSampling();
    sample(); refresh();
    tick(() => { sample(); refresh(); });
    cleanup(stop);
}
