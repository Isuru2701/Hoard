import { useMemo, useState, type ReactNode } from 'react';
import { store, useStore } from '../state/store.ts';
import { autoTagItem, canvasAssetsPath, canvasName, getRoot, navigate, openViewer, renameEntry, toast, trashItems, updateItemMeta } from '../state/actions.ts';
import { basename, getFile } from '../lib/fs.ts';
import { findFolder, type FileEntry } from '../lib/scan.ts';
import { getDims } from '../lib/thumbs.ts';
import { downloadBlob } from '../lib/zip.ts';
import { Btn, IconBtn, ThumbImg, formatBytes, formatDate } from './kit.tsx';
import { Icon } from './Icon.tsx';
import { track } from '../sdk/track.ts';
import { isTauri, revealNativePath } from '../lib/tauriFs.ts';
import { TagManager } from './views/Tags.tsx';

const LABEL_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#a3a3a3'];
const CANVAS_SHORTCUTS = [
    ['V', 'Select'],
    ['H', 'Hand / pan'],
    ['N', 'Sticky note'],
    ['T', 'Text'],
    ['R', 'Rectangle'],
    ['O', 'Ellipse'],
    ['L', 'Line'],
    ['A', 'Arrow'],
    ['P', 'Pen'],
    ['E', 'Eraser'],
    ['Ctrl + Z', 'Undo'],
    ['Ctrl + D', 'Duplicate'],
    ['[  ]', 'Layer order'],
    ['Shift + 1', 'Fit canvas'],
    ['Ctrl + Shift + C', 'Copy as PNG'],
    ['Ctrl + scroll', 'Zoom'],
] as const;

async function revealInExplorer(path: string) {
    if (!isTauri()) {
        toast('Reveal in File Explorer is available in the desktop app');
        return;
    }
    const wsId = store.get().wsId;
    const workspace = store.get().workspaces.find((item) => item.id === wsId);
    if (!workspace?.path) {
        toast('This workspace is not linked to a local folder');
        return;
    }
    try {
        const relative = path.replaceAll('/', '\\');
        await revealNativePath(`${workspace.path.replace(/[\\/]$/, '')}\\${relative}`);
        track('reveal_in_explorer_clicked');
    } catch (error) {
        console.warn('[reveal] failed', error);
        toast('Could not open File Explorer');
    }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="border-t border-line px-4 py-4">
            <div className="section-label mb-3">{title}</div>
            {children}
        </div>
    );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
    return (
        <div className="mb-2.5">
            <div className="text-xs text-muted">{k}</div>
            <div className="break-words text-sm">{v}</div>
        </div>
    );
}

export const normTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);

