import crypto from 'node:crypto';
import { validateCompanionRunInput } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';

import { CompanionRunSession } from '../companion/companion-run-session';
import type { CompanionRuntime } from '../companion/companion-runtime';
import type { CapabilityHandler } from './device-mesh-types';

type CompanionMeshSession = {
  clientRunId: string;
  sourceDeviceId: string;
  eventQueue: Promise<void>;
  run: CompanionRunSession;
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
    await session.run.close('Companion run cancelled');
    if (notify) {
      await emit(session, { type: 'status', status: 'cancelled' }).catch(() => undefined);
    }
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
        if (!session) return { ok: true };
        const callId = requiredText(payload.callId, 'callId');
        session.run.resolveBrowserTool({
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
      const { runId: clientRunId, prompt, messageId, telemetry } = validation;
      const key = sessionKey(sourceDeviceId, clientRunId);
      let session = sessions.get(key);
      for (const existingSession of sessions.values()) {
        if (existingSession.sourceDeviceId === sourceDeviceId && existingSession !== session) {
          throw Object.assign(new Error('This device already has an active Companion run'), {
            code: 'CONFLICT',
          });
        }
      }

      if (!session) {
        let createdSession!: CompanionMeshSession;
        const run = new CompanionRunSession({
          clientRunId,
          runtimeRunId: `mesh:${crypto.randomUUID()}`,
          transport: 'device_mesh',
          runtime,
          emit: (event) => emit(createdSession, event),
          isAvailable: () => sessions.get(key) === createdSession,
          unavailableMessage: 'Companion mobile client disconnected',
          onClose: () => {
            if (sessions.get(key) === createdSession) sessions.delete(key);
          },
        });
        createdSession = {
          clientRunId,
          sourceDeviceId,
          eventQueue: Promise.resolve(),
          run,
        };
        session = createdSession;
        sessions.set(key, session);
      }
      await session.run.enqueue({ prompt, messageId, telemetry });
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
