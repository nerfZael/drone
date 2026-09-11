import React from 'react';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import { AssistantQuestionCard } from '../assistant/AssistantQuestionCard';
import { IconChevronDown } from '../app/icons';
import {
  INITIAL_QUESTION_DOCK_STATE,
  closeQuestionDock,
  openQuestionDock,
  syncQuestionDock,
} from './floating-question-dock-state';

function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="m4 4 8 8m0-8-8 8" />
    </svg>
  );
}

/**
 * Questions from the agent in a chat too small to show them inline: a one-line
 * row at the bottom that expands over the whole chat body, closes when the
 * questionnaire is answered, and stays closed once the user closes it.
 *
 * Mount it as a flex-column child right above the composer, inside a
 * positioned container: the expanded panel covers that container.
 */
export function FloatingQuestionDock({
  requests,
  busyId,
  error,
  onSubmit,
  onSkip,
}: {
  requests: readonly ChatQuestionRequest[];
  busyId: string | null;
  error?: string | null;
  onSubmit(request: ChatQuestionRequest, input: { responses: ChatQuestionResponse[]; notes?: string }): void;
  onSkip(request: ChatQuestionRequest, notes?: string): void;
}) {
  const [state, setState] = React.useState(INITIAL_QUESTION_DOCK_STATE);
  const pendingIds = React.useMemo(() => requests.map((request) => request.id), [requests]);
  // Reconcile during render so a fresh questionnaire opens without a blank frame.
  const synced = syncQuestionDock(state, pendingIds);
  if (synced !== state) setState(synced);
  const expanded = synced.expanded;
  const questionCount = requests.reduce((count, request) => count + request.questions.length, 0);
  if (requests.length === 0) return null;
  const label = questionCount === 1
    ? 'The agent has a question'
    : `The agent has ${questionCount} questions`;

  if (!expanded) {
    // Open on pointer-down: in an unfocused floating window the first press
    // also reveals the composer, which shifts this row before the click lands.
    const open = () => setState((current) => openQuestionDock(current));
    return (
      <button
        type="button"
        data-floating-question-dock="collapsed"
        aria-expanded={false}
        onPointerDown={(event) => {
          if (event.button === 0) open();
        }}
        onClick={open}
        className="flex h-8 w-full shrink-0 items-center gap-2 border-t border-[var(--accent-border)] bg-[var(--accent-subtle)] px-3 text-left text-11 font-[var(--weight-semibold)] text-[var(--accent)] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current shadow-[0_0_6px_currentColor]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-10 font-[var(--weight-regular)] text-[var(--accent)]/80">Answer</span>
        <IconChevronDown className="h-3.5 w-3.5 shrink-0 rotate-180" />
      </button>
    );
  }

  // Expanded, the questions are the whole window: no title row, just a close
  // control in the corner. The first question title keeps clear of it.
  // The body must scroll itself; the compact-window stylesheet makes the
  // shared activity scrollbar class overflow visibly, so it is not used here.
  return (
    <section
      data-floating-question-dock="expanded"
      role="region"
      aria-label="Questions from the agent"
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[var(--chat-background)]"
    >
      <button
        type="button"
        aria-label="Close questions"
        title="Close questions and return to the chat"
        onClick={() => setState((current) => closeQuestionDock(current))}
        className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] bg-[var(--chat-background)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-3 pt-1.5 [&>*:first-child_[data-question-title]]:pr-6">
        {requests.map((request) => (
          <AssistantQuestionCard
            key={request.id}
            request={request}
            busy={busyId === request.id}
            error={error}
            frameless
            onSubmit={(input) => onSubmit(request, input)}
            onSkip={(notes) => onSkip(request, notes)}
          />
        ))}
      </div>
    </section>
  );
}
