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

export function AssistantQuestionResultCard({ request }: { request: ChatQuestionRequest }) {
  const result = request.result;
  if (!result) return null;
  const responses =
    result.status === 'submitted'
      ? new Map(result.responses.map((response) => [response.questionId, response]))
      : null;

  return (
    <section
      className="min-w-0 max-w-[var(--chat-interactive-max)] rounded-[var(--radius-large)] border border-[var(--chat-card-border)] bg-[var(--chat-card-bg)] px-4 py-3 text-[var(--text-11)]"
      role="region"
      aria-label={result.status === 'submitted' ? 'Submitted answers' : 'Skipped questions'}
      data-assistant-question-result="true"
    >
      <div className="mb-2 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
        {result.status === 'submitted' ? 'Answers submitted' : skippedReason(request)}
      </div>
      {responses ? (
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
      ) : null}
      {result.notes ? (
        <div className={`${responses ? 'mt-3 border-t border-[var(--border-subtle)] pt-2.5' : ''}`}>
          <div className="text-[var(--fg-secondary)]">Additional notes</div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[var(--fg-strong)]">
            {result.notes}
          </div>
        </div>
      ) : null}
    </section>
  );
}
