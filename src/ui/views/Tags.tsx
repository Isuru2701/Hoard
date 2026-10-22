import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from '../../state/store.ts';
import { applyAutoTags, getRoot, toast } from '../../state/actions.ts';
import { activeTaggerModel, addTaggerModel, cancelTaggerDownloads, deleteTaggerModel, loadTaggerModel, loadTaggerModels, selectedTaggerModel, setSelectedTaggerModel, setTaggerCandidates, TAGGER_MODELS, taggerCandidates, taggerModelExplanation, taggerModels, tagWithModel, taggerModelDownloaded } from '../../lib/tagger.ts';
import { allTags } from '../../lib/meta.ts';
import { Btn, Empty } from '../kit.tsx';
import { Icon } from '../Icon.tsx';

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

interface NodePosition {
    x: number;
    y: number;
}

const WIDTH = 720;
const HEIGHT = 720;

function keyFor(tag: string): string {
    return tag.trim().toLocaleLowerCase();
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
        if (index === 0) return { tag, count: tags.get(tag) ?? 0, x: cx, y: cy };
        const ring = Math.ceil(Math.sqrt(index + 1)) - 1;
        const first = ring * ring + 1;
        const slots = Math.max(1, ring * 8);
        const position = index - first;
        const radius = Math.min(285, 112 + (ring - 1) * 92);
        const angle = (position / slots) * Math.PI * 2 - Math.PI / 2;
        return {
            tag,
            count: tags.get(tag) ?? 0,
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
        };
    });
}

