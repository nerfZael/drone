import React from 'react';
import { UiBadge, UiButton, UiInput } from '../../ui/components';
import { UiDialog } from '../../ui/components/Dialog';
import { confirmDialog } from '../../ui/AppConfirmDialog';
import { SettingsSection } from '../app/SettingsSurface';
import { AddWorkspaceControls } from './AddWorkspaceControls';
import {
  folderDialog,
  loadUserWorkspaces,
  removeWorkspace,
  renameWorkspace,
  setWorkspacesDirectory,
  subscribeWorkspacesChanged,
  type UserWorkspace,
  type UserWorkspacesState,
} from './workspaces-client';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Workspaces: the workspaces added on this device, and the folder new ones are created in. */
export function WorkspacesSettingsTab() {
  const [state, setState] = React.useState<UserWorkspacesState | null>(null);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const refresh = React.useCallback(async () => {
    try {
      setState(await loadUserWorkspaces());
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);
  React.useEffect(() => {
    void refresh();
    return subscribeWorkspacesChanged(() => void refresh());
  }, [refresh]);

  return (
    <>
      <SettingsSection
        title="Your workspaces"
        description="Folders on this device that the Companion, the entity and agent chats can be given access to, and that the File Explorer can switch to. New workspaces are created in the workspaces folder below; Add folder makes any folder a workspace where it is. Removing a workspace only takes it off this list: its files stay."
      >
        {error ? <p role="alert" className="text-sm text-[var(--red)]">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-[var(--fg-secondary)]">{notice}</p> : null}
        {state === null ? (
          <p role="status" className="text-sm text-[var(--muted)]">Loading workspaces…</p>
        ) : state.workspaces.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No workspaces yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {state.workspaces.map((workspace) => (
              <WorkspaceRow key={workspace.id} workspace={workspace} onError={setError} />
            ))}
          </ul>
        )}
        <AddWorkspaceControls size="medium" onAdded={(workspace) => setNotice(`Added “${workspace.name}” (${workspace.root}).`)} />
      </SettingsSection>
      {state ? <WorkspacesDirectorySection state={state} onChanged={setNotice} /> : null}
    </>
  );
}

function WorkspaceRow({ workspace, onError }: { workspace: UserWorkspace; onError(message: string): void }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(workspace.name);
  const [busy, setBusy] = React.useState(false);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onError('');
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await renameWorkspace(workspace.id, name);
      setEditing(false);
    });
  };
  const remove = () => void act(async () => {
    const confirmed = await confirmDialog({
      title: `Remove “${workspace.name}”?`,
      message: `Agents lose access to it and it leaves the File Explorer. Its files stay in ${workspace.root}.`,
      confirmLabel: 'Remove workspace',
      destructive: true,
    });
    if (confirmed) await removeWorkspace(workspace.id);
  });
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-user-workspace={workspace.id}>
      <div className="min-w-0 flex-1 basis-64">
        {editing ? (
          <form onSubmit={save} className="flex items-center gap-1.5">
            <UiInput
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { setEditing(false); setName(workspace.name); } }}
              aria-label="Workspace name"
              className="!h-7 min-w-0 flex-1 !text-sm"
              disabled={busy}
            />
            <UiButton type="submit" size="small" variant="primary" loading={busy} disabled={!name.trim()}>Save</UiButton>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-[var(--fg)]">{workspace.name}</span>
            <UiBadge tone="neutral">{workspace.kind === 'created' ? 'Created' : 'Linked folder'}</UiBadge>
            {workspace.missing ? <UiBadge tone="danger" dot>Missing</UiBadge> : null}
          </div>
        )}
        <div className="mt-0.5 truncate font-mono text-xs text-[var(--muted)] select-text" title={workspace.root}>{workspace.root}</div>
        {workspace.missing ? (
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            {workspace.kind === 'created'
              ? 'Not in the current workspaces folder. Move it there, or switch the workspaces folder back, to use it again.'
              : 'This folder is gone. Agents and the File Explorer cannot use it until it is back.'}
          </div>
        ) : null}
      </div>
      {!editing ? (
        <div className="flex items-center gap-1">
          <UiButton size="small" variant="ghost" onClick={() => { setName(workspace.name); setEditing(true); }} disabled={busy}>Rename</UiButton>
          <UiButton size="small" variant="ghost" onClick={remove} disabled={busy}>Remove</UiButton>
        </div>
      ) : null}
    </li>
  );
}

