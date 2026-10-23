/** Small dependency-free CSS color helpers for the canvas color picker. */
export interface Rgba {
    r: number; // 0..255
    g: number; // 0..255
    b: number; // 0..255
    a: number; // 0..1
}

export interface Hsva {
    h: number; // 0..360
    s: number; // 0..100
    v: number; // 0..100
    a: number; // 0..1
}

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

let probeCtx: CanvasRenderingContext2D | null | undefined;
function probe(): CanvasRenderingContext2D | null {
    if (probeCtx !== undefined) return probeCtx;
    try {
        const cv = document.createElement('canvas');
        cv.width = 1;
        cv.height = 1;
        probeCtx = cv.getContext('2d');
    } catch {
        probeCtx = null;
    }
    return probeCtx;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hexByte = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

/** Parses hex, hsl(), rgb(), hsla(), rgba() and named colors. */
export function parseCssColor(input: string): Rgba | null {
    const s = input.trim().toLowerCase();
    if (!s) return null;
    if (s === 'transparent' || s === 'none') return TRANSPARENT;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (hex) {
        const d = hex[1];
        if (d.length <= 4) {
            const pair = (ch: string) => parseInt(ch + ch, 16);
            return { r: pair(d[0]), g: pair(d[1]), b: pair(d[2]), a: d.length === 4 ? pair(d[3]) / 255 : 1 };
        }
        return {
            r: parseInt(d.slice(0, 2), 16),
            g: parseInt(d.slice(2, 4), 16),
            b: parseInt(d.slice(4, 6), 16),
            a: d.length === 8 ? parseInt(d.slice(6, 8), 16) / 255 : 1,
        };
    }
    // Fallback for hsl()/rgb()/names: normalize through a 1x1 canvas.
    const ctx = probe();
    if (!ctx) return null;
    ctx.fillStyle = '#010204';
    ctx.fillStyle = s;
    const first = ctx.fillStyle as string;
    ctx.fillStyle = '#020408';
    ctx.fillStyle = s;
    const second = ctx.fillStyle as string;
    if (first !== second) return null; // invalid css keeps the sentinel value
    if (first.startsWith('#')) return parseCssColor(first);
    const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(first);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: clamp(parseFloat(m[4]), 0, 1) } : null;
}

export function rgbToHsv({ r, g, b }: Rgba): { h: number; s: number; v: number } {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
        else if (max === gg) h = ((bb - rr) / d + 2) * 60;
        else h = ((rr - gg) / d + 4) * 60;
    }
    return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    h = ((h % 360) + 360) % 360;
    const sa = clamp(s, 0, 100) / 100;
    const va = clamp(v, 0, 100) / 100;
    const c = va * sa;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = va - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** #rrggbb, or #rrggbbaa when the color isn't fully opaque. */
export function toHex(c: Rgba): string {
    return `#${hexByte(c.r)}${hexByte(c.g)}${hexByte(c.b)}${c.a < 1 ? hexByte(c.a * 255) : ''}`;
}

export function rgbToHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const d = max - min;
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === rr) h = (((gg - bb) / d + (gg < bb ? 6 : 0)) * 60);
        else if (max === gg) h = ((bb - rr) / d + 2) * 60;
        else h = ((rr - gg) / d + 4) * 60;
    }
    return { h, s: s * 100, l: l * 100 };
}

export function toHsl(c: Rgba): string {
    const { h, s, l } = rgbToHsl(c);
    const core = `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
    return c.a < 1 ? `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}% / ${Math.round(c.a * 100)}%)` : core;
}

export type ColorFormat = 'hex' | 'hsl';

export function formatColor(c: Rgba, format: ColorFormat): string {
    return format === 'hsl' ? toHsl(c) : toHex(c);
}

/** Rough perceptual brightness for choosing readable text on note backgrounds. */
export function luminance(c: Rgba): number {
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

export function rgbaToHsva(c: Rgba): Hsva {
    return { ...rgbToHsv(c), a: c.a };
}

export function hsvaToRgba(c: Hsva): Rgba {
    return { ...hsvToRgb(c.h, c.s, c.v), a: c.a };
}
