import React from 'react';
import type { DroneFsEntry } from '../types';

export type DroneFilesActionMode = 'create-file' | 'create-directory' | 'rename' | 'move' | 'go-to-path';

export type DroneFilesContextMenuState = {
  x: number;
  y: number;
  entry: DroneFsEntry | null;
};

type DroneFilesContextMenuProps = {
  menu: DroneFilesContextMenuState;
  busy: boolean;
  selectedCount: number;
  clipboardCount: number;
  actionMode: DroneFilesActionMode | null;
  actionInput: string;
  actionLoading: boolean;
  readOnly?: boolean;
  onOpen: () => void;
  onCreate: (mode: 'create-file' | 'create-directory') => void;
  onRename: () => void;
  onDelete: () => void;
  onMove: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDownload: () => void;
  onRefresh: () => void;
  onGoToPath: () => void;
  onActionInputChange: (next: string) => void;
  onSubmitAction: () => void;
  onClose: () => void;
};

function actionLabel(mode: DroneFilesActionMode): string {
  if (mode === 'create-file') return 'New File';
  if (mode === 'create-directory') return 'New Folder';
  if (mode === 'rename') return 'Rename';
  if (mode === 'move') return 'Move';
  return 'Go to Path';
}

function actionPlaceholder(mode: DroneFilesActionMode): string {
  if (mode === 'create-file') return 'File name';
  if (mode === 'create-directory') return 'Folder name';
  if (mode === 'rename') return 'New name';
  if (mode === 'move') return 'Destination folder path';
  return 'Path';
}

function MenuDivider() {
  return <div className="my-1 h-px bg-[var(--border-subtle)]" />;
}

export function DroneFilesContextMenu({
  menu,
  busy,
  selectedCount,
  clipboardCount,
  actionMode,
  actionInput,
  actionLoading,
  readOnly = false,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onCopy,
  onPaste,
  onDownload,
  onRefresh,
  onGoToPath,
  onActionInputChange,
  onSubmitAction,
  onClose,
}: DroneFilesContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const closeFromPointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', closeFromPointer);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeFromPointer);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [onClose]);

  React.useEffect(() => {
    if (actionMode) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [actionMode]);

  const itemClassName =
    'flex h-7 w-full items-center rounded-sm px-2.5 text-left text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--accent-subtle)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40';
  const entrySelected = menu.entry != null && selectedCount > 0;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="File explorer actions"
      className="fixed z-[80] max-h-[calc(100vh-8px)] w-[220px] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel)] p-1 shadow-[0_10px_30px_var(--shadow-color)]"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actionMode ? (
        <form
          className="p-1"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitAction();
          }}
        >
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {actionLabel(actionMode)}
          </label>
          <input
            type="text"
            value={actionInput}
            disabled={actionLoading}
            onChange={(event) => onActionInputChange(event.currentTarget.value)}
            autoFocus
            className="h-7 w-full rounded-sm border border-[var(--accent-muted)] bg-[var(--panel-alt)] px-2 text-[12px] text-[var(--fg)] outline-none disabled:opacity-60"
            placeholder={actionPlaceholder(actionMode)}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              disabled={actionLoading}
              onClick={onClose}
              className="h-7 rounded-sm px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading || !actionInput.trim()}
              className="h-7 rounded-sm bg-[var(--accent-subtle)] px-2.5 text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {actionLoading ? 'Working…' : actionMode === 'go-to-path' ? 'Go' : actionLabel(actionMode)}
            </button>
          </div>
        </form>
      ) : (
        <>
          {menu.entry ? (
            <>
              <button type="button" role="menuitem" disabled={busy} onClick={onOpen} className={itemClassName}>
                {menu.entry.kind === 'directory' ? 'Expand / Collapse' : 'Open'}
              </button>
              <MenuDivider />
              {!readOnly ? (
                <>
                  <button type="button" role="menuitem" disabled={busy || !entrySelected} onClick={onCopy} className={itemClassName}>
                    Copy{selectedCount > 1 ? ` ${selectedCount} Items` : ''}
                  </button>
                  <button type="button" role="menuitem" disabled={busy || !entrySelected} onClick={onMove} className={itemClassName}>
                    Move{selectedCount > 1 ? ` ${selectedCount} Items…` : '…'}
                  </button>
                  <button type="button" role="menuitem" disabled={busy || selectedCount !== 1} onClick={onRename} className={itemClassName}>
                    Rename…
                  </button>
                </>
              ) : null}
              <button type="button" role="menuitem" disabled={busy} onClick={onDownload} className={itemClassName}>
                Download
              </button>
              {!readOnly ? (
                <>
                  <MenuDivider />
                  <button type="button" role="menuitem" disabled={busy || !entrySelected} onClick={onDelete} className={`${itemClassName} text-[var(--red)] hover:text-[var(--red)]`}>
                    Delete{selectedCount > 1 ? ` ${selectedCount} Items` : ''}
                  </button>
                  <MenuDivider />
                  <button type="button" role="menuitem" disabled={busy} onClick={() => onCreate('create-file')} className={itemClassName}>New File…</button>
                  <button type="button" role="menuitem" disabled={busy} onClick={() => onCreate('create-directory')} className={itemClassName}>New Folder…</button>
                  <button type="button" role="menuitem" disabled={busy || clipboardCount === 0} onClick={onPaste} className={itemClassName}>Paste{clipboardCount > 1 ? ` ${clipboardCount} Items` : ''}</button>
                </>
              ) : null}
              <MenuDivider />
              <button type="button" role="menuitem" disabled={busy} onClick={onRefresh} className={itemClassName}>
                Refresh
              </button>
              <button type="button" role="menuitem" disabled={busy} onClick={onGoToPath} className={itemClassName}>
                Go to Path…
              </button>
            </>
          ) : (
            <>
              {!readOnly ? (
                <>
                  <button type="button" role="menuitem" disabled={busy} onClick={() => onCreate('create-file')} className={itemClassName}>New File…</button>
                  <button type="button" role="menuitem" disabled={busy} onClick={() => onCreate('create-directory')} className={itemClassName}>New Folder…</button>
                  <button type="button" role="menuitem" disabled={busy || clipboardCount === 0} onClick={onPaste} className={itemClassName}>Paste{clipboardCount > 1 ? ` ${clipboardCount} Items` : ''}</button>
                  <MenuDivider />
                </>
              ) : null}
              <button type="button" role="menuitem" disabled={busy} onClick={onRefresh} className={itemClassName}>
                Refresh
              </button>
              <button type="button" role="menuitem" disabled={busy} onClick={onGoToPath} className={itemClassName}>
                Go to Path…
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
