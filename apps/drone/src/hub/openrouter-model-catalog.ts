import type { Model } from '@mariozechner/pi-ai';
import { getHubSettingsRepository } from '../host/hub-settings-repository';
import { HUB_AGENT_MODEL_OPTIONS } from './llm-model-catalog';

const KEY = 'llm.openrouter-models';
type Catalog = { updatedAt: string; models: Model<'openai-completions'>[] };
const bundled = HUB_AGENT_MODEL_OPTIONS.filter((option) => option.provider === 'openrouter');
let activeModels = new Map<string, Model<'openai-completions'>>();

export function parseOpenRouterModels(data: unknown): Model<'openai-completions'>[] {
  if (!data || !Array.isArray((data as any).data)) throw new Error('Invalid OpenRouter model catalog');
  const result = new Map<string, Model<'openai-completions'>>();
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
    result.set(item.id, {
      id: item.id, name: typeof item.name === 'string' ? item.name : item.id,
      provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1',
      reasoning: item.supported_parameters.includes('reasoning'),
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
    const levels = model.reasoning ? ['off', 'low', 'medium', 'high'] as const : ['off'] as const;
    for (const thinkingLevel of levels) options.push({ provider: 'openrouter', id: model.id, name: model.name, thinkingLevel });
  }
  const others = HUB_AGENT_MODEL_OPTIONS.filter((option) => option.provider !== 'openrouter');
  HUB_AGENT_MODEL_OPTIONS.splice(0, HUB_AGENT_MODEL_OPTIONS.length, ...others, ...options);
}

export async function loadOpenRouterCatalog() {
  const catalog = (await getHubSettingsRepository()).get<Catalog>(KEY)?.value ?? null;
  install(catalog);
  return { updatedAt: catalog?.updatedAt ?? null, count: catalog?.models.length ?? 0 };
}

export async function refreshOpenRouterCatalog(fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`OpenRouter model refresh failed (${response.status})`);
  const models = parseOpenRouterModels(await response.json());
  const catalog = { updatedAt: new Date().toISOString(), models };
  await (await getHubSettingsRepository()).put(KEY, catalog);
  install(catalog);
  return { updatedAt: catalog.updatedAt, count: models.length };
}

export function cachedOpenRouterModel(provider: string, id: string) {
  return provider === 'openrouter' ? activeModels.get(id) : undefined;
}
