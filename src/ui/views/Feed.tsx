import type React from 'react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import { store, useStore, type FeedSort } from '../../state/store.ts';
import { addPathsToCanvas, createCanvas, createFolder, getRoot, importFiles, importInto, menuAt, navigate, openMenu, openViewer, toast, trashItems, updateItemMeta } from '../../state/actions.ts';
import { DRAG_MIME } from '../../lib/fs.ts';
import { findFolder, type FileEntry } from '../../lib/scan.ts';
import { allTags } from '../../lib/meta.ts';
import { getDims, getDimsVersion, getThumbUrl, subscribeDims } from '../../lib/thumbs.ts';
import { Btn, Empty, IconBtn } from '../kit.tsx';
import { Icon } from '../Icon.tsx';
import { track } from '../../sdk/track.ts';
import { isTauri, nativeFile } from '../../lib/tauriFs.ts';

export function sortItems(items: FileEntry[], sort: FeedSort): FileEntry[] {
    if (sort === 'new') return items;
    const out = [...items];
    if (sort === 'old') out.reverse();
    else out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return out;
}

/** Wraps a view so OS files dropped onto it are imported into `folder`. */
export function DropImport({ folder, children }: { folder: string; children: ReactNode }) {
    const [over, setOver] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const isFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | undefined;
        void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
            unlisten = await getCurrentWebview().onDragDropEvent((event) => {
                if (event.payload.type !== 'drop' || !event.payload.paths.length || !wrapRef.current) return;
                const rect = wrapRef.current.getBoundingClientRect();
                const p = event.payload.position;
                const dpr = window.devicePixelRatio || 1;
                const x = p.x / dpr;
                const y = p.y / dpr;
                if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
                void Promise.all(event.payload.paths.map(nativeFile)).then((files) => importFiles(folder, files));
            });
        });
        return () => unlisten?.();
    }, [folder]);
    return (
        <div
            ref={wrapRef}
            className="relative flex h-full flex-col"
            onDragOver={(e) => {
                if (isFiles(e)) {
                    e.preventDefault();
                    setOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
            }}
            onDrop={(e) => {
                if (!isFiles(e)) return;
                e.preventDefault();
                setOver(false);
                track('feed_files_dropped');
                void importFiles(folder, [...e.dataTransfer.files]);
            }}
        >
            {children}
            {over && (
                <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-sm font-semibold">
                    Drop to import into “{folder}”
                </div>
            )}
        </div>
    );
}

function FeedHeader({ title, subtitle, actions }: { title: ReactNode; subtitle: string; actions?: ReactNode }) {
    const size = useStore((s) => s.feedSize);
    const sort = useStore((s) => s.feedSort);
    return (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4">
            <div className="mr-auto min-w-0">
                <div className="truncate text-xl font-bold">{title}</div>
                <div className="text-xs text-muted">{subtitle}</div>
            </div>
            {actions}
            <select
                className="input !h-8 !w-auto"
                value={sort}
                onChange={(e) => {
                    track('feed_sort_changed', { sort: e.target.value });
                    store.patch({ feedSort: e.target.value as FeedSort });
                }}
            >
                <option value="new">Newest</option>
                <option value="old">Oldest</option>
                <option value="name">Name</option>
            </select>
            <div className="flex rounded-lg bg-white/5 p-0.5">
                {(['s', 'm', 'l'] as const).map((s) => (
                    <button
                        key={s}
                        className={`h-7 w-8 rounded-md text-xs font-semibold ${size === s ? 'bg-white/15 text-white' : 'text-muted'}`}
                        onClick={() => {
                            track('feed_size_changed', { size: s });
                            store.patch({ feedSize: s });
                        }}
                    >
                        {s.toUpperCase()}
                    </button>
                ))}
            </div>
        </div>
    );
}

interface Pos {
    x: number;
    y: number;
    w: number;
    h: number;
}

