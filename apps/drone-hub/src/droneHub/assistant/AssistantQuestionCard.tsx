import React from 'react';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import { MarkdownMessage } from '../chat/MarkdownMessage';

type DraftResponse =
  | { outcome: 'choice'; choiceId: string }
  | { outcome: 'custom'; text: string }
  | { outcome: 'skipped' };

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
  const locked = busy || disabled;
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
    <section className="mx-3 rounded-[var(--radius-large)] border border-[var(--accent-muted)] bg-[var(--panel-raised)] p-4">
      <div className="mb-4">
        <div className="text-[var(--text-9)] font-[var(--weight-bold)] uppercase tracking-wider text-[var(--accent)]">
          Input requested
        </div>
        <div className="mt-1 text-[var(--text-11)] text-[var(--muted)]">
          Review the recommendations, answer with something else, or skip any question.
        </div>
      </div>
      <div className="space-y-5">
        {request.questions.map((question, questionIndex) => {
          const response = responses[question.id];
          return (
            <fieldset key={question.id} disabled={locked} className="space-y-2">
              <legend className="text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
                {questionIndex + 1}. {question.question}
              </legend>
              <div className="text-[var(--text-9)] text-[var(--muted-dim)]">
                Importance {question.importance}/100
              </div>
              {question.detailedExplanation ? (
                <MarkdownMessage
                  text={question.detailedExplanation}
                  className="text-[var(--text-11)] text-[var(--muted)]"
                />
              ) : null}
              <div className="space-y-2">
                {question.choices.map((choice) => (
                  <label
                    key={choice.id}
                    className={`flex cursor-pointer gap-3 rounded border px-3 py-2 ${
                      response?.outcome === 'choice' && response.choiceId === choice.id
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-softest)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${request.id}:${question.id}`}
                      checked={response?.outcome === 'choice' && response.choiceId === choice.id}
                      onChange={() =>
                        setResponses((current) => ({
                          ...current,
                          [question.id]: { outcome: 'choice', choiceId: choice.id },
                        }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-[var(--weight-semibold)] text-[var(--fg)]">
                        {choice.label}
                      </span>
                      {choice.recommended ? (
                        <span className="ml-2 rounded bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-8)] font-[var(--weight-bold)] uppercase text-[var(--accent)]">
                          Recommended
                        </span>
                      ) : null}
                      {choice.description ? (
                        <span className="mt-0.5 block text-[var(--text-10)] text-[var(--muted)]">
                          {choice.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
                <label className="block rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2">
                  <span className="flex gap-3">
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
                    />
                    <span className="font-[var(--weight-semibold)] text-[var(--fg)]">
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
                      className="mt-2 w-full resize-y rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5 text-[var(--text-11)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
                    />
                  ) : null}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setResponses((current) => ({
                      ...current,
                      [question.id]: { outcome: 'skipped' },
                    }))
                  }
                  className={`rounded px-2 py-1 text-[var(--text-10)] ${
                    response?.outcome === 'skipped'
                      ? 'bg-[var(--surface-active)] text-[var(--fg)]'
                      : 'text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {response?.outcome === 'skipped' ? 'Question skipped' : 'Skip this question'}
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>
      <label className="mt-5 block text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)]">
        Additional notes
        <textarea
          disabled={locked}
          maxLength={8_000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          placeholder="Optional context for the agent"
          className="mt-1.5 w-full resize-y rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-[var(--text-11)] font-normal text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
        />
      </label>
      {!complete ? (
        <div className="mt-2 text-[var(--text-9)] text-[var(--yellow)]">
          Choose an answer or explicitly skip every question.
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-2 text-[var(--text-9)] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={locked}
          onClick={() => onSkip(notes.trim() || undefined)}
          className="rounded border border-[var(--border-subtle)] px-3 py-2 text-[var(--text-10)] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
        >
          {notes.trim() ? 'Send note and skip' : 'Skip all questions'}
        </button>
        <button
          type="button"
          disabled={locked || !complete}
          onClick={submit}
          className="rounded bg-[var(--accent)] px-3 py-2 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--accent-contrast)] disabled:opacity-50"
        >
          Submit answers
        </button>
      </div>
    </section>
  );
}
