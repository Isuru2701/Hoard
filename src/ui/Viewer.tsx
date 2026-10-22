import { useEffect, useState } from 'react';
import { store, useStore } from '../state/store.ts';
import { getRoot } from '../state/actions.ts';
import { getFile } from '../lib/fs.ts';
import { IconBtn } from './kit.tsx';

export default function Viewer() {
    const viewer = useStore((s) => s.viewer);
    const scan = useStore((s) => s.scan);
    const [url, setUrl] = useState<string | null>(null);
    const path = viewer ? viewer.paths[viewer.index] : null;
    const entry = path ? scan?.byPath.get(path) : undefined;

    useEffect(() => {
        const root = getRoot();
        if (!path || !root) return;
        let u: string | null = null;
        let live = true;
        setUrl(null);
        getFile(root, path)
            .then((f) => {
                if (!live) return;
                u = URL.createObjectURL(f);
                setUrl(u);
            })
            .catch(() => {});
        return () => {
            live = false;
            if (u) URL.revokeObjectURL(u);
        };
    }, [path]);

    useEffect(() => {
        if (!viewer) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') store.patch({ viewer: null });
            if (e.key === 'ArrowRight') step(1);
            if (e.key === 'ArrowLeft') step(-1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    if (!viewer || !path) return null;
    const step = (d: number) => {
        const v = store.get().viewer;
        if (!v) return;
        const index = (v.index + d + v.paths.length) % v.paths.length;
        store.patch({ viewer: { ...v, index }, focus: v.paths[index] });
    };
    const close = () => store.patch({ viewer: null });
    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95">
            <div className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1 truncate px-2 text-sm text-white/80">
                    {entry?.name} <span className="text-white/40">· {viewer.index + 1} / {viewer.paths.length}</span>
                </div>
                <IconBtn icon="panelRight" title="Show info" ev="viewer_info_clicked" onClick={() => { store.patch({ focus: path, rightOpen: true, viewer: null }); }} />
                <IconBtn icon="x" title="Close" ev="viewer_closed" onClick={close} />
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-2" onClick={close}>
                {url &&
                    (entry?.kind === 'video' ? (
                        <video src={url} controls autoPlay className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
                    ) : (
                        <img src={url} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
                    ))}
                {viewer.paths.length > 1 && (
                    <>
                        <IconBtn icon="chevronLeft" title="Previous" ev="viewer_prev" size={22} className="floating absolute left-3 !h-11 !w-11 !rounded-full" onClick={(e) => { e.stopPropagation(); step(-1); }} />
                        <IconBtn icon="chevronRight" title="Next" ev="viewer_next" size={22} className="floating absolute right-3 !h-11 !w-11 !rounded-full" onClick={(e) => { e.stopPropagation(); step(1); }} />
                    </>
                )}
            </div>
        </div>
    );
}

