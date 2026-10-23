/** All library operations: workspaces, navigation, files, metadata, trash. */
import { store, viewKey, type MenuItem, type View } from './store.ts';
import {
    ASSETS_SUFFIX,
    CANVAS_EXT,
    TRASH_DIR,
    IMPORT_ACCEPT,
    basename,
    dirname,
    entryKind,
    extOf,
    getDir,
    getFile,
    isImportableFile,
    joinPath,
    kindOf,
    moveEntry,
    removePath,
    sanitizeName,
    uniqueName,
    writeFile,
    writeIn,
    type Dir,
} from '../lib/fs.ts';
import { scanWorkspace } from '../lib/scan.ts';
import { loadMeta, saveMeta, type ItemMeta, type TrashEntry, type WorkspaceMeta } from '../lib/meta.ts';
import {
    deleteBrowserRoot,
    deleteActiveProfile,
    loadRegistry,
    pickFolder,
    resolveRoot,
    saveProfile,
    saveProfiles,
    saveWorkspaces,
    restoreView,
    uid,
    usingMemoryStorage,
    type WorkspaceRecord,
} from '../lib/workspaces.ts';
import { clearDims } from '../lib/thumbs.ts';
import { isTauri, pickNativeFolder } from '../lib/tauriFs.ts';
import { tagWithModel } from '../lib/tagger.ts';


let root: Dir | null = null;
export const getRoot = () => root;
const narrow = () => window.innerWidth < 900;

// ---------------------------------------------------------------- feedback
let toastTimer = 0;
export function toast(msg: string) {
    store.patch({ toast: msg });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => store.patch({ toast: null }), 2800);
}

export function askText(title: string, value = '', okLabel = 'Create', message?: string): Promise<string | null> {
    return new Promise((resolve) =>
        store.patch({
            dialog: {
                kind: 'prompt',
                title,
                message,
                value,
                okLabel,
                resolve: (v) => {
                    store.patch({ dialog: null });
                    resolve(typeof v === 'string' && v.trim() ? v.trim() : null);
                },
            },
        })
    );
}

export function askConfirm(title: string, message: string, okLabel = 'Delete', danger = true): Promise<boolean> {
    return new Promise((resolve) =>
        store.patch({
            dialog: {
                kind: 'confirm',
                title,
                message,
                okLabel,
                danger,
                resolve: (v) => {
                    store.patch({ dialog: null });
                    resolve(v === true);
                },
            },
        })
    );
}

export function openMenu(x: number, y: number, items: MenuItem[]) {
    store.patch({ menu: { x, y, items } });
}
export function menuAt(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, items);
}

export function pickFiles(accept = IMPORT_ACCEPT): Promise<File[]> {
    return new Promise((res) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = accept;
        input.onchange = () => res([...(input.files ?? [])]);
        input.click();
    });
}

// ---------------------------------------------------------------- registry / workspaces
export async function bootRegistry() {
    try {
        const { profile, profiles, workspaces } = await loadRegistry();
        store.patch({ profile, profiles, workspaces, booted: true });
        if (isTauri() && profile) {
            const recent = workspaces
                .filter((workspace) => !workspace.profileId || workspace.profileId === profile.id)
                .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))[0];
            if (recent) await openWorkspace(recent.id);
        }
    } catch (e) {
        console.warn(e);
        store.patch({ booted: true, screen: 'picker', wsId: null, scan: null, selection: [], focus: null });
    }
}

export async function saveProfileAction(name: string, username: string, createNew = false) {
    const prev = createNew ? null : store.get().profile;
    const p = { id: prev?.id ?? uid(), name, username: username.replace(/^@/, ''), created: prev?.created ?? Date.now() };
    const profiles = store.get().profiles.some((item) => item.id === p.id)
        ? store.get().profiles.map((item) => (item.id === p.id ? p : item))
        : [...store.get().profiles, p];
    store.patch({ profile: p, profiles });
    await Promise.all([saveProfile(p), saveProfiles(profiles)]);
    
}

