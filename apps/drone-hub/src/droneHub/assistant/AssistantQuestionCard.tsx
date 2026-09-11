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
  return Object.fromEntries(request.questions.map((question) => [question.id, undefined]));
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

const optionRowClass = (selected: boolean, dimmed: boolean) =>
  `group flex cursor-pointer items-start gap-3 rounded-[var(--radius-medium)] border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-[var(--focus-ring)] focus-within:ring-offset-0 ${
    selected
      ? 'border-[var(--accent-border)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]'
      : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] hover:border-[var(--border)] hover:bg-[var(--surface-strong)]'
  } ${dimmed ? 'opacity-60 hover:opacity-100' : ''}`;

const optionLetterClass = (selected: boolean) =>
  `inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[var(--radius-medium)] px-1 text-10 font-[var(--weight-strong)] leading-none transition-colors ${
    selected
      ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
      : 'bg-[var(--surface-strong)] text-[var(--fg-secondary)] group-hover:text-[var(--fg-strong)]'
  }`;

const headerButtonClass =
  'inline-flex h-7 shrink-0 items-center rounded-[var(--radius-medium)] px-2 text-10 font-[var(--weight-semibold)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)] disabled:cursor-not-allowed disabled:opacity-40';

const headerIconButtonClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)] disabled:cursor-not-allowed disabled:opacity-30';

