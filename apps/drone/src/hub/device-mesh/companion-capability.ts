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
  prompts: Array<{
    prompt: string;
    messageId: string;
    telemetry?: import('@drone/assistant-chat').CompanionClientTelemetry;
    receivedAtEpochMs: number;
    receivedAtMonotonicMs: number;
  }>;
  activeMessageId: string;
  active: boolean;
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
    session.prompts.length = 0;
    session.browserTools.rejectAll('Companion run cancelled');
    sessions.delete(sessionKey(session.sourceDeviceId, session.clientRunId));
    await runtime.deleteSession(session.runtimeRunId);
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

  const drainSession = async (session: CompanionMeshSession, firstStatusEmitted = false) => {
    const key = sessionKey(session.sourceDeviceId, session.clientRunId);
    if (sessions.get(key) !== session) return;
    if (!firstStatusEmitted) {
      if (session.active) return;
      session.active = true;
    }
    let statusEmitted = firstStatusEmitted;
    try {
      while (session.prompts.length > 0 && sessions.get(key) === session) {
        const queued = session.prompts.shift()!;
        const { prompt, messageId } = queued;
        session.activeMessageId = messageId;
        if (!statusEmitted) {
          session.generation += 1;
          await emit(session, { type: 'status', messageId, status: 'working' });
        }
        const runGeneration = session.generation;
        statusEmitted = false;
        try {
          const reply = await runtime.run({
            runId: session.runtimeRunId,
            messageId,
            prompt,
            transport: 'device_mesh',
            queueWaitMs: performance.now() - queued.receivedAtMonotonicMs,
            receivedAtEpochMs: queued.receivedAtEpochMs,
            receivedAtMonotonicMs: queued.receivedAtMonotonicMs,
            clientTelemetry: queued.telemetry,
            callBrowser: callBrowser(session),
            onEvent: (event) => {
              if (sessions.get(key) !== session || session.generation !== runGeneration) return;
              const visibleEvent = boundedCompanionActivityEvent(event);
              if (visibleEvent) {
                void emit(session, { type: 'activity', messageId, event: visibleEvent }).catch(
                  () => undefined,
                );
              }
            },
          });
          if (sessions.get(key) !== session || session.generation !== runGeneration) return;
          await emit(session, { type: 'reply', messageId, reply });
          await emit(session, { type: 'status', messageId, status: 'completed' });
        } catch (error) {
          if (sessions.get(key) !== session || session.generation !== runGeneration) return;
          await emit(session, {
            type: 'error',
            messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (session.generation === runGeneration) {
            session.browserTools.rejectAll('Companion run finished');
            session.activeMessageId = '';
          }
        }
      }
    } catch {
      closeSession(session, 'Companion mobile client disconnected');
      await runtime.deleteSession(session.runtimeRunId).catch(() => undefined);
    } finally {
      session.active = false;
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
      const { runId: clientRunId, prompt, telemetry } = validation;
      const messageId = validation.messageId || crypto.randomUUID();
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
        const browserTools = new CompanionBrowserToolBroker({
          available: () => sessions.get(key) === createdSession,
          unavailableMessage: 'Companion mobile client disconnected',
          dispatch: (call) =>
            emit(createdSession, {
              type: 'tool_call',
              messageId: createdSession.activeMessageId,
              ...call,
            }),
        });
        createdSession = {
          clientRunId,
          runtimeRunId: `mesh:${crypto.randomUUID()}`,
          sourceDeviceId,
          generation: 0,
          browserTools,
          eventQueue: Promise.resolve(),
          prompts: [],
          activeMessageId: '',
          active: false,
        };
        session = createdSession;
        sessions.set(key, session);
      }
      session.prompts.push({
        prompt,
        messageId,
        telemetry,
        receivedAtEpochMs: Date.now(),
        receivedAtMonotonicMs: performance.now(),
      });
      if (!session.active) {
        session.active = true;
        session.generation += 1;
        try {
          session.activeMessageId = messageId;
          await emit(session, { type: 'status', messageId, status: 'working' });
        } catch (error) {
          closeSession(session, 'Companion mobile client disconnected');
          await runtime.deleteSession(session.runtimeRunId).catch(() => undefined);
          throw error;
        }
        void drainSession(session, true);
      }
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
