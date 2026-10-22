import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import { bootRegistry, flushMeta } from './state/actions.ts';
import { store } from './state/store.ts';
import './styles/app.css';

async function boot() {
    createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );

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
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && store.get().fullscreen) store.patch({ fullscreen: false });
    });
}

if (document.readyState === 'complete') boot();
else window.addEventListener('load', boot);
