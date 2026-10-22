import type React from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store, useStore } from '../state/store.ts';
import { canvasAssetsPath, getRoot, openMenu, pickFiles, registerCanvas, rescan, toast, toggleFullscreen } from '../state/actions.ts';
import { DRAG_MIME, getFile, isMediaFile, joinPath } from '../lib/fs.ts';
import { downloadBlob } from '../lib/zip.ts';
import { CanvasEngine, type Pt } from './engine.ts';
import { AssetImages, addFilesToAssets, loadCanvasDoc, saveCanvasDoc } from './assets.ts';
import { FILLS, FONT_SIZES, NOTE_BGS, STROKES, WIDTHS, type Tool } from './types.ts';
import { IconBtn } from '../ui/kit.tsx';
import type { IconName } from '../ui/Icon.tsx';
import { LibraryDrawer, NoteEditor, SelectionPanel } from './CanvasPanels.tsx';
import { track } from '../sdk/track.ts';
import { isTauri, nativeFile } from '../lib/tauriFs.ts';

const CLIP_MARKER = 'hoard:canvas-elements';
const noopSub = () => () => {};

const TOOLS: { t: Tool; icon: IconName; label: string }[] = [
    { t: 'select', icon: 'pointer', label: 'Select (V)' },
    { t: 'hand', icon: 'hand', label: 'Hand / pan (H or hold Space)' },
    { t: 'note', icon: 'note', label: 'Sticky note (N)' },
    { t: 'text', icon: 'text', label: 'Text (T)' },
    { t: 'rect', icon: 'square', label: 'Rectangle (R)' },
    { t: 'ellipse', icon: 'circle', label: 'Ellipse (O)' },
    { t: 'line', icon: 'line', label: 'Line (L)' },
    { t: 'arrow', icon: 'arrow', label: 'Arrow (A)' },
    { t: 'draw', icon: 'pen', label: 'Pen / sketch (P)' },
    { t: 'eraser', icon: 'eraser', label: 'Eraser (E)' },
];

async function exportPng(engine: CanvasEngine, mode: 'clipboard' | 'download') {
    track('canvas_export_png', { mode });
    const blob = await engine.exportPNG(engine.selected.size > 0);
    if (!blob) return toast('Nothing to export');
    if (mode === 'clipboard') {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            return toast('Copied as PNG');
        } catch {
            /* fall through to download */
        }
    }
    downloadBlob(blob, `canvas-export-${Date.now()}.png`);
    toast('Saved PNG');
}

