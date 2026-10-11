// macos.audio: the host-side media player of an application, with fades, cross-fades
// and host-drawn subtitles.

import { state } from './state.js';
import { saveConfig } from './config.js';
import { t, updateCustomSelectLabel } from './i18n.js';
import { $, createElement } from './utils.js';
import { getBlobRecord, updateBlobMeta } from './plugin-blobs.js';
import { cuesToVtt, extractSubtitles, parseSubtitleText } from './subtitles.js';
import { appWindows, postToPlugin } from './plugin-core.js';
import { fileObjectUrl, resolveImageSource } from './plugin-files.js';

export const isVideoFile = (blob, name = '') => /^video\//.test(blob?.type || '') || /\.(mp4|m4v|mov|mkv|webm)$/i.test(name);
// macos.audio: one host-side player per app, fed straight from the file store.
function audioState(record, type = 'state') {
    const audio = record.audio;
    // While a pause fades out the sound is still running; to the application it is paused already.
    return { type, fileId: record.audioFileId || '', paused: !audio || audio.paused || Boolean(record.audioPausing), ended: Boolean(audio?.ended), currentTime: audio?.currentTime || 0,
        duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0, volume: record.audioVolume ?? 1, hasVideo: Boolean(audio?.videoWidth),
        // The subtitle tracks of what is loaded, and which one is shown (-1: none).
        subtitles: (record.subtitles || []).map(({ label, language }) => ({ label, language })), subtitle: record.subtitles?.length ? record.subtitleIndex ?? -1 : -1 };
}
// Subtitles are WebVTT tracks on the player: the ones found in the video file, then the
// subtitle files the application supplied for it.
export function clearSubtitles(record) {
    for (const track of record.subtitles || []) { track.element.remove(); URL.revokeObjectURL(track.url); }
    record.subtitles = [];
    record.subtitleOverlay?.replaceChildren();
}
// Subtitles are drawn by the host, in an element of its own over the picture: the track
// only supplies the cues (mode "hidden"). The browser's own cue rendering follows the
// operating system's caption style, which a page cannot override; this way size, backing
// and position are the user's choice here (System Settings ▸ Accessibility ▸ Subtitles).
const SUBTITLE_SCALES = { small: 0.78, medium: 1, large: 1.35, xlarge: 1.75 };
const subtitleSettings = () => state.config?.accessibility?.subtitles || {};
export function applySubtitleAppearance() {
    const { size, background, position, x = 50, y = 80 } = subtitleSettings();
    const root = document.documentElement;
    root.style.setProperty('--subtitle-scale', String(SUBTITLE_SCALES[size] || 1));
    root.style.setProperty('--subtitle-x', `${x}%`);
    root.style.setProperty('--subtitle-y', `${y}%`);
    root.dataset.subtitleBackground = ['none', 'opaque'].includes(background) ? background : 'translucent';
    root.dataset.subtitlePosition = ['top', 'custom'].includes(position) ? position : 'bottom';
}
// The user puts the subtitles where they want them by dragging them over the picture.
// The place is kept for every video (Accessibility ▸ Subtitles ▸ Position: Custom).
function bindSubtitleDrag(overlay) {
    overlay.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !event.target.closest('.plugin-subtitle-line')) return;
        const frame = overlay.parentNode?.getBoundingClientRect();
        if (!frame?.width || !frame.height) return;
        event.preventDefault(); event.stopPropagation();
        // The block is as wide as its widest line (the element itself may span the picture).
        const lines = [...overlay.querySelectorAll('.plugin-subtitle-line')].map((line) => line.getBoundingClientRect());
        const edges = { left: Math.min(...lines.map((r) => r.left)), right: Math.max(...lines.map((r) => r.right)), top: Math.min(...lines.map((r) => r.top)), bottom: Math.max(...lines.map((r) => r.bottom)) };
        const box = { left: edges.left, top: edges.top, width: edges.right - edges.left, height: edges.bottom - edges.top };
        // Where the pointer holds the block, relative to its centre.
        const grip = { x: event.clientX - (box.left + box.width / 2), y: event.clientY - (box.top + box.height / 2) };
        const root = document.documentElement;
        let moved = false; let place = null;
        overlay.classList.add('dragging');
        const move = (ev) => {
            if (!moved && Math.hypot(ev.clientX - event.clientX, ev.clientY - event.clientY) < 4) return;
            moved = true;
            const half = { x: box.width / 2 / frame.width * 100, y: box.height / 2 / frame.height * 100 };
            place = {
                x: Math.max(Math.min(half.x, 50), Math.min(100 - Math.min(half.x, 50), (ev.clientX - grip.x - frame.left) / frame.width * 100)),
                y: Math.max(half.y + 1, Math.min(99 - half.y, (ev.clientY - grip.y - frame.top) / frame.height * 100))
            };
            root.dataset.subtitlePosition = 'custom';
            root.style.setProperty('--subtitle-x', `${place.x}%`); root.style.setProperty('--subtitle-y', `${place.y}%`);
        };
        const up = () => {
            window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
            overlay.classList.remove('dragging');
            if (!place) return;
            const subtitles = ((state.config.accessibility ||= {}).subtitles ||= {});
            Object.assign(subtitles, { position: 'custom', x: Math.round(place.x * 10) / 10, y: Math.round(place.y * 10) / 10 });
            saveConfig().catch(() => {});
            applySubtitleAppearance();
            const select = $('subtitle-position');
            if (select) { select.dataset.value = 'custom'; updateCustomSelectLabel(select); }
        };
        // The whole desktop is listened to for the length of the drag: the block itself lets the pointer through.
        window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    });
    // A press on the subtitles is theirs: it neither clicks the video nor drags the window.
    for (const type of ['click', 'dblclick', 'mousedown']) overlay.addEventListener(type, (event) => { if (event.target.closest('.plugin-subtitle-line')) event.stopPropagation(); });
}
// The overlay stays beside the player, wherever the application shows it.
export function subtitleOverlay(record) {
    if (!record.subtitleOverlay) { record.subtitleOverlay = createElement('div', { className: 'plugin-subtitle-overlay', attrs: { 'aria-hidden': 'true' } }); bindSubtitleDrag(record.subtitleOverlay); }
    const parent = record.audio?.parentNode;
    if (parent && record.subtitleOverlay.parentNode !== parent) parent.appendChild(record.subtitleOverlay);
    return record.subtitleOverlay;
}
const SUBTITLE_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' };
const cueLines = (cue) => String(cue.text || '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (entity) => SUBTITLE_ENTITIES[entity]).split('\n').map((line) => line.trim()).filter(Boolean);
function drawSubtitles(record) {
    if (!record.audio) return;
    const track = record.subtitles?.[record.subtitleIndex ?? -1]?.element.track;
    const lines = track ? [...(track.activeCues || [])].flatMap(cueLines) : [];
    subtitleOverlay(record).replaceChildren(...lines.map((line) => createElement('span', { className: 'plugin-subtitle-line', text: line })));
}
function showSubtitle(record, index) {
    const tracks = record.subtitles || [];
    record.subtitleIndex = Number.isInteger(index) && index >= 0 && index < tracks.length ? index : -1;
    tracks.forEach((track, at) => { track.element.track.mode = at === record.subtitleIndex ? 'hidden' : 'disabled'; });
    drawSubtitles(record);
}
function addSubtitleTrack(record, { vtt, label = '', language = '' }) {
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    const element = createElement('track', { attrs: { kind: 'subtitles', src: url } });
    const name = String(label || '').trim().slice(0, 80);
    let display = name;
    if (!display && language) { try { display = new Intl.DisplayNames([state.config.language || 'en'], { type: 'language' }).of(language.length === 3 ? ({ chi: 'zh', zho: 'zh', eng: 'en', jpn: 'ja', kor: 'ko', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', rus: 'ru', ara: 'ar' })[language] || language : language) || ''; } catch { display = language; } }
    element.label = display || `${t('subtitleTrack', '字幕')} ${(record.subtitles?.length || 0) + 1}`;
    if (/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(language)) element.srclang = language;
    // The browser makes a selection of its own once a track has loaded (by the user's
    // languages); the application's choice is put back after it.
    element.addEventListener('load', () => showSubtitle(record, record.subtitleIndex ?? -1));
    element.track.addEventListener('cuechange', () => drawSubtitles(record));
    record.audio.appendChild(element);
    (record.subtitles ||= []).push({ element, url, label: element.label, language: String(language || '').slice(0, 20) });
}
// A subtitle file the application stored (.srt, .vtt, .ass, .ssa, .lrc), as a track.
async function addSubtitleFile(record, entry) {
    const stored = await getBlobRecord(record.storageId, String(entry?.fileId || ''));
    if (!stored || stored.size > 8_000_000) return false;
    const cues = parseSubtitleText(await stored.blob.text(), stored.name);
    if (!cues.length) return false;
    addSubtitleTrack(record, { vtt: cuesToVtt(cues), label: entry.label || stored.name.replace(/\.[a-z0-9]{1,4}$/i, ''), language: entry.language || '' });
    return true;
}
async function loadSubtitles(record, id, payload) {
    clearSubtitles(record);
    const stored = await getBlobRecord(record.storageId, id);
    if (!stored || record.audioFileId !== id) return;
    let embedded = stored.subtitles;
    // A video stored before subtitles were read is looked through now, once.
    if (embedded === undefined && isVideoFile(stored.blob, stored.name)) {
        embedded = await extractSubtitles(stored.blob);
        await updateBlobMeta(record.storageId, id, { subtitles: embedded }).catch(() => {});
        if (record.audioFileId !== id) return;
    }
    for (const track of embedded || []) addSubtitleTrack(record, track);
    for (const entry of (Array.isArray(payload?.subtitles) ? payload.subtitles : []).slice(0, 16)) { await addSubtitleFile(record, entry).catch(() => false); if (record.audioFileId !== id) return; }
    showSubtitle(record, payload?.subtitle === undefined ? 0 : Number(payload.subtitle));
    if (record.subtitles.length && appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'audio', detail: audioState(record, 'subtitles') });
}
// Fades. What is heard is the application's volume times a gain the host ramps: fading a
// pause in and out, and cross-fading from one file into the next (two elements for a moment).
const mediaGain = new WeakMap(); // element -> { value, timer, done }
const gainOf = (element) => mediaGain.get(element) || { value: 1, timer: 0, done: null };
function setGain(record, element, value) {
    mediaGain.set(element, { ...gainOf(element), value });
    element.volume = Math.max(0, Math.min(1, (record.audioVolume ?? 1) * value));
}
export function stopFade(element) {
    const gain = gainOf(element);
    if (gain.timer) { clearInterval(gain.timer); gain.done?.(false); mediaGain.set(element, { value: gain.value, timer: 0, done: null }); }
}
/** Ramps the gain to `to` over `seconds`. Resolves true when it got there, false when another fade took over. */
function fadeGain(record, element, to, seconds) {
    stopFade(element);
    const from = gainOf(element).value;
    if (!(seconds > 0) || from === to) { setGain(record, element, to); return Promise.resolve(true); }
    return new Promise((resolve) => {
        const started = performance.now();
        const timer = setInterval(() => {
            const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
            // Equal-power curve: a cross-fade keeps its loudness in the middle.
            const eased = to > from ? Math.sin(progress * Math.PI / 2) : 1 - Math.sin((1 - progress) * Math.PI / 2);
            const value = to > from ? from + (to - from) * eased : to + (from - to) * (1 - eased);
            mediaGain.set(element, { value, timer, done: resolve });
            element.volume = Math.max(0, Math.min(1, (record.audioVolume ?? 1) * value));
            if (progress >= 1) { clearInterval(timer); mediaGain.set(element, { value: to, timer: 0, done: null }); resolve(true); }
        }, 30);
        mediaGain.set(element, { value: from, timer, done: resolve });
    });
}
const fadeSeconds = (value, max) => Math.max(0, Math.min(max, Number(value) || 0));
function createMediaElement(record) {
    // A <video>, so files with a picture can be shown by a `video` node; for plain audio
    // it simply stays in its hidden holder.
    const audio = document.createElement('video');
    audio.className = 'plugin-media-player';
    audio.preload = 'auto'; audio.playsInline = true; audio.disablePictureInPicture = true;
    for (const type of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'seeked', 'volumechange', 'error']) {
        audio.addEventListener(type, () => {
            // Only the current player speaks for the application: not one that is fading out
            // behind it, and not the volume steps of a fade.
            if (record.audio !== audio || appWindows.get(record.key) !== record) return;
            if (type === 'volumechange' && gainOf(audio).timer) return;
            if (type === 'pause' && record.audioPausing) return;
            postToPlugin(record, { type: 'event', name: 'audio', detail: audioState(record, type) });
        });
    }
    audio.addEventListener('loadedmetadata', () => { if (record.audio === audio && record.subtitles?.length) showSubtitle(record, record.subtitleIndex ?? -1); });
    return audio;
}
export function ensureAudio(record) {
    if (record.audio) return record.audio;
    // One player per app (two for the length of a cross-fade).
    record.mediaPark ||= record.window.appendChild(createElement('div', { className: 'plugin-media-park', attrs: { 'aria-hidden': 'true' } }));
    record.audio = record.mediaPark.appendChild(createMediaElement(record));
    setGain(record, record.audio, 1);
    return record.audio;
}
export function retireMedia(element) {
    stopFade(element);
    try { element.pause(); element.removeAttribute('src'); element.load(); } catch { /* already released */ }
    element.remove();
}
// The playing element steps aside and fades out; a fresh one takes its place (where a
// `video` node shows it) and becomes the application's player.
function crossfadeOut(record, seconds) {
    const outgoing = record.audio;
    clearSubtitles(record);
    const next = createMediaElement(record);
    outgoing.replaceWith(next);
    record.mediaPark.appendChild(outgoing);
    record.audio = next;
    setGain(record, next, 0);
    (record.outgoingMedia ||= new Set()).add(outgoing);
    fadeGain(record, outgoing, 0, seconds).then(() => { record.outgoingMedia.delete(outgoing); retireMedia(outgoing); });
    return next;
}
// Now-playing information for the system media controls and hardware media keys.
// Key presses come back to the app as 'audio' events of type 'action'.
async function setMediaSession(record, payload) {
    if (!('mediaSession' in navigator)) return;
    const artwork = payload.artwork ? await resolveImageSource(record, payload.artwork).catch(() => '') : '';
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: String(payload.title || '').slice(0, 200), artist: String(payload.artist || '').slice(0, 200), album: String(payload.album || '').slice(0, 200),
            artwork: artwork ? [{ src: artwork }] : []
        });
        for (const action of ['play', 'pause', 'previoustrack', 'nexttrack']) {
            navigator.mediaSession.setActionHandler(action, () => {
                if (appWindows.get(record.key) === record) postToPlugin(record, { type: 'event', name: 'audio', detail: { ...audioState(record, 'action'), action } });
            });
        }
    } catch { /* media session is an enhancement */ }
}
export async function handleAudioRequest(record, method, payload) {
    let audio = ensureAudio(record);
    if (method === 'audio.load') {
        const id = String(payload?.fileId || '');
        const url = await fileObjectUrl(record, id);
        if (!url) throw new Error('Unknown file id');
        // crossfade: seconds over which what is playing fades out under the new file.
        const crossfade = fadeSeconds(payload?.crossfade, 12);
        const blend = crossfade > 0 && payload?.autoplay !== false && !audio.paused && !record.audioPausing && Boolean(audio.currentSrc);
        record.audioPausing = false;
        if (blend) audio = crossfadeOut(record, crossfade); else { stopFade(audio); setGain(record, audio, 1); }
        record.audioFileId = id;
        audio.src = url;
        // Reading a long video's tracks must not hold up its playback.
        loadSubtitles(record, id, payload).catch(() => {});
        if (Number.isFinite(Number(payload?.startAt))) audio.currentTime = Math.max(0, Number(payload.startAt));
        if (payload?.autoplay !== false) { await audio.play(); if (blend) fadeGain(record, audio, 1, crossfade); }
    } else if (method === 'audio.play') {
        // fade: seconds over which the sound comes back.
        const fade = fadeSeconds(payload?.fade, 5);
        const resuming = audio.paused || record.audioPausing;
        record.audioPausing = false;
        if (fade > 0 && resuming) { if (audio.paused) setGain(record, audio, 0); await audio.play(); fadeGain(record, audio, 1, fade); }
        else { stopFade(audio); setGain(record, audio, 1); await audio.play(); }
    } else if (method === 'audio.pause') {
        // fade: seconds over which the sound goes before the player stops.
        const fade = fadeSeconds(payload?.fade, 5);
        if (fade > 0 && !audio.paused) {
            record.audioPausing = true;
            postToPlugin(record, { type: 'event', name: 'audio', detail: audioState(record, 'pause') });
            fadeGain(record, audio, 0, fade).then((finished) => {
                if (!finished || record.audio !== audio || !record.audioPausing) return;
                audio.pause(); record.audioPausing = false; setGain(record, audio, 1);
            });
        } else { record.audioPausing = false; stopFade(audio); audio.pause(); setGain(record, audio, 1); }
    }
    else if (method === 'audio.stop') { record.audioPausing = false; stopFade(audio); audio.pause(); audio.removeAttribute('src'); audio.load(); setGain(record, audio, 1); record.outgoingMedia?.forEach(retireMedia); record.outgoingMedia?.clear(); record.audioFileId = ''; clearSubtitles(record); }
    else if (method === 'audio.setSubtitle') showSubtitle(record, Number(payload?.index));
    else if (method === 'audio.addSubtitle') { if (!(await addSubtitleFile(record, payload || {}))) throw new Error('No subtitles could be read from that file'); showSubtitle(record, record.subtitles.length - 1); }
    else if (method === 'audio.seek') audio.currentTime = Math.max(0, Number(payload?.time) || 0);
    else if (method === 'audio.setVolume') { record.audioVolume = Math.max(0, Math.min(1, Number(payload?.volume))); setGain(record, audio, gainOf(audio).value); record.outgoingMedia?.forEach((element) => setGain(record, element, gainOf(element).value)); }
    else if (method === 'audio.setMetadata') { await setMediaSession(record, payload || {}); return true; }
    else if (method !== 'audio.state') throw new Error(`Unknown plugin API method: ${method}`);
    return audioState(record);
}
