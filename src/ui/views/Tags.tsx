import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from '../../state/store.ts';
import { applyAutoTags, getRoot, navigate, toast } from '../../state/actions.ts';
import { loadTaggerModel, selectedTaggerModel, TAGGER_MODELS, tagWithModel, taggerModelDownloaded } from '../../lib/tagger.ts';
import { allTags } from '../../lib/meta.ts';
import { Btn, Empty } from '../kit.tsx';
import { Icon } from '../Icon.tsx';
import { Feed } from './Feed.tsx';
import { track } from '../../sdk/track.ts';

interface TagNode {
    tag: string;
    count: number;
    x: number;
    y: number;
}

interface TagEdge {
    a: string;
    b: string;
    weight: number;
}

const WIDTH = 900;
const HEIGHT = 470;

function keyFor(tag: string): string {
    return tag.trim().toLocaleLowerCase();
}

function graphLayout(tags: Map<string, number>, edges: TagEdge[]): TagNode[] {
    const degree = new Map<string, number>();
    for (const edge of edges) {
        degree.set(edge.a, (degree.get(edge.a) ?? 0) + edge.weight);
        degree.set(edge.b, (degree.get(edge.b) ?? 0) + edge.weight);
    }
    const ordered = [...tags.keys()].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || (tags.get(b) ?? 0) - (tags.get(a) ?? 0) || a.localeCompare(b));
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    return ordered.map((tag, index) => {
        const ring = Math.floor(Math.sqrt(index + 1));
        const first = ring * ring;
        const slots = Math.max(1, ring * 8);
        const position = index - first;
        const radius = ring === 0 ? 0 : Math.min(205, 70 + ring * 58);
        const angle = (position / slots) * Math.PI * 2 - Math.PI / 2;
        return {
            tag,
            count: tags.get(tag) ?? 0,
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
        };
    });
}

function neighborhood(start: string, edges: TagEdge[], depth: number): Set<string> {
    const result = new Set([start]);
    let frontier = new Set([start]);
    for (let level = 0; level < depth; level++) {
        const next = new Set<string>();
        for (const edge of edges) {
            if (frontier.has(edge.a)) next.add(edge.b);
            if (frontier.has(edge.b)) next.add(edge.a);
        }
        for (const tag of next) result.add(tag);
        frontier = next;
    }
    return result;
}

