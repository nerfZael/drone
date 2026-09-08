import React from 'react';
import { ChatComposerEditor } from '../chat/ChatComposerEditor';
import { requestJson } from '../http';
import { useCompanionSettings } from './use-companion-settings';

export function CompanionPromptEditor({ onClose }: { onClose(): void }) {
  const { data, draft, setDraft, loading, saving, error, dirty, save, load } = useCompanionSettings(requestJson);
  const [notice, setNotice] = React.useState(false);
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => { panelRef.current?.focus(); }, []);
  const tooLong = Boolean(data && draft && draft.systemPrompt.length > data.maxSystemPromptChars);
  const dismiss = () => {
    if (saving || dirty) {
      setNotice(true);
      panelRef.current?.focus();
    } else onClose();
  };
  const saveAndClose = async () => {
    if (!draft || tooLong || saving) return;
    if (!dirty || await save()) onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[1]" onClick={dismiss} aria-hidden="true" />
      <section
        ref={panelRef}
        id="companion-prompt-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Companion system prompt"
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
          if (event.key === 'Tab') {
            const buttons = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]');
            const first = buttons?.[0];
            const last = buttons?.[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
              event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first?.focus();
            }
          }
        }}
        className="relative z-10 flex max-h-[60dvh] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl"
      >
        <header className="border-b border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--fg)]">Companion system prompt</header>
        <div className="min-h-0 overflow-y-auto">
          {loading ? <p className="p-3 text-xs text-[var(--muted)]">Loading system prompt…</p> : draft ? (
            <ChatComposerEditor
              value={draft.systemPrompt}
              disabled={saving}
              autoFocus
              initialSelection={{ start: 0, end: 0 }}
              onChange={(systemPrompt) => { setDraft({ ...draft, systemPrompt }); setNotice(false); }}
              onSelectionChange={() => {}}
              onSendQueued={() => void saveAndClose()}
              ariaLabel="Edit Companion system prompt"
              maxHeight="40dvh"
            />
          ) : null}
        </div>
        {error ? <p role="alert" className="px-3 py-2 text-xs text-[var(--red)]">{error}</p> : null}
        {tooLong ? <p role="alert" className="px-3 text-xs text-[var(--red)]">System prompt exceeds {data?.maxSystemPromptChars} characters.</p> : null}
        <footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs">
          <span role="status" className="mr-auto text-[var(--muted)]">{saving ? 'Saving…' : notice ? 'Save or discard your changes to close.' : dirty ? 'Unsaved changes' : 'No changes'}</span>
          {!loading && !draft ? <button type="button" onClick={() => void load()}>Retry</button> : null}
          <button type="button" disabled={saving} onClick={onClose} className="rounded border border-[var(--border-subtle)] px-3 py-1.5 text-[var(--fg)] disabled:opacity-40">Discard</button>
          <button type="button" disabled={loading || saving || !draft || tooLong} onClick={() => void saveAndClose()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-[var(--accent-contrast)] disabled:opacity-40">Save</button>
        </footer>
      </section>
    </>
  );
}
