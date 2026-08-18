import { GROQ_TRANSCRIPTION_MAX_BYTES, transcribeAudioWithGroq } from '../groq-transcription';
import {
  createSpeechJobId,
  normalizeGroqSpeechRequest,
  synthesizeSpeechWithGroq,
} from '../groq-speech';
import { errorMessage, readRawBody } from '../hub-http';
import type { HubRouter } from '../hub-router';
import type { CompanionTelemetryService } from '../companion/companion-telemetry';

type ServiceFunction = (...args: any[]) => any;
const GROQ_SPEECH_TIMEOUT_MS = 30_000;
const GROQ_SPEECH_QUEUE_MAX_JOBS = 100;
const CHAT_LOAD_MILESTONES = new Set([
  'click',
  'selection_committed',
  'cached_content_available',
  'config_loaded',
  'config_failed',
  'primary_content_loaded',
  'primary_content_failed',
  'content_committed',
  'content_painted',
  'timed_out',
]);

function boundedTelemetryText(value: unknown, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return '';
  return text;
}

function boundedTelemetryMs(value: unknown, max = 300_000): number | undefined {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0 || duration > max) return undefined;
  return Math.round(duration * 10) / 10;
}

export function normalizeChatLoadTelemetry(raw: unknown): Record<string, unknown> | null {
  const body = raw && typeof raw === 'object' ? (raw as any) : null;
  if (!body || body.version !== 1) return null;
  const navigationId = boundedTelemetryText(body.navigationId, 128);
  const droneId = boundedTelemetryText(body.target?.droneId, 160);
  const chatName = boundedTelemetryText(body.target?.chatName, 160);
  const durationMs = boundedTelemetryMs(body.durationMs);
  const startedAt = boundedTelemetryText(body.startedAt, 64);
  const source = ['drone', 'chat', 'programmatic'].includes(body.source) ? body.source : null;
  const status = ['completed', 'error', 'superseded', 'timeout'].includes(body.status)
    ? body.status
    : null;
  const surface = ['transcript', 'cli', 'native', 'unavailable'].includes(body.surface)
    ? body.surface
    : null;
  if (!navigationId || !droneId || !chatName || durationMs === undefined || !source || !status) {
    return null;
  }
  const milestones = Object.fromEntries(
    Object.entries(body.milestones && typeof body.milestones === 'object' ? body.milestones : {})
      .filter(([name]) => CHAT_LOAD_MILESTONES.has(name))
      .flatMap(([name, value]) => {
        const duration = boundedTelemetryMs(value);
        return duration === undefined ? [] : [[name, duration]];
      }),
  );
  const requests = (Array.isArray(body.requests) ? body.requests : [])
    .slice(0, 24)
    .flatMap((item: any) => {
      const name = boundedTelemetryText(item?.name, 48);
      const requestDurationMs = boundedTelemetryMs(item?.durationMs);
      const startMs = boundedTelemetryMs(item?.startMs);
      const outcome = ['completed', 'error', 'aborted'].includes(item?.outcome)
        ? item.outcome
        : null;
      if (!name || requestDurationMs === undefined || startMs === undefined || !outcome) return [];
      const serverTiming = Object.fromEntries(
        Object.entries(
          item?.serverTiming && typeof item.serverTiming === 'object' ? item.serverTiming : {},
        )
          .slice(0, 24)
          .flatMap(([phase, value]) => {
            const phaseName = boundedTelemetryText(phase, 48);
            const phaseDuration = boundedTelemetryMs(value);
            return phaseName && phaseDuration !== undefined ? [[phaseName, phaseDuration]] : [];
          }),
      );
      const optionalDuration = (value: unknown) => boundedTelemetryMs(value);
      const statusCode = Number(item?.status);
      const responseBytes = Number(item?.responseBytes);
      return [
        {
          name,
          startMs,
          durationMs: requestDurationMs,
          outcome,
          ...(optionalDuration(item?.fetchMs) !== undefined
            ? { fetchMs: optionalDuration(item.fetchMs) }
            : {}),
          ...(optionalDuration(item?.bodyMs) !== undefined
            ? { bodyMs: optionalDuration(item.bodyMs) }
            : {}),
          ...(optionalDuration(item?.parseMs) !== undefined
            ? { parseMs: optionalDuration(item.parseMs) }
            : {}),
          ...(Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
            ? { status: statusCode }
            : {}),
          ...(Number.isSafeInteger(responseBytes) &&
          responseBytes >= 0 &&
          responseBytes <= 100_000_000
            ? { responseBytes }
            : {}),
          ...(Object.keys(serverTiming).length > 0 ? { serverTiming } : {}),
        },
      ];
    });
  const itemCount = Number(body.itemCount);
  return {
    version: 1,
    navigationId,
    source,
    target: { droneId, chatName },
    ...(startedAt ? { startedAt } : {}),
    durationMs,
    status,
    ...(surface ? { surface } : {}),
    agentKind: boundedTelemetryText(body.agentKind, 64) || null,
    runtime: body.runtime === 'host' || body.runtime === 'container' ? body.runtime : null,
    cacheStatus: ['hit', 'miss', 'none'].includes(body.cacheStatus)
      ? body.cacheStatus
      : 'none',
    ...(Number.isSafeInteger(itemCount) && itemCount >= 0 && itemCount <= 100_000
      ? { itemCount }
      : {}),
    milestones,
    requests,
  };
}

