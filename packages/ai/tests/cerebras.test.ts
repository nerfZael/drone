import { afterEach, describe, expect, test, vi } from 'vitest';
import { getModel, getSupportedThinkingLevels } from '../src/models.js';
import { streamSimpleOpenAICompletions } from '../src/providers/openai-completions.js';
import type { Context } from '../src/types.js';

const model = getModel('cerebras', 'qwen-3.8-27b');
const context: Context = {
  systemPrompt: 'Use tools to inspect the app.',
  messages: [{ role: 'user', content: 'Read the current selection.', timestamp: 1 }],
  tools: [{ name: 'get_app_context', description: 'Read selection', parameters: { type: 'object', properties: {} } }],
};
afterEach(() => vi.unstubAllGlobals());

describe('Cerebras Qwen Companion transport', () => {
  test.each([['off', 'none'], ['low', 'low'], ['medium', 'medium'], ['high', 'high']] as const)(
    'sends supported reasoning %s', async (level, wire) => {
      let payload: any;
      await streamSimpleOpenAICompletions(model, context, {
        apiKey: 'test-key', reasoning: level === 'off' ? undefined : level,
        onPayload: (p) => { payload = p; throw new Error('captured before network'); },
      }).result();
      expect(getSupportedThinkingLevels(model)).toEqual(['off', 'low', 'medium', 'high']);
      expect(payload.reasoning_effort).toBe(wire);
      expect(payload.messages[0].role).toBe('system');
      expect(payload.store).toBeUndefined();
      expect(payload.tools[0].function.name).toBe('get_app_context');
    },
  );

  test('streams reasoning and tool arguments, then replays reasoning with matching tool results', async () => {
    const chunk = (delta: any, finish_reason: string | null = null) => ({
      id: 'completion', object: 'chat.completion.chunk', created: 1, model: model.id,
      choices: [{ index: 0, delta, finish_reason }],
    });
    const chunks = [
      chunk({ role: 'assistant', reasoning: 'Inspect selection.' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_app_context', arguments: '{' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }),
      chunk({}, 'tool_calls'),
    ];
    const fetchMock = vi.fn(async () => new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await streamSimpleOpenAICompletions(model, context, { apiKey: 'test-key', reasoning: 'low' }).result();
    expect(response.stopReason).toBe('toolUse');
    expect(response.content).toContainEqual(expect.objectContaining({ type: 'thinking', thinking: 'Inspect selection.', thinkingSignature: 'reasoning' }));
    expect(response.content).toContainEqual(expect.objectContaining({ type: 'toolCall', id: 'call_1', name: 'get_app_context', arguments: {} }));
    let payload: any;
    await streamSimpleOpenAICompletions(model, { ...context, messages: [
      ...context.messages, response,
      { role: 'toolResult', toolCallId: 'call_1', toolName: 'get_app_context', content: [{ type: 'text', text: 'Selected chat A' }], isError: false, timestamp: 2 },
    ] }, { apiKey: 'test-key', reasoning: 'low', onPayload: p => { payload = p; throw new Error('captured'); } }).result();
    expect(payload.messages[2].reasoning).toBe('Inspect selection.');
    expect(payload.messages[3]).toMatchObject({ role: 'tool', tool_call_id: payload.messages[2].tool_calls[0].id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
