/**
 * Infinite canvas engine (Canvas 2D, vector elements, viewport culling).
 * Elements are immutable; every change produces new objects so undo/redo
 * snapshots are cheap.
 */
import { noteTextColor, type Adjust, type Camera, type CanvasDoc, type El, type ImageEl, type NoteEl, type PathEl, type Tool } from './types.ts';

export interface ImageProvider {
    get(asset: string, screenPx: number): ImageBitmap | null;
    full(asset: string): Promise<ImageBitmap | null>;
}
export interface DrawStyle {
    stroke: string;
    fill: string;
    sw: number;
    noteBg: string;
    fontSize: number;
}
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';
type CropHandle = Exclude<Handle, 'rot'> | 'move';
export interface Pt {
    x: number;
    y: number;
}
export interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
interface Rect4 {
    l: number;
    t: number;
    r: number;
    b: number;
}
interface CropState {
    id: string;
    cx: number;
    cy: number;
    r: number;
    fx: number;
    fy: number;
    full: { l: number; t: number; W: number; H: number };
    rect: Rect4;
}
type Interaction =
    | { kind: 'none' }
    | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
    | { kind: 'move'; wx: number; wy: number; orig: Map<string, Pt>; moved: boolean }
    | { kind: 'resize'; handle: Handle; orig: Map<string, El>; box: Box }
    | { kind: 'rotate'; orig: Map<string, El>; cx: number; cy: number; a0: number }
    | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<string> }
    | { kind: 'create'; id: string; x0: number; y0: number }
    | { kind: 'draw'; pts: number[] }
    | { kind: 'erase' }
    | { kind: 'crop'; handle: CropHandle; start: Pt; rect0: Rect4 };

export const ACCENT = '#5b9cff';
export const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MIN = 2;
const SNAP = Math.PI / 12;
const LH = 1.35;

