/** Mounts Milkdown Crepe lazily so its bundle stays out of the rest of the app.
 *  Also handles the "hoard:library-paths:" clipboard payload by embedding the
 *  referenced workspace files as hoard-file: URLs (live links to real files). */
import { useEffect, useRef, useState } from 'react';
import { basename, kindOf, type Dir } from '../lib/fs.ts';
import { altForDocPath, encodeHoardSrc, isHoardSrc, resolveHoardSrc } from '../lib/hoardSrc.ts';

type ListenerApi = { markdownUpdated: (fn: (ctx: unknown, markdown: string, prev: string) => void) => void };
type MilkdownCtx = import('@milkdown/ctx').Ctx;
type ViewCtx = import('@milkdown/ctx').SliceType<import('prosemirror-view').EditorView>;
type EditorView = import('prosemirror-view').EditorView;
type CrepeLike = {
    editor: { action: <T>(fn: (ctx: MilkdownCtx) => T) => T };
    destroy: () => Promise<unknown>;
    on: (fn: (listener: ListenerApi) => void) => void;
    getMarkdown: () => string;
};

/** Imperative access to the live ProseMirror doc, so view-mode switches can
 *  edit it without tearing down (and losing the undo/redo history of) the editor. */
export interface MarkdownApi {
    /** Replace the whole WYSIWYG doc with the given markdown in one transaction. */
    applyMarkdown(markdown: string): Promise<void>;
}

const HOARD_PASTE_RE = /^hoard:library-paths:([\s\S]+)$/;

function parseHoardPaste(text: string): string[] | null {
    const match = HOARD_PASTE_RE.exec(text.trim());
    if (!match) return null;
    try {
        const paths = JSON.parse(match[1]) as unknown;
        if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string')) return null;
        return paths as string[];
    } catch {
        return null;
    }
}

export function MarkdownEditor(props: {
    value: string;
    onChange: (markdown: string) => void;
    /** Workspace root; needed to resolve embedded hoard-file: URLs. */
    root: Dir | null;
    className?: string;
    /** Called once the editor finished creating; the api lives as long as this keep-mounted component does. */
    onReady?: (api: MarkdownApi) => void;
}) {
    const { value, onChange, root, className = '', onReady } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const rootRef = useRef(root);
    rootRef.current = root;
    const crepeRef = useRef<CrepeLike | null>(null);
    const viewCtxRef = useRef<ViewCtx | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let ready = false;
        let disposed = false;
        const mount = { crepe: null as CrepeLike | null };
        const host = hostRef.current;
        if (!host) return;
        crepeRef.current = null;
        viewCtxRef.current = null;

        const insertEmbeds = (paths: string[]) => {
            const crepe = crepeRef.current;
            const viewCtx = viewCtxRef.current;
            if (!crepe || !viewCtx) return;
            crepe.editor.action((ctx) => {
                const view: EditorView | undefined = ctx.get(viewCtx);
                if (!view) return;
                for (const path of paths) {
                    const url = encodeHoardSrc(path);
                    const name = altForDocPath(path);
                    const kind = kindOf(path);
                    const schema = view.state.schema;
                    let node;
                    if (kind === 'image') {
                        node = schema.nodes.image.create({ src: url, alt: name, title: name });
                    } else {
                        node = schema.text(basename(path), [schema.marks.link.create({ href: url })]);
                    }
                    view.dispatch(view.state.tr.replaceSelectionWith(node));
                }
                view.focus();
            });
        };

        const resolvePending = new Set<string>();
        /** Swap hoard-file: img srcs for live object URLs as PM renders them. */
        const hoistImgs = () => {
            if (!rootRef.current) return;
            const imgs = host.querySelectorAll<HTMLImageElement>('img[src^="hoard-file:"]');
            for (const img of imgs) {
                const src = img.getAttribute('src');
                if (!src || !isHoardSrc(src) || resolvePending.has(src)) continue;
                resolvePending.add(src);
                void resolveHoardSrc(src, rootRef.current).then((url) => {
                    if (!img.isConnected || img.getAttribute('src') !== src) {
                        // PM re-rendered it away; keep the pass-through cache warm for the next render.
                        resolvePending.delete(src);
                        return;
                    }
                    if (url) img.src = url;
                    else img.classList.add('hoard-img-missing');
                });
            }
        };

        const onPaste = (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            const text = e.clipboardData.getData('text/plain');
            if (!text) return;
            const paths = parseHoardPaste(text);
            if (!paths) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            insertEmbeds(paths);
        };

        const observer = new MutationObserver(() => hoistImgs());
        observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        host.addEventListener('paste', onPaste, true);

        void (async () => {
            try {
                const [{ Crepe }, core] = await Promise.all([import('@milkdown/crepe'), import('@milkdown/kit/core')]);
                const { editorViewCtx } = core;
                await Promise.all([import('@milkdown/crepe/theme/common/style.css'), import('@milkdown/crepe/theme/frame-dark.css')]);
                if (disposed || hostRef.current !== host) return;
                const crepe = new Crepe({
                    root: host,
                    defaultValue: value,
                    features: {
                        [Crepe.Feature.ImageBlock]: false,
                        [Crepe.Feature.AI]: false,
                        [Crepe.Feature.Latex]: false,
                        [Crepe.Feature.TopBar]: false,
                    },
                });
                crepe.on((listener: ListenerApi) => {
                    listener.markdownUpdated((_ctx, markdown) => {
                        if (ready) onChangeRef.current(markdown);
                    });
                });
                await crepe.create();
                if (disposed) {
                    await crepe.destroy();
                    return;
                }
                // Updates fired during create() were swallowed (ready=false), so the
                // initial value is normalized silently instead of marking the doc dirty.
                mount.crepe = crepe as unknown as CrepeLike;
                crepeRef.current = mount.crepe;
                viewCtxRef.current = editorViewCtx;
                setLoading(false);
                ready = true;
                hoistImgs();
                /** Typing in the whole-doc replace transaction is a single step in
                 *  this doc's history, so undo/redo survives view-mode switches. */
                const api: MarkdownApi = {
                    applyMarkdown: async (markdown) => {
                        const c = crepeRef.current;
                        if (!c) return;
                        try {
                            const { parserCtx, editorViewCtx: viewCtx } = await import('@milkdown/kit/core');
                            c.editor.action((ctx) => {
                                const view: EditorView | null = ctx.get(viewCtx);
                                if (!view) return;
                                const doc = ctx.get(parserCtx)(markdown);
                                if (!doc) return;
                                view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
                            });
                        } catch (err) {
                            console.warn('[wysiwyg] failed to apply markdown into the live editor', err);
                        }
                    },
                };
                onReadyRef.current?.(api);
            } catch (err) {
                if (disposed) return;
                console.warn('[wysiwyg] failed to start Milkdown Crepe', err);
                setFailed(true);
                setLoading(false);
            }
        })();

        return () => {
            disposed = true;
            ready = false;
            observer.disconnect();
            host.removeEventListener('paste', onPaste, true);
            const c = mount.crepe;
            if (c) void c.destroy().catch(() => {});
        };
        // The editor is mounted from scratch per document and stays alive across view-mode
        // switches; `value` is only the initial content.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className={`markdown-editor relative flex min-h-0 flex-1 flex-col ${className}`}>
            {loading && <div className="grid h-full place-items-center text-sm text-muted">Starting editor…</div>}
            {failed && <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">The rich editor failed to load. Switch to source mode to keep editing.</div>}
            <div ref={hostRef} className={`doc-host min-h-0 flex-1 ${loading || failed ? 'hidden' : ''}`} />
        </div>
    );
}
