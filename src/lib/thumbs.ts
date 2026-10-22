/** Thumbnail generation + cache (IndexedDB). Semantic tags come from the selected model. */
import { idbGet, idbSet } from './idb.ts';
import { getFile, type Dir } from './fs.ts';

export interface ThumbRec {
    blob: Blob;
    w: number;
    h: number;
    tags: string[];
}
export interface MediaRef {
    path: string;
    size: number;
    modified: number;
    kind: 'image' | 'video' | 'file';
}

const pending = new Map<string, Promise<ThumbRec | null>>();
const urls = new Map<string, string>();
const dims = new Map<string, { w: number; h: number }>();
let dimsVersion = 0;
const dimsListeners = new Set<() => void>();
let notifyTimer = 0;

export function subscribeDims(l: () => void) {
    dimsListeners.add(l);
    return () => {
        dimsListeners.delete(l);
    };
}
export const getDimsVersion = () => dimsVersion;
export const getDims = (path: string) => dims.get(path);
export function clearDims() {
    dims.clear();
}
function setDims(path: string, w: number, h: number) {
    const d = dims.get(path);
    if (d && d.w === w && d.h === h) return;
    dims.set(path, { w, h });
    if (!notifyTimer) {
        notifyTimer = window.setTimeout(() => {
            notifyTimer = 0;
            dimsVersion++;
            dimsListeners.forEach((l) => l());
        }, 120);
    }
}

let active = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= 4) await new Promise<void>((r) => waiters.push(r));
    active++;
    try {
        return await fn();
    } finally {
        active--;
        waiters.pop()?.(); // LIFO: most recently requested (visible) first
    }
}

const key = (wsId: string, m: MediaRef) => `${wsId}|${m.path}|${m.size}|${m.modified}`;

export function getThumb(wsId: string, root: Dir, m: MediaRef): Promise<ThumbRec | null> {
    const k = key(wsId, m);
    let p = pending.get(k);
    if (!p) {
        p = (async () => {
            const cached = await idbGet<ThumbRec>('thumbs', k);
            if (cached && cached.blob) {
                setDims(m.path, cached.w, cached.h);
                return cached;
            }
            const rec = await withSlot(async () => generate(await getFile(root, m.path), m.kind === 'video'));
            if (rec) {
                setDims(m.path, rec.w, rec.h);
                void idbSet('thumbs', k, rec);
            }
            return rec;
        })().catch((err) => {
            console.warn('[thumbs] failed', m.path, err);
            return null;
        });
        pending.set(k, p);
    }
    return p;
}

export async function getThumbUrl(wsId: string, root: Dir, m: MediaRef): Promise<string | null> {
    const k = key(wsId, m);
    const u = urls.get(k);
    if (u) return u;
    const rec = await getThumb(wsId, root, m);
    if (!rec) return null;
    const url = urls.get(k) ?? URL.createObjectURL(rec.blob);
    urls.set(k, url);
    return url;
}

interface Source {
    el: CanvasImageSource;
    w: number;
    h: number;
    done: () => void;
}

function loadImage(file: File): Promise<Source> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    return img.decode().then(
        () => ({ el: img, w: img.naturalWidth || 1024, h: img.naturalHeight || 1024, done: () => URL.revokeObjectURL(url) }),
        (e) => {
            URL.revokeObjectURL(url);
            throw e;
        }
    );
}

function videoFrame(file: File): Promise<Source> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        const fail = () => {
            URL.revokeObjectURL(url);
            reject(new Error('video'));
        };
        const t = setTimeout(fail, 10000);
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.onloadeddata = () => {
            v.currentTime = Math.min(1, (v.duration || 2) * 0.1);
        };
        v.onseeked = () => {
            clearTimeout(t);
            resolve({ el: v, w: v.videoWidth || 640, h: v.videoHeight || 360, done: () => URL.revokeObjectURL(url) });
        };
        v.onerror = () => {
            clearTimeout(t);
            fail();
        };
        v.src = url;
    });
}

async function generate(file: File, video: boolean): Promise<ThumbRec | null> {
    const src = video ? await videoFrame(file) : await loadImage(file);
    try {
        const s = Math.min(1, 480 / Math.max(src.w, src.h));
        const cw = Math.max(1, Math.round(src.w * s));
        const ch = Math.max(1, Math.round(src.h * s));
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(src.el, 0, 0, cw, ch);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.82));
        if (!blob) return null;
        return { blob, w: src.w, h: src.h, tags: [] };
    } finally {
        src.done();
    }
}
