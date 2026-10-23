import { idbDelete, idbGet, idbSet } from './idb.ts';
import type { Dir } from './fs.ts';
import { memoryRoot } from './memfs.ts';
import { isTauri, nativeRoot, pickNativeFolder } from './tauriFs.ts';
import type { View } from '../state/store.ts';

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
    profileId?: string;
    lastView?: View;
    lastOpened?: number;
}
export interface Profile {
    id?: string;
    name: string;
    username: string;
    created: number;
}

export const WS_COLORS = ['#3b82f6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444', '#64748b'];

export function uid(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export async function loadRegistry(): Promise<{ profile: Profile | null; profiles: Profile[]; workspaces: WorkspaceRecord[] }> {
    const [profile, profiles, workspaces] = await Promise.all([
        idbGet<Profile>('kv', 'profile'),
        idbGet<Profile[]>('kv', 'profiles'),
        idbGet<WorkspaceRecord[]>('kv', 'workspaces'),
    ]);
    const migrated = profile && !profiles?.length ? [{ ...profile, id: profile.id ?? 'default' }] : profiles ?? [];
    const active = profile ? { ...profile, id: profile.id ?? migrated[0]?.id ?? 'default' } : migrated[0] ?? null;
    const records = (workspaces ?? []).map((workspace) => ({ ...workspace, profileId: workspace.profileId ?? active?.id }));
    return { profile: active, profiles: migrated, workspaces: records };
}
export const saveWorkspaces = (list: WorkspaceRecord[]) => {
    if (isTauri()) {
        const persisted = list.map(({ handle: _handle, ...workspace }) => workspace);
        return idbSet('kv', 'workspaces', persisted);
    }
    return idbSet('kv', 'workspaces', list);
};
export const saveProfile = (p: Profile) => idbSet('kv', 'profile', p);
export const saveProfiles = (profiles: Profile[]) => idbSet('kv', 'profiles', profiles);
export const deleteActiveProfile = () => idbDelete('kv', 'profile');

export function restoreView(value: unknown): View {
    if (!value || typeof value !== 'object') return { kind: 'home' };
    const candidate = value as Partial<View>;
    if (candidate.kind === 'home' || candidate.kind === 'all' || candidate.kind === 'favorites' || candidate.kind === 'trash' || candidate.kind === 'tags') {
        return { kind: candidate.kind };
    }
    if (candidate.kind === 'folder' || candidate.kind === 'canvas' || candidate.kind === 'doc') {
        return typeof candidate.path === 'string' && candidate.path.length > 0 ? { kind: candidate.kind, path: candidate.path } : { kind: 'home' };
    }
    if (candidate.kind === 'tag') {
        return typeof candidate.tag === 'string' && candidate.tag.length > 0 ? { kind: 'tag', tag: candidate.tag } : { kind: 'home' };
    }
    return { kind: 'home' };
}

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
    const st = navigator.storage as unknown as { getDirectory?: () => Promise<Dir> };
    if (!st?.getDirectory) throw new Error('unsupported');
    return st.getDirectory();
}

export async function browserRoot(id: string): Promise<Dir> {
    try {
        const base = await opfs();
        const dir = await base.getDirectoryHandle(`hoard-${id}`, { create: true });
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
