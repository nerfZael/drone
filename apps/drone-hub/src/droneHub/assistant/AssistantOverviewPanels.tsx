import React from 'react';

import { MarkdownMessage } from '../chat/MarkdownMessage';
import { IconList, IconPencil, IconSpinner } from '../app/icons';
import { formatUpdatedAt } from './assistant-formatters';
import type {
  AssistantOverviewPromptSettings,
  AssistantThreadOverviewResult,
} from './assistant-types';

export function AssistantOverviewPromptModal({
  settings,
  draft,
  loading,
  saving,
  error,
  notice,
  onDraftChange,
  onUseDefault,
  onClose,
  onSave,
}: {
  settings: AssistantOverviewPromptSettings | null;
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onDraftChange: (value: string) => void;
  onUseDefault: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const currentPrompt = settings?.assistantOverviewPrompt.prompt ?? '';
  const maxChars = settings?.assistantOverviewPrompt.maxPromptChars ?? 20_000;
  const dirty = draft !== currentPrompt;
  const saveDisabled = loading || saving || !dirty || !draft.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-4">
      <div className="flex max-h-[min(720px,calc(100vh-2rem))] w-[min(820px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.55)]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <div
              className="text-[13px] font-semibold text-[var(--fg)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Assistant overview prompt
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
              Saved changes apply globally to assistant overview generation.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <div className="mb-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-3 rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[11px] text-[#34d399]">
              {notice}
            </div>
          ) : null}
          <label className="flex min-h-0 flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">
              Prompt
            </span>
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              disabled={loading || saving}
              maxLength={maxChars}
              rows={18}
              className="min-h-[320px] resize-y rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
              placeholder={
                loading ? 'Loading overview prompt...' : 'Enter the assistant overview prompt'
              }
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
            <span>
              Source:{' '}
              {settings?.assistantOverviewPrompt.promptSource === 'settings'
                ? 'settings'
                : 'default'}
            </span>
            <span>
              {draft.length.toLocaleString()} / {maxChars.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onUseDefault}
            disabled={loading || saving}
            className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ fontFamily: 'var(--display)' }}
          >
            Use default
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled}
            className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide ${saveDisabled ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-45' : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'}`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {saving ? 'Saving...' : 'Save overview prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssistantOverviewOverlay({
  overview,
  loading,
  error,
  autoEnabled,
  canRerun,
  onClose,
  onRerun,
  onEditPrompt,
}: {
  overview: AssistantThreadOverviewResult | null;
  loading: boolean;
  error: string | null;
  autoEnabled: boolean;
  canRerun: boolean;
  onClose: () => void;
  onRerun: () => void;
  onEditPrompt: () => void;
}) {
  const generatedAt = overview?.generatedAt ? formatUpdatedAt(overview.generatedAt) : '';
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20">
      <section className="pointer-events-auto max-h-[min(440px,calc(100vh-260px))] overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_50px_rgba(0,0,0,.45)]">
        <div className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <IconList className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" />
              <div
                className="truncate text-[12px] font-semibold text-[var(--fg)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Thread overview
              </div>
              {loading ? (
                <IconSpinner className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-[var(--muted-dim)]">
              {generatedAt
                ? `${overview?.cached ? 'Cached' : overview?.inputReused ? 'Rerun' : 'Generated'} ${generatedAt}`
                : autoEnabled
                  ? 'Auto overview is on'
                  : 'No overview generated yet'}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onRerun}
              disabled={!canRerun || loading}
              className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ fontFamily: 'var(--display)' }}
              title="Rerun the overview using the same captured chat input"
            >
              Rerun
            </button>
            <button
              type="button"
              onClick={onEditPrompt}
              className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
              title="Edit overview prompt"
              aria-label="Edit overview prompt"
            >
              <IconPencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Minimize
            </button>
          </div>
        </div>
        <div className="max-h-[calc(min(440px,calc(100vh-260px))-42px)] overflow-y-auto px-3 py-2">
          {error ? (
            <div className="rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">
              {error}
            </div>
          ) : overview?.markdown ? (
            <MarkdownMessage
              text={overview.markdown}
              className="text-[12px] leading-relaxed text-[var(--fg-secondary)]"
            />
          ) : loading ? (
            <div className="py-8 text-center text-[12px] text-[var(--muted)]">
              Generating overview...
            </div>
          ) : (
            <div className="py-8 text-center text-[12px] text-[var(--muted)]">
              No overview has been generated for this thread yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
