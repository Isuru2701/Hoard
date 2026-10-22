/**
 * In-memory stand-in for a folder, used when the browser blocks real storage
 * (e.g. inside a sandboxed frame). Implements only what the app uses.
 */
import type { Dir } from './fs.ts';

const err = (name: string, msg: string) => new DOMException(msg, name);

class MemFileHandle {
    readonly kind = 'file' as const;
    blob: Blob = new Blob([]);
    modified = Date.now();
    constructor(public name: string) {}
    async getFile(): Promise<File> {
        return new File([this.blob], this.name, { lastModified: this.modified, type: this.blob.type });
    }
    async createWritable() {
        const parts: BlobPart[] = [];
        return {
            write: async (d: Blob | string) => {
                parts.push(d);
            },
            close: async () => {
                this.blob = new Blob(parts, { type: parts[0] instanceof Blob ? parts[0].type : '' });
                this.modified = Date.now();
            },
        };
    }
}

class MemDirHandle {
    readonly kind = 'directory' as const;
    children = new Map<string, MemDirHandle | MemFileHandle>();
    constructor(public name: string) {}
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        const c = this.children.get(name);
        if (c instanceof MemDirHandle) return c;
        if (c) throw err('TypeMismatchError', 'Not a directory');
        if (!opts?.create) throw err('NotFoundError', 'Not found');
        const d = new MemDirHandle(name);
        this.children.set(name, d);
        return d;
    }
    async getFileHandle(name: string, opts?: { create?: boolean }) {
        const c = this.children.get(name);
        if (c instanceof MemFileHandle) return c;
        if (c) throw err('TypeMismatchError', 'Not a file');
        if (!opts?.create) throw err('NotFoundError', 'Not found');
        const f = new MemFileHandle(name);
        this.children.set(name, f);
        return f;
    }
    async removeEntry(name: string) {
        if (!this.children.delete(name)) throw err('NotFoundError', 'Not found');
    }
    async *entries(): AsyncGenerator<[string, MemDirHandle | MemFileHandle]> {
        for (const pair of [...this.children]) yield pair;
    }
}

const roots = new Map<string, MemDirHandle>();
export function memoryRoot(id: string): Dir {
    let r = roots.get(id);
    if (!r) {
        r = new MemDirHandle(id);
        roots.set(id, r);
    }
    return r as unknown as Dir;
}
