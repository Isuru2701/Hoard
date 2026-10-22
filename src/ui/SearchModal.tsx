import { useEffect, useMemo, useState } from 'react';
import { store, useStore } from '../state/store.ts';
import { navigate } from '../state/actions.ts';
import { dirname } from '../lib/fs.ts';
import { allTags } from '../lib/meta.ts';
import { ThumbImg } from './kit.tsx';
import { Icon } from './Icon.tsx';

interface Result {
    key: string;
    label: string;
    sub: string;
    kind: 'folder' | 'canvas' | 'file' | 'tag';
    go: () => void;
    path?: string;
}

export default function SearchModal() {
    const open = useStore((s) => s.searchOpen);
    const scan = useStore((s) => s.scan);
    const items = useStore((s) => s.meta.items);
    const [q, setQ] = useState('');
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        if (open) {
            setQ('');
            setIdx(0);
        }
    }, [open]);

    const results = useMemo<Result[]>(() => {
        if (!scan) return [];
        const s = q.trim().toLowerCase();
        if (!s) return [];
        const out: Result[] = [];
        const tagSet = new Set<string>();
        for (const it of Object.values(items)) allTags(it).forEach((t) => t.includes(s) && tagSet.add(t));
        for (const t of [...tagSet].slice(0, 5)) out.push({ key: 't' + t, label: `#${t}`, sub: 'Tag', kind: 'tag', go: () => navigate({ kind: 'tag', tag: t }) });
        for (const f of scan.folders) if (f.name.toLowerCase().includes(s)) out.push({ key: f.path, label: f.name, sub: f.path, kind: 'folder', go: () => navigate({ kind: 'folder', path: f.path }) });
        for (const c of scan.canvases) if (c.name.toLowerCase().includes(s)) out.push({ key: c.path, label: c.name, sub: 'Canvas · ' + (c.folder || 'workspace'), kind: 'canvas', go: () => navigate({ kind: 'canvas', path: c.path }) });
        for (const f of scan.files) {
            if (out.length > 60) break;
            if (f.hidden || f.kind === 'file') continue;
            const m = items[f.path];
            const hit = f.name.toLowerCase().includes(s) || allTags(m).some((t) => t.includes(s)) || (m?.description ?? '').toLowerCase().includes(s) || (m?.creator ?? '').toLowerCase().includes(s);
            if (hit)
                out.push({
                    key: f.path,
                    label: f.name,
                    sub: dirname(f.path) || 'workspace',
                    kind: 'file',
                    path: f.path,
                    go: () => {
                        navigate({ kind: 'folder', path: f.folder });
                        store.patch({ focus: f.path, selection: [f.path], rightOpen: true });
                    },
                });
        }
        return out;
    }, [q, scan, items]);

    if (!open) return null;
    const close = () => store.patch({ searchOpen: false });
    const pick = (r: Result) => {
        
        close();
        r.go();
    };
    return (
        <div className="fixed inset-0 z-[70] flex justify-center bg-black/50 p-4 pt-[12vh]" onPointerDown={close}>
            <div className="floating flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl" onPointerDown={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3 border-b border-line px-4">
                    <Icon name="search" size={17} className="text-muted" />
                    <input
                        autoFocus
                        className="h-12 flex-1 bg-transparent text-[15px] outline-none"
                        placeholder="Search names, tags, descriptions…"
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                            setIdx(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') close();
                            if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
                            if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
                            if (e.key === 'Enter' && results[idx]) pick(results[idx]);
                        }}
                    />
                </div>
                <div className="overflow-y-auto p-1.5">
                    {q && results.length === 0 && <div className="p-6 text-center text-sm text-muted">No matches</div>}
                    {!q && <div className="p-6 text-center text-sm text-muted">Type to search your library</div>}
                    {results.map((r, i) => {
                        const entry = r.path ? scan?.byPath.get(r.path) : undefined;
                        return (
                            <button key={r.key} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${i === idx ? 'bg-white/10' : 'hover:bg-white/5'}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(r)}>
                                {entry ? (
                                    <ThumbImg entry={entry} className="h-9 w-9 shrink-0 rounded" />
                                ) : (
                                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded bg-white/5 text-muted">
                                        <Icon name={r.kind === 'tag' ? 'tag' : r.kind === 'canvas' ? 'canvas' : 'folder'} size={16} />
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <div className="truncate text-sm">{r.label}</div>
                                    <div className="truncate text-xs text-muted">{r.sub}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
