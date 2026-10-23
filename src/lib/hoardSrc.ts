/** Embedding of real workspace files inside markdown docs.
 *  Markdown stores `hoard-file:<percent-encoded workspace path>` as the image/link URL,
 *  and the UI resolves it to a live object URL of the actual file on disk. */
import { basename, getFile, type Dir } from './fs.ts';

export const HOARD_SRC_PREFIX = 'hoard-file:';

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function encodeHoardSrc(path: string): string {
    return HOARD_SRC_PREFIX + encodeURIComponent(path);
}

export function isHoardSrc(src: string): boolean {
    return src.startsWith(HOARD_SRC_PREFIX);
}

export function decodeHoardSrc(src: string): string {
    try {
        return decodeURIComponent(src.slice(HOARD_SRC_PREFIX.length));
    } catch {
        return src.slice(HOARD_SRC_PREFIX.length);
    }
}

/** Live object URL for an embedded workspace file; null when the file is gone. */
export function resolveHoardSrc(src: string, root: Dir): Promise<string | null> {
    let p = pending.get(src);
    if (p) return p;
    const cached = urls.get(src);
    if (cached) return Promise.resolve(cached);
    p = (async () => {
        try {
            const file = await getFile(root, decodeHoardSrc(src));
            const url = URL.createObjectURL(file);
            urls.set(src, url);
            return url;
        } catch {
            return null;
        }
    })();
    pending.set(src, p);
    void p.then((u) => {
        if (u) pending.delete(src);
    });
    return p;
}

/** Call when switching workspaces. */
export function clearHoardUrls(): void {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    pending.clear();
}

/** Object URLs keep working after revoke timers, but avoid growth in long sessions. */
export function forgetHoardSrc(src: string): void {
    const url = urls.get(src);
    if (url) {
        URL.revokeObjectURL(url);
        urls.delete(src);
        pending.delete(src);
    }
}

export function altForDocPath(path: string): string {
    return basename(path).replace(/\.[^.]+$/, '');
}
