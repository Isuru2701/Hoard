import { useEffect, useState } from 'react';
import { store, useStore, viewKey, type View } from '../state/store.ts';
import { canvasName, closeTab, goBack, goForward, navigate, rescan, toggleFullscreen } from '../state/actions.ts';
import { basename, splitPath } from '../lib/fs.ts';
import { IconBtn } from './kit.tsx';
import { Icon, type IconName } from './Icon.tsx';
import Sidebar from './Sidebar.tsx';
import RightPanel from './RightPanel.tsx';
import Home from './views/Home.tsx';
import { CollectionPage, FolderPage } from './views/Feed.tsx';
import TrashView from './views/Trash.tsx';
import SearchModal from './SearchModal.tsx';
import Viewer from './Viewer.tsx';
import CanvasView from '../canvas/CanvasView.tsx';
import DocView from './views/DocView.tsx';
import { Empty } from './kit.tsx';

function useWidth() {
    const [w, setW] = useState(window.innerWidth);
    useEffect(() => {
        const on = () => setW(window.innerWidth);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return w;
}

const TITLES: Record<string, string> = { home: 'Home', all: 'All', favorites: 'Favorites', trash: 'Trash', tags: 'Tag Graph' };

export function viewLabel(v: View): string {
    if (v.kind === 'folder') return basename(v.path);
    if (v.kind === 'canvas') return canvasName(v.path);
    if (v.kind === 'doc') return basename(v.path).replace(/\.(md|markdown|mdx)$/i, '') || 'Document';
    if (v.kind === 'tag') return `#${v.tag}`;
    return TITLES[v.kind];
}
export function viewIcon(v: View): IconName {
    if (v.kind === 'folder') return 'folder';
    if (v.kind === 'canvas') return 'canvas';
    if (v.kind === 'doc') return 'file';
    if (v.kind === 'tag') return 'tag';
    return 'home';
}

function Breadcrumbs() {
    const view = useStore((s) => s.view);
    if (view.kind !== 'folder' && view.kind !== 'canvas') return <span className="truncate">{viewLabel(view)}</span>;
    const parts = splitPath(view.path);
    return (
        <div className="flex min-w-0 items-center gap-1">
            {parts.map((p, i) => {
                const last = i === parts.length - 1;
                const path = parts.slice(0, i + 1).join('/');
                return (
                    <span key={path} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <Icon name="chevronRight" size={12} className="shrink-0 text-muted" />}
                        {last ? (
                            <span className="truncate text-fg">{view.kind === 'canvas' ? canvasName(view.path) : p}</span>
                        ) : (
                            <button
                                className="truncate text-muted hover:text-fg"
                                onClick={() => {
                                    navigate({ kind: 'folder', path });
                                }}
                            >
                                {p}
                            </button>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

function TopBar() {
    const leftOpen = useStore((s) => s.leftOpen);
    const rightOpen = useStore((s) => s.rightOpen);
    const canBack = useStore((s) => s.back.length > 0);
    const canFwd = useStore((s) => s.fwd.length > 0);
    return (
        <header className="flex h-12 shrink-0 items-center gap-0.5 px-2">
            <IconBtn icon="panelLeft" title="Toggle sidebar (Ctrl+\)" ev="ui_left_sidebar_toggled" active={leftOpen} onClick={() => store.patch({ leftOpen: !leftOpen })} />
            <IconBtn icon="panelRight" title="Toggle info panel" ev="ui_right_panel_toggled" active={rightOpen} onClick={() => store.patch({ rightOpen: !rightOpen })} />
            <IconBtn icon="arrowLeft" title="Back" ev="nav_back_clicked" disabled={!canBack} onClick={goBack} className="max-sm:hidden" />
            <IconBtn icon="arrowRight" title="Forward" ev="nav_forward_clicked" disabled={!canFwd} onClick={goForward} className="max-sm:hidden" />
            <IconBtn icon="refresh" title="Refresh from disk" ev="nav_refresh_clicked" onClick={() => void rescan()} className="max-sm:hidden" />
            <div className="mx-2 flex h-8 min-w-0 flex-1 items-center rounded-lg bg-white/[0.04] px-3 text-sm">
                <Breadcrumbs />
            </div>
            <IconBtn icon="search" title="Search (Ctrl+K)" ev="search_opened" onClick={() => store.patch({ searchOpen: true })} />
            <IconBtn icon="maximize" title="Fullscreen" ev="ui_fullscreen_clicked" onClick={toggleFullscreen} />
        </header>
    );
}

function TabBar() {
    const tabs = useStore((s) => s.tabs);
    const view = useStore((s) => s.view);
    const active = viewKey(view);
    return (
        <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-2">
            {tabs.map((t) => (
                <div
                    key={viewKey(t)}
                    className={`tab ${viewKey(t) === active ? 'on' : ''}`}
                    onClick={() => {
                        navigate(t);
                    }}
                >
                    <Icon name={viewIcon(t)} size={13} className="shrink-0" />
                    <span className="truncate">{viewLabel(t)}</span>
                    <button
                        className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-white/10"
                        aria-label="Close tab"
                        onClick={(e) => {
                            e.stopPropagation();
                            closeTab(t);
                        }}
                    >
                        <Icon name="x" size={12} />
                    </button>
                </div>
            ))}
        </div>
    );
}

function ViewRouter() {
    const view = useStore((s) => s.view);
    const tagGraphTag = useStore((s) => s.tagGraphTag);
    const tagGraphDepth = useStore((s) => s.tagGraphDepth);
    switch (view.kind) {
        case 'home':
            return <Home />;
        case 'canvas':
            return <CanvasView key={view.path} path={view.path} />;
        case 'folder':
            return <FolderPage key={view.path} path={view.path} />;
        case 'doc':
            return <DocView key={view.path} path={view.path} />;
        case 'all':
            return <CollectionPage key="all" kind="all" />;
        case 'favorites':
            return <CollectionPage key="fav" kind="favorites" />;
        case 'tag':
            return <CollectionPage key={'tag' + view.tag} kind="tag" tag={view.tag} />;
        case 'trash':
            return <TrashView />;
        case 'tags':
            return tagGraphTag ? <CollectionPage key={`tag-graph-${tagGraphTag}`} kind="tag" tag={tagGraphTag} tagDepth={tagGraphDepth} /> : <div className="grid h-full place-items-center px-6"><Empty icon="tag" title="Select a tag">Select a node in the tag graph to see its images here.</Empty></div>;
    }
}

export default function WorkspaceShell() {
    const leftOpen = useStore((s) => s.leftOpen);
    const rightOpen = useStore((s) => s.rightOpen);
    const fullscreen = useStore((s) => s.fullscreen);
    const scanned = useStore((s) => s.scan !== null);
    const viewKind = useStore((s) => s.view.kind);
    const width = useWidth();
    const narrowL = width < 900;
    const narrowR = width < 1200;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                store.patch({ searchOpen: true });
            } else if (mod && e.key === '\\') {
                e.preventDefault();
                store.patch({ leftOpen: !store.get().leftOpen });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (viewKind === 'tags' && !store.get().rightOpen) store.patch({ rightOpen: true });
    }, [viewKind]);

    return (
        <div className="flex h-full flex-col">
            {!fullscreen && <TopBar />}
            <div className="relative flex min-h-0 flex-1">
                {leftOpen && !fullscreen && (
                    <>
                        {narrowL && <div className="backdrop" onClick={() => store.patch({ leftOpen: false })} />}
                        <Sidebar overlay={narrowL} />
                    </>
                )}
                <main className="flex min-w-0 flex-1 flex-col">
                    <div className={`relative min-h-0 flex-1 overflow-hidden ${fullscreen ? '' : 'main-card mx-1.5'}`}>
                        {scanned ? (
                            <ViewRouter />
                        ) : (
                            <div className="grid h-full place-items-center text-sm text-muted">Reading your workspace…</div>
                        )}
                        {fullscreen && (
                            <div className="absolute right-3 top-3 z-30">
                                <IconBtn icon="minimize" title="Exit fullscreen" ev="ui_fullscreen_exit" className="floating" onClick={toggleFullscreen} />
                            </div>
                        )}
                    </div>
                    {!fullscreen && <TabBar />}
                </main>
                {rightOpen && !fullscreen && (
                    <>
                        {narrowR && <div className="backdrop" onClick={() => store.patch({ rightOpen: false })} />}
                        <RightPanel overlay={narrowR} />
                    </>
                )}
            </div>
            <SearchModal />
            <Viewer />
        </div>
    );
}
