import React from 'react';
import { UiButton, UiInput } from '../../ui/components';
import { createWorkspace, folderDialog, linkWorkspace, type UserWorkspace } from './workspaces-client';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * "New workspace" makes a folder in the workspaces directory; "Add folder" makes any existing folder a workspace,
 * from the desktop app's folder dialog or a typed path. Used by Settings → Workspaces and the workspace pickers.
 */
export function AddWorkspaceControls({
  onAdded,
  size = 'small',
  className,
}: {
  onAdded?(workspace: UserWorkspace): void;
  size?: 'small' | 'medium';
  className?: string;
}) {
  const [mode, setMode] = React.useState<'new' | 'link' | null>(null);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const choose = folderDialog();

  const reset = () => {
    setMode(null);
    setValue('');
    setError('');
  };
  const run = async (action: () => Promise<UserWorkspace | null>) => {
    setBusy(true);
    setError('');
    try {
      const workspace = await action();
      if (!workspace) return;
      reset();
      onAdded?.(workspace);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const addFolder = () => {
    if (!choose) {
      setMode('link');
      return;
    }
    void (async () => {
      let picked: string | null;
      try {
        picked = await choose({ title: 'Add a folder as a workspace' });
      } catch (cause) {
        // An older desktop app has no folder dialog: type the path instead.
        setMode('link');
        setError(errorText(cause));
        return;
      }
      if (picked) await run(() => linkWorkspace(picked!));
    })();
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    void run(() => (mode === 'new' ? createWorkspace(text) : linkWorkspace(text)));
  };

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`} data-add-workspace>
      {mode ? (
        <form onSubmit={submit} className="flex min-w-0 items-center gap-1.5">
          <UiInput
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); reset(); } }}
            placeholder={mode === 'new' ? 'Workspace name' : '/full/path/to/folder'}
            aria-label={mode === 'new' ? 'New workspace name' : 'Folder path'}
            className="!h-7 min-w-0 flex-1 !text-xs"
            disabled={busy}
          />
          <UiButton type="submit" size="small" variant="primary" loading={busy} disabled={!value.trim()}>
            {mode === 'new' ? 'Create' : 'Add'}
          </UiButton>
          <UiButton type="button" size="small" variant="ghost" onClick={reset} disabled={busy}>Cancel</UiButton>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <UiButton type="button" size={size} onClick={() => setMode('new')} disabled={busy}>New workspace</UiButton>
          <UiButton type="button" size={size} variant="ghost" onClick={addFolder} loading={busy}>Add folder…</UiButton>
        </div>
      )}
      {error ? <p role="alert" className="text-xs text-[var(--red)]">{error}</p> : null}
    </div>
  );
}
