import {
  DEFAULT_DRONE_NAME_MODEL_ID,
  jobsPlanFromAgentMessage,
  suggestDroneNameFromMessage,
} from '../jobs-from-message';
import { suggestReplyToAgentMessage } from '../agent-suggestion';
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
  resolveEffectiveAgentSuggestionSettings: ServiceFunction;
  resolveNameSuggestionLlmSettings: ServiceFunction;
  logProviderApiKeyResolution: ServiceFunction;
  llmProviderEnvLogMeta: ServiceFunction;
  normalizeDroneIdentity: ServiceFunction;
  hubLog: HubLog;
}

function normalizeMessageContext(body: any) {
  return {
    prompt: typeof body?.prompt === 'string' ? body.prompt : '',
    response: String(body?.response ?? '').trim(),
    context: (Array.isArray(body?.context) ? body.context : [])
      .map((turn: any) => ({
        turn: typeof turn?.turn === 'number' ? turn.turn : Number(turn?.turn ?? 0) || 0,
        prompt: String(turn?.prompt ?? ''),
        response: String(turn?.response ?? ''),
      }))
      .filter((turn: any) => typeof turn.response === 'string'),
  };
}

export function registerMessageRoutes(apiRouter: HubRouter, deps: MessageRouteDependencies): void {
  const {
    resolveEffectiveLlmProvider,
    resolveEffectiveProviderApiKeySettings,
    resolveEffectiveAgentSuggestionSettings,
    resolveNameSuggestionLlmSettings,
    logProviderApiKeyResolution,
    llmProviderEnvLogMeta,
    normalizeDroneIdentity,
    hubLog,
  } = deps;

  apiRouter.post(
    '/api/agent-suggestion/from-message',
    async ({ method, url, readJson, fail, json }) => {
      const input = normalizeMessageContext(await readJson());
      if (!input.response) return fail(400, 'missing response');

      let selectedProvider: LlmProviderId | null = null;
      try {
        const { provider } = await resolveEffectiveLlmProvider();
        selectedProvider = provider;
        const resolved = await resolveEffectiveProviderApiKeySettings(provider);
        if (!resolved.apiKey) {
          await logProviderApiKeyResolution(
            'warn',
            'agent-suggestion/from-message rejected: missing provider key',
            provider,
            { pathname: url.pathname, method },
          );
          json(412, {
            ok: false,
            error: `Missing ${providerDisplayName(provider)} API key. Configure it in Settings.`,
          });
          return;
        }
        const settings = await resolveEffectiveAgentSuggestionSettings();
        const result = await suggestReplyToAgentMessage(
          { ...input, policyMarkdown: settings.policyMarkdown },
          { provider, apiKey: resolved.apiKey },
        );
        json(200, {
          ok: true,
          outcome: result.outcome,
          suggestion: result.outcome === 'suggest' ? result.suggestion : null,
          reason: result.reason,
          kind: result.kind,
          policyFingerprint: settings.policyFingerprint,
        });
      } catch (error) {
        const details = {
          model: String(process.env.DRONE_HUB_AGENT_SUGGESTION_MODEL ?? '').trim() || null,
          error: errorMessage(error),
        };
        if (selectedProvider) {
          await logProviderApiKeyResolution(
            'error',
            'agent-suggestion/from-message request failed',
            selectedProvider,
            { pathname: url.pathname, method, ...details },
          );
        } else {
          hubLog('error', 'agent-suggestion/from-message request failed', {
            ...llmProviderEnvLogMeta(),
            ...details,
          });
        }
        json(500, { ok: false, error: errorMessage(error) });
      }
    },
  );

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