export function TagManager() {
    const items = useStore((s) => s.meta.items);
    const scan = useStore((s) => s.scan);
    const [query, setQuery] = useState('');
    const selected = useStore((s) => s.tagGraphTag);
    const depth = useStore((s) => s.tagGraphDepth);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [maxTags, setMaxTags] = useState(5);
    const [loadingModel, setLoadingModel] = useState(false);
    const [modelProgress, setModelProgress] = useState(0);
    const [modelDownloaded, setModelDownloaded] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState(() => selectedTaggerModel()?.id ?? TAGGER_MODELS[0].id);
    const [models, setModels] = useState(taggerModels);
    const [newModelRepo, setNewModelRepo] = useState('');
    const [newModelLabel, setNewModelLabel] = useState('');
    const [candidateText, setCandidateText] = useState('');
    const [savingCandidates, setSavingCandidates] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const drag = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
    const nodeDrag = useRef<{ tag: string; id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
    const suppressNodeClick = useRef(false);
    const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});
    const model = activeTaggerModel();
    const imageFiles = useMemo(() => scan?.files.filter((file) => !file.hidden && file.kind === 'image') ?? [], [scan]);

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
            if (error instanceof DOMException && error.name === 'AbortError') return;
            const reason = error instanceof Error ? error.message : String(error);
            const accessHint = /401|403|unauthorized|forbidden/i.test(reason)
                ? 'The Hugging Face repository is private, gated, or missing public file access.'
                : reason.slice(0, 140);
            toast(`Model failed: ${accessHint}`);
        } finally {
            setLoadingModel(false);
        }
    };

    const run = async () => {
        const root = getRoot();
        if (!root || running || !imageFiles.length) return;
        setRunning(true);
        setDone(0);
        
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
            
        } finally {
            setRunning(false);
        }
    };

    useEffect(() => {
        void loadTaggerModels().then((value) => {
            setModels(value);
            setSelectedModelId(selectedTaggerModel()?.id ?? value[0].id);
            const selected = selectedTaggerModel();
            if (selected?.task === 'zero-shot-image-classification') setCandidateText(taggerCandidates(selected.id).join('\n'));
        });
    }, []);

    useEffect(() => {
        if (model.task === 'zero-shot-image-classification') setCandidateText(taggerCandidates(model.id).join('\n'));
    }, [model.id, model.task]);

    useEffect(() => {
        void taggerModelDownloaded().then(setModelDownloaded);
    }, [selectedModelId]);

    useEffect(() => cancelTaggerDownloads, []);

    const { tags, edges, nodes } = useMemo(() => {
        const counts = new Map<string, number>();
        const itemTags: string[][] = [];
        if (!scan) return { tags: counts, edges: [], nodes: [] };
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

    const maxCount = Math.max(1, ...nodes.map((node) => node.count));
    const selectedNeighbors = selected ? neighborhood(selected, edges, depth) : new Set<string>();
    const visibleEdges = edges.filter((edge) => !selected || selectedNeighbors.has(edge.a) && selectedNeighbors.has(edge.b));
    const positionedNodes = nodes.map((node) => ({ ...node, ...(nodePositions[node.tag] ?? {}) }));
    const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
        if (nodeDrag.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    };
    const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        const currentNode = nodeDrag.current;
        if (currentNode?.id === event.pointerId) {
            const rect = event.currentTarget.getBoundingClientRect();
            const dx = (event.clientX - currentNode.x) * (WIDTH / rect.width) / zoom;
            const dy = (event.clientY - currentNode.y) * (HEIGHT / rect.height) / zoom;
            if (Math.abs(dx) + Math.abs(dy) > 3) currentNode.moved = true;
            setNodePositions((positions) => ({ ...positions, [currentNode.tag]: { x: currentNode.startX + dx, y: currentNode.startY + dy } }));
            return;
        }
        if (!drag.current || drag.current.id !== event.pointerId) return;
        setPan({
            x: drag.current.panX + (event.clientX - drag.current.x) * (WIDTH / event.currentTarget.clientWidth),
            y: drag.current.panY + (event.clientY - drag.current.y) * (HEIGHT / event.currentTarget.clientHeight),
        });
    };
    const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
        if (nodeDrag.current?.id === event.pointerId) {
            const currentNode = nodeDrag.current;
            if (!currentNode.moved) {
                store.patch({ tagGraphTag: currentNode.tag, tagGraphDepth: 0 });
                
            }
            suppressNodeClick.current = true;
            nodeDrag.current = null;
            return;
        }
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
                    <div className="text-xs text-muted">Similarity based on tags</div>
                </div>
                <input className="input !w-52" placeholder="Filter tags…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="order-last mx-4 mt-4 rounded-xl border border-line bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="mr-auto">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Icon name="sparkles" size={14} className="text-accent" /> Auto-tag images locally</div>
                        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Uses a local vision model downloaded once and cached on this device. Nothing is uploaded.</p>
                        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-yellow-300">Warning: tagging a large number of files may freeze the app while the local model processes them.</p>
                    </div>
                    <a className="text-xs text-accent hover:underline" href={model.url} target="_blank" rel="noreferrer">Hugging Face model ↗</a>
                </div>
                <div className="mt-3 grid gap-2">
                    <div className="rounded-md border border-line bg-black/10 px-3 py-2 text-xs">
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted" htmlFor="tagger-model">Model</label>
                        <select
                            id="tagger-model"
                            className="input !h-9 w-full text-xs"
                            value={selectedModelId}
                            disabled={running || loadingModel}
                            onChange={(event) => {
                                const value = event.target.value;
                                setSelectedModelId(value);
                                setSelectedTaggerModel(value);
                                setModelDownloaded(false);
                            }}
                        >
                            {models.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                        <div className="mt-1 text-muted">{model.model} · {model.size} · {model.license}</div>
                        <p className="mt-2 leading-relaxed text-muted">{taggerModelExplanation(model)}</p>
                    </div>
                    {model.task === 'zero-shot-image-classification' && (
                        <div className="rounded-md border border-line bg-black/10 px-3 py-2 text-xs">
                            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted" htmlFor="tagger-candidates">Auto-generated tag vocabulary</label>
                            <p className="mb-2 text-muted">One candidate per line. CLIP ranks these labels; use descriptive phrases such as “casual wear”, “monochrome”, or “gothic fashion”.</p>
                            <textarea
                                id="tagger-candidates"
                                className="input min-h-32 resize-y text-xs"
                                value={candidateText}
                                disabled={running || loadingModel || savingCandidates}
                                onChange={(event) => setCandidateText(event.target.value)}
                                placeholder="casual wear&#10;monochrome&#10;gothic fashion"
                            />
                            <div className="mt-2 flex items-center gap-2">
                                <span className="text-muted">{candidateText.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean).length} candidates</span>
                                <button
                                    className="btn btn-subtle ml-auto h-8 text-xs"
                                    type="button"
                                    disabled={running || loadingModel || savingCandidates}
                                    onClick={() => {
                                        setCandidateText(model.candidates.join('\n'));
                                        void setTaggerCandidates(model.id, model.candidates).catch((error) => toast(error instanceof Error ? error.message : 'Could not reset vocabulary'));
                                    }}
                                >Reset defaults</button>
                                <button
                                    className="btn btn-primary h-8 text-xs"
                                    type="button"
                                    disabled={running || loadingModel || savingCandidates}
                                    onClick={() => {
                                        setSavingCandidates(true);
                                        void setTaggerCandidates(model.id, candidateText.split(/\r?\n|,/)).then(() => toast('Tag vocabulary saved')).catch((error) => toast(error instanceof Error ? error.message : 'Could not save vocabulary')).finally(() => setSavingCandidates(false));
                                    }}
                                >{savingCandidates ? 'Saving…' : 'Save vocabulary'}</button>
                            </div>
                        </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <select className="input !h-9 !py-1 text-xs" aria-label="Maximum generated tags" value={maxTags} disabled={running} onChange={(e) => setMaxTags(Number(e.target.value))}>
                            {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} tags per image</option>)}
                        </select>
                        <button className="btn btn-subtle h-9 justify-center text-xs" disabled={loadingModel || running} onClick={() => void prepareModel()}>
                            <Icon name="download" size={13} /> {loadingModel ? `Downloading… ${Math.round(modelProgress)}%` : modelDownloaded ? 'Model downloaded' : 'Download model'}
                        </button>
                    </div>
                    <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event) => {
                        event.preventDefault();
                        void addTaggerModel(newModelRepo, newModelLabel).then((added) => {
                            setModels(taggerModels());
                            setNewModelRepo('');
                            setNewModelLabel('');
                            setSelectedModelId(added.id);
                            setSelectedTaggerModel(added.id);
                            toast(`${added.label} added`);
                        }).catch((error) => toast(error instanceof Error ? error.message : 'Could not add model'));
                    }}>
                        <input className="input !h-9 text-xs" placeholder="HF owner/model" value={newModelRepo} onChange={(event) => setNewModelRepo(event.target.value)} />
                        <input className="input !h-9 text-xs" placeholder="Display name (optional)" value={newModelLabel} onChange={(event) => setNewModelLabel(event.target.value)} />
                        <button className="btn btn-subtle h-9 text-xs" type="submit" disabled={!newModelRepo.trim()}>Add ONNX model</button>
                    </form>
                    {model.custom && (
                        <button className="text-left text-xs text-danger hover:underline" disabled={loadingModel || running} onClick={() => {
                            void deleteTaggerModel(model.id).then(() => {
                                setModels(taggerModels());
                                setSelectedModelId(selectedTaggerModel()?.id ?? models[0].id);
                                setModelDownloaded(false);
                                toast(`${model.label} deleted`);
                            });
                        }}>Delete this model and its local files</button>
                    )}
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
                    <div className="order-first relative mx-4 h-[379px] min-h-[379px] min-w-[379px] w-[calc(100%-2rem)] flex-none overflow-hidden rounded-xl border border-line bg-bg">
                        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-full w-full cursor-grab touch-none active:cursor-grabbing" role="img" aria-label="Tag relationship graph" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onClick={() => {
                            if (suppressNodeClick.current) {
                                suppressNodeClick.current = false;
                                return;
                            }
                            store.patch({ tagGraphTag: null, tagGraphDepth: 0 });
                        }}>
                            <g transform={`translate(${pan.x} ${pan.y}) translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2} ${-HEIGHT / 2})`}>
                            {visibleEdges.map((edge) => {
                                const a = positionedNodes.find((node) => node.tag === edge.a);
                                const b = positionedNodes.find((node) => node.tag === edge.b);
                                if (!a || !b) return null;
                                return <line key={`${edge.a}-${edge.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e6edf7" strokeOpacity={selected ? 0.9 : 0.72} strokeWidth={Math.min(5, 1.8 + edge.weight * 0.55)} />;
                            })}
                            {positionedNodes.map((node) => {
                                const active = selected === node.tag;
                                const nearby = !selected || selectedNeighbors.has(node.tag);
                                const radius = 8 + (node.count / maxCount) * 14;
                                return (
                                    <g
                                        key={node.tag}
                                        className={`cursor-grab transition-opacity active:cursor-grabbing ${nearby ? 'opacity-100' : 'opacity-20'}`}
                                        onPointerDown={(event) => {
                                            event.stopPropagation();
                                            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                                            nodeDrag.current = { tag: node.tag, id: event.pointerId, x: event.clientX, y: event.clientY, startX: node.x, startY: node.y, moved: false };
                                        }}
                                        onPointerMove={(event) => {
                                            event.stopPropagation();
                                        }}
                                        onPointerUp={(event) => {
                                            event.stopPropagation();
                                        }}
                                        onPointerCancel={(event) => {
                                            event.stopPropagation();
                                            nodeDrag.current = null;
                                        }}
                                    >
                                        <circle cx={node.x} cy={node.y} r={radius + (active ? 5 : 0)} fill={active ? 'currentColor' : 'transparent'} className={active ? 'text-accent' : ''} opacity={active ? 0.18 : 1} />
                                        <circle cx={node.x} cy={node.y} r={radius} fill="currentColor" className={active ? 'text-accent' : 'text-white/20'} />
                                        <text x={node.x} y={node.y + radius + 16} textAnchor="middle" className={`fill-current text-[12px] font-medium ${active ? 'text-accent' : 'text-fg'}`}>{node.tag}</text>
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
                    <div className="order-2 flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="mr-auto text-sm">
                            {selected ? <span className="font-semibold">#{selected}</span> : <span className="text-muted">Select a tag to see its images in the center</span>}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
