import React from 'react';
import type { PlaybookDefinition } from '../types';

type PlaybookTextListEditorProps = {
  title: string;
  description?: string;
  items: string[];
  emptyText: string;
  addLabel: string;
  addDisabled?: boolean;
  placeholder: string;
  multiline?: boolean;
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onDelete: (index: number) => void;
};

export function PlaybookTextListEditor({
  title,
  description,
  items,
  emptyText,
  addLabel,
  addDisabled,
  placeholder,
  multiline = false,
  onAdd,
  onChange,
  onDelete,
}: PlaybookTextListEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="text-[11px] text-[var(--muted-dim)]">{title}</label>
          {description ? <div className="text-[10px] text-[var(--muted-dim)] mt-1">{description}</div> : null}
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--display)' }}
        >
          {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
          {emptyText}
        </div>
      ) : (
        items.map((item, index) => (
          <div key={`${title}:${index}`} className={`flex ${multiline ? 'items-start' : 'items-center'} gap-2`}>
            <div className={`text-[10px] text-[var(--muted-dim)] font-semibold w-5 text-right ${multiline ? 'mt-2' : ''}`}>{index + 1}</div>
            {multiline ? (
              <textarea
                value={item}
                onChange={(e) => onChange(index, e.target.value)}
                className="flex-1 min-h-[92px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder={placeholder}
              />
            ) : (
              <input
                type="text"
                value={item}
                onChange={(e) => onChange(index, e.target.value)}
                className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder={placeholder}
              />
            )}
            <button
              type="button"
              onClick={() => onDelete(index)}
              className={`px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)] ${multiline ? 'h-8 mt-1' : 'h-8'}`}
              style={{ fontFamily: 'var(--display)' }}
            >
              Delete
            </button>
          </div>
        ))
      )}
    </div>
  );
}

type PlaybookActionListEditorProps = {
  actions: PlaybookDefinition['actions'];
  addDisabled?: boolean;
  onAdd: () => void;
  onUpdate: (actionId: string, patch: Partial<PlaybookDefinition['actions'][number]>) => void;
  onDelete: (actionId: string) => void;
};

export function PlaybookActionListEditor({
  actions,
  addDisabled,
  onAdd,
  onUpdate,
  onDelete,
}: PlaybookActionListEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="text-[11px] text-[var(--muted-dim)]">Run Actions</label>
          <div className="text-[10px] text-[var(--muted-dim)] mt-1">Optional follow-up buttons shown for each run row.</div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--display)' }}
        >
          Add action
        </button>
      </div>
      {actions.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
          No follow-up buttons for this playbook.
        </div>
      ) : (
        actions.map((action, actionIndex) => (
          <div key={action.id} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Action #{actionIndex + 1}
              </div>
              <button
                type="button"
                onClick={() => onDelete(action.id)}
                className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Delete
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-center">
              <label className="text-[11px] text-[var(--muted-dim)]">Button label</label>
              <input
                type="text"
                value={action.label}
                onChange={(e) => onUpdate(action.id, { label: e.target.value })}
                className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder="e.g. Fix bug"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-[var(--muted-dim)]">Message</label>
              <textarea
                value={action.message}
                onChange={(e) => onUpdate(action.id, { message: e.target.value })}
                className="w-full min-h-[88px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder="Message sent when this button is clicked from a run row..."
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