function WorkspacesDirectorySection({ state, onChanged }: { state: UserWorkspacesState; onChanged(message: string): void }) {
  const [draft, setDraft] = React.useState(state.directory);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  // The folder waiting on the move question (directory null: the default).
  const [asking, setAsking] = React.useState<{ directory: string | null } | null>(null);
  React.useEffect(() => setDraft(state.directory), [state.directory]);
  const choose = folderDialog();
  // Only workspaces created in the current folder can move; linked folders stay where they are.
  const movable = state.workspaces.filter((workspace) => workspace.kind === 'created' && !workspace.missing);

  const apply = async (directory: string | null, migrate: boolean) => {
    setAsking(null);
    setBusy(true);
    setError('');
    try {
      const result = await setWorkspacesDirectory(directory, migrate);
      const parts = [
        result.moved.length ? `Moved ${result.moved.join(', ')}.` : '',
        result.failed.length ? `Could not move ${result.failed.map((item) => `${item.name} (${item.error})`).join(', ')}.` : '',
      ].filter(Boolean);
      onChanged(`Workspaces folder changed.${parts.length ? ` ${parts.join(' ')}` : ''}`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const change = (directory: string | null) => {
    const target = directory?.trim() || state.defaultDirectory;
    if (target === state.directory) return;
    if (movable.length > 0) setAsking({ directory: directory?.trim() || null });
    else void apply(directory?.trim() || null, false);
  };

  return (
    <SettingsSection
      title="Workspaces folder"
      description={`Where New workspace creates folders on this device. The default is ${state.defaultDirectory}.`}
    >
      <form
        className="flex min-w-0 flex-wrap items-center gap-1.5"
        onSubmit={(event) => { event.preventDefault(); change(draft); }}
      >
        <UiInput
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Workspaces folder"
          className="min-w-0 flex-1 basis-80 font-mono !text-sm"
          disabled={busy}
        />
        {choose ? (
          <UiButton
            type="button"
            size="medium"
            variant="ghost"
            disabled={busy}
            onClick={() => void (async () => {
              try {
                const picked = await choose({ title: 'Choose the workspaces folder', defaultPath: state.directory });
                if (picked) setDraft(picked);
              } catch (cause) { setError(errorText(cause)); }
            })()}
          >
            Browse…
          </UiButton>
        ) : null}
        <UiButton type="submit" size="medium" variant="primary" loading={busy} disabled={!draft.trim() || draft.trim() === state.directory}>Change</UiButton>
        {state.customDirectory ? (
          <UiButton type="button" size="medium" variant="ghost" disabled={busy} onClick={() => change(null)}>Use default</UiButton>
        ) : null}
      </form>
      {error ? <p role="alert" className="text-sm text-[var(--red)]">{error}</p> : null}
      <UiDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title="Move your workspaces too?"
        description={`${movable.length === 1 ? 'One workspace was' : `${movable.length} workspaces were`} created in ${state.directory}: ${movable.map((workspace) => workspace.name).join(', ')}.`}
        size="small"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton variant="ghost" onClick={() => setAsking(null)}>Cancel</UiButton>
            <UiButton variant="secondary" onClick={() => void apply(asking?.directory ?? null, false)}>Don’t move</UiButton>
            <UiButton variant="primary" onClick={() => void apply(asking?.directory ?? null, true)}>Move workspaces</UiButton>
          </div>
        }
      >
        <p className="text-sm text-[var(--fg-secondary)]">
          Moving puts their folders in {asking?.directory ?? state.defaultDirectory}. If you don’t move them, they stay where they
          are and show as missing: agents and the File Explorer cannot use them until you move them or switch back.
          Linked folders are not affected either way.
        </p>
      </UiDialog>
    </SettingsSection>
  );
}
