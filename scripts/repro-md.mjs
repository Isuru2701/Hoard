/* Headless repro: seed an OPFS workspace, open the app, click a markdown file, capture the crash. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = new URL('./repro-out', import.meta.url).pathname.replace(/\/([A-Za-z]:)/, '$1');
try { mkdirSync(outDir.slice(8)); } catch {}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 960 } });

const logs = [];
page.on('console', (m) => {
    logs.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
    logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
});
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto('http://localhost:1421', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/1-boot.png` }).catch(() => {});

const path = [];
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }).catch(() => {}); };

// --- helper: seed OPFS with a markdown file and an image inside the app's workspace dir
async function seed() {
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const dirs = [];
        const iter = root.entries();
        for await (const [name] of iter) dirs.push(name);
        const ws = dirs.find((d) => d.startsWith('hoard-'));
        if (!ws) throw new Error('no workspace dir in OPFS: ' + dirs.join(','));
        const base = await root.getDirectoryHandle(ws);
        await base.getDirectoryHandle('.lo', { create: true }); // lock-in
        const notes = await base.getDirectoryHandle('Notes', { create: true });
        const write = async (dir, name, body) => {
            const h = await dir.getFileHandle(name, { create: true });
            const w = await h.createWritable();
            await w.write(body);
            await w.close();
        };
        await write(notes, 'readme.md', '# Readme\n\nHello **markdown**.\n\n- [ ] todo one\n- [x] done\n');
        await write(await base.getDirectoryHandle('Notes', { create: true }), 'second.md', '# Second\n\nBody here.\n');
    });
}

async function clickText(text, exact = false) {
    const t = exact ? page.getByText(text, { exact: true }).first() : page.getByText(text).first();
    await t.click({ timeout: 4000 });
}

try {
    // profile creation (first run)
    const nameInput = page.getByPlaceholder('Your name');
    if (await nameInput.count()) {
        await nameInput.fill('Tester');
        await page.getByPlaceholder('@username', { exact: false }).fill('tester');
        await clickText('Create profile');
        await page.waitForTimeout(800);
    }
    await shot('2-or-not');

    // create a browser workspace
    if (await page.getByText('New', { exact: true }).count()) {
        await page.getByText('New', { exact: true }).first().click();
    }
    await page.waitForTimeout(500);
    await shot('3-newws');
    const wsInput = page.getByPlaceholder('e.g. Character Design & Fashion');
    if (await wsInput.count()) {
        await wsInput.fill('Test');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page.waitForTimeout(2500);
    }
    await shot('4-ws');

    await seed();
    // refresh scan: the refresh button has title "Refresh from disk"
    await page.getByTitle('Refresh from disk').click();
    await page.waitForTimeout(1800);
    await shot('5-scanned');

    // open the Notes folder from the sidebar
    await clickText('Notes');
    await page.waitForTimeout(1200);
    await shot('6-notes');

    // click the "readme" markdown card
    await clickText('readme');
    await page.waitForTimeout(4000);
    await shot('7-after-click');
} catch (err) {
    logs.push(`[driver] ${err?.stack ?? String(err)}`);
    await shot('9-driver-error');
}

console.log('==== LOG ====');
console.log(logs.slice(-80).join('\n'));
await browser.close();
