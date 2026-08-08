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
      thread.agentPermissionMode === 'read-only' || thread.agentPermissionMode === 'workspace-write'
        ? thread.agentPermissionMode
        : 'full-access',
    approvalPolicy: thread.approvalPolicy === 'never' ? 'never' : 'ask',
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
    thread,
    pending,
  };
  return fitMeshChatPayload(metadata, (historyBudget) => ({
    history: boundedAssistantHistory(input.history, historyBudget),
  }));
}