function StyleBar({ engine, left }: { engine: CanvasEngine; left: number }) {
    const sel = engine.selectedEls();
    const t = engine.tool;
    const types = new Set<string>(sel.map((e) => (e.type === 'note' ? (e.bg === 'transparent' ? 'text' : 'note') : e.type)));
    if (['rect', 'ellipse', 'line', 'arrow', 'draw', 'note', 'text'].includes(t)) types.add(t);
    const stroke = ['rect', 'ellipse', 'line', 'arrow', 'draw', 'text'].some((x) => types.has(x));
    const width = ['rect', 'ellipse', 'line', 'arrow', 'draw'].some((x) => types.has(x));
    const fill = types.has('rect') || types.has('ellipse');
    const note = types.has('note');
    const font = types.has('note') || types.has('text');
    if (!stroke && !note && !font) return null;
    const s = engine.style;
    const apply = (p: Parameters<CanvasEngine['applyStyle']>[0]) => {
        track('canvas_style_changed', { key: Object.keys(p)[0] });
        engine.applyStyle(p);
    };
    return (
        <div className="floating absolute top-16 z-10 max-h-[calc(100%-140px)] w-[176px] space-y-3 overflow-y-auto rounded-xl p-3" style={{ left }}>
            {stroke && (
                <div>
                    <div className="section-label mb-1.5">Stroke</div>
                    <div className="flex flex-wrap gap-1.5">
                        {STROKES.map((c) => (
                            <button key={c} aria-label="Stroke color" className={`swatch ${s.stroke === c ? 'on' : ''}`} style={{ background: c }} onClick={() => apply({ stroke: c })} />
                        ))}
                    </div>
                </div>
            )}
            {width && (
                <div>
                    <div className="section-label mb-1.5">Width</div>
                    <div className="flex gap-1">
                        {WIDTHS.map((w) => (
                            <button key={w} className={`grid h-8 flex-1 place-items-center rounded-md ${s.sw === w ? 'bg-accent/20' : 'bg-white/5'}`} onClick={() => apply({ sw: w })} aria-label={`Width ${w}`}>
                                <span className="block w-5 rounded-full bg-white" style={{ height: Math.max(1, w * 0.8) }} />
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {fill && (
                <div>
                    <div className="section-label mb-1.5">Fill</div>
                    <div className="flex flex-wrap gap-1.5">
                        {FILLS.map((c) => (
                            <button key={c} aria-label="Fill color" className={`swatch ${c === 'transparent' ? 'swatch-none' : ''} ${s.fill === c ? 'on' : ''}`} style={c === 'transparent' ? undefined : { background: c }} onClick={() => apply({ fill: c })} />
                        ))}
                    </div>
                </div>
            )}
            {note && (
                <div>
                    <div className="section-label mb-1.5">Note color</div>
                    <div className="flex flex-wrap gap-1.5">
                        {NOTE_BGS.map((c) => (
                            <button key={c} aria-label="Note color" className={`swatch ${s.noteBg === c ? 'on' : ''}`} style={{ background: c }} onClick={() => apply({ noteBg: c })} />
                        ))}
                    </div>
                </div>
            )}
            {font && (
                <div>
                    <div className="section-label mb-1.5">Text size</div>
                    <div className="flex gap-1">
                        {FONT_SIZES.map((f, i) => (
                            <button key={f} className={`h-8 flex-1 rounded-md text-xs font-semibold ${s.fontSize === f ? 'bg-accent/20 text-white' : 'bg-white/5 text-muted'}`} onClick={() => apply({ fontSize: f })}>
                                {['S', 'M', 'L', 'XL'][i]}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function CanvasView({ path }: { path: string }) {
    const wsId = store.get().wsId ?? '';
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [engine, setEngine] = useState<CanvasEngine | null>(null);
    const [library, setLibrary] = useState(false);
    const [panel, setPanel] = useState(() => window.innerWidth >= 900);
    const [dragOver, setDragOver] = useState(false);
    const pendingCanvasPaths = useStore((s) => s.pendingCanvasPaths);
    const assetsPath = canvasAssetsPath(path);
    useSyncExternalStore(engine ? engine.subscribe : noopSub, () => (engine ? engine.version : -1));

    useEffect(() => {
        const root = getRoot();
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!root || !canvas || !wrap) return;
        let loaded = false;
        let disabled = false;
        let timer = 0;
        const images = new AssetImages(wsId, root, assetsPath, () => eng.invalidate());
        const eng = new CanvasEngine(canvas, images);
        const flush = async () => {
            window.clearTimeout(timer);
            timer = 0;
            if (!loaded || disabled) return;
            try {
                await saveCanvasDoc(root, path, eng.toDoc());
            } catch (e) {
                console.warn('[canvas] save failed', e);
            }
        };
        const schedule = () => {
            if (!loaded || disabled) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(flush, 700);
        };
        eng.onCommit = schedule;
        eng.onCamera = schedule;
        eng.onAction = (name, props) => track(`canvas_${name}`, props);
        eng.onMenu = (x, y, onEl) => openCanvasMenu(eng, x, y, onEl);
        const unregister = registerCanvas(path, async () => {
            await flush();
            disabled = true;
        });
        const ro = new ResizeObserver(() => eng.resize(wrap.clientWidth, wrap.clientHeight));
        ro.observe(wrap);
        eng.resize(wrap.clientWidth, wrap.clientHeight);
        loadCanvasDoc(root, path).then((doc) => {
            if (eng.destroyed) return;
            eng.load(doc);
            loaded = true;
            setEngine(eng);
        });
        return () => {
            void flush();
            unregister();
            ro.disconnect();
            eng.destroy();
            images.destroy();
            setEngine(null);
        };
    }, [path, wsId, assetsPath]);

    useEffect(() => {
        if (!engine || !getRoot()) return;
        const pending = pendingCanvasPaths;
        if (!pending || pending.canvasPath !== path) return;
        const root = getRoot();
        if (!root) return;
        store.patch({ pendingCanvasPaths: null });
        void Promise.all(pending.sourcePaths.map((sourcePath) => getFile(root, sourcePath)))
            .then((files) => addFiles(files))
            .catch(() => toast('Could not add the selected files to the canvas'));
        // The pending request is consumed once this canvas is ready.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, path, pendingCanvasPaths]);

    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | undefined;
        void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
            unlisten = await getCurrentWebview().onDragDropEvent((event) => {
                if (event.payload.type !== 'drop' || !event.payload.paths.length || !wrapRef.current) return;
                const rect = wrapRef.current.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const at = engine?.toWorld(event.payload.position.x / dpr - rect.left, event.payload.position.y / dpr - rect.top);
                void Promise.all(event.payload.paths.map(nativeFile)).then((files) => addFiles(files, at));
            });
        });
        return () => unlisten?.();
    }, [engine]);

    const addFiles = async (files: File[], at?: Pt) => {
        const root = getRoot();
        if (!root || !engine) return;
        const media = files.filter(isMediaFile);
        if (!media.length) return toast('Only images and videos can be added');
        toast(`Adding ${media.length} item${media.length > 1 ? 's' : ''}…`);
        const items = await addFilesToAssets(root, assetsPath, media);
        engine.addImages(items, at);
        void rescan();
    };

    // Right panel shows the file behind a single selected image.
    useEffect(() => {
        if (!engine) return;
        const sel = engine.selectedEls();
        const f = sel.length === 1 && sel[0].type === 'image' ? joinPath(assetsPath, sel[0].asset) : null;
        if (store.get().focus !== f) store.patch({ focus: f });
    });

    useEffect(() => {
        if (!engine) return;
        const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        const blocked = () => {
            const s = store.get();
            return !!(s.dialog || s.searchOpen || s.viewer || s.menu);
        };
        const down = (e: KeyboardEvent) => {
            if (typing(e.target) || blocked()) return;
            const mod = e.ctrlKey || e.metaKey;
            const k = e.key.toLowerCase();
            if (mod && e.shiftKey && k === 'c') {
                e.preventDefault();
                void exportPng(engine, 'clipboard');
                return;
            }
            if (mod && (k === 'c' || k === 'x') && engine.selected.size) navigator.clipboard?.writeText(CLIP_MARKER).catch(() => {});
            if (k === 'f' && e.shiftKey && !mod) {
                e.preventDefault();
                toggleFullscreen();
                return;
            }
            if (engine.keyDown(e)) e.preventDefault();
        };
        const up = (e: KeyboardEvent) => engine.keyUp(e);
        const paste = (e: ClipboardEvent) => {
            if (typing(e.target) || blocked() || !e.clipboardData) return;
            const dt = e.clipboardData;
            const files = [...dt.files].filter(isMediaFile);
            const text = dt.getData('text/plain');
            e.preventDefault();
            track('canvas_paste', { files: files.length });
            const libraryPrefix = 'hoard:library-paths:';
            if (text.startsWith(libraryPrefix)) {
                try {
                    const paths = JSON.parse(text.slice(libraryPrefix.length)) as unknown;
                    if (Array.isArray(paths) && paths.every((p) => typeof p === 'string')) {
                        const root = getRoot();
                        if (root) void Promise.all(paths.map((path) => getFile(root, path))).then((selectedFiles) => addFiles(selectedFiles, engine.pointerWorld()));
                    }
                } catch {
                    toast('The copied library selection is no longer available');
                }
            } else if (files.length && text !== CLIP_MARKER) void addFiles(files, engine.pointerWorld());
            else if (text && text !== CLIP_MARKER && !engine.hasClipboard) engine.addNote(text, engine.pointerWorld());
            else if (!engine.paste(engine.pointerWorld()) && text && text !== CLIP_MARKER) engine.addNote(text, engine.pointerWorld());
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('paste', paste);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('paste', paste);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine]);

    const onDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (!engine || !wrapRef.current) return;
        const r = wrapRef.current.getBoundingClientRect();
        const at = engine.toWorld(e.clientX - r.left, e.clientY - r.top);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        const root = getRoot();
        if (raw && root) {
            track('canvas_library_dropped');
            const files = await Promise.all((JSON.parse(raw) as string[]).map((p) => getFile(root, p)));
            return addFiles(files, at);
        }
        const files = [...e.dataTransfer.files];
        if (files.length) {
            track('canvas_files_dropped', { count: files.length });
            return addFiles(files, at);
        }
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && /^https?:\/\//.test(url)) {
            try {
                const res = await fetch(url);
                const blob = await res.blob();
                if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/')) throw new Error('not media');
                const name = url.split('/').pop()?.split('?')[0] || 'web-image';
                await addFiles([new File([blob], /\.\w+$/.test(name) ? name : `${name}.${blob.type.split('/')[1]}`, { type: blob.type })], at);
            } catch {
                toast('That website doesn’t allow downloading this image. Save it, then drop the file here.');
            }
        }
    };

    const sel = engine?.selectedEls() ?? [];
    const zoom = engine ? Math.round(engine.cam.z * 100) : 100;
    const single = sel.length === 1 ? sel[0] : null;

    return (
        <div
            ref={wrapRef}
            className="absolute inset-0 overflow-hidden"
            onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
            }}
            onDrop={onDrop}
        >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
            {engine && (
                <>
                    {/* Tools */}
                    <div className="floating absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl p-1">
                        {TOOLS.map((t) => (
                            <IconBtn key={t.t} icon={t.icon} title={t.label} ev={`canvas_tool_${t.t}_clicked`} active={engine.tool === t.t} onClick={() => engine.setTool(t.t)} />
                        ))}
                        <div className="mx-1 h-5 w-px shrink-0 bg-line" />
                        <IconBtn
                            icon="upload"
                            title="Add images from your device"
                            ev="canvas_upload_clicked"
                            onClick={async () => {
                                const files = await pickFiles();
                                if (files.length) void addFiles(files);
                            }}
                        />
                        <IconBtn icon="images" title="Library: drag images from your folders" ev="canvas_library_toggled" active={library} onClick={() => setLibrary(!library)} />
                        <div className="mx-1 h-5 w-px shrink-0 bg-line" />
                        <IconBtn icon="undo" title="Undo (Ctrl+Z)" ev="canvas_undo_clicked" disabled={!engine.canUndo} onClick={() => engine.undo()} />
                        <IconBtn icon="redo" title="Redo (Ctrl+Shift+Z)" ev="canvas_redo_clicked" disabled={!engine.canRedo} onClick={() => engine.redo()} />
                        <IconBtn icon="grid" title="Snap to grid" ev="canvas_snap_grid_clicked" active={engine.snapToGrid} onClick={() => engine.toggleSnapToGrid()} />
                    </div>

                    <StyleBar engine={engine} left={library ? 284 : 12} />
                    {library && <LibraryDrawer onClose={() => setLibrary(false)} onAdd={async (paths) => { const root = getRoot(); if (root) void addFiles(await Promise.all(paths.map((p) => getFile(root, p)))); }} />}
                    {panel && sel.length > 0 && !engine.crop && <SelectionPanel engine={engine} onClose={() => setPanel(false)} />}
                    {engine.editingId && <NoteEditor key={engine.editingId} engine={engine} />}

                    {engine.elements.length === 0 && (
                        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                            <div className="max-w-sm text-center text-sm text-muted">
                                <div className="mb-1 text-base font-semibold text-fg">An empty, infinite canvas</div>
                                Drop images or videos here, paste with Ctrl+V, or open the Library. Scroll to move around, Ctrl+scroll or pinch to zoom.
                            </div>
                        </div>
                    )}

                    {engine.crop && (
                        <div className="floating absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl px-3 py-1.5 text-sm">
                            Drag the handles to crop
                            <button className="btn btn-primary !h-7" onClick={() => { track('canvas_crop_apply_clicked'); engine.applyCrop(); }}>Done</button>
                            <button className="btn !h-7" onClick={() => { track('canvas_crop_reset_clicked'); engine.resetCrop(); }}>Reset</button>
                            <button className="btn !h-7" onClick={() => { track('canvas_crop_cancel_clicked'); engine.cancelCrop(); }}>Cancel</button>
                        </div>
                    )}

                    {/* Bottom bar */}
                    <div className="floating absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl p-1">
                        {sel.length > 0 && (
                            <>
                                <span className="shrink-0 px-2 text-xs font-medium text-muted">{sel.length} selected</span>
                                <IconBtn icon="copy" title="Duplicate (Ctrl+D)" ev="canvas_duplicate_clicked" onClick={() => engine.duplicate()} />
                                <IconBtn icon="up" title="Bring to front (Ctrl+])" ev="canvas_front_clicked" onClick={() => engine.toFront()} />
                                <IconBtn icon="down" title="Send to back (Ctrl+[)" ev="canvas_back_clicked" onClick={() => engine.toBack()} />
                                <IconBtn icon={sel.every((e) => e.locked) ? 'unlock' : 'lock'} title="Lock / unlock" ev="canvas_lock_clicked" onClick={() => engine.toggleLock()} />
                                {single?.type === 'image' && <IconBtn icon="crop" title="Crop (double-click image)" ev="canvas_crop_clicked" onClick={() => engine.startCrop(single.id)} />}
                                {sel.length > 1 && <IconBtn icon="grid" title="Tidy into rows" ev="canvas_tidy_clicked" onClick={() => engine.tidy()} />}
                                {sel.length > 1 && <IconBtn icon="alignLeft" title="Arrange horizontally" ev="canvas_arrange_horizontal_clicked" onClick={() => engine.arrange('horizontal')} />}
                                {sel.length > 1 && <IconBtn icon="alignTop" title="Arrange vertically" ev="canvas_arrange_vertical_clicked" onClick={() => engine.arrange('vertical')} />}
                                {sel.length > 1 && <IconBtn icon="maximize" title="Resize to same size" ev="canvas_match_size_clicked" onClick={() => engine.matchSize()} />}
                                <IconBtn icon="download" title="Export selection as PNG (Ctrl+Shift+C copies)" ev="canvas_export_clicked" onClick={() => void exportPng(engine, 'download')} />
                                <IconBtn icon="sliders" title="Selection panel" ev="canvas_panel_toggled" active={panel} onClick={() => setPanel(!panel)} />
                                <IconBtn icon="trash" title="Delete" ev="canvas_delete_clicked" danger onClick={() => engine.deleteSelected()} />
                                <div className="mx-1 h-5 w-px shrink-0 bg-line" />
                            </>
                        )}
                        <IconBtn icon="zoomOut" title="Zoom out (Ctrl -)" ev="canvas_zoom_out_clicked" onClick={() => engine.zoomBy(0.8)} />
                        <button className="h-8 w-12 shrink-0 rounded-md text-xs font-medium text-muted hover:bg-white/5" title="Reset to 100%" onClick={() => { track('canvas_zoom_reset_clicked'); engine.setZoom(1); }}>
                            {zoom}%
                        </button>
                        <IconBtn icon="zoomIn" title="Zoom in (Ctrl +)" ev="canvas_zoom_in_clicked" onClick={() => engine.zoomBy(1.25)} />
                        <IconBtn icon="fit" title="Zoom to fit (Shift+1)" ev="canvas_fit_clicked" onClick={() => engine.fit(false)} />
                        {sel.length === 0 && <IconBtn icon="download" title="Export whole canvas as PNG" ev="canvas_export_all_clicked" onClick={() => void exportPng(engine, 'download')} />}
                        <IconBtn icon="maximize" title="Fullscreen canvas (Shift+F)" ev="canvas_fullscreen_clicked" onClick={toggleFullscreen} />
                    </div>
                </>
            )}
            {!engine && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Opening canvas…</div>}
            {dragOver && <div className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-accent bg-accent/5" />}
        </div>
    );
}

function openCanvasMenu(eng: CanvasEngine, x: number, y: number, onEl: boolean) {
    if (onEl) {
        const sel = eng.selectedEls();
        const single = sel.length === 1 ? sel[0] : null;
        openMenu(x, y, [
            { label: 'Copy', icon: 'copy', ev: 'canvas_menu_copy', onClick: () => { eng.copy(); navigator.clipboard?.writeText(CLIP_MARKER).catch(() => {}); } },
            { label: 'Duplicate', icon: 'copy', ev: 'canvas_menu_duplicate', onClick: () => eng.duplicate() },
            { label: 'Bring to front', icon: 'up', ev: 'canvas_menu_front', onClick: () => eng.toFront() },
            { label: 'Send to back', icon: 'down', ev: 'canvas_menu_back', onClick: () => eng.toBack() },
            ...(single?.type === 'image' ? [{ label: 'Crop', icon: 'crop' as const, ev: 'canvas_menu_crop', onClick: () => eng.startCrop(single.id) }] : []),
            { label: sel.every((e) => e.locked) ? 'Unlock' : 'Lock', icon: 'lock', ev: 'canvas_menu_lock', onClick: () => eng.toggleLock() },
            { label: 'Copy as PNG', icon: 'images', ev: 'canvas_menu_png', onClick: () => void exportPng(eng, 'clipboard') },
            { label: 'Delete', icon: 'trash', danger: true, ev: 'canvas_menu_delete', onClick: () => eng.deleteSelected() },
        ]);
    } else {
        const at = eng.pointerWorld();
        openMenu(x, y, [
            { label: 'Paste', icon: 'copy', ev: 'canvas_menu_paste', onClick: () => eng.paste(at) },
            { label: 'Add sticky note', icon: 'note', ev: 'canvas_menu_note', onClick: () => eng.addNote('', at) },
            { label: 'Select all', icon: 'pointer', ev: 'canvas_menu_select_all', onClick: () => eng.selectAll() },
            { label: 'Zoom to fit', icon: 'fit', ev: 'canvas_menu_fit', onClick: () => eng.fit(false) },
        ]);
    }
}
