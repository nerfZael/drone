import React from 'react';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import { IconChevronLeft, IconChevronRight } from '../app/icons';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import {
  setAssistantQuestionViewMode,
  useAssistantQuestionViewMode,
} from './assistant-question-view-mode';

type DraftResponse =
  | { outcome: 'choice'; choiceId: string }
  | { outcome: 'custom'; text: string }
  | { outcome: 'skipped' };

function optionLetter(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode('A'.charCodeAt(0) + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function initialResponses(request: ChatQuestionRequest): Record<string, DraftResponse | undefined> {
  return Object.fromEntries(
    request.questions.map((question) => {
      const recommended = question.choices.find((choice) => choice.recommended);
      return [
        question.id,
        recommended
          ? ({ outcome: 'choice', choiceId: recommended.id } satisfies DraftResponse)
          : undefined,
      ];
    }),
  );
}

export function AssistantQuestionCard({
  request,
  busy,
  disabled = false,
  error,
  onSubmit,
  onSkip,
}: {
  request: ChatQuestionRequest;
  busy: boolean;
  disabled?: boolean;
  error?: string | null;
  onSubmit(input: { responses: ChatQuestionResponse[]; notes?: string }): void;
  onSkip(notes?: string): void;
}) {
  const [responses, setResponses] = React.useState(() => initialResponses(request));
  const [notes, setNotes] = React.useState('');
  const [activeQuestionIndex, setActiveQuestionIndex] = React.useState(0);
  const viewMode = useAssistantQuestionViewMode();
  const singleQuestion = viewMode === 'single';
  const locked = busy || disabled;
  const questionCount = request.questions.length;
  const visibleQuestions = singleQuestion
    ? request.questions.slice(activeQuestionIndex, activeQuestionIndex + 1)
    : request.questions;
  const goToQuestion = (index: number) => {
    setActiveQuestionIndex(Math.max(0, Math.min(questionCount - 1, index)));
  };
  const advanceQuestion = () => {
    if (!singleQuestion || activeQuestionIndex >= questionCount - 1) return;
    setActiveQuestionIndex((current) => Math.min(questionCount - 1, current + 1));
  };
  const complete = request.questions.every((question) => {
    const response = responses[question.id];
    return response != null && (response.outcome !== 'custom' || response.text.trim().length > 0);
  });
  const submit = () => {
    if (!complete || locked) return;
    onSubmit({
      responses: request.questions.map((question): ChatQuestionResponse => {
        const response = responses[question.id]!;
        if (response.outcome === 'skipped') return { questionId: question.id, outcome: 'skipped' };
        if (response.outcome === 'custom') {
          return { questionId: question.id, outcome: 'custom', text: response.text.trim() };
        }
        const choice = question.choices.find((candidate) => candidate.id === response.choiceId)!;
        return {
          questionId: question.id,
          outcome: 'choice',
          choiceId: choice.id,
          label: choice.label,
        };
      }),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  return (
    <section
      className="relative min-w-0 max-w-[var(--chat-interactive-max)] rounded-[var(--radius-large)] border border-[var(--chat-card-border)] bg-[var(--chat-card-bg)] px-3 py-3 text-[var(--fg-secondary)]"
      role="region"
      aria-label="Questions from the agent"
      aria-busy={busy || undefined}
      data-assistant-question-card="true"
    >
      <div className="space-y-3">
        {visibleQuestions.map((question) => {
          const questionIndex = request.questions.indexOf(question);
          const response = responses[question.id];
          const titleId = `${request.id}-${question.id}-title`;
          return (
            <fieldset
              key={question.id}
              disabled={locked}
              aria-labelledby={titleId}
              className="min-w-0 space-y-2"
            >
              <legend className="sr-only">{question.question}</legend>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-[min(100%,28rem)] flex-1 flex-wrap items-center gap-2">
                  <div
                    id={titleId}
                    className="min-w-0 text-[var(--chat-question-size)] font-[var(--weight-strong)] leading-snug text-[var(--fg-strong)]"
                  >
                    {singleQuestion
                      ? question.question
                      : `${questionIndex + 1}. ${question.question}`}
                  </div>
                  <span className="shrink-0 rounded bg-[var(--surface-strong)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
                    Importance {question.importance}/100
                  </span>
                </div>
                {singleQuestion || questionIndex === 0 ? (
                  <div className="flex shrink-0 items-center gap-1 text-[var(--text-10)] text-[var(--fg-secondary)]">
                    {singleQuestion ? (
                      <>
                        <button
                          type="button"
                          disabled={locked || activeQuestionIndex === 0}
                          onClick={() => goToQuestion(activeQuestionIndex - 1)}
                          aria-label="Previous question"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)] disabled:opacity-30"
                        >
                          <IconChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-10 text-center tabular-nums">
                          {activeQuestionIndex + 1} of {questionCount}
                        </span>
                        <button
                          type="button"
                          disabled={locked || activeQuestionIndex >= questionCount - 1}
                          onClick={() => goToQuestion(activeQuestionIndex + 1)}
                          aria-label="Next question"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)] disabled:opacity-30"
                        >
                          <IconChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={singleQuestion}
                      onClick={() => setAssistantQuestionViewMode(singleQuestion ? 'all' : 'single')}
                      className="ml-1 shrink-0 rounded px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)]"
                    >
                      {singleQuestion ? 'Show all' : 'One at a time'}
                    </button>
                  </div>
                ) : null}
              </div>
              {question.detailedExplanation ? (
                <MarkdownMessage
                  text={question.detailedExplanation}
                  className="!text-[var(--text-11)] !leading-relaxed text-[var(--fg-secondary)]"
                />
              ) : null}
              <div className={`${singleQuestion ? 'space-y-0' : 'space-y-1.5'} pt-0.5`}>
                {question.choices.map((choice, choiceIndex) => {
                  const selected =
                    response?.outcome === 'choice' && response.choiceId === choice.id;
                  return (
                    <label
                      key={choice.id}
                      className={`flex cursor-pointer items-start gap-2.5 px-2.5 py-2 transition-colors ${
                        singleQuestion
                          ? selected
                            ? 'rounded-[var(--radius-medium)] border border-transparent bg-[var(--chat-card-selected)]'
                            : 'rounded-none border-0 border-b border-[var(--border-subtle)] bg-transparent hover:bg-[var(--surface-strong)]'
                          : selected
                            ? 'rounded-[var(--radius-medium)] border border-[var(--accent)] bg-[var(--chat-card-selected)]'
                            : 'rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--accent-muted)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${request.id}:${question.id}`}
                        checked={selected}
                        onChange={() => {}}
                        onClick={() => {
                          setResponses((current) => ({
                            ...current,
                            [question.id]: { outcome: 'choice', choiceId: choice.id },
                          }));
                          advanceQuestion();
                        }}
                        className="sr-only"
                      />
                      <span
                        className={`inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--text-10)] font-[var(--weight-semibold)] ${
                          selected
                            ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                            : 'bg-[var(--surface-strong)] text-[var(--fg-secondary)]'
                        }`}
                      >
                        {optionLetter(choiceIndex)}
                      </span>
                      <span className="min-w-0 flex-1 text-[var(--text-12)]">
                        <span className="font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                          {choice.label}
                        </span>
                        {choice.recommended ? (
                          <span className="ml-2 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-8)] font-[var(--weight-bold)] uppercase text-[var(--accent)]">
                            Recommended
                          </span>
                        ) : null}
                        {choice.description ? (
                          <span className="mt-0.5 block text-[var(--text-11)] leading-snug text-[var(--fg-secondary)]">
                            {choice.description}
                          </span>
                        ) : null}
                      </span>
                      {singleQuestion && selected ? (
                        <IconChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                      ) : null}
                    </label>
                  );
                })}
                <label
                  className={`block px-2.5 py-2 transition-colors ${
                    singleQuestion
                      ? response?.outcome === 'custom'
                        ? 'rounded-[var(--radius-medium)] border border-transparent bg-[var(--chat-card-selected)]'
                        : 'rounded-none border-0 border-b border-[var(--border-subtle)] bg-transparent hover:bg-[var(--surface-strong)]'
                      : response?.outcome === 'custom'
                        ? 'rounded-[var(--radius-medium)] border border-[var(--accent)] bg-[var(--chat-card-selected)]'
                        : 'rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--accent-muted)]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name={`${request.id}:${question.id}`}
                      checked={response?.outcome === 'custom'}
                      onChange={() =>
                        setResponses((current) => ({
                          ...current,
                          [question.id]: { outcome: 'custom', text: '' },
                        }))
                      }
                      className="sr-only"
                    />
                    <span
                      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-medium)] text-[var(--text-10)] font-[var(--weight-semibold)] ${
                        response?.outcome === 'custom'
                          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                          : 'bg-[var(--surface-strong)] text-[var(--fg-secondary)]'
                      }`}
                    >
                      {optionLetter(question.choices.length)}
                    </span>
                    <span className="text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                      Something else
                    </span>
                  </span>
                  {response?.outcome === 'custom' ? (
                    <textarea
                      autoFocus
                      maxLength={4_000}
                      value={response.text}
                      onChange={(event) =>
                        setResponses((current) => ({
                          ...current,
                          [question.id]: { outcome: 'custom', text: event.target.value },
                        }))
                      }
                      rows={2}
                      placeholder="Type your answer"
                      className="mt-2 w-full resize-y rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[var(--text-11)] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                    />
                  ) : null}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResponses((current) => ({
                      ...current,
                      [question.id]: { outcome: 'skipped' },
                    }));
                    advanceQuestion();
                  }}
                  className={`${singleQuestion ? 'ml-auto block' : ''} rounded px-2 py-0.5 text-[var(--text-10)] transition-colors ${
                    response?.outcome === 'skipped'
                      ? 'bg-[var(--surface-inset-strong)] font-[var(--weight-semibold)] text-[var(--fg-strong)]'
                      : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)]'
                  }`}
                >
                  {response?.outcome === 'skipped' ? 'Question skipped' : 'Skip this question'}
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">Additional notes</span>
          <textarea
            disabled={locked}
            maxLength={8_000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={1}
            placeholder="Add optional notes for the agent…"
            className="block min-h-9 w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-[var(--text-10)] font-normal leading-tight text-[var(--fg)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="button"
          disabled={locked}
          onClick={() => onSkip(notes.trim() || undefined)}
          className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-[var(--text-10)] text-[var(--fg-secondary)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-strong)] disabled:opacity-50"
        >
          Skip questionnaire
        </button>
        <button
          type="button"
          disabled={locked || !complete}
          onClick={submit}
          className="shrink-0 rounded bg-[var(--accent)] px-3 py-2 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--accent-contrast)] hover:brightness-110 disabled:opacity-50"
        >
          {questionCount === 1 ? 'Submit answer' : `Submit all ${questionCount} answers`}
        </button>
      </div>
      {!complete ? (
        <div className="mt-1.5 text-[var(--text-9)] text-[var(--yellow)]">
          Answer or skip each question to submit.
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-2 text-[var(--text-9)] text-[var(--red)]">
          {error}
        </div>
      ) : null}
    </section>
  );
}
