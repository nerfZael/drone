import { saveCodexOpenRouterCatalog } from './codex-openrouter-catalog';
import type { Model } from '@mariozechner/pi-ai';
import { getHubSettingsRepository } from '../host/hub-settings-repository';
import { HUB_AGENT_MODEL_OPTIONS } from './llm-model-catalog';
import { openRouterReasoningCapabilities } from './openrouter-reasoning';
import type { NativeAgentThinkingLevel } from '@drone/assistant-chat';

const KEY = 'llm.openrouter-models';
type OpenRouterCatalogModel = Model<'openai-completions'> & {
  reasoningLevels?: NativeAgentThinkingLevel[];
  defaultReasoningLevel?: NativeAgentThinkingLevel;
};
type Catalog = { schemaVersion?: 2; updatedAt: string; models: OpenRouterCatalogModel[] };
const bundled = HUB_AGENT_MODEL_OPTIONS.filter((option) => option.provider === 'openrouter');
let activeModels = new Map<string, OpenRouterCatalogModel>();
const legacyRefreshAttempts = new WeakSet<object>();

export function parseOpenRouterModels(data: unknown): OpenRouterCatalogModel[] {
  if (!data || !Array.isArray((data as any).data)) throw new Error('Invalid OpenRouter model catalog');
  const result = new Map<string, OpenRouterCatalogModel>();
  for (const item of (data as any).data) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() ||
        !Array.isArray(item.supported_parameters) || !item.supported_parameters.includes('tools')) continue;
    const contextWindow = Number(item.context_length);
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) continue;
    const price = (value: unknown) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : 0;
    };
    const output = Number(item.top_provider?.max_completion_tokens);
    const reasoning = openRouterReasoningCapabilities(item);
    result.set(item.id, {
      id: item.id, name: typeof item.name === 'string' ? item.name : item.id,
      provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1',
      reasoning: reasoning.enabled,
      reasoningLevels: reasoning.levels,
      defaultReasoningLevel: reasoning.defaultLevel,
      ...(reasoning.thinkingLevelMap ? { thinkingLevelMap: reasoning.thinkingLevelMap } : {}),
      input: item.architecture?.input_modalities?.includes('image') ? ['text', 'image'] : ['text'],
      contextWindow, maxTokens: Number.isFinite(output) && output > 0 ? Math.min(output, contextWindow) : Math.min(4096, contextWindow),
      cost: { input: price(item.pricing?.prompt), output: price(item.pricing?.completion),
        cacheRead: price(item.pricing?.input_cache_read), cacheWrite: price(item.pricing?.input_cache_write) },
    });
  }
  if (!result.size) throw new Error('OpenRouter returned no usable tool-capable models');
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function install(catalog: Catalog | null) {
  activeModels = new Map((catalog?.models ?? []).map((model) => [model.id, model]));
  const options = [...bundled.filter((option) => !activeModels.has(option.id))];
  for (const model of activeModels.values()) {
    const levels = model.reasoningLevels ?? (model.reasoning ? ['off', 'low', 'medium', 'high'] as const : ['off'] as const);
    for (const thinkingLevel of levels) options.push({
      provider: 'openrouter', id: model.id, name: model.name, thinkingLevel,
      defaultReasoningLevel: model.defaultReasoningLevel,
    });
  }
  const others = HUB_AGENT_MODEL_OPTIONS.filter((option) => option.provider !== 'openrouter');
  HUB_AGENT_MODEL_OPTIONS.splice(0, HUB_AGENT_MODEL_OPTIONS.length, ...others, ...options);
}

export async function loadOpenRouterCatalog() {
  const repository = await getHubSettingsRepository();
  const catalog = repository.get<Catalog>(KEY)?.value ?? null;
  if (catalog && catalog.schemaVersion !== 2 && !legacyRefreshAttempts.has(repository)) {
    legacyRefreshAttempts.add(repository);
    try {
      return await refreshOpenRouterCatalog();
    } catch {
      // Keep the previous catalog usable while offline; a manual refresh can retry later.
    }
  }
  install(catalog);
  return { updatedAt: catalog?.updatedAt ?? null, count: catalog?.models.length ?? 0 };
}

export async function refreshOpenRouterCatalog(fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`OpenRouter model refresh failed (${response.status})`);
  const data = await response.json();
  const models = parseOpenRouterModels(data);
  await saveCodexOpenRouterCatalog(data);
  const catalog = { schemaVersion: 2 as const, updatedAt: new Date().toISOString(), models };
  await (await getHubSettingsRepository()).put(KEY, catalog);
  install(catalog);
  return { updatedAt: catalog.updatedAt, count: models.length };
}

export function cachedOpenRouterModel(provider: string, id: string) {
  return provider === 'openrouter' ? activeModels.get(id) : undefined;
}
