import { invoke } from '@tauri-apps/api/core';
import type { Dir } from './fs.ts';

interface NativeEntry {
    name: string;
    kind: 'file' | 'directory';
    size?: number;
    modified?: number;
}

interface NativeFile {
    name: string;
    data: string;
    size: number;
    modified: number;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
};

const base64ToBytes = (value: string): Uint8Array => {
    const text = atob(value);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
};

class NativeFileHandle {
    readonly kind = 'file' as const;
    /** Metadata already known from `list_directory`, without reading the file. */
    readonly size: number;
    readonly modified: number;
    constructor(private readonly path: string, public readonly name: string, size = 0, modified = 0) {
        this.size = size;
        this.modified = modified;
    }

    async getFile(): Promise<File> {
        const result = await invoke<NativeFile>('read_file', { path: this.path });
        const bytes = base64ToBytes(result.data);
        return new File([bytes.buffer as ArrayBuffer], result.name, { lastModified: result.modified });
    }

    /** Metadata-only stat so workspace scans never read file contents over IPC. */
    async statInfo(): Promise<{ size: number; modified: number }> {
        return { size: this.size, modified: this.modified };
    }

    /** Native rename/move; `moveEntry` (fs.ts) falls back to copy+delete when unavailable. */
    async move(dst: Dir, newName: string): Promise<void> {
        const to = `${(dst as unknown as { path: string }).path}\\${newName}`;
        await invoke('move_path', { from: this.path, to });
    }

    async createWritable() {
        let data = new Blob([]);
        return {
            write: async (value: Blob | string) => {
                data = new Blob([data, value]);
            },
            close: async () => {
                const bytes = new Uint8Array(await data.arrayBuffer());
                await invoke('write_file', { path: this.path, data: bytesToBase64(bytes) });
            },
        };
    }
}

class NativeDirHandle {
    readonly kind = 'directory' as const;
    constructor(public readonly path: string, public readonly name: string) {}

    async *entries(): AsyncGenerator<[string, NativeDirHandle | NativeFileHandle]> {
        const entries = await invoke<NativeEntry[]>('list_directory', { path: this.path });
        for (const entry of entries) {
            const childPath = `${this.path}\\${entry.name}`;
            yield [
                entry.name,
                entry.kind === 'directory'
                    ? new NativeDirHandle(childPath, entry.name)
                    : new NativeFileHandle(childPath, entry.name, entry.size ?? 0, entry.modified ?? 0),
            ];
        }
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeDirHandle> {
        const path = `${this.path}\\${name}`;
        if (options?.create) await invoke('create_directory', { path });
        else if ((await invoke<'file' | 'directory' | null>('entry_kind', { path })) !== 'directory') throw new DOMException('Not found', 'NotFoundError');
        return new NativeDirHandle(path, name);
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle> {
        const path = `${this.path}\\${name}`;
        if (options?.create) await invoke('create_file', { path });
        else if ((await invoke<'file' | 'directory' | null>('entry_kind', { path })) !== 'file') throw new DOMException('Not found', 'NotFoundError');
        return new NativeFileHandle(path, name);
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
        await invoke('remove_entry', { path: `${this.path}\\${name}`, recursive: options?.recursive ?? false });
    }

    /** Native rename/move; `moveEntry` (fs.ts) falls back to copy+delete when unavailable. */
    async move(dst: Dir, newName: string): Promise<void> {
        const to = `${(dst as unknown as { path: string }).path}\\${newName}`;
        await invoke('move_path', { from: this.path, to });
    }
}

export const isTauri = () => '__TAURI_INTERNALS__' in window;

export async function pickNativeFolder(): Promise<{ handle: Dir; path: string; name: string }> {
    const path = await invoke<string | null>('choose_folder');
    if (!path) throw new DOMException('The folder picker was cancelled', 'AbortError');
    const name = path.split(/[\\/]/).pop() || path;
    return { handle: new NativeDirHandle(path, name) as unknown as Dir, path, name };
}

export function nativeRoot(path: string): Dir {
    const name = path.split(/[\\/]/).pop() || path;
    return new NativeDirHandle(path, name) as unknown as Dir;
}

export async function revealNativePath(path: string): Promise<void> {
    await invoke('reveal_path', { path });
}

export async function nativeFile(path: string): Promise<File> {
    const result = await invoke<NativeFile>('read_file', { path });
    const bytes = base64ToBytes(result.data);
    return new File([bytes.buffer as ArrayBuffer], result.name, { lastModified: result.modified });
}
