/** App-wide UI state (tiny external store bridged to React). */
import { useSyncExternalStore } from 'react';
import type { Profile, WorkspaceRecord } from '../lib/workspaces.ts';
import type { ScanResult } from '../lib/scan.ts';
import { emptyMeta, type WorkspaceMeta } from '../lib/meta.ts';
import type { IconName } from '../ui/Icon.tsx';

export type View =
    | { kind: 'home' }
    | { kind: 'all' }
    | { kind: 'favorites' }
    | { kind: 'trash' }
    | { kind: 'tags' }
    | { kind: 'tag'; tag: string }
    | { kind: 'folder'; path: string }
    | { kind: 'canvas'; path: string }
    | { kind: 'doc'; path: string };

export function viewKey(v: View): string {
    if (v.kind === 'folder' || v.kind === 'canvas' || v.kind === 'doc') return `${v.kind}:${v.path}`;
    if (v.kind === 'tag') return `tag:${v.tag}`;
    return v.kind;
}

export interface DialogState {
    kind: 'prompt' | 'confirm';
    title: string;
    message?: string;
    value?: string;
    okLabel: string;
    danger?: boolean;
    resolve: (v: string | boolean | null) => void;
}
export interface MenuItem {
    label: string;
    icon?: IconName;
    danger?: boolean;
    ev: string;
    onClick: () => void;
}
export interface MenuState {
    x: number;
    y: number;
    items: MenuItem[];
}
export type FeedSize = 's' | 'm' | 'l';
export type FeedSort = 'new' | 'old' | 'name';

export interface AppState {
    booted: boolean;
    screen: 'picker' | 'workspace';
    profile: Profile | null;
    profiles: Profile[];
    workspaces: WorkspaceRecord[];
    wsId: string | null;
    scan: ScanResult | null;
    meta: WorkspaceMeta;
    view: View;
    tabs: View[];
    back: View[];
    fwd: View[];
    selection: string[];
    focus: string | null;
    leftOpen: boolean;
    rightOpen: boolean;
    fullscreen: boolean;
    searchOpen: boolean;
    viewer: { paths: string[]; index: number } | null;
    dialog: DialogState | null;
    menu: MenuState | null;
    toast: string | null;
    collapsed: Record<string, boolean>;
    feedSize: FeedSize;
    feedSort: FeedSort;
    tagGraphTag: string | null;
    tagGraphDepth: number;
    pendingCanvasPaths: { canvasPath: string; sourcePaths: string[] } | null;
}

const listeners = new Set<() => void>();
const w = typeof window !== 'undefined' ? window.innerWidth : 1280;

let state: AppState = {
    booted: false,
    screen: 'picker',
    profile: null,
    profiles: [],
    workspaces: [],
    wsId: null,
    scan: null,
    meta: emptyMeta(),
    view: { kind: 'home' },
    tabs: [],
    back: [],
    fwd: [],
    selection: [],
    focus: null,
    leftOpen: w >= 900,
    rightOpen: w >= 1200,
    fullscreen: false,
    searchOpen: false,
    viewer: null,
    dialog: null,
    menu: null,
    toast: null,
    collapsed: {},
    feedSize: w < 600 ? 's' : 'm',
    feedSort: 'new',
    tagGraphTag: null,
    tagGraphDepth: 0,
    pendingCanvasPaths: null,
};

export const store = {
    get: (): AppState => state,
    patch(partial: Partial<AppState>): void {
        state = { ...state, ...partial };
        for (const l of listeners) l();
    },
    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

/** Selector must return a primitive or a stable reference. */
export function useStore<T>(selector: (s: AppState) => T): T {
    return useSyncExternalStore(store.subscribe, () => selector(state));
}
