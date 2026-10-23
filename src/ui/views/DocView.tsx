import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getRoot, rescanSoon } from '../../state/actions.ts';
import { basename, readText, writeFile } from '../../lib/fs.ts';
import { splitFrontmatter, joinDoc } from '../../lib/frontmatter.ts';
import { notifyDocChanged } from '../../lib/docEvents.ts';
import { IconBtn } from '../kit.tsx';
import { MarkdownEditor } from '../MarkdownEditor.tsx';

type Mode = 'wysiwyg' | 'source';

export default function DocView({ path }: { path: string }) {
    const root = getRoot();
    const [loading, setLoading] = useState(true);
    const [raw, setRaw] = useState('');
    const [frontmatter, setFrontmatter] = useState('');
    const [eol, setEol] = useState<'\n' | '\r\n'>('\n');
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [mode, setMode] = useState<Mode>('wysiwyg');
    const [wysiwygKey, setWysiwygKey] = useState(0);
    const textRef = useRef('');
    const saveTimer = useRef(0);

    useEffect(() => {
        let live = true;
        setLoading(true);
        setDirty(false);
        setMode('wysiwyg');
        if (!root) {
            setLoading(false);
            return;
        }
        void readText(root, path).then((t) => {
            if (!live) return;
            const value = t ?? '';
            const split = splitFrontmatter(value);
            setFrontmatter(split.frontmatter);
            setEol(split.eol);
            setRaw(split.body);
            textRef.current = split.body;
            setLoading(false);
        });
        return () => {
            live = false;
        };
    }, [root, path]);

    const save = async (body: string) => {
        if (!root) {
            setSaving(false);
            return;
        }
        setSaving(true);
        try {
            await writeFile(root, path, joinDoc(frontmatter, body, eol));
            notifyDocChanged(path);
            // Bursty while typing; the workspace walk is coalesced elsewhere.
            void rescanSoon();
        } catch (err) {
            console.warn('[doc] save failed', err);
        }
        setSaving(false);
    };

    /** Shared "content changed" entry point: debounce a save. */
    const put = (body: string, force = false) => {
        textRef.current = body;
        window.clearTimeout(saveTimer.current);
        if (!force) {
            setDirty(true);
            saveTimer.current = window.setTimeout(() => {
                if (textRef.current !== raw) {
                    void save(textRef.current);
                    setRaw(textRef.current);
                    setDirty(false);
                }
            }, 600);
            return;
        }
        if (textRef.current !== raw) {
            void save(textRef.current);
            setRaw(textRef.current);
            setDirty(false);
        }
    };

    const flush = () => {
        window.clearTimeout(saveTimer.current);
        put(textRef.current, true);
    };

    // Ctrl+S saves now; when leaving the document, flush any pending edit to disk.
    // Runs once per mounted document: `flush` is reached through a ref so it always
    // sees the latest frontmatter/raw without re-running this effect — a no-deps
    // cleanup here used to force-save (and rescan the whole workspace) per keystroke.
    const flushRef = useRef<() => void>(() => {});
    flushRef.current = flush;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                flushRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            flushRef.current();
        };
    }, []);

    const switchMode = (next: Mode) => {
        if (next === mode) return;
        flush();
        setMode(next);
        // Remount the editor from the latest text so nothing is lost in the swap.
        setWysiwygKey((k) => k + 1);
    };

    const header = (title: string, sub: ReactNode) => (
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
            <div className="mr-auto min-w-0">
                <div className="truncate text-xl font-bold">{title}</div>
                <div className="text-xs text-muted">{sub}</div>
            </div>
            <div className="mb-1 flex rounded-lg bg-white/5 p-0.5 text-xs">
                <button
                    className={`h-7 rounded-md px-2.5 font-semibold ${mode === 'wysiwyg' ? 'bg-white/15 text-white' : 'text-muted'}`}
                    onClick={() => switchMode('wysiwyg')}
                >
                    WYSIWYG
                </button>
                <button
                    className={`h-7 rounded-md px-2.5 font-semibold ${mode === 'source' ? 'bg-white/15 text-white' : 'text-muted'}`}
                    onClick={() => switchMode('source')}
                >
                    Source
                </button>
            </div>
        </div>
    );

    const title = basename(path).replace(/\.(md|markdown|mdx)$/i, '') || 'Untitled';
    const status = saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved · Ctrl+S to save now';

    if (loading) {
        return (
            <div className="flex h-full flex-col">
                {header(title, path)}
                <div className="grid flex-1 place-items-center text-sm text-muted">Loading…</div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col" key={wysiwygKey}>
            {header(title, status)}
            {frontmatter && (
                <pre className="mx-4 shrink-0 rounded-lg border border-line bg-white/[0.03] p-3 font-mono text-xs leading-relaxed text-muted overflow-x-auto">{frontmatter}</pre>
            )}
            {mode === 'wysiwyg' ? (
                <MarkdownEditor value={textRef.current} onChange={(md) => put(md)} root={root} />
            ) : (
                <textarea
                    className="min-h-0 flex-1 resize-none bg-transparent px-6 py-4 font-mono text-sm leading-relaxed text-fg outline-none"
                    defaultValue={textRef.current}
                    spellCheck={false}
                    placeholder="Write markdown here…"
                    onChange={(e) => put(e.target.value)}
                />
            )}
        </div>
    );
}
