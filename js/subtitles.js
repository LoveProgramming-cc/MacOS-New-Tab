// Subtitles for the host's media player (macos.audio).
//
// A browser plays the picture and the sound of a video file but ignores the text tracks
// stored in it. They are read here instead, once, when the file is stored:
//
//   MP4 / MOV / M4V     mov_text (tx3g), QuickTime text and WebVTT tracks
//   Matroska / WebM     SRT (S_TEXT/UTF8), ASS / SSA and WebVTT tracks
//
// and subtitle files the user adds beside a video (.srt, .vtt, .ass, .ssa, .lrc) are
// parsed with parseSubtitleText(). Either way the result is a list of cues, handed to the
// <video> element as a WebVTT track.

const MAX_CUES = 20000;
const MAX_TRACKS = 8;
const utf8 = new TextDecoder('utf-8');
const decode = (bytes) => {
    // A UTF-16 sample starts with a byte order mark; everything else is UTF-8.
    if (bytes.length >= 2 && ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe))) return new TextDecoder(bytes[0] === 0xfe ? 'utf-16be' : 'utf-16le').decode(bytes.subarray(2));
    return utf8.decode(bytes);
};
const slice = async (blob, start, length) => new Uint8Array(await blob.slice(start, start + length).arrayBuffer());

// ---------------------------------------------------------------------------------
// Text formats
// ---------------------------------------------------------------------------------
function clock(text) {
    const match = String(text).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (!match) return NaN;
    return (Number(match[1]) || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + (match[4] ? Number(match[4].padEnd(3, '0')) / 1000 : 0);
}
// ASS override blocks ({\i1}, {\pos(…)}) are dropped; \N is a line break.
function cleanAss(text) {
    if (/\{[^}]*\\p[1-9]/.test(text)) return ''; // a vector drawing, not text
    return text.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
}
const cleanMarkup = (text) => String(text).replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim();

function parseTimed(text) { // SRT and WebVTT
    const cues = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
        const lines = block.split('\n');
        const at = lines.findIndex((line) => line.includes('-->'));
        if (at < 0) continue;
        const [from, to] = lines[at].split('-->');
        const start = clock(from); const end = clock(String(to).trim().split(/\s+/)[0]);
        const body = cleanMarkup(lines.slice(at + 1).join('\n'));
        if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: body });
    }
    return cues;
}
function parseAssFile(text) {
    const cues = []; let format = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    for (const line of text.replace(/\r/g, '').split('\n')) {
        if (/^Format:/i.test(line) && /text\s*$/i.test(line)) format = line.slice(7).split(',').map((name) => name.trim().toLowerCase());
        if (!/^Dialogue:/i.test(line)) continue;
        const parts = line.slice(9).split(',');
        const fields = [...parts.slice(0, format.length - 1), parts.slice(format.length - 1).join(',')];
        const start = clock(fields[format.indexOf('start')]); const end = clock(fields[format.indexOf('end')]);
        const body = cleanAss(fields[format.length - 1] || '');
        if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: body });
    }
    return cues;
}
function parseLrc(text) {
    const lines = [];
    for (const line of text.replace(/\r/g, '').split('\n')) {
        const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
        const body = line.replace(/\[[^\]]*\]/g, '').trim();
        if (!stamps.length || !body) continue;
        for (const stamp of stamps) lines.push({ start: Number(stamp[1]) * 60 + Number(stamp[2]) + (stamp[3] ? Number(stamp[3].padEnd(3, '0')) / 1000 : 0), text: body });
    }
    lines.sort((a, b) => a.start - b.start);
    return lines.map((line, index) => ({ ...line, end: Math.min(line.start + 12, lines[index + 1]?.start ?? line.start + 6) }));
}
/** Cues of a subtitle file's text, by what it looks like (the name only breaks a tie). */
export function parseSubtitleText(text, name = '') {
    const body = String(text || '').replace(/^﻿/, '');
    let cues;
    if (/^\s*\[Script Info\]/i.test(body) || /\nDialogue:/i.test(body) || /\.(ass|ssa)$/i.test(name)) cues = parseAssFile(body);
    else if (body.includes('-->')) cues = parseTimed(body);
    else cues = parseLrc(body);
    return finish(cues);
}

