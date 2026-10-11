// Reads title / artist / album / track number / embedded artwork from audio files.
// Supports ID3v2.2–2.4 (MP3), MP4 atoms (M4A / AAC) and FLAC metadata blocks. Runs on
// the host side when a file enters an application's file store, so apps get tags and
// cover art without ever loading the audio into their sandbox.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function decodeLegacy(bytes) {
    // "ISO-8859-1" fields in the wild frequently hold UTF-8 or a local code page.
    if (!bytes.some((byte) => byte > 0x7f)) return latin1.decode(bytes);
    for (const label of ['utf-8', 'gbk', 'shift_jis']) {
        try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch { /* try the next one */ }
    }
    return latin1.decode(bytes);
}
function decodeText(bytes, encoding) {
    try {
        if (encoding === 1) return new TextDecoder('utf-16').decode(bytes);
        if (encoding === 2) return new TextDecoder('utf-16be').decode(bytes);
        if (encoding === 3) return utf8.decode(bytes);
    } catch { /* fall through */ }
    return decodeLegacy(bytes);
}
const clean = (text) => String(text || '').replace(/\u0000+/g, ' ').trim().slice(0, 300);
const syncsafe = (view, offset) => ((view.getUint8(offset) & 0x7f) << 21) | ((view.getUint8(offset + 1) & 0x7f) << 14) | ((view.getUint8(offset + 2) & 0x7f) << 7) | (view.getUint8(offset + 3) & 0x7f);
function terminator(bytes, start, encoding) {
    const wide = encoding === 1 || encoding === 2;
    for (let i = start; i < bytes.length - (wide ? 1 : 0); i += wide ? 2 : 1) {
        if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return { end: i, next: i + (wide ? 2 : 1) };
    }
    return { end: bytes.length, next: bytes.length };
}
const imageBlob = (bytes, mime) => {
    if (!bytes?.length) return null;
    const type = /png/i.test(mime) || (bytes[0] === 0x89 && bytes[1] === 0x50) ? 'image/png' : (/webp/i.test(mime) ? 'image/webp' : 'image/jpeg');
    return new Blob([bytes], { type });
};

async function readId3(blob) {
    const head = new DataView(await blob.slice(0, 10).arrayBuffer());
    if (head.byteLength < 10 || latin1.decode(new Uint8Array(head.buffer, 0, 3)) !== 'ID3') return null;
    const major = head.getUint8(3);
    const flags = head.getUint8(5);
    const size = Math.min(syncsafe(head, 6), 24_000_000);
    const bytes = new Uint8Array(await blob.slice(10, 10 + size).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const tags = {};
    let offset = 0;
    if (flags & 0x40 && major >= 3) offset += major === 4 ? syncsafe(view, 0) : view.getUint32(0) + 4;
    const idLength = major === 2 ? 3 : 4;
    const names = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TRCK: 'track', TRK: 'track', TDRC: 'year', TYER: 'year', TYE: 'year', TPE2: 'albumArtist', TP2: 'albumArtist' };
    while (offset + idLength + (major === 2 ? 3 : 6) <= bytes.length) {
        const id = latin1.decode(bytes.subarray(offset, offset + idLength));
        if (!/^[A-Z0-9]+$/.test(id)) break;
        let frameSize; let headerSize;
        if (major === 2) { frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]; headerSize = 6; }
        else { frameSize = major === 4 ? syncsafe(view, offset + 4) : view.getUint32(offset + 4); headerSize = 10; }
        const start = offset + headerSize;
        if (frameSize <= 0 || start + frameSize > bytes.length) break;
        const frame = bytes.subarray(start, start + frameSize);
        if (names[id]) tags[names[id]] = clean(decodeText(frame.subarray(1), frame[0]));
        else if ((id === 'APIC' || id === 'PIC') && !tags.picture) {
            const encoding = frame[0];
            let cursor; let mime;
            if (id === 'PIC') { mime = latin1.decode(frame.subarray(1, 4)); cursor = 4; }
            else { const end = terminator(frame, 1, 0); mime = latin1.decode(frame.subarray(1, end.end)); cursor = end.next; }
            cursor += 1; // picture type
            cursor = terminator(frame, cursor, encoding).next; // description
            tags.picture = imageBlob(frame.slice(cursor), mime);
        }
        offset = start + frameSize;
    }
    return tags;
}

