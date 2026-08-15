import crypto from 'node:crypto';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';

import type { CompanionBrowserCall, CompanionRuntime } from '../companion/companion-runtime';
import type { CapabilityHandler } from './device-mesh-types';

const BROWSER_TOOL_TIMEOUT_MS = 20_000;
const ACTIVITY_RESULT_MAX_CHARS = 20_000;
const MAX_PROMPT_CHARS = 20_000;
const MAX_RUN_ID_CHARS = 128;

type PendingToolCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener(): void;
};

type CompanionMeshSession = {
  clientRunId: string;
  runtimeRunId: string;
  sourceDeviceId: string;
  generation: number;
  pendingTools: Map<string, PendingToolCall>;
  eventQueue: Promise<void>;
};

type BroadcastEvent = (
  capability: string,
  event: string,
  payload: Record<string, any>,
  requiredOperation: string,
  targetDeviceIds?: Iterable<string>,
) => Promise<void>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw Object.assign(new Error(`${label} is required`), { code: 'INVALID_REQUEST' });
  return text;
}

function boundedActivityValue(value: unknown): unknown {
  let serialized = '';
  try {
    serialized = JSON.stringify(value) ?? String(value ?? '');
  } catch {
    serialized = String(value ?? '');
  }
  return serialized.length <= ACTIVITY_RESULT_MAX_CHARS
    ? value
    : `${serialized.slice(0, ACTIVITY_RESULT_MAX_CHARS)}\n… value truncated`;
}

function boundedActivityEvent(event: any): any | null {
  const type = String(event?.type ?? '');
  if (!type.startsWith('tool_call_')) return null;
  if (type === 'tool_call_started') return { ...event, args: boundedActivityValue(event.args) };
  if (type === 'tool_call_completed')
    return { ...event, result: boundedActivityValue(event.result) };
  if (type === 'tool_call_failed') return { ...event, error: boundedActivityValue(event.error) };
  return event;
}

