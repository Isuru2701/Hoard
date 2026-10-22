import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store.ts';
import { Icon } from './Icon.tsx';
import { track } from '../sdk/track.ts';

function Dialog() {
    const d = useStore((s) => s.dialog);
    const [value, setValue] = useState('');
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (d) {
            setValue(d.value ?? '');
            setTimeout(() => ref.current?.select(), 30);
        }
    }, [d]);
    if (!d) return null;
    const ok = () => {
        track('dialog_confirmed', { kind: d.kind });
        d.resolve(d.kind === 'prompt' ? value : true);
    };
    const cancel = () => {
        track('dialog_cancelled', { kind: d.kind });
        d.resolve(d.kind === 'prompt' ? null : false);
    };
    return (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4" onPointerDown={cancel}>
            <div className="floating w-full max-w-sm rounded-2xl p-5" onPointerDown={(e) => e.stopPropagation()}>
                <div className="text-base font-semibold">{d.title}</div>
                {d.message && <p className="mt-2 text-sm text-muted">{d.message}</p>}
                {d.kind === 'prompt' && (
                    <input
                        ref={ref}
                        autoFocus
                        className="input mt-4"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') ok();
                            if (e.key === 'Escape') cancel();
                        }}
                    />
                )}
                <div className="mt-5 flex justify-end gap-2">
                    <button className="btn" onClick={cancel}>
                        Cancel
                    </button>
                    <button className={`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`} onClick={ok} autoFocus={d.kind === 'confirm'}>
                        {d.okLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Menu() {
    const m = useStore((s) => s.menu);
    useEffect(() => {
        if (!m) return;
        const close = (e: KeyboardEvent) => e.key === 'Escape' && store.patch({ menu: null });
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [m]);
    if (!m) return null;
    const x = Math.min(m.x, window.innerWidth - 230);
    const y = Math.min(m.y, window.innerHeight - m.items.length * 38 - 16);
    return (
        <div
            className="fixed inset-0 z-[90]"
            onPointerDown={() => store.patch({ menu: null })}
            onContextMenu={(e) => {
                e.preventDefault();
                store.patch({ menu: null });
            }}
        >
            <div className="floating absolute w-56 rounded-xl p-1" style={{ left: Math.max(8, x), top: Math.max(8, y) }} onPointerDown={(e) => e.stopPropagation()}>
                {m.items.map((it, i) => (
                    <button
                        key={i}
                        className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-white/8 ${it.danger ? 'text-red-400' : 'text-fg'}`}
                        onClick={() => {
                            store.patch({ menu: null });
                            track(it.ev);
                            it.onClick();
                        }}
                    >
                        {it.icon ? <Icon name={it.icon} size={15} /> : <span className="w-[15px]" />}
                        {it.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Toast() {
    const t = useStore((s) => s.toast);
    if (!t) return null;
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-[110] flex justify-center px-4">
            <div className="floating rounded-xl px-4 py-2.5 text-sm">{t}</div>
        </div>
    );
}

export default function Overlays() {
    return (
        <>
            <Menu />
            <Dialog />
            <Toast />
        </>
    );
}
