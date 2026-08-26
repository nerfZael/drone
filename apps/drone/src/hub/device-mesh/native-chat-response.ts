import { isSendInNewChatQueueAction } from '@drone/assistant-chat';
import { boundedAssistantHistory } from './features/cross-device-assistant/bounded-assistant-history';
import { fitMeshChatPayload } from './fit-mesh-chat-payload';

function truncateUtf8(value: unknown, maxBytes: number): string {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return source;
  return `${bytes
    .subarray(0, Math.max(0, maxBytes - 3))
    .toString('utf8')
    .replace(/\uFFFD+$/u, '')}…`;
}

function boundedValue(value: unknown, maxBytes: number): unknown {
  if (value == null) return undefined;
  try {
    if (Buffer.byteLength(JSON.stringify(value)) <= maxBytes) return value;
  } catch {}
  return { truncated: true };
}

const RESOLVED_QUESTION_HISTORY_BYTES = 48 * 1024;

function compactResolvedQuestionRequest(request: any): any {
  const result = request?.result;
  const rawQuestions = Array.isArray(request?.questions) ? request.questions : [];
  const compactQuestionIds = new Map(
    rawQuestions.map((question: any, index: number) => [String(question?.id ?? ''), `q${index}`]),
  );
  return {
    id: String(request?.id ?? '').slice(0, 160),
    droneId: String(request?.droneId ?? '').slice(0, 200),
    chatName: String(request?.chatName ?? '').slice(0, 200),
    chatId: String(request?.chatId ?? '').slice(0, 200),
    ...(String(request?.toolCallId ?? '').trim()
      ? { toolCallId: String(request.toolCallId).slice(0, 240) }
      : {}),
    toolName: String(request?.toolName ?? 'ask_questions').slice(0, 160),
    createdAt: String(request?.createdAt ?? ''),
    updatedAt: String(request?.updatedAt ?? ''),
    status: result?.status === 'submitted' ? 'submitted' : 'skipped',
    questions: rawQuestions.map((question: any, index: number) => ({
      id: `q${index}`,
      question: truncateUtf8(question?.question, 120),
      importance: Math.max(1, Math.min(100, Number(question?.importance) || 50)),
      choices: [],
    })),
    result:
      result?.status === 'submitted'
        ? {
            status: 'submitted',
            requestId: String(result?.requestId ?? request?.id ?? '').slice(0, 160),
            responses: (Array.isArray(result?.responses) ? result.responses : []).map(
              (response: any, index: number) =>
                response?.outcome === 'choice'
                  ? {
                      questionId:
                        compactQuestionIds.get(String(response?.questionId ?? '')) ?? `q${index}`,
                      outcome: 'choice',
                      choiceId: String(response?.choiceId ?? '').slice(0, 80),
                      label: truncateUtf8(response?.label, 160),
                    }
                  : response?.outcome === 'custom'
                    ? {
                        questionId:
                          compactQuestionIds.get(String(response?.questionId ?? '')) ?? `q${index}`,
                        outcome: 'custom',
                        text: truncateUtf8(response?.text, 192),
                      }
                    : {
                        questionId:
                          compactQuestionIds.get(String(response?.questionId ?? '')) ?? `q${index}`,
                        outcome: 'skipped',
                      },
            ),
            ...(result?.notes ? { notes: truncateUtf8(result.notes, 1_000) } : {}),
          }
        : {
            status: 'skipped',
            requestId: String(result?.requestId ?? request?.id ?? '').slice(0, 160),
            reason:
              result?.reason === 'queued_message_pending' || result?.reason === 'chat_stopped'
                ? result.reason
                : 'user_skipped',
            ...(result?.notes ? { notes: truncateUtf8(result.notes, 1_000) } : {}),
          },
  };
}

/** Keep active forms intact, but send answer-only summaries for resolved mobile history. */
export function compactChatQuestionRequests(value: unknown): any[] {
  const requests = Array.isArray(value) ? value : [];
  const pending = requests.filter((request) => request?.status === 'pending').slice(-2);
  const resolved: any[] = [];
  let resolvedBytes = 2;
  for (const request of requests
    .filter((candidate) => candidate?.status !== 'pending' && candidate?.result)
    .slice(-12)
    .reverse()) {
    const compact = compactResolvedQuestionRequest(request);
    const itemBytes = Buffer.byteLength(JSON.stringify(compact)) + 1;
    if (resolved.length > 0 && resolvedBytes + itemBytes > RESOLVED_QUESTION_HISTORY_BYTES) break;
    resolved.unshift(compact);
    resolvedBytes += itemBytes;
  }
  return [...resolved, ...pending].sort((left, right) =>
    String(left?.createdAt ?? '').localeCompare(String(right?.createdAt ?? '')),
  );
}

