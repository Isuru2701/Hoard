/** YAML frontmatter preservation for markdown documents. */

export type Eol = '\n' | '\r\n';

export interface SplitDoc {
    /** Exact prefix including both `---` delimiters and the newline after them, or ''. */
    frontmatter: string;
    body: string;
    eol: Eol;
}

export function detectEol(text: string): Eol {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splitFrontmatter(text: string): SplitDoc {
    const eol = detectEol(text);
    const match = /^(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n|$)/.exec(text);
    if (!match) return { frontmatter: '', body: text, eol };
    return { frontmatter: text.slice(0, match[0].length), body: text.slice(match[0].length), eol };
}

export function withoutFrontmatter(text: string): string {
    return splitFrontmatter(text).body;
}

/** Recombine a preserved frontmatter block with editor output using the file's line ending. */
export function joinDoc(frontmatter: string, body: string, eol: Eol): string {
    const normalized = eol === '\r\n' ? body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : body.replace(/\r\n/g, '\n');
    if (!frontmatter) return normalized;
    const fm = frontmatter.endsWith('\n') ? frontmatter : frontmatter + eol;
    return fm + normalized;
}
