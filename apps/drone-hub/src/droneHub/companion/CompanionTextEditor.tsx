import React from 'react';
import { ChatComposerEditor } from '../chat/ChatComposerEditor';

export function CompanionTextEditor({ id, title, description, content, maxChars, loading, saving, error, dirty, conflict, onChange, save, load, onClose }: {
  id: string;
  title: string;
  description?: string;
  content: string | undefined;
  maxChars: number;
  loading: boolean;
  saving: boolean;
  error: string;
  dirty: boolean;
  conflict?: boolean;
  onChange(content: string): void;
  save(): Promise<boolean>;
  load(): Promise<void>;
  onClose(): void;
}) {
  const [notice, setNotice] = React.useState(false);
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => { panelRef.current?.focus(); }, []);
  const tooLong = content !== undefined && content.length > maxChars;
  const dismiss = () => {
    if (saving || dirty) {
      setNotice(true);
      panelRef.current?.focus();
    } else onClose();
  };
  const saveAndClose = async () => {
    if (content === undefined || tooLong || saving || loading || conflict) return;
    if (!dirty || await save()) onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[1]" onClick={dismiss} aria-hidden="true" />
      <section
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
        <header className="border-b border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--fg)]">{title}</header>
        {description ? <p className="px-3 pt-2 text-xs text-[var(--muted)]">{description}</p> : null}
        <div className="min-h-0 overflow-y-auto">
          {loading ? <p className="p-3 text-xs text-[var(--muted)]">Loading…</p> : content !== undefined ? (
            <ChatComposerEditor
              value={content}
              disabled={saving || loading}
              autoFocus
              initialSelection={{ start: 0, end: 0 }}
              onChange={(text) => { onChange(text); setNotice(false); }}
              onSelectionChange={() => {}}
              onSendQueued={() => void saveAndClose()}
              ariaLabel={`Edit ${title}`}
              maxHeight="40dvh"
            />
          ) : null}
        </div>
        {error ? <p role="alert" className="px-3 py-2 text-xs text-[var(--red)]">{error}</p> : null}
        {tooLong ? <p role="alert" className="px-3 text-xs text-[var(--red)]">{title} exceeds {maxChars} characters.</p> : null}
        <footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs">
          <span role="status" className="mr-auto text-[var(--muted)]">{saving ? 'Saving…' : notice ? 'Save or discard your changes to close.' : dirty ? 'Unsaved changes' : 'No changes'}</span>
          {!loading && content === undefined ? <button type="button" onClick={() => void load()}>Retry</button> : null}
          {conflict ? <button type="button" disabled={saving || loading} onClick={() => void load()}>Discard draft and load latest</button> : null}
          <button type="button" disabled={saving || loading} onClick={onClose} className="rounded border border-[var(--border-subtle)] px-3 py-1.5 text-[var(--fg)] disabled:opacity-40">Discard</button>
          <button type="button" disabled={loading || saving || content === undefined || tooLong || conflict} onClick={() => void saveAndClose()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-[var(--accent-contrast)] disabled:opacity-40">Save</button>
        </footer>
      </section>
    </>
  );
}