export interface OperationalRouteDependencies {
  resolveDroneOrPendingForReadRef: ServiceFunction;
  loadCanonicalActiveModel: ServiceFunction;
  summarizeAssistantChatIdle: ServiceFunction;
  resolveGroqApiKeySettings: ServiceFunction;
  resolveSpeechSettings: ServiceFunction;
  emitAssistantUiAction: ServiceFunction;
  hubLog: (
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
  companionTelemetry?: Pick<CompanionTelemetryService, 'recordTranscription'>;
}

export function registerOperationalRoutes(
  apiRouter: HubRouter,
  deps: OperationalRouteDependencies,
): void {
  const {
    resolveDroneOrPendingForReadRef,
    loadCanonicalActiveModel,
    summarizeAssistantChatIdle,
    resolveGroqApiKeySettings,
    resolveSpeechSettings,
    emitAssistantUiAction,
    hubLog,
    companionTelemetry,
  } = deps;
  let speechQueueTail: Promise<void> = Promise.resolve();
  let speechJobsInQueue = 0;

  const enqueueSpeechJob = (run: () => Promise<void>): number => {
    speechJobsInQueue += 1;
    const queuePosition = speechJobsInQueue;
    const job = speechQueueTail.then(run).finally(() => {
      speechJobsInQueue -= 1;
    });
    speechQueueTail = job.catch(() => {});
    return queuePosition;
  };

  const reserveSpeechQueueSlot = () => {
    if (speechJobsInQueue >= GROQ_SPEECH_QUEUE_MAX_JOBS) return null;
    let settlePreparation: (run: (() => Promise<void>) | null) => void = () => {};
    let settled = false;
    const prepared = new Promise<(() => Promise<void>) | null>((resolve) => {
      settlePreparation = resolve;
    });
    const queuePosition = enqueueSpeechJob(async () => {
      const run = await prepared;
      if (run) await run();
    });
    const settle = (run: (() => Promise<void>) | null) => {
      if (settled) return;
      settled = true;
      settlePreparation(run);
    };
    return {
      queuePosition,
      run: (job: () => Promise<void>) => settle(job),
      cancel: () => settle(null),
    };
  };

  apiRouter.post('/api/telemetry/chat-load', async ({ readJson, json }) => {
    const telemetry = normalizeChatLoadTelemetry(await readJson());
    if (!telemetry) {
      json(400, { ok: false, error: 'invalid chat load telemetry' });
      return;
    }
    hubLog(telemetry.status === 'completed' ? 'info' : 'warn', 'chat load timing', telemetry);
    json(202, { ok: true });
  });

  apiRouter.post('/api/chats/idle/status', async ({ readJson, json }) => {
    const body = await readJson<any>();
    const mode =
      String(body?.mode ?? 'all')
        .trim()
        .toLowerCase() === 'any'
        ? 'any'
        : 'all';
    const rawTargets = Array.isArray(body?.targets) ? body.targets : [];
    if (rawTargets.length === 0) {
      json(400, { ok: false, error: 'targets are required' });
      return;
    }

    const targets: Array<{ droneId: string; chatName: string }> = [];
    const seenTargets = new Set<string>();
    for (const rawTarget of rawTargets.slice(0, 20)) {
      const droneRef = String(rawTarget?.droneId ?? rawTarget?.drone ?? rawTarget?.id ?? '').trim();
      if (!droneRef) {
        json(400, { ok: false, error: 'target drone is required' });
        return;
      }
      const chatName =
        String(rawTarget?.chatName ?? rawTarget?.chat ?? 'default').trim() || 'default';
      const resolved = await resolveDroneOrPendingForReadRef(droneRef);
      if (!resolved) {
        json(404, { ok: false, error: `unknown drone: ${droneRef}` });
        return;
      }
      const key = `${resolved.id}\u0000${chatName}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      targets.push({ droneId: resolved.id, chatName });
    }
    if (targets.length === 0) {
      json(400, { ok: false, error: 'targets are required' });
      return;
    }

    try {
      const registry = await loadCanonicalActiveModel();
      const statuses = targets.map((target) =>
        summarizeAssistantChatIdle(registry, target, { requireChat: true }),
      );
      const matched =
        mode === 'any'
          ? statuses.some((status: any) => status.idle)
          : statuses.every((status: any) => status.idle);
      json(200, { ok: true, mode, matched, targets: statuses });
    } catch (error) {
      json(400, { ok: false, error: errorMessage(error) });
    }
  });

  apiRouter.post('/api/audio/transcriptions', async ({ req, json }) => {
    const messageIdRaw = String(req.headers['x-drone-companion-message-id'] ?? '').trim();
    const messageId =
      messageIdRaw &&
      messageIdRaw.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(messageIdRaw)
        ? messageIdRaw
        : '';
    const startedAt = performance.now();
    const phases: Record<string, number> = {};
    let audioBytes: number | undefined;
    let model: string | undefined;
    let telemetryStatus: 'completed' | 'error' = 'error';
    const measure = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      const phaseStartedAt = performance.now();
      try {
        return await operation();
      } finally {
        phases[name] = Math.max(0, Math.round((performance.now() - phaseStartedAt) * 10) / 10);
      }
    };
    try {
      const groqSettings: any = await measure<any>('settingsMs', () =>
        resolveGroqApiKeySettings(),
      );
      if (!groqSettings.apiKey) {
        json(400, {
          ok: false,
          error: 'GROQ API key is not configured. Add it in Drone Hub settings.',
        });
        return;
      }
      const audio = await measure('readBodyMs', () =>
        readRawBody(req, { maxBytes: GROQ_TRANSCRIPTION_MAX_BYTES }),
      );
      audioBytes = audio.length;
      const mimeType =
        String(req.headers['content-type'] ?? '')
          .split(';')[0]
          ?.trim() || 'audio/webm';
      const transcription = await measure('groqMs', () =>
        transcribeAudioWithGroq({
          audio,
          apiKey: groqSettings.apiKey,
          mimeType,
          quality:
            req.headers['x-drone-transcription-quality'] === 'accurate' ? 'accurate' : 'fast',
          language: String(req.headers['x-drone-transcription-language'] ?? '').trim() || null,
          prompt: (() => {
            const encoded = String(
              req.headers['x-drone-transcription-prompt-base64'] ?? '',
            ).trim();
            if (!encoded) return null;
            try {
              return (
                Buffer.from(encoded.slice(0, 8_000), 'base64')
                  .toString('utf8')
                  .slice(-1_200) || null
              );
            } catch {
              return null;
            }
          })(),
        }),
      );
      model = transcription.model;
      telemetryStatus = 'completed';
      json(200, { ok: true, ...transcription });
    } catch (error) {
      const message = errorMessage(error);
      const status = /too large/i.test(message)
        ? 413
        : /GROQ API key is not configured/i.test(message)
          ? 400
          : 502;
      json(status, { ok: false, error: message });
    } finally {
      if (messageId) {
        companionTelemetry?.recordTranscription(messageId, {
          durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
          ...(audioBytes !== undefined ? { audioBytes } : {}),
          ...(model ? { model } : {}),
          status: telemetryStatus,
          phases,
        });
      }
    }
  });

  apiRouter.post('/api/audio/speech', async ({ readJson, json }) => {
    let reservation: ReturnType<typeof reserveSpeechQueueSlot> | null = null;
    try {
      const body = await readJson<any>();
      reservation = reserveSpeechQueueSlot();
      if (!reservation) {
        json(429, { ok: false, error: 'Speech queue is full. Try again after it drains.' });
        return;
      }
      const speechSettings = await resolveSpeechSettings();
      if (!speechSettings.enabled) {
        reservation.cancel();
        json(409, { ok: false, error: 'Speech is disabled in Drone Hub settings.' });
        return;
      }
      const request = normalizeGroqSpeechRequest({
        text: body?.text,
        voice: body?.voice ?? speechSettings.voice,
      });
      const jobId = createSpeechJobId();
      const threadId = String(body?.threadId ?? '').trim() || undefined;
      if (speechSettings.muted) {
        reservation.cancel();
        json(202, {
          ok: true,
          jobId,
          status: 'muted',
          model: request.model,
          voice: request.voice,
        });
        return;
      }
      const groqSettings = await resolveGroqApiKeySettings();
      if (!groqSettings.apiKey) {
        reservation.cancel();
        json(400, {
          ok: false,
          error: 'GROQ API key is not configured. Add it in Drone Hub settings.',
        });
        return;
      }

      reservation.run(async () => {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | null = null;
        try {
          const currentSettings = await resolveSpeechSettings();
          if (!currentSettings.enabled || currentSettings.muted) {
            hubLog('info', 'Skipped queued speech job', {
              jobId,
              reason: currentSettings.enabled ? 'muted' : 'disabled',
            });
            return;
          }
          const currentGroqSettings = await resolveGroqApiKeySettings();
          if (!currentGroqSettings.apiKey) {
            throw new Error('GROQ API key is no longer configured.');
          }

          timeout = setTimeout(() => controller.abort(), GROQ_SPEECH_TIMEOUT_MS);
          timeout.unref?.();
          const audio = await synthesizeSpeechWithGroq({
            apiKey: currentGroqSettings.apiKey,
            request,
            signal: controller.signal,
          });
          const playbackSettings = await resolveSpeechSettings();
          if (!playbackSettings.enabled || playbackSettings.muted) {
            hubLog('info', 'Skipped synthesized speech playback', {
              jobId,
              reason: playbackSettings.enabled ? 'muted' : 'disabled',
            });
            return;
          }
          emitAssistantUiAction(
            {
              type: 'play_audio',
              jobId,
              data: audio.toString('base64'),
              mimeType: 'audio/wav',
              volume: playbackSettings.volume,
              at: new Date().toISOString(),
            },
            threadId,
          );
        } catch (error) {
          const message =
            error instanceof Error && error.name === 'AbortError'
              ? 'GROQ speech synthesis timed out.'
              : errorMessage(error);
          hubLog('error', 'GROQ speech job failed', { jobId, error: message });
          emitAssistantUiAction(
            {
              type: 'speech_error',
              jobId,
              message,
              at: new Date().toISOString(),
            },
            threadId,
          );
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      });
      json(202, {
        ok: true,
        jobId,
        status: 'queued',
        queuePosition: reservation.queuePosition,
        model: request.model,
        voice: request.voice,
      });
    } catch (error) {
      reservation?.cancel();
      json(400, { ok: false, error: errorMessage(error) });
    }
  });
}
