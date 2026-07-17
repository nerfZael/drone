type NativeModelOption = {
  provider?: unknown;
  id?: unknown;
  name?: unknown;
  thinkingLevel?: unknown;
};

type NativeDefaultModel = {
  provider?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
};

export type NativeModelCatalogEntry = {
  provider: string;
  id: string;
  label: string;
  reasoningLevels: string[];
  defaultReasoningLevel: string;
};

export function buildNativeModelCatalog(
  models: readonly NativeModelOption[],
  defaultModel?: NativeDefaultModel,
): NativeModelCatalogEntry[] {
  const grouped = new Map<string, NativeModelCatalogEntry>();
  for (const model of models) {
    const provider = String(model?.provider ?? '').trim();
    const id = String(model?.id ?? '').trim();
    if (!provider || !id) continue;
    const key = `${provider}\u0000${id}`;
    const thinkingLevel = String(model?.thinkingLevel ?? '').trim() || 'off';
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.reasoningLevels.includes(thinkingLevel))
        existing.reasoningLevels.push(thinkingLevel);
      continue;
    }
    grouped.set(key, {
      provider,
      id,
      label: String(model?.name ?? id).trim() || id,
      reasoningLevels: [thinkingLevel],
      defaultReasoningLevel: thinkingLevel,
    });
  }

  const defaultProvider = String(defaultModel?.provider ?? '').trim();
  const defaultId = String(defaultModel?.model ?? '').trim();
  const defaultThinkingLevel = String(defaultModel?.thinkingLevel ?? '').trim();
  const configured = grouped.get(`${defaultProvider}\u0000${defaultId}`);
  if (configured?.reasoningLevels.includes(defaultThinkingLevel)) {
    configured.defaultReasoningLevel = defaultThinkingLevel;
  }
  return [...grouped.values()];
}