function compactQueuedPrompt(prompt: any) {
  return {
    id: String(prompt?.id ?? '').slice(0, 160),
    prompt: truncateUtf8(prompt?.prompt, 768),
    createdAt: String(prompt?.createdAt ?? ''),
    status: prompt?.status === 'running' || prompt?.status === 'failed' ? prompt.status : 'queued',
    error: prompt?.error ? truncateUtf8(prompt.error, 512) : null,
    imageCount: Math.max(0, Number(prompt?.imageCount ?? 0) || 0),
    ...(isSendInNewChatQueueAction(prompt?.action) ? { action: prompt.action } : {}),
  };
}

function compactThread(thread: any) {
  if (!thread) return null;
  const queuedPrompts = (Array.isArray(thread.queuedPrompts) ? thread.queuedPrompts : [])
    .slice(-32)
    .map(compactQueuedPrompt);
  return {
    id: String(thread.id ?? ''),
    title: String(thread.title ?? 'Built-in chat'),
    createdAt: String(thread.createdAt ?? ''),
    updatedAt: String(thread.updatedAt ?? ''),
    status: String(thread.status ?? 'idle'),
    error: thread.error ? truncateUtf8(thread.error, 2_000) : null,
    provider: String(thread.provider ?? ''),
    model: String(thread.model ?? ''),
    thinkingLevel: String(thread.thinkingLevel ?? ''),
    agentPermissionMode:
      thread.agentPermissionMode === 'read' || thread.agentPermissionMode === 'write'
        ? thread.agentPermissionMode
        : 'execute',
    approvalPolicy: thread.approvalPolicy === 'none' ? 'none' : 'ask',
    autoApprove: thread.autoApprove === true,
    promptDeliveryMode: thread.promptDeliveryMode === 'asap' ? 'asap' : 'queue',
    queuedPrompts,
  };
}

function compactStreamingMessages(snapshot: any): any[] {
  const messages = Array.isArray(snapshot?.streamingMessages)
    ? snapshot.streamingMessages
    : snapshot?.streamingMessage
      ? [snapshot.streamingMessage]
      : [];
  return messages.slice(-2).map((message: any) => ({
    role: message?.role === 'user' ? 'user' : 'assistant',
    ...(typeof message?.timestamp === 'number' || typeof message?.timestamp === 'string'
      ? { timestamp: message.timestamp }
      : {}),
    content: Array.isArray(message?.content)
      ? message.content.slice(-8).map((part: any) => ({
          type: String(part?.type ?? ''),
          ...(part?.text ? { text: truncateUtf8(part.text, 2_000) } : {}),
          ...(part?.thinking ? { thinking: truncateUtf8(part.thinking, 2_000) } : {}),
          ...(part?.name ? { name: String(part.name).slice(0, 120) } : {}),
          ...(part?.id ? { id: String(part.id).slice(0, 160) } : {}),
          ...(part?.arguments ? { arguments: boundedValue(part.arguments, 4_000) } : {}),
        }))
      : truncateUtf8(message?.content, 12_000),
  }));
}

export function compactNativeChatReadResponse(input: {
  nativeChatId: string;
  snapshot: any;
  history: any;
  metadata?: Record<string, unknown>;
}) {
  const thread = compactThread(
    Array.isArray(input.snapshot?.threads)
      ? input.snapshot.threads.find((item: any) => String(item?.id ?? '') === input.nativeChatId)
      : null,
  );
  const pendingApprovals = (
    Array.isArray(input.snapshot?.pendingApprovals) ? input.snapshot.pendingApprovals : []
  )
    .filter(
      (approval: any) =>
        String(approval?.threadId ?? '') === input.nativeChatId && approval?.status === 'pending',
    )
    .slice(-8)
    .map((approval: any) => ({
      id: String(approval?.id ?? ''),
      threadId: input.nativeChatId,
      toolName: String(approval?.toolName ?? ''),
      label: String(approval?.label ?? 'Approval required').slice(0, 160),
      args: boundedValue(approval?.args, 4_000),
      createdAt: String(approval?.createdAt ?? ''),
      status: 'pending',
    }));
  const questionRequests = compactChatQuestionRequests(
    Array.isArray(input.snapshot?.questionRequests)
      ? input.snapshot.questionRequests
      : input.snapshot?.pendingQuestionRequests,
  ).filter((request: any) => String(request?.chatId ?? '') === input.nativeChatId);
  const pendingQuestionRequests = questionRequests
    .filter(
      (request: any) =>
        String(request?.chatId ?? '') === input.nativeChatId && request?.status === 'pending',
    )
    .slice(-2);
  const streamingMessages = compactStreamingMessages(input.snapshot);
  const pending = (thread?.queuedPrompts ?? []).map((prompt: any) => ({
    ...prompt,
    state: prompt.status,
  }));
  const metadata = {
    ...input.metadata,
    historyKind: 'messages' as const,
    nativeChatId: input.nativeChatId,
    streamingMessages,
    pendingApprovals,
    pendingQuestionRequests,
    questionRequests,
    thread,
    pending,
  };
  return fitMeshChatPayload(metadata, (historyBudget) => ({
    history: boundedAssistantHistory(input.history, historyBudget),
  }));
}
