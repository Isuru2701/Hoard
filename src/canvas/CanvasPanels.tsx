import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store.ts';
import { DRAG_MIME } from '../lib/fs.ts';
import { CanvasEngine, FONT, notePad } from './engine.ts';
import { DEFAULT_ADJ, type Adjust, type El, type NoteEl } from './types.ts';
import { IconBtn, ThumbImg } from '../ui/kit.tsx';
import { Icon } from '../ui/Icon.tsx';

const fmt = (v: number) => String(Math.round(v * 10) / 10);

function NumField({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (n: number) => void; suffix?: string }) {
    const [text, setText] = useState(fmt(value));
    const [focused, setFocused] = useState(false);
    const commit = () => {
        const n = parseFloat(text);
        if (isFinite(n) && fmt(n) !== fmt(value)) {
            
            onCommit(n);
        }
    };
    return (
        <label className="numfield">
            <span className="w-4 shrink-0">{label}</span>
            <input
                inputMode="decimal"
                value={focused ? text : fmt(value)}
                onFocus={() => {
                    setText(fmt(value));
                    setFocused(true);
                }}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => {
                    setFocused(false);
                    commit();
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            {suffix}
        </label>
    );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
    return (
        <label className="block">
            <div className="flex justify-between text-xs text-muted">
                <span>{label}</span>
                <span>{Math.round(value)}</span>
            </div>
            <input type="range" className="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
    );
}

export function SelectionPanel({ engine, onClose }: { engine: CanvasEngine; onClose: () => void }) {
    const sel = engine.selectedEls();
    const [link, setLink] = useState(true);
    if (!sel.length) return null;
    const e: El | null = sel.length === 1 ? sel[0] : null;
    const upd = (fn: (el: El) => Partial<El>, now = true) => engine.updateSelected(fn, now);
    const adj: Adjust = e?.type === 'image' ? e.adj ?? DEFAULT_ADJ : DEFAULT_ADJ;
    const opacity = Math.round((sel.reduce((s, x) => s + x.opacity, 0) / sel.length) * 100);
    return (
        <div className="floating absolute right-3 top-16 z-10 max-h-[calc(100%-140px)] w-60 overflow-y-auto rounded-xl text-sm max-sm:hidden">
            <div className="flex items-center justify-between px-3 pt-2">
                <span className="font-semibold">Selection</span>
                <IconBtn icon="x" title="Close panel" ev="canvas_panel_closed" onClick={onClose} />
            </div>
            <div className="flex items-baseline gap-2 px-3 pb-3">
                <span className="text-2xl font-bold">{sel.length}</span>
                <span className="text-xs text-muted">element{sel.length > 1 ? 's' : ''} selected</span>
            </div>
            {e && (
                <>
                    <div className="border-t border-line px-3 py-3">
                        <div className="section-label mb-2">Position</div>
                        <div className="grid grid-cols-2 gap-2">
                            <NumField label="X" value={e.x} onCommit={(x) => upd(() => ({ x }))} />
                            <NumField label="Y" value={e.y} onCommit={(y) => upd(() => ({ y }))} />
                            <NumField label="R" value={(e.r * 180) / Math.PI} suffix="°" onCommit={(d) => upd(() => ({ r: (d * Math.PI) / 180 }))} />
                            <button className={`btn !h-7 !px-2 ${e.locked ? 'text-accent' : ''}`} onClick={() => { engine.toggleLock(); }}>
                                <Icon name={e.locked ? 'lock' : 'unlock'} size={13} /> {e.locked ? 'Locked' : 'Lock'}
                            </button>
                        </div>
                    </div>
                    <div className="border-t border-line px-3 py-3">
                        <div className="section-label mb-2 flex items-center justify-between">
                            Dimensions
                            <button className={`ib !h-6 !min-w-6 ${link ? 'ib-on' : ''}`} title="Keep proportions" onClick={() => { setLink(!link); }}>
                                <Icon name="link" size={12} />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <NumField label="W" value={e.w} onCommit={(w) => upd((o) => ({ w: Math.max(1, w), h: link && o.w ? (o.h * Math.max(1, w)) / o.w : o.h }))} />
                            <NumField label="H" value={e.h} onCommit={(h) => upd((o) => ({ h: Math.max(1, h), w: link && o.h ? (o.w * Math.max(1, h)) / o.h : o.w }))} />
                        </div>
                    </div>
                </>
            )}
            <div className="border-t border-line px-3 py-3">
                <div className="section-label mb-2">Appearance</div>
                <Slider label="Opacity" value={opacity} min={5} max={100} onChange={(v) => upd(() => ({ opacity: v / 100 }), false)} />
            </div>
            {e?.type === 'image' && (
                <>
                    <div className="border-t border-line px-3 py-3">
                        <div className="section-label mb-2">Flip & crop</div>
                        <div className="flex flex-wrap gap-1">
                            <button className="btn btn-subtle !h-8 !px-2" onClick={() => { engine.flip('x'); }}>
                                <Icon name="flipH" size={14} /> Horizontal
                            </button>
                            <button className="btn btn-subtle !h-8 !px-2" onClick={() => { engine.flip('y'); }}>
                                <Icon name="flipV" size={14} /> Vertical
                            </button>
                            <button className="btn btn-subtle !h-8 !px-2" onClick={() => { engine.startCrop(e.id); }}>
                                <Icon name="crop" size={14} /> Crop
                            </button>
                        </div>
                    </div>
                    <div className="space-y-2 border-t border-line px-3 py-3">
                        <div className="section-label flex items-center justify-between">
                            Adjustments
                            <IconBtn icon="refresh" title="Reset adjustments" ev="canvas_panel_adjust_reset" size={13} className="!h-6 !min-w-6" onClick={() => upd(() => ({ adj: undefined }))} />
                        </div>
                        <Slider label="Hue" value={adj.hue} min={-180} max={180} onChange={(v) => upd(() => ({ adj: { ...adj, hue: v } }), false)} />
                        <Slider label="Saturation" value={adj.sat} min={0} max={200} onChange={(v) => upd(() => ({ adj: { ...adj, sat: v } }), false)} />
                        <Slider label="Brightness" value={adj.brt} min={0} max={200} onChange={(v) => upd(() => ({ adj: { ...adj, brt: v } }), false)} />
                        <Slider label="Contrast" value={adj.con} min={0} max={200} onChange={(v) => upd(() => ({ adj: { ...adj, con: v } }), false)} />
                    </div>
                </>
            )}
            {sel.length > 1 && (
                <div className="border-t border-line px-3 py-3">
                    <div className="section-label mb-2">Arrange</div>
                    <div className="flex flex-wrap gap-0.5">
                        <IconBtn icon="alignLeft" title="Align left" ev="canvas_align_left" onClick={() => engine.align('left')} />
                        <IconBtn icon="alignH" title="Align centers horizontally" ev="canvas_align_hcenter" onClick={() => engine.align('hcenter')} />
                        <IconBtn icon="alignTop" title="Align top" ev="canvas_align_top" onClick={() => engine.align('top')} />
                        <IconBtn icon="alignV" title="Align centers vertically" ev="canvas_align_vcenter" onClick={() => engine.align('vcenter')} />
                        <IconBtn icon="grid" title="Tidy into rows" ev="canvas_panel_tidy" onClick={() => engine.tidy()} />
                    </div>
                </div>
            )}
        </div>
    );
}

export function NoteEditor({ engine }: { engine: CanvasEngine }) {
    const id = engine.editingId!;
    const el = engine.elements.find((e) => e.id === id) as NoteEl | undefined;
    const ref = useRef<HTMLTextAreaElement>(null);
    const [text, setText] = useState(el?.text ?? '');
    useEffect(() => {
        const t = ref.current;
        if (!t) return;
        const f = setTimeout(() => {
            t.focus();
            t.setSelectionRange(t.value.length, t.value.length);
        }, 20);
        return () => clearTimeout(f);
    }, []);
    useEffect(() => {
        const t = ref.current;
        if (t) {
            t.style.height = 'auto';
            t.style.height = `${t.scrollHeight}px`;
        }
    });
    if (!el) return null;
    const z = engine.cam.z;
    const c = engine.toScreen(el.x + el.w / 2, el.y + el.h / 2);
    const pad = notePad(el) * z;
    return (
        <textarea
            ref={ref}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
                
                engine.commitNote(id, text);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') e.currentTarget.blur();
            }}
            className="note-editor"
            style={{
                left: c.x - (el.w * z) / 2,
                top: c.y - (el.h * z) / 2,
                width: el.w * z,
                minHeight: el.h * z,
                transform: el.r ? `rotate(${el.r}rad)` : undefined,
                fontSize: el.fontSize * z,
                padding: pad,
                color: el.color,
                background: el.bg === 'transparent' ? 'rgba(0,0,0,0.25)' : el.bg,
                lineHeight: 1.35,
                fontFamily: FONT,
            }}
        />
    );
}

