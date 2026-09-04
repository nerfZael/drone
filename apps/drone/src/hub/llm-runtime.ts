import {
  parseLlmProvider,
  providerDisplayName,
  type LlmProviderId,
} from './hub-settings';
import { DEFAULT_GEMINI_FLASH_MODEL_ID } from './llm-models';
import { DEFAULT_OPENROUTER_MODEL } from './llm-model-catalog';

export { providerDisplayName } from './hub-settings';

type GenerateObjectInput = {
  model: any;
  schema: any;
  system?: string;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
  reasoning?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  providerOptions?: Record<string, Record<string, unknown>>;
};

export type HubLlmRuntime = {
  provider: LlmProviderId;
  z: any;
  generateObject: (input: GenerateObjectInput) => Promise<{ object: any }>;
  modelFactory: (modelId: string) => any;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export function normalizeHubLlmProvider(raw: unknown): LlmProviderId {
  return parseLlmProvider(raw) ?? 'openai';
}

export function defaultHubLlmModelId(provider: LlmProviderId, purpose: 'small' | 'standard' = 'small'): string {
  if (provider === 'gemini') return DEFAULT_GEMINI_FLASH_MODEL_ID;
  if (provider === 'codex') return purpose === 'standard' ? 'gpt-5.3-codex' : 'gpt-5.3-codex-spark';
  if (provider === 'openrouter') return DEFAULT_OPENROUTER_MODEL;
  return purpose === 'standard' ? 'gpt-4o' : 'gpt-4o-mini';
}

function textFromAssistantMessage(message: any): string {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part: any) => (part?.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseJsonObject(raw: string): any {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('LLM returned an empty response');
  try {
    return JSON.parse(text);
  } catch {
    // continue to fenced/embedded JSON extraction
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return JSON.parse(fenced);

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('LLM response did not contain a JSON object');
}

function codexJsonSchemaInstruction(z: any, schema: any): string {
  if (!schema) return '';
  try {
    const jsonSchema =
      typeof z?.toJSONSchema === 'function'
        ? z.toJSONSchema(schema, { target: 'draft-07' })
        : typeof schema?.toJSONSchema === 'function'
          ? schema.toJSONSchema({ target: 'draft-07' })
          : null;
    return jsonSchema
      ? `Your response must match this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`
      : '';
  } catch {
    return '';
  }
}

export function codexObjectCompletionOptions(opts: {
  apiKey: string;
  reasoning?: GenerateObjectInput['reasoning'];
  maxRetries?: number;
}): Record<string, unknown> {
  return {
    apiKey: opts.apiKey,
    reasoningEffort: opts.reasoning ?? 'low',
    maxRetries: opts.maxRetries,
  };
}

async function generateCodexObject(apiKey: string, z: any, input: GenerateObjectInput): Promise<{ object: any }> {
  const ai = await dynamicImport('@mariozechner/pi-ai');
  const modelId = String(input.model ?? '').trim();
  const model = ai.getModel('openai-codex', modelId) ?? ai.getModel('openai-codex', defaultHubLlmModelId('codex'));
  if (!model) throw new Error(`Unknown Codex model: ${modelId}`);

  const response = await ai.streamOpenAICodexResponses(
    model,
    {
      systemPrompt: [
        input.system ? String(input.system) : '',
        codexJsonSchemaInstruction(z, input.schema),
        'Return a single valid JSON object only. Do not wrap it in Markdown.',
      ]
        .filter(Boolean)
        .join('\n'),
      messages: [
        {
          role: 'user',
          content: input.prompt,
          timestamp: Date.now(),
        },
      ],
    },
    codexObjectCompletionOptions({
      apiKey,
      reasoning: input.reasoning,
      maxRetries: input.maxRetries,
    }),
  ).result();

  if (response?.stopReason === 'error' || response?.stopReason === 'aborted') {
    throw new Error(
      String(response?.errorMessage ?? '').trim() ||
        `Codex completion ${response?.stopReason === 'aborted' ? 'was aborted' : 'failed'}`,
    );
  }

  const parsed = parseJsonObject(textFromAssistantMessage(response));
  return { object: input.schema?.parse ? input.schema.parse(parsed) : parsed };
}

export async function resolveHubLlmRuntime(opts?: { provider?: LlmProviderId; apiKey?: string }): Promise<HubLlmRuntime> {
  const provider = normalizeHubLlmProvider(opts?.provider);
  const apiKey = String(opts?.apiKey ?? '').trim();
  if (!apiKey) throw new Error(`Missing ${providerDisplayName(provider)} authentication. Configure it in Settings.`);

  const { z } = await dynamicImport('zod');

  if (provider === 'codex') {
    return {
      provider,
      z,
      generateObject: (input) => generateCodexObject(apiKey, z, input),
      modelFactory: (modelId) => modelId,
    };
  }

  const { generateObject } = await dynamicImport('ai');

  if (provider === 'gemini') {
    const { createGoogleGenerativeAI } = await dynamicImport('@ai-sdk/google');
    const google = createGoogleGenerativeAI({ apiKey });
    return {
      provider,
      z,
      generateObject: ({ reasoning: _reasoning, ...input }) => generateObject(input),
      modelFactory: google,
    };
  }

  const { createOpenAI } = await dynamicImport('@ai-sdk/openai');
  const openai = createOpenAI({
    apiKey,
    ...(provider === 'openrouter' ? { baseURL: 'https://openrouter.ai/api/v1' } : {}),
  });
  return {
    provider,
    z,
    generateObject: ({ reasoning: _reasoning, ...input }) => generateObject(input),
    modelFactory: openai,
  };
}
