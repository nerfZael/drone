import type { ExternalAgentModelCatalogModel } from '@drone/assistant-chat';
import { CODEX_OPENROUTER_PREFIX } from '../codex-model-routing';
import { getHubSettingsRepository, type HubSettingsRepository } from '../host/hub-settings-repository';

type Catalog = { models: ExternalAgentModelCatalogModel[]; updatedAt: string };
const KEY = 'llm.codex-openrouter-models';
const TTL = 6 * 60 * 60 * 1000;
const pending = new WeakMap<HubSettingsRepository, Promise<Catalog>>();

export function parseCodexOpenRouterModels(data: unknown): ExternalAgentModelCatalogModel[] {
  if (!data || !Array.isArray((data as any).data)) throw new Error('Invalid OpenRouter model catalog');
  const models = new Map<string, ExternalAgentModelCatalogModel>();
  for (const item of (data as any).data) {
    if (typeof item?.id !== 'string' || !item.id.trim()) continue;
    const id = CODEX_OPENROUTER_PREFIX + item.id.trim();
    const parameters = Array.isArray(item.supported_parameters) ? item.supported_parameters : [];
    const reasoning = parameters.includes('reasoning');
    const tools = parameters.includes('tools');
    models.set(id, {
      id,
      label: `${item.name || item.id} · OpenRouter${tools ? '' : ' · tool support not advertised'}`,
      reasoningLevels: reasoning ? ['low', 'medium', 'high'] : [],
      defaultReasoningLevel: reasoning ? 'medium' : '',
    });
  }
  if (!models.size) throw new Error('OpenRouter returned no models');
  return [...models.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function getCodexOpenRouterCatalog(forceRefresh = false, fetcher: typeof fetch = fetch) {
  const repository = await getHubSettingsRepository();
  const cached = repository.get<Catalog>(KEY)?.value;
  if (!forceRefresh && cached && Date.now() - Date.parse(cached.updatedAt) < TTL) return cached;
  try {
    let refresh = pending.get(repository);
    if (!refresh) {
      refresh = (async () => {
        const response = await fetcher('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`OpenRouter model refresh failed (${response.status})`);
        return await saveCodexOpenRouterCatalog(await response.json(), repository);
      })().finally(() => { pending.delete(repository); });
      pending.set(repository, refresh);
    }
    return await refresh;
  } catch (error) {
    return { models: cached?.models ?? [], updatedAt: cached?.updatedAt, stale: true,
      error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveCodexOpenRouterCatalog(data: unknown, repository?: HubSettingsRepository): Promise<Catalog> {
  const catalog = { models: parseCodexOpenRouterModels(data), updatedAt: new Date().toISOString() };
  await (repository ?? await getHubSettingsRepository()).put(KEY, catalog);
  return catalog;
}
