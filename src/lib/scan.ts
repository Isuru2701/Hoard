import { ASSETS_SUFFIX, CANVAS_EXT, basename, entries, joinPath, kindOf, type Dir } from './fs.ts';

export interface FileEntry {
    path: string;
    name: string;
    kind: 'image' | 'video' | 'file';
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
export interface FolderNode {
    path: string;
    name: string;
    children: FolderNode[];
    canvases: CanvasEntry[];
    mediaCount: number;
    totalCount: number;
}
export interface ScanResult {
    tree: FolderNode;
    files: FileEntry[];
    canvases: CanvasEntry[];
    folders: FolderNode[];
    byPath: Map<string, FileEntry>;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });

export async function scanWorkspace(root: Dir): Promise<ScanResult> {
    const files: FileEntry[] = [];
    const canvases: CanvasEntry[] = [];
    const folders: FolderNode[] = [];

    async function walk(dir: Dir, path: string, hidden: boolean): Promise<FolderNode> {
        const node: FolderNode = { path, name: path ? basename(path) : 'Workspace', children: [], canvases: [], mediaCount: 0, totalCount: 0 };
        const jobs: Promise<void>[] = [];
        for (const [name, handle] of await entries(dir)) {
            if (name.startsWith('.')) continue;
            const p = joinPath(path, name);
            if (handle.kind === 'directory') {
                const isAssets = name.endsWith(ASSETS_SUFFIX);
                jobs.push(
                    walk(handle as Dir, p, hidden || isAssets).then((child) => {
                        if (!isAssets && !hidden) {
                            node.children.push(child);
                            folders.push(child);
                            node.totalCount += child.totalCount;
                        }
                    })
                );
            } else {
                const kind = kindOf(name);
                jobs.push(
                    (handle as FileSystemFileHandle)
                        .getFile()
                        .then((f) => {
                            if (kind === 'canvas') {
                                if (!hidden) {
                                    const c = { path: p, name: name.slice(0, -CANVAS_EXT.length), folder: path, modified: f.lastModified };
                                    canvases.push(c);
                                    node.canvases.push(c);
                                }
                                return;
                            }
                            files.push({ path: p, name, kind, size: f.size, modified: f.lastModified, folder: path, hidden });
                            if (kind !== 'file') node.mediaCount++;
                        })
                        .catch(() => {})
                );
            }
        }
        await Promise.all(jobs);
        node.children.sort(byName);
        node.canvases.sort(byName);
        node.totalCount += node.mediaCount;
        return node;
    }

    const tree = await walk(root, '', false);
    files.sort((a, b) => b.modified - a.modified);
    return { tree, files, canvases, folders, byPath: new Map(files.map((f) => [f.path, f])) };
}

export function findFolder(node: FolderNode, path: string): FolderNode | null {
    if (node.path === path) return node;
    for (const c of node.children) {
        if (path === c.path || path.startsWith(c.path + '/')) return findFolder(c, path);
    }
    return null;
}
