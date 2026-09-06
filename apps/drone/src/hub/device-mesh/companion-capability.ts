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
  const sessionsByDeviceId = new Map<string, CompanionMeshSession>();

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
        const session = sessionsByDeviceId.get(sourceDeviceId);
        if (session?.clientRunId === clientRunId) await cancelSession(session, true);
        return { ok: true };
      }

      if (operation === 'tool.result') {
        const clientRunId = requiredText(payload.runId, 'runId');
        const session = sessionsByDeviceId.get(sourceDeviceId);
        if (session?.clientRunId !== clientRunId) return { ok: true };
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
      let session = sessionsByDeviceId.get(sourceDeviceId);
      if (session && session.clientRunId !== clientRunId) {
        // A phone only ever drives one Companion conversation. A new run id from
        // the same device means its client was reloaded or replaced, so the
        // stale session is cancelled rather than blocking the phone forever.
        const stale = session;
        sessionsByDeviceId.delete(sourceDeviceId);
        await cancelSession(stale, true);
        session = undefined;
      }

      if (!session) {
        let createdSession!: CompanionMeshSession;
        const run = new CompanionRunSession({
          clientRunId,
          runtimeRunId: `mesh:${crypto.randomUUID()}`,
          transport: 'device_mesh',
          runtime,
          emit: (event) => emit(createdSession, event),
          isAvailable: () => sessionsByDeviceId.get(sourceDeviceId) === createdSession,
          unavailableMessage: 'Companion mobile client disconnected',
          onClose: () => {
            if (sessionsByDeviceId.get(sourceDeviceId) === createdSession) {
              sessionsByDeviceId.delete(sourceDeviceId);
            }
          },
        });
        createdSession = {
          clientRunId,
          sourceDeviceId,
          eventQueue: Promise.resolve(),
          run,
        };
        session = createdSession;
        sessionsByDeviceId.set(sourceDeviceId, session);
      }
      await session.run.enqueue({ prompt, messageId, telemetry });
      return { accepted: true };
    },
    async close() {
      await Promise.all(
        [...sessionsByDeviceId.values()].map((session) => cancelSession(session, false)),
      );
    },
    async revokeDevice(deviceId) {
      const session = sessionsByDeviceId.get(deviceId);
      if (session) await cancelSession(session, false);
    },
  };
}
