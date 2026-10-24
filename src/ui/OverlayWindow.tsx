/**
 * Overlay mode: a transparent, always-on-top fullscreen window that floats the
 * canvas images over other apps. Empty areas are click-through (window region +
 * WS_EX_TRANSPARENT while locked), images can be dragged to reposition them,
 * and a small control pill sits in the bottom-right corner. The native bits
 * (fullscreen topmost window, click-region, WS_EX_TRANSPARENT) live in
 * src-tauri/src/lib.rs.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import type { Dir } from '../lib/fs.ts';
import { getFile, joinPath } from '../lib/fs.ts';
import { isTauri, nativeRoot } from '../lib/tauriFs.ts';
import {
    OVERLAY_FLAG,
    OVERLAY_LOCKED_FLAG,
    OVERLAY_MOVES_EVENT,
    OVERLAY_SNAPSHOT_EVENT,
    OVERLAY_SNAPSHOT_KEY,
    overlayLocked,
} from '../overlay/client.ts';
import type { OverlaySnapshot } from '../overlay/types.ts';
import { Icon } from './Icon.tsx';

/** Corners of a rotated rect → axis-aligned bounds (px). */
function rotBox(px: number, py: number, w: number, h: number, r: number) {
    if (!r) return { x: px, y: py, w, h };
    const cx = px + w / 2;
    const cy = py + h / 2;
    const c = Math.cos(r);
    const s = Math.sin(r);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const lx = ((sx * w) / 2) * c - ((sy * h) / 2) * s;
        const ly = ((sx * w) / 2) * s + ((sy * h) / 2) * c;
        x0 = Math.min(x0, cx + lx);
        y0 = Math.min(y0, cy + ly);
        x1 = Math.max(x1, cx + lx);
        y1 = Math.max(y1, cy + ly);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

interface DragState {
    id: string;
    /** pointer down position (CSS px in this window) */
    sx: number;
    sy: number;
    /** item doc position at pointer down */
    ox: number;
    oy: number;
    /** last pointer position */
    lx: number;
    ly: number;
}

export default function OverlayWindow() {
    const [snap, setSnap] = useState<OverlaySnapshot | null>(() => {
        try {
            const raw = localStorage.getItem(OVERLAY_SNAPSHOT_KEY);
            return raw ? (JSON.parse(raw) as OverlaySnapshot) : null;
        } catch {
            return null;
        }
    });
    /** Live doc coords per item id: snapshot values, overridden during a drag. */
    const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
    const posRef = useRef(pos);
    const putPos = (next: Record<string, { x: number; y: number }>) => {
        posRef.current = next;
        setPos(next);
    };
    const [opacity, setOpacity] = useState(1);
    const [locked, setLocked] = useState(() => overlayLocked());
    const [dragging, setDragging] = useState<string | null>(null);
    /** This window's client-area origin on screen, in CSS px. */
    const [own, setOwn] = useState({ x: 0, y: 0 });
    const pillRef = useRef<HTMLDivElement>(null);
    const srcs = useRef(new Map<string, string>());
    const rootRef = useRef<Dir | null>(null);
    const rootKey = useRef('');
    const dragRef = useRef<DragState | null>(null);
    const dead = useRef(false);
    const [, forceSrc] = useState(0);

    /** Merge a snapshot into state, keeping an in-flight drag where it is. */
    const applySnapshot = (next: OverlaySnapshot) => {
        setSnap(next);
        const draggedId = dragRef.current?.id;
        const prev = posRef.current;
        const fresh: Record<string, { x: number; y: number }> = {};
        for (const item of next.items) {
            fresh[item.id] = item.id === draggedId && prev[item.id] ? prev[item.id] : { x: item.x, y: item.y };
        }
        putPos(fresh);
    };

    // Boot: handshake flags + own screen origin + live snapshot channel.
    useEffect(() => {
        try {
            localStorage.setItem(OVERLAY_FLAG, '1');
        } catch {
            /* ignore */
        }
        let localDead = false;
        void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
            try {
                const inner = await getCurrentWindow().innerPosition();
                const dpr = window.devicePixelRatio || 1;
                if (!localDead) setOwn({ x: inner.x / dpr, y: inner.y / dpr });
            } catch {
                /* stay at viewport origin */
            }
        });
        let unlisten: (() => void) | undefined;
        void listen<OverlaySnapshot>(OVERLAY_SNAPSHOT_EVENT, ({ payload }) => applySnapshot(payload)).then(
            (off) => (unlisten = off),
        );
        return () => {
            localDead = true;
            dead.current = true;
            unlisten?.();
            dragRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load item sources once per asset through the shared workspace root.
    useEffect(() => {
        if (!snap || !isTauri() || !snap.rootPath) return;
        if (rootKey.current !== snap.rootPath) {
            rootKey.current = snap.rootPath;
            rootRef.current = nativeRoot(snap.rootPath);
        }
        const root = rootRef.current;
        if (!root) return;
        for (const item of snap.items) {
            const key = `${snap.assetsPath}\u0000${item.asset}`;
            if (srcs.current.has(key)) continue;
            srcs.current.set(key, '');
            void getFile(root, joinPath(snap.assetsPath, item.asset))
                .then((file) => URL.createObjectURL(file))
                .catch(() => '')
                .then((url) => {
                    if (!url) srcs.current.delete(key);
                    else srcs.current.set(key, url);
                    if (!dead.current) forceSrc((t) => t + 1);
                });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snap]);

    const z = snap?.cam.z ?? 1;

    /** Main-window screen coords → this window's page coords. */
    const toPage = (docX: number, docY: number) => ({
        px: (snap?.vpX ?? 0) + (docX - (snap?.cam.ox ?? 0)) * z - own.x,
        py: (snap?.vpY ?? 0) + (docY - (snap?.cam.oy ?? 0)) * z - own.y,
    });

    const startDrag = (item: { id: string; x: number; y: number; locked?: boolean }, e: React.PointerEvent) => {
        if (item.locked) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = {
            id: item.id,
            sx: e.clientX,
            sy: e.clientY,
            ox: item.x,
            oy: item.y,
            lx: e.clientX,
            ly: e.clientY,
        };
        setDragging(item.id);
    };
    const moveDrag = (e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        d.lx = e.clientX;
        d.ly = e.clientY;
        const dx = (e.clientX - d.sx) / z;
        const dy = (e.clientY - d.sy) / z;
        putPos({ ...posRef.current, [d.id]: { x: d.ox + dx, y: d.oy + dy } });
    };

    const endDrag = (e: React.PointerEvent) => {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        const d = dragRef.current;
        dragRef.current = null;
        setDragging(null);
        if (!d || !snap) { setDragging(null); return; }
        const dx = (d.lx - d.sx) / z;
        const dy = (d.ly - d.sy) / z;
        if ((!dx && !dy) || !isTauri()) return;
        // Persist the new position through the main window's engine (undoable + autosaved).
        void emitTo('main', OVERLAY_MOVES_EVENT, {
            canvasPath: snap.canvasPath,
            moves: [{ id: d.id, x: d.ox + dx, y: d.oy + dy }],
        }).catch(() => {});
    };

    /** Exit overlay mode and clear the handshake flags. */
    const closeOverlay = () => {
        try {
            localStorage.removeItem(OVERLAY_FLAG);
            localStorage.removeItem(OVERLAY_LOCKED_FLAG);
        } catch {
            /* ignore */
        }
        if (isTauri()) void invoke('overlay_close').catch(() => {});
    };

    // Escape exits overlay mode (input only reaches the window while unlocked).
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeOverlay();
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleLock = () => {
        const next = !locked;
        setLocked(next);
        try {
            localStorage.setItem(OVERLAY_LOCKED_FLAG, next ? '1' : '0');
        } catch {
            /* ignore */
        }
        if (isTauri()) void invoke('overlay_set_locked', { locked: next }).catch(() => {});
    };

    // Keep the native click-region in sync: item bounds + the control pill.
    useEffect(() => {
        if (!snap || !isTauri()) return;
        let raf = 0;
        const push = () => {
            raf = 0;
            const pill = pillRef.current;
            const rects = snap.items.map((item) => {
                const p = pos[item.id] ?? { x: item.x, y: item.y };
                const page = toPage(p.x, p.y);
                return rotBox(page.px, page.py, item.w * z, item.h * z, item.r);
            });
            if (pill) {
                rects.push({ x: pill.offsetLeft, y: pill.offsetTop, w: pill.offsetWidth, h: pill.offsetHeight });
            }
            void invoke('overlay_set_regions', { rects }).catch(() => {});
        };
        raf = requestAnimationFrame(push);
        return () => {
            if (raf) cancelAnimationFrame(raf);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snap, pos, z, own, opacity]);

    if (!snap) {
        return (
            <div className="absolute inset-0 grid place-items-center text-sm text-fg">
                <div className="floating rounded-xl px-4 py-3">Waiting for a canvas view…</div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 select-none overflow-hidden">
            {snap.items.map((item) => {
                const p = pos[item.id] ?? { x: item.x, y: item.y };
                const page = toPage(p.x, p.y);
                const src = srcs.current.get(`${snap.assetsPath}\u0000${item.asset}`);
                const c = item.crop ?? { x: 0, y: 0, w: 1, h: 1 };
                const bw = item.w * z;
                const bh = item.h * z;
                const iw = bw / c.w;
                const ih = bh / c.h;
                const a = item.adj;
                const filter =
                    a && !(a.hue === 0 && a.sat === 100 && a.brt === 100 && a.con === 100)
                        ? `hue-rotate(${a.hue}deg) saturate(${a.sat}%) brightness(${a.brt}%) contrast(${a.con}%)`
                        : undefined;
                const style: CSSProperties = {
                    position: 'absolute',
                    left: page.px,
                    top: page.py,
                    width: bw,
                    height: bh,
                    transform: `rotate(${item.r}rad)`,
                    opacity: (item.opacity ?? 1) * opacity,
                    touchAction: 'none',
                };
                return (
                    <div
                        key={item.id}
                        className={`overlay-float ${dragging === item.id ? 'dragging' : ''} ${item.locked ? 'pinned' : ''}`}
                        style={style}
                        onPointerDown={(e) => startDrag(item, e)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                    >
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                transform: `scale(${item.flipX ? -1 : 1},${item.flipY ? -1 : 1})`,
                                overflow: 'hidden',
                            }}
                        >
                            {src ? (
                                <img
                                    src={src}
                                    draggable={false}
                                    style={{ position: 'absolute', left: -c.x * iw, top: -c.y * ih, width: iw, height: ih, filter }}
                                    alt=""
                                />
                            ) : (
                                <div style={{ position: 'absolute', inset: 0, background: '#2a2a2a' }} />
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Control pill — bottom right */}
            <div
                ref={pillRef}
                className="floating absolute bottom-3.5 right-3.5 flex items-center gap-1.5 rounded-xl p-1.5"
            >
                <span className="w-9 shrink-0 text-center text-[10px] font-medium text-muted" title="Opacity of the pinned images">
                    {Math.round(opacity * 100)}%
                </span>
                <input
                    type="range"
                    className="range !w-20"
                    min={5}
                    max={100}
                    value={Math.round(opacity * 100)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Opacity of the pinned images"
                    onChange={(e) => setOpacity((Number(e.target.value) || 100) / 100)}
                    aria-label="Overlay opacity"
                />
                <button
                    className={`ib ${locked ? 'ib-on' : ''}`}
                    title={
                        locked
                            ? 'Locked — clicks pass through the images to the app below. Unlock here or with the Hoard canvas button.'
                            : 'Lock — let clicks reach the app below, even through the images'
                    }
                    onClick={toggleLock}
                    aria-pressed={locked}
                >
                    <Icon name={locked ? 'lock' : 'unlock'} size={15} />
                </button>
                <button className="ib" title="Leave overlay mode" onClick={closeOverlay}>
                    <Icon name="x" size={15} />
                </button>
            </div>
        </div>
    );
}
