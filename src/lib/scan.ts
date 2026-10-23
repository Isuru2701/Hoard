import { ASSETS_SUFFIX, CANVAS_EXT, basename, entries, joinPath, kindOf, type Dir } from './fs.ts';

export interface FileEntry {
    path: string;
    name: string;
    kind: 'image' | 'video' | 'markdown' | 'file';
    size: number;
    modified: number;
    folder: string;
    /** true when the file lives inside a canvas's assets folder */
    hidden: boolean;
}
export interface CanvasEntry {
    path: string;
    name: string;
    folder: string;
    modified: number;
}
export interface DocEntry {
    path: string;
    name: string;
    folder: string;
    modified: number;
}
export interface FolderNode {
    path: string;
    name: string;
    children: FolderNode[];
    canvases: CanvasEntry[];
    docs: DocEntry[];
    mediaCount: number;
    totalCount: number;
}
export interface ScanResult {
    tree: FolderNode;
    files: FileEntry[];
    canvases: CanvasEntry[];
    docs: DocEntry[];
    folders: FolderNode[];
    byPath: Map<string, FileEntry>;
}

/** Metadata-only access. Native (Tauri) handles expose `statInfo()` so a scan never
 *  pulls file contents over IPC — `getFile()` would read and base64-ship every file. */
type FileHandleLike = FileSystemFileHandle & { statInfo?: () => Promise<{ size: number; modified: number }> };

async function metaOf(handle: FileHandleLike): Promise<{ size: number; modified: number }> {
    if (handle.statInfo) return handle.statInfo();
    const f = await handle.getFile();
    return { size: f.size, modified: f.lastModified };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });

export async function scanWorkspace(root: Dir): Promise<ScanResult> {
    const files: FileEntry[] = [];
    const canvases: CanvasEntry[] = [];
    const docs: DocEntry[] = [];
    const folders: FolderNode[] = [];

    async function walk(dir: Dir, path: string, hidden: boolean): Promise<FolderNode> {
        const leaf = path ? basename(path) : 'Workspace';
        const node: FolderNode = { path, name: leaf.endsWith(ASSETS_SUFFIX) ? leaf.slice(0, -ASSETS_SUFFIX.length) : leaf, children: [], canvases: [], docs: [], mediaCount: 0, totalCount: 0 };
        const jobs: Promise<void>[] = [];
        for (const [name, handle] of await entries(dir)) {
            if (name.startsWith('.')) continue;
            const p = joinPath(path, name);
            if (handle.kind === 'directory') {
                const isAssets = name.endsWith(ASSETS_SUFFIX);
                jobs.push(
                    walk(handle as Dir, p, hidden).then((child) => {
                        if (!hidden) {
                            node.children.push(child);
                            folders.push(child);
                            node.totalCount += child.totalCount;
                        }
                    })
                );
            } else {
                const kind = kindOf(name);
                jobs.push(
                    metaOf(handle as FileHandleLike)
                        .then(({ size, modified }) => {
                            if (kind === 'canvas') {
                                if (!hidden) {
                                    const c = { path: p, name: name.slice(0, -CANVAS_EXT.length), folder: path, modified };
                                    canvases.push(c);
                                    node.canvases.push(c);
                                }
                                return;
                            }
                            files.push({ path: p, name, kind, size, modified, folder: path, hidden });
                            if (kind === 'markdown' && !hidden) {
                                const d = { path: p, name: name.replace(/\.(md|markdown|mdx)$/i, ''), folder: path, modified };
                                docs.push(d);
                                node.docs.push(d);
                            }
                            if (kind !== 'file') node.mediaCount++;
                        })
                        .catch(() => {})
                );
            }
        }
        await Promise.all(jobs);
        node.children.sort(byName);
        node.canvases.sort(byName);
        node.docs.sort(byName);
        node.totalCount += node.mediaCount;
        return node;
    }

    const tree = await walk(root, '', false);
    files.sort((a, b) => b.modified - a.modified);
    docs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { tree, files, canvases, docs, folders, byPath: new Map(files.map((f) => [f.path, f])) };
}

export function findFolder(node: FolderNode, path: string): FolderNode | null {
    if (node.path === path) return node;
    for (const c of node.children) {
        if (path === c.path || path.startsWith(c.path + '/')) return findFolder(c, path);
    }
    return null;
}