const FeedItem = memo(function FeedItem(props: {
    entry: FileEntry;
    pos: Pos;
    selected: boolean;
    favorite: boolean;
    color?: string;
    onSelect: (e: React.MouseEvent, path: string) => void;
    onOpen: (path: string) => void;
    onMenu: (e: React.MouseEvent, path: string) => void;
}) {
    const { entry, pos, selected, favorite, color, onSelect, onOpen, onMenu } = props;
    const wsId = useStore((s) => s.wsId) ?? '';
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        const root = getRoot();
        if (!root) return;
        getThumbUrl(wsId, root, entry).then((u) => {
            if (live) setUrl(u);
        });
        return () => {
            live = false;
        };
    }, [wsId, entry]);
    return (
        <div
            className={`feed-item ${selected ? 'sel' : ''}`}
            style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
            draggable
            onDragStart={(e) => {
                const sel = store.get().selection;
                const paths = sel.includes(entry.path) ? sel : [entry.path];
                e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths));
                e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onClick={(e) => {
                e.stopPropagation();
                onSelect(e, entry.path);
            }}
            onDoubleClick={() => onOpen(entry.path)}
            onContextMenu={(e) => onMenu(e, entry.path)}
        >
            {url ? <img src={url} alt="" draggable={false} className="object-cover" /> : <div className="skeleton h-full w-full" />}
            {entry.kind === 'video' && (
                <div className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60">
                    <Icon name="video" size={14} />
                </div>
            )}
            {favorite && (
                <div className="absolute left-2 top-2 text-red-400 drop-shadow">
                    <Icon name="heart" size={16} filled />
                </div>
            )}
            {color && <div className="absolute bottom-2 right-2 h-3 w-3 rounded-full ring-2 ring-black/40" style={{ background: color }} />}
            <div className="meta truncate">{entry.name}</div>
        </div>
    );
});

