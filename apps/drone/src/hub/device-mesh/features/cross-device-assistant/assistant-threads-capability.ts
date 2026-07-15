import { ASSISTANT_THREADS_CAPABILITY } from '@drone/device-protocol';
import type { CapabilityHandler } from '../../device-mesh-types';
import { localHubRequest, type LocalHubAccess } from '../../local-hub-request';
import { boundedAssistantHistory } from './bounded-assistant-history';
import { CrossDeviceAssistantPolicyStore } from './policy-store';

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function required(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!result) throw Object.assign(new Error(`${label} is required`), { code: 'INVALID_REQUEST' });
  return result;
}

function truncateUtf8(value: unknown, maxBytes: number): string {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return source;
  return `${bytes
    .subarray(0, Math.max(0, maxBytes - 3))
    .toString('utf8')
    .replace(/\uFFFD+$/u, '')}…`;
}

function compactQueuedPrompt(prompt: any) {
  return {
    id: String(prompt?.id ?? '').slice(0, 160),
    prompt: truncateUtf8(prompt?.prompt, 768),
    createdAt: String(prompt?.createdAt ?? ''),
    status:
      prompt?.status === 'running' || prompt?.status === 'failed' ? prompt.status : 'queued',
    error: prompt?.error ? truncateUtf8(prompt.error, 512) : null,
    imageCount: Math.max(0, Number(prompt?.imageCount ?? 0) || 0),
  };
}

function compactThread(thread: any, workspaceTargets: unknown[], includeQueuedPrompts = true) {
  const queuedPromptSource = Array.isArray(thread?.queuedPrompts) ? thread.queuedPrompts : [];
  const queuedPrompts = includeQueuedPrompts
    ? queuedPromptSource.slice(-32).map(compactQueuedPrompt)
    : [];
  return {
    id: String(thread?.id ?? ''),
    title: String(thread?.title ?? 'Assistant thread'),
    createdAt: String(thread?.createdAt ?? ''),
    updatedAt: String(thread?.updatedAt ?? ''),
    status: String(thread?.status ?? 'idle'),
    error: thread?.error ? truncateUtf8(thread.error, 2_000) : null,
    provider: String(thread?.provider ?? ''),
    model: String(thread?.model ?? ''),
    thinkingLevel: String(thread?.thinkingLevel ?? ''),
    messageCount: Number(thread?.messageCount ?? 0),
    promptDeliveryMode: thread?.promptDeliveryMode === 'asap' ? 'asap' : 'queue',
    queuedPromptCount: queuedPromptSource.length,
    queuedPrompts,
    workspaceTarget: workspaceTargets[0] ?? null,
    workspaceTargets,
  };
}

function threadsFromSnapshot(snapshot: any): any[] {
  return Array.isArray(snapshot?.threads) ? snapshot.threads : [];
}

function boundedArguments(value: unknown): unknown {
  if (value == null) return undefined;
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= 2_000 ? value : { truncated: true };
  } catch {
    return { truncated: true };
  }
}

function boundedStreamingMessages(snapshot: any): any[] {
  const values = Array.isArray(snapshot?.streamingMessages)
    ? snapshot.streamingMessages
    : snapshot?.streamingMessage
      ? [snapshot.streamingMessage]
      : [];
  return values.slice(-2).map((message: any) => ({
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
          ...(part?.arguments ? { arguments: boundedArguments(part.arguments) } : {}),
        }))
      : truncateUtf8(message?.content, 12_000),
  }));
}

async function submitPrompt(
  access: LocalHubAccess,
  threadId: string,
  prompt: string,
): Promise<any> {
  const response = await fetch(
    new URL(`/api/assistant/threads/${encodeURIComponent(threadId)}/prompt`, access.baseUrl()),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body?.error ?? `assistant prompt failed (${response.status})`));
  }
  const reader = response.body?.getReader();
  if (!reader) return { type: 'accepted', threadId };
  const decoder = new TextDecoder();
  let buffer = '';
  const continueDraining = async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
      }
    } catch {
      // The request has already been acknowledged; realtime thread changes carry later state.
    }
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      buffer += decoder.decode();
      const trailing = buffer.trim();
      if (!trailing) return { type: 'accepted', threadId };
      const event = JSON.parse(trailing);
      if (event?.type === 'error')
        throw new Error(String(event.error ?? 'assistant prompt failed'));
      return event;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event?.type === 'heartbeat') continue;
      if (event?.type === 'error') {
        void continueDraining();
        throw new Error(String(event.error ?? 'assistant prompt failed'));
      }
      if (event?.type === 'accepted' || event?.type === 'queued' || event?.type === 'blip_event') {
        void continueDraining();
        return event;
      }
      if (event?.type === 'done') return { type: 'accepted', threadId };
    }
  }
}

