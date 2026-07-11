import {
  providerDisplayName,
  resolveEffectiveProviderApiKeySettings,
  type LlmProviderId,
} from '../hub-settings';
import { defaultHubLlmModelId, resolveHubLlmRuntime } from '../llm-runtime';

export type GeneratedAssistantOverview = {
  markdown: string;
  provider: LlmProviderId;
  model: string;
};

export async function generateAssistantOverview(input: {
  provider: LlmProviderId;
  instructions: string;
  threadInput: string;
}): Promise<GeneratedAssistantOverview> {
  const providerSettings = await resolveEffectiveProviderApiKeySettings(input.provider);
  if (!providerSettings.apiKey) {
    throw new Error(
      `Missing ${providerDisplayName(input.provider)} API key. Configure it in Settings.`,
    );
  }

  const runtime = await resolveHubLlmRuntime({
    provider: input.provider,
    apiKey: providerSettings.apiKey,
  });
  const model =
    String(process.env.DRONE_HUB_ASSISTANT_OVERVIEW_MODEL ?? '').trim() ||
    defaultHubLlmModelId(input.provider, 'small');
  const schema = runtime.z.object({
    markdown: runtime.z
      .string()
      .min(1)
      .describe('A concise Markdown overview of the assistant thread state.'),
  });
  const prompt = [
    'Overview instructions:',
    input.instructions,
    '',
    'Assistant thread input:',
    input.threadInput,
    '',
    'Return Markdown only in the markdown field.',
  ].join('\n');
  const { object } = await runtime.generateObject({
    model: runtime.modelFactory(model),
    schema,
    system:
      'You summarize assistant thread state for a developer operations UI. Return only the requested structured output.',
    prompt,
    temperature: 0.2,
    maxRetries: 2,
  });

  const markdown = String((object as any)?.markdown ?? '').trim();
  if (!markdown) throw new Error('overview generation returned empty markdown');
  return { markdown, provider: input.provider, model };
}
