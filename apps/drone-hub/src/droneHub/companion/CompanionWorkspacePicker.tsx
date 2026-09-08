import React from 'react';
import { AssistantWorkspacePicker } from '../assistant/AssistantWorkspacePicker';
import { requestJson } from '../http';

export function CompanionWorkspacePicker({ onClose }: { onClose(): void }) {
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(false);
  const panel = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    panel.current?.focus();
  }, []);
  const dismiss = () => {
    if (busy) {
      setNotice(true);
      return;
    }
    onClose();
  };
  return (
    <>
      <div className="fixed inset-0 z-[1]" aria-hidden="true" onClick={dismiss} />
      <section
        ref={panel}
        id="companion-workspace-picker"
        role="dialog"
        aria-modal="true"
        data-app-shortcuts-disabled="true"
        aria-label="Companion workspaces"
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
          }
          if (event.key === 'Tab') {
            const controls = panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
            );
            const first = controls?.[0],
              last = controls?.[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === panel.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
        className="relative z-10 flex max-h-[75dvh] min-[600px]:max-h-[60dvh] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl"
      >
        <header className="flex items-center border-b border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--fg)]">
          <span className="flex-1">Companion workspaces</span>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            aria-label="Close workspace picker"
            className="h-11 w-11 rounded min-[600px]:h-7 min-[600px]:w-7 hover:bg-[var(--hover)] disabled:opacity-40"
          >
            ×
          </button>
        </header>
        <p className="px-3 py-2 text-xs text-[var(--muted)]">
          Selected workspaces allow Read and transfers from them. Write allows edits and transfers
          to them. Allowed operations run without approval.
        </p>
        <div className="min-h-0 overflow-y-auto">
          <AssistantWorkspacePicker
            requestJson={requestJson}
            threadId="companion"
            catalogEndpoint="/api/companion/workspaces"
            readRequired
            onBusyChange={setBusy}
          />
        </div>
        <footer className="border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--muted)]">
          Execute allows commands, which may modify files and access resources available to the
          runtime. Proposal approvals are unchanged.
          {notice && busy ? (
            <p role="status" className="mt-1">
              Saving workspace access…
            </p>
          ) : null}
        </footer>
      </section>
    </>
  );
}
