import { expect, test } from 'bun:test';
import { HubAssistantService } from '../src/hub/assistant';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';
import { resolveNamingProvider, upsertNamingProvider } from '../src/hub/hub-settings';
import { defaultHubLlmModelId, resolveHubLlmRuntime } from '../src/hub/llm-runtime';
import { HUB_AGENT_MODEL_OPTIONS } from '../src/hub/llm-model-catalog';
import { buildNativeModelCatalog } from '../src/hub/assistant/native-model-catalog';

test('Cerebras native defaults, chats, and naming persist with the correct provider', async () => {
  await withTempDroneDataDir('cerebras-native-', async () => {
    const service = new HubAssistantService({ listDrones: async () => [] });
    const selection = { provider: 'cerebras', model: 'qwen-3.8-27b', thinkingLevel: 'low' };
    const defaults = await service.updateDefaultModel(selection);
    expect(defaults.defaultModel).toMatchObject(selection);
    const chat = await ensureTestNativeChat(service, { id: 'cerebras-chat' });
    expect(chat.threads[0]).toMatchObject(selection);
    const reloaded = new HubAssistantService({ listDrones: async () => [] });
    expect((await reloaded.threadSnapshot('cerebras-chat')).threads[0]).toMatchObject(selection);
    const catalog = buildNativeModelCatalog(HUB_AGENT_MODEL_OPTIONS, selection, 'cerebras');
    expect(catalog).toEqual([expect.objectContaining({ provider: 'cerebras', id: 'qwen-3.8-27b', reasoningLevels: ['off', 'low', 'medium', 'high'] })]);
    await upsertNamingProvider('cerebras');
    expect(await resolveNamingProvider()).toBe('cerebras');
    expect(defaultHubLlmModelId('cerebras')).toBe(selection.model);
    const runtime = await resolveHubLlmRuntime({ provider: 'cerebras', apiKey: 'test-key' });
    const model = runtime.modelFactory(selection.model);
    expect(model.modelId).toBe(selection.model);
    expect(model.provider).toContain('chat');
  });
});

test('automatic naming sends structured generation to Cerebras chat completions', async () => {
  const originalFetch = globalThis.fetch;
  let destination = '';
  let payload: any;
  globalThis.fetch = (async (url: any, init: any) => {
    destination = String(url);
    payload = JSON.parse(String(init?.body));
    return Response.json({
      id: 'test-completion', object: 'chat.completion', created: 1, model: 'qwen-3.8-27b',
      choices: [{ index: 0, message: { role: 'assistant', content: '{"name":"Cerebras chat"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }) as typeof fetch;
  try {
    await withTempDroneDataDir('cerebras-naming-', async () => {
      const runtime = await resolveHubLlmRuntime({ provider: 'cerebras', apiKey: 'test-key' });
      const result = await runtime.generateObject({
        model: runtime.modelFactory(defaultHubLlmModelId('cerebras')),
        schema: runtime.z.object({ name: runtime.z.string() }),
        prompt: 'Name a chat about Cerebras.', maxRetries: 0,
      });
      expect(result.object).toEqual({ name: 'Cerebras chat' });
      expect(destination).toBe('https://api.cerebras.ai/v1/chat/completions');
      expect(payload.model).toBe('qwen-3.8-27b');
      expect(payload.response_format.type).toBe('json_schema');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