export async function selectProfile(id: string) {
    const profile = store.get().profiles.find((item) => item.id === id);
    if (!profile) return;
    store.patch({ profile, screen: 'picker' });
}

export async function deleteProfileAction(): Promise<WorkspaceRecord[]> {
    const current = store.get();
    const profile = current.profile;
    if (!profile) return [];
    const workspaceRecords = current.workspaces.filter((workspace) => workspace.profileId === profile.id);
    const typed = await askText(
        `Delete profile “${profile.name}”?`,
        '',
        'Delete profile',
        `This profile has ${workspaceRecords.length} workspace${workspaceRecords.length === 1 ? '' : 's'}. They will be removed from hoard, but their files will not be touched. Type “${profile.name}” to confirm.`
    );
    if (typed !== profile.name) {
        if (typed !== null) toast('Profile name did not match; nothing was deleted');
        return [];
    }
    const profiles = current.profiles.filter((item) => item.id !== profile.id);
    const workspaces = current.workspaces.filter((workspace) => workspace.profileId !== profile.id);
    const nextProfile = profiles[0] ?? null;
    store.patch({ profile: nextProfile, profiles, workspaces, screen: 'picker', wsId: null, scan: null, selection: [], focus: null });
    await Promise.all([deleteActiveProfile(), saveProfiles(profiles), saveWorkspaces(workspaces)]);
    return workspaceRecords;
}

async function setWorkspaces(list: WorkspaceRecord[]) {
    store.patch({ workspaces: list });
    await saveWorkspaces(list);
}

/** Returns an error message, '' when cancelled, or null on success. */
export async function createWorkspace(name: string, kind: 'local' | 'browser', color: string): Promise<string | null> {
    let handle: Dir | undefined;
    let nativePath: string | undefined;
    if (kind === 'local') {
        try {
            if (isTauri()) {
                const picked = await pickNativeFolder();
                handle = picked.handle;
                nativePath = picked.path;
            } else {
                handle = await pickFolder();
            }
        } catch (e) {
            const n = (e as DOMException)?.name;
            if (n === 'AbortError') return '';
            if (n === 'SecurityError')
                return 'Your browser blocked the folder picker here because the preview runs inside a frame. Open the game in its own browser tab to link a real folder, or choose “Inside this browser”.';
            return 'This browser can’t link folders. Use Chrome or Edge on a computer, or choose “Inside this browser”.';
        }
    }
    const rec: WorkspaceRecord = {
        id: uid(),
        name,
        color,
        kind,
        handle,
        path: nativePath,
        profileId: store.get().profile?.id,
        created: Date.now(),
        rootLabel: kind === 'local' ? `📁 ${handle!.name}` : 'Stored in this browser',
    };
    await setWorkspaces([...store.get().workspaces, rec]);
    await openWorkspace(rec.id);
    return null;
}

