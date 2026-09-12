import React from 'react';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';

function responseText(response: ChatQuestionResponse | undefined): string {
  if (!response || response.outcome === 'skipped') return 'Skipped';
  return response.outcome === 'choice' ? response.label : response.text;
}

function skippedReason(request: ChatQuestionRequest): string {
  if (request.result?.status !== 'skipped') return 'Questions skipped';
  if (request.result.reason === 'queued_message_pending') {
    return 'Questions skipped because another message was queued';
  }
  if (request.result.reason === 'chat_stopped') return 'Questions canceled when the chat stopped';
  return 'Questions skipped';
}

export function AssistantQuestionResultCard({
  request,
  deliveryStatus,
}: {
  request: ChatQuestionRequest;
  deliveryStatus?: string;
}) {
  const result = request.result;
  if (!result) return null;
  const responses =
    result.status === 'submitted'
      ? new Map(result.responses.map((response) => [response.questionId, response]))
      : null;

  if (!responses) {
    return (
      <div
        role="status"
        aria-label="Skipped questions"
        data-assistant-question-result="true"
        className="mx-auto flex min-h-9 w-full max-w-[var(--chat-prose-max)] flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--border-subtle)] py-1.5 text-[var(--muted)]"
      >
        <span
          className="text-ui font-[var(--weight-emphasis)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {skippedReason(request)}
          {deliveryStatus ? ` · ${deliveryStatus}` : ''}
        </span>
        {result.notes ? (
          <span className="min-w-0 whitespace-pre-wrap break-words text-compact text-[var(--muted-dim)]">
            {result.notes}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className="min-w-0 max-w-[var(--chat-interactive-max)] rounded-[var(--radius-large)] border border-[var(--chat-card-border)] bg-[var(--chat-card-bg)] px-4 py-3 text-11"
      role="region"
      aria-label="Submitted answers"
      data-assistant-question-result="true"
    >
      <div className="mb-2 text-10 font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
        {deliveryStatus ? 'Answers saved' : 'Answers submitted'}
        {deliveryStatus ? ` · ${deliveryStatus}` : ''}
      </div>
      <dl className="space-y-2.5">
        {request.questions.map((question) => (
          <div key={question.id} className="min-w-0">
            <dt className="text-[var(--fg-secondary)]">{question.question}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-[var(--fg-strong)]">
              {responseText(responses.get(question.id))}
            </dd>
          </div>
        ))}
      </dl>
      {result.notes ? (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5">
          <div className="text-[var(--fg-secondary)]">Additional notes</div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[var(--fg-strong)]">
            {result.notes}
          </div>
        </div>
      ) : null}
    </section>
  );
}
