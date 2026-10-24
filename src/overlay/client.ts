/** Main-window side of the desktop overlay: snapshot building + window control. */
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { store } from '../state/store.ts';
import { toast } from '../state/actions.ts';
import type { CanvasEngine } from '../canvas/engine.ts';
import type { OverlayItem, OverlaySnapshot } from './types.ts';

export const OVERLAY_FLAG = 'hoard:overlay-active';
export const OVERLAY_LOCKED_FLAG = 'hoard:overlay-locked';
export const OVERLAY_SNAPSHOT_KEY = 'hoard:overlay-snapshot';
export const OVERLAY_SNAPSHOT_EVENT = 'hoard:overlay-snapshot';
export const OVERLAY_MOVES_EVENT = 'hoard:overlay-moves';

export function overlayActive(): boolean {
    try {
        return localStorage.getItem(OVERLAY_FLAG) === '1';
    } catch {
        return false;
    }
}

export function overlayLocked(): boolean {
    try {
        return localStorage.getItem(OVERLAY_LOCKED_FLAG) === '1';
    } catch {
        return false;
    }
}

/** Pushes a fresh snapshot at a possibly-running overlay window (no-op errors). */
export async function pushSnapshot(snap: OverlaySnapshot): Promise<void> {
    try {
        await emitTo('overlay', OVERLAY_SNAPSHOT_EVENT, snap);
    } catch {
        /* overlay not running */
    }
}

/** Extremely small external store so the canvas button reflects overlay flags. */
const flagListeners = new Set<() => void>();
let flagTimer = 0;
const notifyFlags = () => {
    for (const l of flagListeners) l();
};
export const SUBSCRIBE_OVERLAY_FLAGS = (cb: () => void) => {
    flagListeners.add(cb);
    notifyFlags();
    if (!flagTimer) flagTimer = window.setInterval(notifyFlags, 1200);
    return () => {
        flagListeners.delete(cb);
        if (!flagListeners.size) {
            window.clearInterval(flagTimer);
            flagTimer = 0;
        }
    };
};

/** Builds the visible part of the canvas as screen-space geometry for the overlay. */
export async function buildSnapshot(
    eng: CanvasEngine,
    canvasPath: string,
    assetsPath: string,
    wsId: string,
    rect: DOMRect,
): Promise<OverlaySnapshot> {
    // Viewport origin on screen in CSS px (physical client-area position / monitor DPR).
    let vpX = rect.left;
    let vpY = rect.top;
    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const pos = await getCurrentWindow().innerPosition();
        const dpr = window.devicePixelRatio || 1;
        vpX = pos.x / dpr;
        vpY = pos.y / dpr;
    } catch {
        /* fall back to viewport-relative coords (dev / non-tauri) */
    }
    const { cam } = eng;
    const { z, ox, oy } = cam;
    const items: OverlayItem[] = [];
    for (const el of eng.elements) {
        if (el.type !== 'image' || el.video) continue;
        const sx = el.x * z + ox;
        const sy = el.y * z + oy;
        const w = el.w * z;
        const h = el.h * z;
        if (sx + w < 0 || sy + h < 0 || sx > rect.width || sy > rect.height) continue;
        items.push({
            id: el.id,
            asset: el.asset,
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            r: el.r,
            opacity: el.opacity,
            locked: el.locked,
            crop: el.crop,
            flipX: el.flipX,
            flipY: el.flipY,
            adj: el.adj,
        });
    }
    const rootPath = store.get().workspaces.find((workspace) => workspace.id === wsId)?.path ?? '';
    return { canvasPath, rootPath, assetsPath, wsId, vpX, vpY, cam: { ...cam }, items };
}

/**
 * Opens (or refreshes) the overlay window with the given canvas view.
 * The payload is stashed in localStorage for the window's first paint, then
 * pushed as a live event so an already-open overlay picks up updates too.
 */
export async function openOverlay(
    eng: CanvasEngine,
    canvasPath: string,
    assetsPath: string,
    wsId: string,
    rect: DOMRect,
): Promise<boolean> {
    const snap = await buildSnapshot(eng, canvasPath, assetsPath, wsId, rect);
    if (!snap.items.length) {
        toast('Nothing in view to pin — scroll some images into the canvas first');
        return false;
    }
    if (overlayActive()) {
        try {
            localStorage.setItem(OVERLAY_SNAPSHOT_KEY, JSON.stringify(snap));
        } catch {
            /* payload too big — the live event still carries it */
        }
    }
    const created = await invoke<boolean>('overlay_open');
    try {
        localStorage.setItem(OVERLAY_FLAG, '1');
    } catch {
        /* private mode */
    }
    try {
        await pushSnapshot(snap);
    } catch {
        /* fresh window still booting: it reads the localStorage payload */
    }
    return created;
}
