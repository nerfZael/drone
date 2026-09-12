import { readCompanionAutoApproveSettings, writeCompanionAutoApproveSettings } from '../companion/companion-auto-approve-settings';
import crypto from 'node:crypto';
import { validateCompanionRunInput } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';

import { CompanionRunSession } from '../companion/companion-run-session';
import type { CompanionWorkspaceService } from '../companion/companion-workspaces';
import type { CompanionRuntime } from '../companion/companion-runtime';
import { CompanionLiveMeshSessions } from './CompanionLiveMeshSessions';
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
  workspaces?: Pick<CompanionWorkspaceService, 'catalog' | 'save'>,
): CapabilityHandler {
  const live = new CompanionLiveMeshSessions({
    emit: (deviceId, payload) => broadcast(COMPANION_CAPABILITY.id, 'live.event', payload, 'live.start', [deviceId]),
  });
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

  const closeDeviceSessions = async (deviceId: string) => {
    live.revokeDevice(deviceId);
    const session = sessionsByDeviceId.get(deviceId);
    if (session) await cancelSession(session, false);
  };

  return {
    descriptor: COMPANION_CAPABILITY,
    async invoke(operation, rawPayload, context) {
      const payload = object(rawPayload);
      const sourceDeviceId = context.sourceDevice.id;
      if (operation === 'auto-approve.settings.get') return readCompanionAutoApproveSettings();
      if (operation === 'auto-approve.settings.update') return writeCompanionAutoApproveSettings(payload);
      if (operation.startsWith('live.')) return live.invoke(sourceDeviceId, operation, payload, context.liveAudio);

      if (operation === 'workspaces.list' || operation === 'workspaces.update') {
        if (!workspaces) throw new Error('Companion workspace settings are unavailable on this Hub.');
        // The mesh router authorizes these operations independently from run.start.
        if (operation === 'workspaces.list') {
          return workspaces.catalog(typeof payload.deviceId === 'string' ? payload.deviceId : undefined);
        }
        return workspaces.save(payload.access, requiredText(payload.revision, 'revision'));
      }

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
      await session.run.submit({ prompt, messageId, telemetry });
      return { accepted: true };
    },
    async close() {
      live.close();
      await Promise.all(
        [...sessionsByDeviceId.values()].map((session) => cancelSession(session, false)),
      );
    },
    revokeDevice: closeDeviceSessions,
    disconnectDevice: closeDeviceSessions,
    accessChanged: closeDeviceSessions,
  };
}
