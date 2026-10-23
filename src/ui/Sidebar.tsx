import { useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { useStore, type View } from '../state/store.ts';
import {
    closeWorkspace,
    createCanvas,
    createFolder,
    createMarkdown,
    createMenuItems,
    importFiles,
    importInto,
    menuAt,
    moveFiles,
    navigate,
    openMenu,
    renameEntry,
    toggleCollapsed,
    trashItems,
} from '../state/actions.ts';
import { DRAG_MIME, dirname } from '../lib/fs.ts';
import type { CanvasEntry, DocEntry, FolderNode } from '../lib/scan.ts';
import { Btn, IconBtn } from './kit.tsx';
import { Icon, type IconName } from './Icon.tsx';

export function useFolderDrop(path: string) {
    const [over, setOver] = useState(false);
    return {
        over,
        props: {
            onDragOver: (e: DragEvent) => {
                const t = e.dataTransfer.types;
                if (t.includes('Files') || t.includes(DRAG_MIME)) {
                    e.preventDefault();
                    e.stopPropagation();
                    setOver(true);
                }
            },
            onDragLeave: () => setOver(false),
            onDrop: (e: DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                const raw = e.dataTransfer.getData(DRAG_MIME);
                if (raw) {
                    
                    void moveFiles(JSON.parse(raw) as string[], path);
                } else if (e.dataTransfer.files.length) {
                    
                    void importFiles(path, [...e.dataTransfer.files]);
                }
            },
        },
    };
}

function NavItem({ icon, label, view, count, onClick, ev }: { icon: IconName; label: string; view?: View; count?: number; onClick?: (e: MouseEvent) => void; ev: string }) {
    const active = useStore((s) => !!view && s.view.kind === view.kind && view.kind !== 'tag');
    return (
        <button
            className={`nav-item ${active ? 'on' : ''}`}
            onClick={(e) => {
                
                if (onClick) onClick(e);
                else if (view) navigate(view);
            }}
        >
            <Icon name={icon} size={16} />
            <span className="flex-1">{label}</span>
            {!!count && <span className="text-xs text-muted">{count}</span>}
        </button>
    );
}

function folderMenu(node: FolderNode) {
    return [
        { label: 'New subfolder', icon: 'folderPlus' as const, ev: 'folder_menu_subfolder', onClick: () => void createFolder(node.path) },
        { label: 'New canvas here', icon: 'canvas' as const, ev: 'folder_menu_canvas', onClick: () => void createCanvas(node.path) },
        { label: 'New markdown here', icon: 'file' as const, ev: 'folder_menu_markdown', onClick: () => void createMarkdown(node.path) },
        { label: 'Import here', icon: 'upload' as const, ev: 'folder_menu_import', onClick: () => void importInto(node.path) },
        { label: 'Rename', icon: 'edit' as const, ev: 'folder_menu_rename', onClick: () => void renameEntry(node.path, 'folder') },
        { label: 'Move to trash', icon: 'trash' as const, danger: true, ev: 'folder_menu_trash', onClick: () => void trashItems([{ path: node.path, type: 'folder' }]) },
    ];
}

function canvasMenu(c: CanvasEntry) {
    return [
        { label: 'Open', icon: 'canvas' as const, ev: 'canvas_menu_open', onClick: () => navigate({ kind: 'canvas', path: c.path }) },
        { label: 'Rename', icon: 'edit' as const, ev: 'canvas_menu_rename', onClick: () => void renameEntry(c.path, 'canvas') },
        { label: 'Move to trash', icon: 'trash' as const, danger: true, ev: 'canvas_menu_trash', onClick: () => void trashItems([{ path: c.path, type: 'canvas' }]) },
    ];
}

function CanvasRow({ c, depth }: { c: CanvasEntry; depth: number }) {
    const active = useStore((s) => s.view.kind === 'canvas' && s.view.path === c.path);
    return (
        <div
            className={`tree-row ${active ? 'on' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
                
                navigate({ kind: 'canvas', path: c.path });
            }}
            onContextMenu={(e) => menuAt(e, canvasMenu(c))}
        >
            <span className="w-4" />
            <Icon name="canvas" size={15} className="shrink-0" />
            <span className="flex-1 truncate">{c.name}</span>
            <button className="row-more ib !h-6 !min-w-6" aria-label="Canvas options" onClick={(e) => menuAt(e, canvasMenu(c))}>
                <Icon name="more" size={14} />
            </button>
        </div>
    );
}

function docMenu(d: DocEntry) {
    return [
        { label: 'Open', icon: 'file' as const, ev: 'doc_menu_open', onClick: () => navigate({ kind: 'doc', path: d.path }) },
        { label: 'Rename', icon: 'edit' as const, ev: 'doc_menu_rename', onClick: () => void renameEntry(d.path, 'file') },
        { label: 'Move to trash', icon: 'trash' as const, danger: true, ev: 'doc_menu_trash', onClick: () => void trashItems([{ path: d.path, type: 'file' }]) },
    ];
}

function DocRow({ d, depth }: { d: DocEntry; depth: number }) {
    const active = useStore((s) => s.view.kind === 'doc' && s.view.path === d.path);
    return (
        <div
            className={`tree-row ${active ? 'on' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => navigate({ kind: 'doc', path: d.path })}
            onContextMenu={(e) => menuAt(e, docMenu(d))}
        >
            <span className="w-4" />
            <Icon name="file" size={15} className="shrink-0 text-muted" />
            <span className="flex-1 truncate">{d.name}</span>
            <button className="row-more ib !h-6 !min-w-6" aria-label="Document options" onClick={(e) => menuAt(e, docMenu(d))}>
                <Icon name="more" size={14} />
            </button>
        </div>
    );
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
    const collapsed = useStore((s) => !!s.collapsed[node.path]);
    const active = useStore((s) => s.view.kind === 'folder' && s.view.path === node.path);
    const drop = useFolderDrop(node.path);
    const hasKids = node.children.length + node.canvases.length + node.docs.length > 0;
    return (
        <div>
            <div
                className={`tree-row ${active ? 'on' : ''} ${drop.over ? 'drop' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => {
                    
                    navigate({ kind: 'folder', path: node.path });
                }}
                onContextMenu={(e) => menuAt(e, folderMenu(node))}
                {...drop.props}
            >
                <button
                    className="grid h-5 w-4 shrink-0 place-items-center text-muted"
                    aria-label="Expand"
                    onClick={(e) => {
                        e.stopPropagation();
                        
                        toggleCollapsed(node.path);
                    }}
                >
                    {hasKids && <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />}
                </button>
                <Icon name="folder" size={15} className="shrink-0" />
                <span className="flex-1 truncate">{node.name}</span>
                {node.totalCount > 0 && <span className="text-xs text-muted">{node.totalCount}</span>}
                <button className="row-more ib !h-6 !min-w-6" aria-label="Folder options" onClick={(e) => menuAt(e, folderMenu(node))}>
                    <Icon name="more" size={14} />
                </button>
            </div>
            {!collapsed && hasKids && <TreeChildren node={node} depth={depth + 1} />}
        </div>
    );
}

function TreeChildren({ node, depth }: { node: FolderNode; depth: number }) {
    return (
        <>
            {node.children.map((c) => (
                <FolderRow key={c.path} node={c} depth={depth} />
            ))}
            {node.canvases.map((c) => (
                <CanvasRow key={c.path} c={c} depth={depth} />
            ))}
            {node.docs.map((d) => (
                <DocRow key={d.path} d={d} depth={depth} />
            ))}
        </>
    );
}

export default function Sidebar({ overlay }: { overlay: boolean }) {
    const scan = useStore((s) => s.scan);
    const view = useStore((s) => s.view);
    const wsId = useStore((s) => s.wsId);
    const workspaces = useStore((s) => s.workspaces);
    const trashCount = useStore((s) => s.meta.trash.length);
    const ws = workspaces.find((w) => w.id === wsId);
    const mediaCount = useMemo(() => scan?.files.filter((f) => !f.hidden && f.kind !== 'file').length ?? 0, [scan]);
    const currentFolder = view.kind === 'folder' ? view.path : view.kind === 'canvas' ? dirname(view.path) : '';
    const rootDrop = useFolderDrop('');

    return (
        <aside className={`flex w-64 shrink-0 flex-col bg-bg ${overlay ? 'side-overlay left-0' : ''}`}>
            <div className="px-3 pt-1">
                <button
                    className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-white/5"
                    title="Switch workspace"
                    onClick={() => {
                        
                        closeWorkspace();
                    }}
                >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ws?.color }}>
                        {ws?.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Workspace</div>
                        <div className="truncate text-sm font-semibold">{ws?.name}</div>
                    </div>
                    <Icon name="swap" size={15} className="text-muted" />
                </button>
            </div>
            <nav className="mt-2 space-y-0.5 px-2">
                <NavItem icon="home" label="Home" view={{ kind: 'home' }} ev="nav_home_clicked" />
                <NavItem icon="images" label="All" view={{ kind: 'all' }} count={mediaCount} ev="nav_all_clicked" />
                <NavItem icon="heart" label="Favorites" view={{ kind: 'favorites' }} ev="nav_favorites_clicked" />
                <NavItem icon="trash" label="Trash" view={{ kind: 'trash' }} count={trashCount} ev="nav_trash_clicked" />
                <NavItem
                    icon="plus"
                    label="Create"
                    ev="nav_create_clicked"
                    onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        openMenu(r.left + 8, r.bottom, createMenuItems(currentFolder));
                    }}
                />
                <NavItem icon="tag" label="Tag Graph" view={{ kind: 'tags' }} ev="nav_tags_clicked" />
            </nav>
            <div className={`mt-5 flex items-center justify-between rounded-lg pl-4 pr-2 ${rootDrop.over ? 'bg-accent/10' : ''}`} {...rootDrop.props}>
                <span className="section-label">Folders</span>
                <div className="flex items-center gap-1">
                    <IconBtn icon="folderPlus" title="New folder" ev="sidebar_new_folder_clicked" size={14} onClick={() => void createFolder('')} />
                    <IconBtn icon="canvas" title="New canvas" ev="sidebar_new_canvas_clicked" size={14} onClick={() => void createCanvas('')} />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {scan && <TreeChildren node={scan.tree} depth={0} />}
                <div className="py-4 text-center text-xs text-muted/60">{scan && scan.folders.length + scan.canvases.length === 0 ? 'No folders yet' : 'That’s all'}</div>
            </div>
        </aside>
    );
}
