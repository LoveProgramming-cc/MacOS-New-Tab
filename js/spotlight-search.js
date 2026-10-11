import { state } from './state.js';
import { ENGINES } from './constants.js';
import { getAppName, t } from './i18n.js';
import { $, createElement } from './utils.js';
import { createAppIcon } from './icons.js';
import { extraFeaturesDisabled, launcherAvailable } from './developer.js';
import { applicationSearchIndex, openApplicationSearchResult } from './plugin-system.js';

// Spotlight results. Typing in Spotlight still searches the web when Return is pressed:
// the first row is always that web search and is the one selected. Below it Spotlight
// lists what matches on this desktop —
//
//   applications     launchers from Launchpad, the Dock, the desktop and Spotlight itself
//   in applications  what installed applications listed with macos.search.setItems
//   settings         pages of System Settings
//
// — reachable with the arrow keys or a click. System Settings ▸ Spotlight switches the
// first two off.

const PER_APP = 5;
const fold = (value) => String(value || '').toLocaleLowerCase().normalize('NFKC');
let rows = [];          // what is on screen: { run() }
let selected = 0;
let hooks = { performAppAction: () => {}, openSettingsTab: () => {} };
let generation = 0;

function launcherMatches(query) {
    if (state.config.spotlight?.apps === false) return [];
    const seen = new Set(); const found = [];
    for (const key of ['launchpadApps', 'dockApps', 'desktopApps', 'quickLinks']) {
        for (const app of state.config[key] || []) {
            if (!app) continue;
            if (!launcherAvailable(app)) continue;
            const identity = app.action || app.url || app.name;
            const name = getAppName(app);
            if (seen.has(identity) || !fold(name).includes(query)) continue;
            seen.add(identity);
            found.push({ app, name, starts: fold(name).startsWith(query) });
        }
    }
    return found.sort((a, b) => Number(b.starts) - Number(a.starts)).slice(0, 6);
}
function settingsMatches(query) {
    return [...document.querySelectorAll('.settings-sidebar .tab')]
        .filter((tab) => tab.style.display !== 'none' && !(tab.hasAttribute('data-extra-feature') && extraFeaturesDisabled(state.config)) && fold(tab.textContent).includes(query))
        .slice(0, 3).map((tab) => ({ id: tab.dataset.target, name: tab.textContent.trim() }));
}
function contentMatches(index, query) {
    if (state.config.spotlight?.appContent === false) return [];
    const groups = [];
    for (const { plugin, items } of index) {
        const hits = [];
        for (const item of items) {
            const title = fold(item.title);
            const rank = title.startsWith(query) ? 0 : title.includes(query) ? 1 : fold(item.subtitle).includes(query) ? 2 : fold(item.keywords).includes(query) ? 3 : -1;
            if (rank >= 0) hits.push({ item, rank });
        }
        if (hits.length) groups.push({ plugin, hits: hits.sort((a, b) => a.rank - b.rank).slice(0, PER_APP).map((hit) => hit.item), total: hits.length });
    }
    return groups;
}

function close() {
    const input = $('search-input');
    if (input) input.value = '';
    $('spotlight')?.classList.add('hidden');
    render();
}
function row({ icon, title, subtitle = '', kind = '', run }) {
    const node = createElement('div', { className: 'spotlight-result', attrs: { role: 'option' } });
    const art = createElement('span', { className: 'spotlight-result-icon' });
    if (icon) art.appendChild(icon);
    const text = createElement('span', { className: 'spotlight-result-text' });
    text.appendChild(createElement('span', { className: 'spotlight-result-title', text: title }));
    if (subtitle) text.appendChild(createElement('span', { className: 'spotlight-result-subtitle', text: subtitle }));
    node.append(art, text);
    if (kind) node.appendChild(createElement('span', { className: 'spotlight-result-kind', text: kind }));
    const index = rows.length;
    node.addEventListener('pointermove', () => select(index));
    node.addEventListener('click', (event) => { event.stopPropagation(); run(); });
    rows.push({ node, run });
    return node;
}
const glyph = (text) => createElement('span', { className: 'spotlight-result-glyph', text });
const image = (source) => (source ? createElement('img', { attrs: { src: source, alt: '' } }) : glyph('◫'));

