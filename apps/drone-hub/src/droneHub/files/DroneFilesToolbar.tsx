import React from 'react';
import { IconCopy, IconPlus, IconTrash } from '../app/icons';

export type DroneFilesActionMode = 'create-file' | 'create-directory' | 'rename' | 'move';

type DroneFilesToolbarProps = {
  busy: boolean;
  visibleAllSelected: boolean;
  visibleCount: number;
  selectedCount: number;
  clipboardCount: number;
  actionMode: DroneFilesActionMode | null;
  actionInput: string;
  actionLoading: boolean;
  onSelectAllVisible: (selected: boolean) => void;
  onCreate: (mode: 'create-file' | 'create-directory') => void;
  onRename: () => void;
  onDeleteSelected: () => void;
  onMove: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onActionInputChange: (next: string) => void;
  onSubmitAction: () => void;
  onCancelAction: () => void;
};

export function DroneFilesToolbar({
  busy,
  visibleAllSelected,
  visibleCount,
  selectedCount,
  clipboardCount,
  actionMode,
  actionInput,
  actionLoading,
  onSelectAllVisible,
  onCreate,
  onRename,
  onDeleteSelected,
  onMove,
  onCopy,
  onPaste,
  onActionInputChange,
  onSubmitAction,
  onCancelAction,
}: DroneFilesToolbarProps) {
  const buttonClassName =
    'h-7 px-2 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0';

  return (
    <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)]">
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        <label className="h-7 px-2 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] text-[10px] font-semibold text-[var(--muted)] inline-flex items-center gap-1.5 shrink-0">
          <input
            type="checkbox"
            checked={visibleAllSelected}
            disabled={busy || visibleCount === 0}
            onChange={(event) => onSelectAllVisible(event.currentTarget.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
            title="Select visible items"
          />
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select'}
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => onCreate('create-file')}
          className={`${buttonClassName} inline-flex items-center gap-1`}
          title="Create file"
        >
          <IconPlus className="w-3 h-3" />
          File
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onCreate('create-directory')}
          className={`${buttonClassName} inline-flex items-center gap-1`}
          title="Create folder"
        >
          <IconPlus className="w-3 h-3" />
          Folder
        </button>
        <button
          type="button"
          disabled={busy || selectedCount !== 1}
          onClick={onRename}
          className={buttonClassName}
          title="Rename selected item"
        >
          Rename
        </button>
        <button
          type="button"
          disabled={busy || selectedCount === 0}
          onClick={onDeleteSelected}
          className="h-7 px-2 rounded-md border border-[rgba(248,81,73,.2)] bg-[var(--panel)] text-[10px] font-semibold text-[var(--red)] hover:bg-[var(--red-subtle)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 shrink-0"
          title="Delete selected items"
        >
          <IconTrash className="w-3 h-3" />
          Delete
        </button>
        <button type="button" disabled={busy || selectedCount === 0} onClick={onMove} className={buttonClassName} title="Move selected items">
          Move
        </button>
        <button
          type="button"
          disabled={busy || selectedCount === 0}
          onClick={onCopy}
          className={`${buttonClassName} inline-flex items-center gap-1`}
          title="Copy selected items"
        >
          <IconCopy className="w-3 h-3" />
          Copy
        </button>
        <button
          type="button"
          disabled={busy || clipboardCount === 0}
          onClick={onPaste}
          className={buttonClassName}
          title={clipboardCount > 0 ? `Paste ${clipboardCount} copied item${clipboardCount === 1 ? '' : 's'}` : 'Paste copied items'}
        >
          Paste
        </button>
      </div>
      {actionMode ? (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            type="text"
            value={actionInput}
            disabled={actionLoading}
            onChange={(event) => onActionInputChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmitAction();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelAction();
              }
            }}
            autoFocus
            className="h-7 flex-1 min-w-0 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] px-2 text-[11px] text-[var(--fg-secondary)] focus:outline-none disabled:opacity-60"
            placeholder={
              actionMode === 'move'
                ? 'Destination folder path'
                : actionMode === 'rename'
                  ? 'New name'
                  : actionMode === 'create-directory'
                    ? 'Folder name'
                    : 'File name'
            }
          />
          <button
            type="button"
            disabled={actionLoading || !actionInput.trim()}
            onClick={onSubmitAction}
            className="h-7 px-2.5 rounded-md border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[10px] font-semibold text-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {actionLoading ? 'Working' : actionMode === 'move' ? 'Move' : actionMode === 'rename' ? 'Rename' : 'Create'}
          </button>
          <button
            type="button"
            disabled={actionLoading}
            onClick={onCancelAction}
            className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
