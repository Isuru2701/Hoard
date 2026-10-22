import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { rundotGameLibrariesPlugin } from '@series-inc/rundot-game-sdk/vite';

export default defineConfig({
    // REQUIRED for RUN: deployed builds are served from a subdirectory, so all
    // asset URLs must be relative. Do not change this.
    base: './',
    // rundotGameLibrariesPlugin: on `vite build`, libraries the RUN host embeds
    // (React 19.2.4 / react-dom 19.2.4 here — pixi.js is always bundled) are
    // externalized and served by the host on mobile / CDN on web, shrinking the
    // bundle. Externalization only engages when the installed version exactly
    // matches the host's — hence the exact react/react-dom pins in package.json.
    // `npm run build:bundled` disables it for a standalone build.
    plugins: [rundotGameLibrariesPlugin(), react(), tailwindcss()],
    server: {
        allowedHosts: true,
    },
    build: {
        // Top-level await in the boot path (and in the SDK) needs a modern target.
        target: 'esnext',
    },
    optimizeDeps: {
        esbuildOptions: {
            target: 'esnext',
        },
    },
});