function select(index) {
    selected = Math.max(0, Math.min(rows.length - 1, index));
    rows.forEach((entry, at) => entry.node.classList.toggle('selected', at === selected));
    const node = rows[selected]?.node; const host = $('spotlight-results');
    if (!node || !host) return;
    const box = host.getBoundingClientRect(); const at = node.getBoundingClientRect();
    if (at.bottom > box.bottom) host.scrollTop += at.bottom - box.bottom; else if (at.top < box.top) host.scrollTop -= box.top - at.top;
}

function draw(query, raw, index) {
    const host = $('spotlight-results');
    rows = [];
    const nodes = [];
    const section = (label) => nodes.push(createElement('div', { className: 'spotlight-section', text: label }));
    const engineKey = state.spotlightEngine || state.config.searchEngine || 'google';
    const engineName = ({ google: 'Google', bing: 'Bing', duck: 'DuckDuckGo', chatgpt: 'ChatGPT' })[engineKey] || engineKey;
    // The web search is what Return does, exactly as before.
    nodes.push(row({ icon: glyph('⌕'), title: raw, kind: t('spotlightSearchWith', '用 {engine} 搜索').replace('{engine}', Object.hasOwn(ENGINES, engineKey) ? engineName : 'Google'), run: () => $('search-form')?.requestSubmit() }));

    const launchers = launcherMatches(query);
    if (launchers.length) {
        section(t('tabApplications', '应用程序'));
        for (const { app, name } of launchers) {
            const icon = createElement('span', { className: 'spotlight-app-icon' });
            icon.appendChild(createAppIcon(app, { location: 'spotlight' }));
            nodes.push(row({ icon, title: name, kind: app.url && !app.action ? t('spotlightKindLink', '链接') : t('spotlightKindApp', '应用程序'), run: () => { close(); hooks.performAppAction(app); } }));
        }
    }
    for (const { plugin, hits, total } of contentMatches(index, query)) {
        section(total > hits.length ? `${plugin.name} · ${total}` : plugin.name);
        for (const item of hits) nodes.push(row({ icon: image(plugin.icon), title: item.title, subtitle: item.subtitle, run: () => { close(); openApplicationSearchResult(plugin.id, item.id, raw); } }));
    }
    const pages = settingsMatches(query);
    if (pages.length) {
        section(t('appSystemSettings', '系统设置'));
        for (const page of pages) nodes.push(row({ icon: image('assets/icons/系统设置.svg'), title: page.name, kind: t('appSystemSettings', '系统设置'), run: () => { close(); hooks.openSettingsTab(page.id); } }));
    }
    host.replaceChildren(...nodes);
    select(Math.min(selected, rows.length - 1));
}

function render() {
    const host = $('spotlight-results'); const input = $('search-input');
    if (!host || !input) return;
    const raw = input.value.trim(); const query = fold(raw);
    const turn = (generation += 1);
    $('spotlight')?.classList.toggle('spotlight-searching', Boolean(query));
    host.classList.toggle('hidden', !query);
    if (!query) { rows = []; selected = 0; host.replaceChildren(); return; }
    selected = 0;
    // Launchers and settings are at hand; what applications listed arrives a moment later.
    draw(query, raw, []);
    applicationSearchIndex().then((index) => { if (turn === generation) draw(query, raw, index); }).catch(() => {});
}

export function bindSpotlightSearch(callbacks = {}) {
    hooks = { ...hooks, ...callbacks };
    const input = $('search-input');
    if (!input || !$('spotlight-results')) return;
    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
        if (!rows.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); select(selected + (event.key === 'ArrowDown' ? 1 : -1)); }
        // Return on anything but the web search row opens that result instead.
        else if (event.key === 'Enter' && selected > 0 && !event.isComposing) { event.preventDefault(); rows[selected].run(); }
    });
    window.addEventListener('macos-language-change', render);
}
