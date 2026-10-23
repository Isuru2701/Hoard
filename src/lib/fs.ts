/** Helpers over the browser File System Access API (real folders or browser storage). */
export type Dir = FileSystemDirectoryHandle;

export const CANVAS_EXT = '.hoard-canvas';
export const ASSETS_SUFFIX = '.hoard-assets';
export const TRASH_DIR = '.hoard/trash';
export const DRAG_MIME = 'application/x-hoard-paths';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'jfif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const DOC_EXT = new Set(['md', 'markdown', 'mdx']);

export type Kind = 'image' | 'video' | 'canvas' | 'file' | 'markdown';

/** File-picker filter used everywhere files can be imported. */
export const IMPORT_ACCEPT = 'image/*,video/*,.md,.markdown,.mdx,text/markdown,text/plain';

export function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function kindOf(name: string): Kind {
    if (name.endsWith(CANVAS_EXT)) return 'canvas';
    const e = extOf(name);
    if (IMAGE_EXT.has(e)) return 'image';
    if (VIDEO_EXT.has(e)) return 'video';
    if (DOC_EXT.has(e)) return 'markdown';
    return 'file';
}

export function isMediaFile(f: File): boolean {
    const k = kindOf(f.name);
    return k === 'image' || k === 'video' || f.type.startsWith('image/') || f.type.startsWith('video/');
}

export function isDocFile(f: File): boolean {
    return kindOf(f.name) === 'markdown' || f.type === 'text/markdown' || f.type === 'text/x-markdown';
}

export function isImportableFile(f: File): boolean {
    return isMediaFile(f) || isDocFile(f);
}

/** Display title for a markdown path: the filename without its extension. */
export function docTitleOf(path: string): string {
    return basename(path).replace(/\.(md|markdown|mdx)$/i, '');
}

/** Move a workspace path from `from` to `to`; null when the path is outside the moved tree. */
export function remapPath(path: string, from: string, to: string): string | null {
    if (path === from) return to;
    if (path.startsWith(from + '/')) return to + path.slice(from.length);
    return null;
}

export const splitPath = (p: string) => p.split('/').filter(Boolean);
export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');
export function dirname(p: string): string {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
}
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export function sanitizeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '').trim().slice(0, 120) || 'untitled';
}

export async function entries(dir: Dir): Promise<[string, FileSystemHandle][]> {
    const out: [string, FileSystemHandle][] = [];
    const it = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    for await (const pair of it) out.push(pair);
    return out;
}

export async function getDir(root: Dir, path: string, create = false): Promise<Dir> {
    let d = root;
    for (const part of splitPath(path)) d = await d.getDirectoryHandle(part, { create });
    return d;
}

export async function getFile(root: Dir, path: string): Promise<File> {
    const dir = await getDir(root, dirname(path));
    const h = await dir.getFileHandle(basename(path));
    return h.getFile();
}

export async function readText(root: Dir, path: string): Promise<string | null> {
    try {
        return await (await getFile(root, path)).text();
    } catch {
        return null;
    }
}

type Writable = { write(d: Blob | string): Promise<void>; close(): Promise<void> };

export async function writeIn(dir: Dir, name: string, data: Blob | string): Promise<void> {
    const h = await dir.getFileHandle(name, { create: true });
    const w = await (h as unknown as { createWritable(): Promise<Writable> }).createWritable();
    await w.write(data);
    await w.close();
}

export async function writeFile(root: Dir, path: string, data: Blob | string): Promise<void> {
    const dir = await getDir(root, dirname(path), true);
    await writeIn(dir, basename(path), data);
}

export async function entryKind(dir: Dir, name: string): Promise<'file' | 'directory' | null> {
    try {
        await dir.getFileHandle(name);
        return 'file';
    } catch {
        try {
            await dir.getDirectoryHandle(name);
            return 'directory';
        } catch {
            return null;
        }
    }
}

export async function uniqueName(dir: Dir, name: string): Promise<string> {
    if (!(await entryKind(dir, name))) return name;
    const i = name.lastIndexOf('.');
    const base = i > 0 ? name.slice(0, i) : name;
    const ext = i > 0 ? name.slice(i) : '';
    for (let n = 2; n < 10000; n++) {
        const c = `${base} (${n})${ext}`;
        if (!(await entryKind(dir, c))) return c;
    }
    return `${base}-${Date.now()}${ext}`;
}

export async function removePath(root: Dir, path: string): Promise<void> {
    const dir = await getDir(root, dirname(path));
    await dir.removeEntry(basename(path), { recursive: true });
}

async function copyInto(src: FileSystemHandle, dst: Dir, name: string): Promise<void> {
    if (src.kind === 'file') {
        await writeIn(dst, name, await (src as FileSystemFileHandle).getFile());
    } else {
        const nd = await dst.getDirectoryHandle(name, { create: true });
        for (const [n, h] of await entries(src as Dir)) await copyInto(h, nd, n);
    }
}

/** Move/rename an entry. Uses the native move when available, else copy + delete. */
export async function moveEntry(root: Dir, from: string, toDir: string, newName?: string): Promise<string> {
    const parent = await getDir(root, dirname(from));
    const name = basename(from);
    const finalName = newName ?? name;
    const dst = await getDir(root, toDir, true);
    const kind = await entryKind(parent, name);
    if (!kind) throw new Error('Not found: ' + from);
    const handle = kind === 'file' ? await parent.getFileHandle(name) : await parent.getDirectoryHandle(name);
    const mv = (handle as unknown as { move?: (d: Dir, n: string) => Promise<void> }).move;
    if (typeof mv === 'function') {
        try {
            await mv.call(handle, dst, finalName);
            return joinPath(toDir, finalName);
        } catch {
            /* fall back to copy */
        }
    }
    await copyInto(handle, dst, finalName);
    await parent.removeEntry(name, { recursive: true });
    return joinPath(toDir, finalName);
}
