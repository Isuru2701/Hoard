/** Loads canvas images: small cached thumbnails first, full resolution when zoomed in. */
import { getThumb } from '../lib/thumbs.ts';
import { getDir, getFile, joinPath, kindOf, sanitizeName, uniqueName, writeIn, type Dir } from '../lib/fs.ts';
import type { ImageProvider } from './engine.ts';
import type { CanvasDoc } from './types.ts';
import { readText, writeFile } from '../lib/fs.ts';

export async function bitmapFromFile(file: File): Promise<ImageBitmap | null> {
    try {
        return await createImageBitmap(file);
    } catch {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d')!.drawImage(img, 0, 0, w, h);
            return await createImageBitmap(c);
        } catch {
            return null;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

/** Shared decoded-bitmap caches: survive closing/switching canvases within a session.
 *  Keys are (workspace | assets folder | asset file); asset filenames are never reused
 *  (paste picks a fresh name on collision), so path keys stay valid. */
const sharedThumbs = new Map<string, ImageBitmap>();
const sharedFulls = new Map<string, ImageBitmap>();
const SHARED_THUMB_CAP = 120;
const SHARED_FULL_CAP = 12;

function sharedKey(wsId: string, assetsPath: string, asset: string): string {
    return `${wsId}\u0000${assetsPath}\u0000${asset}`;
}

function lruGet(map: Map<string, ImageBitmap>, key: string): ImageBitmap | undefined {
    const v = map.get(key);
    if (v === undefined) return undefined;
    map.delete(key);
    map.set(key, v); // reinsert => most recently used
    return v;
}

function lruPut(map: Map<string, ImageBitmap>, key: string, bmp: ImageBitmap, cap: number) {
    map.delete(key);
    map.set(key, bmp);
    while (map.size > cap) {
        const [k, v] = map.entries().next().value as [string, ImageBitmap];
        map.delete(k);
        v.close(); // evicted bitmaps are gone; they load again on demand
    }
}

export class AssetImages implements ImageProvider {
    private failedThumbs = new Set<string>();
    private loadingThumbs = new Set<string>();
    private loadingFull = new Set<string>();
    private queue: (() => Promise<void>)[] = [];
    private active = 0;
    private dead = false;

    constructor(private wsId: string, private root: Dir, private assetsPath: string, private onLoad: () => void) {}

    private key(asset: string): string {
        return sharedKey(this.wsId, this.assetsPath, asset);
    }

    get(asset: string, px: number): ImageBitmap | null {
        const key = this.key(asset);
        if (px > 640 && kindOf(asset) !== 'video') {
            const f = lruGet(sharedFulls, key);
            if (f) return f;
            this.requestFull(asset);
        }
        const t = lruGet(sharedThumbs, key);
        if (t) return t;
        // negative cache: remember decode failures so we don't requeue forever
        if (!this.failedThumbs.has(asset)) this.requestThumb(asset);
        return null;
    }

    async full(asset: string): Promise<ImageBitmap | null> {
        const key = this.key(asset);
        const f = lruGet(sharedFulls, key);
        if (f) return f;
        try {
            if (kindOf(asset) === 'video') return lruGet(sharedThumbs, key) ?? null;
            return await bitmapFromFile(await getFile(this.root, joinPath(this.assetsPath, asset)));
        } catch {
            return null;
        }
    }

    private enqueue(job: () => Promise<void>) {
        this.queue.push(job);
        this.pump();
    }
    private pump() {
        while (this.active < 6 && this.queue.length) {
            const job = this.queue.pop()!;
            this.active++;
            job().finally(() => {
                this.active--;
                this.pump();
            });
        }
    }

    private requestThumb(asset: string) {
        if (this.loadingThumbs.has(asset)) return;
        this.loadingThumbs.add(asset);
        this.enqueue(async () => {
            if (this.dead) return;
            try {
                const path = joinPath(this.assetsPath, asset);
                const file = await getFile(this.root, path);
                const rec = await getThumb(this.wsId, this.root, { path, size: file.size, modified: file.lastModified, kind: kindOf(asset) === 'video' ? 'video' : 'image' });
                const bmp = rec ? await createImageBitmap(rec.blob) : null;
                if (bmp) lruPut(sharedThumbs, this.key(asset), bmp, SHARED_THUMB_CAP);
                else this.failedThumbs.add(asset);
            } catch {
                this.failedThumbs.add(asset);
            }
            this.loadingThumbs.delete(asset);
            if (!this.dead) this.onLoad();
        });
    }

    private requestFull(asset: string) {
        if (this.loadingFull.has(asset)) return;
        this.loadingFull.add(asset);
        this.enqueue(async () => {
            if (this.dead) return;
            const bmp = await this.full(asset);
            this.loadingFull.delete(asset);
            if (!bmp || this.dead) return;
            lruPut(sharedFulls, this.key(asset), bmp, SHARED_FULL_CAP);
            this.onLoad();
        });
    }

    destroy() {
        this.dead = true;
        this.loadingThumbs.clear();
        this.loadingFull.clear();
        this.failedThumbs.clear();
        this.queue.length = 0;
        // shared bitmaps stay alive for the next canvas that uses them
    }
}

// ---------------------------------------------------------------- canvas files

export async function loadCanvasDoc(root: Dir, path: string): Promise<CanvasDoc> {
    const t = await readText(root, path);
    if (t) {
        try {
            const d = JSON.parse(t) as CanvasDoc;
            if (Array.isArray(d.elements)) return d;
        } catch {
            /* corrupted: start fresh */
        }
    }
    return { version: 1, elements: [] };
}

export async function saveCanvasDoc(root: Dir, path: string, doc: CanvasDoc): Promise<void> {
    await writeFile(root, path, JSON.stringify(doc));
}

export async function mediaDims(file: File, video: boolean): Promise<{ w: number; h: number }> {
    if (video)
        return new Promise((res) => {
            const v = document.createElement('video');
            const url = URL.createObjectURL(file);
            const done = (w: number, h: number) => {
                URL.revokeObjectURL(url);
                res({ w: w || 640, h: h || 360 });
            };
            v.preload = 'metadata';
            v.muted = true;
            v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
            v.onerror = () => done(640, 360);
            v.src = url;
        });
    const b = await bitmapFromFile(file);
    if (!b) return { w: 400, h: 300 };
    const d = { w: b.width, h: b.height };
    b.close();
    return d;
}

/** Copies files into the canvas's assets folder (reusing identical files) and returns their sizes. */
export async function addFilesToAssets(root: Dir, assetsPath: string, files: File[]) {
    const dir = await getDir(root, assetsPath, true);
    const out: { asset: string; nw: number; nh: number; video: boolean }[] = [];
    for (const f of files) {
        const k = kindOf(f.name);
        const video = k === 'video' || f.type.startsWith('video/');
        if (k !== 'image' && !video && !f.type.startsWith('image/')) continue;
        let name = sanitizeName(f.name || `pasted-${Date.now()}.png`);
        if (!name.includes('.')) name += video ? '.mp4' : '.png';
        let reuse = false;
        try {
            const existing = await (await dir.getFileHandle(name)).getFile();
            reuse = existing.size === f.size;
        } catch {
            /* new file */
        }
        if (!reuse) {
            name = await uniqueName(dir, name);
            await writeIn(dir, name, f);
        }
        const d = await mediaDims(f, video);
        out.push({ asset: name, nw: d.w, nh: d.h, video });
    }
    return out;
}