export async function openWorkspace(id: string): Promise<boolean> {
    const rec = store.get().workspaces.find((w) => w.id === id);
    if (!rec) return false;
    const dir = await resolveRoot(rec, true);
    if (!dir) {
        toast('Access to that folder was not granted');
        return false;
    }
    root = dir;
    const openedAt = Date.now();
    const workspaces = isTauri()
        ? store.get().workspaces.map((workspace) => workspace.id === id ? { ...workspace, lastOpened: openedAt } : workspace)
        : store.get().workspaces;
    if (isTauri()) {
        store.patch({ workspaces });
        await saveWorkspaces(workspaces);
    }
    clearDims();
    if (rec.kind === 'browser') navigator.storage?.persist?.().catch(() => {});
    const meta = await loadMeta(dir);
    store.patch({
        wsId: id,
        meta,
        scan: null,
        view: isTauri() ? restoreView(rec.lastView) : { kind: 'home' },
        tabs: [],
        back: [],
        fwd: [],
        selection: [],
        focus: null,
        screen: 'picker',
    });
    if (rec.kind === 'browser' && usingMemoryStorage)
        toast('This window blocks saving files, so this workspace only lasts until you close it. Download the app and host it to save for real.');
    await rescan();
    if (!store.get().scan) {
        root = null;
        store.patch({ wsId: null, screen: 'picker', selection: [], focus: null });
        toast('Could not load that workspace');
        return false;
    }
    if (isTauri()) {
        const current = store.get();
        const view = restoreView(current.view);
        const valid = view.kind === 'home' || view.kind === 'all' || view.kind === 'favorites' || view.kind === 'trash' || view.kind === 'tags'
            || (view.kind === 'folder' && !!current.scan?.byPath.has(view.path))
            || (view.kind === 'canvas' && !!current.scan?.canvases.some((canvas) => canvas.path === view.path))
            || (view.kind === 'doc' && !!current.scan?.byPath.has(view.path));
        store.patch({ view: valid ? view : { kind: 'home' } });
    }
    store.patch({ screen: 'workspace' });
    return true;
}

export function closeWorkspace() {
    flushMeta();
    root = null;
    store.patch({ screen: 'picker', wsId: null, scan: null, focus: null, selection: [] });
}

export async function removeWorkspace(id: string) {
    const rec = store.get().workspaces.find((w) => w.id === id);
    if (!rec) return;
    const ok =
        rec.kind === 'browser'
            ? await askConfirm('Delete workspace?', `“${rec.name}” and every image, folder and canvas in it will be permanently deleted from this browser.`)
            : await askConfirm('Remove workspace?', `“${rec.name}” will be removed from this list. Your files on disk are not touched.`, 'Remove');
    if (!ok) return;
    if (rec.kind === 'browser') await deleteBrowserRoot(id).catch(() => {});
    await setWorkspaces(store.get().workspaces.filter((w) => w.id !== id));

}

export async function rescan() {
    if (!root) return;
    const r = root;
    try {
        const result = await scanWorkspace(r);
        if (root !== r) return;
        store.patch({ scan: result });
        const s = store.get();
        const stats = {
            folders: result.folders.length,
            files: result.files.filter((f) => !f.hidden).length,
            canvases: result.canvases.length,
        };
        await setWorkspaces(s.workspaces.map((w) => (w.id === s.wsId ? { ...w, stats } : w)));
    } catch (e) {
        console.warn('[scan] failed', e);
        toast('Could not read the workspace folder');
    }
}

// ---------------------------------------------------------------- navigation
const tabbable = (v: View) => v.kind === 'folder' || v.kind === 'canvas' || v.kind === 'tag' || v.kind === 'doc';

function persistLastView(view: View) {
    if (!isTauri()) return;
    const current = store.get();
    if (!current.wsId) return;
    const workspaces = current.workspaces.map((workspace) => workspace.id === current.wsId ? { ...workspace, lastView: view } : workspace);
    store.patch({ workspaces });
    void saveWorkspaces(workspaces);
}

export function navigate(view: View) {
    const s = store.get();
    if (narrow()) store.patch({ leftOpen: false });
    if (viewKey(view) === viewKey(s.view)) return;
    let tabs = s.tabs;
    if (tabbable(view) && !tabs.some((t) => viewKey(t) === viewKey(view))) tabs = [...tabs, view].slice(-12);
    store.patch({ view, tabs, back: [...s.back, s.view].slice(-50), fwd: [], selection: [], focus: null });
    persistLastView(view);
    if (view.kind === 'folder' || view.kind === 'canvas' || view.kind === 'doc') addRecent(view.path, view.kind);
}

export function goBack() {
    const s = store.get();
    const prev = s.back[s.back.length - 1];
    if (!prev) return;
    store.patch({ view: prev, back: s.back.slice(0, -1), fwd: [s.view, ...s.fwd], selection: [], focus: null });
    persistLastView(prev);
}

