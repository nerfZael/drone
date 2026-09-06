import {
  DEFAULT_DRONE_NAME_MODEL_ID,
  retryTemporaryNameSuggestion,
  suggestDroneNameFromMessage,
} from '../drone-name-from-message';
import type { LlmProviderId } from '../hub-settings';
import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

type HubLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void;

export interface MessageRouteDependencies {
  resolveNameSuggestionLlmSettings: ServiceFunction;
  logProviderApiKeyResolution: ServiceFunction;
  llmProviderEnvLogMeta: ServiceFunction;
  normalizeDroneIdentity: ServiceFunction;
  hubLog: HubLog;
}

export function registerMessageRoutes(apiRouter: HubRouter, deps: MessageRouteDependencies): void {
  const {
    resolveNameSuggestionLlmSettings,
    logProviderApiKeyResolution,
    llmProviderEnvLogMeta,
    normalizeDroneIdentity,
    hubLog,
  } = deps;

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
          'name-from-message rejected: missing naming provider credentials',
          provider,
          { pathname: url.pathname, method, source, requestedDroneId, messageLength },
        );
        json(412, {
          ok: false,
          error: `Configure credentials for the automatic naming provider (${provider}) in Settings.`,
        });
        return;
      }
      const suggest = () =>
        suggestDroneNameFromMessage(message, {
          provider,
          apiKey: resolved.apiKey,
          style: source === 'draft-create' ? 'identifier' : 'display',
        });
      const name = source?.endsWith('auto-rename')
        ? await retryTemporaryNameSuggestion(suggest, {
            onRetry: ({ attempt, delayMs, error }) => {
              hubLog('warn', 'name-from-message temporary failure; retrying', {
                provider,
                source,
                requestedDroneId,
                attempt,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
              });
            },
          })
        : await suggest();
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