export function Feed({ items, emptyText }: { items: FileEntry[]; emptyText: ReactNode }) {
    const size = useStore((s) => s.feedSize);
    const selection = useStore((s) => s.selection);
    const metaItems = useStore((s) => s.meta.items);
    const dimsV = useSyncExternalStore(subscribeDims, getDimsVersion);
    const ref = useRef<HTMLDivElement>(null);
    const [vp, setVp] = useState({ w: 0, h: 0, top: 0 });
    const anchor = useRef<string | null>(null);

    useLayoutEffect(() => {
        const el = ref.current!;
        const update = () => setVp({ w: el.clientWidth, h: el.clientHeight, top: el.scrollTop });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const rafRef = useRef(0);
    const onScroll = () => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const el = ref.current;
            if (el) setVp((v) => ({ ...v, top: el.scrollTop }));
        });
    };

    const pad = 16;
    const gap = 10;
    const target = size === 's' ? 150 : size === 'm' ? 230 : 330;
    const inner = Math.max(0, vp.w - pad * 2);
    const cols = Math.max(inner > 280 ? 2 : 1, Math.floor((inner + gap) / (target + gap)));
    const colW = cols > 0 ? (inner - gap * (cols - 1)) / cols : 0;

    const layout = useMemo(() => {
        const heights = new Array(cols).fill(0) as number[];
        const pos = items.map((it) => {
            const d = getDims(it.path);
            const ar = d ? d.h / d.w : 1;
            const h = Math.min(Math.max(colW * ar, 50), colW * 3);
            let c = 0;
            for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i;
            const p = { x: pad + c * (colW + gap), y: pad + heights[c], w: colW, h };
            heights[c] += h + gap;
            return p;
        });
        return { pos, height: Math.max(0, ...heights) + pad * 2 };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, cols, colW, dimsV]);

    const paths = useMemo(() => items.map((i) => i.path), [items]);

    const onSelect = (e: React.MouseEvent, path: string) => {
        track('feed_item_selected');
        const sel = store.get().selection;
        if (e.shiftKey && anchor.current) {
            const a = paths.indexOf(anchor.current);
            const b = paths.indexOf(path);
            if (a >= 0 && b >= 0) {
                const range = paths.slice(Math.min(a, b), Math.max(a, b) + 1);
                store.patch({ selection: range, focus: path });
                return;
            }
        }
        anchor.current = path;
        if (e.ctrlKey || e.metaKey) {
            const next = sel.includes(path) ? sel.filter((p) => p !== path) : [...sel, path];
            store.patch({ selection: next, focus: next.length === 1 ? next[0] : path });
        } else store.patch({ selection: [path], focus: path });
    };
    const onOpen = (path: string) => openViewer(paths, paths.indexOf(path));
    const onMenu = (e: React.MouseEvent, path: string) => {
        const s = store.get();
        if (!s.selection.includes(path)) store.patch({ selection: [path], focus: path });
        const sel = store.get().selection;
        const fav = !!s.meta.items[path]?.favorite;
        const addToCanvas = () => {
            const canvases = store.get().scan?.canvases ?? [];
            if (!canvases.length) {
                toast('Create a canvas first');
                return;
            }
            openMenu(e.clientX, e.clientY, canvases.map((canvas) => ({
                label: `Add to canvas: ${canvas.name}`,
                icon: 'canvas' as const,
                ev: 'feed_menu_add_to_canvas_target',
                onClick: () => addPathsToCanvas(canvas.path, sel),
            })));
        };
        menuAt(e, [
            { label: 'Open', icon: 'maximize', ev: 'feed_menu_open', onClick: () => onOpen(path) },
            { label: 'Add to canvas', icon: 'canvas', ev: 'feed_menu_add_to_canvas', onClick: addToCanvas },
            { label: fav ? 'Remove favorite' : 'Add to favorites', icon: 'heart', ev: 'feed_menu_favorite', onClick: () => sel.forEach((p) => updateItemMeta(p, { favorite: !fav })) },
            { label: 'Show info', icon: 'panelRight', ev: 'feed_menu_info', onClick: () => store.patch({ rightOpen: true, focus: path }) },
            { label: sel.length > 1 ? `Move ${sel.length} to trash` : 'Move to trash', icon: 'trash', danger: true, ev: 'feed_menu_trash', onClick: () => void trashItems(sel.map((p) => ({ path: p, type: 'file' as const }))) },
        ]);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            const s = store.get();
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || s.dialog || s.viewer || s.searchOpen) return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) {
                e.preventDefault();
                track('feed_delete_key');
                void trashItems(s.selection.map((p) => ({ path: p, type: 'file' as const })));
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                track('feed_select_all');
                store.patch({ selection: paths, focus: null });
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && s.selection.length) {
                e.preventDefault();
                navigator.clipboard?.writeText(`hoard:library-paths:${JSON.stringify(s.selection)}`).catch(() => {});
                toast(`${s.selection.length} item${s.selection.length === 1 ? '' : 's'} copied`);
            } else if (e.key === 'Escape') store.patch({ selection: [], focus: null });
            else if (e.key === ' ' && s.focus) {
                e.preventDefault();
                onOpen(s.focus);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paths]);

    const lo = vp.top - 800;
    const hi = vp.top + vp.h + 800;
    const selSet = useMemo(() => new Set(selection), [selection]);

    return (
        <div ref={ref} className="relative min-h-0 flex-1 overflow-y-auto" onScroll={onScroll} onClick={() => store.patch({ selection: [], focus: null })}>
            {items.length === 0 ? (
                <Empty title="Nothing here yet">{emptyText}</Empty>
            ) : (
                <div style={{ height: layout.height, position: 'relative' }}>
                    {items.map((it, i) => {
                        const p = layout.pos[i];
                        if (!p || p.y + p.h < lo || p.y > hi) return null;
                        const m = metaItems[it.path];
                        return <FeedItem key={it.path} entry={it} pos={p} selected={selSet.has(it.path)} favorite={!!m?.favorite} color={m?.color} onSelect={onSelect} onOpen={onOpen} onMenu={onMenu} />;
                    })}
                </div>
            )}
        </div>
    );
}

