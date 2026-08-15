import crypto from 'node:crypto';
import { validateCompanionRunInput } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';

import type { CompanionBrowserCall, CompanionRuntime } from '../companion/companion-runtime';
import {
  boundedCompanionActivityEvent,
  CompanionBrowserToolBroker,
} from '../companion/companion-transport-shared';
import type { CapabilityHandler } from './device-mesh-types';

type CompanionMeshSession = {
  clientRunId: string;
  runtimeRunId: string;
  sourceDeviceId: string;
  generation: number;
  browserTools: CompanionBrowserToolBroker;
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

  const cancelSession = async (session: CompanionMeshSession, notify: boolean) => {
    session.generation += 1;
    runtime.cancel(session.runtimeRunId);
    session.browserTools.rejectAll('Companion run cancelled');
    sessions.delete(sessionKey(session.sourceDeviceId, session.clientRunId));
    if (notify) {
      await emit(session, { type: 'status', status: 'cancelled' }).catch(() => undefined);
    }
  };

  const callBrowser =
    (session: CompanionMeshSession): CompanionBrowserCall =>
    (tool, args, signal) => session.browserTools.request(tool, args, session.generation, signal);

  const closeSession = (session: CompanionMeshSession, message: string) => {
    const key = sessionKey(session.sourceDeviceId, session.clientRunId);
    if (sessions.get(key) === session) sessions.delete(key);
    session.browserTools.rejectAll(message);
  };

  return {
    descriptor: COMPANION_CAPABILITY,
    async invoke(operation, rawPayload, context) {
      const payload = object(rawPayload);
      const sourceDeviceId = context.sourceDevice.id;

      if (operation === 'run.cancel') {
        const clientRunId = requiredText(payload.runId, 'runId');
        const key = sessionKey(sourceDeviceId, clientRunId);
        const session = sessions.get(key);
        if (session) await cancelSession(session, true);
        return { ok: true };
      }

      if (operation === 'tool.result') {
        const clientRunId = requiredText(payload.runId, 'runId');
        const key = sessionKey(sourceDeviceId, clientRunId);
        const session = sessions.get(key);
        if (!session || Number(payload.generation) !== session.generation) return { ok: true };
        const callId = requiredText(payload.callId, 'callId');
        session.browserTools.resolve({
          callId,
          generation: Number(payload.generation),
          ok: payload.ok !== false,
          result: payload.result,
          error: payload.error,
        });
        return { ok: true };
      }

      if (operation !== 'run.start') {
        throw Object.assign(new Error(`unsupported Companion operation: ${operation}`), {
          code: 'UNSUPPORTED_OPERATION',
        });
      }
      const validation = validateCompanionRunInput(payload);
      if (!validation.ok) {
        throw Object.assign(new Error(validation.error), { code: 'INVALID_REQUEST' });
      }
      const { runId: clientRunId, prompt } = validation;
      const key = sessionKey(sourceDeviceId, clientRunId);
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

      let session!: CompanionMeshSession;
      const browserTools = new CompanionBrowserToolBroker({
        available: () => sessions.get(key) === session,
        unavailableMessage: 'Companion mobile client disconnected',
        dispatch: (call) => emit(session, { type: 'tool_call', ...call }),
      });
      session = {
        clientRunId,
        runtimeRunId: `mesh:${crypto.randomUUID()}`,
        sourceDeviceId,
        generation: 1,
        browserTools,
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
            const visibleEvent = boundedCompanionActivityEvent(event);
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
