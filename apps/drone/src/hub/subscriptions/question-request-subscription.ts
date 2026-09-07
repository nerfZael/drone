import crypto from 'node:crypto';
import type { ChatQuestionRequest, ChatQuestionRequestResult } from '@drone/assistant-chat';

import type { HubDatabase } from '../../host/hub-database';
import { ResourceSubscriptionRepository } from './resource-subscription-repository';
import { readResourceSubscriptionSettings } from './resource-subscription-settings';
import type { ResourceEvent, ResourceSubscription } from './resource-subscription-types';

export type QuestionRequestSubscriptionResult = {
  requestId: string;
  status: ChatQuestionRequest['status'];
  subscription: ResourceSubscription;
};

export async function createQuestionRequestSubscription(
  database: HubDatabase,
  request: ChatQuestionRequest,
): Promise<QuestionRequestSubscriptionResult> {
  const repository = new ResourceSubscriptionRepository(database);
  const settings = await readResourceSubscriptionSettings();
  return await database.writeTransaction('create asynchronous questions', (connection) => {
    // Native tool-call retries must return the original subscription, including after submission.
    const existing =
      request.nativeThreadId && request.toolCallId
        ? (connection
            .prepare(
              `SELECT id, status, subscription_id FROM chat_question_requests
          WHERE native_thread_id = ? AND tool_call_id = ?`,
            )
            .get(request.nativeThreadId, request.toolCallId) as
            | { id: string; status: ChatQuestionRequest['status']; subscription_id: string | null }
            | undefined)
        : undefined;
    if (existing) {
      const subscription = existing.subscription_id
        ? repository.get(existing.subscription_id, request.chatId)
        : null;
      if (!subscription) throw new Error('question request has no answer subscription');
      return { requestId: existing.id, status: existing.status, subscription };
    }
    if (!settings.enabled) throw new Error('resource subscriptions are disabled');
    if (
      connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canonical_chats'")
        .get()
    ) {
      const location = connection
        .prepare(
          `SELECT chat_name FROM canonical_chats
        WHERE drone_id = ? AND json_extract(metadata_json, '$.id') = ?`,
        )
        .get(request.droneId, request.chatId) as { chat_name: string } | undefined;
      if (!location) throw new Error('unknown chat for question request');
      request = { ...request, chatName: location.chat_name };
    }
    const { subscription } = repository.upsertInTransaction(connection, {
      subscriber: { droneId: request.droneId, chatName: request.chatName, chatId: request.chatId },
      provider: 'drone-hub',
      resourceType: 'question_request',
      resourceId: request.id,
      events: ['question_request.resolved'],
      intent:
        'Review the user’s answers and notes to these questions and continue the task as appropriate. A skipped question is not approval.',
      resourceConfig: { label: request.questions[0]?.question ?? 'Questions' },
      maxActive: settings.maxActiveSubscriptionsPerConversation,
    });
    connection
      .prepare(
        `INSERT INTO chat_question_requests (
      id, drone_id, chat_name, chat_id, native_thread_id, tool_call_id, tool_name,
      questions_json, status, created_at, updated_at, subscription_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        request.id,
        request.droneId,
        request.chatName,
        request.chatId,
        request.nativeThreadId ?? null,
        request.toolCallId ?? null,
        request.toolName,
        JSON.stringify(request.questions),
        request.createdAt,
        request.updatedAt,
        subscription.id,
      );
    return { requestId: request.id, status: 'pending', subscription };
  });
}

export function questionRequestResolvedEvent(
  request: ChatQuestionRequest,
  result: ChatQuestionRequestResult,
  occurredAt: string,
): ResourceEvent {
  return {
    id: crypto.randomUUID(),
    providerEventId: `drone-hub:question-request:${request.id}:resolved`,
    provider: 'drone-hub',
    resourceType: 'question_request',
    resourceId: request.id,
    parentResourceId: null,
    eventType: 'question_request.resolved',
    occurredAt,
    summary:
      result.status === 'submitted'
        ? 'The user submitted answers to your questions.'
        : 'The user skipped your questions.',
    providerContent: { requestId: request.id, questions: request.questions, result },
  };
}
