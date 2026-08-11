import React from 'react';
import {
  agentRunFailurePresentation,
  type PromptQueueInterruptionResolution,
  type PromptQueueInterruptionState,
} from '@drone/assistant-chat';

import { stripAnsi } from '../../domain';
import { RelativeTimeText } from './RelativeTimeText';

export function AgentRunFailureNotice({
  error,
  at,
  hasSavedProgress = false,
  queueInterruptionState,
  onResolveInterruption,
  resolvingInterruption = false,
  interruptionError = null,
}: {
  error?: string | null;
  at?: string;
  hasSavedProgress?: boolean;
  queueInterruptionState?: PromptQueueInterruptionState;
  onResolveInterruption?: (resolution: PromptQueueInterruptionResolution) => Promise<void> | void;
  resolvingInterruption?: boolean;
  interruptionError?: string | null;
}) {
  const failure = agentRunFailurePresentation(stripAnsi(error || 'Agent run failed'));
  const recoverable = failure.recoverable;

  return (
    <div
      role={recoverable ? 'status' : 'alert'}
      aria-label={`${failure.title}. ${failure.summary}`}
      data-agent-run-failure={failure.kind}
      className={`my-2 max-w-[var(--chat-prose-max)] rounded-[var(--radius-medium)] border px-3 py-2.5 ${
        recoverable
          ? 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)]'
          : 'border-[var(--red-border)] bg-[var(--red-subtle)]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border bg-[var(--panel-overlay)] ${
            recoverable
              ? 'border-[var(--yellow-border)] text-[var(--yellow)]'
              : 'border-[var(--red-border)] text-[var(--red)]'
          }`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 6.25a7.8 7.8 0 0 1 11 0M4.65 8.45a4.75 4.75 0 0 1 6.7 0M6.85 10.65a1.65 1.65 0 0 1 2.3 0"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
            <path d="m3 3 10 10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide ${
              recoverable ? 'text-[var(--yellow)]' : 'text-[var(--red)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {failure.title}
          </span>
          <span className="mt-0.5 block text-[var(--text-10-5)] leading-[1.45] text-[var(--muted)]">
            {failure.summary}{' '}
            {recoverable ? (
              queueInterruptionState === 'blocked' ? (
                <>
                  {' '}
                  Queued and steering prompts are paused so they can’t run out of turn. Send a
                  message when you’re ready to continue.
                </>
              ) : queueInterruptionState === 'continuing' ? (
                <> Your follow-up is queued. Later prompts remain paused until it finishes.</>
              ) : queueInterruptionState === 'continued' ? (
                <> Your follow-up finished. Queued prompts can run normally.</>
              ) : queueInterruptionState === 'skipped' ? (
                <> This response was skipped. Queued prompts can run normally.</>
              ) : hasSavedProgress ? (
                <>
                  {' '}
                  Completed steps and any file changes are preserved. Send a follow-up to continue
                  when you’re connected.
                </>
              ) : (
                <> Send a follow-up to try again when you’re connected.</>
              )
            ) : null}
          </span>
        </span>
        {at ? (
          <RelativeTimeText
            at={at}
            className="flex-none font-mono text-[var(--text-9)] text-[var(--muted-dim)]"
            title={new Date(at).toLocaleString()}
          />
        ) : null}
      </div>
      {recoverable && queueInterruptionState === 'blocked' && onResolveInterruption ? (
        <div className="ml-9 mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={resolvingInterruption}
            onClick={() => void onResolveInterruption('skip')}
            className="inline-flex min-h-7 items-center rounded-[var(--radius-small)] border border-[var(--border)] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)] hover:bg-[var(--panel-overlay)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            title="Do not continue this response; allow later queued prompts to run"
          >
            {resolvingInterruption ? 'Working…' : 'Skip and run queued'}
          </button>
        </div>
      ) : null}
      {interruptionError ? (
        <div role="alert" className="ml-9 mt-2 text-[var(--text-10)] text-[var(--red)]">
          {stripAnsi(interruptionError)}
        </div>
      ) : null}
      {recoverable ? (
        <details className="ml-9 mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
          <summary className="w-fit cursor-pointer select-none hover:text-[var(--muted)]">
            Technical details
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--panel-overlay)] px-2 py-1.5 font-mono text-[var(--text-9)] leading-relaxed">
            {failure.technicalMessage}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
