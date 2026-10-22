import { useMemo, useState } from 'react';
import { useStore } from '../../state/store.ts';
import { applyAutoTags, askConfirm, askText, deleteTag, getRoot, navigate, renameTag, toast } from '../../state/actions.ts';
import { selectedTaggerModel, tagWithModel } from '../../lib/tagger.ts';
import { Btn, Empty, IconBtn } from '../kit.tsx';
import { Icon } from '../Icon.tsx';
import { normTag } from '../RightPanel.tsx';
import { track } from '../../sdk/track.ts';

export function TagManager() {
    const items = useStore((s) => s.meta.items);
    const scan = useStore((s) => s.scan)!;
    const [q, setQ] = useState('');
    const tags = useMemo(() => {
        const m = new Map<string, { count: number; auto: boolean; manual: boolean }>();
        for (const [path, it] of Object.entries(items)) {
            if (!scan.byPath.has(path)) continue;
            for (const t of it.tags ?? []) {
                const e = m.get(t) ?? { count: 0, auto: false, manual: false };
                e.count++;
                e.manual = true;
                m.set(t, e);
            }
            for (const t of it.autoTags ?? []) {
                const e = m.get(t) ?? { count: 0, auto: false, manual: false };
                e.count++;
                e.auto = true;
                m.set(t, e);
            }
        }
        return [...m].filter(([t]) => !q || t.includes(q.toLowerCase())).sort((a, b) => b[1].count - a[1].count);
    }, [items, scan, q]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4">
                <div className="mr-auto">
                    <div className="text-xl font-bold">Tag Manager</div>
                    <div className="text-xs text-muted">{tags.length} tags</div>
                </div>
                <input className="input !w-52" placeholder="Filter tags…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                {tags.length === 0 ? (
                    <Empty icon="tag" title="No tags yet">Select an image and add tags in the right panel, or run the Auto Tagger.</Empty>
                ) : (
                    tags.map(([t, info]) => (
                        <div key={t} className="flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-white/[0.04]">
                            <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { track('tag_opened'); navigate({ kind: 'tag', tag: t }); }}>
                                <span className={`chip ${info.auto && !info.manual ? 'chip-auto' : ''} !pr-2`}>
                                    {info.auto && <Icon name="sparkles" size={11} />}
                                    {t}
                                </span>
                                <span className="text-xs text-muted">{info.count}</span>
                            </button>
                            <IconBtn
                                icon="edit"
                                title="Rename tag"
                                ev="tag_rename_clicked"
                                onClick={async () => {
                                    const n = await askText('Rename tag', t, 'Rename');
                                    if (n && normTag(n) !== t) renameTag(t, normTag(n));
                                }}
                            />
                            <IconBtn
                                icon="trash"
                                title="Delete tag"
                                ev="tag_delete_clicked"
                                danger
                                onClick={async () => {
                                    if (await askConfirm('Delete tag?', `Remove “${t}” from ${info.count} item(s)? The images stay.`)) deleteTag(t);
                                }}
                            />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export function AutoTagger() {
    const scan = useStore((s) => s.scan)!;
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [total, setTotal] = useState(0);
    const [maxTags, setMaxTags] = useState(5);
    const files = useMemo(() => scan.files.filter((f) => !f.hidden && f.kind !== 'file'), [scan]);

    const run = async () => {
        const root = getRoot();
        if (!root || running) return;
        track('autotag_run_started', { count: files.length });
        setRunning(true);
        setDone(0);
        setTotal(files.length);
        const results: Record<string, string[]> = {};
        let i = 0;
        await Promise.all(
            Array.from({ length: 4 }, async () => {
                while (i < files.length) {
                    const f = files[i++];
                    results[f.path] = await tagWithModel(root, f, maxTags);
                    setDone((d) => d + 1);
                }
            })
        );
        applyAutoTags(results);
        setRunning(false);
        toast(`Tagged ${Object.keys(results).length} items with ${selectedTaggerModel()?.label}`);
        track('autotag_run_finished', { count: Object.keys(results).length });
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-xl px-6 py-12">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent/15 text-accent">
                    <Icon name="sparkles" size={22} />
                </div>
                <h1 className="mt-4 text-2xl font-bold">Auto Tagger</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                    Uses the selected downloaded model locally (nothing is uploaded) to suggest visual tags. Suggestions are stored separately from manual tags and can be removed individually.
                </p>
                <div className="mt-6 rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between text-sm">
                        <span>{files.length} items in this workspace</span>
                        {running && (
                            <span className="text-muted">
                                {done} / {total}
                            </span>
                        )}
                    </div>
                    {running && (
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full bg-accent transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                        </div>
                    )}
                    <div className="mt-4 flex items-center gap-2">
                        <label className="text-xs text-muted" htmlFor="workspace-max-tags">Max tags</label>
                        <select id="workspace-max-tags" className="input !h-8 !w-20 !py-1 text-xs" value={maxTags} onChange={(e) => setMaxTags(Number(e.target.value))}>
                            {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                    <Btn ev="autotag_run_clicked" variant="primary" className="mt-4" disabled={running || !files.length} onClick={() => void run()}>
                        {running ? 'Tagging…' : 'Tag all items'}
                    </Btn>
                </div>
            </div>
        </div>
    );
}
