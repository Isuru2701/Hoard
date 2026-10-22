/** Minimal ZIP writer (deflate when the browser supports it, otherwise stored). */
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const cs = new CompressionStream('deflate-raw' as CompressionFormat);
        const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(cs);
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

export interface ZipInput {
    path: string;
    data: Uint8Array;
}

export async function makeZip(files: ZipInput[]): Promise<Blob> {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
        const name = enc.encode(f.path);
        const crc = crc32(f.data);
        let method = 0;
        let body = f.data;
        if (f.data.length > 128) {
            const d = await deflate(f.data);
            if (d && d.length < f.data.length) {
                method = 8;
                body = d;
            }
        }
        const lh = new Uint8Array(30 + name.length);
        const v = new DataView(lh.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x0800, true);
        v.setUint16(8, method, true);
        v.setUint16(10, time, true);
        v.setUint16(12, date, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, body.length, true);
        v.setUint32(22, f.data.length, true);
        v.setUint16(26, name.length, true);
        lh.set(name, 30);
        parts.push(lh, body);

        const ch = new Uint8Array(46 + name.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, method, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, body.length, true);
        cv.setUint32(24, f.data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        ch.set(name, 46);
        central.push(ch);
        offset += lh.length + body.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end] as unknown as BlobPart[], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
}
