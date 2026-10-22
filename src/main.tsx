import React from 'react';
import { createRoot } from 'react-dom/client';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import App from './ui/App.tsx';
import { initSdk, registerLifecycles, sdkReady } from './sdk/runSdk.ts';
import { bootRegistry, flushMeta } from './state/actions.ts';
import { store } from './state/store.ts';
import './styles/app.css';

async function boot() {
    // 1. SDK first (resolves even outside the RUN host).
    await initSdk();

    // 2. Mount React.
    createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );

    // 3. Lift the boot cover after the first paint.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const cover = document.getElementById('boot-cover');
            if (!cover) return;
            cover.classList.add('hidden');
            setTimeout(() => cover.remove(), 400);
        });
    });

    // 4. Load profile + workspace list.
    await bootRegistry();

    // 5. Persist metadata when the app is backgrounded/closed.
    registerLifecycles({
        onSleep: () => flushMeta(),
        onQuit: () => flushMeta(),
    });
    window.addEventListener('pagehide', () => flushMeta());
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && store.get().fullscreen) store.patch({ fullscreen: false });
    });

    if (sdkReady()) {
        try {
            RundotGameAPI.analytics.recordCustomEvent('game_loaded');
            RundotGameAPI.analytics.trackFunnelStep(1, 'game_loaded', 'boot', 1);
        } catch (err) {
            console.warn('[Main] boot analytics failed', err);
        }
    }
}

if (document.readyState === 'complete') boot();
else window.addEventListener('load', boot);