export function createCompanionCapability(
  runtime: CompanionRuntime,
  broadcast: BroadcastEvent,
): CapabilityHandler {
  const sessions = new Map<string, CompanionMeshSession>();
  const sessionKey = (sourceDeviceId: string, clientRunId: string) =>
    `${sourceDeviceId}\u0000${clientRunId}`;

  const emit = async (session: CompanionMeshSession, message: Record<string, unknown>) => {
    session.eventQueue = session.eventQueue
      .catch(() => undefined)
      .then(() =>
        broadcast(
          COMPANION_CAPABILITY.id,
          'run.event',
          { runId: session.clientRunId, ...message },
          'run.start',
          [session.sourceDeviceId],
        ),
      );
    await session.eventQueue;
  };

  const rejectPending = (session: CompanionMeshSession, message: string) => {
    for (const pending of session.pendingTools.values()) {
      clearTimeout(pending.timer);
      pending.removeAbortListener();
      pending.reject(new Error(message));
    }
    session.pendingTools.clear();
  };

  const cancelSession = async (session: CompanionMeshSession, notify: boolean) => {
    session.generation += 1;
    runtime.cancel(session.runtimeRunId);
    rejectPending(session, 'Companion run cancelled');
    sessions.delete(sessionKey(session.sourceDeviceId, session.clientRunId));
    if (notify) {
      await emit(session, { type: 'status', status: 'cancelled' }).catch(() => undefined);
    }
  };

  const callBrowser =
    (session: CompanionMeshSession): CompanionBrowserCall =>
    (tool, args, signal) => {
      const callId = crypto.randomUUID();
      const callGeneration = session.generation;
      return new Promise((resolve, reject) => {
        if (!sessions.has(sessionKey(session.sourceDeviceId, session.clientRunId))) {
          reject(new Error('Companion mobile client disconnected'));
          return;
        }
        const finish = (error: Error) => {
          const pending = session.pendingTools.get(callId);
          if (!pending) return;
          session.pendingTools.delete(callId);
          clearTimeout(pending.timer);
          signal?.removeEventListener('abort', onAbort);
          pending.reject(error);
        };
        const onAbort = () => finish(new Error('mobile tool cancelled'));
        const timer = setTimeout(
          () => finish(new Error(`mobile tool timed out: ${tool}`)),
          BROWSER_TOOL_TIMEOUT_MS,
        );
        timer.unref?.();
        session.pendingTools.set(callId, {
          resolve: (value) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(value);
          },
          reject: (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
          },
          timer,
          removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
        });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        void emit(session, {
          type: 'tool_call',
          generation: callGeneration,
          callId,
          tool,
          args,
        }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
      });
    };

  const closeSession = (session: CompanionMeshSession, message: string) => {
    const key = sessionKey(session.sourceDeviceId, session.clientRunId);
    if (sessions.get(key) === session) sessions.delete(key);
    rejectPending(session, message);
  };

  return {
    descriptor: COMPANION_CAPABILITY,
    async invoke(operation, rawPayload, context) {
      const payload = object(rawPayload);
      const sourceDeviceId = context.sourceDevice.id;
      const clientRunId = requiredText(payload.runId, 'runId');
      const key = sessionKey(sourceDeviceId, clientRunId);

      if (operation === 'run.cancel') {
        const session = sessions.get(key);
        if (session) await cancelSession(session, true);
        return { ok: true };
      }

      if (operation === 'tool.result') {
        const session = sessions.get(key);
        if (!session || Number(payload.generation) !== session.generation) return { ok: true };
        const callId = requiredText(payload.callId, 'callId');
        const pending = session.pendingTools.get(callId);
        if (!pending) return { ok: true };
        session.pendingTools.delete(callId);
        clearTimeout(pending.timer);
        pending.removeAbortListener();
        if (payload.ok === false)
          pending.reject(new Error(String(payload.error ?? 'mobile tool failed')));
        else pending.resolve(payload.result);
        return { ok: true };
      }

      if (operation !== 'run.start') {
        throw Object.assign(new Error(`unsupported Companion operation: ${operation}`), {
          code: 'UNSUPPORTED_OPERATION',
        });
      }
      const prompt = requiredText(payload.prompt, 'prompt');
      if (
        clientRunId.length > MAX_RUN_ID_CHARS ||
        /[\u0000-\u001f\u007f]/.test(clientRunId) ||
        prompt.length > MAX_PROMPT_CHARS
      ) {
        throw Object.assign(new Error('Companion run input is too large or invalid'), {
          code: 'INVALID_REQUEST',
        });
      }
      if (sessions.has(key)) {
        throw Object.assign(new Error('Companion run already exists'), { code: 'CONFLICT' });
      }
      for (const session of sessions.values()) {
        if (session.sourceDeviceId === sourceDeviceId) {
          throw Object.assign(new Error('This device already has an active Companion run'), {
            code: 'CONFLICT',
          });
        }
      }

      const session: CompanionMeshSession = {
        clientRunId,
        runtimeRunId: `mesh:${crypto.randomUUID()}`,
        sourceDeviceId,
        generation: 1,
        pendingTools: new Map(),
        eventQueue: Promise.resolve(),
      };
      sessions.set(key, session);
      try {
        await emit(session, { type: 'status', status: 'working' });
      } catch (error) {
        closeSession(session, 'Companion mobile client disconnected');
        throw error;
      }
      void runtime
        .run({
          runId: session.runtimeRunId,
          prompt,
          callBrowser: callBrowser(session),
          onEvent: (event) => {
            if (sessions.get(key) !== session) return;
            const visibleEvent = boundedActivityEvent(event);
            if (visibleEvent) {
              void emit(session, { type: 'activity', event: visibleEvent }).catch(() => undefined);
            }
          },
        })
        .then(async (reply) => {
          if (sessions.get(key) !== session) return;
          await emit(session, { type: 'reply', reply });
          await emit(session, { type: 'status', status: 'completed' });
        })
        .catch(async (error) => {
          if (sessions.get(key) !== session) return;
          await emit(session, {
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => closeSession(session, 'Companion run finished'))
        .catch(() => undefined);
      return { accepted: true };
    },
    async close() {
      await Promise.all([...sessions.values()].map((session) => cancelSession(session, false)));
    },
    async revokeDevice(deviceId) {
      await Promise.all(
        [...sessions.values()]
          .filter((session) => session.sourceDeviceId === deviceId)
          .map((session) => cancelSession(session, false)),
      );
    },
  };
}
