(() => {
    try {
        const FIRST_PAINT_STATE_KEY = 'macOS_first_paint_state_v055';
        const isSafeBackground = (value) => {
            if (!value || typeof value !== 'string') return false;
            return value.startsWith('assets/') || value.startsWith('data:image/') || /^https:\/\/(?:www\.)?bing\.com\//i.test(value);
        };

        let firstPaint = {};
        try {
            const parsed = JSON.parse(localStorage.getItem(FIRST_PAINT_STATE_KEY) || 'null');
            if (parsed && [51, 52, 53, 55].includes(parsed.version)) firstPaint = parsed;
        } catch {}

        const mode = firstPaint.themeMode || localStorage.getItem('macOS_theme_cache') || 'system';
        const isDarkOS = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const hour = new Date().getHours();
        const isNight = hour >= 18 || hour < 6;
        const dark = mode === 'dark' || (mode === 'system' && isDarkOS) || (mode === 'auto' && isNight);
        firstPaint.effectiveTheme = dark ? 'dark' : 'light';
        window.__macOSFirstPaintState = firstPaint;

        // Apply critical geometry before the stylesheets and <body> can paint. In particular,
        // the Dock starts at the saved size instead of the 56 px CSS fallback.
        const dockSize = Math.max(30, Math.min(90, Number(firstPaint.dockSize) || 56));
        document.documentElement.style.setProperty('--dock-size', `${dockSize}px`);
        document.documentElement.dataset.bootTheme = firstPaint.effectiveTheme;
        // The accent colour is part of the first paint (selection, buttons, indicators).
        const accent = localStorage.getItem('macOS_accent_cache') || '';
        if (/^#[0-9a-f]{6}$/i.test(accent)) {
            const value = parseInt(accent.slice(1), 16);
            document.documentElement.style.setProperty('--accent', accent);
            document.documentElement.style.setProperty('--accent-rgb', `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`);
        }

        let savedBg = localStorage.getItem(dark ? 'macOS_bg_cache_dark' : 'macOS_bg_cache_light');
        if (localStorage.getItem('macOS_bing_cache') === 'true') {
            const bingUrl = localStorage.getItem('macOS_bing_url');
            if (isSafeBackground(bingUrl)) savedBg = bingUrl;
        }
        if (!isSafeBackground(savedBg)) {
            savedBg = dark ? 'assets/images/sequoia.shape.night.jpg' : 'assets/images/sequoia.shape.day.jpg';
        }

        // A relative path in a custom property would be resolved against the stylesheet that
        // uses it (css/…), not against the page.
        if (!/^[a-z][a-z0-9+.-]*:/i.test(savedBg)) savedBg = new URL(savedBg, document.baseURI).href;
        const escaped = savedBg.replaceAll('"', '%22');
        const css = `url("${escaped}")`;
        document.documentElement.style.setProperty('--init-bg', css);
        Object.assign(document.documentElement.style, {
            backgroundImage: css,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
        });
    } catch {
        // First-paint caching is an optimization and must never block the new tab.
    }
})();

// Does this browser draw classic scroll bars that take room (Windows, Linux, ChromeOS, or
// macOS set to always show them)? Those get the slim style in 01-base.css.
(() => {
    try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:-300px;left:0;width:120px;height:60px;overflow:scroll;visibility:hidden';
        document.documentElement.appendChild(probe);
        if (probe.offsetWidth - probe.clientWidth > 0) document.documentElement.classList.add('classic-scrollbars');
        probe.remove();
    } catch { /* the default scroll bars stay */ }
})();