function TagEditor({ path }: { path: string }) {
    const meta = useStore((s) => s.meta.items[path]);
    const [input, setInput] = useState('');
    const tags = meta?.tags ?? [];
    const auto = meta?.autoTags ?? [];
    const [maxAutoTags, setMaxAutoTags] = useState(5);
    const [tagging, setTagging] = useState(false);
    const add = () => {
        const parts = input.split(',').map(normTag).filter(Boolean);
        if (!parts.length) return;
        updateItemMeta(path, { tags: [...new Set([...tags, ...parts])] });
        setInput('');
        track('meta_tag_added');
    };
    const runAutoTag = async () => {
        if (tagging) return;
        setTagging(true);
        try {
            track('autotag_item_started', { maxTags: maxAutoTags });
            await autoTagItem(path, maxAutoTags);
        } finally {
            setTagging(false);
        }
    };
    return (
        <div>
            <div className="mb-3 rounded-lg border border-line bg-white/[0.025] p-2.5">
                <div className="flex items-center gap-2">
                    <Icon name="sparkles" size={13} className="text-accent" />
                    <span className="text-xs font-medium">Model tagging</span>
                    <select
                        className="ml-auto h-7 rounded-md border border-line bg-white/[0.06] px-1.5 text-xs text-fg"
                        aria-label="Maximum auto-tags"
                        value={maxAutoTags}
                        onChange={(e) => setMaxAutoTags(Number(e.target.value))}
                    >
                        {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} max</option>)}
                    </select>
                </div>
                <button className="btn btn-primary mt-2 h-8 w-full justify-center text-xs" disabled={tagging} onClick={() => void runAutoTag()}>
                    <Icon name="sparkles" size={13} />
                    {tagging ? 'Analysing…' : 'Tag this image'}
                </button>
                <button className="mt-2 text-left text-[10px] text-accent hover:underline" onClick={() => navigate({ kind: 'tags' })}>
                    Configure the local model in Tag Graph →
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                    <span key={t} className="chip">
                        {t}
                        <button aria-label="Remove tag" className="grid h-5 w-5 place-items-center rounded hover:bg-white/10" onClick={() => { track('meta_tag_removed'); updateItemMeta(path, { tags: tags.filter((x) => x !== t) }); }}>
                            <Icon name="x" size={11} />
                        </button>
                    </span>
                ))}
                {auto.map((t) => (
                    <span key={'a' + t} className="chip chip-auto" title="Auto tag">
                        <Icon name="sparkles" size={11} />
                        {t}
                        <button aria-label="Remove auto tag" className="grid h-5 w-5 place-items-center rounded hover:bg-white/10" onClick={() => { track('meta_autotag_removed'); updateItemMeta(path, { autoTags: auto.filter((x) => x !== t) }); }}>
                            <Icon name="x" size={11} />
                        </button>
                    </span>
                ))}
            </div>
            <input
                className="input mt-2"
                placeholder="Add tags (Enter or comma)…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        add();
                    }
                }}
                onBlur={add}
            />
        </div>
    );
}

