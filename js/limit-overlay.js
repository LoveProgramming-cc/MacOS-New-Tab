(() => {
    if (globalThis.__macOSNewTabLimitOverlayInstalled) return;
    globalThis.__macOSNewTabLimitOverlayInstalled = true;

    const ROOT_ID = '__macos_newtab_limit_overlay__';
    const STORAGE_KEY = 'macOsDataV37';
    let cleanupActive = null;
    let mountPromise = null;
    let loadedFontSignature = '';
    let mountedPluginSignature = '';

    const copy = {
        'zh-CN': { title: '时间限额', subtitle: '你已达到今天的网页使用限额。', delay: '再使用 5 分钟', close: '好' },
        'en-US': { title: 'Time Limit', subtitle: "You've reached today's website limit.", delay: 'Use 5 More Minutes', close: 'OK' },
        'ja-JP': { title: '時間制限', subtitle: '今日のWebサイト使用制限に達しました。', delay: 'あと5分使用', close: 'OK' },
        'ko-KR': { title: '시간 제한', subtitle: '오늘의 웹사이트 사용 제한에 도달했습니다.', delay: '5분 더 사용', close: '확인' }
    };

    function pauseMedia() {
        document.querySelectorAll('video,audio').forEach((media) => { try { media.pause(); } catch {} });
    }
    function waitForDocumentRoot() {
        if (document.body) return Promise.resolve(document.body);
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                if (!document.body) return;
                observer.disconnect();
                resolve(document.body);
            });
            observer.observe(document.documentElement || document, { childList: true, subtree: true });
        });
    }
    function clamp(value, min, max, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    }
    function sanitizePluginCss(value) {
        return String(value || '').replace(/@import\s+[^;]+;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none').slice(0, 80000);
    }
    function pluginTextHash(value) {
        const text = String(value || '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }
    function sanitizePluginHtml(value) {
        const template = document.createElement('template');
        template.innerHTML = String(value || '').slice(0, 80000);
        template.content.querySelectorAll('script,iframe,object,embed,link,meta,style,base,form,foreignObject,use,animate,set,animateMotion,animateTransform').forEach((node) => node.remove());
        const urlAttributes = new Set(['src', 'href', 'xlink:href', 'srcset', 'poster', 'action', 'formaction', 'background', 'ping', 'data']);
        template.content.querySelectorAll('*').forEach((node) => {
            [...node.attributes].forEach((attr) => {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on')) node.removeAttribute(attr.name);
                else if (urlAttributes.has(name) && !/^data:image\/(?:png|jpeg|jpg|gif|webp);/i.test(attr.value.trim())) node.removeAttribute(attr.name);
                else if (name === 'style') node.setAttribute('style', sanitizePluginCss(attr.value));
            });
        });
        return template.innerHTML;
    }
    function validPlugin(plugin) {
        if (!plugin || plugin.kind !== 'limit-overlay' || !Array.isArray(plugin.actions) || !plugin.actions.includes('delay5')) return false;
        const html = plugin.overlay?.html || '';
        return /data-macos-action\s*=\s*["']delay5["']/i.test(html);
    }
    // The config stores large data: URLs under separate keys and keeps a short
    // "macos-blob:<hash>" reference (see config.js). Only the overlay image and font
    // are needed here, so only those two blobs are ever read into a web page.
    const BLOB_REF = /^macos-blob:([a-f0-9]{32})$/;
    function readStorage(keys) {
        return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));
    }
    async function resolveBlobs(values) {
        const keys = values.map((value) => (typeof value === 'string' && BLOB_REF.exec(value)?.[1]) || '').map((hash) => (hash ? `macOsBlobV1_${hash}` : ''));
        const wanted = keys.filter(Boolean);
        const table = wanted.length ? await readStorage(wanted) : {};
        return values.map((value, index) => (keys[index] ? (typeof table[keys[index]] === 'string' ? table[keys[index]] : '') : value));
    }
    async function storedOverlayConfig() {
        try {
            const data = await readStorage([STORAGE_KEY]);
            const cfg = data?.[STORAGE_KEY] || {};
            const screen = cfg?.widgets?.screenTime || {};
            const plugins = cfg?.plugins || {};
            const extrasDisabled = Boolean(cfg?.developer?.enabled && cfg?.developer?.disableExtraFeatures);
            const requested = plugins.activeLimitOverlay || 'builtin';
            const plugin = requested === 'builtin' ? null : (plugins.installed || []).find((item) => item?.id === requested);
            const [overlayImage, overlayFontData] = await resolveBlobs([screen.overlayImage, screen.overlayFontData]);
            return {
                language: cfg.language || 'en-US',
                message: typeof screen.overlayMessage === 'string' ? screen.overlayMessage.slice(0, 160) : '',
                image: typeof overlayImage === 'string' && overlayImage.startsWith('data:image/') ? overlayImage : '',
                imageMaxWidth: clamp(screen.overlayImageMaxWidth, 80, 900, 320),
                imageMaxHeight: clamp(screen.overlayImageMaxHeight, 60, 700, 220),
                textFontSize: clamp(screen.overlayTextFontSize, 10, 64, 20),
                textColor: /^#[0-9a-f]{6}$/i.test(screen.overlayTextColor || '') ? screen.overlayTextColor : '#1d1d1f',
                fontName: typeof screen.overlayFontName === 'string' ? screen.overlayFontName.slice(0, 80) : '',
                fontData: typeof overlayFontData === 'string' && overlayFontData.startsWith('data:') ? overlayFontData : '',
                plugin: !extrasDisabled && validPlugin(plugin) ? plugin : null
            };
        } catch {
            return { language: 'en-US', message: '', image: '', imageMaxWidth: 320, imageMaxHeight: 220, textFontSize: 20, textColor: '#1d1d1f', fontName: '', fontData: '', plugin: null };
        }
    }
    function dataUrlBytes(dataUrl) {
        try {
            const comma = dataUrl.indexOf(',');
            if (comma < 0) return null;
            const header = dataUrl.slice(0, comma);
            const body = dataUrl.slice(comma + 1);
            if (/;base64/i.test(header)) {
                const binary = atob(body);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return bytes.buffer;
            }
            return new TextEncoder().encode(decodeURIComponent(body)).buffer;
        } catch { return null; }
    }
    async function ensureCustomFont(data) {
        const source = data?.fontData;
        if (!source) return false;
        const signature = `${source.length}:${source.slice(0, 40)}:${source.slice(-32)}`;
        if (loadedFontSignature === signature) return true;
        const bytes = dataUrlBytes(source);
        if (!bytes || typeof FontFace !== 'function') return false;
        try {
            const face = new FontFace('MacLimitCustom', bytes);
            await face.load();
            document.fonts?.add(face);
            loadedFontSignature = signature;
            return true;
        } catch { return false; }
    }

    function removeOverlay() {
        cleanupActive?.();
        cleanupActive = null;
        document.getElementById(ROOT_ID)?.remove();
        mountPromise = null;
    }
    function sendDelay(host) {
        chrome.runtime.sendMessage({ type: 'delayScreenTimeLimitFromPage', host: host || location.hostname }, (response) => {
            if (response?.ok) removeOverlay();
        });
    }
    function fillRoles(root, data, strings) {
        const title = root.querySelector('[data-role="title"]');
        const subtitle = root.querySelector('[data-role="subtitle"]');
        const hostEl = root.querySelector('[data-role="host"]');
        const custom = root.querySelector('[data-role="custom-message"]');
        const image = root.querySelector('[data-role="custom-image"]');
        if (title) title.textContent = strings.title;
        if (subtitle) subtitle.textContent = strings.subtitle;
        if (hostEl) hostEl.textContent = data.host || location.hostname;
        if (custom) {
            custom.textContent = String(data.message || '').slice(0, 160);
            custom.hidden = !data.message;
        }
        if (image instanceof HTMLImageElement) {
            const valid = typeof data.image === 'string' && data.image.startsWith('data:image/');
            image.hidden = !valid;
            if (valid) image.src = data.image; else image.removeAttribute('src');
        }
    }
    function bindPluginActions(root, hostName) {
        root.querySelectorAll('[data-macos-action]').forEach((element) => {
            const action = element.getAttribute('data-macos-action');
            if (action === 'delay5') element.addEventListener('click', () => sendDelay(hostName));
            else if (action === 'dismiss') element.addEventListener('click', () => document.getElementById(ROOT_ID)?.focus({ preventScroll: true }));
        });
    }
    async function updateOverlay(host, data) {
        const shadow = host.shadowRoot;
        if (!shadow) return;
        const lang = data.language || 'en-US';
        const strings = copy[lang] || copy['en-US'];
        host.style.setProperty('--limit-image-max-width', `${clamp(data.imageMaxWidth, 80, 900, 320)}px`);
        host.style.setProperty('--limit-image-max-height', `${clamp(data.imageMaxHeight, 60, 700, 220)}px`);
        host.style.setProperty('--limit-message-size', `${clamp(data.textFontSize, 10, 64, 20)}px`);
        host.style.setProperty('--limit-message-color', data.textColor || '#1d1d1f');
        const hasCustomFont = await ensureCustomFont(data);
        host.style.setProperty('--limit-message-font', hasCustomFont ? 'MacLimitCustom' : '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif');

        const builtin = shadow.querySelector('[data-role="builtin-panel"]');
        const pluginRoot = shadow.querySelector('[data-role="plugin-root"]');
        const pluginStyle = shadow.querySelector('[data-role="plugin-style"]');
        const plugin = validPlugin(data.plugin) ? data.plugin : null;
        if (plugin && pluginRoot && pluginStyle) {
            builtin.hidden = true;
            pluginRoot.hidden = false;
            const rawHtml = plugin.overlay?.html || '';
            const rawCss = plugin.overlay?.css || '';
            // Heartbeats arrive every couple of seconds. Rebuilding the plugin subtree on
            // every heartbeat restarts CSS entrance animations forever and prevents later
            // keyframes from ever being reached. Mount only when the plugin package changes.
            const signature = `${plugin.id}|${plugin.version}|${pluginTextHash(rawHtml)}|${pluginTextHash(rawCss)}`;
            if (mountedPluginSignature !== signature || !pluginRoot.firstElementChild) {
                pluginRoot.replaceChildren();
                const template = document.createElement('template');
                template.innerHTML = sanitizePluginHtml(rawHtml);
                pluginRoot.appendChild(template.content.cloneNode(true));
                pluginStyle.textContent = sanitizePluginCss(rawCss);
                bindPluginActions(pluginRoot, data.host || location.hostname);
                mountedPluginSignature = signature;
            }
            fillRoles(pluginRoot, data, strings);
        } else {
            mountedPluginSignature = '';
            if (pluginRoot) { pluginRoot.hidden = true; pluginRoot.replaceChildren(); }
            if (pluginStyle) pluginStyle.textContent = '';
            if (builtin) {
                builtin.hidden = false;
                fillRoles(builtin, data, strings);
                const close = builtin.querySelector('[data-role="close"]');
                const delay = builtin.querySelector('[data-role="delay"]');
                if (close) close.textContent = strings.close;
                if (delay) delay.textContent = strings.delay;
            }
        }
    }

    async function createOverlay(data) {
        const mountRoot = await waitForDocumentRoot();
        let host = document.getElementById(ROOT_ID);
        if (host) return host;
        host = document.createElement('div');
        host.id = ROOT_ID;
        host.tabIndex = -1;
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:block!important;pointer-events:auto!important;isolation:isolate!important;contain:layout style paint!important;';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host{color-scheme:light dark;--limit-image-max-width:320px;--limit-image-max-height:220px;--limit-message-size:20px;--limit-message-color:#1d1d1f;--limit-message-font:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
                *,*::before,*::after{box-sizing:border-box}
                [hidden]{display:none!important}
                .veil{position:fixed;inset:0;width:100vw;height:100vh;display:grid;place-items:center;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color:rgba(22,22,24,.98);background:rgba(245,245,247,.94);-webkit-backdrop-filter:blur(64px) saturate(38%);backdrop-filter:blur(64px) saturate(38%);user-select:none;touch-action:none;overscroll-behavior:none}
                @media(prefers-color-scheme:dark){.veil{color:rgba(248,248,250,.98);background:rgba(18,18,20,.95)}}
                .panel{width:min(650px,calc(100vw - 48px));min-height:430px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:38px;border:1px solid rgba(128,128,132,.32);border-radius:16px;background:rgba(128,128,132,.08);box-shadow:0 30px 100px rgba(0,0,0,.22)}
                .hourglass{font-size:64px;line-height:1;opacity:.66}.title{font-size:34px;font-weight:750;margin-top:4px}.subtitle{font-size:18px;opacity:.82}.host{font-size:14px;opacity:.60;margin-top:1px}
                .custom-image{display:block;max-width:var(--limit-image-max-width);max-height:var(--limit-image-max-height);width:auto;height:auto;object-fit:contain;border-radius:10px;margin-top:12px;box-shadow:0 8px 28px rgba(0,0,0,.12)}
                .custom-message{font-size:var(--limit-message-size);line-height:1.38;max-width:min(560px,calc(100vw - 100px));margin-top:8px;white-space:pre-wrap;color:var(--limit-message-color);font-family:var(--limit-message-font);font-weight:650;text-wrap:balance}
                @media(prefers-color-scheme:dark){.custom-message{color:var(--limit-message-color)}}
                .actions{display:flex;flex-direction:column;gap:9px;width:210px;margin-top:26px}button{border:0;border-radius:8px;padding:11px 14px;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}.primary{background:#0a84ff;color:#fff}.secondary{background:rgba(128,128,132,.34);color:inherit}
                .plugin-root{position:absolute;inset:0;width:100%;height:100%;min-width:0;min-height:0;max-width:none;max-height:none;overflow:auto;display:block;contain:layout paint}
            </style>
            <style data-role="plugin-style"></style>
            <div class="veil">
                <div class="panel" data-role="builtin-panel">
                    <div class="hourglass">⌛</div><div class="title" data-role="title"></div><div class="subtitle" data-role="subtitle"></div><div class="host" data-role="host"></div>
                    <img class="custom-image" data-role="custom-image" alt="" hidden><div class="custom-message" data-role="custom-message" hidden></div>
                    <div class="actions"><button class="primary" data-role="close"></button><button class="secondary" data-role="delay"></button></div>
                </div>
                <div class="plugin-root" data-role="plugin-root" hidden></div>
            </div>`;
        mountRoot.appendChild(host);

        const oldHtmlOverflow = document.documentElement.style.overflow;
        const oldBodyOverflow = document.body?.style?.overflow || '';
        document.documentElement.style.setProperty('overflow', 'hidden', 'important');
        if (document.body) document.body.style.setProperty('overflow', 'hidden', 'important');
        const enforcePause = (event) => { const media = event.target; if (media instanceof HTMLMediaElement) { try { media.pause(); } catch {} } };
        const blockPageInput = (event) => {
            const activeHost = document.getElementById(ROOT_ID);
            if (!activeHost) return;
            if (event.composedPath?.().includes(activeHost)) return;
            event.preventDefault(); event.stopImmediatePropagation(); activeHost.focus({ preventScroll: true });
        };
        const blockScroll = (event) => { if (event.composedPath?.().includes(host)) return; event.preventDefault(); event.stopImmediatePropagation(); };
        const observer = new MutationObserver(() => pauseMedia());
        observer.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener('play', enforcePause, true);
        const blockedEvents = ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','contextmenu','keydown','keyup','keypress','input','change','submit'];
        blockedEvents.forEach((name) => document.addEventListener(name, blockPageInput, true));
        window.addEventListener('wheel', blockScroll, { capture: true, passive: false });
        window.addEventListener('touchmove', blockScroll, { capture: true, passive: false });
        shadow.querySelector('[data-role="close"]')?.addEventListener('click', () => host.focus({ preventScroll: true }));
        shadow.querySelector('[data-role="delay"]')?.addEventListener('click', () => sendDelay(data.host || location.hostname));
        cleanupActive = () => {
            observer.disconnect(); document.removeEventListener('play', enforcePause, true);
            blockedEvents.forEach((name) => document.removeEventListener(name, blockPageInput, true));
            window.removeEventListener('wheel', blockScroll, true); window.removeEventListener('touchmove', blockScroll, true);
            document.documentElement.style.overflow = oldHtmlOverflow; if (document.body) document.body.style.overflow = oldBodyOverflow;
        };
        return host;
    }

    async function showOverlay(data = {}) {
        pauseMedia();
        const stored = await storedOverlayConfig();
        const full = { ...stored, ...data, image: stored.image || data.image || '', message: data.message || stored.message || '', plugin: stored.plugin };
        if (!mountPromise) mountPromise = createOverlay(full).catch((error) => { mountPromise = null; console.debug('limit overlay mount failed', error); return null; });
        const host = await mountPromise;
        if (!host) return;
        await updateOverlay(host, full);
        host.focus({ preventScroll: true });
        pauseMedia();
    }

    function pageIsActivelyDisplayed() { return document.visibilityState === 'visible'; }
    let heartbeatTimer = null;
    let heartbeatBusy = false;
    let runtimeSuspended = false;
    function sendUsageHeartbeat() {
        if (runtimeSuspended || heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            chrome.runtime.sendMessage({ type: 'screenTimeHeartbeat', host: location.hostname, url: location.href, active: pageIsActivelyDisplayed() }, (response) => {
                heartbeatBusy = false;
                if (chrome.runtime.lastError) return;
                if (response?.disabled) { stopHeartbeats(); removeOverlay(); return; }
                if (response?.blocked) showOverlay(response.payload || { host: location.hostname }); else if (response?.hide) removeOverlay();
            });
        } catch { heartbeatBusy = false; }
    }
    function stopHeartbeats() { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; heartbeatBusy = false; }
    // Background tabs do not tick. The visibilitychange / blur / pagehide listeners
    // below still report the moment a tab stops being displayed.
    function heartbeatTick() { if (pageIsActivelyDisplayed()) sendUsageHeartbeat(); }
    function startHeartbeats() { runtimeSuspended = false; stopHeartbeats(); sendUsageHeartbeat(); heartbeatTimer = setInterval(heartbeatTick, 2000); }
    function suspendHeartbeats() { runtimeSuspended = true; stopHeartbeats(); removeOverlay(); }
    function syncStoredRuntimeState() {
        try {
            chrome.storage.local.get([STORAGE_KEY], (data) => {
                const dev = data?.[STORAGE_KEY]?.developer || {};
                if (dev.enabled && dev.disableExtraFeatures) suspendHeartbeats();
                else startHeartbeats();
            });
        } catch { startHeartbeats(); }
    }
    ['focus','blur','pageshow','pagehide'].forEach((name) => window.addEventListener(name, sendUsageHeartbeat, true));
    document.addEventListener('visibilitychange', sendUsageHeartbeat, true);
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
        if (area === 'local' && changes?.[STORAGE_KEY]) syncStoredRuntimeState();
    });
    syncStoredRuntimeState();

    globalThis.__macOsNewTabShowLimitOverlay = showOverlay;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'macOsScreenTimePing') { if (!runtimeSuspended) startHeartbeats(); sendResponse?.({ ok: true }); return; }
        if (message?.type === 'macOsScreenTimeSuspend') { suspendHeartbeats(); sendResponse?.({ ok: true }); return; }
        if (message?.type === 'showMacOsLimitOverlay') { showOverlay(message).then(() => sendResponse?.({ ok: true })).catch(() => sendResponse?.({ ok: false })); return true; }
        if (message?.type === 'hideMacOsLimitOverlay') { removeOverlay(); sendResponse?.({ ok: true }); }
    });
})();
