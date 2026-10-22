import { useState } from 'react';
import { useStore } from '../state/store.ts';
import { createWorkspace, deleteProfileAction, menuAt, openWorkspace, removeWorkspace, saveProfileAction, selectProfile, toast } from '../state/actions.ts';
import { WS_COLORS, type Profile, type WorkspaceRecord } from '../lib/workspaces.ts';
import { Btn, IconBtn, SectionLabel } from './kit.tsx';
import { Icon } from './Icon.tsx';
import { track } from '../sdk/track.ts';
import { isTauri, revealNativePath } from '../lib/tauriFs.ts';

function ProfileForm({ initial, createNew = false, onDone }: { initial: Profile | null; createNew?: boolean; onDone: () => void }) {
    const [name, setName] = useState(initial?.name ?? '');
    const [username, setUsername] = useState(initial?.username ?? '');
    const submit = async () => {
        if (!name.trim()) return;
        await saveProfileAction(name.trim(), (username.trim() || name.trim()).toLowerCase().replace(/\s+/g, ''), createNew);
        onDone();
    };
    return (
        <div className="space-y-3 rounded-2xl border border-line bg-white/[0.03] p-4">
            <input className="input" placeholder="Your name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="@username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <Btn ev="profile_save_clicked" variant="primary" className="w-full justify-center" onClick={submit} disabled={!name.trim()}>
                {initial ? 'Save profile' : 'Create profile'}
            </Btn>
        </div>
    );
}

function NewWorkspaceModal({ onClose }: { onClose: () => void }) {
    const desktop = isTauri();
    const [name, setName] = useState('');
    const [color, setColor] = useState(WS_COLORS[0]);
    const [kind, setKind] = useState<'local' | 'browser'>(desktop ? 'local' : 'browser');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (!name.trim() || busy) return;
        track('workspace_create_submitted', { kind });
        setBusy(true);
        setError(null);
        const err = await createWorkspace(name.trim(), kind, color);
        setBusy(false);
        if (err === null) onClose();
        else setError(err || null);
    };
    const Option = ({ k, title, desc, disabled }: { k: 'local' | 'browser'; title: string; desc: string; disabled?: boolean }) => (
        <button
            disabled={disabled}
            onClick={() => {
                track('workspace_storage_selected', { kind: k });
                setKind(k);
                setError(null);
            }}
            className={`w-full rounded-xl border p-3 text-left transition ${kind === k ? 'border-accent bg-accent/10' : 'border-line hover:bg-white/5'}`}
        >
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-xs text-muted">{desc}</div>
        </button>
    );
    return (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onPointerDown={onClose}>
            <div className="floating w-full max-w-md rounded-2xl p-5" onPointerDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div className="text-lg font-semibold">New workspace</div>
                    <IconBtn icon="x" title="Close" ev="workspace_modal_closed" onClick={onClose} />
                </div>
                <input className="input mt-4" placeholder="e.g. Character Design & Fashion" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
                <div className="mt-4 flex flex-wrap gap-2">
                    {WS_COLORS.map((c) => (
                        <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label="Workspace color" />
                    ))}
                </div>
                <div className="mt-4 space-y-2">
                    {desktop ? (
                        <Option k="local" title="A folder on my computer" desc="Folders you create here are real folders on disk. You pick the folder next." />
                    ) : (
                        <Option k="browser" title="Workspace" desc="Files stay on this device, inside the browser." />
                    )}
                </div>
                {error && <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs leading-relaxed text-red-300">{error}</div>}
                <div className="mt-5 flex justify-end gap-2">
                    <Btn ev="workspace_create_cancelled" onClick={onClose}>
                        Cancel
                    </Btn>
                    <Btn ev="workspace_create_clicked" variant="primary" onClick={submit} disabled={!name.trim() || busy}>
                        {busy ? 'Creating…' : kind === 'local' ? 'Choose folder & create' : 'Create'}
                    </Btn>
                </div>
            </div>
        </div>
    );
}

