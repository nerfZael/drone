import { requestJsonWithTimeout } from '../http';
import { WINDOW_LAYOUT_SLOTS } from '@drone/hub-model';
import React from 'react';
import { Dialog } from 'radix-ui';
import { QUICK_ACTION_ROWS, quickActionDisabledReason, type createQuickActionController } from './quick-action-menu';

export type QuickActionDialogProps = {
  controller: ReturnType<typeof createQuickActionController>;
  triggerLabel: string;
};

const KEY_CHIP = 'inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-1.5 font-mono text-sm font-semibold uppercase text-[var(--accent)]';

export function QuickActionDialog({ controller }: QuickActionDialogProps) {
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => null);
  React.useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    void requestJsonWithTimeout<{ presets: Record<string, unknown> }>('/api/window-layout-presets', undefined, 15_000).then(({ presets }) => {
      if (!cancelled) controller.setLabels(Object.fromEntries(WINDOW_LAYOUT_SLOTS.flatMap(slot => [
        [`loadLayout${slot}`, presets[slot] ? `Load slot ${slot}` : `Slot ${slot} · Empty`],
        [`saveLayout${slot}`, presets[slot] ? `Replace slot ${slot}` : `Save slot ${slot}`],
      ])));
    }).catch(() => { /* Selecting a slot reports request failures with a retryable error. */ });
    return () => { cancelled = true; };
  }, [controller, Boolean(snapshot)]);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const previousPathRef = React.useRef<typeof snapshot>(null);
  React.useLayoutEffect(() => {
    if (snapshot && previousPathRef.current) panelRef.current?.focus();
    previousPathRef.current = snapshot;
  }, [snapshot?.path]);
  if (!snapshot) return null;

  const current = snapshot.path[snapshot.path.length - 1];

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) controller.close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-[var(--scrim)]" />
        <Dialog.Content
          ref={panelRef}
          data-quick-action-menu="true"
          aria-modal="true"
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            panelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // An action may already have focused its composer. Never take that focus back.
            if (document.activeElement === document.body) previousFocusRef.current?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-[121] w-[calc(100%-2rem)] max-w-[48rem] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xlarge)] border border-[var(--border)] bg-[var(--panel-overlay)] p-5 shadow-[var(--edge-highlight),var(--shadow-dialog)] focus:outline-none"
        >
          <div className="mb-4 flex items-center gap-2">
            {current ? (
              <button
                type="button"
                onClick={controller.back}
                disabled={snapshot.busy}
                aria-label="Back"
                title="Back (Backspace)"
                className="-ml-1 flex h-7 w-7 items-center justify-center rounded text-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-strong)] focus-visible:outline focus-visible:outline-[var(--accent)]"
              >
                ‹
              </button>
            ) : null}
            <Dialog.Title className="text-base font-medium text-[var(--fg-strong)]">
              {current?.label ?? 'Actions'}
            </Dialog.Title>
            <button
              type="button"
              onClick={controller.close}
              disabled={snapshot.busy}
              aria-label="Close"
              className="ml-auto rounded px-2 py-1 font-mono text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-strong)] focus-visible:outline focus-visible:outline-[var(--accent)]"
            >
              Esc
            </button>
          </div>
          <div aria-live="polite" className="mb-2 text-sm text-[var(--muted)]">
            {snapshot.busy ? 'Working…' : snapshot.error ? <span role="alert">{snapshot.error}</span> : current?.label === 'Save preset' ? 'Choose a slot. Saving replaces its previous preset. Floating chats are excluded.' : current?.label === 'Organize windows' ? 'Choose a slot to load, Q to save, or E to close docked windows. Agent chat and floating chats stay open.' : null}
          </div>
          <div className="space-y-2">
            {QUICK_ACTION_ROWS.filter(row => [...row].some(key => snapshot.items.some(item => item.key === key))).map((row, rowIndex) => (
              <div key={row} className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', marginLeft: `${rowIndex * 2.5}%` }}>
                {[...row].map((key) => {
                  const item = snapshot.items.find((entry) => entry.key === key);
                  if (!item) return <div key={key} aria-hidden="true" />;
                  const reason = quickActionDisabledReason(item, snapshot.unavailable);
                  const label = (item.action && snapshot.labels[item.action]) || item.label;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={snapshot.busy || Boolean(reason)}
                      title={reason ? `${label}: ${reason}` : label}
                      aria-keyshortcuts={key.toUpperCase()}
                      onClick={() => controller.select(key)}
                      className="flex min-h-[5.5rem] flex-col justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-left text-[var(--fg-secondary)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-subtle)] hover:text-[var(--fg-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--border)] disabled:hover:bg-[var(--surface-soft)] disabled:hover:text-[var(--fg-secondary)]"
                    >
                      <span className="flex w-full items-center justify-between">
                        <kbd className={KEY_CHIP}>{key}</kbd>
                        {item.children ? <span aria-hidden="true" className="text-base text-[var(--muted)]">›</span> : null}
                      </span>
                      <span className="line-clamp-2 break-words text-sm font-medium leading-snug">{label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
