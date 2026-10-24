import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import { bootRegistry, flushMeta } from './state/actions.ts';
import { store } from './state/store.ts';
import './styles/app.css';

/** Route flag injected by the Tauri overlay window's initialization script. */
const IS_OVERLAY = '__HOARD_OVERLAY__' in window;

async function boot() {
    if (IS_OVERLAY) {
        // The overlay must be see-through from the very first paint.
        document.documentElement.classList.add('overlay');
        document.getElementById('boot-cover')?.remove();
    }
    createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );

    if (IS_OVERLAY) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const cover = document.getElementById('boot-cover');
            if (!cover) return;
            cover.classList.add('hidden');
            setTimeout(() => cover.remove(), 400);
        });
    });

    await bootRegistry();
    window.addEventListener('pagehide', () => flushMeta());
    // Trackpad pinch arrives as ctrl+wheel, and the stock reaction is to zoom the
    // whole page. Suppress it everywhere except surfaces that zoom themselves:
    // canvases (the engine owns wheel input) and [data-zoomable-graph] surfaces
    // (React zooms the graph; native page zoom is cancelled here). Deliberate
    // ctrl+mousewheel keeps working: wheel-notched deltas are large, pinches are
    // bursts of small deltas.
    let pinchWindow = 0;
    const onGestureWheel = (ev: WheelEvent) => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        const t = ev.target instanceof Element ? ev.target : null;
        if (t?.closest('canvas')) return;
        if (t?.closest('[data-zoomable-graph]')) return void ev.preventDefault();
        const now = performance.now();
        if (Math.abs(ev.deltaY) < 40) pinchWindow = now + 260;
        if (now < pinchWindow) ev.preventDefault();
    };
    document.addEventListener('wheel', onGestureWheel, { capture: true, passive: false });
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && store.get().fullscreen) store.patch({ fullscreen: false });
    });
}

if (document.readyState === 'complete') boot();
else window.addEventListener('load', boot);
