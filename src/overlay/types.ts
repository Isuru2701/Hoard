/** Data contract between the main Hoard window and the always-on-top overlay window. */
import type { Adjust, Crop } from '../canvas/types.ts';

export interface OverlayItem {
    id: string;
    asset: string;
    /** Document coordinates ( unchanged by camera / zoom ). */
    x: number;
    y: number;
    w: number;
    h: number;
    /** Rotation in radians around the item's center, same units as canvas elements. */
    r: number;
    opacity: number;
    video?: boolean;
    crop?: Crop;
    flipX?: boolean;
    flipY?: boolean;
    adj?: Adjust;
    /** Canvas element lock: dragging is rejected in the overlay too. */
    locked?: boolean;
}

export interface OverlaySnapshot {
    canvasPath: string;
    /** Workspace root folder path ( overlay reads assets through the Tauri fs commands ). */
    rootPath: string;
    assetsPath: string;
    wsId: string;
    /** Main-window canvas viewport origin on screen, in CSS px. */
    vpX: number;
    vpY: number;
    cam: { ox: number; oy: number; z: number };
    items: OverlayItem[];
}
