(() => {
    const cacheKey = 'macOS_boot_visual_cache_v055';
    const $ = (id) => document.getElementById(id);
    const firstPaint = window.__macOSFirstPaintState || {};

    function applyFirstPaintClasses() {
        const body = document.body;
        if (!body) return;
        const dark = firstPaint.effectiveTheme === 'dark';
        body.classList.toggle('dark-mode', dark);
        body.classList.toggle('light-mode', !dark);
        body.classList.toggle('light-icon-bg-in-dark', firstPaint.dockLightBgInDark !== false);
        if (firstPaint.direction === 'rtl') document.documentElement.setAttribute('dir', 'rtl');
        const dev = firstPaint.developer || {};
        body.classList.toggle('dev-disable-animations', Boolean(dev.disableAnimations));
        const opaque = Boolean(dev.reduceTransparency || dev.increaseContrast);
        body.classList.toggle('dev-reduce-transparency', opaque);
        body.classList.toggle('dev-transparent-glass', Boolean(dev.transparentGlass && !opaque));
        body.classList.toggle('dev-disable-extra-features', Boolean(dev.enabled && dev.disableExtraFeatures));
        body.classList.toggle('dev-selectable-ui', Boolean(dev.enabled && dev.selectableUIText));
        body.classList.toggle('dev-increase-contrast', Boolean(dev.increaseContrast));
    }

    function cachedNow() {
        const dev = firstPaint.developer || {};
        if (!dev.enabled) return new Date();
        const scale = Math.max(.5, Math.min(3600, Number(dev.timeScale) || 1));
        const realBase = Number(dev.baseRealMs) || Date.now();
        const virtualBase = Number(dev.baseVirtualMs) || realBase;
        return new Date(virtualBase + (Date.now() - realBase) * scale);
    }

    function paintClock() {
        const clock = $('clock');
        if (!clock) return;
        const now = cachedNow();
        const lang = firstPaint.language || 'zh-CN';
        const weekday = now.toLocaleDateString(lang, { weekday: 'short' });
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const time = now.toLocaleTimeString(lang, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        clock.textContent = `${month}/${day} ${weekday} ${time}`;
    }

    function placeSpotlight() {
        const spotlight = $('spotlight');
        if (!spotlight) return;
        let open = firstPaint.showSpotlightOnStart !== false;
        if (firstPaint.showSpotlightOnStart === undefined) {
            try { open = localStorage.getItem('macOS_spotlight_start_cache') !== 'false'; } catch {}
        }
        spotlight.classList.toggle('hidden', !open);
        if (!open) return;
        const width = spotlight.offsetWidth || 650;
        const height = spotlight.offsetHeight || 100;
        spotlight.style.left = `${Math.round((innerWidth - width) / 2)}px`;
        spotlight.style.top = `${Math.round(Math.max(56, (innerHeight - height) * 0.42))}px`;
        spotlight.style.zIndex = '6001';
        if (firstPaint.spotlightFocusOnOpen) {
            const input = $('search-input');
            if (input) {
                input.setAttribute('autofocus', '');
                const focus = () => { try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} } };
                const forceFocus = () => { try { window.focus(); } catch {} focus(); };
                forceFocus();
                requestAnimationFrame(forceFocus);
                [0, 45, 110, 220, 380, 620, 950, 1350, 1800].forEach((delay) => setTimeout(forceFocus, delay));
                window.addEventListener('focus', () => setTimeout(forceFocus, 0), { once: true });
                window.addEventListener('pageshow', forceFocus, { once: true });
            }
        }
    }

    function restoreSnapshot() {
        let cache = null;
        try { cache = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch {}
        if (!cache || ![51, 52, 53, 55].includes(cache.version)) return false;

        const desktop = $('desktop-grid');
        if (desktop && cache.desktopHtml) desktop.innerHTML = cache.desktopHtml;
        const dock = $('dock');
        if (dock && cache.dockHtml) dock.innerHTML = cache.dockHtml;
        const links = $('quick-links');
        if (links && cache.quickLinksHtml) links.innerHTML = cache.quickLinksHtml;
        const menuLeft = document.querySelector('#menu-bar .menu-left');
        if (menuLeft && cache.menuLeftHtml) menuLeft.innerHTML = cache.menuLeftHtml;
        const input = $('search-input');
        if (input && cache.spotlightPlaceholder) input.setAttribute('placeholder', cache.spotlightPlaceholder);

        const warmPhotos = Array.isArray(cache.photoWarmSources) ? cache.photoWarmSources : cache.nextPhotoSources;
        if (Array.isArray(warmPhotos) && !(firstPaint.developer?.enabled && firstPaint.developer?.disableExtraFeatures)) {
            window.__macOSBootPhotoPreloads = warmPhotos.slice(0, 12).map((src) => {
                const img = new Image();
                img.decoding = 'async';
                img.src = src;
                const done = typeof img.decode === 'function' ? img.decode().then(() => true).catch(() => false) : Promise.resolve(true);
                return { src, img, done };
            });
        }

        if (cache.widgetsHtml && !(firstPaint.developer?.enabled && firstPaint.developer?.disableExtraFeatures)) {
            const liveLayer = $('desktop-widget-layer');
            if (liveLayer) {
                const snapshotLayer = document.createElement('div');
                snapshotLayer.id = 'boot-widget-snapshot-layer';
                snapshotLayer.className = 'desktop-widget-layer boot-widget-snapshot-layer';
                snapshotLayer.innerHTML = cache.widgetsHtml;
                liveLayer.insertAdjacentElement('afterend', snapshotLayer);
                document.body.classList.add('boot-widget-snapshot-active');
            }
        }
        document.body.classList.add('boot-visual-snapshot-active');
        return true;
    }

    applyFirstPaintClasses();
    paintClock();
    placeSpotlight();
    restoreSnapshot();
})();
