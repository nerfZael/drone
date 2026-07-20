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
          className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--display)' }}
        >
          {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
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
                className="flex-1 min-h-[92px] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder={placeholder}
              />
            ) : (
              <input
                type="text"
                value={item}
                onChange={(e) => onChange(index, e.target.value)}
                className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder={placeholder}
              />
            )}
            <button
              type="button"
              onClick={() => onDelete(index)}
              className={`px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)] ${multiline ? 'h-8 mt-1' : 'h-8'}`}
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

type PlaybookMessageListEditorProps = {
  messages: PlaybookDefinition['messages'];
  addDisabled?: boolean;
  onAdd: () => void;
  onUpdate: (messageId: string, patch: Partial<PlaybookDefinition['messages'][number]>) => void;
  onDelete: (messageId: string) => void;
};

export function PlaybookMessageListEditor({
  messages,
  addDisabled,
  onAdd,
  onUpdate,
  onDelete,
}: PlaybookMessageListEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="text-[11px] text-[var(--muted-dim)]">Run Messages</label>
          <div className="text-[10px] text-[var(--muted-dim)] mt-1">Messages are queued into the run chat in order.</div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--display)' }}
        >
          Add message
        </button>
      </div>
      {messages.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
          No run messages for this playbook.
        </div>
      ) : (
        messages.map((message, index) => (
          <div key={message.id} className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Message #{index + 1}
              </div>
              <button
                type="button"
                onClick={() => onDelete(message.id)}
                className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Delete
              </button>
            </div>
            <input
              type="text"
              value={message.name ?? ''}
              onChange={(e) => onUpdate(message.id, { name: e.target.value || null })}
              className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-3 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
              placeholder="Optional message name"
            />
            <textarea
              value={message.prompt}
              onChange={(e) => onUpdate(message.id, { prompt: e.target.value })}
              className="w-full min-h-[92px] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
              placeholder="Message queued into the run chat..."
            />
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
          className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--display)' }}
        >
          Add action
        </button>
      </div>
      {actions.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
          No follow-up buttons for this playbook.
        </div>
      ) : (
        actions.map((action, actionIndex) => (
          <div key={action.id} className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Action #{actionIndex + 1}
              </div>
              <button
                type="button"
                onClick={() => onDelete(action.id)}
                className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]"
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
                className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                placeholder="e.g. Fix bug"
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="text-[11px] text-[var(--muted-dim)]">Queued messages</label>
                  <div className="text-[10px] text-[var(--muted-dim)] mt-1">Sent in order when this action button is clicked from a run row.</div>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdate(action.id, { messages: [...action.messages, ''] })}
                  disabled={action.messages.length >= 20}
                  className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Add message
                </button>
              </div>
              {action.messages.length === 0 ? (
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
                  No queued messages for this action.
                </div>
              ) : (
                action.messages.map((message, messageIndex) => (
                  <div key={`${action.id}:${messageIndex}`} className="flex items-start gap-2">
                    <div className="text-[10px] text-[var(--muted-dim)] font-semibold w-5 text-right mt-2">{messageIndex + 1}</div>
                    <textarea
                      value={message}
                      onChange={(e) => {
                        const nextMessages = action.messages.slice();
                        nextMessages[messageIndex] = e.target.value;
                        onUpdate(action.id, { messages: nextMessages });
                      }}
                      className="flex-1 min-h-[88px] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
                      placeholder="Message sent when this action button is clicked from a run row..."
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const nextMessages = action.messages.filter((_, idx) => idx !== messageIndex);
                        onUpdate(action.id, { messages: nextMessages.length > 0 ? nextMessages : [''] });
                      }}
                      className="px-2 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)] h-8 mt-1"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
