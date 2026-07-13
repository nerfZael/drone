import { ASSISTANT_THREADS_CAPABILITY } from '@drone/device-protocol';
import type { CapabilityHandler } from '../../device-mesh-types';
import { localHubRequest, type LocalHubAccess } from '../../local-hub-request';
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
    messageCount: Number(thread?.messageCount ?? 0),
    workspaceTarget,
  };
}

function threadsFromSnapshot(snapshot: any): any[] {
  return Array.isArray(snapshot?.threads) ? snapshot.threads : [];
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
  await response.text();
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
        return { threads: await Promise.all(threadsFromSnapshot(snapshot).map(withTarget)) };
      }
      if (operation === 'thread.create') {
        const snapshot = await localHubRequest(access, '/api/assistant/threads', {
          method: 'POST',
          body: JSON.stringify({ title: String(payload.title ?? '').trim() || undefined }),
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
        return { thread: thread ? await withTarget(thread) : null, history };
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
        void submitPrompt(access, threadId, prompt).catch(() => undefined);
        return { accepted: true, threadId };
      }
      throw Object.assign(new Error(`unsupported assistant operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