export function AssistantQuestionCard({
  request,
  busy,
  disabled = false,
  error,
  frameless = false,
  onSubmit,
  onSkip,
}: {
  request: ChatQuestionRequest;
  busy: boolean;
  disabled?: boolean;
  error?: string | null;
  /** No card border, background, or width cap: the host already frames it (a small floating window). */
  frameless?: boolean;
  onSubmit(input: { responses: ChatQuestionResponse[]; notes?: string }): void;
  onSkip(notes?: string): void;
}) {
  const [responses, setResponses] = React.useState(() => initialResponses(request));
  const [notes, setNotes] = React.useState('');
  const [activeQuestionIndex, setActiveQuestionIndex] = React.useState(0);
  const viewMode = useAssistantQuestionViewMode();
  const questionCount = request.questions.length;
  const multiQuestion = questionCount > 1;
  const singleQuestion = multiQuestion && viewMode === 'single';
  const locked = busy || disabled;
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
  const unanswered = request.questions.filter((question) => {
    const response = responses[question.id];
    return response == null || (response.outcome === 'custom' && response.text.trim().length === 0);
  }).length;
  const complete = unanswered === 0;
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
  const submitLabel = questionCount === 1 ? 'Submit answer' : `Submit all ${questionCount} answers`;
  const submitHint = complete
    ? undefined
    : unanswered === 1
      ? 'Answer or skip the remaining question first'
      : `Answer or skip the remaining ${unanswered} questions first`;

  return (
    <section
      className={frameless
        ? 'relative min-w-0 text-[var(--fg-secondary)]'
        : 'relative min-w-0 max-w-[var(--chat-interactive-max)] rounded-[var(--radius-large)] border border-[var(--chat-card-border)] bg-[var(--chat-card-bg)] px-4 py-3.5 text-[var(--fg-secondary)]'}
      role="region"
      aria-label="Questions from the agent"
      aria-busy={busy || undefined}
      data-assistant-question-card="true"
    >
      <div className={singleQuestion ? '' : 'space-y-5'}>
        {visibleQuestions.map((question) => {
          const questionIndex = request.questions.indexOf(question);
          const response = responses[question.id];
          const skipped = response?.outcome === 'skipped';
          const titleId = `${request.id}-${question.id}-title`;
          const showViewToggle = multiQuestion && (singleQuestion || questionIndex === 0);
          return (
            <fieldset
              key={question.id}
              disabled={locked}
              aria-labelledby={titleId}
              // Flex gap rather than space-y: the screen-reader legend is out of
              // flow, and space-y would still count it and push the title down.
              className="flex min-w-0 flex-col gap-2.5"
            >
              <legend className="sr-only">{question.question}</legend>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                <div
                  id={titleId}
                  data-question-title="true"
                  className="min-w-[min(100%,20rem)] flex-1 text-chat-question font-[var(--weight-strong)] leading-snug text-[var(--fg-strong)]"
                >
                  {singleQuestion || !multiQuestion
                    ? question.question
                    : `${questionIndex + 1}. ${question.question}`}
                  <span
                    className="ml-2 inline-flex h-5 translate-y-[-1px] items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-1.5 align-middle text-9 font-[var(--weight-semibold)] leading-none text-[var(--accent)]"
                    title={`Importance ${question.importance} of 100, as rated by the agent`}
                  >
                    {question.importance}/100
                  </span>
                </div>
                {multiQuestion ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {skipped ? (
                      <span className="inline-flex h-7 items-center rounded-[var(--radius-medium)] border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-2 text-10 font-[var(--weight-semibold)] text-[var(--yellow)]">
                        Skipped
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label="Skip this question"
                        title="Skip this question"
                        onClick={() => {
                          setResponses((current) => ({
                            ...current,
                            [question.id]: { outcome: 'skipped' },
                          }));
                          advanceQuestion();
                        }}
                        className={headerButtonClass}
                      >
                        Skip
                      </button>
                    )}
                    {singleQuestion ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="mx-1 h-4 w-px bg-[var(--border-subtle)]"
                        />
                        <button
                          type="button"
                          disabled={locked || activeQuestionIndex === 0}
                          onClick={() => goToQuestion(activeQuestionIndex - 1)}
                          aria-label="Previous question"
                          className={headerIconButtonClass}
                        >
                          <IconChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-10 text-center text-10 tabular-nums text-[var(--fg-secondary)]">
                          {activeQuestionIndex + 1} of {questionCount}
                        </span>
                        <button
                          type="button"
                          disabled={locked || activeQuestionIndex >= questionCount - 1}
                          onClick={() => goToQuestion(activeQuestionIndex + 1)}
                          aria-label="Next question"
                          className={headerIconButtonClass}
                        >
                          <IconChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                    {showViewToggle ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={singleQuestion}
                        onClick={() =>
                          setAssistantQuestionViewMode(singleQuestion ? 'all' : 'single')
                        }
                        className={`${headerButtonClass} ml-0.5`}
                      >
                        {singleQuestion ? 'Show all' : 'One at a time'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {question.detailedExplanation ? (
                <MarkdownMessage
                  text={question.detailedExplanation}
                  className="!text-11 !leading-relaxed text-[var(--fg-secondary)]"
                />
              ) : null}
              <div className="space-y-1.5 pt-0.5">
                {question.choices.map((choice, choiceIndex) => {
                  const selected =
                    response?.outcome === 'choice' && response.choiceId === choice.id;
                  return (
                    <label key={choice.id} className={optionRowClass(selected, skipped)}>
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
                      <span className={optionLetterClass(selected)}>
                        {optionLetter(choiceIndex)}
                      </span>
                      <span className="min-w-0 flex-1 text-12 leading-snug">
                        <span className="font-[var(--weight-emphasis)] text-[var(--fg-strong)]">
                          {choice.label}
                        </span>
                        {choice.recommended ? (
                          <span className="ml-2 inline-block translate-y-[-1px] rounded border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-1.5 py-0.5 text-8 font-[var(--weight-strong)] uppercase leading-none tracking-wide text-[var(--accent)]">
                            Recommended
                          </span>
                        ) : null}
                        {choice.description ? (
                          <span className="mt-1 block text-11 leading-snug text-[var(--fg-secondary)]">
                            {choice.description}
                          </span>
                        ) : null}
                      </span>
                      <IconCheck
                        className={`mt-1 h-3.5 w-3.5 shrink-0 text-[var(--accent)] transition-opacity ${
                          selected ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </label>
                  );
                })}
                <label className={optionRowClass(response?.outcome === 'custom', skipped)}>
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
                  <span className={optionLetterClass(response?.outcome === 'custom')}>
                    {optionLetter(question.choices.length)}
                  </span>
                  <span className="min-w-0 flex-1 text-12 leading-snug">
                    <span className="font-[var(--weight-emphasis)] text-[var(--fg-strong)]">
                      Something else
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
                        className="mt-2 block w-full resize-y rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 py-1.5 text-11 font-normal leading-snug text-[var(--field-fg)] outline-none placeholder:text-[var(--field-placeholder)] focus:border-[var(--field-focus-border)]"
                      />
                    ) : null}
                  </span>
                  <IconCheck
                    className={`mt-1 h-3.5 w-3.5 shrink-0 text-[var(--accent)] transition-opacity ${
                      response?.outcome === 'custom' ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3.5 flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">Additional notes</span>
          <textarea
            disabled={locked}
            maxLength={8_000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={1}
            placeholder="Add optional notes for the agent…"
            className="block min-h-9 w-full resize-y rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-11 font-normal leading-tight text-[var(--field-fg)] outline-none placeholder:text-[var(--field-placeholder)] focus:border-[var(--field-focus-border)] disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={locked}
          onClick={() => onSkip(notes.trim() || undefined)}
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-medium)] border border-[var(--border)] bg-transparent px-3 text-11 font-[var(--weight-semibold)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--fg-strong)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Skip questionnaire
        </button>
        <button
          type="button"
          disabled={locked || !complete}
          onClick={submit}
          title={submitHint}
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-medium)] border border-transparent bg-[var(--accent)] px-3.5 text-11 font-[var(--weight-strong)] text-[var(--accent-fg)] transition-[filter,background-color,color,border-color] hover:brightness-110 disabled:cursor-not-allowed disabled:border-[var(--accent-border)] disabled:bg-[var(--accent-subtle)] disabled:text-[var(--accent)] disabled:opacity-70 disabled:hover:brightness-100"
        >
          {submitLabel}
        </button>
      </div>
      {error ? (
        <div role="alert" className="mt-2 text-10 text-[var(--red)]">
          {error}
        </div>
      ) : null}
    </section>
  );
}