export function goForward() {
    const s = store.get();
    const next = s.fwd[0];
    if (!next) return;
    store.patch({ view: next, fwd: s.fwd.slice(1), back: [...s.back, s.view], selection: [], focus: null });
    persistLastView(next);
}

export function closeTab(v: View) {
    const s = store.get();
    const k = viewKey(v);
    const idx = s.tabs.findIndex((t) => viewKey(t) === k);
    const tabs = s.tabs.filter((t) => viewKey(t) !== k);
    if (viewKey(s.view) === k) {
        const next = tabs[Math.min(idx, tabs.length - 1)] ?? { kind: 'home' };
        store.patch({ tabs, view: next, selection: [], focus: null });
        persistLastView(next);
    } else store.patch({ tabs });
}

export function toggleCollapsed(path: string) {
    const c = store.get().collapsed;
    store.patch({ collapsed: { ...c, [path]: !c[path] } });
}

export function openViewer(paths: string[], index: number) {
    if (!paths.length) return;
    store.patch({ viewer: { paths, index } });
}

export function toggleFullscreen() {
    const on = !store.get().fullscreen;
    store.patch({ fullscreen: on });
    try {
        if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
        else if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch {
        /* not allowed */
    }
}

// ---------------------------------------------------------------- meta
let metaTimer = 0;
export function flushMeta() {
    window.clearTimeout(metaTimer);
    metaTimer = 0;
    if (root) saveMeta(root, store.get().meta).catch((e) => console.warn('[meta] save failed', e));
}
function setMeta(meta: WorkspaceMeta) {
    store.patch({ meta });
    window.clearTimeout(metaTimer);
    metaTimer = window.setTimeout(flushMeta, 500);
}

export function updateItemMeta(path: string, patch: Partial<ItemMeta>) {
    const m = store.get().meta;
    setMeta({ ...m, items: { ...m.items, [path]: { ...(m.items[path] ?? {}), ...patch } } });
}

export type PaletteChannel = 'stroke' | 'fill' | 'noteBg';

function setPaletteChannel(channel: PaletteChannel, colors: string[]) {
    const m = store.get().meta;
    setMeta({ ...m, palette: { ...(m.palette ?? { stroke: [], fill: [], noteBg: [] }), [channel]: colors } });
}

/** Save a custom canvas color so it shows up as a swatch in the style bar. */
export function addPaletteColor(channel: PaletteChannel, css: string) {
    const cur = store.get().meta.palette?.[channel] ?? [];
    if (cur.includes(css)) return;
    setPaletteChannel(channel, [...cur, css]);
}

/** Ctrl+click remove from the custom swatches. */
export function removePaletteColor(channel: PaletteChannel, css: string) {
    setPaletteChannel(channel, (store.get().meta.palette?.[channel] ?? []).filter((c) => c !== css));
    flushMeta();
}

export function addRecent(path: string, kind: 'folder' | 'canvas' | 'doc') {
    const m = store.get().meta;
    setMeta({ ...m, recents: [{ path, kind, at: Date.now() }, ...m.recents.filter((r) => r.path !== path)].slice(0, 12) });
}

function remapKey(k: string, from: string, to: string): string | null {
    if (k === from) return to;
    if (k.startsWith(from + '/')) return to + k.slice(from.length);
    return null;
}
const under = (k: string, prefix: string) => remapKey(k, prefix, prefix) !== null;

function remapMeta(from: string, to: string) {
    const m = store.get().meta;
    const items: Record<string, ItemMeta> = {};
    for (const [k, v] of Object.entries(m.items)) items[remapKey(k, from, to) ?? k] = v;
    const recents = m.recents.map((r) => ({ ...r, path: remapKey(r.path, from, to) ?? r.path }));
    setMeta({ ...m, items, recents });
}

function remapViews(from: string, to: string) {
    const fix = (v: View): View => (v.kind === 'folder' || v.kind === 'canvas' || v.kind === 'doc' ? { ...v, path: remapKey(v.path, from, to) ?? v.path } : v);
    const s = store.get();
    store.patch({
        view: fix(s.view),
        tabs: s.tabs.map(fix),
        back: s.back.map(fix),
        fwd: s.fwd.map(fix),
        focus: s.focus ? remapKey(s.focus, from, to) ?? s.focus : null,
        selection: s.selection.map((p) => remapKey(p, from, to) ?? p),
    });
}

export function renameTag(from: string, to: string) {
    const m = store.get().meta;
    const items: Record<string, ItemMeta> = {};
    for (const [k, v] of Object.entries(m.items)) {
        const swap = (list?: string[]) => (list ? [...new Set(list.map((t) => (t === from ? to : t)))] : list);
        items[k] = { ...v, tags: swap(v.tags), autoTags: swap(v.autoTags) };
    }
    setMeta({ ...m, items });
}

export function deleteTag(tag: string) {
    const m = store.get().meta;
    const items: Record<string, ItemMeta> = {};
    for (const [k, v] of Object.entries(m.items)) {
        items[k] = { ...v, tags: v.tags?.filter((t) => t !== tag), autoTags: v.autoTags?.filter((t) => t !== tag) };
    }
    setMeta({ ...m, items });
}

export function applyAutoTags(results: Record<string, string[]>) {
    const m = store.get().meta;
    const items = { ...m.items };
    for (const [p, tags] of Object.entries(results)) items[p] = { ...(items[p] ?? {}), autoTags: tags };
    setMeta({ ...m, items });
}

export async function autoTagItem(path: string, maxTags: number): Promise<void> {
    if (!root) return;
    const entry = store.get().scan?.byPath.get(path);
    if (!entry) {
        toast('That item is no longer available');
        return;
    }
    if (entry.kind === 'markdown') {
        toast('Auto-tagging is only available for images and videos');
        return;
    }
    try {
        const tags = await tagWithModel(root, entry, maxTags);
        applyAutoTags({ [path]: tags });
        toast(`Generated ${tags.length} auto-tag${tags.length === 1 ? '' : 's'}`);
    } catch (error) {
        console.warn('[autotag] model failed', error);
        const message = error instanceof Error ? error.message : 'Could not load the selected tagging model';
        toast(message);
    }
}

// ---------------------------------------------------------------- open canvases (flush before rename/delete)
const openCanvases = new Map<string, () => Promise<void>>();
export function registerCanvas(path: string, release: () => Promise<void>) {
    openCanvases.set(path, release);
    return () => {
        if (openCanvases.get(path) === release) openCanvases.delete(path);
    };
}
async function releaseCanvases(prefix: string) {
    for (const [p, rel] of openCanvases) if (under(p, prefix)) await rel();
}

export function canvasName(path: string): string {
    const b = basename(path);
    return b.endsWith(CANVAS_EXT) ? b.slice(0, -CANVAS_EXT.length) : b;
}
export const canvasAssetsPath = (path: string) => joinPath(dirname(path), canvasName(path) + ASSETS_SUFFIX);

export function addPathsToCanvas(canvasPath: string, sourcePaths: string[]) {
    if (!sourcePaths.length) return;
    store.patch({ pendingCanvasPaths: { canvasPath, sourcePaths } });
    navigate({ kind: 'canvas', path: canvasPath });
}

// ---------------------------------------------------------------- file operations
export async function importFiles(folder: string, files: File[]): Promise<string[]> {
    if (!root) return [];
    const media = files.filter(isImportableFile);
    if (!media.length) {
        toast('Only images, videos and markdown files can be imported');
        return [];
    }
    toast(`Importing ${media.length} file${media.length > 1 ? 's' : ''}…`);
    const dir = await getDir(root, folder, true);
    const out: string[] = [];
    for (const f of media) {
        try {
            const name = await uniqueName(dir, sanitizeName(f.name || `pasted-${Date.now()}.png`));
            await writeIn(dir, name, f);
            out.push(joinPath(folder, name));
        } catch (e) {
            console.warn('[import] failed', f.name, e);
        }
    }
    await rescan();
    toast(`Imported ${out.length} file${out.length === 1 ? '' : 's'}`);
    return out;
}

export async function importInto(folder: string) {
    const files = await pickFiles();
    if (files.length) await importFiles(folder, files);
}

export async function createFolder(parent: string) {
    if (!root) return;
    const raw = await askText(parent ? 'New subfolder' : 'New folder', 'New folder');
    if (!raw) return;
    const dir = await getDir(root, parent, true);
    const name = await uniqueName(dir, sanitizeName(raw));
    await dir.getDirectoryHandle(name, { create: true });
    await rescan();
    navigate({ kind: 'folder', path: joinPath(parent, name) });
}

export async function createCanvas(folder: string) {
    if (!root) return;
    const raw = await askText('New canvas', 'Untitled canvas');
    if (!raw) return;
    const dir = await getDir(root, folder, true);
    const base = sanitizeName(raw);
    let name = base;
    let n = 2;
    while ((await entryKind(dir, name + CANVAS_EXT)) || (await entryKind(dir, name + ASSETS_SUFFIX))) name = `${base} (${n++})`;
    await writeIn(dir, name + CANVAS_EXT, JSON.stringify({ version: 1, elements: [] }));
    await dir.getDirectoryHandle(name + ASSETS_SUFFIX, { create: true });
    await rescan();
    navigate({ kind: 'canvas', path: joinPath(folder, name + CANVAS_EXT) });
}

export async function createMarkdown(folder: string) {
    if (!root) return;
    const raw = await askText('New markdown file', 'Untitled');
    if (!raw) return;
    const dir = await getDir(root, folder, true);
    const base = sanitizeName(raw);
    let name = base;
    let n = 2;
    while (await entryKind(dir, name + '.md')) name = `${base} (${n++})`;
    await writeFile(root, joinPath(folder, name + '.md'), '');
    await rescan();
    navigate({ kind: 'doc', path: joinPath(folder, name + '.md') });
}

export type EntryType = 'folder' | 'canvas' | 'file';

export async function renameEntry(path: string, type: EntryType) {
    if (!root) return;
    const current = type === 'canvas' ? canvasName(path) : basename(path);
    const raw = await askText('Rename', current, 'Rename');
    if (!raw || raw === current) return;
    const parent = dirname(path);
    const dir = await getDir(root, parent);
    let newPath: string;
    try {
        await releaseCanvases(path);
        if (type === 'canvas') {
            const name = sanitizeName(raw);
            if (await entryKind(dir, name + CANVAS_EXT)) return toast('A canvas with that name already exists');
            const oldAssets = canvasAssetsPath(path);
            newPath = await moveEntry(root, path, parent, name + CANVAS_EXT);
            if (await entryKind(dir, basename(oldAssets))) {
                const newAssets = await moveEntry(root, oldAssets, parent, name + ASSETS_SUFFIX);
                remapMeta(oldAssets, newAssets);
            }
        } else {
            let name = sanitizeName(raw);
            const ext = extOf(path);
            if (type === 'file' && ext && !name.toLowerCase().endsWith('.' + ext)) name += '.' + ext;
            if (await entryKind(dir, name)) return toast('That name is already taken');
            newPath = await moveEntry(root, path, parent, name);
            remapMeta(path, newPath);
        }
    } catch (e) {
        console.warn(e);
        toast('Could not rename');
        return;
    }
    remapViews(path, newPath);
    await rescan();
}

export async function trashItems(targets: { path: string; type: EntryType }[]) {
    if (!root || !targets.length) return;
    let meta = store.get().meta;
    const added: TrashEntry[] = [];
    for (const t of targets) {
        try {
            await releaseCanvases(t.path);
            const id = uid();
            const name = basename(t.path);
            const trashName = `${id}__${name}`;
            await moveEntry(root, t.path, TRASH_DIR, trashName);
            let assetsTrashName: string | undefined;
            const prefixes = [t.path];
            if (t.type === 'canvas') {
                const ap = canvasAssetsPath(t.path);
                const parent = await getDir(root, dirname(ap));
                if (await entryKind(parent, basename(ap))) {
                    assetsTrashName = `${id}__${basename(ap)}`;
                    await moveEntry(root, ap, TRASH_DIR, assetsTrashName);
                    prefixes.push(ap);
                }
            }
            const saved: Record<string, ItemMeta> = {};
            const items = { ...meta.items };
            for (const k of Object.keys(items)) {
                if (prefixes.some((p) => under(k, p))) {
                    saved[k] = items[k];
                    delete items[k];
                }
            }
            const kind: TrashEntry['kind'] = t.type === 'file' ? (kindOf(name) as 'image' | 'video' | 'file') : t.type;
            added.push({
                id,
                name: t.type === 'canvas' ? canvasName(t.path) : name,
                originalPath: t.path,
                trashName,
                assetsTrashName,
                kind,
                deletedAt: Date.now(),
                meta: saved,
            });
            meta = { ...meta, items, recents: meta.recents.filter((r) => !under(r.path, t.path)) };
        } catch (e) {
            console.warn('[trash] failed', t.path, e);
        }
    }
    setMeta({ ...meta, trash: [...added, ...meta.trash] });
    const gone = (p: string) => targets.some((t) => under(p, t.path));
    const isGoneView = (v: View) => (v.kind === 'folder' || v.kind === 'canvas') && gone(v.path);
    const s = store.get();
    store.patch({
        tabs: s.tabs.filter((v) => !isGoneView(v)),
        back: s.back.filter((v) => !isGoneView(v)),
        fwd: s.fwd.filter((v) => !isGoneView(v)),
        view: isGoneView(s.view) ? { kind: 'home' } : s.view,
        selection: s.selection.filter((p) => !gone(p)),
        focus: s.focus && gone(s.focus) ? null : s.focus,
    });
    flushMeta();
    toast(added.length === 1 ? `Moved “${added[0].name}” to trash` : `Moved ${added.length} items to trash`);
    await rescan();
}

export async function restoreTrash(id: string) {
    if (!root) return;
    const m = store.get().meta;
    const e = m.trash.find((t) => t.id === id);
    if (!e) return;
    try {
        const parent = dirname(e.originalPath);
        const dir = await getDir(root, parent, true);
        let restored: string;
        const remaps: [string, string][] = [];
        if (e.kind === 'canvas') {
            const base = canvasName(e.originalPath);
            let name = base;
            let n = 2;
            while ((await entryKind(dir, name + CANVAS_EXT)) || (await entryKind(dir, name + ASSETS_SUFFIX))) name = `${base} (${n++})`;
            restored = await moveEntry(root, joinPath(TRASH_DIR, e.trashName), parent, name + CANVAS_EXT);
            if (e.assetsTrashName) {
                const na = await moveEntry(root, joinPath(TRASH_DIR, e.assetsTrashName), parent, name + ASSETS_SUFFIX);
                remaps.push([canvasAssetsPath(e.originalPath), na]);
            }
        } else {
            const name = await uniqueName(dir, basename(e.originalPath));
            restored = await moveEntry(root, joinPath(TRASH_DIR, e.trashName), parent, name);
        }
        remaps.push([e.originalPath, restored]);
        const items = { ...m.items };
        for (const [k, v] of Object.entries(e.meta ?? {})) {
            let nk = k;
            for (const [from, to] of remaps) nk = remapKey(k, from, to) ?? nk;
            items[nk] = v;
        }
        setMeta({ ...store.get().meta, items, trash: store.get().meta.trash.filter((t) => t.id !== id) });
        toast(`Restored “${e.name}”`);
        await rescan();
    } catch (err) {
        console.warn(err);
        toast('Could not restore that item');
    }
}

async function purge(e: TrashEntry) {
    if (!root) return;
    await removePath(root, joinPath(TRASH_DIR, e.trashName)).catch(() => {});
    if (e.assetsTrashName) await removePath(root, joinPath(TRASH_DIR, e.assetsTrashName)).catch(() => {});
}

export async function purgeTrash(id: string) {
    const e = store.get().meta.trash.find((t) => t.id === id);
    if (!e) return;
    if (!(await askConfirm('Delete forever?', `“${e.name}” will be permanently deleted. This can’t be undone.`))) return;
    await purge(e);
    const m = store.get().meta;
    setMeta({ ...m, trash: m.trash.filter((t) => t.id !== id) });
}

export async function emptyTrash() {
    const list = store.get().meta.trash;
    if (!list.length) return;
    if (!(await askConfirm('Empty trash?', `${list.length} item${list.length > 1 ? 's' : ''} will be permanently deleted.`, 'Empty trash'))) return;
    for (const e of list) await purge(e);
    setMeta({ ...store.get().meta, trash: [] });
    toast('Trash emptied');
}

export async function moveFiles(paths: string[], toFolder: string) {
    if (!root) return;
    let moved = 0;
    for (const p of paths) {
        if (dirname(p) === toFolder) continue;
        try {
            const dir = await getDir(root, toFolder, true);
            const name = await uniqueName(dir, basename(p));
            const np = await moveEntry(root, p, toFolder, name);
            remapMeta(p, np);
            moved++;
        } catch (e) {
            console.warn('[move] failed', p, e);
        }
    }
    if (moved) {
        store.patch({ selection: [], focus: null });
        toast(`Moved ${moved} file${moved > 1 ? 's' : ''}`);
        await rescan();
    }
}

// ---------------------------------------------------------------- copy/paste in folders
/** Folder copy-paste: Ctrl+C stores selected paths here, Ctrl+V clones them into the open folder. */
let fileClipboard: string[] = [];

export function copyItems(paths: string[]): void {
    fileClipboard = [...paths];
}

/** The folder shown in the central panel (folder page, or a canvas's parent folder). */
export function currentFeedFolder(): string {
    const view = store.get().view;
    return view.kind === 'folder' ? view.path : view.kind === 'canvas' ? dirname(view.path) : '';
}

export async function pasteItems(): Promise<void> {
    if (!root) return;
    if (!fileClipboard.length) {
        toast('Clipboard is empty — select files and press Ctrl+C first');
        return;
    }
    const folder = currentFeedFolder();
    let copied = 0;
    for (const p of fileClipboard) {
        if (dirname(p) === folder) continue;
        try {
            const file = await getFile(root, p);
            const dir = await getDir(root, folder, true);
            const name = await uniqueName(dir, basename(p));
            await writeIn(dir, name, file);
            copied++;
        } catch (e) {
            console.warn('[paste] failed', p, e);
        }
    }
    if (copied) {
        toast(`Pasted ${copied} file${copied > 1 ? 's' : ''}`);
        store.patch({ selection: [], focus: null });
        await rescan();
    } else {
        toast('These files are already in this folder');
    }
}

export function createMenuItems(folder: string): MenuItem[] {
    return [
        { label: folder ? 'New subfolder' : 'New folder', icon: 'folderPlus', ev: 'create_menu_folder', onClick: () => void createFolder(folder) },
        { label: 'New canvas', icon: 'canvas', ev: 'create_menu_canvas', onClick: () => void createCanvas(folder) },
        { label: 'New markdown', icon: 'file', ev: 'create_menu_markdown', onClick: () => void createMarkdown(folder) },
        { label: 'Import images & videos', icon: 'upload', ev: 'create_menu_import', onClick: () => void importInto(folder || 'Inbox') },
    ];
}
