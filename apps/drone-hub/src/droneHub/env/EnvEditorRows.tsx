import React from 'react';
import type { EnvDraftEntry } from './env-utils';

type EnvEditorRowsProps = {
  entries: EnvDraftEntry[];
  disabled: boolean;
  emptyMessage: string;
  onChange: (id: string, field: 'key' | 'value', value: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  gridClassName?: string;
};

export function EnvEditorRows({
  entries,
  disabled,
  emptyMessage,
  onChange,
  onRemove,
  onAdd,
  gridClassName = 'grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]',
}: EnvEditorRowsProps) {
  return (
    <div className="flex flex-col gap-2">
      {entries.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
          {emptyMessage}
        </div>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className={`${gridClassName} gap-2`}>
            <input
              value={entry.key}
              onChange={(event) => onChange(entry.id, 'key', event.target.value)}
              disabled={disabled}
              className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 font-mono text-[11px] text-[var(--fg)] focus:outline-none"
              placeholder="KEY"
            />
            <input
              value={entry.value}
              onChange={(event) => onChange(entry.id, 'value', event.target.value)}
              disabled={disabled}
              className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 font-mono text-[11px] text-[var(--fg)] focus:outline-none"
              placeholder="value"
            />
            <button
              type="button"
              onClick={() => onRemove(entry.id)}
              disabled={disabled}
              className={`h-9 rounded border px-3 text-[10px] font-semibold tracking-wide uppercase ${
                disabled
                  ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              Remove
            </button>
          </div>
        ))
      )}
      <div>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className={`h-8 rounded border px-3 text-[10px] font-semibold tracking-wide uppercase ${
            disabled
              ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Add variable
        </button>
      </div>
    </div>
  );
}
