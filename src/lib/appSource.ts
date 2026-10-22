import { downloadBlob, makeZip, type ZipInput } from './zip.ts';

const IMPORT_RE = /\b(?:import|from)\s*(?:\(\s*)?['"]([^'"]+)['"]/g;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g;
const HTML_RESOURCE_RE = /\b(?:src|href)=['"]([^'"]+)['"]/g;

function localUrl(value: string, base: URL): URL | null {
    if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:')) return null;
    try {
        const url = new URL(value, base);
        return url.origin === window.location.origin ? url : null;
    } catch {
        return null;
    }
}

function archivePath(url: URL, documentUrl: URL): string {
    const root = documentUrl.pathname.endsWith('/') ? documentUrl.pathname : `${documentUrl.pathname}/..`;
    const path = decodeURIComponent(url.pathname);
    const rootPath = new URL(root, documentUrl).pathname;
    if (path.startsWith(rootPath)) return path.slice(rootPath.length).replace(/^\/+/, '');
    return path.replace(/^\/+/, '');
}

function referencedUrls(text: string, source: URL, contentType: string): URL[] {
    const found = new Set<string>();
    const add = (value: string) => {
        const url = localUrl(value, source);
        if (url) found.add(url.href);
    };

    if (contentType.includes('javascript') || source.pathname.endsWith('.ts') || source.pathname.endsWith('.tsx')) {
        for (const match of text.matchAll(IMPORT_RE)) add(match[1]);
    }
    if (contentType.includes('css') || source.pathname.endsWith('.css')) {
        for (const match of text.matchAll(CSS_URL_RE)) add(match[2]);
        for (const match of text.matchAll(CSS_IMPORT_RE)) add(match[1]);
    }
    if (contentType.includes('html')) {
        for (const match of text.matchAll(HTML_RESOURCE_RE)) add(match[1]);
    }
    return [...found].map((value) => new URL(value));
}

async function fetchResource(url: URL): Promise<{ bytes: Uint8Array; text: string | null; contentType: string }> {
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Could not fetch ${url.pathname} (${response.status})`);
    const contentType = response.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = contentType.includes('html') || contentType.includes('javascript') || contentType.includes('css') || url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx')
        ? new TextDecoder().decode(bytes)
        : null;
    return { bytes, text, contentType };
}

export async function downloadAppZip(): Promise<number> {
    const documentUrl = new URL(window.location.href);
    documentUrl.hash = '';
    documentUrl.search = '';
    const queue = [new URL(documentUrl.href)];
    const seen = new Set<string>();
    const files: ZipInput[] = [];

    while (queue.length) {
        const url = queue.shift()!;
        if (seen.has(url.href)) continue;
        seen.add(url.href);
        const resource = await fetchResource(url);
        const path = archivePath(url, documentUrl);
        if (!path) continue;
        files.push({ path, data: resource.bytes });
        if (resource.text) queue.push(...referencedUrls(resource.text, url, resource.contentType));
    }

    if (!files.length) throw new Error('The app did not contain any downloadable files');
    const blob = await makeZip(files);
    downloadBlob(blob, 'hoard-app.zip');
    return files.length;
}