export function createAssistantThreadsCapability(
  access: LocalHubAccess,
  policies: CrossDeviceAssistantPolicyStore,
): CapabilityHandler {
  const withTarget = async (thread: any, includeQueuedPrompts = true) =>
    compactThread(
      thread,
      await policies.homeTargets(String(thread?.id ?? '')),
      includeQueuedPrompts,
    );

  return {
    descriptor: ASSISTANT_THREADS_CAPABILITY,
    async invoke(operation, rawPayload) {
      const payload = object(rawPayload);
      if (operation === 'threads.list') {
        const snapshot = await localHubRequest(access, '/api/assistant/threads');
        return {
          threads: await Promise.all(
            threadsFromSnapshot(snapshot).map((thread) => withTarget(thread, false)),
          ),
          models: Array.isArray(snapshot?.models) ? snapshot.models : [],
        };
      }
      if (operation === 'models.list') {
        const snapshot = await localHubRequest(access, '/api/assistant/threads');
        return {
          models: Array.isArray(snapshot?.models)
            ? snapshot.models.map((model: any) => ({
                provider: String(model?.provider ?? ''),
                id: String(model?.id ?? ''),
                name: String(model?.name ?? model?.id ?? ''),
                thinkingLevel: String(model?.thinkingLevel ?? ''),
              }))
            : [],
        };
      }
      if (operation === 'thread.create' || operation === 'thread.clone') {
        const cloneThreadId =
          operation === 'thread.clone' ? required(payload.threadId, 'thread id') : '';
        const snapshot = await localHubRequest(access, '/api/assistant/threads', {
          method: 'POST',
          body: JSON.stringify({
            title:
              String(payload.title ?? '')
                .trim()
                .slice(0, 160) || undefined,
            ...(cloneThreadId ? { cloneThreadId } : {}),
          }),
        });
        const threads = threadsFromSnapshot(snapshot);
        const activeId = String(snapshot?.activeThreadId ?? '');
        const thread = threads.find((item) => item.id === activeId) ?? threads.at(-1);
        if (cloneThreadId && thread) {
          try {
            await policies.cloneHomeTargets(cloneThreadId, String(thread.id));
          } catch (error) {
            await localHubRequest(
              access,
              `/api/assistant/threads/${encodeURIComponent(String(thread.id))}`,
              { method: 'DELETE' },
            ).catch(() => undefined);
            throw error;
          }
        }
        return { thread: thread ? await withTarget(thread) : null };
      }
      const threadId = required(payload.threadId, 'thread id');
      if (operation === 'thread.get') {
        const [snapshot, history] = await Promise.all([
          localHubRequest(access, `/api/assistant/threads/${encodeURIComponent(threadId)}`),
          localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(threadId)}/history?limit=100`,
          ),
        ]);
        const thread = threadsFromSnapshot(snapshot).find((item) => item.id === threadId);
        const compact = thread ? await withTarget(thread) : null;
        const streamingMessages = boundedStreamingMessages(snapshot);
        const nonHistoryBytes = Buffer.byteLength(
          JSON.stringify({ thread: compact, streamingMessages }),
        );
        return {
          thread: compact,
          history: boundedAssistantHistory(history, 205 * 1024 - nonHistoryBytes),
          streamingMessages,
        };
      }
      if (operation === 'thread.delete') {
        await localHubRequest(access, `/api/assistant/threads/${encodeURIComponent(threadId)}`, {
          method: 'DELETE',
        });
        return { deleted: true, threadId };
      }
      if (operation === 'thread.message.delete') {
        const messageId = required(payload.messageId, 'message id');
        const deleteFollowing = payload.deleteFollowing === true;
        await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}?following=${deleteFollowing}`,
          { method: 'DELETE' },
        );
        return { deleted: true, threadId, messageId, deleteFollowing };
      }
      if (operation === 'thread.update') {
        const snapshot = await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(threadId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              provider: required(payload.provider, 'provider'),
              model: required(payload.model, 'model'),
              ...(payload.thinkingLevel ? { thinkingLevel: String(payload.thinkingLevel) } : {}),
            }),
          },
        );
        const thread = threadsFromSnapshot(snapshot).find((item) => item.id === threadId);
        return { thread: thread ? await withTarget(thread) : null };
      }
      if (operation === 'thread.stop') {
        // Queue cancellation is a narrower form of the existing stop permission. Keeping it on
        // this operation makes the feature available to devices paired before queue UI shipped.
        const promptId = String(payload.promptId ?? '').trim();
        if (promptId) {
          const snapshot = await localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(threadId)}/queued/${encodeURIComponent(promptId)}`,
            { method: 'DELETE' },
          );
          const thread = threadsFromSnapshot(snapshot).find((item) => item.id === threadId);
          return { cancelled: true, thread: thread ? await withTarget(thread) : null };
        }
        await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(threadId)}/stop`,
          {
            method: 'POST',
            body: '{}',
          },
        );
        return { stopped: true, threadId };
      }
      if (operation === 'thread.prompt') {
        const prompt = required(payload.prompt, 'prompt');
        if (prompt.length > 32_000)
          throw Object.assign(new Error('prompt is too large'), { code: 'INVALID_REQUEST' });
        await localHubRequest(access, `/api/assistant/threads/${encodeURIComponent(threadId)}`);
        const acknowledgement = await submitPrompt(access, threadId, prompt);
        return {
          accepted: true,
          threadId,
          queuedPrompt:
            acknowledgement?.type === 'queued' && acknowledgement.prompt
              ? compactQueuedPrompt(acknowledgement.prompt)
              : null,
        };
      }
      throw Object.assign(new Error(`unsupported assistant operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
