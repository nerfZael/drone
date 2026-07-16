import { GROQ_TRANSCRIPTION_MAX_BYTES, transcribeAudioWithGroq } from '../groq-transcription';
import { errorMessage, readRawBody } from '../hub-http';
import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

export interface OperationalRouteDependencies {
  resolveDroneOrPendingForReadRef: ServiceFunction;
  loadCanonicalActiveModel: ServiceFunction;
  summarizeAssistantChatIdle: ServiceFunction;
  resolveGroqApiKeySettings: ServiceFunction;
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
  } = deps;

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
    try {
      const groqSettings = await resolveGroqApiKeySettings();
      if (!groqSettings.apiKey) {
        json(400, {
          ok: false,
          error: 'GROQ API key is not configured. Add it in Drone Hub settings.',
        });
        return;
      }
      const audio = await readRawBody(req, { maxBytes: GROQ_TRANSCRIPTION_MAX_BYTES });
      const mimeType =
        String(req.headers['content-type'] ?? '')
          .split(';')[0]
          ?.trim() || 'audio/webm';
      const transcription = await transcribeAudioWithGroq({
        audio,
        apiKey: groqSettings.apiKey,
        mimeType,
      });
      json(200, { ok: true, ...transcription });
    } catch (error) {
      const message = errorMessage(error);
      const status = /too large/i.test(message)
        ? 413
        : /GROQ API key is not configured/i.test(message)
          ? 400
          : 502;
      json(status, { ok: false, error: message });
    }
  });
}
