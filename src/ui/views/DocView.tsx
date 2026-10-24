import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getRoot, rescanSoon } from '../../state/actions.ts';
import { basename, readText, writeFile } from '../../lib/fs.ts';
import { splitFrontmatter, joinDoc } from '../../lib/frontmatter.ts';
import { notifyDocChanged } from '../../lib/docEvents.ts';
import { IconBtn } from '../kit.tsx';
import { MarkdownEditor, type MarkdownApi } from '../MarkdownEditor.tsx';

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
    const textRef = useRef('');
    const saveTimer = useRef(0);
    // Live-editor handle: kept across mode switches so the undo/redo history in
    // the ProseMirror editor is never destroyed by leaving WYSIWYG view.
    const editorRef = useRef<MarkdownApi | null>(null);
    // Exact textarea content when source mode was entered (and while it lasts),
    // used to detect source edits without tripping on WYSIWYG serialization drift.
    const sourceBase = useRef('');
    // Source edits made before the rich editor finished booting get merged on ready.
    const pendingApply = useRef<string | null>(null);
    const sourceRef = useRef<HTMLTextAreaElement>(null);

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
        if (next === 'wysiwyg') {
            // The editor stayed alive while hidden — merge the source text into its
            // doc with a single transaction (one undo step) instead of remounting,
            // which threw away the whole undo/redo history.
            const body = textRef.current;
            const editor = editorRef.current;
            if (body !== sourceBase.current) {
                if (editor) {
                    void editor.applyMarkdown(body);
                } else {
                    pendingApply.current = body;
                }
            }
            sourceBase.current = body;
        } else {
            sourceBase.current = textRef.current;
            // The textarea's value is only the initial content (uncontrolled).
            window.setTimeout(() => sourceRef.current?.focus());
        }
        setMode(next);
    };

    const onEditorReady = (api: MarkdownApi) => {
        editorRef.current = api;
        const pending = pendingApply.current;
        if (pending !== null) {
            pendingApply.current = null;
            void api.applyMarkdown(pending);
        }
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
        <div className="flex h-full flex-col">
            {header(title, status)}
            {frontmatter && (
                <pre className="mx-4 shrink-0 rounded-lg border border-line bg-white/[0.03] p-3 font-mono text-xs leading-relaxed text-muted overflow-x-auto">{frontmatter}</pre>
            )}
            <div className={`min-h-0 flex-1 ${mode === 'source' ? 'hidden' : 'flex flex-col'}`}>
                <MarkdownEditor value={textRef.current} onChange={(md) => put(md)} root={root} onReady={onEditorReady} />
            </div>
            <textarea
                ref={sourceRef}
                className={`min-h-0 flex-1 resize-none bg-transparent px-6 py-4 font-mono text-sm leading-relaxed text-fg outline-none ${mode === 'wysiwyg' ? 'hidden' : ''}`}
                defaultValue={textRef.current}
                spellCheck={false}
                placeholder="Write markdown here…"
                onChange={(e) => put(e.target.value)}
            />
        </div>
    );
}
