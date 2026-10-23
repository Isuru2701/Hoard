import { useMemo } from 'react';
import { store, useStore } from '../../state/store.ts';
import { createMenuItems, createMarkdown, navigate, openMenu, openViewer, canvasName } from '../../state/actions.ts';
import { basename } from '../../lib/fs.ts';
import { findFolder } from '../../lib/scan.ts';
import { allTags } from '../../lib/meta.ts';
import { Btn, ThumbImg } from '../kit.tsx';
import { Icon, type IconName } from '../Icon.tsx';
import { DropImport } from './Feed.tsx';

function Stat({ icon, n, label, onClick }: { icon: IconName; n: number; label: string; onClick?: () => void }) {
    return (
        <button className="flex items-center gap-4 rounded-xl border border-line bg-white/[0.02] p-4 text-left transition hover:bg-white/[0.05]" onClick={onClick}>
            <Icon name={icon} size={18} className="text-muted" />
            <div>
                <div className="text-xl font-bold leading-tight">{n}</div>
                <div className="text-xs text-muted">{label}</div>
            </div>
        </button>
    );
}

export default function Home() {
    const scan = useStore((s) => s.scan)!;
    const meta = useStore((s) => s.meta);
    const profile = useStore((s) => s.profile);
    const wsId = useStore((s) => s.wsId);
    const ws = useStore((s) => s.workspaces).find((w) => w.id === wsId);
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

    const stats = useMemo(() => {
        const visible = scan.files.filter((f) => !f.hidden);
        const tags = new Set<string>();
        for (const f of visible) allTags(meta.items[f.path]).forEach((t) => tags.add(t));
        return {
            images: visible.filter((f) => f.kind === 'image').length,
            videos: visible.filter((f) => f.kind === 'video').length,
            files: visible.filter((f) => f.kind === 'file').length,
            tags: tags.size,
        };
    }, [scan, meta.items]);

    const recentFiles = useMemo(() => scan.files.filter((f) => !f.hidden && f.kind !== 'file').slice(0, 18), [scan]);
    const recents = useMemo(
        () => meta.recents.filter((r) => (r.kind === 'folder' ? !!findFolder(scan.tree, r.path) && r.path : scan.canvases.some((c) => c.path === r.path))).slice(0, 6),
        [meta.recents, scan]
    );

    return (
        <DropImport folder="Inbox">
            <div className="h-full overflow-y-auto">
                <div className="flex flex-wrap justify-end gap-1 p-3">
                    <Btn
                        ev="home_create_clicked"
                        icon="plus"
                        onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            openMenu(r.left, r.bottom + 4, [
                                ...createMenuItems(''),
                                { label: 'New markdown', icon: 'markdown', ev: 'create_menu_markdown', onClick: () => void createMarkdown('Inbox') },
                            ]);
                        }}
                    >
                        Create
                    </Btn>
                </div>
                <div className="mx-auto max-w-5xl px-5 pb-10 sm:px-8">
                    <div className="section-label mt-4">{ws?.name}</div>
                    <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                        {greet}, {profile?.name ?? 'there'}
                    </h1>
                    <button
                        className="mt-6 flex h-11 w-full max-w-md items-center gap-3 rounded-xl border border-line bg-white/[0.03] px-4 text-sm text-muted hover:bg-white/[0.05]"
                        onClick={() => {
                            
                            store.patch({ searchOpen: true });
                        }}
                    >
                        <Icon name="search" size={16} />
                        <span className="flex-1 text-left">Search your library…</span>
                        <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
                    </button>

                    <div className="mt-7 grid grid-cols-2 gap-2.5 md:grid-cols-3">
                        <Stat icon="images" n={stats.images} label="Images" onClick={() => { navigate({ kind: 'all' }); }} />
                        <Stat icon="video" n={stats.videos} label="Videos" onClick={() => { navigate({ kind: 'all' }); }} />
                        <Stat icon="file" n={stats.files} label="Other files" />
                        <Stat icon="folder" n={scan.folders.length} label="Folders" />
                        <Stat icon="canvas" n={scan.canvases.length} label="Canvases" />
                        <Stat icon="tag" n={stats.tags} label="Tags" onClick={() => { navigate({ kind: 'tags' }); }} />
                    </div>

                    {recents.length > 0 && (
                        <>
                            <div className="section-label mb-3 mt-9">Recently opened</div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                                {recents.map((r) => {
                                    const imgs = r.kind === 'folder' ? scan.files.filter((f) => f.folder === r.path && !f.hidden && f.kind !== 'file').slice(0, 4) : [];
                                    return (
                                        <button
                                            key={r.path}
                                            className="overflow-hidden rounded-xl border border-line bg-white/[0.02] text-left hover:bg-white/[0.05]"
                                            onClick={() => { navigate({ kind: r.kind, path: r.path }); }}
                                        >
                                            <div className="grid aspect-square grid-cols-2 gap-0.5 bg-black/30 p-1">
                                                {imgs.length ? (
                                                    imgs.map((f) => <ThumbImg key={f.path} entry={f} className="h-full w-full rounded-sm" />)
                                                ) : (
                                                    <div className="col-span-2 grid place-items-center text-muted">
                                                        <Icon name={r.kind === 'canvas' ? 'canvas' : 'folder'} size={32} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2.5 py-2 text-sm">
                                                <Icon name={r.kind === 'canvas' ? 'canvas' : 'folder'} size={13} className="shrink-0 text-muted" />
                                                <span className="truncate">{r.kind === 'canvas' ? canvasName(r.path) : basename(r.path)}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    <div className="mb-3 mt-9 flex items-center justify-between">
                        <span className="section-label">Recent files</span>
                        <Btn ev="home_view_all_clicked" onClick={() => navigate({ kind: 'all' })}>
                            View all
                        </Btn>
                    </div>
                    {recentFiles.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
                            Drop images anywhere here, or use <b>Create → Import</b>. Start by creating a folder for your references.
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                            {recentFiles.map((f, i) => (
                                <button
                                    key={f.path}
                                    className="aspect-square overflow-hidden rounded-lg bg-white/5"
                                    onClick={() => (f.kind === 'markdown' ? navigate({ kind: 'doc', path: f.path }) : openViewer(recentFiles.map((x) => x.path), i))}
                                >
                                    {f.kind === 'markdown' ? (
                                        <div className="grid h-full w-full place-items-center text-muted">
                                            <Icon name="markdown" size={20} />
                                        </div>
                                    ) : (
                                        <ThumbImg entry={f} className="h-full w-full" />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </DropImport>
    );
}
