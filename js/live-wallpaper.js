import { state } from './state.js';
import { $ } from './utils.js';
import { getWallpaper } from './wallpaper-store.js';

// Live wallpaper: a local video looping behind the desktop. The configuration keeps the
// video's id, speed, volume and whether it is paused; the still poster is the ordinary
// wallpaper underneath, so first paint and every fallback path show something sensible.

let video = null;
let mountedId = '';
let objectUrl = '';
let token = 0;

export const liveWallpaperVideo = () => video;
const settings = () => state.config?.liveWallpaper || {};

function unmount() {
    mountedId = '';
    if (video) { try { video.pause(); } catch { /* already gone */ } video.remove(); video = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
}
async function play() {
    if (!video || settings().paused || document.hidden) return;
    try { await video.play(); }
    catch {
        // Browsers refuse to start sound without a user gesture. Start silently and switch
        // the sound on with the first click or key press.
        if (!video || video.muted) return;
        video.muted = true;
        try { await video.play(); } catch { return; }
        const unmute = () => { if (video && (settings().volume || 0) > 0) video.muted = false; };
        window.addEventListener('pointerdown', unmute, { once: true, capture: true });
        window.addEventListener('keydown', unmute, { once: true, capture: true });
    }
}
/** Apply speed / volume / paused from the configuration to the playing video. */
export function applyLiveWallpaperSettings() {
    if (!video) return;
    const { rate = 1, volume = 0, paused = false } = settings();
    video.playbackRate = Math.max(0.25, Math.min(2, Number(rate) || 1));
    video.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    video.muted = video.volume === 0;
    if (paused) video.pause(); else play();
}
/** Bring the desktop in line with the configuration: mount, swap or remove the video. */
export async function syncLiveWallpaper() {
    const host = $('wallpaper');
    const { enabled, id } = settings();
    if (!host || !enabled || !id) { token += 1; unmount(); return; }
    if (mountedId === id && video?.isConnected) { applyLiveWallpaperSettings(); return; }
    const mine = ++token;
    const record = await getWallpaper(id).catch(() => null);
    if (mine !== token) return;
    unmount();
    if (!record || record.kind !== 'video') return;
    objectUrl = URL.createObjectURL(record.blob);
    video = document.createElement('video');
    video.id = 'wallpaper-video';
    video.loop = true; video.playsInline = true; video.preload = 'auto'; video.disablePictureInPicture = true;
    video.setAttribute('aria-hidden', 'true');
    video.src = objectUrl;
    mountedId = id;
    host.appendChild(video);
    applyLiveWallpaperSettings();
    window.dispatchEvent(new CustomEvent('macos-live-wallpaper-changed'));
}

// A hidden tab does not need to decode video.
document.addEventListener('visibilitychange', () => {
    if (!video) return;
    if (document.hidden) video.pause(); else play();
});
