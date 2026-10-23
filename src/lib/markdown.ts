/**
 * Lean markdown parser for canvas cards and document previews.
 * Deliberately dependency-free; the WYSIWYG editor (Milkdown) is a separate module.
 */
import { withoutFrontmatter } from './frontmatter.ts';

export interface Inline {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strike?: boolean;
    link?: string;
}

export type Block =
    | { type: 'heading'; level: number; spans: Inline[] }
    | { type: 'paragraph'; spans: Inline[] }
    | { type: 'bullet'; depth: number; spans: Inline[]; checked?: boolean }
    | { type: 'ordered'; n: number; depth: number; spans: Inline[] }
    | { type: 'quote'; spans: Inline[] }
    | { type: 'code'; text: string; lang?: string }
    | { type: 'hr' }
    | { type: 'table'; rows: string[][] }
    | { type: 'image'; alt: string; src: string };

export function parseInline(src: string): Inline[] {
    const out: Inline[] = [];
    let buffer = '';
    let i = 0;
    const flush = (extra: Partial<Inline> = {}) => {
        if (!buffer) return;
        out.push({ text: buffer, ...extra });
        buffer = '';
    };
    const append = (spans: Inline[], extra: Partial<Inline>) => {
        for (const span of spans) out.push({ ...span, ...extra });
    };

    while (i < src.length) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < src.length) {
            buffer += src[i + 1];
            i += 2;
            continue;
        }
        if (ch === '`') {
            const end = src.indexOf('`', i + 1);
            if (end > i + 1) {
                flush();
                out.push({ text: src.slice(i + 1, end), code: true });
                i = end + 1;
                continue;
            }
        }
        if (ch === '*' || ch === '_' || ch === '~') {
            const marker = src.startsWith(ch + ch, i) ? ch + ch : ch;
            if (marker !== '~') {
                const end = src.indexOf(marker, i + marker.length);
                const inner = end > i + marker.length ? src.slice(i + marker.length, end) : '';
                if (inner) {
                    flush();
                    const style: Partial<Inline> = marker.length === 2 ? { bold: true } : { italic: true };
                    append(parseInline(inner), style);
                    i = end + marker.length;
                    continue;
                }
            } else if (src.startsWith('~~', i)) {
                const end = src.indexOf('~~', i + 2);
                const inner = end > i + 2 ? src.slice(i + 2, end) : '';
                if (inner) {
                    flush();
                    append(parseInline(inner), { strike: true });
                    i = end + 2;
                    continue;
                }
            }
        }
        if (ch === '!' || ch === '[') {
            const img = ch === '!' ? /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i)) : null;
            if (img) {
                flush();
                out.push({ text: img[1] || img[2], link: img[2] });
                i += img[0].length;
                continue;
            }
            const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
            if (link) {
                flush();
                append(parseInline(link[1] || link[2]), { link: link[2] });
                i += link[0].length;
                continue;
            }
        }
        if (ch === '<') {
            const auto = /^<((?:https?:\/\/|mailto:)[^>]+)>/.exec(src.slice(i));
            if (auto) {
                flush();
                out.push({ text: auto[1], link: auto[1] });
                i += auto[0].length;
                continue;
            }
        }
        if (ch === '\n') {
            flush();
            out.push({ text: '\n' });
            i++;
            continue;
        }
        buffer += ch;
        i++;
    }
    flush();
    return out;
}

const HR_RE = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function tableCells(line: string): string[] {
    let value = line.trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);
    return value.split('|').map((cell) => cell.trim());
}

function isTableStart(lines: string[], i: number): boolean {
    const next = lines[i + 1];
    return lines[i].includes('|') && !!next && TABLE_SEP_RE.test(next) && next.includes('-');
}

function parseBlocks(source: string): Block[] {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const blocks: Block[] = [];
    let paragraph: string[] = [];
    let i = 0;
    const flushParagraph = () => {
        if (!paragraph.length) return;
        blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join('\n')) });
        paragraph = [];
    };

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            flushParagraph();
            i++;
            continue;
        }
        const trimmed = line.trimStart();
        if (trimmed.startsWith('```')) {
            flushParagraph();
            const lang = trimmed.slice(3).trim();
            const body: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith('```')) body.push(lines[i++]);
            if (i < lines.length) i++;
            blocks.push({ type: 'code', text: body.join('\n'), lang: lang || undefined });
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            flushParagraph();
            blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2].trim()) });
            i++;
            continue;
        }
        if (HR_RE.test(line)) {
            flushParagraph();
            blocks.push({ type: 'hr' });
            i++;
            continue;
        }
        if (trimmed.startsWith('>')) {
            flushParagraph();
            const quote: string[] = [];
            while (i < lines.length && lines[i].trimStart().startsWith('>')) {
                quote.push(lines[i].trimStart().replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({ type: 'quote', spans: parseInline(quote.join('\n')) });
            continue;
        }
        const list = LIST_RE.exec(line);
        if (list) {
            flushParagraph();
            const depth = Math.min(4, Math.floor(list[1].replace(/\t/g, '  ').length / 2));
            const ordered = /^\d/.test(list[2]);
            let text = list[3];
            let checked: boolean | undefined;
            const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
            if (task) {
                checked = task[1].toLowerCase() === 'x';
                text = task[2];
            }
            if (ordered) {
                blocks.push({ type: 'ordered', n: parseInt(list[2], 10) || 1, depth, spans: parseInline(text) });
            } else {
                blocks.push({ type: 'bullet', depth, spans: parseInline(text), checked });
            }
            i++;
            continue;
        }
        const image = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line);
        if (image) {
            flushParagraph();
            blocks.push({ type: 'image', alt: image[1], src: image[2] });
            i++;
            continue;
        }
        if (isTableStart(lines, i)) {
            flushParagraph();
            const rows: string[][] = [tableCells(lines[i])];
            i += 2;
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                rows.push(tableCells(lines[i]));
                i++;
            }
            blocks.push({ type: 'table', rows });
            continue;
        }
        paragraph.push(line);
        i++;
    }
    flushParagraph();
    return blocks;
}

const blockCache = new Map<string, Block[]>();

export function parseMarkdown(source: string): Block[] {
    const body = withoutFrontmatter(source);
    const cached = blockCache.get(body);
    if (cached) return cached;
    const blocks = parseBlocks(body);
    if (blockCache.size > 80) {
        const oldest = blockCache.keys().next().value;
        if (oldest !== undefined) blockCache.delete(oldest);
    }
    blockCache.set(body, blocks);
    return blocks;
}

export function plainText(blocks: Block[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
        if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote' || block.type === 'bullet' || block.type === 'ordered') {
            parts.push(block.spans.map((span) => span.text).join(''));
        } else if (block.type === 'code') parts.push(block.text);
        else if (block.type === 'table') parts.push(block.rows.flat().join(' '));
        else if (block.type === 'image') parts.push(block.alt);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function markdownExcerpt(source: string, max = 220): string {
    const text = plainText(parseMarkdown(source));
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function markdownTitle(source: string): string | null {
    for (const block of parseMarkdown(source)) {
        if (block.type === 'heading') return block.spans.map((s) => s.text).join('').trim() || null;
        if (block.type === 'paragraph') {
            const text = block.spans.map((s) => s.text).join('').trim();
            if (text) return text;
        }
    }
    return null;
}