export function TagManager() {
    const items = useStore((s) => s.meta.items);
    const scan = useStore((s) => s.scan)!;
    const [query, setQuery] = useState('');
    const selected = useStore((s) => s.tagGraphTag);
    const [depth, setDepth] = useState(0);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [maxTags, setMaxTags] = useState(5);
    const [loadingModel, setLoadingModel] = useState(false);
    const [modelProgress, setModelProgress] = useState(0);
    const [modelDownloaded, setModelDownloaded] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const drag = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
    const model = selectedTaggerModel() ?? TAGGER_MODELS[0];
    const imageFiles = useMemo(() => scan.files.filter((file) => !file.hidden && file.kind === 'image'), [scan]);

    const prepareModel = async () => {
        if (loadingModel) return;
        setLoadingModel(true);
        setModelProgress(0);
        try {
            await loadTaggerModel(setModelProgress);
            setModelDownloaded(true);
            toast(`${model.label} is ready on this device`);
        } catch (error) {
            console.warn('[autotag] model download failed', error);
            const reason = error instanceof Error ? error.message : String(error);
            toast(`Model failed: ${reason.slice(0, 140)}`);
        } finally {
            setLoadingModel(false);
        }
    };

    const run = async () => {
        const root = getRoot();
        if (!root || running || !imageFiles.length) return;
        setRunning(true);
        setDone(0);
        track('autotag_run_started', { count: imageFiles.length, maxTags });
        const results: Record<string, string[]> = {};
        let failures = 0;
        try {
            for (const file of imageFiles) {
                try {
                    results[file.path] = await tagWithModel(root, file, maxTags);
                } catch (error) {
                    failures++;
                    console.warn('[autotag] image failed', file.path, error);
                }
                setDone((value) => value + 1);
            }
            applyAutoTags(results);
            toast(`Tagged ${Object.keys(results).length} image${Object.keys(results).length === 1 ? '' : 's'}${failures ? `; ${failures} failed` : ''}`);
            track('autotag_run_finished', { count: Object.keys(results).length, failures });
        } finally {
            setRunning(false);
        }
    };

    useEffect(() => {
        void taggerModelDownloaded().then(setModelDownloaded);
    }, []);

    const { tags, edges, nodes } = useMemo(() => {
        const counts = new Map<string, number>();
        const itemTags: string[][] = [];
        for (const [path, meta] of Object.entries(items)) {
            if (!scan.byPath.has(path)) continue;
            const current = [...new Set(allTags(meta).map(keyFor).filter(Boolean))];
            if (!current.length) continue;
            itemTags.push(current);
            for (const tag of current) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
        const weights = new Map<string, number>();
        for (const current of itemTags) {
            for (let i = 0; i < current.length; i++) {
                for (let j = i + 1; j < current.length; j++) {
                    const pair = [current[i], current[j]].sort().join('\u0000');
                    weights.set(pair, (weights.get(pair) ?? 0) + 1);
                }
            }
        }
        const graphEdges = [...weights].map(([pair, weight]) => {
            const [a, b] = pair.split('\u0000');
            return { a, b, weight };
        });
        const filtered = new Map([...counts].filter(([tag]) => !query || tag.includes(query.trim().toLocaleLowerCase())));
        return { tags: filtered, edges: graphEdges.filter((edge) => filtered.has(edge.a) && filtered.has(edge.b)), nodes: graphLayout(filtered, graphEdges) };
    }, [items, scan, query]);

    const selectedNeighbors = selected ? neighborhood(selected, edges, depth) : new Set<string>();
    const feedItems = useMemo(() => {
        if (!selected) return [];
        return scan.files.filter((file) => {
            if (file.hidden || file.kind === 'file') return false;
            return allTags(items[file.path]).some((tag) => selectedNeighbors.has(keyFor(tag)));
        });
    }, [items, scan, selected, selectedNeighbors]);

    const maxCount = Math.max(1, ...nodes.map((node) => node.count));
    const visibleEdges = edges.filter((edge) => !selected || selectedNeighbors.has(edge.a) && selectedNeighbors.has(edge.b));
    const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    };
    const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        if (!drag.current || drag.current.id !== event.pointerId) return;
        setPan({
            x: drag.current.panX + (event.clientX - drag.current.x) * (WIDTH / event.currentTarget.clientWidth),
            y: drag.current.panY + (event.clientY - drag.current.y) * (HEIGHT / event.currentTarget.clientHeight),
        });
    };
    const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
    };
    const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
        event.preventDefault();
        setZoom((value) => Math.max(0.55, Math.min(2.8, value * (event.deltaY < 0 ? 1.1 : 0.9))));
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            <div className="flex flex-wrap items-center gap-3 px-4 pb-2 pt-4">
                <div className="mr-auto">
                    <div className="text-xl font-bold">Tag graph</div>
                    <div className="text-xs text-muted">Semantic closeness from tags used on the same images</div>
                </div>
                <input className="input !w-52" placeholder="Filter tags…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="mx-4 mb-4 rounded-xl border border-line bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="mr-auto">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Icon name="sparkles" size={14} className="text-accent" /> Auto-tag images locally</div>
                        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Uses <strong className="text-fg">Xenova/clip-vit-base-patch32</strong> from Hugging Face, downloaded once and cached on this device. Nothing is uploaded.</p>
                    </div>
                    <a className="text-xs text-accent hover:underline" href={model.url} target="_blank" rel="noreferrer">Hugging Face model ↗</a>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <div className="rounded-md border border-line bg-black/10 px-3 py-2 text-xs">
                        <div className="font-medium">{model.label} · {model.size}</div>
                        <div className="mt-0.5 text-muted">{model.license} · Transformers.js / zero-shot image classification</div>
                    </div>
                    <select className="input !h-9 !py-1 text-xs" aria-label="Maximum generated tags" value={maxTags} disabled={running} onChange={(e) => setMaxTags(Number(e.target.value))}>
                        {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} tags</option>)}
                    </select>
                    <button className="btn btn-subtle h-9 justify-center text-xs" disabled={loadingModel || running} onClick={() => void prepareModel()}>
                        <Icon name="download" size={13} /> {loadingModel ? `Downloading… ${Math.round(modelProgress)}%` : modelDownloaded ? 'Model downloaded' : 'Download model'}
                    </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">{imageFiles.length} images in this workspace{running && ` · ${done} / ${imageFiles.length}`}</span>
                    <Btn ev="tag_graph_autotag_clicked" variant="primary" className="ml-auto" disabled={running || loadingModel || !imageFiles.length} onClick={() => void run()}>{running ? 'Tagging…' : 'Auto-tag all images'}</Btn>
                </div>
            </div>
            {nodes.length === 0 ? (
                <div className="min-h-0 flex-1 px-4 pb-4">
                    <Empty icon="tag" title="No tags yet">Select an image and add tags in the right panel, or use the local auto-tagger above.</Empty>
                </div>
            ) : (
                <>
                    <div className="relative mx-4 overflow-hidden rounded-xl border border-line bg-black/10">
                        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-[min(52vh,470px)] w-full min-h-[300px] cursor-grab touch-none active:cursor-grabbing" role="img" aria-label="Tag relationship graph" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
                            <g transform={`translate(${pan.x} ${pan.y}) translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2} ${-HEIGHT / 2})`}>
                            {visibleEdges.map((edge) => {
                                const a = nodes.find((node) => node.tag === edge.a);
                                const b = nodes.find((node) => node.tag === edge.b);
                                if (!a || !b) return null;
                                return <line key={`${edge.a}-${edge.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className="text-line" strokeOpacity={selected ? 0.55 : 0.3} strokeWidth={Math.min(4, 0.8 + edge.weight * 0.35)} />;
                            })}
                            {nodes.map((node) => {
                                const active = selected === node.tag;
                                const nearby = !selected || selectedNeighbors.has(node.tag);
                                const radius = 8 + (node.count / maxCount) * 14;
                                return (
                                    <g key={node.tag} className={`cursor-pointer transition-opacity ${nearby ? 'opacity-100' : 'opacity-20'}`} onClick={() => {                                     store.patch({ tagGraphTag: node.tag }); setDepth(0); track('tag_graph_node_selected'); }}>
                                        <circle cx={node.x} cy={node.y} r={radius + (active ? 5 : 0)} fill={active ? 'currentColor' : 'transparent'} className={active ? 'text-accent' : ''} opacity={active ? 0.18 : 1} />
                                        <circle cx={node.x} cy={node.y} r={radius} fill="currentColor" className={active ? 'text-accent' : 'text-white/20'} />
                                        <text x={node.x} y={node.y + radius + 16} textAnchor="middle" className={`fill-current text-[12px] ${active ? 'text-accent' : 'text-muted'}`}>{node.tag}</text>
                                    </g>
                                );
                            })}
                            </g>
                        </svg>
                        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 shadow-lg">
                            <button className="grid h-7 w-7 place-items-center rounded text-sm text-muted hover:bg-white/10 hover:text-fg" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.55, value / 1.1))}>−</button>
                            <span className="min-w-10 text-center text-[10px] text-muted">{Math.round(zoom * 100)}%</span>
                            <button className="grid h-7 w-7 place-items-center rounded text-sm text-muted hover:bg-white/10 hover:text-fg" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.8, value * 1.1))}>+</button>
                            <button className="rounded px-1.5 py-1 text-[10px] text-muted hover:bg-white/10 hover:text-fg" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="mr-auto text-sm">
                            {selected ? <><span className="font-semibold">#{selected}</span><span className="ml-2 text-muted">{feedItems.length} images</span></> : <span className="text-muted">Select a tag to see its images</span>}
                        </div>
                        {selected && (
                            <label className="flex items-center gap-2 text-xs text-muted">
                                Include nearby tags
                                <input type="range" min="0" max="3" step="1" value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
                                <span className="w-6 text-right text-foreground">{depth}</span>
                            </label>
                        )}
                        {selected && <Btn ev="tag_graph_open_tag_clicked" variant="subtle" onClick={() => navigate({ kind: 'tag', tag: selected })}>Open tag</Btn>}
                    </div>
                    {selected && <div className="min-h-[260px] flex-1"><Feed items={feedItems} emptyText="No images use this tag or its selected neighbors." /></div>}
                </>
            )}
        </div>
    );
}
