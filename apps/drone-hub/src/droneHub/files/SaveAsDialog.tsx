import React from 'react';
import { UiButton, UiDialog, UiField, UiInput, UiSpinner } from '../../ui/components';
import { requestJson } from '../http';
import type { DroneFsEntry, DroneFsListPayload } from '../types';
import { FolderTypeIcon } from './FileTypeIcon';
import { joinFsPath } from './filesystem-mutation-refresh';

export type SaveAsAttempt = { path: string; directory: string; name: string; overwrite: boolean };
export type SaveAsOutcome = { ok: true } | { ok: false; error: string; exists?: boolean };

export type SaveAsRequestOptions = {
  droneId: string;
  initialDirectory: string;
  initialName: string;
  /** Writes the file. The dialog stays open, showing the error, until this succeeds or the person cancels. */
  save: (attempt: SaveAsAttempt) => Promise<SaveAsOutcome>;
};

type SaveAsRequest = SaveAsRequestOptions & { id: number; resolve: (saved: boolean) => void };

// Asked for from the editor's state hook, so requests live outside React like
// the app's confirm and prompt dialogs; the host at the app root shows them.
let requests: SaveAsRequest[] = [];
let nextRequestId = 1;
let hosts = 0;
const listeners = new Set<() => void>();

function setRequests(next: SaveAsRequest[]): void {
  requests = next;
  for (const listener of listeners) listener();
}

function settle(id: number, saved: boolean): void {
  const current = requests.find((entry) => entry.id === id);
  if (!current) return;
  setRequests(requests.filter((entry) => entry.id !== id));
  current.resolve(saved);
}

/** Asks where to save a file and saves it there. Resolves true once saved, false when cancelled. */
export function requestSaveAs(options: SaveAsRequestOptions): Promise<boolean> {
  if (hosts === 0) {
    console.warn('A save dialog was requested before SaveAsDialogHost was mounted.');
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    setRequests([...requests, { ...options, id: nextRequestId++, resolve }]);
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const currentRequest = () => requests[0] ?? null;

/** Shows the dialogs asked for through requestSaveAs. Mounted once, at the app root. */
export function SaveAsDialogHost() {
  const current = React.useSyncExternalStore(subscribe, currentRequest, () => null);
  React.useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      while (hosts === 0 && requests[0]) settle(requests[0].id, false);
    };
  }, []);
  if (!current) return null;
  return <SaveAsDialog key={current.id} request={current} />;
}

function parentDirectory(pathRaw: string): string {
  const path = String(pathRaw ?? '').trim().replace(/\/+$/, '');
  if (!path || path === '/') return '/';
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function useDirectoryFolders(droneId: string, directory: string) {
  const [state, setState] = React.useState<{ folders: DroneFsEntry[]; loading: boolean; error: string | null }>({
    folders: [],
    loading: true,
    error: null,
  });
  React.useEffect(() => {
    const path = directory.trim();
    if (!path) {
      setState({ folders: [], loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      void requestJson<Extract<DroneFsListPayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/fs/list?path=${encodeURIComponent(path)}`,
        { signal: controller.signal },
      )
        .then((data) => {
          const folders = (Array.isArray(data.entries) ? data.entries : [])
            .filter((entry) => entry.kind === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          setState({ folders, loading: false, error: null });
        })
        .catch((error: any) => {
          if (controller.signal.aborted) return;
          setState({ folders: [], loading: false, error: error?.message ?? String(error) });
        });
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [directory, droneId]);
  return state;
}

function SaveAsDialog({ request }: { request: SaveAsRequest }) {
  const [directory, setDirectory] = React.useState(request.initialDirectory);
  const [name, setName] = React.useState(request.initialName);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [existingPath, setExistingPath] = React.useState<string | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const folders = useDirectoryFolders(request.droneId, directory);

  React.useEffect(() => {
    const input = nameInputRef.current;
    if (!input) return;
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }, []);

  const trimmedName = name.trim();
  const trimmedDirectory = directory.trim();
  const nameError = /[\\/]/.test(trimmedName) ? 'A file name cannot contain a slash.' : null;
  const targetPath = trimmedDirectory && trimmedName && !nameError ? joinFsPath(trimmedDirectory, trimmedName) : '';
  const replacing = Boolean(targetPath && existingPath === targetPath);

  const changeDirectory = (next: string) => {
    setDirectory(next);
    setError(null);
  };

  const submit = async () => {
    if (!targetPath || saving) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await request.save({ path: targetPath, directory: trimmedDirectory, name: trimmedName, overwrite: replacing });
      if (outcome.ok) {
        settle(request.id, true);
        return;
      }
      if (outcome.exists) {
        setExistingPath(targetPath);
        setError(`${trimmedName} already exists in this folder. Replace it?`);
      } else {
        setError(outcome.error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <UiDialog
      open
      onClose={() => { if (!saving) settle(request.id, false); }}
      title="Save new file"
      size="medium"
      initialFocusRef={nameInputRef}
      footer={
        <>
          <UiButton onClick={() => settle(request.id, false)} size="medium" disabled={saving}>Cancel</UiButton>
          <UiButton
            onClick={() => void submit()}
            variant={replacing ? 'danger' : 'primary'}
            size="medium"
            disabled={!targetPath}
            loading={saving}
          >
            {replacing ? 'Replace' : 'Save'}
          </UiButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UiField label="Name" htmlFor="save-as-name" error={nameError ?? (error && replacing ? error : null)}>
          <UiInput
            id="save-as-name"
            ref={nameInputRef}
            value={name}
            spellCheck={false}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void submit();
            }}
          />
        </UiField>
        <UiField label="Folder" htmlFor="save-as-folder" error={error && !replacing ? error : null}>
          <UiInput
            id="save-as-folder"
            value={directory}
            spellCheck={false}
            onChange={(event) => changeDirectory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void submit();
            }}
          />
        </UiField>
        <div
          className="h-56 overflow-y-auto rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] py-1"
          role="listbox"
          aria-label="Folders"
        >
          {trimmedDirectory && trimmedDirectory !== '/' ? (
            <FolderRow label=".." path="" onOpen={() => changeDirectory(parentDirectory(trimmedDirectory))} />
          ) : null}
          {folders.loading ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-ui text-[var(--muted)]"><UiSpinner size="small" /> Loading folders…</div>
          ) : folders.error ? (
            <div className="px-3 py-1.5 text-ui text-[var(--red)]">{folders.error}</div>
          ) : folders.folders.length === 0 ? (
            <div className="px-3 py-1.5 text-ui text-[var(--muted)]">No folders here.</div>
          ) : (
            folders.folders.map((entry) => (
              <FolderRow key={entry.path} label={entry.name} path={entry.path} onOpen={() => changeDirectory(entry.path)} />
            ))
          )}
        </div>
      </div>
    </UiDialog>
  );
}

function FolderRow({ label, path, onOpen }: { label: string; path: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      onClick={onOpen}
      className="flex w-full items-center gap-2 px-3 py-1 text-left text-ui text-[var(--fg-secondary)] hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
      title={path || 'Parent folder'}
    >
      <FolderTypeIcon path={path || label} className="h-3.5 w-3.5 shrink-0" size={14} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
