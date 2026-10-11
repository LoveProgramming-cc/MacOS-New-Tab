import { state } from './state.js';
import { t } from './i18n.js';
import { createElement } from './utils.js';
import { virtualNow } from './time.js';

export function renderCalendarContent(card, widget) {
    const now = virtualNow();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const locale = state.config.language || 'en-US';
    const monthLabel = now.toLocaleDateString(locale, { month: 'long' }).toUpperCase();
    const weekday = now.toLocaleDateString(locale, { weekday: 'long' }).toUpperCase();
    const weekLabels = [];
    for (let i = 0; i < 7; i += 1) {
        const d = new Date(2024, 0, 7 + i);
        weekLabels.push(d.toLocaleDateString(locale, { weekday: 'narrow' }));
    }
    const monthGrid = createElement('div', { className: 'calendar-month-grid' });
    monthGrid.appendChild(createElement('div', { className: 'calendar-month-label', text: monthLabel }));
    const weekdays = createElement('div', { className: 'calendar-weekdays' });
    weekLabels.forEach((label) => weekdays.appendChild(createElement('span', { text: label })));
    monthGrid.appendChild(weekdays);
    const dates = createElement('div', { className: 'calendar-dates' });
    for (let blank = 0; blank < first.getDay(); blank += 1) dates.appendChild(createElement('span', { className: 'empty' }));
    for (let day = 1; day <= days; day += 1) dates.appendChild(createElement('span', { className: day === today ? 'today' : '', text: String(day) }));
    monthGrid.appendChild(dates);

    if (widget.size === 'medium' || widget.variant === 'upNext') {
        const left = createElement('div', { className: 'calendar-upnext-date' });
        left.append(
            createElement('div', { className: 'calendar-weekday', text: weekday }),
            createElement('div', { className: 'calendar-day-number', text: String(today) }),
            createElement('div', { className: 'calendar-no-events', text: t('calendarNoEvents', '今天没有日程') })
        );
        const body = createElement('div', { className: 'calendar-medium-layout' });
        body.append(left, monthGrid);
        card.appendChild(body);
    } else {
        card.appendChild(monthGrid);
    }
}