function finish(cues) {
    const sorted = cues.filter((cue) => cue.text && Number.isFinite(cue.start)).sort((a, b) => a.start - b.start).slice(0, MAX_CUES);
    // A cue without an end stays until the next one, a few seconds at most.
    sorted.forEach((cue, index) => { if (!(cue.end > cue.start)) cue.end = Math.min(cue.start + 5, sorted[index + 1]?.start ?? cue.start + 5); });
    return sorted;
}
const stamp = (seconds) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const pad = (value, width = 2) => String(value).padStart(width, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};
export function cuesToVtt(cues) {
    const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n{2,}/g, '\n');
    return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start)} --> ${stamp(cue.end)}\n${escape(cue.text)}`).join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------------
// MP4 / QuickTime
// ---------------------------------------------------------------------------------
const fourcc = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const u64 = (bytes, at) => u32(bytes, at) * 4294967296 + u32(bytes, at + 4);
function* boxes(bytes, start, end) {
    let at = start;
    while (at + 8 <= end) {
        let size = u32(bytes, at); let header = 8;
        if (size === 1) { size = u64(bytes, at + 8); header = 16; } else if (size === 0) size = end - at;
        if (size < header || at + size > end) return;
        yield { type: fourcc(bytes, at + 4), start: at + header, end: at + size };
        at += size;
    }
}
const child = (bytes, box, type) => { for (const item of boxes(bytes, box.start, box.end)) if (item.type === type) return item; return null; };

async function mp4Subtitles(blob) {
    // The index of the file (moov) may come before or after the media data.
    let moov = null;
    for (let at = 0; at + 8 <= blob.size;) {
        const head = await slice(blob, at, 16);
        let size = u32(head, 0); let header = 8;
        if (size === 1) { size = u64(head, 8); header = 16; } else if (size === 0) size = blob.size - at;
        if (size < header) break;
        if (fourcc(head, 4) === 'moov') { if (size <= 128_000_000) moov = await slice(blob, at + header, size - header); break; }
        at += size;
    }
    if (!moov) return [];
    const tracks = [];
    for (const trak of boxes(moov, 0, moov.length)) {
        if (trak.type !== 'trak' || tracks.length >= MAX_TRACKS) continue;
        const mdia = child(moov, trak, 'mdia'); const hdlr = mdia && child(moov, mdia, 'hdlr'); const mdhd = mdia && child(moov, mdia, 'mdhd');
        if (!hdlr || !mdhd || !['sbtl', 'subt', 'text'].includes(fourcc(moov, hdlr.start + 8))) continue;
        const stbl = (() => { const minf = child(moov, mdia, 'minf'); return minf && child(moov, minf, 'stbl'); })();
        const tables = stbl && Object.fromEntries(['stsd', 'stts', 'stsc', 'stsz', 'stco', 'co64'].map((type) => [type, child(moov, stbl, type)]));
        if (!tables?.stsd || !tables.stts || !tables.stsc || !tables.stsz || !(tables.stco || tables.co64)) continue;
        const format = fourcc(moov, tables.stsd.start + 12);
        if (!['tx3g', 'text', 'wvtt'].includes(format)) continue;
        const wide = moov[mdhd.start] === 1;
        const timescale = u32(moov, mdhd.start + (wide ? 20 : 12)) || 1000;
        const packed = (moov[mdhd.start + (wide ? 32 : 20)] << 8) | moov[mdhd.start + (wide ? 33 : 21)];
        const language = [10, 5, 0].map((shift) => String.fromCharCode(((packed >> shift) & 31) + 0x60)).join('');
        // Where each sample is, and when.
        const count = Math.min(u32(moov, tables.stsz.start + 8), MAX_CUES * 2);
        const fixed = u32(moov, tables.stsz.start + 4);
        const sizeOf = (index) => fixed || u32(moov, tables.stsz.start + 12 + index * 4);
        const chunkCount = u32(moov, (tables.stco || tables.co64).start + 4);
        const chunkOffset = (index) => (tables.stco ? u32(moov, tables.stco.start + 8 + index * 4) : u64(moov, tables.co64.start + 8 + index * 8));
        const runs = Array.from({ length: u32(moov, tables.stsc.start + 4) }, (_unused, index) => ({ first: u32(moov, tables.stsc.start + 8 + index * 12), perChunk: u32(moov, tables.stsc.start + 12 + index * 12) }));
        const samples = [];
        for (let chunk = 1, run = 0; chunk <= chunkCount && samples.length < count; chunk += 1) {
            while (run + 1 < runs.length && runs[run + 1].first <= chunk) run += 1;
            let offset = chunkOffset(chunk - 1);
            for (let n = 0; n < (runs[run]?.perChunk || 0) && samples.length < count; n += 1) { const size = sizeOf(samples.length); samples.push({ offset, size }); offset += size; }
        }
        let time = 0; let sample = 0;
        for (let entry = 0, entries = u32(moov, tables.stts.start + 4); entry < entries && sample < samples.length; entry += 1) {
            const repeat = u32(moov, tables.stts.start + 8 + entry * 8); const delta = u32(moov, tables.stts.start + 12 + entry * 8);
            for (let n = 0; n < repeat && sample < samples.length; n += 1, sample += 1) { samples[sample].start = time / timescale; time += delta; samples[sample].end = time / timescale; }
        }
        const cues = [];
        // Empty samples are the gaps between lines: only the ones that carry text are read.
        const wanted = samples.filter((item) => item.size > (format === 'wvtt' ? 8 : 2) && item.size < 65536 && Number.isFinite(item.start));
        for (let at = 0; at < wanted.length; at += 48) {
            const batch = wanted.slice(at, at + 48);
            const data = await Promise.all(batch.map((item) => slice(blob, item.offset, item.size)));
            batch.forEach((item, index) => {
                const bytes = data[index]; let text = '';
                if (format === 'wvtt') { for (const cue of boxes(bytes, 0, bytes.length)) if (cue.type === 'vttc') { const payload = child(bytes, cue, 'payl'); if (payload) text += `${text ? '\n' : ''}${decode(bytes.subarray(payload.start, payload.end))}`; } }
                else { const length = (bytes[0] << 8) | bytes[1]; text = decode(bytes.subarray(2, Math.min(bytes.length, 2 + length))); }
                text = cleanMarkup(text);
                if (text) cues.push({ start: item.start, end: item.end, text });
            });
        }
        if (cues.length) tracks.push({ language: language === 'und' ? '' : language, label: '', cues: finish(cues) });
    }
    return tracks;
}

// ---------------------------------------------------------------------------------
// Matroska / WebM
// ---------------------------------------------------------------------------------
const ID = { segment: 0x18538067, info: 0x1549a966, scale: 0x2ad7b1, tracks: 0x1654ae6b, entry: 0xae, number: 0xd7, kind: 0x83, codec: 0x86, language: 0x22b59c, name: 0x536e,
    cluster: 0x1f43b675, timecode: 0xe7, simple: 0xa3, group: 0xa0, block: 0xa1, duration: 0x9b };
const TEXT_CODECS = { 'S_TEXT/UTF8': 'srt', 'S_TEXT/ASS': 'ass', 'S_TEXT/SSA': 'ass', 'S_TEXT/WEBVTT': 'vtt', 'D_WEBVTT/SUBTITLES': 'vtt' };
const WINDOW = 4 * 1024 * 1024;

async function matroskaSubtitles(blob, budgetMs = 30000) {
    // The file is read in windows; elements that are skipped (video, audio) never have to be in one.
    let base = 0; let buffer = new Uint8Array(0);
    const need = async (at, length) => {
        if (at < base || at + length > base + buffer.length) { base = at; buffer = await slice(blob, at, Math.max(WINDOW, length)); }
        return at + length <= base + buffer.length;
    };
    const vint = async (at, keepMarker) => {
        if (!(await need(at, 1))) return null;
        const first = buffer[at - base]; let length = 1;
        while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
        if (length > 8 || !(await need(at, length))) return null;
        let value = keepMarker ? first : first & (0xff >> length); let unknown = !keepMarker && value === (0xff >> length);
        for (let n = 1; n < length; n += 1) { const byte = buffer[at - base + n]; value = value * 256 + byte; if (byte !== 0xff) unknown = false; }
        return { value, length, unknown };
    };
    const element = async (at) => {
        const id = await vint(at, true); if (!id) return null;
        const size = await vint(at + id.length, false); if (!size) return null;
        return { id: id.value, data: at + id.length + size.length, size: size.unknown ? Infinity : size.value };
    };
    const uint = (bytes) => bytes.reduce((value, byte) => value * 256 + byte, 0);
    const bytesAt = async (at, length) => ((await need(at, length)) ? buffer.subarray(at - base, at - base + length) : new Uint8Array(0));

    const head = await element(0);
    if (!head || head.id !== 0x1a45dfa3) return [];
    const segment = await element(head.data + head.size);
    if (!segment || segment.id !== ID.segment) return [];
    const end = Math.min(blob.size, segment.data + segment.size);
    const tracks = new Map(); // track number -> { format, language, label, cues }
    let scale = 1_000_000; let clusterTime = 0;
    const deadline = performance.now() + budgetMs;

    const readBlock = async (at, size, duration) => {
        const number = await vint(at, false);
        const track = number && tracks.get(number.value);
        if (!track || size > 65536 || track.cues.length >= MAX_CUES) return;
        const header = await bytesAt(at + number.length, 3);
        const relative = ((header[0] << 8) | header[1]) << 16 >> 16;
        const start = (clusterTime + relative) * scale / 1e9;
        const raw = decode((await bytesAt(at + number.length + 3, size - number.length - 3)).slice());
        const text = track.format === 'ass' ? cleanAss(raw.split(',').slice(8).join(',')) : cleanMarkup(raw);
        if (text) track.cues.push({ start, end: duration ? start + duration * scale / 1e9 : 0, text });
    };
    for (let at = segment.data; at < end;) {
        const item = await element(at);
        if (!item) break;
        if (item.id === ID.info || item.id === ID.tracks) {
            if (item.size > 16_000_000) break;
            const bytes = (await bytesAt(item.data, item.size)).slice();
            const inside = function* (from, to) { for (let p = from; p < to;) { let l = 1; while (l <= 4 && !(bytes[p] & (0x80 >> (l - 1)))) l += 1; let id = 0; for (let n = 0; n < l; n += 1) id = id * 256 + bytes[p + n]; p += l; let s = 1; while (s <= 8 && !(bytes[p] & (0x80 >> (s - 1)))) s += 1; let size = bytes[p] & (0xff >> s); for (let n = 1; n < s; n += 1) size = size * 256 + bytes[p + n]; p += s; if (p + size > to) return; yield { id, start: p, end: p + size }; p += size; } };
            if (item.id === ID.info) { for (const field of inside(0, bytes.length)) if (field.id === ID.scale) scale = uint(bytes.subarray(field.start, field.end)) || scale; }
            else for (const entry of inside(0, bytes.length)) {
                if (entry.id !== ID.entry) continue;
                const info = {};
                for (const field of inside(entry.start, entry.end)) {
                    const value = bytes.subarray(field.start, field.end);
                    if (field.id === ID.number) info.number = uint(value); else if (field.id === ID.kind) info.kind = uint(value);
                    else if (field.id === ID.codec) info.codec = utf8.decode(value).replace(/\0+$/, ''); else if (field.id === ID.language) info.language = utf8.decode(value).replace(/\0+$/, '');
                    else if (field.id === ID.name) info.label = utf8.decode(value).replace(/\0+$/, '');
                }
                if (info.kind === 0x11 && TEXT_CODECS[info.codec] && tracks.size < MAX_TRACKS) tracks.set(info.number, { format: TEXT_CODECS[info.codec], language: info.language && info.language !== 'und' ? info.language : '', label: info.label || '', cues: [] });
            }
            at = item.data + item.size;
        } else if (item.id === ID.cluster) {
            // No text track was declared before the first cluster: there is nothing to look for.
            if (!tracks.size || performance.now() > deadline) break;
            const clusterEnd = Math.min(end, item.data + item.size);
            for (let p = item.data; p < clusterEnd;) {
                const part = await element(p);
                if (!part || part.size === Infinity) { p = clusterEnd; break; }
                if (part.id === ID.cluster || part.id === ID.segment) { break; } // a cluster of unknown size ended
                if (part.id === ID.timecode) clusterTime = uint(await bytesAt(part.data, part.size));
                else if (part.id === ID.simple) await readBlock(part.data, part.size, 0);
                else if (part.id === ID.group) {
                    let block = null; let duration = 0;
                    for (let g = part.data; g < part.data + part.size;) {
                        const field = await element(g);
                        if (!field || field.size === Infinity) break;
                        if (field.id === ID.block) block = field; else if (field.id === ID.duration) duration = uint(await bytesAt(field.data, field.size));
                        g = field.data + field.size;
                    }
                    if (block) await readBlock(block.data, block.size, duration);
                }
                p = part.data + part.size;
                if (item.size === Infinity && p >= end) break;
            }
            at = item.size === Infinity ? end : clusterEnd;
            if (item.size === Infinity) break;
        } else at = item.size === Infinity ? end : item.data + item.size;
    }
    return [...tracks.values()].filter((track) => track.cues.length).map((track) => ({ language: track.language, label: track.label, cues: finish(track.cues) }));
}

/**
 * The text tracks stored in a video file: [{ language, label, vtt }]. Never throws; a file
 * that is not understood simply has none.
 */
export async function extractSubtitles(blob) {
    try {
        const head = await slice(blob, 0, 12);
        const tracks = u32(head, 0) === 0x1a45dfa3 ? await matroskaSubtitles(blob) : ['ftyp', 'moov', 'free', 'mdat', 'wide', 'skip'].includes(fourcc(head, 4)) ? await mp4Subtitles(blob) : [];
        return tracks.map((track) => ({ language: track.language, label: track.label, vtt: cuesToVtt(track.cues) }));
    } catch { return []; }
}