export function LibraryDrawer({ onAdd, onClose }: { onAdd: (paths: string[]) => void; onClose: () => void }) {
    const scan = useStore((s) => s.scan);
    const [folder, setFolder] = useState('__all');
    const [q, setQ] = useState('');
    const items = useMemo(
        () =>
            (scan?.files ?? [])
                .filter((f) => !f.hidden && f.kind !== 'file' && (folder === '__all' || f.folder === folder) && (!q || f.name.toLowerCase().includes(q.toLowerCase())))
                .slice(0, 300),
        [scan, folder, q]
    );
    return (
        <div className="floating absolute bottom-16 left-3 top-16 z-10 flex w-64 flex-col overflow-hidden rounded-xl">
            <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-sm font-semibold">Library</span>
                <IconBtn icon="x" title="Close library" ev="canvas_library_closed" onClick={onClose} />
            </div>
            <div className="space-y-2 px-3 pb-2">
                <select className="input !h-8" value={folder} onChange={(e) => { setFolder(e.target.value); }}>
                    <option value="__all">All folders</option>
                    {scan?.folders.map((f) => (
                        <option key={f.path} value={f.path}>
                            {f.path}
                        </option>
                    ))}
                </select>
                <input className="input !h-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto px-3 pb-3">
                {items.map((f) => (
                    <button
                        key={f.path}
                        draggable
                        onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_MIME, JSON.stringify([f.path]));
                            e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                            
                            onAdd([f.path]);
                        }}
                        className="aspect-square overflow-hidden rounded-md bg-white/5"
                        title={f.name}
                    >
                        <ThumbImg entry={f} className="h-full w-full" />
                    </button>
                ))}
                {items.length === 0 && <div className="col-span-2 py-8 text-center text-xs text-muted">No images found. Import some into a folder first.</div>}
            </div>
            <div className="border-t border-line px-3 py-2 text-[11px] text-muted">Drag onto the canvas, or tap to add. A copy is saved with this canvas.</div>
        </div>
    );
}
