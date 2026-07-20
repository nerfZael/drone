import React from 'react';

export type ChatComposerContextItem = {
  id: string;
  label: string;
  meta?: string;
};

export type ChatComposerContextConfig = {
  label: string;
  items: ChatComposerContextItem[];
  emptyHint?: string;
  disabled?: boolean;
  onRemove: (id: string) => void;
};

export function ChatComposerContext({ config }: { config?: ChatComposerContextConfig }) {
  if (!config) return null;

  return (
    <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
      <div
        className="mb-1.5 min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {config.label}
      </div>
      {config.items.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
          {config.items.map((item) => (
            <div
              key={item.id}
              className="relative w-[190px] flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5"
            >
              <div className="min-w-0 truncate text-[10px] font-medium text-[var(--fg-secondary)]" title={item.label}>
                {item.label}
              </div>
              {item.meta ? (
                <div className="mt-1 truncate font-mono text-[9px] text-[var(--muted-dim)]" title={item.meta}>
                  {item.meta}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => config.onRemove(item.id)}
                disabled={config.disabled}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-raised)] text-[10px] font-bold text-[var(--muted)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-45"
                title={`Remove ${item.label}`}
                aria-label={`Remove ${item.label}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5 text-[10px] text-[var(--accent)]">
          {config.emptyHint ?? 'Drop items here to add them to this message.'}
        </div>
      )}
    </div>
  );
}
