/** Canvas color picker: SV area + hue/alpha sliders, hex & HSL I/O, clipboard copy. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatColor, hsvaToRgba, parseCssColor, rgbaToHsva, type ColorFormat } from './color.ts';
import { Icon } from '../ui/Icon.tsx';

export type { ColorFormat };

interface Hsva {
    h: number;
    s: number;
    v: number;
    a: number;
}

function initialHsva(value: string): Hsva {
    const c = parseCssColor(value);
    return c ? rgbaToHsva(c) : { h: 214, s: 90, v: 100, a: 1 };
}

/** Click outside / Escape closes the picker. Attach once per open picker. */
export function useColorDismiss(open: boolean, onClose: () => void) {
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest?.('[data-color-popover],[data-color-anchor]')) return;
            onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [open, onClose]);
}

export function ColorPopover(props: {
    /** Currently applied color (css string) — re-syncs the picker when it changes elsewhere. */
    value: string;
    /** Live updates during drags; emits normalized hex (with alpha when translucent). */
    onChange: (css: string) => void;
    onClose: () => void;
    format: ColorFormat;
    onFormat: (f: ColorFormat) => void;
    title?: string;
    /** Extra row under the picker (e.g. apply-to-selection buttons). */
    extras?: ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    const { value, onChange, onClose, format, onFormat, title = 'Custom color', extras, className = '', style } = props;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const hsvaRef = useRef<Hsva>(initialHsva(value));
    const [, rerender] = useState(0);
    const [draft, setDraft] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const hasEyeDropper = typeof (window as { EyeDropper?: unknown }).EyeDropper === 'function';
    const areaRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);

    // Re-sync when the applied value changes externally (preset clicks, row switches).
    useEffect(() => {
        const c = parseCssColor(value);
        if (!c) return;
        const cur = hsvaToRgba(hsvaRef.current);
        const same = Math.abs(cur.r - c.r) < 2 && Math.abs(cur.g - c.g) < 2 && Math.abs(cur.b - c.b) < 2 && Math.abs(cur.a - c.a) < 0.01;
        if (!same) {
            hsvaRef.current = rgbaToHsva(c);
            rerender((n) => n + 1);
        }
    }, [value]);

    const updateEmit = (patch: Partial<Hsva>) => {
        const next = { ...hsvaRef.current, ...patch };
        hsvaRef.current = next;
        rerender((n) => n + 1);
        onChangeRef.current(formatColor(hsvaToRgba(next), 'hex'));
    };

    const currentRgba = () => hsvaToRgba(hsvaRef.current);
    const display = () => formatColor(currentRgba(), format);

    const applyArea = (e: React.PointerEvent) => {
        const el = areaRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const sx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const sy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        updateEmit({ s: sx * 100, v: (1 - sy) * 100 });
    };

    const commitDraft = () => {
        const text = draft;
        if (text == null) return;
        setDraft(null);
        const c = parseCssColor(text);
        if (c) {
            hsvaRef.current = rgbaToHsva(c);
            rerender((n) => n + 1);
            onChangeRef.current(formatColor(c, 'hex'));
        }
    };

    const copy = async () => {
        const text = display();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            /* clipboard blocked */
        }
    };

    const pickScreen = async () => {
        try {
            const EyeDropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }>; } }).EyeDropper;
            const res = await new EyeDropper().open();
            const c = parseCssColor(res.sRGBHex);
            if (c) updateEmit(rgbaToHsva(c));
        } catch {
            /* cancelled */
        }
    };

    const hsva = hsvaRef.current;
    const hueCss = `hsl(${hsva.h}, 100%, 50%)`;

    return (
        <div data-color-popover className={`floating absolute z-40 w-56 select-none p-2 ${className}`} style={style}>
            <div className="flex items-center gap-1 px-1 pb-2">
                <span className="mr-auto text-xs font-semibold">{title}</span>
                {hasEyeDropper && <button className="ib" title="Pick color from screen" onClick={() => void pickScreen()}><Icon name="dropper" size={14} /></button>}
                <button className="ib" title="Copy color value" onClick={() => void copy()}>
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                </button>
                <button className="ib" title="Close (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>
            </div>
            <div
                ref={areaRef}
                className="relative h-28 w-full cursor-crosshair rounded-md"
                style={{
                    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueCss})`,
                    touchAction: 'none',
                }}
                onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragging.current = true;
                    applyArea(e);
                }}
                onPointerMove={(e) => dragging.current && applyArea(e)}
                onPointerUp={() => (dragging.current = false)}
                onPointerCancel={() => (dragging.current = false)}
            >
                <div
                    className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white shadow"
                    style={{ left: `${hsva.s}%`, top: `${100 - hsva.v}%`, transform: 'translate(-50%, -50%)', background: formatColor(hsvaToRgba(hsva), 'hex') }}
                />
            </div>
            <div className="mt-2 space-y-1.5">
                <input
                    type="range"
                    className="range !p-0"
                    min={0}
                    max={360}
                    value={hsva.h}
                    style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
                    onChange={(e) => updateEmit({ h: +e.target.value })}
                />
                <input
                    type="range"
                    className="range !p-0"
                    min={0}
                    max={100}
                    value={hsva.a * 100}
                    onChange={(e) => updateEmit({ a: +e.target.value / 100 })}
                />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
                <input
                    className="input !h-8 flex-1 font-mono !text-xs"
                    value={draft ?? display()}
                    spellCheck={false}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={() => setDraft(display())}
                    onBlur={commitDraft}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    placeholder="hex or hsl"
                />
                <div className="flex shrink-0 rounded-md bg-white/5 p-0.5 text-[10px] font-bold">
                    {(['hex', 'hsl'] as const).map((f) => (
                        <button key={f} className={`h-6 rounded px-1.5 ${format === f ? 'bg-white/15 text-white' : 'text-muted'}`} onClick={() => onFormat(f)}>
                            {f.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
            {extras && <div className="mt-2 border-t border-line pt-2">{extras}</div>}
        </div>
    );
}
