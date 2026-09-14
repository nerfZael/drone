import { toBlipModelProvider } from '../hub-settings';
import { cachedOpenRouterModel, loadOpenRouterCatalog } from '../openrouter-model-catalog';
import { discoveredCodexModel, loadCodexCatalog } from '../codex-model-catalog';
import { loadBlipNodeRuntime } from './blip-runtime-loader';

export async function resolveNativeModel(providerId: string, modelId: string, catalogsLoaded = false) {
  const provider = toBlipModelProvider(providerId);
  if (!catalogsLoaded) await Promise.all([loadOpenRouterCatalog(), loadCodexCatalog()]);
  const cached = cachedOpenRouterModel(provider, modelId);
  if (cached) return cached;
  const runtime = await loadBlipNodeRuntime();
  try { return runtime.resolveBlipModel(provider, modelId); }
  catch (error) {
    const discovered = discoveredCodexModel(provider, modelId);
    if (discovered) return discovered;
    throw error;
  }
}
