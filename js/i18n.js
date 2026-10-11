import { state } from './state.js';
import { $ } from './utils.js';

const FALLBACK_LANGUAGE = 'zh-CN';

// Chrome extensions cannot enumerate their packaged directory at runtime. Probing a
// broad set of standard BCP-47 file names gives the user the intended workflow:
// translate zh-CN.json, name it e.g. fr-FR.json, drop it in ./locales, reload.
const DISCOVERABLE_LOCALES = [
    'af-ZA','am-ET','ar-SA','bg-BG','bn-BD','ca-ES','cs-CZ','da-DK','de-DE','el-GR',
    'en-US','en-GB','en-AU','es-ES','es-MX','et-EE','fa-IR','fi-FI','fil-PH','fr-FR','fr-CA',
    'he-IL','hi-IN','hr-HR','hu-HU','id-ID','is-IS','it-IT','ja-JP','ko-KR','lt-LT','lv-LV',
    'ms-MY','nb-NO','nl-NL','pl-PL','pt-BR','pt-PT','ro-RO','ru-RU','sk-SK','sl-SI','sr-RS',
    'sv-SE','sw-KE','ta-IN','te-IN','th-TH','tr-TR','uk-UA','ur-PK','vi-VN','zh-CN','zh-TW','zh-HK'
];

// Layout direction. Arabic, Hebrew, Persian and Urdu are written right to left, and the
// whole interface is mirrored for them. Developer ▸ "Force right-to-left layout" mirrors
// it for any language (the text itself stays as it is), to check a layout without
// knowing the language.
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);
export const languageIsRTL = (language) => RTL_LANGUAGES.has(String(language || '').split('-')[0].toLowerCase());
export const layoutDirection = (config = state.config) => (languageIsRTL(config?.language) || (config?.developer?.enabled && config.developer.forceRTL) ? 'rtl' : 'ltr');
/** Puts the direction on the document; tells the desktop and the applications when it changed. */
export function applyLayoutDirection() {
    const direction = layoutDirection();
    const root = document.documentElement;
    if ((root.getAttribute('dir') || 'ltr') === direction) return direction;
    root.setAttribute('dir', direction);
    try { window.dispatchEvent(new CustomEvent('macos-direction-change', { detail: { direction } })); } catch { /* no-op */ }
    return direction;
}

async function fetchJson(path, fallback) {
    try {
        const response = await fetch(chrome.runtime.getURL(path));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch {
        return fallback;
    }
}

function selfLanguageName(code) {
    try {
        const language = code.split('-')[0];
        return new Intl.DisplayNames([code], { type: 'language' }).of(language) || code;
    } catch { return code; }
}

export async function loadLocaleCatalog() {
    const index = await fetchJson('locales/index.json', []);
    const indexed = new Map((Array.isArray(index) ? index : [])
        .filter((item) => item && typeof item.code === 'string')
        .map((item) => [item.code, item]));
    // When locales/index.json lists the packaged languages it is authoritative: no
    // locale file is downloaded just to build the menu. Probing the long list of
    // candidate file names (dozens of failing requests on every new tab) is only the
    // fallback for a build that ships without an index.
    if (indexed.size) {
        state.localeCatalog = [...indexed.values()].map((item) => ({ code: item.code, label: typeof item.label === 'string' && item.label ? item.label : selfLanguageName(item.code) }));
        return state.localeCatalog;
    }
    const candidates = [...new Set(DISCOVERABLE_LOCALES)];
    const found = await Promise.all(candidates.map(async (code) => {
        const data = await fetchJson(`locales/${code}.json`, null);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        const indexedLabel = indexed.get(code)?.label;
        const metadataLabel = typeof data.__localeName === 'string' ? data.__localeName : (typeof data.localeName === 'string' ? data.localeName : '');
        return { code, label: indexedLabel || metadataLabel || selfLanguageName(code) };
    }));
    state.localeCatalog = found.filter(Boolean).sort((a, b) => {
        if (a.code === FALLBACK_LANGUAGE) return -1;
        if (b.code === FALLBACK_LANGUAGE) return 1;
        return a.label.localeCompare(b.label, a.code, { sensitivity: 'base' });
    });
    if (!state.localeCatalog.length) state.localeCatalog = [{ code: FALLBACK_LANGUAGE, label: '简体中文' }];
    return state.localeCatalog;
}

function localeExists(lang) {
    return state.localeCatalog.some((item) => item.code === lang);
}

async function fetchLocale(lang) {
    const data = await fetchJson(`locales/${lang}.json`, null);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    if (lang !== FALLBACK_LANGUAGE) return fetchLocale(FALLBACK_LANGUAGE);
    return {};
}

export async function loadLanguage(lang) {
    // First paint must not wait for optional-locale discovery. Load the configured
    // BCP-47 file directly; fetchLocale falls back to zh-CN if it does not exist.
    const requested = (typeof lang === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang)) ? lang : FALLBACK_LANGUAGE;
    const direct = await fetchJson(`locales/${requested}.json`, null);
    const effective = direct && typeof direct === 'object' && !Array.isArray(direct) ? requested : FALLBACK_LANGUAGE;
    state.translations = direct && typeof direct === 'object' && !Array.isArray(direct) ? direct : await fetchLocale(FALLBACK_LANGUAGE);
    document.documentElement.lang = effective;
    if (state.config) state.config.language = effective;
    applyLayoutDirection();
    return state.translations;
}

export function t(key, fallback = '') {
    const value = state.translations?.[key];
    return typeof value === 'string' ? value : (fallback || key);
}

export function getAppName(app) {
    if (!app) return '';
    if (app.nameKey) return t(app.nameKey, app.name || app.enName || '');
    if (state.config?.language === 'en-US' && app.enName) return app.enName;
    return app.name || '';
}

export function syncLanguageOptions() {
    const select = $('lang-select');
    if (!select || !state.localeCatalog.length) return;
    select.dataset.options = JSON.stringify(state.localeCatalog.map(({ code, label }) => ({ value: code, label })));
}

export function applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.dataset.i18n;
        if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search')) {
            el.placeholder = t(key, el.placeholder);
            return;
        }
        if (el.children.length === 0) el.textContent = t(key, el.textContent);
    });

    const version = $('about-os-version');
    if (version && state.config?.aboutMac) version.textContent = `${t('version', '版本')} ${state.config.aboutMac.osVersion}`;
    syncLanguageOptions();
    document.querySelectorAll('.mac-custom-select').forEach(updateCustomSelectLabel);
}

export function updateCustomSelectLabel(selectEl) {
    if (!selectEl) return;
    try {
        const options = JSON.parse(selectEl.dataset.options || '[]');
        const active = options.find((item) => item.value === selectEl.dataset.value);
        if (!active) return;
        const label = active.labelKey ? t(active.labelKey, active.label || active.value) : (active.label || active.value);
        const target = selectEl.querySelector('.selected-text');
        if (target) target.textContent = label;
    } catch {}
}
