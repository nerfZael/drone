import * as React from 'react';
import { cn } from '../ui/cn.js';

export type AssistantSystemPromptMode = 'thread' | 'global';

type AssistantSystemPromptModalProps = {
  open: boolean;
  threadTitle: string;
  mode: AssistantSystemPromptMode;
  onModeChange: (mode: AssistantSystemPromptMode) => void;
  threadDraft: string;
  onThreadDraftChange: (value: string) => void;
  voiceDraft: string;
  onVoiceDraftChange: (value: string) => void;
  inheritedPrompt: string;
  maxChars: number;
  saving: boolean;
  promoteSaving: boolean;
  error: string | null;
  notice: string | null;
  onClose: () => void;
  onSaveThread: () => void;
  onSaveGlobal: () => void;
  onPromoteThread: () => void;
  onUseInherited: () => void;
  onResetGlobal: () => void;
};

function charsLabel(value: string, maxChars: number): string {
  return `${value.length.toLocaleString()} / ${maxChars.toLocaleString()}`;
}

export function AssistantSystemPromptModal({
  open,
  threadTitle,
  mode,
  onModeChange,
  threadDraft,
  onThreadDraftChange,
  voiceDraft,
  onVoiceDraftChange,
  inheritedPrompt,
  maxChars,
  saving,
  promoteSaving,
  error,
  notice,
  onClose,
  onSaveThread,
  onSaveGlobal,
  onPromoteThread,
  onUseInherited,
  onResetGlobal,
}: AssistantSystemPromptModalProps) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  const busy = saving || promoteSaving;
  const tabClass = (active: boolean) =>
    cn(
      'h-7 border-0 border-r border-[var(--border-subtle)] bg-transparent px-3 font-display text-[10px] font-bold uppercase text-[var(--muted)] last:border-r-0',
      active && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]',
    );
  const secondaryButtonClass = 'h-[30px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold text-[var(--muted)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-50';
  const primaryButtonClass = 'h-[30px] rounded border border-[rgba(74,222,128,.34)] bg-[rgba(74,222,128,.10)] px-3 text-[10px] font-semibold text-[var(--green)] hover:bg-[rgba(74,222,128,.14)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(3,7,12,.66)] p-6 max-[620px]:p-2" role="presentation" onMouseDown={onClose}>
      <section
        className="grid max-h-[min(760px,calc(100vh-48px))] w-[min(920px,calc(100vw-48px))] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-[0_24px_80px_rgba(0,0,0,.42)] max-[620px]:max-h-[calc(100dvh-1rem)] max-[620px]:w-[calc(100vw-1rem)]"
        role="dialog"
        aria-modal="true"
        aria-label="Assistant system prompts"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-3.5 max-[620px]:p-3">
          <div>
            <span className="font-display text-[10px] font-bold uppercase text-[var(--muted-dim)]">Assistant</span>
            <h2 className="m-0 mt-0.5 text-base font-bold leading-tight text-[var(--fg)]">System Prompt</h2>
            <small className="mt-1 block text-[11px] text-[var(--muted)]">{threadTitle || 'Current thread'}</small>
          </div>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-0 text-[var(--muted)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg-secondary)]"
            onClick={onClose}
            aria-label="Close system prompt editor"
          >
            <svg className="h-3.5 w-3.5 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="mx-3.5 mt-2.5 inline-flex w-max max-w-[calc(100%-1.75rem)] overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]" role="tablist" aria-label="System prompt scope">
          <button type="button" className={tabClass(mode === 'thread')} onClick={() => onModeChange('thread')}>
            Thread
          </button>
          <button type="button" className={tabClass(mode === 'global')} onClick={() => onModeChange('global')}>
            Defaults
          </button>
        </div>

        {error ? <div className="mx-3.5 mt-2.5 rounded border border-[rgba(248,113,113,.28)] bg-[rgba(248,113,113,.08)] p-2 text-xs text-[#fecaca]">{error}</div> : null}
        {notice ? <div className="mx-3.5 mt-2.5 rounded border border-[rgba(74,222,128,.24)] bg-[rgba(74,222,128,.08)] p-2 text-xs text-[#bbf7d0]">{notice}</div> : null}

        {mode === 'thread' ? (
          <div className="grid min-h-0 gap-2.5 overflow-auto p-3.5 max-[620px]:p-3">
            <div className="flex flex-wrap items-end justify-between gap-3.5">
              <div>
                <strong className="text-[13px] text-[var(--fg)]">Thread prompt</strong>
                <small className="block text-[11px] text-[var(--muted)]">Overrides the default for this thread only.</small>
              </div>
              <span className="text-[11px] text-[var(--muted)]">{charsLabel(threadDraft, maxChars)}</span>
            </div>
            <textarea
              autoFocus
              value={threadDraft}
              maxLength={maxChars}
              onChange={(event) => onThreadDraftChange(event.currentTarget.value)}
              placeholder={inheritedPrompt}
              className="min-h-[260px] max-h-[44vh] resize-y rounded-md border border-[var(--border)] bg-[rgba(255,255,255,.035)] p-2 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none"
            />
            <div className="grid grid-cols-2 gap-2 max-[880px]:grid-cols-1">
              <div>
                <span className="font-display text-[9px] font-bold uppercase text-[var(--muted-dim)]">Inherited default</span>
                <pre className="mt-1 max-h-40 min-h-20 overflow-auto whitespace-pre-wrap rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] p-2 text-[11px] leading-normal text-[var(--fg-secondary)]">{inheritedPrompt}</pre>
              </div>
              <div>
                <span className="font-display text-[9px] font-bold uppercase text-[var(--muted-dim)]">Thread override</span>
                <pre className="mt-1 max-h-40 min-h-20 overflow-auto whitespace-pre-wrap rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] p-2 text-[11px] leading-normal text-[var(--fg-secondary)]">{threadDraft.trim() || inheritedPrompt}</pre>
              </div>
            </div>
            <footer className="flex flex-wrap justify-end gap-1.5">
              <button type="button" className={secondaryButtonClass} onClick={onUseInherited} disabled={busy}>
                Use Default
              </button>
              <button type="button" className={secondaryButtonClass} onClick={onPromoteThread} disabled={busy || !threadDraft.trim()}>
                {promoteSaving ? 'Saving...' : 'Make Default'}
              </button>
              <button type="button" className={primaryButtonClass} onClick={onSaveThread} disabled={busy}>
                {saving ? 'Saving...' : 'Save Thread Prompt'}
              </button>
            </footer>
          </div>
        ) : (
          <div className="grid min-h-0 gap-2.5 overflow-auto p-3.5 max-[620px]:p-3">
            <div className="flex flex-wrap items-end justify-between gap-3.5">
              <div>
                <strong className="text-[13px] text-[var(--fg)]">Default prompt</strong>
                <small className="block text-[11px] text-[var(--muted)]">Used by threads that do not have a thread override.</small>
              </div>
              <span className="text-[11px] text-[var(--muted)]">{charsLabel(voiceDraft, maxChars)}</span>
            </div>
            <textarea
              autoFocus
              value={voiceDraft}
              maxLength={maxChars}
              onChange={(event) => onVoiceDraftChange(event.currentTarget.value)}
              className="min-h-[260px] max-h-[44vh] resize-y rounded-md border border-[var(--border)] bg-[rgba(255,255,255,.035)] p-2 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none"
            />
            <footer className="flex flex-wrap justify-end gap-1.5">
              <button type="button" className={secondaryButtonClass} onClick={onResetGlobal} disabled={busy}>
                Reset Draft
              </button>
              <button type="button" className={primaryButtonClass} onClick={onSaveGlobal} disabled={busy || !voiceDraft.trim()}>
                {saving ? 'Saving...' : 'Save Default'}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
