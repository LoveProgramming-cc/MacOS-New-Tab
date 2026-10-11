import { STORAGE_KEY } from './constants.js';

const params = new URLSearchParams(location.search);
const host = params.get('host') || '';
const back = params.get('back') || '';

const copy = {
    'zh-CN': {
        title: '今日使用限额已到',
        note: '你可以再使用 5 分钟，并且之后仍可再次延迟。',
        button: '再使用 5 分钟'
    },
    'en-US': {
        title: 'Daily limit reached',
        note: 'You can continue for 5 more minutes, and delay again later if needed.',
        button: 'Use 5 More Minutes'
    },
    'ja-JP': {
        title: '今日の使用制限に達しました',
        note: 'あと5分使用できます。必要なら、その後も何度でも5分延長できます。',
        button: 'あと5分使用'
    },
    'ko-KR': {
        title: '오늘의 사용 제한에 도달했습니다',
        note: '5분 더 사용할 수 있으며, 필요하면 그 뒤에도 다시 연장할 수 있습니다.',
        button: '5분 더 사용'
    }
};

chrome.storage.local.get([STORAGE_KEY], (data) => {
    const cfg = data?.[STORAGE_KEY] || {};
    const lang = cfg.language || 'zh-CN';
    const strings = copy[lang] || copy['zh-CN'];
    const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const hour = new Date().getHours();
    const dark = cfg.themeMode === 'dark' || (cfg.themeMode === 'system' && systemDark) || (cfg.themeMode === 'auto' && (hour >= 18 || hour < 6));
    document.body.classList.toggle('dark-mode', dark);
    document.body.classList.toggle('light-mode', !dark);
    document.documentElement.lang = lang;
    document.getElementById('limit-title').textContent = strings.title;
    document.getElementById('limit-note').textContent = strings.note;
    document.getElementById('limit-delay').textContent = strings.button;
});

document.getElementById('limit-host').textContent = host;
document.getElementById('limit-delay').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'delayScreenTimeLimit', host, back }, () => {});
});
