import { idbGet, idbSet } from './idb.ts';
import type { Dir } from './fs.ts';
import { memoryRoot } from './memfs.ts';
import { isTauri, nativeRoot, pickNativeFolder } from './tauriFs.ts';

export interface WorkspaceRecord {
    id: string;
    name: string;
    color: string;
    kind: 'local' | 'browser';
    handle?: Dir;
    path?: string;
    created: number;
    rootLabel: string;
    stats?: { folders: number; files: number; canvases: number };
}
export interface Profile {
    name: string;
    username: string;
    created: number;
}

export const WS_COLORS = ['#3b82f6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444', '#64748b'];

export function uid(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export async function loadRegistry(): Promise<{ profile: Profile | null; workspaces: WorkspaceRecord[] }> {
    const [profile, workspaces] = await Promise.all([idbGet<Profile>('kv', 'profile'), idbGet<WorkspaceRecord[]>('kv', 'workspaces')]);
    return { profile: profile ?? null, workspaces: workspaces ?? [] };
}
export const saveWorkspaces = (list: WorkspaceRecord[]) => {
    if (isTauri()) {
        const persisted = list.map(({ handle: _handle, ...workspace }) => workspace);
        return idbSet('kv', 'workspaces', persisted);
    }
    return idbSet('kv', 'workspaces', list);
};
export const saveProfile = (p: Profile) => idbSet('kv', 'profile', p);

type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: string; id?: string }) => Promise<Dir> };

export function canPickFolder(): boolean {
    if (isTauri()) return true;
    return typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

export async function pickFolder(): Promise<Dir> {
    if (isTauri()) return (await pickNativeFolder()).handle;
    const fn = (window as PickerWindow).showDirectoryPicker;
    if (!fn) throw new DOMException('unsupported', 'NotSupportedError');
    return fn.call(window, { mode: 'readwrite', id: 'hoard' });
}

/** Set when browser storage was blocked and a session-only memory folder is used instead. */
export let usingMemoryStorage = false;

async function opfs(): Promise<Dir> {
    const st = navigator.storage as unknown as { getDirectory?: () => Promise<Dir> }; // @rundot-ignore-storage
    if (!st?.getDirectory) throw new Error('unsupported');
    return st.getDirectory();
}

export async function browserRoot(id: string): Promise<Dir> {
    try {
        const base = await opfs();
        const dir = await base.getDirectoryHandle(`hoard-${id}`, { create: true });
        // Probe a write: some sandboxes allow reads but block writes.
        const probe = await dir.getFileHandle('.probe', { create: true });
        const w = await (probe as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable();
        await w.write('ok');
        await w.close();
        usingMemoryStorage = false;
        return dir;
    } catch {
        usingMemoryStorage = true;
        return memoryRoot(id);
    }
}

export async function deleteBrowserRoot(id: string): Promise<void> {
    try {
        const base = await opfs();
        await base.removeEntry(`hoard-${id}`, { recursive: true });
    } catch {
        /* memory or missing */
    }
}

type PermHandle = {
    queryPermission?: (o: { mode: string }) => Promise<string>;
    requestPermission?: (o: { mode: string }) => Promise<string>;
};

export async function resolveRoot(rec: WorkspaceRecord, interactive: boolean): Promise<Dir | null> {
    if (isTauri()) return rec.path ? nativeRoot(rec.path) : null;
    if (rec.kind === 'browser') return browserRoot(rec.id);
    const h = rec.handle;
    if (!h) return null;
    const p = h as unknown as PermHandle;
    const opts = { mode: 'readwrite' };
    try {
        if (!p.queryPermission) return h;
        if ((await p.queryPermission(opts)) === 'granted') return h;
        if (!interactive || !p.requestPermission) return null;
        return (await p.requestPermission(opts)) === 'granted' ? h : null;
    } catch {
        return null;
    }
}
