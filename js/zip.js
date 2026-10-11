// Minimal ZIP reader/writer for application archives (macos.archive).
// Writing stores entries uncompressed — the usual payload (audio, images) is already
// compressed. Reading handles stored and deflated entries. ZIP64 is not supported.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

export function cleanArchivePath(value) {
    const parts = String(value || '').replaceAll('\\', '/').split('/').filter((part) => part && part !== '.' && part !== '..');
    return parts.join('/').replace(/[\u0000-\u001f]/g, '').slice(0, 240);
}

/** entries: [{ path, blob }] -> Blob (application/zip) */
/** onProgress(done, total, path) is called after each entry has been added. */
export async function createZip(entries, onProgress = null) {
    const encoder = new TextEncoder();
    const { time, day } = dosDateTime();
    const parts = [];
    const central = [];
    let offset = 0;
    const seen = new Set();
    for (const entry of entries) {
        let path = cleanArchivePath(entry.path) || 'file';
        while (seen.has(path)) path = path.replace(/(\.[^./]*)?$/, (ext) => `-${seen.size}${ext || ''}`);
        seen.add(path);
        const name = encoder.encode(path);
        const data = new Uint8Array(await entry.blob.arrayBuffer());
        if (offset + data.length > 0xfffffff0) throw new Error('Archive would exceed 4 GB');
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
        local.setUint16(10, time, true); local.setUint16(12, day, true); local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
        // The entry's bytes stay in its (disk-backed) blob; only the headers are held in memory.
        parts.push(local.buffer, name, entry.blob);
        try { onProgress?.(seen.size, entries.length, path); } catch { /* progress is cosmetic */ }
        const header = new DataView(new ArrayBuffer(46));
        header.setUint32(0, 0x02014b50, true); header.setUint16(4, 20, true); header.setUint16(6, 20, true); header.setUint16(8, 0x0800, true); header.setUint16(10, 0, true);
        header.setUint16(12, time, true); header.setUint16(14, day, true); header.setUint32(16, crc, true);
        header.setUint32(20, data.length, true); header.setUint32(24, data.length, true); header.setUint16(28, name.length, true);
        header.setUint32(42, offset, true);
        central.push(header.buffer, name);
        offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, seen.size, true); end.setUint16(10, seen.size, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Blob -> [{ path, blob }] */
export async function readZip(blob, { maxEntries = 20000, maxBytes = 4_000_000_000 } = {}) {
    const tailSize = Math.min(blob.size, 65557);
    const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
    let endAt = -1;
    for (let i = tail.byteLength - 22; i >= 0; i -= 1) if (tail.getUint32(i, true) === 0x06054b50) { endAt = i; break; }
    if (endAt < 0) throw new Error('Not a ZIP archive');
    const count = tail.getUint16(endAt + 10, true);
    const centralSize = tail.getUint32(endAt + 12, true);
    const centralOffset = tail.getUint32(endAt + 16, true);
    if (count > maxEntries) throw new Error(`Archive has more than ${maxEntries} entries`);
    const central = new DataView(await blob.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
    const decoder = new TextDecoder();
    const out = [];
    let cursor = 0;
    let total = 0;
    for (let n = 0; n < count; n += 1) {
        if (cursor + 46 > central.byteLength || central.getUint32(cursor, true) !== 0x02014b50) throw new Error('Corrupt ZIP archive');
        const method = central.getUint16(cursor + 10, true);
        const compressed = central.getUint32(cursor + 20, true);
        const size = central.getUint32(cursor + 24, true);
        const nameLength = central.getUint16(cursor + 28, true);
        const extraLength = central.getUint16(cursor + 30, true);
        const commentLength = central.getUint16(cursor + 32, true);
        const localOffset = central.getUint32(cursor + 42, true);
        const path = cleanArchivePath(decoder.decode(new Uint8Array(central.buffer, central.byteOffset + cursor + 46, nameLength)));
        cursor += 46 + nameLength + extraLength + commentLength;
        if (!path || path.endsWith('/') || (size === 0 && compressed === 0 && /\/$/.test(path))) continue;
        total += size;
        if (total > maxBytes) throw new Error('Archive is too large');
        const local = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
        if (local.getUint32(0, true) !== 0x04034b50) throw new Error('Corrupt ZIP archive');
        const dataStart = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        const raw = blob.slice(dataStart, dataStart + compressed);
        let data;
        if (method === 0) data = raw;
        else if (method === 8) data = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        else throw new Error(`Unsupported ZIP compression method ${method}`);
        out.push({ path, blob: data });
    }
    return out;
}
