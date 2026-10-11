import { state } from './state.js';
import { createElement } from './utils.js';
import { virtualNow } from './time.js';

function timeParts(date, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour12: false,
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        }).formatToParts(date);
        return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    } catch {
        return { hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() };
    }
}

export function setAnalogClockHands(clock, date = virtualNow()) {
    if (!clock) return;
    const values = timeParts(date, clock.dataset.timezone || undefined);
    const sec = values.second || 0;
    const min = (values.minute || 0) + sec / 60;
    const hour = ((values.hour || 0) % 12) + min / 60;
    const hourHand = clock.querySelector('.hour-hand');
    const minuteHand = clock.querySelector('.minute-hand');
    const secondHand = clock.querySelector('.second-hand');
    if (hourHand) hourHand.style.transform = `translateX(-50%) rotate(${hour * 30}deg)`;
    if (minuteHand) minuteHand.style.transform = `translateX(-50%) rotate(${min * 6}deg)`;
    if (secondHand) secondHand.style.transform = `translateX(-50%) rotate(${sec * 6}deg)`;
}

export function makeAnalogClock(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    const wrap = createElement('div', { className: 'analog-clock', dataset: { timezone: timeZone } });
    for (let i = 0; i < 12; i += 1) {
        const tick = createElement('span', { className: 'clock-tick' });
        tick.style.transform = `rotate(${i * 30}deg)`;
        wrap.appendChild(tick);
    }
    wrap.append(
        createElement('div', { className: 'clock-hand hour-hand' }),
        createElement('div', { className: 'clock-hand minute-hand' }),
        createElement('div', { className: 'clock-hand second-hand' }),
        createElement('div', { className: 'clock-pin' })
    );
    setAnalogClockHands(wrap);
    return wrap;
}

function currentDigitalText() {
    return virtualNow().toLocaleTimeString(state.config.language || 'en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

function makeDigitalFace() {
    const face = createElement('div', { className: 'digital-clock-face' });
    const ticks = createElement('div', { className: 'digital-clock-ticks', attrs: { 'aria-hidden': 'true' } });
    // Twenty-eight short marks reproduce the dense perimeter treatment used by the
    // modern macOS digital clock widget without raster assets.
    for (let i = 0; i < 28; i += 1) {
        const tick = createElement('span', { className: 'digital-clock-tick' });
        tick.style.setProperty('--clock-tick-index', String(i));
        tick.style.setProperty('--clock-tick-angle', `${(360 / 28) * i}deg`);
        ticks.appendChild(tick);
    }
    const time = createElement('div', { className: 'widget-digital-time', dataset: { widgetDigital: '1' }, text: currentDigitalText() });
    const side = createElement('div', { className: 'digital-clock-side-label', attrs: { 'aria-hidden': 'true' } });
    side.append(createElement('span', { text: 'Current' }), createElement('span', { text: 'time' }));
    face.append(ticks, time, side);
    return face;
}

export function renderClockContent(card, widget) {
    if (widget.variant === 'digital') {
        card.appendChild(makeDigitalFace());
        return;
    }
    if (widget.variant === 'world') {
        const zones = [
            ['Cupertino', 'America/Los_Angeles'],
            ['Tokyo', 'Asia/Tokyo'],
            ['Sydney', 'Australia/Sydney'],
            ['Paris', 'Europe/Paris']
        ];
        const grid = createElement('div', { className: 'world-clock-grid' });
        zones.forEach(([label, zone]) => {
            const cell = createElement('div', { className: 'world-clock-cell' });
            cell.append(makeAnalogClock(zone), createElement('div', { className: 'world-clock-label', text: label }));
            grid.appendChild(cell);
        });
        card.appendChild(grid);
        return;
    }
    card.appendChild(makeAnalogClock());
}

export function updateClockWidgets() {
    const now = virtualNow();
    const text = now.toLocaleTimeString(state.config.language || 'en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false
    });
    document.querySelectorAll('[data-widget-digital="1"]').forEach((el) => { el.textContent = text; });
    document.querySelectorAll('.analog-clock').forEach((clock) => setAnalogClockHands(clock, now));
}
