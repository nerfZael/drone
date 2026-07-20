import {
  DEFAULT_DRONE_NAME_MODEL_ID,
  jobsPlanFromAgentMessage,
  suggestDroneNameFromMessage,
} from '../jobs-from-message';
import { providerDisplayName, type LlmProviderId } from '../hub-settings';
import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

type HubLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void;

export interface MessageRouteDependencies {
  resolveEffectiveLlmProvider: ServiceFunction;
  resolveEffectiveProviderApiKeySettings: ServiceFunction;
  resolveNameSuggestionLlmSettings: ServiceFunction;
  logProviderApiKeyResolution: ServiceFunction;
  llmProviderEnvLogMeta: ServiceFunction;
  normalizeDroneIdentity: ServiceFunction;
  hubLog: HubLog;
}

export function registerMessageRoutes(apiRouter: HubRouter, deps: MessageRouteDependencies): void {
  const {
    resolveEffectiveLlmProvider,
    resolveEffectiveProviderApiKeySettings,
    resolveNameSuggestionLlmSettings,
    logProviderApiKeyResolution,
    llmProviderEnvLogMeta,
    normalizeDroneIdentity,
    hubLog,
  } = deps;

  apiRouter.post('/api/jobs/from-message', async ({ method, url, readJson, fail, json }) => {
    const message = String((await readJson<any>())?.message ?? '').trim();
    if (!message) return fail(400, 'missing message');

    let selectedProvider: LlmProviderId | null = null;
    try {
      const { provider } = await resolveEffectiveLlmProvider();
      selectedProvider = provider;
      const resolved = await resolveEffectiveProviderApiKeySettings(provider);
      if (!resolved.apiKey) {
        await logProviderApiKeyResolution(
          'warn',
          'jobs/from-message rejected: missing provider key',
          provider,
          { pathname: url.pathname, method },
        );
        json(412, {
          ok: false,
          error: `Missing ${providerDisplayName(provider)} API key. Configure it in Settings.`,
        });
        return;
      }
      const plan = await jobsPlanFromAgentMessage(message, {
        provider,
        apiKey: resolved.apiKey,
      });
      json(200, {
        ok: true,
        group: typeof plan?.group === 'string' ? plan.group : 'jobs',
        jobs: Array.isArray(plan?.jobs) ? plan.jobs : [],
      });
    } catch (error) {
      if (selectedProvider) {
        await logProviderApiKeyResolution(
          'error',
          'jobs/from-message request failed',
          selectedProvider,
          { pathname: url.pathname, method, error: errorMessage(error) },
        );
      }
      json(500, { ok: false, error: errorMessage(error) });
    }
  });

  apiRouter.post('/api/drones/name-from-message', async ({ method, url, readJson, fail, json }) => {
    const body = await readJson<any>();
    const message = String(body?.message ?? '').trim();
    if (!message) return fail(400, 'missing message');

    const sourceRaw = typeof body?.source === 'string' ? body.source.trim() : '';
    const source = sourceRaw ? sourceRaw.slice(0, 64) : null;
    const requestedDroneId = normalizeDroneIdentity(String(body?.droneId ?? '').trim()) || null;
    const messageLength = message.length;
    let selectedProvider: LlmProviderId | null = null;
    try {
      const { provider, ...resolved } = await resolveNameSuggestionLlmSettings();
      selectedProvider = provider;
      if (!resolved.apiKey) {
        await logProviderApiKeyResolution(
          'warn',
          'name-from-message rejected: missing Codex connection and OpenAI key',
          provider,
          { pathname: url.pathname, method, source, requestedDroneId, messageLength },
        );
        json(412, {
          ok: false,
          error: 'Connect Codex or configure an OpenAI API key in Settings.',
        });
        return;
      }
      const name = await suggestDroneNameFromMessage(message, {
        provider,
        apiKey: resolved.apiKey,
        style: source === 'draft-create' ? 'identifier' : 'display',
      });
      if (source || requestedDroneId) {
        hubLog('info', 'name-from-message suggested', {
          provider,
          source,
          requestedDroneId,
          suggestedName: name,
          messageLength,
        });
      }
      json(200, { ok: true, name });
    } catch (error) {
      const details = {
        source,
        requestedDroneId,
        messageLength,
        model: DEFAULT_DRONE_NAME_MODEL_ID,
        error: errorMessage(error),
      };
      if (selectedProvider) {
        await logProviderApiKeyResolution(
          'error',
          'name-from-message request failed',
          selectedProvider,
          { pathname: url.pathname, method, ...details },
        );
      } else {
        hubLog('error', 'name-from-message request failed', {
          ...llmProviderEnvLogMeta(),
          ...details,
        });
      }
      json(500, { ok: false, error: errorMessage(error) });
    }
  });
}
