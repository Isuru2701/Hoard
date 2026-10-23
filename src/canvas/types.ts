export type Tool = 'select' | 'hand' | 'note' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'draw' | 'eraser';

export interface Crop {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface Adjust {
    hue: number;
    sat: number;
    brt: number;
    con: number;
}
interface Base {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** rotation in radians, around the element's center */
    r: number;
    opacity: number;
    locked?: boolean;
}
export interface ImageEl extends Base {
    type: 'image';
    asset: string;
    video?: boolean;
    crop?: Crop;
    flipX?: boolean;
    flipY?: boolean;
    adj?: Adjust;
}
export interface NoteEl extends Base {
    type: 'note';
    text: string;
    bg: string;
    color: string;
    fontSize: number;
}
export interface ShapeEl extends Base {
    type: 'rect' | 'ellipse';
    stroke: string;
    fill: string;
    sw: number;
}
export interface PathEl extends Base {
    type: 'line' | 'arrow' | 'draw';
    stroke: string;
    sw: number;
    /** points normalized to the element box (0..1), flat x,y pairs */
    pts: number[];
}
export type El = ImageEl | NoteEl | ShapeEl | PathEl;

export interface Camera {
    ox: number;
    oy: number;
    z: number;
}
export interface CanvasDoc {
    version: 1;
    elements: El[];
    camera?: Camera;
}

export const DEFAULT_ADJ: Adjust = { hue: 0, sat: 100, brt: 100, con: 100 };
export const STROKES = ['#e5e5e5', '#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc', '#1f1f1f'];
export const FILLS = ['transparent', '#f8717140', '#fbbf2440', '#4ade8040', '#60a5fa40', '#c084fc40', '#e5e5e5'];
export const NOTE_BGS = ['#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#2a2a2a'];
export const WIDTHS = [1, 2, 4, 8];
export const FONT_SIZES = [14, 18, 24, 36];

import { luminance, parseCssColor } from './color.ts';

export function noteTextColor(bg: string): string {
    if (bg === 'transparent') return '#e5e5e5';
    if (!bg.startsWith('#')) return '#1f1f1f';
    const c = parseCssColor(bg);
    if (!c) return '#1f1f1f';
    return luminance(c) > 0.55 ? '#1f1f1f' : '#e5e5e5';
}