export function FolderPage({ path }: { path: string }) {
    const scan = useStore((s) => s.scan)!;
    const sort = useStore((s) => s.feedSort);
    const node = useMemo(() => findFolder(scan.tree, path), [scan, path]);
    const items = useMemo(() => sortItems(scan.files.filter((f) => f.folder === path && !f.hidden && f.kind !== 'file'), sort), [scan, path, sort]);
    if (!node) return <Empty icon="folder" title="Folder not found" />;
    const hasKids = node.children.length + node.canvases.length > 0;
    return (
        <DropImport folder={path}>
            <FeedHeader
                title={node.name}
                subtitle={`${items.length} items`}
                actions={
                    <>
                        <Btn ev="folder_import_clicked" variant="subtle" icon="upload" onClick={() => void importInto(path)}>
                            Import
                        </Btn>
                        <IconBtn icon="folderPlus" title="New subfolder" ev="folder_new_subfolder_clicked" onClick={() => void createFolder(path)} />
                        <IconBtn icon="canvas" title="New canvas here" ev="folder_new_canvas_clicked" onClick={() => void createCanvas(path)} />
                    </>
                }
            />
            {hasKids && (
                <div className="flex gap-2 overflow-x-auto px-4 pb-2">
                    {node.children.map((c) => (
                        <button key={c.path} className="btn btn-subtle shrink-0" onClick={() => { track('folder_chip_clicked'); navigate({ kind: 'folder', path: c.path }); }}>
                            <Icon name="folder" size={14} /> {c.name} <span className="text-xs text-muted">{c.totalCount}</span>
                        </button>
                    ))}
                    {node.canvases.map((c) => (
                        <button key={c.path} className="btn btn-subtle shrink-0" onClick={() => { track('canvas_chip_clicked'); navigate({ kind: 'canvas', path: c.path }); }}>
                            <Icon name="canvas" size={14} /> {c.name}
                        </button>
                    ))}
                </div>
            )}
            <Feed items={items} emptyText="Drop images or videos here, or use Import." />
        </DropImport>
    );
}

export function CollectionPage({ kind, tag, tagDepth = 0 }: { kind: 'all' | 'favorites' | 'tag'; tag?: string; tagDepth?: number }) {
    const scan = useStore((s) => s.scan)!;
    const metaItems = useStore((s) => s.meta.items);
    const sort = useStore((s) => s.feedSort);
    const setTagDepth = (value: number) => store.patch({ tagGraphDepth: value });
    const items = useMemo(() => {
        let list = scan.files.filter((f) => !f.hidden && f.kind !== 'file');
        if (kind === 'favorites') list = list.filter((f) => metaItems[f.path]?.favorite);
        if (kind === 'tag' && tag) {
            const related = new Set([tag.toLocaleLowerCase()]);
            for (let level = 0; level < tagDepth; level++) {
                for (const file of list) {
                    const tags = allTags(metaItems[file.path]).map((itemTag) => itemTag.trim().toLocaleLowerCase());
                    if (tags.some((itemTag) => related.has(itemTag))) tags.forEach((itemTag) => related.add(itemTag));
                }
            }
            list = list.filter((f) => allTags(metaItems[f.path]).some((itemTag) => related.has(itemTag.trim().toLocaleLowerCase())));
        }
        return sortItems(list, sort);
    }, [scan, metaItems, kind, tag, tagDepth, sort]);
    const title = kind === 'all' ? 'All' : kind === 'favorites' ? 'Favorites' : `#${tag}`;
    const empty = kind === 'favorites' ? 'Tap the heart on any image to collect it here.' : kind === 'tag' ? 'No images have this tag.' : 'Import images to start your collection.';
    return (
        <DropImport folder="Inbox">
            <FeedHeader
                title={title}
                subtitle={`${items.length} items`}
                actions={
                    kind === 'tag' && tag ? (
                        <label className="flex items-center gap-2 text-xs text-muted">
                            Include nearby tags
                            <input type="range" min="0" max="3" step="1" value={tagDepth} onChange={(e) => setTagDepth(Number(e.target.value))} />
                            <span className="w-6 text-right text-fg">{tagDepth}</span>
                        </label>
                    ) : kind === 'all' ? (
                        <Btn ev="all_import_clicked" variant="subtle" icon="upload" onClick={() => void importInto('Inbox')}>
                            Import
                        </Btn>
                    ) : null
                }
            />
            <Feed items={items} emptyText={empty} />
        </DropImport>
    );
}
