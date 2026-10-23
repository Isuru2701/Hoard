import { useStore } from '../../state/store.ts';
import { emptyTrash, purgeTrash, restoreTrash } from '../../state/actions.ts';
import { dirname } from '../../lib/fs.ts';
import { Btn, Empty, IconBtn, formatDate } from '../kit.tsx';
import { Icon, type IconName } from '../Icon.tsx';

const ICONS: Record<string, IconName> = { image: 'images', video: 'video', file: 'file', markdown: 'markdown', folder: 'folder', canvas: 'canvas' };

export default function TrashView() {
    const trash = useStore((s) => s.meta.trash);
    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-4 pb-2 pt-4">
                <div className="mr-auto">
                    <div className="text-xl font-bold">Trash</div>
                    <div className="text-xs text-muted">{trash.length} items · only this workspace</div>
                </div>
                <Btn ev="trash_empty_clicked" variant="subtle" icon="trash" disabled={!trash.length} onClick={() => void emptyTrash()}>
                    Empty trash
                </Btn>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                {trash.length === 0 ? (
                    <Empty icon="trash" title="Trash is empty">Deleted images, folders and canvases land here so you can restore them.</Empty>
                ) : (
                    trash.map((t) => (
                        <div key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
                            <Icon name={ICONS[t.kind] ?? 'file'} size={16} className="shrink-0 text-muted" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{t.name}</div>
                                <div className="truncate text-xs text-muted">
                                    from /{dirname(t.originalPath) || 'workspace'} · {formatDate(t.deletedAt)}
                                </div>
                            </div>
                            <Btn ev="trash_restore_clicked" onClick={() => void restoreTrash(t.id)}>
                                Restore
                            </Btn>
                            <IconBtn icon="x" title="Delete forever" ev="trash_purge_clicked" danger onClick={() => void purgeTrash(t.id)} />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