function FilePanel({ entry }: { entry: FileEntry }) {
    const meta = useStore((s) => s.meta.items[entry.path]) ?? {};
    const d = getDims(entry.path);
    const download = async () => {
        const root = getRoot();
        if (!root) return;
        downloadBlob(await getFile(root, entry.path), entry.name);
    };
    return (
        <>
            <div className="p-4">
                <button className="block w-full overflow-hidden rounded-lg bg-black/30" onClick={() => openViewer([entry.path], 0)}>
                    <ThumbImg entry={entry} className="max-h-56 w-full !object-contain" />
                </button>
                <div className="mt-3 flex items-start gap-2">
                    <Icon name={entry.kind === 'video' ? 'video' : 'images'} size={15} className="mt-0.5 shrink-0 text-muted" />
                    <div className="min-w-0 break-all text-sm font-semibold">{entry.name}</div>
                </div>
                <div className="mt-1 text-xs text-muted">
                    {d ? `${d.w} × ${d.h} · ` : ''}
                    {formatBytes(entry.size)} · {formatDate(entry.modified)}
                </div>
            </div>
            <Section title="Quick actions">
                <div className="flex items-center gap-1">
                    <IconBtn icon="heart" title="Favorite" ev="meta_favorite_toggled" filled={meta.favorite} active={meta.favorite} onClick={() => updateItemMeta(entry.path, { favorite: !meta.favorite })} />
                    <div className="ml-2 flex">
                        {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} aria-label={`${n} stars`} className={`grid h-8 w-7 place-items-center ${(meta.rating ?? 0) >= n ? 'text-yellow-400' : 'text-muted'}`} onClick={() => { track('meta_rating_set', { n }); updateItemMeta(entry.path, { rating: meta.rating === n ? 0 : n }); }}>
                                <Icon name="star" size={15} filled={(meta.rating ?? 0) >= n} />
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {LABEL_COLORS.map((c) => (
                        <button key={c} aria-label="Color label" className={`swatch !rounded-full ${meta.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => { track('meta_color_set'); updateItemMeta(entry.path, { color: meta.color === c ? undefined : c }); }} />
                    ))}
                </div>
            </Section>
            <Section title="Tags">
                <TagEditor path={entry.path} />
            </Section>
            <Section title="Content">
                <textarea className="ghost-input" rows={2} placeholder="Add a description…" value={meta.description ?? ''} onChange={(e) => updateItemMeta(entry.path, { description: e.target.value })} onBlur={() => track('meta_description_edited')} />
                <textarea className="ghost-input mt-2" rows={3} placeholder="Add notes…" value={meta.notes ?? ''} onChange={(e) => updateItemMeta(entry.path, { notes: e.target.value })} onBlur={() => track('meta_notes_edited')} />
            </Section>
            <Section title="Attribution">
                <input className="ghost-input" placeholder="Creator name…" value={meta.creator ?? ''} onChange={(e) => updateItemMeta(entry.path, { creator: e.target.value })} onBlur={() => track('meta_creator_edited')} />
                <div className="flex items-center gap-1">
                    <input className="ghost-input" placeholder="https://… (source link)" value={meta.source ?? ''} onChange={(e) => updateItemMeta(entry.path, { source: e.target.value })} onBlur={() => track('meta_source_edited')} />
                    {meta.source && /^https?:\/\//.test(meta.source) && (
                        <IconBtn icon="external" title="Open source link" ev="meta_source_opened" onClick={() => window.open(meta.source, '_blank', 'noopener')} />
                    )}
                </div>
            </Section>
            <div className="flex flex-wrap gap-1 border-t border-line p-3">
                <Btn ev="file_panel_reveal_clicked" icon="folder" onClick={() => void revealInExplorer(entry.path)}>Reveal in Explorer</Btn>
                <Btn ev="file_panel_download" icon="download" onClick={download}>Download</Btn>
                {!entry.hidden && <Btn ev="file_panel_rename" icon="edit" onClick={() => void renameEntry(entry.path, 'file')}>Rename</Btn>}
                {!entry.hidden && <Btn ev="file_panel_trash" icon="trash" onClick={() => void trashItems([{ path: entry.path, type: 'file' }])}>Trash</Btn>}
            </div>
        </>
    );
}

function MultiPanel({ paths }: { paths: string[] }) {
    const [input, setInput] = useState('');
    const addAll = () => {
        const parts = input.split(',').map(normTag).filter(Boolean);
        if (!parts.length) return;
        const items = store.get().meta.items;
        for (const p of paths) updateItemMeta(p, { tags: [...new Set([...(items[p]?.tags ?? []), ...parts])] });
        setInput('');
        track('meta_bulk_tag_added', { count: paths.length });
    };
    return (
        <div className="p-4">
            <div className="text-3xl font-bold">{paths.length}</div>
            <div className="text-sm text-muted">items selected</div>
            <div className="section-label mb-2 mt-6">Add tags to all</div>
            <input className="input" placeholder="tag, another tag" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAll()} />
            <div className="mt-6 flex flex-col gap-1">
                <Btn ev="multi_favorite_clicked" icon="heart" onClick={() => paths.forEach((p) => updateItemMeta(p, { favorite: true }))}>Add to favorites</Btn>
                <Btn ev="multi_trash_clicked" icon="trash" onClick={() => void trashItems(paths.map((p) => ({ path: p, type: 'file' as const })))}>Move to trash</Btn>
                <Btn ev="multi_clear_clicked" icon="x" onClick={() => store.patch({ selection: [], focus: null })}>Clear selection</Btn>
            </div>
        </div>
    );
}

function HomePanel() {
    const profile = useStore((s) => s.profile);
    const wsId = useStore((s) => s.wsId);
    const ws = useStore((s) => s.workspaces).find((w) => w.id === wsId);
    const scan = useStore((s) => s.scan);
    return (
        <>
            <div className="p-4">
                <div className="text-lg font-bold">{profile?.name}</div>
                <div className="text-sm text-muted">@{profile?.username}</div>
            </div>
            <Section title="Profile">{profile && <Row k="Profile created" v={formatDate(profile.created)} />}</Section>
            <Section title="Workspace">
                <Row k="Name" v={ws?.name} />
                <Row k="Location" v={ws?.rootLabel} />
                <Row k="Created" v={ws ? formatDate(ws.created) : ''} />
                <Row k="Content" v={scan ? scan.files.filter((f) => !f.hidden).length + scan.canvases.length : '…'} />
            </Section>
        </>
    );
}

function FolderPanel({ path }: { path: string }) {
    const scan = useStore((s) => s.scan);
    const node = useMemo(() => (scan ? findFolder(scan.tree, path) : null), [scan, path]);
    if (!node) return null;
    return (
        <>
            <div className="p-4">
                <div className="flex items-center gap-2 text-lg font-bold">
                    <Icon name="folder" size={18} />
                    {node.name}
                </div>
                <div className="text-sm text-muted">{node.mediaCount} items</div>
            </div>
            <Section title="Details">
                <Row k="Path" v={path} />
                <Row k="Subfolders" v={node.children.length} />
                <Row k="Canvases" v={node.canvases.length} />
                <Row k="Including subfolders" v={`${node.totalCount} items`} />
            </Section>
            <div className="border-t border-line p-3">
                <Btn ev="folder_panel_reveal_clicked" icon="folder" className="w-full justify-center" onClick={() => void revealInExplorer(path)}>
                    Reveal in Explorer
                </Btn>
            </div>
            <div className="border-t border-line p-4 text-xs leading-relaxed text-muted">Tip: click an image to see and edit its tags, source and notes here. Ctrl/Shift-click to select several.</div>
        </>
    );
}

function CanvasInfo({ path }: { path: string }) {
    return (
        <>
            <div className="p-4">
                <div className="flex items-center gap-2 text-lg font-bold">
                    <Icon name="canvas" size={18} />
                    {canvasName(path)}
                </div>
                <div className="text-sm text-muted">Canvas</div>
            </div>
            <Section title="Details">
                <Row k="File" v={basename(path)} />
                <Row k="Images saved in" v={canvasAssetsPath(path)} />
            </Section>
            <div className="border-t border-line p-3">
                <Btn ev="canvas_panel_reveal_clicked" icon="folder" className="w-full justify-center" onClick={() => void revealInExplorer(path)}>
                    Reveal in Explorer
                </Btn>
            </div>
            <div className="border-t border-line p-4">
                <p className="text-xs leading-relaxed text-muted">Select a single image on the canvas to edit its tags, source and notes here.</p>
                <div className="mt-4">
                    <div className="section-label mb-2">Shortcuts</div>
                    <div className="space-y-1">
                        {CANVAS_SHORTCUTS.map(([key, label]) => (
                            <div key={key} className="flex items-center gap-3 rounded-md px-1 py-1 text-xs">
                                <kbd className="min-w-[76px] rounded border border-line bg-white/[0.06] px-1.5 py-1 text-center font-mono text-[10px] font-medium text-fg shadow-sm">{key}</kbd>
                                <span className="text-muted">{label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}

export default function RightPanel({ overlay }: { overlay: boolean }) {
    const focus = useStore((s) => s.focus);
    const selection = useStore((s) => s.selection);
    const view = useStore((s) => s.view);
    const entry = useStore((s) => (s.focus ? s.scan?.byPath.get(s.focus) : undefined));
    let body: ReactNode;
    if (view.kind === 'tags') body = <TagManager />;
    else if (selection.length > 1) body = <MultiPanel paths={selection} />;
    else if (focus && entry) body = <FilePanel key={entry.path} entry={entry} />;
    else if (view.kind === 'folder') body = <FolderPanel path={view.path} />;
    else if (view.kind === 'canvas') body = <CanvasInfo path={view.path} />;
    else body = <HomePanel />;
    return (
        <aside className={`${view.kind === 'tags' ? 'w-[min(520px,45vw)] min-w-[380px]' : 'w-[300px]'} shrink-0 overflow-y-auto bg-bg ${overlay ? 'side-overlay right-0' : ''}`}>
            {overlay && (
                <div className="flex justify-end p-2">
                    <IconBtn icon="x" title="Close panel" ev="ui_right_panel_closed" onClick={() => store.patch({ rightOpen: false })} />
                </div>
            )}
            {body}
        </aside>
    );
}
