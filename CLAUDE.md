# Template: Pixi.js v8 + React 19 + Tailwind v4

## File Structure (as-shipped)

- **src/state/store.ts** — Tiny external store (`useSyncExternalStore`) bridging game code ↔ React. `store.patch({...})` from anywhere; `useStore(selector)` in components. Exports the `AppState` type — add game-facing UI state fields here.
- **src/assets/manifest.ts** — Asset list in two tiers: `critical` (awaited by the loading screen) and `deferred` (loads in background).
- **src/assets/preload.ts** — `warmAssets(onProgress)` via Pixi `Assets` bundles.
- **src/game/pixiApp.ts** — Pixi v8 `Application` factory: DPR cap, autoDensity, transparent canvas. Pixel-art switches are marked `ADAPT:` here.
- **src/game/stage.ts** — Design-resolution stage. Scenes position on `stage.root` in design units (`DESIGN_WIDTH` 720); `stage.designHeight()` gives current height in units (1280 at 9:16, up to ~1560 on tall phones). `stage.onResize(cb)` for re-anchoring.
- **src/game/GameCanvas.tsx** — React ↔ Pixi boundary. StrictMode-safe mount/destroy; freezes the ticker while `store.paused`.
- **src/game/demoScene.ts** — Throwaway demo (bouncing sprite → store → HUD). Replace it, but keep its `createXxxScene(app, stage) → Scene` contract (`{ destroy() }`).
- **src/ui/** — `App.tsx` (phase router: loading → menu → playing), `LoadingScreen.tsx`, `MainMenu.tsx`, `Hud.tsx` — Tailwind reference screens.
- **src/styles/app.css** — Tailwind import, `@theme` palette, device-frame CSS (`#app-frame`), safe-area utilities.
- **index.html** — Locked mobile viewport, inline boot cover with 4s safety fade (never a stuck black screen), React root `#root`.
- **public/** — Small static assets (<100KB). `public/images/placeholder.png` is the demo sprite.
## Key Patterns

- **Layering** — React owns navigation (which screen exists); Pixi owns the game. Both live inside the CSS device frame `#app-frame`, so canvas and DOM UI always align. UI overlays are `pointer-events-none`; controls opt back in.
- **Game → UI** — `store.patch()` on discrete events (score, wave, popups), never per-frame. **UI → game** — a store field the scene reads, or a direct function call into the scene module.
- **Coordinates** — Never raw pixels. Width is always 720 design units; anchor vertical layout off `stage.designHeight()` and re-anchor in `stage.onResize()`. Keep must-see content in the top 1280 units or bottom-anchor it. Landscape games invert the pattern (see `ADAPT:` in stage.ts).
- **Lifecycles** — onPause/onResume: freeze/unfreeze (store.paused → ticker). onSleep: persist progress (the reliable hook). onQuit: last-chance flush (may not fire on hard close). Never fire fresh SDK RPCs from sleep/quit handlers.

## What to Modify

- **New game logic** → New scene modules in `src/game/` following the `createXxxScene(app, stage) → { destroy() }` contract; swap them in `GameCanvas.tsx`. Position everything in design units.
- **New small assets** → `public/images/`, listed in `src/assets/manifest.ts` (critical if needed before gameplay, deferred otherwise).
- **UI screens / HUD** → React components in `src/ui/`, routed by phase in `App.tsx`; style with Tailwind; game-facing state through `store.patch()`.
- **Title** → `<title>` in index.html + heading strings in `LoadingScreen.tsx` / `MainMenu.tsx` + `name` in package.json.
- **Palette** → the `@theme` block in `src/styles/app.css`.
- **Game config (resolution, DPR, pixel-art)** → `DESIGN_WIDTH` in stage.ts (keep 720 unless art dictates otherwise); DPR cap / texture settings in pixiApp.ts.

All intended edit points carry `ADAPT:` comments — search the source for `ADAPT:` for the full list.

## Verification (after scaffolding a game from this template)

- `npm install` clean; `npm run dev` boots with no console errors (black cover → loading bar → menu; no white flash, no stuck black screen).
- Play → scene runs; HUD reflects store updates; Menu round-trips destroy the Pixi app cleanly (no WebGL context warnings).
- Across device sizes in the device toolbar, content stays proportional (design-unit stage working); landscape letterboxes.
- `npm run build` passes (it type-checks first); `npm run preview` serves a working game; `dist/index.html` asset URLs start with `./`.