async function readMp4(blob) {
    // Find the top-level 'moov' atom without reading the audio data.
    let offset = 0; let moov = null;
    for (let guard = 0; guard < 64 && offset + 8 <= blob.size; guard += 1) {
        const header = new DataView(await blob.slice(offset, offset + 16).arrayBuffer());
        let size = header.getUint32(0);
        const type = latin1.decode(new Uint8Array(header.buffer, 4, 4));
        if (size === 1 && header.byteLength >= 16) size = Number(header.getBigUint64(8));
        if (size === 0) size = blob.size - offset;
        if (size < 8) return null;
        if (type === 'moov') { moov = new Uint8Array(await blob.slice(offset + 8, offset + Math.min(size, 40_000_000)).arrayBuffer()); break; }
        offset += size;
    }
    if (!moov) return null;
    const find = (bytes, name, skip = 0) => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let at = skip; at + 8 <= bytes.length;) {
            const size = view.getUint32(at);
            if (size < 8 || at + size > bytes.length) return null;
            if (latin1.decode(bytes.subarray(at + 4, at + 8)) === name) return bytes.subarray(at + 8, at + size);
            at += size;
        }
        return null;
    };
    const udta = find(moov, 'udta'); const meta = udta && find(udta, 'meta'); const ilst = meta && find(meta, 'ilst', 4);
    if (!ilst) return {};
    const tags = {};
    const names = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', 'aART': 'albumArtist', '©day': 'year' };
    const view = new DataView(ilst.buffer, ilst.byteOffset, ilst.byteLength);
    for (let at = 0; at + 8 <= ilst.length;) {
        const size = view.getUint32(at);
        if (size < 8 || at + size > ilst.length) break;
        const name = latin1.decode(ilst.subarray(at + 4, at + 8));
        const data = find(ilst.subarray(at + 8, at + size), 'data');
        if (data && data.length > 8) {
            const kind = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0) & 0xffffff;
            const payload = data.subarray(8);
            if (names[name] && kind === 1) tags[names[name]] = clean(utf8.decode(payload));
            else if (name === 'trkn' && payload.length >= 4) tags.track = String((payload[2] << 8) | payload[3]);
            else if (name === 'covr' && !tags.picture) tags.picture = imageBlob(payload.slice(), kind === 14 ? 'image/png' : 'image/jpeg');
        }
        at += size;
    }
    return tags;
}

async function readFlac(blob) {
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 24_000_000)).arrayBuffer());
    if (latin1.decode(bytes.subarray(0, 4)) !== 'fLaC') return null;
    const view = new DataView(bytes.buffer);
    const tags = {};
    for (let at = 4; at + 4 <= bytes.length;) {
        const header = bytes[at]; const length = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
        const start = at + 4; const type = header & 0x7f;
        if (start + length > bytes.length) break;
        if (type === 4) {
            let cursor = start + 4 + view.getUint32(start, true);
            const count = view.getUint32(cursor, true); cursor += 4;
            for (let i = 0; i < count && cursor + 4 <= start + length; i += 1) {
                const size = view.getUint32(cursor, true); cursor += 4;
                const [key, ...rest] = utf8.decode(bytes.subarray(cursor, cursor + size)).split('=');
                const name = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', TRACKNUMBER: 'track', DATE: 'year', ALBUMARTIST: 'albumArtist' }[key.toUpperCase()];
                if (name && !tags[name]) tags[name] = clean(rest.join('='));
                cursor += size;
            }
        } else if (type === 6 && !tags.picture) {
            let cursor = start + 4;
            const mimeLength = view.getUint32(cursor); cursor += 4;
            const mime = latin1.decode(bytes.subarray(cursor, cursor + mimeLength)); cursor += mimeLength;
            cursor += 4 + view.getUint32(cursor) + 16;
            const dataLength = view.getUint32(cursor); cursor += 4;
            tags.picture = imageBlob(bytes.slice(cursor, cursor + dataLength), mime);
        }
        if (header & 0x80) break;
        at = start + length;
    }
    return tags;
}

/** -> { title?, artist?, album?, albumArtist?, track?, year?, picture?: Blob } (empty when nothing is found) */
export async function readAudioTags(blob) {
    try {
        const magic = latin1.decode(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
        let tags = null;
        if (magic.startsWith('ID3')) tags = await readId3(blob);
        else if (magic.startsWith('fLaC')) tags = await readFlac(blob);
        else if (magic.slice(4, 8) === 'ftyp') tags = await readMp4(blob);
        if (!tags) return {};
        if (tags.track) tags.track = String(parseInt(tags.track, 10) || '') || undefined;
        if (tags.year) tags.year = (String(tags.year).match(/\d{4}/) || [''])[0] || undefined;
        for (const key of Object.keys(tags)) if (tags[key] === undefined || tags[key] === '') delete tags[key];
        return tags;
    } catch {
        return {};
    }
}
