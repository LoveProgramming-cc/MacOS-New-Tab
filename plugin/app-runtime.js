(() => {
    'use strict';
    const CHANNEL_HOST = 'macos-plugin-host-v055';
    const CHANNEL_APP = 'macos-plugin-app-v055';
    let instanceId = '';
    let token = '';
    let initialized = false;
    let crashed = false;
    let hostDragging = false;
    let hostVisible = true;
    let hostPort = null;
    let appLocales = {};
    const nativeSetInterval = globalThis.setInterval.bind(globalThis);
    const nativeClearInterval = globalThis.clearInterval.bind(globalThis);
    let nextRequestId = 1;
    const pending = new Map();
    const listeners = new Map();
    const root = document.getElementById('app-root');
    const errorBox = document.getElementById('runtime-error');

    function post(type, payload = {}) {
        const message = { channel: CHANNEL_APP, instanceId, token, type, ...payload };
        if (hostPort) hostPort.postMessage(message);
        else parent.postMessage(message, '*');
    }
    // timeout 0 = wait indefinitely (dialogs and file pickers wait for the user).
    function request(method, payload = {}, timeout = 15000) {
        if (crashed) return Promise.reject(new Error('Application runtime has crashed'));
        return new Promise((resolve, reject) => {
            const requestId = String(nextRequestId++);
            pending.set(requestId, { resolve, reject });
            post('request', { requestId, method, payload });
            if (timeout > 0) setTimeout(() => {
                const entry = pending.get(requestId); if (!entry) return;
                pending.delete(requestId); entry.reject(new Error(`Plugin API timeout: ${method}`));
            }, timeout);
        });
    }
    function emit(name, detail) {
        (listeners.get(name) || []).slice().forEach((fn) => { try { fn(detail); } catch (error) { reportCrash(error); } });
    }
    function on(name, fn) {
        if (typeof fn !== 'function') return () => {};
        const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list);
        // The host only takes pasted files in for an application that listens for them.
        if (name === 'paste' && list.length === 1) request('events.listen', { name }).catch(() => {});
        return () => listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== fn));
    }
    function reportCrash(error) {
        if (crashed) return;
        crashed = true;
        const message = error?.stack || error?.message || String(error || 'Unknown plugin error');
        if (errorBox) { errorBox.textContent = message; errorBox.style.display = 'grid'; }
        post('crash', { message: String(message).slice(0, 8000) });
    }
    window.addEventListener('error', (event) => { reportCrash(event.error || event.message); event.preventDefault(); });
    window.addEventListener('unhandledrejection', (event) => { reportCrash(event.reason); event.preventDefault(); });

    const assetPaths = new Set();
    const assetUrls = new Map();
    function prepareAssets(assets) {
        assetPaths.clear(); assetUrls.clear();
        (Array.isArray(assets) ? assets : Object.keys(assets || {})).forEach((path) => assetPaths.add(String(path || '')));
    }
    async function assetUrl(path) {
        const key = String(path || '').replace(/^\.\//, '');
        if (!assetPaths.has(key)) return '';
        if (assetUrls.has(key)) return assetUrls.get(key) || '';
        const url = await request('asset.get', { path: key });
        assetUrls.set(key, String(url || ''));
        return assetUrls.get(key) || '';
    }
    async function replaceAssetMarkers(text) {
        let result = String(text || '');
        const refs = [...new Set([...result.matchAll(/macos-asset:\/\/([^"')\s]+)/g)].map((match) => decodeURIComponent(match[1])))];
        const values = new Map();
        await Promise.all(refs.map(async (path) => values.set(path, await assetUrl(path))));
        return result.replace(/macos-asset:\/\/([^"')\s]+)/g, (_m, encoded) => values.get(decodeURIComponent(encoded)) || 'about:blank');
    }
    async function rewriteDomAssets(scope) {
        const work = [];
        scope.querySelectorAll?.('[src],[href],[poster]').forEach((el) => {
            for (const name of ['src','href','poster']) {
                const value = el.getAttribute(name); if (!value?.startsWith('macos-asset://')) continue;
                const path = decodeURIComponent(value.slice('macos-asset://'.length));
                work.push(assetUrl(path).then((url) => { if (url) el.setAttribute(name, url); else el.removeAttribute(name); }));
            }
        });
        await Promise.all(work);
    }
    function applyContext(context = {}) {
        const theme = context.theme === 'dark' ? 'dark' : 'light';
        const language = String(context.language || 'en-US');
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.systemTheme = context.systemTheme === 'dark' ? 'dark' : 'light';
        document.documentElement.lang = language;
        if (context.direction) document.documentElement.dir = context.direction === 'rtl' ? 'rtl' : 'ltr';
    }
    function installStrictRuntimeGuards() {
        const denied = (name) => () => { throw new Error(`${name} is disabled by strict plugin security. Request the matching macos API permission instead.`); };
        try { Object.defineProperty(globalThis, 'fetch', { value: denied('fetch'), configurable: false, writable: false }); } catch {}
        try { Object.defineProperty(globalThis, 'XMLHttpRequest', { value: class { constructor(){ throw new Error('XMLHttpRequest is disabled by strict plugin security. Use macos.fetch().'); } }, configurable:false }); } catch {}
        try { Object.defineProperty(globalThis, 'WebSocket', { value: class { constructor(){ throw new Error('WebSocket is disabled by strict plugin security.'); } }, configurable:false }); } catch {}
        try { Object.defineProperty(globalThis, 'EventSource', { value: class { constructor(){ throw new Error('EventSource is disabled by strict plugin security.'); } }, configurable:false }); } catch {}
        try { Object.defineProperty(globalThis, 'SharedWorker', { value: class { constructor(){ throw new Error('SharedWorker is disabled by strict plugin security.'); } }, configurable:false }); } catch {}
        try { window.open = denied('window.open'); } catch {}
        // Clamp runaway polling loops. Intervals below one display frame provide no
        // useful desktop UI benefit and can starve the host compositor.
        const activeIntervals = new Set();
        try {
            globalThis.setInterval = (callback, delay = 0, ...args) => {
                if (activeIntervals.size >= 64) throw new Error('Strict plugin security allows at most 64 active intervals.');
                const wait = Math.max(16, Number(delay) || 0);
                let id = 0;
                const wrapped = (...inner) => { if (!hostDragging && hostVisible) callback(...inner); };
                id = nativeSetInterval(wrapped, wait, ...args);
                activeIntervals.add(id);
                return id;
            };
            globalThis.clearInterval = (id) => { activeIntervals.delete(id); return nativeClearInterval(id); };
        } catch {}
    }
    function localeDictionary() {
        const lang = String(document.documentElement.lang || 'en-US');
        return appLocales?.[lang] || appLocales?.[lang.split('-')[0]] || appLocales?.['en-US'] || appLocales?.en || Object.values(appLocales || {})[0] || {};
    }
    function translate(key, fallback = '') {
        const dict = localeDictionary();
        return String(dict?.[String(key || '')] ?? fallback ?? key ?? '');
    }
    // ui.patch calls made in the same tick travel to the host as one batch: one message
    // and one unit of the host's rate limit, however many controls change.
    let patchQueue = null;
    function queuePatch(id, props) {
        if (!patchQueue) {
            const queue = { patches: [], promise: null };
            patchQueue = queue;
            queue.promise = Promise.resolve().then(() => { patchQueue = null; return request('ui.batch', { patches: queue.patches }); });
        }
        patchQueue.patches.push({ id, props });
        return patchQueue.promise;
    }
    // A drag of the window by its own content. The pointer stays captured by the element that
    // was pressed, so the travel keeps arriving here wherever the pointer goes; the host moves
    // the window by it, at most once a frame. Resolves with the final frame.
    // Should this document lose the pointer all the same (released over the desktop before the
    // capture took hold), the host sees the release, ends the drag and says so ('drag-end');
    // and a move that arrives with no button down means the release was missed.
    // The frame carries velocity { x, y }: how fast the pointer was going when it let go (px/s).
    let endDragFromHost = null;
    function beginDrag(event) {
        if (!event || typeof event.screenX !== 'number' || event.type !== 'pointerdown') return Promise.reject(new Error('beginDrag needs the pointerdown event'));
        const target = event.target; const pointerId = event.pointerId;
        try { target?.setPointerCapture?.(pointerId); } catch { /* the drag still follows inside the window */ }
        const startX = event.screenX; const startY = event.screenY;
        let last = { dx: 0, dy: 0 }; let frame = 0; let ended = false;
        const samples = [{ x: startX, y: startY, t: performance.now() }];
        const velocity = () => {
            const now = performance.now(); const recent = samples.filter((sample) => now - sample.t < 110);
            if (recent.length < 2) return { x: 0, y: 0 };
            const a = recent[0]; const b = recent[recent.length - 1]; const dt = Math.max(0.012, (b.t - a.t) / 1000);
            return { x: Math.round((b.x - a.x) / dt), y: Math.round((b.y - a.y) / dt) };
        };
        // The host may have seen a part of the way that this document did not: the faster of the two.
        const faster = (a, b) => (b && Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a);
        endDragFromHost?.(null);
        const started = request('window.drag', { phase: 'start', screenX: startX, screenY: startY });
        return new Promise((resolve, reject) => {
            const stop = () => {
                ended = true; cancelAnimationFrame(frame);
                window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
                try { target?.releasePointerCapture?.(pointerId); } catch { /* released already */ }
                if (endDragFromHost === fromHost) endDragFromHost = null;
            };
            const finish = () => {
                stop();
                const speed = velocity();
                // The host answers null when the drag was already over (another one took it over).
                started.then(() => request('window.drag', { phase: 'end', ...last }))
                    .then((frame) => frame || request('window.getFrame').then((now) => ({ ...now, clamped: false })))
                    .then((frame) => resolve({ ...frame, velocity: faster(speed, frame.velocity) }), reject);
            };
            const move = (moveEvent) => {
                if (moveEvent.pointerId !== pointerId || ended) return;
                if (!(moveEvent.buttons & 1)) { finish(); return; }
                last = { dx: moveEvent.screenX - startX, dy: moveEvent.screenY - startY };
                samples.push({ x: moveEvent.screenX, y: moveEvent.screenY, t: performance.now() }); if (samples.length > 12) samples.shift();
                if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!ended) started.then(() => request('window.drag', { phase: 'move', ...last })).catch(() => {}); });
            };
            const end = (endEvent) => {
                if (endEvent.pointerId !== pointerId || ended) return;
                if (endEvent.type === 'pointerup') last = { dx: endEvent.screenX - startX, dy: endEvent.screenY - startY };
                finish();
            };
            const fromHost = (frame) => {
                if (ended) return;
                stop();
                if (frame) resolve({ ...frame, velocity: faster(velocity(), frame.velocity) }); else request('window.getFrame').then((now) => resolve({ ...now, clamped: false, velocity: { x: 0, y: 0 } }), reject);
            };
            endDragFromHost = fromHost;
            window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
            started.catch((error) => { if (!ended) stop(); reject(error); });
        });
    }
    // setHitRegion: the host switches this document's frame on when the pointer enters one of
    // the rectangles; from then on only this document sees the pointer, so it reports when the
    // pointer has left them all (never in the middle of a press: that may be a drag).
    let hitRects = null; let hitInside = false; let lastPoint = null;
    const inHitRects = (point) => Boolean(point && hitRects && hitRects.some(([x, y, w, h]) => point.x >= x && point.y >= y && point.x < x + w && point.y < y + h));
    function watchHit(event) {
        lastPoint = { x: event.clientX, y: event.clientY };
        if (!hitRects || event.buttons) return;
        const inside = inHitRects(lastPoint);
        if (inside) hitInside = true;
        else if (hitInside !== false || event.type === 'pointerdown') { hitInside = false; request('window.hitLeave').catch(() => {}); }
    }
    window.addEventListener('pointermove', watchHit, true);
    window.addEventListener('pointerup', (event) => { if (hitRects && !inHitRects({ x: event.clientX, y: event.clientY })) { hitInside = false; request('window.hitLeave').catch(() => {}); } }, true);
    function setHitRegion(rects = null) {
        hitRects = Array.isArray(rects) ? rects.map((rect) => rect.map(Number)) : null;
        hitInside = inHitRects(lastPoint);
        return request('window.setHitRegion', { rects: hitRects, inside: hitInside });
    }
    function api(context) {
        const storage = {
            get: (key = null) => request('storage.get', { key }),
            set: (key, value) => request('storage.set', { key, value }),
            remove: (key) => request('storage.remove', { key }),
            clear: () => request('storage.clear')
        };
        return Object.freeze({
            version: 13,
            context: Object.freeze({ ...(context || {}) }),
            storage,
            fetch: (url, options = {}) => request('network.fetch', { url, options }),
            openExternal: (url) => request('openExternal', { url }),
            // A link to another application ('music://song/…', see urlSchemes in the manifest) or a web page.
            openURL: (url) => request('openURL', { url }),
            // The other windows of this application.
            instances: Object.freeze({
                list: () => request('instances.list'), broadcast: (message) => request('instances.broadcast', { message }),
                // A further window of this application, where the user allowed that: false when not.
                canOpen: () => request('instances.canOpen'), open: () => request('instances.open')
            }),
            clipboard: Object.freeze({ writeText: (text) => request('clipboard.writeText', { text }), readText: () => request('clipboard.readText', {}, 0) }),
            window: Object.freeze({
                setTitle: (title) => request('window.setTitle', { title }),
                resize: (width, height) => request('window.resize', { width, height }),
                close: () => request('window.close'),
                minimize: () => request('window.minimize'),
                getBounds: () => request('window.getBounds'),
                center: () => request('window.center'),
                focus: () => request('window.focus'),
                // Named accent ('red', 'purple', …) or '#rrggbb'; null restores the manifest accent.
                setAccentColor: (color = null) => request('window.setAccentColor', { color }),
                setAppearance: (appearance = 'system') => request('window.setAppearance', { appearance }),
                // Where the window is, and the desktop around it: { x, y, width, height, screen }.
                getFrame: () => request('window.getFrame'),
                // Moves the window (kept on the desktop); with duration (ms) it glides there.
                moveTo: (x, y, options = {}) => request('window.moveTo', { x, y, duration: options.duration, easing: options.easing }, 0),
                // Lets the user drag the window by whatever was pressed: call it from a pointerdown.
                beginDrag,
                // 'pointerposition' events while on (permission: pointer).
                trackPointer: (on = true) => request('window.trackPointer', { on }),
                // Frameless windows: the rectangles [x, y, width, height] it really covers; clicks
                // anywhere else fall through to what is underneath. null: the whole window again.
                setShape: (rects = null) => request('window.setShape', { rects }),
                // Frameless Web Apps: where the window takes the pointer ([x, y, width, height]
                // rectangles). The whole window is still drawn; clicks elsewhere go to what is
                // underneath. null: the whole window takes the pointer again.
                setHitRegion,
                // 'desktop' (behind every window) | 'normal' | 'floating' (over every window).
                setLevel: (level = 'normal') => request('window.setLevel', { level }),
                // Travel with another window (an id from macos.desktop, or 'dock'), keeping this
                // place relative to its top or bottom edge. attach(null) lets go. Permission: windows.
                attach: (id = null, options = {}) => request('window.attach', { id, edge: options.edge })
            }),
            // Where the Dock and the windows on the desktop are (permission: windows).
            // watch() also sends 'desktopchange' with the same layout whenever it changes.
            desktop: Object.freeze({
                getLayout: () => request('desktop.getLayout'),
                watch: (on = true) => request('desktop.watch', { on })
            }),
            // Applications that name each other under "peers" in their manifests can talk:
            // send() resolves false when the other one is not running; it arrives as 'message'.
            apps: Object.freeze({
                send: (to, message) => request('apps.send', { to, message }),
                peers: () => request('apps.peers')
            }),
            dialog: Object.freeze({
                alert: (message, options = {}) => request('dialog.alert', { ...options, message }, 0),
                confirm: (message, options = {}) => request('dialog.confirm', { ...options, message }, 0),
                prompt: (message, options = {}) => request('dialog.prompt', { ...options, message }, 0),
                openFile: (options = {}) => request('dialog.openFile', options, 0),
                saveFile: (options = {}) => request('dialog.saveFile', options)
            }),
            files: Object.freeze({
                put: (options = {}) => request('files.put', options, 60000),
                list: () => request('files.list'),
                info: (id) => request('files.info', { id }),
                read: (id, options = {}) => request('files.read', { ...options, id }, 60000),
                remove: (id) => request('files.remove', { id }),
                export: (id, name = '') => request('files.export', { id, name }),
                usage: () => request('files.usage'),
                clear: () => request('files.clear')
            }),
            // Declared permissions the user switched off: see them, and ask for them back.
            permissions: Object.freeze({
                status: () => request('permissions.status'),
                request: (names) => request('permissions.request', { names: Array.isArray(names) ? names : [names] }, 0)
            }),
            // Widgets declared in the manifest: what each one shows (a UI tree, or one per size).
            widgets: Object.freeze({
                set: (id, content) => request('widgets.set', { id, content }),
                clear: (id = null) => request('widgets.clear', { id }),
                list: () => request('widgets.list')
            }),
            archive: Object.freeze({
                create: (options = {}) => request('archive.create', options, 0),
                extract: (fileId, options = {}) => request('archive.extract', { ...options, fileId }, 0)
            }),
            audio: Object.freeze({
                load: (fileId, options = {}) => request('audio.load', { ...options, fileId }, 30000),
                play: (options = {}) => request('audio.play', options),       // { fade: seconds }
                pause: (options = {}) => request('audio.pause', options),     // { fade: seconds }
                stop: () => request('audio.stop'),
                seek: (time) => request('audio.seek', { time }),
                setVolume: (volume) => request('audio.setVolume', { volume }),
                setMetadata: (metadata = {}) => request('audio.setMetadata', metadata),
                // Subtitle tracks of the loaded video: show one (index into state().subtitles, -1 for none), or add a stored .srt / .vtt / .ass file.
                setSubtitle: (index) => request('audio.setSubtitle', { index }),
                addSubtitle: (options = {}) => request('audio.addSubtitle', options, 30000),
                state: () => request('audio.state')
            }),
            log: (...args) => { post('request', { requestId: String(nextRequestId++), method: 'log', payload: { args: args.map((arg) => { try { return typeof arg === 'string' ? arg : JSON.parse(JSON.stringify(arg)); } catch { return String(arg); } }) } }); },
            notifications: Object.freeze({
                show: (options = {}) => request('notification.show', options),
                // Shown by the system at `at` (ms or a Date), whether or not a new tab is open then.
                schedule: (options = {}) => request('notification.schedule', { ...options, at: options.at instanceof Date ? options.at.getTime() : options.at }),
                cancel: (id = null) => request('notification.cancel', { id }),
                scheduled: () => request('notification.scheduled')
            }),
            // What Spotlight may find in this app: [{ id, title, subtitle, keywords }]. Choosing one sends 'search'.
            search: Object.freeze({ setItems: (items = []) => request('search.setItems', { items }, 30000), clear: () => request('search.clear') }),
            // One item on the right of the menu bar: { title, icon, template, tooltip, items, panel }. Sends 'statusitem'.
            statusItem: Object.freeze({
                set: (options = {}) => request('statusItem.set', options),
                // Changes nodes of the panel in place: patch(id, props) or patch([{ id, props }]).
                patch: (id, props = {}) => request('statusItem.patch', { patches: Array.isArray(id) ? id : [{ id, props }] }),
                remove: () => request('statusItem.remove')
            }),
            system: Object.freeze({ getInfo: () => request('system.getInfo'), getStats: () => request('system.getStats') }),
            menu: Object.freeze({ list: () => request('menu.list'), invoke: (command) => request('menu.invoke', { command }) }),
            assets: Object.freeze({ url: assetUrl, list: () => Object.freeze([...assetPaths]) }),
            ui: Object.freeze({
                patch: (id, props = {}) => queuePatch(id, props),
                batch: (patches = []) => request('ui.batch', { patches }),
                defineStyles: (styles = {}) => request('ui.defineStyles', { styles }),
                scrollTo: (id, options = {}) => request('ui.scrollTo', { id, options }),
                showMenu: (items = [], position = {}) => request('ui.showMenu', { items, ...position }, 0),
                get: (id) => request('ui.get', { id }),
                replace: (id, node) => request('ui.replace', { id, node }),
                append: (parentId, node, index = null) => request('ui.append', { parentId, node, index }),
                setChildren: (parentId, children = []) => request('ui.setChildren', { parentId, children }),
                remove: (id) => request('ui.remove', { id }),
                render: (tree) => request('ui.render', { tree }),
                focus: (id) => request('ui.focus', { id }),
                // Text controls: { start, end, direction, reveal } / the text that replaces the selection.
                setSelection: (id, selection = {}) => request('ui.setSelection', { id, selection }),
                replaceSelection: (id, text, options = {}) => request('ui.replaceSelection', { id, text, options })
            }),
            i18n: Object.freeze({ t: translate, language: () => document.documentElement.lang, direction: () => (document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr') }),
            on
        });
    }

    async function mount(message) {
        if (initialized) return;
        instanceId = String(message.instanceId || ''); token = String(message.token || '');
        if (!instanceId || !token) return;
        initialized = true;
        const plugin = message.plugin || {};
        try {
            applyContext(message.context || {});
            prepareAssets(plugin.assets || {});
            appLocales = plugin.locales && typeof plugin.locales === 'object' ? plugin.locales : {};
            root.replaceChildren();
            if (plugin.mode !== 'native') {
                const style = document.createElement('style'); style.dataset.pluginStyle = '1'; style.textContent = await replaceAssetMarkers(plugin.css || ''); document.head.appendChild(style);
                const template = document.createElement('template'); template.innerHTML = String(plugin.html || '');
                const fragment = template.content.cloneNode(true); await rewriteDomAssets(fragment); root.appendChild(fragment);
            }
            if (plugin.strictSecurity) installStrictRuntimeGuards();
            const macos = api(message.context || {});
            Object.defineProperty(globalThis, 'macos', { value: macos, configurable: false, writable: false });
            const source = String(plugin.script || '');
            if (source.trim()) {
                const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
                const fn = new AsyncFunction('macos', 'root', '"use strict";\n' + source + '\n//# sourceURL=macos-plugin-' + String(message.pluginId || 'app').replace(/[^a-z0-9._-]/gi, '-') + '.js');
                await fn(macos, root);
            }
            post('ready');
        } catch (error) { reportCrash(error); }
    }

    function processHostMessage(message) {
        if (!message || message.channel !== CHANNEL_HOST) return;
        if (!initialized || message.instanceId !== instanceId || message.token !== token) return;
        if (message.type === 'response') {
            const entry = pending.get(String(message.requestId || '')); if (!entry) return;
            pending.delete(String(message.requestId || ''));
            if (message.ok) entry.resolve(message.value); else entry.reject(new Error(message.error || 'Plugin API request failed'));
        } else if (message.type === 'event') {
            if (message.name === 'themechange') applyContext({ ...message.detail, language: document.documentElement.lang });
            if (message.name === 'languagechange') applyContext({ language: message.detail?.language, direction: message.detail?.direction, theme: document.documentElement.dataset.theme, systemTheme: document.documentElement.dataset.systemTheme });
            if (message.name === 'visibilitychange') {
                hostVisible = message.detail?.visible !== false;
                document.documentElement.dataset.hostVisible = hostVisible ? '1' : '0';
            }
            // Escape belongs to the app first. A keydown listener that used it returns true;
            // if none did, the window closes, as system windows do.
            if (message.name === 'keydown' && message.detail?.key === 'Escape' && !message.detail.repeat) {
                const results = (listeners.get('keydown') || []).slice().map((fn) => { try { return fn(message.detail); } catch (error) { reportCrash(error); return true; } });
                Promise.all(results.map((result) => Promise.resolve(result).catch(() => true))).then((values) => { if (!values.some((value) => value === true)) request('window.escape').catch(() => {}); });
                return;
            }
            emit(message.name, message.detail);
        } else if (message.type === 'drag-end') {
            endDragFromHost?.(message.frame || null);
        } else if (message.type === 'host-drag-state') {
            const active = !!message.active;
            hostDragging = active;
            document.documentElement.dataset.hostDragging = active ? '1' : '0';
            emit('hostdragchange', { active, kind: message.kind || 'system' });
        } else if (message.type === 'dispose') {
            pending.forEach(({ reject }) => reject(new Error('Application closed'))); pending.clear(); listeners.clear(); root.replaceChildren();
            try { hostPort?.close?.(); } catch {}
            hostPort = null;
        }
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.channel !== CHANNEL_HOST || message.type !== 'connect' || initialized) return;
        const port = event.ports?.[0];
        if (!port) return;
        hostPort = port;
        hostPort.onmessage = (portEvent) => processHostMessage(portEvent.data);
        hostPort.start?.();
        mount(message);
    });
    // Web apps receive keys in their own document: Escape nobody there handled (no
    // preventDefault, not typed into a field) closes the window in the same way.
    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || !initialized) return;
        if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
        request('window.escape').catch(() => {});
    });
    // The browser's own context menu (Back, Reload, Inspect…) belongs to the page this desktop
    // is, not to an application in it: it never opens over one, except on text being edited,
    // as everywhere else on the desktop. An application shows its own with macos.ui.showMenu.
    window.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !target?.isContentEditable) event.preventDefault();
    });
    parent.postMessage({ channel: CHANNEL_APP, type: 'runtime-ready' }, '*');
})();
