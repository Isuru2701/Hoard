import { readText, writeFile, type Dir } from './fs.ts';

export interface ItemMeta {
    tags?: string[];
    autoTags?: string[];
    source?: string;
    creator?: string;
    description?: string;
    notes?: string;
    rating?: number;
    favorite?: boolean;
    color?: string;
}
export interface TrashEntry {
    id: string;
    name: string;
    originalPath: string;
    trashName: string;
    assetsTrashName?: string;
    kind: 'image' | 'video' | 'file' | 'folder' | 'canvas' | 'markdown';
    deletedAt: number;
    meta?: Record<string, ItemMeta>;
}
export interface RecentEntry {
    path: string;
    kind: 'folder' | 'canvas' | 'doc';
    at: number;
}
export interface WorkspaceMeta {
    version: 1;
    items: Record<string, ItemMeta>;
    trash: TrashEntry[];
    recents: RecentEntry[];
    /** Custom color swatches added in the canvas, per style channel. */
    palette?: { stroke: string[]; fill: string[]; noteBg: string[] };
}

const META_FILE = '.hoard/meta.json';

export const emptyMeta = (): WorkspaceMeta => ({ version: 1, items: {}, trash: [], recents: [] });

export async function loadMeta(root: Dir): Promise<WorkspaceMeta> {
    const t = await readText(root, META_FILE);
    if (!t) return emptyMeta();
    try {
        const m = JSON.parse(t) as Partial<WorkspaceMeta>;
        return { version: 1, items: m.items ?? {}, trash: m.trash ?? [], recents: m.recents ?? [], palette: m.palette ?? { stroke: [], fill: [], noteBg: [] } };
    } catch {
        return emptyMeta();
    }
}

export async function saveMeta(root: Dir, meta: WorkspaceMeta): Promise<void> {
    await writeFile(root, META_FILE, JSON.stringify(meta));
}

export const allTags = (m?: ItemMeta): string[] => [...(m?.tags ?? []), ...(m?.autoTags ?? [])];
