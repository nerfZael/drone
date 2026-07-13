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

function compactThread(thread: any, workspaceTarget: unknown) {
  return {
    id: String(thread?.id ?? ''),
    title: String(thread?.title ?? 'Assistant thread'),
    createdAt: String(thread?.createdAt ?? ''),
    updatedAt: String(thread?.updatedAt ?? ''),
    status: String(thread?.status ?? 'idle'),
    error: thread?.error ? String(thread.error) : null,
    provider: String(thread?.provider ?? ''),
    model: String(thread?.model ?? ''),
    thinkingLevel: String(thread?.thinkingLevel ?? ''),
    messageCount: Number(thread?.messageCount ?? 0),
    workspaceTarget,
  };
}

function threadsFromSnapshot(snapshot: any): any[] {
  return Array.isArray(snapshot?.threads) ? snapshot.threads : [];
}

function boundedArguments(value: unknown): unknown {
  if (value == null) return undefined;
  try {
    return JSON.stringify(value).length <= 8_000 ? value : { truncated: true };
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
    content: Array.isArray(message?.content)
      ? message.content.slice(-12).map((part: any) => ({
          type: String(part?.type ?? ''),
          ...(part?.text ? { text: String(part.text).slice(0, 16_000) } : {}),
          ...(part?.thinking ? { thinking: String(part.thinking).slice(0, 16_000) } : {}),
          ...(part?.name ? { name: String(part.name).slice(0, 120) } : {}),
          ...(part?.id ? { id: String(part.id).slice(0, 160) } : {}),
          ...(part?.arguments ? { arguments: boundedArguments(part.arguments) } : {}),
        }))
      : String(message?.content ?? '').slice(0, 24_000),
  }));
}

async function submitPrompt(
  access: LocalHubAccess,
  threadId: string,
  prompt: string,
): Promise<void> {
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
  if (!reader) return;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return;
  }
}

export function createAssistantThreadsCapability(
  access: LocalHubAccess,
  policies: CrossDeviceAssistantPolicyStore,
): CapabilityHandler {
  const withTarget = async (thread: any) =>
    compactThread(thread, await policies.homeTarget(String(thread?.id ?? '')));

  return {
    descriptor: ASSISTANT_THREADS_CAPABILITY,
    async invoke(operation, rawPayload) {
      const payload = object(rawPayload);
      if (operation === 'threads.list') {
        const snapshot = await localHubRequest(access, '/api/assistant/threads');
        return {
          threads: await Promise.all(threadsFromSnapshot(snapshot).map(withTarget)),
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
      if (operation === 'thread.create') {
        const snapshot = await localHubRequest(access, '/api/assistant/threads', {
          method: 'POST',
          body: JSON.stringify({
            title:
              String(payload.title ?? '')
                .trim()
                .slice(0, 160) || undefined,
          }),
        });
        const threads = threadsFromSnapshot(snapshot);
        const activeId = String(snapshot?.activeThreadId ?? '');
        const thread = threads.find((item) => item.id === activeId) ?? threads.at(-1);
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
        return {
          thread: thread ? await withTarget(thread) : null,
          history: boundedAssistantHistory(history),
          streamingMessages: boundedStreamingMessages(snapshot),
        };
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
        void submitPrompt(access, threadId, prompt).catch(() => undefined);
        return { accepted: true, threadId };
      }
      throw Object.assign(new Error(`unsupported assistant operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