function WorkspaceCard({ ws }: { ws: WorkspaceRecord }) {
    const [busy, setBusy] = useState(false);
    const open = async () => {
        track('workspace_card_opened');
        setBusy(true);
        await openWorkspace(ws.id);
        setBusy(false);
    };
    return (
        <div
            role="button"
            onClick={open}
            className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-white/10 p-4 transition hover:brightness-110"
            style={{ background: `linear-gradient(135deg, ${ws.color}cc, ${ws.color}40)` }}
        >
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/90 text-lg font-bold" style={{ color: ws.color }}>
                {ws.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{ws.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/80">
                    <Icon name="folder" size={12} />
                    {ws.stats ? `${ws.stats.folders} folders · ${ws.stats.files} files · ${ws.stats.canvases} canvases` : 'Not opened yet'}
                </div>
                <div className="mt-0.5 truncate text-xs text-white/60">{ws.rootLabel}</div>
            </div>
            <span className="hidden rounded-full bg-black/25 px-3 py-1.5 text-xs font-semibold text-white sm:inline-flex">{busy ? 'Opening…' : 'Open →'}</span>
            <button
                className="ib text-white/80"
                aria-label="Workspace options"
                onClick={(e) =>
                    menuAt(e, [{ label: ws.kind === 'browser' ? 'Delete workspace' : 'Remove from list', icon: 'trash', danger: true, ev: 'workspace_menu_remove', onClick: () => void removeWorkspace(ws.id) }])
                }
            >
                <Icon name="more" />
            </button>
        </div>
    );
}

export default function WorkspacePicker() {
    const profile = useStore((s) => s.profile);
    const profiles = useStore((s) => s.profiles);
    const workspaces = useStore((s) => s.workspaces);
    const [showNew, setShowNew] = useState(false);
    const [editing, setEditing] = useState(false);
    const [addingProfile, setAddingProfile] = useState(false);
    const [deletedWorkspaces, setDeletedWorkspaces] = useState<WorkspaceRecord[]>([]);
    const visibleWorkspaces = workspaces.filter((workspace) => !workspace.profileId || workspace.profileId === profile?.id);
    const revealWorkspace = async (workspace: WorkspaceRecord) => {
        if (!isTauri() || !workspace.path) {
            toast('File Explorer reveal is available for local workspaces in the desktop app');
            return;
        }
        try {
            await revealNativePath(workspace.path);
        } catch (error) {
            console.warn('[profile] reveal failed', error);
            toast('Could not open File Explorer');
        }
    };
    const deleteCurrentProfile = async () => {
        const removed = await deleteProfileAction();
        if (removed.length) setDeletedWorkspaces(removed);
        setEditing(false);
    };
    return (
        <div className="picker-bg h-full overflow-y-auto">
            <div className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="logo">h.</div>
                        <span className="font-serif text-xl font-semibold">hoard.</span>
                    </div>
                </div>
                <h1 className="mt-10 text-4xl font-bold tracking-tight sm:text-5xl">{profile ? 'Welcome back' : 'Welcome to hoard'}</h1>
                <p className="mt-2 text-muted">{profile ? 'Select a workspace to continue.' : 'Create a profile to get started.'}</p>

                <div className="mt-10 grid gap-10 md:grid-cols-[300px_1fr]">
                    <section>
                        <SectionLabel right={<Btn ev="profile_add_clicked" icon="plus" onClick={() => setAddingProfile(true)}>Add</Btn>}>Profiles</SectionLabel>
                        <div className="space-y-2">
                            {profiles.map((item) => (
                                <button key={item.id} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${item.id === profile?.id ? 'border-accent bg-accent/10' : 'border-line bg-white/[0.03]'}`} onClick={() => void selectProfile(item.id ?? '')}>
                                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/90 font-bold text-black">{item.name[0]?.toUpperCase()}</span>
                                    <span className="min-w-0"><span className="block truncate font-semibold">{item.name}</span><span className="block truncate text-xs text-muted">@{item.username}</span></span>
                                </button>
                            ))}
                        </div>
                        {profile && !addingProfile && !editing && (
                            <div className="mt-3 flex justify-end">
                                <div className="flex gap-2">
                                    <Btn ev="profile_edit_clicked" onClick={() => setEditing(true)}>Edit current</Btn>
                                    <Btn ev="profile_delete_clicked" onClick={() => void deleteCurrentProfile()}>Delete profile</Btn>
                                </div>
                            </div>
                        )}
                        {!profile || editing || addingProfile ? (
                            <div className="mt-3">
                                <ProfileForm initial={addingProfile ? null : profile} createNew={addingProfile} onDone={() => { setEditing(false); setAddingProfile(false); }} />
                            </div>
                        ) : (
                            <div className="mt-3 flex items-center gap-4 rounded-2xl border border-line bg-white/[0.04] p-4">
                                <div className="grid h-11 w-11 place-items-center rounded-full bg-white/90 font-bold text-black">{profile.name[0]?.toUpperCase()}</div>
                                <div>
                                    <div className="font-semibold">{profile.name}</div>
                                    <div className="text-sm text-muted">@{profile.username}</div>
                                    <div className="mt-1 text-xs text-muted">
                                        {visibleWorkspaces.length} workspace{visibleWorkspaces.length === 1 ? '' : 's'} · Dark
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                    <section>
                        <SectionLabel
                            right={
                                <Btn ev="workspace_new_clicked" variant="subtle" icon="plus" disabled={!profile} onClick={() => setShowNew(true)}>
                                    New
                                </Btn>
                            }
                        >
                            Workspaces · {visibleWorkspaces.length}
                        </SectionLabel>
                        {visibleWorkspaces.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">
                                {profile ? 'No workspaces yet. Create one to start collecting references.' : 'Create a profile first.'}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {visibleWorkspaces.map((w) => (
                                    <WorkspaceCard key={w.id} ws={w} />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
                {deletedWorkspaces.length > 0 && (
                    <section className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
                        <div className="font-semibold">Profile deleted</div>
                        <p className="mt-1 text-sm text-muted">
                            {deletedWorkspaces.length} workspace{deletedWorkspaces.length === 1 ? '' : 's'} were removed from hoard. Their files were not touched.
                        </p>
                        <div className="mt-3 space-y-2">
                            {deletedWorkspaces.map((workspace) => (
                                <div key={workspace.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-black/10 p-2">
                                    <span className="min-w-0 flex-1 truncate text-sm">{workspace.name}</span>
                                    {workspace.path && (
                                        <Btn ev="profile_deleted_reveal_clicked" icon="folder" onClick={() => void revealWorkspace(workspace)}>
                                            Reveal in File Explorer
                                        </Btn>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
            {showNew && <NewWorkspaceModal onClose={() => setShowNew(false)} />}
        </div>
    );
}
