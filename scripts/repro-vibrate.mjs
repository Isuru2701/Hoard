/* Headless repro: seed a folder with many images, open the feed, sample layout rects
 * over time at DPR 1 (browser zoom 100%) and look for sub-pixel oscillation ("vibration"). */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = new URL('./repro-out', import.meta.url).pathname.replace(/\/([A-Za-z]:)/, '$1');
try { mkdirSync(outDir.slice(8)); } catch {}

const dpr = Number(process.argv[2] ?? '1');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 960 }, deviceScaleFactor: dpr });

const logs = [];
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

await page.goto('http://localhost:1421', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const clickText = async (text, exact = false) => {
    const t = exact ? page.getByText(text, { exact: true }).first() : page.getByText(text).first();
    await t.click({ timeout: 5000 });
};

// --- profile creation (first run)
if (await page.getByPlaceholder('Your name').count()) {
    await page.getByPlaceholder('Your name').fill('Tester');
    await page.getByPlaceholder('@username', { exact: false }).fill('tester');
    await clickText('Create profile');
    await page.waitForTimeout(1000);
}

// --- create a browser workspace
if (await page.getByText('New', { exact: true }).count()) {
    await page.getByText('New', { exact: true }).first().click();
}
await page.waitForTimeout(500);
const wsInput = page.getByPlaceholder('e.g. Character Design & Fashion');
if (await wsInput.count()) {
    await wsInput.fill('Flicker');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(2500);
}
await page.screenshot({ path: `${outDir}/vibrate-${dpr}-boot.png` });

// --- seed images with varied aspect ratios into the workspace root/Test
await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const iter = root.entries();
    for await (const [name] of iter) {
        if (!name.startsWith('hoard-')) continue;
        const base = await root.getDirectoryHandle(name);
        await base.getDirectoryHandle('.lo', { create: true });
        const dir = await base.getDirectoryHandle('Test', { create: true });
        const cuda = document.createElement('canvas');
        const specs = [
            [640, 400], [300, 900], [800, 800], [1024, 640], [480, 480], [1200, 675],
            [400, 600], [720, 1280], [640, 360], [500, 500], [900, 300], [640, 480],
            [333, 877], [999, 123], [512, 384], [2200, 700],
        ];
        for (let i = 0; i < specs.length; i++) {
            const [w, h] = specs[i];
            cuda.width = w;
            cuda.height = h;
            const g = cuda.getContext('2d');
            for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
                g.fillStyle = `hsl(${(x * 13 + y * 7 + i * 40) % 360} 80% 60%)`;
                g.fillRect(x, y, 8, 8);
            }
            g.fillStyle = 'white';
            g.font = 'bold 60px sans-serif';
            g.fillText(String(i), 20, 80);
            const blob = await new Promise((r) => cuda.toBlob(r, 'image/png'));
            const hnd = await dir.getFileHandle(`pic-${i}.png`, { create: true });
            const wr = await hnd.createWritable();
            await wr.write(blob);
            await wr.close();
        }
        return;
    }
    throw new Error('no hoard workspace in OPFS');
});
// rescan so the app sees the seeded folder
if (await page.getByTitle('Refresh from disk').count()) {
    await page.getByTitle('Refresh from disk').click();
    await page.waitForTimeout(1800);
}

// navigate to the folder feed via the sidebar tree row
const row = page.locator('.tree-row', { hasText: 'Test' }).first();
await row.click({ timeout: 5000 });
await page.waitForTimeout(1500);
const nav = await page.evaluate(() => document.querySelector('.feed-item') ? 'folder-feed' : 'no-feed');
console.log('NAV:', nav);
await page.screenshot({ path: `${outDir}/vibrate-${dpr}-before.png` });
if (nav === 'no-feed') {
    console.log('LOGS:\n' + logs.slice(-30).join('\n'));
    await browser.close();
    process.exit(1);
}

// sample img rects for oscillation
const report = await page.evaluate(
    (dpr) =>
        new Promise((resolve) => {
            const t0 = performance.now();
            const samples = [];
            const sample = () => {
                const imgs = [...document.querySelectorAll('.feed-item img')];
                const rects = imgs.map((im) => {
                    const r = im.getBoundingClientRect();
                    return [r.left, r.top, r.width, r.height];
                });
                samples.push(rects);
                if (performance.now() - t0 < 3000) requestAnimationFrame(sample);
                else finish();
            };
            const finish = () => {
                const floats = new Map(); // index -> count of subpixel oscillating flips
                for (let i = 0; i < samples.length - 1; i++) {
                    const a = samples[i];
                    const b = samples[i + 1];
                    if (!a || !b) continue;
                    for (let j = 0; j < Math.min(a.length, b.length); j++) {
                        const da = a[j]?.[0] ?? 0;
                        const db = b[j]?.[0] ?? 0;
                        const ta = a[j]?.[1] ?? 0;
                        const tb = b[j]?.[1] ?? 0;
                        const dx = Math.abs(da - db);
                        const dy = Math.abs(ta - tb);
                        if ((dx > 0.05 || dy > 0.05) && (dx < 2.5 || dy < 2.5)) {
                            floats.set(j, (floats.get(j) ?? 0) + 1);
                        }
                    }
                }
                const rows = [...floats.entries()]
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, 8)
                    .map(([idx, n]) => `img#${idx}: ${n}/${samples.length - 1} samples moved sub-pixel`);
                const movedAll = samples.some((s) => s.length !== samples[0].length);
                resolve(
                    `dpr=${dpr} samples=${samples.length} imgs=${samples[0]?.length} countChanged=${movedAll}\n` +
                        (rows.length ? rows.join('\n') : 'no sub-pixel movement detected')
                );
            };
            requestAnimationFrame(sample);
        }),
    dpr
);
console.log('REPORT:', report);
await page.screenshot({ path: `${outDir}/vibrate-${dpr}-after.png` });
if (logs.length) console.log('LOGS:\n' + logs.slice(-30).join('\n'));
await browser.close();
