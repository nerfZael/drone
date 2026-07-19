import React from 'react';

export type ChatComposerMenuAction = {
  id: string;
  label: string;
  title?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function ChatComposerMenu({
  actions,
  label = 'Chat options',
}: {
  actions: ChatComposerMenuAction[];
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
          open
            ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        Chat
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12" cy="8" r="1.25" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-40 mb-2 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] py-1 shadow-[0_18px_55px_rgba(0,0,0,.48)]"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              title={action.title}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                action.active
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
              }`}
            >
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]">
                {action.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {action.badge ? <span className="flex-shrink-0 text-[9px] text-[var(--muted-dim)]">{action.badge}</span> : null}
              {action.active ? <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent)]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