let idCounter = 0;
export const newId = () => Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function rot(p: Pt, a: number): Pt {
    if (!a) return { x: p.x, y: p.y };
    const c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
export function aabb(e: El): Box {
    if (!e.r) return { x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h };
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = rot({ x: (sx * e.w) / 2, y: (sy * e.h) / 2 }, e.r);
        x0 = Math.min(x0, cx + p.x); y0 = Math.min(y0, cy + p.y);
        x1 = Math.max(x1, cx + p.x); y1 = Math.max(y1, cy + p.y);
    }
    return { x0, y0, x1, y1 };
}
export function groupBox(els: El[]): Box {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) {
        const b = aabb(e);
        x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    return { x0, y0, x1, y1 };
}
const localOf = (e: El, p: Pt) => rot({ x: p.x - e.x - e.w / 2, y: p.y - e.y - e.h / 2 }, -e.r);
function worldOf(e: El, l: Pt): Pt {
    const p = rot(l, e.r);
    return { x: p.x + e.x + e.w / 2, y: p.y + e.y + e.h / 2 };
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const ptsCache = new WeakMap<PathEl, number[]>();
function localPts(e: PathEl): number[] {
    let p = ptsCache.get(e);
    if (p) return p;
    p = [];
    for (let i = 0; i + 1 < e.pts.length; i += 2) p.push(-e.w / 2 + e.pts[i] * e.w, -e.h / 2 + e.pts[i + 1] * e.h);
    ptsCache.set(e, p);
    return p;
}
const pathCache = new WeakMap<PathEl, Path2D>();
function buildPath(e: PathEl): Path2D {
    let p = pathCache.get(e);
    if (p) return p;
    const pts = localPts(e);
    p = new Path2D();
    if (pts.length >= 2) {
        p.moveTo(pts[0], pts[1]);
        if (pts.length === 2) p.lineTo(pts[0] + 0.01, pts[1]);
        else if (e.type !== 'draw') for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
        else {
            for (let i = 2; i < pts.length - 2; i += 2) p.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2);
            p.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
        }
    }
    pathCache.set(e, p);
    return p;
}
function hitEl(e: El, p: Pt, tol: number): boolean {
    const b = aabb(e);
    const pad = tol + ('sw' in e ? e.sw : 0);
    if (p.x < b.x0 - pad || p.x > b.x1 + pad || p.y < b.y0 - pad || p.y > b.y1 + pad) return false;
    const l = localOf(e, p);
    const hw = e.w / 2, hh = e.h / 2;
    switch (e.type) {
        case 'image':
        case 'note':
            return Math.abs(l.x) <= hw + tol && Math.abs(l.y) <= hh + tol;
        case 'rect': {
            const t = tol + e.sw / 2;
            if (Math.abs(l.x) > hw + t || Math.abs(l.y) > hh + t) return false;
            if (e.fill !== 'transparent') return true;
            return !(Math.abs(l.x) < hw - t && Math.abs(l.y) < hh - t);
        }
        case 'ellipse': {
            const rx = Math.max(hw, 1), ry = Math.max(hh, 1);
            const d = Math.hypot(l.x / rx, l.y / ry);
            if (e.fill !== 'transparent') return d <= 1 + tol / Math.min(rx, ry);
            return Math.abs(d - 1) * Math.min(rx, ry) <= tol + e.sw / 2;
        }
        default: {
            const pts = localPts(e);
            const t = tol + e.sw / 2;
            if (pts.length === 2) return Math.hypot(l.x - pts[0], l.y - pts[1]) <= t;
            for (let i = 0; i + 3 < pts.length; i += 2) if (segDist(l.x, l.y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= t) return true;
            return false;
        }
    }
}
const normAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const isAdjDefault = (a?: Adjust) => !a || (a.hue === 0 && a.sat === 100 && a.brt === 100 && a.con === 100);
export const notePad = (e: NoteEl) => (e.bg === 'transparent' ? 0 : e.fontSize * 0.66);
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab', move: 'move' };

export class CanvasEngine {
    elements: El[] = [];
    selected = new Set<string>();
    tool: Tool = 'select';
    style: DrawStyle = { stroke: '#e5e5e5', fill: 'transparent', sw: 2, noteBg: '#fde68a', fontSize: 18 };
    cam: Camera = { ox: 0, oy: 0, z: 1 };
    snapToGrid = false;
    /** Tool lock: when on, creation tools stay active after use instead of switching back to select. */
    toolLock: boolean;
    editingId: string | null = null;
    crop: CropState | null = null;
    version = 0;
    destroyed = false;
    onCommit: () => void = () => {};
    onCamera: () => void = () => {};
    onAction: (name: string, props?: Record<string, unknown>) => void = () => {};
    onMenu: (x: number, y: number, onElement: boolean) => void = () => {};

    private ctx: CanvasRenderingContext2D;
    private history: El[][] = [[]];
    private hIndex = 0;
    private vw = 0;
    private vh = 0;
    private dpr = 1;
    private raf = 0;
    private needEmit = false;
    private pendingFit = false;
    private ia: Interaction = { kind: 'none' };
    private pointers = new Map<number, Pt>();
    private pinch: { d: number; mx: number; my: number; z: number; ox: number; oy: number } | null = null;
    private spaceDown = false;
    private lastTap = { t: 0, x: 0, y: 0 };
    private clipboard: El[] = [];
    private pasteN = 0;
    private hover: Pt | null = null;
    private erasing = new Set<string>();
    private listeners = new Set<() => void>();
    private commitTimer = 0;
    private wrapCache = new Map<string, string[]>();
    private coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

    constructor(private canvas: HTMLCanvasElement, private images: ImageProvider) {
        this.ctx = canvas.getContext('2d')!;
        try {
            this.toolLock = localStorage.getItem('hoard.canvas.toolLock') === '1';
        } catch {
            this.toolLock = false;
        }
        canvas.addEventListener('pointerdown', this.onDown);
        canvas.addEventListener('pointermove', this.onMove);
        canvas.addEventListener('pointerup', this.onUp);
        canvas.addEventListener('pointercancel', this.onUp);
        canvas.addEventListener('pointerleave', this.onLeave);
        canvas.addEventListener('wheel', this.onWheel, { passive: false });
        canvas.addEventListener('contextmenu', this.onContext);
    }

    destroy() {
        this.destroyed = true;
        const c = this.canvas;
        c.removeEventListener('pointerdown', this.onDown);
        c.removeEventListener('pointermove', this.onMove);
        c.removeEventListener('pointerup', this.onUp);
        c.removeEventListener('pointercancel', this.onUp);
        c.removeEventListener('pointerleave', this.onLeave);
        c.removeEventListener('wheel', this.onWheel);
        c.removeEventListener('contextmenu', this.onContext);
        cancelAnimationFrame(this.raf);
        clearTimeout(this.commitTimer);
        this.listeners.clear();
    }

    // ------------------------------------------------------------ react bridge
    subscribe = (l: () => void) => {
        this.listeners.add(l);
        return () => {
            this.listeners.delete(l);
        };
    };
    private emit() {
        this.version++;
        for (const l of this.listeners) l();
    }
    private touch() {
        this.needEmit = true;
        this.invalidate();
    }
    invalidate = () => {
        if (this.raf || this.destroyed) return;
        this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            this.render();
        });
    };

    // ------------------------------------------------------------ document
    load(doc: CanvasDoc) {
        this.elements = Array.isArray(doc.elements) ? doc.elements : [];
        this.history = [this.elements];
        this.hIndex = 0;
        if (doc.camera && isFinite(doc.camera.z) && doc.camera.z > 0) this.cam = { ...doc.camera };
        else this.fit(false);
        this.touch();
    }
    toDoc(): CanvasDoc {
        return { version: 1, elements: this.elements, camera: { ...this.cam } };
    }
    resize(w: number, h: number) {
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.vw = w;
        this.vh = h;
        this.canvas.width = Math.max(1, Math.round(w * this.dpr));
        this.canvas.height = Math.max(1, Math.round(h * this.dpr));
        if (this.pendingFit && w > 0) {
            this.pendingFit = false;
            this.fit(false);
        }
        this.render();
    }

    commit() {
        clearTimeout(this.commitTimer);
        this.commitTimer = 0;
        if (this.history[this.hIndex] === this.elements) return;
        this.history = this.history.slice(0, this.hIndex + 1);
        this.history.push(this.elements);
        if (this.history.length > 200) this.history.shift();
        this.hIndex = this.history.length - 1;
        this.onCommit();
        this.touch();
    }
    private commitSoon() {
        clearTimeout(this.commitTimer);
        this.commitTimer = window.setTimeout(() => this.commit(), 350);
    }
    get canUndo() {
        return this.hIndex > 0 || !!this.commitTimer;
    }
    get canRedo() {
        return this.hIndex < this.history.length - 1;
    }
    undo() {
        if (this.commitTimer) this.commit();
        if (this.hIndex <= 0) return;
        this.crop = null;
        this.hIndex--;
        this.elements = this.history[this.hIndex];
        this.pruneSelection();
        this.onCommit();
        this.onAction('undo');
        this.touch();
    }
    redo() {
        if (this.hIndex >= this.history.length - 1) return;
        this.crop = null;
        this.hIndex++;
        this.elements = this.history[this.hIndex];
        this.pruneSelection();
        this.onCommit();
        this.onAction('redo');
        this.touch();
    }
    private pruneSelection() {
        const ids = new Set(this.elements.map((e) => e.id));
        this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    }

    // ------------------------------------------------------------ coordinates
    toWorld(sx: number, sy: number): Pt {
        return { x: (sx - this.cam.ox) / this.cam.z, y: (sy - this.cam.oy) / this.cam.z };
    }
    toScreen(wx: number, wy: number): Pt {
        return { x: wx * this.cam.z + this.cam.ox, y: wy * this.cam.z + this.cam.oy };
    }
    viewCenter(): Pt {
        return this.toWorld(this.vw / 2, this.vh / 2);
    }
    pointerWorld(): Pt {
        return this.hover ? this.toWorld(this.hover.x, this.hover.y) : this.viewCenter();
    }
    private local(ev: { clientX: number; clientY: number }): Pt {
        const r = this.canvas.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
    zoomAt(sx: number, sy: number, factor: number) {
        const z = clamp(this.cam.z * factor, 0.01, 8);
        const wx = (sx - this.cam.ox) / this.cam.z, wy = (sy - this.cam.oy) / this.cam.z;
        this.cam = { z, ox: sx - wx * z, oy: sy - wy * z };
        this.onCamera();
        this.touch();
    }
    zoomBy(f: number) {
        this.zoomAt(this.vw / 2, this.vh / 2, f);
    }
    setZoom(z: number) {
        this.zoomAt(this.vw / 2, this.vh / 2, z / this.cam.z);
    }
    fit(selOnly: boolean) {
        if (!this.vw) {
            this.pendingFit = true;
            return;
        }
        const els = selOnly && this.selected.size ? this.selectedEls() : this.elements;
        if (!els.length) this.cam = { ox: this.vw / 2, oy: this.vh / 2, z: 1 };
        else {
            const b = groupBox(els);
            const pad = 60;
            const bw = Math.max(b.x1 - b.x0, 1), bh = Math.max(b.y1 - b.y0, 1);
            const z = clamp(Math.min((this.vw - pad * 2) / bw, (this.vh - pad * 2) / bh), 0.01, selOnly ? 4 : 1.5);
            this.cam = { z, ox: this.vw / 2 - (b.x0 + bw / 2) * z, oy: this.vh / 2 - (b.y0 + bh / 2) * z };
        }
        this.onCamera();
        this.touch();
    }

    // ------------------------------------------------------------ selection helpers
    selectedEls(): El[] {
        if (!this.selected.size) return [];
        return this.elements.filter((e) => this.selected.has(e.id));
    }
    selectIds(ids: string[]) {
        this.selected = new Set(ids.filter((id) => this.elements.some((el) => el.id === id)));
        this.touch();
    }
    setTool(t: Tool) {
        if (this.crop) this.applyCrop();
        this.tool = t;
        if (t !== 'select') this.selected = new Set();
        this.canvas.style.cursor = t === 'hand' ? 'grab' : t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
        this.touch();
    }
    /** Toolbar lock icon: keep the current tool active (persisted across canvas sessions). */
    toggleToolLock() {
        this.toolLock = !this.toolLock;
        try {
            localStorage.setItem('hoard.canvas.toolLock', this.toolLock ? '1' : '0');
        } catch {
            /* storage blocked */
        }
        this.touch();
        this.onAction('tool_lock_toggled', { on: this.toolLock });
    }
    private replace(id: string, fn: (e: El) => El) {
        this.elements = this.elements.map((e) => (e.id === id ? fn(e) : e));
    }
    updateSelected(fn: (e: El) => Partial<El>, commitNow = false) {
        this.elements = this.elements.map((e) => (this.selected.has(e.id) ? ({ ...e, ...fn(e) } as El) : e));
        if (commitNow) this.commit();
        else this.commitSoon();
        this.touch();
    }
    selectAll() {
        this.selected = new Set(this.elements.map((e) => e.id));
        this.touch();
    }
    clearSelection() {
        this.selected = new Set();
        this.touch();
    }
    toggleSnapToGrid() {
        this.snapToGrid = !this.snapToGrid;
        this.onAction('snap_toggled', { enabled: this.snapToGrid });
        this.touch();
    }
    arrange(direction: 'horizontal' | 'vertical') {
        const sel = this.selectedEls().filter((e) => !e.locked);
        if (sel.length < 2) return;
        const sorted = sel.slice().sort((a, b) => direction === 'horizontal' ? a.x - b.x : a.y - b.y);
        const gap = 24;
        let cursor = direction === 'horizontal' ? Math.min(...sorted.map((e) => e.x)) : Math.min(...sorted.map((e) => e.y));
        const positions = new Map<string, { x: number; y: number }>();
        for (const item of sorted) {
            positions.set(item.id, direction === 'horizontal' ? { x: cursor, y: sorted[0].y } : { x: sorted[0].x, y: cursor });
            cursor += (direction === 'horizontal' ? item.w : item.h) + gap;
        }
        this.elements = this.elements.map((e) => {
            const position = positions.get(e.id);
            return position ? ({ ...e, ...position } as El) : e;
        });
        this.commit();
        this.onAction('arranged', { direction, count: sel.length });
    }
    matchSize() {
        const sel = this.selectedEls().filter((e) => !e.locked);
        if (sel.length < 2) return;
        const w = sel[0].w;
        const h = sel[0].h;
        const ids = new Set(sel.map((e) => e.id));
        this.elements = this.elements.map((e) => ids.has(e.id) ? ({ ...e, w, h } as El) : e);
        this.commit();
        this.onAction('matched_size', { count: sel.length });
    }

    // ------------------------------------------------------------ editing commands
    get hasClipboard() {
        return this.clipboard.length > 0;
    }
    copy() {
        const els = this.selectedEls();
        if (!els.length) return;
        this.clipboard = els.map((e) => JSON.parse(JSON.stringify(e)) as El);
        this.pasteN = 0;
        this.onAction('copied', { count: els.length });
    }
    cut() {
        this.copy();
        this.deleteSelected();
    }
    paste(at?: Pt): boolean {
        if (!this.clipboard.length) return false;
        this.pasteN++;
        const b = groupBox(this.clipboard);
        let dx: number, dy: number;
        if (at) {
            dx = at.x - (b.x0 + b.x1) / 2;
            dy = at.y - (b.y0 + b.y1) / 2;
        } else dx = dy = (24 * this.pasteN) / this.cam.z;
        const copies = this.clipboard.map((e) => ({ ...e, id: newId(), x: e.x + dx, y: e.y + dy, locked: false }) as El);
        this.elements = [...this.elements, ...copies];
        this.selected = new Set(copies.map((c) => c.id));
        this.commit();
        this.onAction('pasted', { count: copies.length });
        return true;
    }
    duplicate(offset?: number) {
        const sel = this.selectedEls();
        if (!sel.length) return;
        const d = offset ?? 16 / this.cam.z;
        const copies = sel.map((e) => ({ ...e, id: newId(), x: e.x + d, y: e.y + d, locked: false }) as El);
        this.elements = [...this.elements, ...copies];
        this.selected = new Set(copies.map((c) => c.id));
        this.commit();
        this.onAction('duplicated', { count: copies.length });
    }
    deleteSelected() {
        const before = this.elements.length;
        this.elements = this.elements.filter((e) => !(this.selected.has(e.id) && !e.locked));
        if (this.elements.length === before) return;
        this.onAction('deleted', { count: before - this.elements.length });
        this.pruneSelection();
        this.commit();
    }
    private nudge(dx: number, dy: number) {
        this.elements = this.elements.map((e) => (this.selected.has(e.id) && !e.locked ? ({ ...e, x: e.x + dx, y: e.y + dy } as El) : e));
        this.commitSoon();
        this.touch();
    }
    toFront() {
        const keep = this.elements.filter((e) => !this.selected.has(e.id));
        const moved = this.elements.filter((e) => this.selected.has(e.id));
        this.elements = [...keep, ...moved];
        this.commit();
        this.onAction('reordered', { to: 'front' });
    }
    toBack() {
        const keep = this.elements.filter((e) => !this.selected.has(e.id));
        const moved = this.elements.filter((e) => this.selected.has(e.id));
        this.elements = [...moved, ...keep];
        this.commit();
        this.onAction('reordered', { to: 'back' });
    }
    forward() {
        const a = [...this.elements];
        for (let i = a.length - 2; i >= 0; i--) if (this.selected.has(a[i].id) && !this.selected.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
        this.elements = a;
        this.commit();
        this.onAction('reordered', { to: 'forward' });
    }
    backward() {
        const a = [...this.elements];
        for (let i = 1; i < a.length; i++) if (this.selected.has(a[i].id) && !this.selected.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
        this.elements = a;
        this.commit();
        this.onAction('reordered', { to: 'backward' });
    }
    toggleLock() {
        const sel = this.selectedEls();
        if (!sel.length) return;
        const lock = !sel.every((e) => e.locked);
        this.updateSelected(() => ({ locked: lock }), true);
        this.onAction(lock ? 'locked' : 'unlocked');
    }
    flip(axis: 'x' | 'y') {
        this.updateSelected((e) => (e.type === 'image' ? (axis === 'x' ? { flipX: !e.flipX } : { flipY: !e.flipY }) : {}), true);
        this.onAction('flipped', { axis });
    }
    align(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
        const sel = this.selectedEls().filter((e) => !e.locked);
        if (sel.length < 2) return;
        const b = groupBox(sel);
        const ids = new Set(sel.map((e) => e.id));
        this.elements = this.elements.map((e) => {
            if (!ids.has(e.id)) return e;
            const a = aabb(e);
            let dx = 0, dy = 0;
            if (mode === 'left') dx = b.x0 - a.x0;
            if (mode === 'right') dx = b.x1 - a.x1;
            if (mode === 'hcenter') dx = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2;
            if (mode === 'top') dy = b.y0 - a.y0;
            if (mode === 'bottom') dy = b.y1 - a.y1;
            if (mode === 'vcenter') dy = (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2;
            return { ...e, x: e.x + dx, y: e.y + dy } as El;
        });
        this.commit();
        this.onAction('aligned', { mode });
    }
    /** Arrange selection into tidy rows; images get a shared row height. */
    tidy() {
        const sel = this.selectedEls().filter((e) => !e.locked);
        if (sel.length < 2) return;
        const b = groupBox(sel);
        const hs = sel.filter((e) => e.type === 'image').map((e) => e.h).sort((a, c) => a - c);
        const th = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
        const sized = sel
            .slice()
            .sort((a, c) => a.y - c.y || a.x - c.x)
            .map((e) => (e.type === 'image' && th ? { e, w: (e.w * th) / e.h, h: th } : { e, w: e.w, h: e.h }));
        const area = sized.reduce((s, it) => s + it.w * it.h, 0);
        const rowW = Math.max(Math.sqrt(area) * 1.5, ...sized.map((s) => s.w));
        const gap = Math.sqrt(area / sized.length) * 0.05;
        const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
        let x = b.x0, y = b.y0, rowH = 0;
        for (const s of sized) {
            if (x > b.x0 && x + s.w > b.x0 + rowW) {
                x = b.x0;
                y += rowH + gap;
                rowH = 0;
            }
            pos.set(s.e.id, { x, y, w: s.w, h: s.h });
            x += s.w + gap;
            rowH = Math.max(rowH, s.h);
        }
        this.elements = this.elements.map((e) => {
            const p = pos.get(e.id);
            return p ? ({ ...e, ...p, r: 0 } as El) : e;
        });
        this.commit();
        this.onAction('tidied', { count: sel.length });
    }
    applyStyle(p: Partial<DrawStyle>, commitNow = false) {
        Object.assign(this.style, p);
        if (!this.selected.size) {
            this.touch();
            return;
        }
        const k = 1 / this.cam.z;
        this.updateSelected((e) => {
            if (e.type === 'rect' || e.type === 'ellipse')
                return { stroke: p.stroke ?? e.stroke, fill: p.fill ?? e.fill, sw: p.sw !== undefined ? p.sw * k : e.sw };
            if (e.type === 'line' || e.type === 'arrow' || e.type === 'draw')
                return { stroke: p.stroke ?? e.stroke, sw: p.sw !== undefined ? p.sw * k : e.sw };
            if (e.type === 'note') {
                const n = { ...e };
                if (p.fontSize !== undefined) n.fontSize = p.fontSize * k;
                if (e.bg === 'transparent' && p.stroke) n.color = p.stroke;
                if (e.bg !== 'transparent' && p.noteBg) {
                    n.bg = p.noteBg;
                    n.color = noteTextColor(p.noteBg);
                }
                return n;
            }
            return {};
        }, commitNow);
    }

    // ------------------------------------------------------------ adding content
    addImages(items: { asset: string; nw: number; nh: number; video?: boolean }[], at?: Pt) {
        if (!items.length) return;
        const c = at ?? this.viewCenter();
        const target = 320 / this.cam.z;
        const sized = items.map((it) => {
            const nw = it.nw || 400, nh = it.nh || 300;
            const s = Math.min(1, target / Math.max(nw, nh));
            return { ...it, w: nw * s, h: nh * s };
        });
        const gap = target * 0.05;
        const rows: (typeof sized)[] = [];
        for (let i = 0; i < sized.length; i += 5) rows.push(sized.slice(i, i + 5));
        const rowDims = rows.map((r) => ({ w: r.reduce((s, it) => s + it.w, 0) + gap * (r.length - 1), h: Math.max(...r.map((it) => it.h)) }));
        const totalH = rowDims.reduce((s, d) => s + d.h, 0) + gap * (rows.length - 1);
        let y = c.y - totalH / 2;
        const els: ImageEl[] = [];
        rows.forEach((r, ri) => {
            let x = c.x - rowDims[ri].w / 2;
            for (const it of r) {
                els.push({ id: newId(), type: 'image', asset: it.asset, video: it.video || undefined, x, y: y + (rowDims[ri].h - it.h) / 2, w: it.w, h: it.h, r: 0, opacity: 1 });
                x += it.w + gap;
            }
            y += rowDims[ri].h + gap;
        });
        if (!this.toolLock && this.tool !== 'select') this.tool = 'select';
        this.elements = [...this.elements, ...els];
        this.selected = new Set(els.map((e) => e.id));
        this.commit();
        this.onAction('images_added', { count: els.length });
    }
    addNote(text: string, at?: Pt) {
        const c = at ?? this.viewCenter();
        const k = 1 / this.cam.z;
        const s = this.style;
        const el: NoteEl = { id: newId(), type: 'note', x: c.x - 120 * k, y: c.y - 80 * k, w: 240 * k, h: 160 * k, r: 0, opacity: 1, text, bg: s.noteBg, color: noteTextColor(s.noteBg), fontSize: s.fontSize * k };
        const pad = notePad(el);
        const lines = this.wrap(text, el.w - pad * 2, el.fontSize);
        el.h = Math.max(el.h, lines.length * el.fontSize * LH + pad * 2);
        this.elements = [...this.elements, el];
        this.selected = new Set([el.id]);
        this.commit();
        this.onAction('note_pasted');
    }
    /** Plain pasted text: a transparent text element, not a sticky note. */
    addText(text: string, at?: Pt) {
        const c = at ?? this.viewCenter();
        const k = 1 / this.cam.z;
        const s = this.style;
        const fs = s.fontSize * k;
        const el: NoteEl = { id: newId(), type: 'note', x: c.x - 4 * k, y: c.y - fs * 0.7, w: 280 * k, h: fs * LH, r: 0, opacity: 1, text, bg: 'transparent', color: s.stroke, fontSize: fs };
        const pad = notePad(el);
        const lines = this.wrap(text, el.w - pad * 2, el.fontSize);
        el.h = Math.max(el.fontSize * LH, lines.length * el.fontSize * LH + pad * 2);
        this.elements = [...this.elements, el];
        this.selected = new Set([el.id]);
        this.commit();
        this.onAction('text_pasted');
    }
    private createNote(w: Pt, text: boolean) {
        const s = this.style;
        const k = 1 / this.cam.z;
        const fs = (text ? Math.max(s.fontSize, 24) : s.fontSize) * k;
        const el: NoteEl = text
            ? { id: newId(), type: 'note', x: w.x - 4 * k, y: w.y - fs * 0.7, w: 280 * k, h: fs * LH, r: 0, opacity: 1, text: '', bg: 'transparent', color: s.stroke, fontSize: fs }
            : { id: newId(), type: 'note', x: w.x - 110 * k, y: w.y - 80 * k, w: 220 * k, h: 160 * k, r: 0, opacity: 1, text: '', bg: s.noteBg, color: noteTextColor(s.noteBg), fontSize: fs };
        this.elements = [...this.elements, el];
        this.selected = new Set([el.id]);
        this.commit();
        if (!this.toolLock) {
            this.tool = 'select';
            this.canvas.style.cursor = 'default';
        }
        this.startEditing(el.id);
        this.onAction('note_created', { text });
    }
    startEditing(id: string) {
        this.editingId = id;
        this.touch();
    }
    commitNote(id: string, text: string) {
        if (this.editingId !== id) return;
        this.editingId = null;
        const el = this.elements.find((e) => e.id === id);
        if (!el || el.type !== 'note') return this.touch();
        if (!text.trim() && el.bg === 'transparent') {
            this.elements = this.elements.filter((e) => e.id !== id);
            this.pruneSelection();
            this.commit();
            return;
        }
        const pad = notePad(el);
        const lines = this.wrap(text, el.w - pad * 2, el.fontSize);
        const need = lines.length * el.fontSize * LH + pad * 2;
        const h = el.bg === 'transparent' ? Math.max(el.fontSize * LH, need) : Math.max(el.h, need);
        if (el.text !== text || el.h !== h) this.replace(id, (e) => ({ ...e, text, h }) as El);
        this.commit();
    }

    // ------------------------------------------------------------ crop
    startCrop(id: string) {
        const e = this.elements.find((x) => x.id === id);
        if (!e || e.type !== 'image' || e.locked) return;
        const c = e.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const W = e.w / c.w, H = e.h / c.h;
        this.crop = {
            id,
            cx: e.x + e.w / 2,
            cy: e.y + e.h / 2,
            r: e.r,
            fx: e.flipX ? -1 : 1,
            fy: e.flipY ? -1 : 1,
            full: { l: -e.w / 2 - c.x * W, t: -e.h / 2 - c.y * H, W, H },
            rect: { l: -e.w / 2, t: -e.h / 2, r: e.w / 2, b: e.h / 2 },
        };
        this.selected = new Set([id]);
        this.touch();
    }
    cancelCrop() {
        this.crop = null;
        this.touch();
    }
    resetCrop() {
        const e = this.selectedEls()[0];
        if (!e || e.type !== 'image') return;
        if (!this.crop || this.crop.id !== e.id) this.startCrop(e.id);
        const cs = this.crop;
        if (!cs) return;
        cs.rect = { l: cs.full.l, t: cs.full.t, r: cs.full.l + cs.full.W, b: cs.full.t + cs.full.H };
        this.applyCrop();
    }
    applyCrop() {
        const cs = this.crop;
        if (!cs) return;
        this.crop = null;
        const { full, rect } = cs;
        const w = rect.r - rect.l, h = rect.b - rect.t;
        const crop = { x: (rect.l - full.l) / full.W, y: (rect.t - full.t) / full.H, w: w / full.W, h: h / full.H };
        const isFull = crop.x < 1e-4 && crop.y < 1e-4 && crop.w > 0.9999 && crop.h > 0.9999;
        const mid = rot({ x: ((rect.l + rect.r) / 2) * cs.fx, y: ((rect.t + rect.b) / 2) * cs.fy }, cs.r);
        const cx = cs.cx + mid.x, cy = cs.cy + mid.y;
        this.replace(cs.id, (e) => ({ ...e, x: cx - w / 2, y: cy - h / 2, w, h, crop: isFull ? undefined : crop }) as El);
        this.commit();
        this.onAction('image_cropped');
    }
    private cropLocal(p: Pt): Pt {
        const cs = this.crop!;
        const l = rot({ x: p.x - cs.cx, y: p.y - cs.cy }, -cs.r);
        return { x: l.x * cs.fx, y: l.y * cs.fy };
    }
    private cropScreen(lx: number, ly: number): Pt {
        const cs = this.crop!;
        const d = rot({ x: lx * cs.fx, y: ly * cs.fy }, cs.r);
        return this.toScreen(cs.cx + d.x, cs.cy + d.y);
    }
    private cropHandles() {
        const { l, t, r, b } = this.crop!.rect;
        const mx = (l + r) / 2, my = (t + b) / 2;
        const list: [CropHandle, number, number][] = [['nw', l, t], ['n', mx, t], ['ne', r, t], ['e', r, my], ['se', r, b], ['s', mx, b], ['sw', l, b], ['w', l, my]];
        return list.map(([h, x, y]) => ({ h, ...this.cropScreen(x, y) }));
    }
    private hitCrop(s: Pt): CropHandle | null {
        const rad = this.coarse ? 16 : 9;
        for (const h of this.cropHandles()) if (Math.hypot(h.x - s.x, h.y - s.y) <= rad) return h.h;
        const l = this.cropLocal(this.toWorld(s.x, s.y));
        const { rect } = this.crop!;
        return l.x >= rect.l && l.x <= rect.r && l.y >= rect.t && l.y <= rect.b ? 'move' : null;
    }

    // ------------------------------------------------------------ hit testing
    private hitTest(p: Pt): El | null {
        const tol = 6 / this.cam.z;
        if (this.selected.size) {
            for (let i = this.elements.length - 1; i >= 0; i--) {
                const e = this.elements[i];
                if (!this.selected.has(e.id)) continue;
                const l = localOf(e, p);
                if (Math.abs(l.x) <= e.w / 2 + tol && Math.abs(l.y) <= e.h / 2 + tol) return e;
            }
        }
        for (let i = this.elements.length - 1; i >= 0; i--) if (hitEl(this.elements[i], p, tol)) return this.elements[i];
        return null;
    }
    private handles(): { h: Handle; x: number; y: number }[] {
        const sel = this.selectedEls();
        if (!sel.length || this.crop || this.editingId || this.tool !== 'select') return [];
        const z = this.cam.z;
        if (sel.length === 1) {
            const e = sel[0];
            if (e.locked) return [];
            const hw = e.w / 2, hh = e.h / 2;
            const list: [Handle, number, number][] = [['nw', -hw, -hh], ['ne', hw, -hh], ['se', hw, hh], ['sw', -hw, hh]];
            if (e.w * z > 30 && e.h * z > 30) list.push(['n', 0, -hh], ['e', hw, 0], ['s', 0, hh], ['w', -hw, 0]);
            list.push(['rot', 0, -hh - 24 / z]);
            return list.map(([h, lx, ly]) => {
                const w = worldOf(e, { x: lx, y: ly });
                return { h, ...this.toScreen(w.x, w.y) };
            });
        }
        if (sel.some((e) => e.locked)) return [];
        const b = groupBox(sel);
        const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
        const list: [Handle, number, number][] = [['nw', b.x0, b.y0], ['ne', b.x1, b.y0], ['se', b.x1, b.y1], ['sw', b.x0, b.y1], ['n', mx, b.y0], ['e', b.x1, my], ['s', mx, b.y1], ['w', b.x0, my], ['rot', mx, b.y0 - 24 / z]];
        return list.map(([h, x, y]) => ({ h, ...this.toScreen(x, y) }));
    }
    private hitHandle(s: Pt): Handle | null {
        const rad = this.coarse ? 16 : 9;
        for (const h of this.handles()) if (Math.hypot(h.x - s.x, h.y - s.y) <= rad) return h.h;
        return null;
    }

    // ------------------------------------------------------------ pointer input
    private onDown = (ev: PointerEvent) => {
        const s = this.local(ev);
        if (this.editingId) (document.activeElement as HTMLElement | null)?.blur?.();
        try {
            this.canvas.setPointerCapture(ev.pointerId);
        } catch {
            /* ignore */
        }
        this.pointers.set(ev.pointerId, s);
        if (this.pointers.size === 2) return this.startPinch();
        if (this.pointers.size > 2 || ev.button === 2) return;
        const w = this.toWorld(s.x, s.y);
        const now = performance.now();
        const dbl = now - this.lastTap.t < 330 && Math.hypot(s.x - this.lastTap.x, s.y - this.lastTap.y) < 12;
        this.lastTap = { t: dbl ? 0 : now, x: s.x, y: s.y };
        if (ev.button === 1 || this.tool === 'hand' || this.spaceDown) {
            this.ia = { kind: 'pan', sx: s.x, sy: s.y, ox: this.cam.ox, oy: this.cam.oy };
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        switch (this.tool) {
            case 'select':
                this.downSelect(ev, s, w, dbl);
                break;
            case 'note':
            case 'text':
                this.createNote(w, this.tool === 'text');
                break;
            case 'rect':
            case 'ellipse':
            case 'line':
            case 'arrow':
                this.startCreate(this.tool, w);
                break;
            case 'draw':
                this.ia = { kind: 'draw', pts: [w.x, w.y] };
                break;
            case 'eraser':
                this.ia = { kind: 'erase' };
                this.eraseAt(w);
                break;
        }
        this.touch();
    };

    private downSelect(ev: PointerEvent, s: Pt, w: Pt, dbl: boolean) {
        if (this.crop) {
            const ch = this.hitCrop(s);
            if (ch) {
                this.ia = { kind: 'crop', handle: ch, start: this.cropLocal(w), rect0: { ...this.crop.rect } };
                return;
            }
            this.applyCrop();
        }
        if (dbl) {
            const hit = this.hitTest(w);
            if (hit && !hit.locked) {
                if (hit.type === 'note') {
                    this.selected = new Set([hit.id]);
                    this.startEditing(hit.id);
                    return;
                }
                if (hit.type === 'image') {
                    this.startCrop(hit.id);
                    return;
                }
            }
            if (!hit) {
                this.createNote(w, true);
                return;
            }
        }
        const h = this.hitHandle(s);
        if (h) {
            const sel = this.selectedEls();
            const orig = new Map(sel.map((e) => [e.id, e] as [string, El]));
            if (h === 'rot') {
                const b = groupBox(sel);
                const c = sel.length === 1 ? { x: sel[0].x + sel[0].w / 2, y: sel[0].y + sel[0].h / 2 } : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
                this.ia = { kind: 'rotate', orig, cx: c.x, cy: c.y, a0: Math.atan2(w.y - c.y, w.x - c.x) };
            } else this.ia = { kind: 'resize', handle: h, orig, box: groupBox(sel) };
            return;
        }
        const hit = this.hitTest(w);
        if (hit) {
            if (ev.shiftKey) {
                const next = new Set(this.selected);
                if (next.has(hit.id)) {
                    next.delete(hit.id);
                    this.selected = next;
                    return;
                }
                next.add(hit.id);
                this.selected = next;
            } else if (!this.selected.has(hit.id)) this.selected = new Set([hit.id]);
            if (ev.altKey) this.duplicate(0);
            const orig = new Map<string, Pt>();
            for (const e of this.selectedEls()) if (!e.locked) orig.set(e.id, { x: e.x, y: e.y });
            this.ia = { kind: 'move', wx: w.x, wy: w.y, orig, moved: false };
        } else {
            this.ia = { kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: ev.shiftKey ? new Set(this.selected) : new Set() };
            if (!ev.shiftKey) this.selected = new Set();
        }
    }

    private startCreate(type: 'rect' | 'ellipse' | 'line' | 'arrow', w: Pt) {
        const s = this.style;
        const sw = s.sw / this.cam.z;
        const id = newId();
        const el: El =
            type === 'rect' || type === 'ellipse'
                ? { id, type, x: w.x, y: w.y, w: 0, h: 0, r: 0, opacity: 1, stroke: s.stroke, fill: s.fill, sw }
                : { id, type, x: w.x, y: w.y, w: 0, h: 0, r: 0, opacity: 1, stroke: s.stroke, sw, pts: [0, 0, 1, 1] };
        this.elements = [...this.elements, el];
        this.selected = new Set([id]);
        this.ia = { kind: 'create', id, x0: w.x, y0: w.y };
    }

    private eraseAt(w: Pt) {
        const tol = 8 / this.cam.z;
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const e = this.elements[i];
            if (!e.locked && hitEl(e, w, tol)) this.erasing.add(e.id);
        }
    }

    private startPinch() {
        const ia = this.ia;
        if (ia.kind === 'create') this.elements = this.elements.filter((e) => e.id !== ia.id);
        else if (ia.kind === 'move' || ia.kind === 'resize' || ia.kind === 'rotate') this.commit();
        this.ia = { kind: 'none' };
        this.erasing.clear();
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z: this.cam.z, ox: this.cam.ox, oy: this.cam.oy };
        this.touch();
    }

    private onMove = (ev: PointerEvent) => {
        const s = this.local(ev);
        this.hover = s;
        if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, s);
        if (this.pinch && this.pointers.size >= 2) {
            const [a, b] = [...this.pointers.values()];
            const p = this.pinch;
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const z = clamp((p.z * d) / p.d, 0.01, 8);
            const wx = (p.mx - p.ox) / p.z, wy = (p.my - p.oy) / p.z;
            this.cam = { z, ox: mx - wx * z, oy: my - wy * z };
            this.touch();
            return;
        }
        const ia = this.ia;
        const w = this.toWorld(s.x, s.y);
        switch (ia.kind) {
            case 'none':
                if (ev.pointerType === 'mouse') this.updateCursor(s);
                return;
            case 'pan':
                this.cam = { ...this.cam, ox: ia.ox + (s.x - ia.sx), oy: ia.oy + (s.y - ia.sy) };
                break;
            case 'move': {
                const dx = w.x - ia.wx, dy = w.y - ia.wy;
                if (!ia.moved && Math.hypot(dx, dy) * this.cam.z < 3) return;
                ia.moved = true;
                this.elements = this.elements.map((e) => {
                    const o = ia.orig.get(e.id);
                    if (!o) return e;
                    const x = o.x + dx;
                    const y = o.y + dy;
                    const step = 32;
                    return { ...e, x: this.snapToGrid ? Math.round(x / step) * step : x, y: this.snapToGrid ? Math.round(y / step) * step : y } as El;
                });
                break;
            }
            case 'resize':
                this.doResize(ia, w, ev.shiftKey);
                break;
            case 'rotate': {
                let a = Math.atan2(w.y - ia.cy, w.x - ia.cx) - ia.a0;
                const single = ia.orig.size === 1;
                this.elements = this.elements.map((e) => {
                    const o = ia.orig.get(e.id);
                    if (!o) return e;
                    if (single) {
                        let r = o.r + a;
                        if (ev.shiftKey) r = Math.round(r / SNAP) * SNAP;
                        return { ...o, r: normAngle(r) } as El;
                    }
                    if (ev.shiftKey) a = Math.round(a / SNAP) * SNAP;
                    const c = rot({ x: o.x + o.w / 2 - ia.cx, y: o.y + o.h / 2 - ia.cy }, a);
                    return { ...o, x: ia.cx + c.x - o.w / 2, y: ia.cy + c.y - o.h / 2, r: normAngle(o.r + a) } as El;
                });
                break;
            }
            case 'marquee': {
                ia.x1 = w.x;
                ia.y1 = w.y;
                const b = { x0: Math.min(ia.x0, w.x), y0: Math.min(ia.y0, w.y), x1: Math.max(ia.x0, w.x), y1: Math.max(ia.y0, w.y) };
                const sel = new Set(ia.base);
                for (const e of this.elements) {
                    const a = aabb(e);
                    if (a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1) sel.add(e.id);
                }
                this.selected = sel;
                break;
            }
            case 'create':
                this.moveCreate(ia, w, ev.shiftKey);
                break;
            case 'draw': {
                const n = ia.pts.length;
                if (Math.hypot(w.x - ia.pts[n - 2], w.y - ia.pts[n - 1]) * this.cam.z > 2) ia.pts.push(w.x, w.y);
                break;
            }
            case 'erase':
                this.eraseAt(w);
                break;
            case 'crop': {
                const cs = this.crop;
                if (!cs) return;
                const l = this.cropLocal(w);
                const { full } = cs;
                const r0 = ia.rect0;
                const dx = l.x - ia.start.x, dy = l.y - ia.start.y;
                const m = 8 / this.cam.z;
                let { l: L, t: T, r: R, b: B } = r0;
                if (ia.handle === 'move') {
                    const ww = R - L, hh = B - T;
                    L = clamp(L + dx, full.l, full.l + full.W - ww);
                    T = clamp(T + dy, full.t, full.t + full.H - hh);
                    R = L + ww;
                    B = T + hh;
                } else {
                    if (ia.handle.includes('w')) L = clamp(r0.l + dx, full.l, R - m);
                    if (ia.handle.includes('e')) R = clamp(r0.r + dx, L + m, full.l + full.W);
                    if (ia.handle.includes('n')) T = clamp(r0.t + dy, full.t, B - m);
                    if (ia.handle.includes('s')) B = clamp(r0.b + dy, T + m, full.t + full.H);
                }
                cs.rect = { l: L, t: T, r: R, b: B };
                break;
            }
        }
        this.touch();
    };

    private moveCreate(ia: { id: string; x0: number; y0: number }, w: Pt, shift: boolean) {
        this.replace(ia.id, (e) => {
            let x1 = w.x, y1 = w.y;
            if (e.type === 'rect' || e.type === 'ellipse') {
                if (shift) {
                    const d = Math.max(Math.abs(x1 - ia.x0), Math.abs(y1 - ia.y0));
                    x1 = ia.x0 + Math.sign(x1 - ia.x0 || 1) * d;
                    y1 = ia.y0 + Math.sign(y1 - ia.y0 || 1) * d;
                }
                return { ...e, x: Math.min(ia.x0, x1), y: Math.min(ia.y0, y1), w: Math.abs(x1 - ia.x0), h: Math.abs(y1 - ia.y0) };
            }
            if (shift) {
                const a = Math.round(Math.atan2(y1 - ia.y0, x1 - ia.x0) / SNAP) * SNAP;
                const d = Math.hypot(x1 - ia.x0, y1 - ia.y0);
                x1 = ia.x0 + Math.cos(a) * d;
                y1 = ia.y0 + Math.sin(a) * d;
            }
            const x = Math.min(ia.x0, x1), y = Math.min(ia.y0, y1);
            const ww = Math.abs(x1 - ia.x0), hh = Math.abs(y1 - ia.y0);
            return { ...e, x, y, w: ww, h: hh, pts: [(ia.x0 - x) / (ww || 1), (ia.y0 - y) / (hh || 1), (x1 - x) / (ww || 1), (y1 - y) / (hh || 1)] } as El;
        });
    }

    private doResize(ia: { handle: Handle; orig: Map<string, El>; box: Box }, p: Pt, shift: boolean) {
        const hd = ia.handle;
        const corner = hd.length === 2;
        if (ia.orig.size === 1) {
            const o = [...ia.orig.values()][0];
            const c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
            const lp = rot({ x: p.x - c0.x, y: p.y - c0.y }, -o.r);
            let l = -o.w / 2, r = o.w / 2, t = -o.h / 2, b = o.h / 2;
            if (hd.includes('w')) l = Math.min(lp.x, r - MIN);
            if (hd.includes('e')) r = Math.max(lp.x, l + MIN);
            if (hd.includes('n')) t = Math.min(lp.y, b - MIN);
            if (hd.includes('s')) b = Math.max(lp.y, t + MIN);
            const keep = corner && (o.type === 'image' || (o.type === 'note' && o.bg === 'transparent')) !== shift;
            if (keep && o.w > 0 && o.h > 0) {
                const s = Math.max((r - l) / o.w, (b - t) / o.h);
                const nw = o.w * s, nh = o.h * s;
                if (hd.includes('w')) l = r - nw;
                else r = l + nw;
                if (hd.includes('n')) t = b - nh;
                else b = t + nh;
            }
            const nw = r - l, nh = b - t;
            const wc = rot({ x: (l + r) / 2, y: (t + b) / 2 }, o.r);
            const next = { ...o, x: c0.x + wc.x - nw / 2, y: c0.y + wc.y - nh / 2, w: nw, h: nh } as El;
            if (next.type === 'note' && o.type === 'note' && o.bg === 'transparent' && corner && o.h > 0) next.fontSize = (o.fontSize * nh) / o.h;
            this.replace(o.id, () => next);
            return;
        }
        const b = ia.box;
        const bw = b.x1 - b.x0 || 1, bh = b.y1 - b.y0 || 1;
        let x0 = b.x0, x1 = b.x1, y0 = b.y0, y1 = b.y1;
        if (hd.includes('w')) x0 = Math.min(p.x, x1 - MIN);
        if (hd.includes('e')) x1 = Math.max(p.x, x0 + MIN);
        if (hd.includes('n')) y0 = Math.min(p.y, y1 - MIN);
        if (hd.includes('s')) y1 = Math.max(p.y, y0 + MIN);
        let sx = (x1 - x0) / bw, sy = (y1 - y0) / bh;
        if (corner && !shift) {
            const s = Math.max(sx, sy);
            sx = sy = s;
            if (hd.includes('w')) x0 = x1 - bw * s;
            else x1 = x0 + bw * s;
            if (hd.includes('n')) y0 = y1 - bh * s;
            else y1 = y0 + bh * s;
        }
        this.elements = this.elements.map((e) => {
            const o = ia.orig.get(e.id);
            if (!o) return e;
            const n = { ...o, x: x0 + (o.x - b.x0) * sx, y: y0 + (o.y - b.y0) * sy, w: o.w * sx, h: o.h * sy } as El;
            if (n.type === 'note' && o.type === 'note' && sx === sy) n.fontSize = o.fontSize * sx;
            return n;
        });
    }

    private onUp = (ev: PointerEvent) => {
        this.pointers.delete(ev.pointerId);
        if (this.pinch) {
            if (this.pointers.size < 2) {
                this.pinch = null;
                this.onCamera();
            }
            return;
        }
        const ia = this.ia;
        this.ia = { kind: 'none' };
        switch (ia.kind) {
            case 'pan':
                this.canvas.style.cursor = this.tool === 'hand' || this.spaceDown ? 'grab' : 'default';
                this.onCamera();
                break;
            case 'move':
                if (ia.moved) this.commit();
                break;
            case 'resize':
            case 'rotate':
                this.commit();
                break;
            case 'create': {
                const e = this.elements.find((x) => x.id === ia.id);
                if (!e || Math.max(e.w, e.h) * this.cam.z < 4) {
                    this.elements = this.elements.filter((x) => x.id !== ia.id);
                    this.selected = new Set();
                } else {
                    this.commit();
                    this.onAction('shape_created', { type: e.type });
                }
                // Tool lock keeps the creation tool active for consecutive shapes.
                if (!this.toolLock) this.setTool('select');
                this.selected = e ? new Set([e.id].filter((id) => this.elements.some((x) => x.id === id))) : new Set();
                break;
            }
            case 'draw': {
                const pts = ia.pts;
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (let i = 0; i < pts.length; i += 2) {
                    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
                    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
                }
                const w = x1 - x0, h = y1 - y0;
                const norm: number[] = [];
                for (let i = 0; i < pts.length; i += 2) norm.push((pts[i] - x0) / (w || 1), (pts[i + 1] - y0) / (h || 1));
                const el: PathEl = { id: newId(), type: 'draw', x: x0, y: y0, w, h, r: 0, opacity: 1, stroke: this.style.stroke, sw: this.style.sw / this.cam.z, pts: norm };
                this.elements = [...this.elements, el];
                this.commit();
                this.onAction('stroke_drawn');
                break;
            }
            case 'erase':
                if (this.erasing.size) {
                    const n = this.erasing.size;
                    this.elements = this.elements.filter((e) => !this.erasing.has(e.id));
                    this.erasing.clear();
                    this.pruneSelection();
                    this.commit();
                    this.onAction('erased', { count: n });
                }
                break;
        }
        this.touch();
    };

    private onLeave = () => {
        if (!this.pointers.size) this.hover = null;
    };

    private onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        const s = this.local(ev);
        let dx = ev.deltaX, dy = ev.deltaY;
        if (ev.deltaMode === 1) {
            dx *= 16;
            dy *= 16;
        } else if (ev.deltaMode === 2) {
            dx *= this.vw || 1;
            dy *= this.vh || 1;
        }
        if (ev.ctrlKey || ev.metaKey) {
            // pinch deltas are small and arrive at high frequency, so a steeper curve
            // speeds up trackpad pinch while mouse-wheel notches stay clamp-limited
            const factor = clamp(Math.exp(-dy * 0.006), 0.92, 1.08);
            this.zoomAt(s.x, s.y, factor);
        } else {
            if (ev.shiftKey && !dx) {
                dx = dy;
                dy = 0;
            }
            this.cam = { ...this.cam, ox: this.cam.ox - dx, oy: this.cam.oy - dy };
            this.onCamera();
            this.touch();
        }
    };

    private onContext = (ev: MouseEvent) => {
        ev.preventDefault();
        const s = this.local(ev);
        const hit = this.hitTest(this.toWorld(s.x, s.y));
        if (hit && !this.selected.has(hit.id)) this.selected = new Set([hit.id]);
        this.touch();
        this.onMenu(ev.clientX, ev.clientY, !!hit);
    };

    private updateCursor(s: Pt) {
        if (this.spaceDown || this.tool === 'hand') return void (this.canvas.style.cursor = 'grab');
        if (this.tool !== 'select') return void (this.canvas.style.cursor = this.tool === 'text' ? 'text' : this.tool === 'eraser' ? 'cell' : 'crosshair');
        if (this.crop) {
            const h = this.hitCrop(s);
            this.canvas.style.cursor = h ? CURSORS[h] : 'default';
            return;
        }
        const h = this.hitHandle(s);
        if (h) return void (this.canvas.style.cursor = CURSORS[h]);
        this.canvas.style.cursor = this.hitTest(this.toWorld(s.x, s.y)) ? 'move' : 'default';
    }

    // ------------------------------------------------------------ keyboard
    keyDown(e: KeyboardEvent): boolean {
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (e.key === ' ') {
            if (!this.spaceDown) {
                this.spaceDown = true;
                this.canvas.style.cursor = 'grab';
            }
            return true;
        }
        if (this.crop) {
            if (k === 'enter') return this.applyCrop(), true;
            if (k === 'escape') return this.cancelCrop(), true;
        }
        if (mod && k === 'z') return e.shiftKey ? this.redo() : this.undo(), true;
        if (mod && k === 'y') return this.redo(), true;
        if (mod && k === 'c') return this.copy(), true;
        if (mod && k === 'x') return this.cut(), true;
        if (mod && k === 'd') return this.duplicate(), true;
        if (mod && k === 'a') return this.selectAll(), true;
        if (mod && (k === '=' || k === '+')) return this.zoomBy(1.25), true;
        if (mod && k === '-') return this.zoomBy(0.8), true;
        if (mod && k === '0') return this.setZoom(1), true;
        if (k === 'delete' || k === 'backspace') return this.deleteSelected(), true;
        if (k === 'escape') {
            if (this.selected.size) this.clearSelection();
            else this.setTool('select');
            return true;
        }
        if (k === 'enter' && this.selected.size === 1) {
            const el = this.selectedEls()[0];
            if (el.type === 'note' && !el.locked) return this.startEditing(el.id), true;
        }
        if (k.startsWith('arrow')) {
            if (!this.selected.size) return false;
            const d = (e.shiftKey ? 10 : 1) / this.cam.z;
            this.nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
            return true;
        }
        if (e.key === ']') return mod ? this.toFront() : this.forward(), true;
        if (e.key === '[') return mod ? this.toBack() : this.backward(), true;
        if (e.shiftKey && e.code === 'Digit1') return this.fit(false), true;
        if (e.shiftKey && e.code === 'Digit2') return this.fit(true), true;
        if (mod || e.altKey || e.shiftKey) return false;
        if (k === 'i') {
            this.onAction('eyedropper');
            return true;
        }
        if (k === 'q') return this.toggleToolLock(), true;
        const map: Record<string, Tool> = { v: 'select', '1': 'select', h: 'hand', n: 'note', t: 'text', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', p: 'draw', d: 'draw', e: 'eraser' };
        const t = map[k];
        if (t) {
            this.setTool(t);
            this.onAction('tool_selected', { tool: t, via: 'key' });
            return true;
        }
        return false;
    }
    keyUp(e: KeyboardEvent) {
        if (e.key === ' ') {
            this.spaceDown = false;
            this.canvas.style.cursor = this.tool === 'hand' ? 'grab' : 'default';
        }
    }

    // ------------------------------------------------------------ rendering
    private wrap(text: string, maxW: number, size: number): string[] {
        const key = `${size.toFixed(2)}|${Math.round(maxW)}|${text}`;
        const hit = this.wrapCache.get(key);
        if (hit) return hit;
        const ctx = this.ctx;
        ctx.save();
        ctx.font = `${size}px ${FONT}`;
        const out: string[] = [];
        for (const para of text.split('\n')) {
            let line = '';
            for (const word of para.split(/(\s+)/)) {
                const test = line + word;
                if (ctx.measureText(test).width > maxW && line.trim()) {
                    out.push(line.trimEnd());
                    line = word.trimStart();
                } else line = test;
            }
            out.push(line);
        }
        ctx.restore();
        if (this.wrapCache.size > 3000) this.wrapCache.clear();
        this.wrapCache.set(key, out);
        return out;
    }

    private render() {
        if (this.destroyed) return;
        const { ctx, dpr, vw, vh, cam } = this;
        if (vw && vh) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#181818';
            ctx.fillRect(0, 0, vw, vh);
            this.drawGrid();
            ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.ox, dpr * cam.oy);
            const x0 = -cam.ox / cam.z, y0 = -cam.oy / cam.z, x1 = x0 + vw / cam.z, y1 = y0 + vh / cam.z;
            const img = (e: ImageEl, px: number) => this.images.get(e.asset, px);
            for (const e of this.elements) {
                const b = aabb(e);
                if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
                this.drawEl(ctx, e, cam.z, true, img);
            }
            if (this.ia.kind === 'draw' && this.ia.pts.length >= 2) {
                const p = this.ia.pts;
                ctx.lineWidth = this.style.sw / cam.z;
                ctx.strokeStyle = this.style.stroke;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(p[0], p[1]);
                for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
                if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1]);
                ctx.stroke();
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.drawOverlay();
        }
        if (this.needEmit) {
            this.needEmit = false;
            this.emit();
        }
    }

    private drawGrid() {
        const { ctx, vw, vh, cam } = this;
        let step = 32 * cam.z;
        while (step < 14) step *= 4;
        while (step > 120) step /= 4;
        const ox = ((cam.ox % step) + step) % step;
        const oy = ((cam.oy % step) + step) % step;
        ctx.beginPath();
        for (let x = ox; x < vw; x += step) {
            ctx.moveTo(Math.round(x) + 0.5, 0);
            ctx.lineTo(Math.round(x) + 0.5, vh);
        }
        for (let y = oy; y < vh; y += step) {
            ctx.moveTo(0, Math.round(y) + 0.5);
            ctx.lineTo(vw, Math.round(y) + 0.5);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    private drawEl(ctx: CanvasRenderingContext2D, e: El, z: number, live: boolean, img: (e: ImageEl, px: number) => ImageBitmap | null) {
        ctx.save();
        ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
        if (e.r) ctx.rotate(e.r);
        ctx.globalAlpha = e.opacity * (live && this.erasing.has(e.id) ? 0.25 : 1);
        const hw = e.w / 2, hh = e.h / 2;
        switch (e.type) {
            case 'image':
                this.drawImageEl(ctx, e, z, live, img);
                break;
            case 'note':
                this.drawNote(ctx, e, z, live);
                break;
            case 'rect':
            case 'ellipse':
                ctx.beginPath();
                if (e.type === 'rect') ctx.roundRect(-hw, -hh, e.w, e.h, Math.max(0, Math.min(8 / z, e.w / 4, e.h / 4)));
                else ctx.ellipse(0, 0, Math.max(hw, 0.01), Math.max(hh, 0.01), 0, 0, Math.PI * 2);
                if (e.fill !== 'transparent') {
                    ctx.fillStyle = e.fill;
                    ctx.fill();
                }
                ctx.lineWidth = e.sw;
                ctx.strokeStyle = e.stroke;
                ctx.lineJoin = 'round';
                ctx.stroke();
                break;
            default: {
                ctx.lineWidth = e.sw;
                ctx.strokeStyle = e.stroke;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke(buildPath(e));
                if (e.type === 'arrow') {
                    const p = localPts(e);
                    const n = p.length;
                    if (n >= 4) {
                        const ax = p[n - 2], ay = p[n - 1];
                        const a = Math.atan2(ay - p[n - 3], ax - p[n - 4]);
                        const s = Math.max(10 / z, e.sw * 4);
                        ctx.beginPath();
                        ctx.moveTo(ax - s * Math.cos(a - 0.45), ay - s * Math.sin(a - 0.45));
                        ctx.lineTo(ax, ay);
                        ctx.lineTo(ax - s * Math.cos(a + 0.45), ay - s * Math.sin(a + 0.45));
                        ctx.stroke();
                    }
                }
            }
        }
        ctx.restore();
    }

    private drawImageEl(ctx: CanvasRenderingContext2D, e: ImageEl, z: number, live: boolean, img: (e: ImageEl, px: number) => ImageBitmap | null) {
        const hw = e.w / 2, hh = e.h / 2;
        const cs = live && this.crop && this.crop.id === e.id ? this.crop : null;
        if (e.flipX || e.flipY) ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1);
        const filter = isAdjDefault(e.adj) ? '' : `hue-rotate(${e.adj!.hue}deg) saturate(${e.adj!.sat}%) brightness(${e.adj!.brt}%) contrast(${e.adj!.con}%)`;
        if (cs) {
            const src = img(e, cs.full.W * z);
            if (!src) return;
            if (filter) ctx.filter = filter;
            const a = ctx.globalAlpha;
            ctx.globalAlpha = a * 0.3;
            ctx.drawImage(src, cs.full.l, cs.full.t, cs.full.W, cs.full.H);
            ctx.globalAlpha = a;
            ctx.save();
            ctx.beginPath();
            ctx.rect(cs.rect.l, cs.rect.t, cs.rect.r - cs.rect.l, cs.rect.b - cs.rect.t);
            ctx.clip();
            ctx.drawImage(src, cs.full.l, cs.full.t, cs.full.W, cs.full.H);
            ctx.restore();
            ctx.filter = 'none';
            return;
        }
        const c = e.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const src = img(e, Math.max(e.w / c.w, e.h / c.h) * z);
        if (!src) {
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(-hw, -hh, e.w, e.h);
            return;
        }
        if (filter) ctx.filter = filter;
        ctx.drawImage(src, c.x * src.width, c.y * src.height, c.w * src.width, c.h * src.height, -hw, -hh, e.w, e.h);
        if (filter) ctx.filter = 'none';
        if (e.video) {
            const r = Math.min(18 / z, Math.min(e.w, e.h) * 0.2);
            ctx.fillStyle = 'rgba(0,0,0,.55)';
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(-r * 0.35, -r * 0.5);
            ctx.lineTo(r * 0.55, 0);
            ctx.lineTo(-r * 0.35, r * 0.5);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawNote(ctx: CanvasRenderingContext2D, e: NoteEl, z: number, live: boolean) {
        const hw = e.w / 2, hh = e.h / 2;
        const pad = notePad(e);
        if (e.bg !== 'transparent') {
            ctx.fillStyle = e.bg;
            ctx.beginPath();
            ctx.roundRect(-hw, -hh, e.w, e.h, Math.min(6 / z, e.w / 4, e.h / 4));
            ctx.fill();
        }
        if (live && this.editingId === e.id) return;
        if (e.fontSize * z < 1.5) {
            if (e.text) {
                ctx.globalAlpha *= 0.3;
                ctx.fillStyle = e.color;
                ctx.fillRect(-hw + pad, -hh + pad, (e.w - pad * 2) * 0.8, Math.min(e.h - pad * 2, e.fontSize * 2));
            }
            return;
        }
        ctx.font = `${e.fontSize}px ${FONT}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = e.color;
        const lh = e.fontSize * LH;
        const lines = this.wrap(e.text, e.w - pad * 2, e.fontSize);
        ctx.save();
        if (pad) {
            ctx.beginPath();
            ctx.rect(-hw, -hh, e.w, e.h);
            ctx.clip();
        }
        if (!e.text && pad) {
            ctx.globalAlpha *= 0.4;
            ctx.fillText('Empty note', -hw + pad, -hh + pad + (lh - e.fontSize) / 2);
        } else
            for (let i = 0; i < lines.length; i++) {
                const y = -hh + pad + i * lh;
                if (pad && y > hh) break;
                ctx.fillText(lines[i], -hw + pad, y + (lh - e.fontSize) / 2);
            }
        ctx.restore();
    }

    private drawOverlay() {
        const ctx = this.ctx;
        const sel = this.selectedEls();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ACCENT;
        if (!this.crop) {
            for (const e of sel) {
                if (e.id === this.editingId) continue;
                const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
                    const w = worldOf(e, { x: (sx * e.w) / 2, y: (sy * e.h) / 2 });
                    return this.toScreen(w.x, w.y);
                });
                ctx.setLineDash(e.locked ? [4, 4] : []);
                ctx.beginPath();
                pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                ctx.closePath();
                ctx.stroke();
            }
            ctx.setLineDash([]);
            if (sel.length > 1) {
                const b = groupBox(sel);
                const a = this.toScreen(b.x0, b.y0), c = this.toScreen(b.x1, b.y1);
                ctx.setLineDash([5, 4]);
                ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
                ctx.setLineDash([]);
            }
            this.drawHandles(this.handles());
        } else {
            const { l, t, r, b } = this.crop.rect;
            const pts = [this.cropScreen(l, t), this.cropScreen(r, t), this.cropScreen(r, b), this.cropScreen(l, b)];
            ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            this.drawHandles(this.cropHandles());
        }
        if (this.ia.kind === 'marquee') {
            const a = this.toScreen(this.ia.x0, this.ia.y0), c = this.toScreen(this.ia.x1, this.ia.y1);
            ctx.fillStyle = 'rgba(91,156,255,0.1)';
            ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
            ctx.strokeStyle = ACCENT;
            ctx.lineWidth = 1;
            ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
        }
    }

    private drawHandles(hs: { h: string; x: number; y: number }[]) {
        const ctx = this.ctx;
        const size = this.coarse ? 12 : 9;
        for (const h of hs) {
            ctx.beginPath();
            if (h.h === 'rot') ctx.arc(h.x, h.y, size / 2 + 1, 0, Math.PI * 2);
            else ctx.rect(h.x - size / 2, h.y - size / 2, size, size);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = ACCENT;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    /** Render elements (selection, or all) to a PNG at high resolution. */
    async exportPNG(selectedOnly: boolean): Promise<Blob | null> {
        const els = selectedOnly && this.selected.size ? this.selectedEls() : this.elements;
        if (!els.length) return null;
        const b = groupBox(els);
        const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.03;
        const bw = b.x1 - b.x0 + pad * 2, bh = b.y1 - b.y0 + pad * 2;
        const scale = Math.min(4, 4096 / Math.max(bw, bh));
        const fulls = new Map<string, ImageBitmap>();
        await Promise.all(
            els.map(async (e) => {
                if (e.type !== 'image' || fulls.has(e.asset)) return;
                const bmp = await this.images.full(e.asset);
                if (bmp) fulls.set(e.asset, bmp);
            })
        );
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bw * scale));
        c.height = Math.max(1, Math.round(bh * scale));
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#181818';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.setTransform(scale, 0, 0, scale, (pad - b.x0) * scale, (pad - b.y0) * scale);
        for (const e of els) this.drawEl(ctx, e, scale, false, (im, px) => fulls.get(im.asset) ?? this.images.get(im.asset, px));
        return new Promise((res) => c.toBlob((bl) => res(bl), 'image/png'));
    }
}
