import {
  parseCompanionProposalText,
  type CompanionProposalChatOverrides,
} from '@drone/assistant-chat';

type CatalogModel = {
  agent: string;
  provider?: CompanionProposalChatOverrides['provider'];
  runtime: string;
  id: string;
  label: string;
  reasoningLevels: string[];
};

const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ');

/** Only successful catalog tool responses may populate proposal model choices. */
export class CompanionProposalModels {
  private catalogs = new Map<string, CatalogModel[]>();

  remember(value: unknown): void {
    const data = value as any;
    if (data?.ok !== true || !Array.isArray(data.models)) return;
    if (!['native', 'cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'].includes(data.agent)) return;
    const agent = data.agent === 'native' ? 'native' : `builtin:${data.agent}`;
    const models: CatalogModel[] = data.models.flatMap((model: any) => {
      const provider = model.provider ?? data.provider;
      if (typeof model.id !== 'string' || !model.id.trim()) return [];
      if (agent === 'native' && !['openai', 'codex', 'gemini', 'openrouter'].includes(provider)) return [];
      return [{
        agent,
        ...(agent === 'native' ? { provider } : {}),
        runtime: data.runtime,
        id: model.id,
        label: typeof model.label === 'string' ? model.label : model.id,
        reasoningLevels: Array.isArray(model.reasoningLevels) ? model.reasoningLevels : [],
      }];
    });
    this.catalogs.set(JSON.stringify([agent, data.provider, data.runtime]), models);
  }

  validate(content: string): void {
    const proposal = parseCompanionProposalText(content);
    for (const operation of proposal.operations) {
      if ((operation.type !== 'create_drone' && operation.type !== 'create_chat') || !operation.model) continue;
      const reference = words(operation.model);
      const candidates = [...this.catalogs.values()].flat().filter((model) =>
        (!operation.agent || operation.agent === model.agent) &&
        (!operation.provider || operation.provider === model.provider) &&
        (!(operation.type === 'create_drone' && operation.runtime) || operation.runtime === model.runtime),
      );
      const exact = candidates.filter((model) => model.id.toLowerCase() === operation.model!.toLowerCase());
      const matches = exact.length ? exact : candidates.filter((model) =>
        reference && [words(model.id), words(model.label)].some((name) =>
          name === reference || ` ${name} `.includes(` ${reference} `)),
      );
      const unique = [...new Map(matches.map((model) => [JSON.stringify([model.agent, model.provider, model.id, model.reasoningLevels]), model])).values()];
      if (unique.length !== 1) {
        throw new Error(`Cannot resolve model "${operation.model}" unambiguously for ${operation.id}. Read list_agent_models for the intended agent/runtime; ask the user or leave the setting unchanged if unresolved. Never guess a model identifier.`);
      }
      const selected = unique[0]!;
      const reasoning = operation.reasoning?.toLowerCase();
      if (reasoning && !selected.reasoningLevels.includes(reasoning)) {
        throw new Error(`Reasoning "${operation.reasoning}" is not reported for ${selected.agent}/${selected.id}. Ask the user or omit the reasoning override.`);
      }
      const correction = {
        agent: selected.agent,
        model: selected.id,
        ...(selected.provider ? { provider: selected.provider } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
      if (
        operation.agent !== selected.agent || operation.model !== selected.id ||
        operation.provider !== selected.provider || operation.reasoning !== reasoning
      ) {
        throw new Error(`Invalid model configuration for ${operation.id}. Revise the proposal using the catalog configuration: ${JSON.stringify(correction)}. The proposal has not been changed; submit a corrected patch.`);
      }
    }
  }
}
