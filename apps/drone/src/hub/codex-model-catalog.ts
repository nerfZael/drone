import type { Model } from '@mariozechner/pi-ai';
import { getHubSettingsRepository } from '../host/hub-settings-repository';
import type { AgentModelCatalogModel } from './agent-model-catalog/types';
import { HUB_AGENT_MODEL_OPTIONS, type HubAgentModelOption } from './llm-model-catalog';

const KEY = 'llm.codex-models';
const bundled = HUB_AGENT_MODEL_OPTIONS.filter((option) => option.provider === 'codex');
let models: AgentModelCatalogModel[] = [];
const supported = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export async function saveCodexCatalog(next: AgentModelCatalogModel[]) {
  if (next.length) await (await getHubSettingsRepository()).put(KEY, next);
}

export async function loadCodexCatalog() {
  models = (await getHubSettingsRepository()).get<AgentModelCatalogModel[]>(KEY)?.value ?? [];
  const discovered: HubAgentModelOption[] = models.flatMap((model) => {
    const levels = model.reasoningLevels.filter((level) => supported.has(level));
    return (levels.length ? levels : ['off']).map((thinkingLevel) => ({
      provider: 'codex' as const, id: model.id, name: model.label,
      thinkingLevel: thinkingLevel as HubAgentModelOption['thinkingLevel'],
      ...(levels.includes(model.defaultReasoningLevel)
        ? { defaultReasoningLevel: model.defaultReasoningLevel as HubAgentModelOption['thinkingLevel'] }
        : {}),
    }));
  });
  const ids = new Set(models.map((model) => model.id));
  const others = HUB_AGENT_MODEL_OPTIONS.filter((option) => option.provider !== 'codex');
  HUB_AGENT_MODEL_OPTIONS.splice(0, HUB_AGENT_MODEL_OPTIONS.length,
    ...others, ...discovered, ...bundled.filter((option) => !ids.has(option.id)));
}

// Selection discovery does not include verified token limits. Never manufacture
// a model budget: callers must use the bundled runtime metadata or reject it.
export function discoveredCodexModel(provider: string, id: string): Model<'openai-codex-responses'> | undefined {
  if (provider !== 'codex' && provider !== 'openai-codex') return undefined;
  if (!models.some((item) => item.id === id)) return undefined;
  throw new Error(`Token limits are unavailable for ${id}. Choose a model with known limits; the current conversation has been kept.`);
}
