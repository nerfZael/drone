import { describe, expect, test } from 'vitest';
import { convertMessages } from '../src/providers/google-shared.js';
import { fauxAssistantMessage, fauxToolCall } from '../src/providers/faux.js';
import type { Model, ToolCall } from '../src/types.js';

const model: Model<'google-generative-ai'> = {
  id: 'gemini-3.5-flash-lite', name: 'Gemini', provider: 'google', api: 'google-generative-ai',
  baseUrl: '', reasoning: true, input: ['text'], contextWindow: 128_000, maxTokens: 8_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function convert(call: ToolCall, sameModel = true, target = model) {
  const assistant = fauxAssistantMessage(call, { stopReason: 'toolUse' });
  if (sameModel) Object.assign(assistant, { api: target.api, provider: target.provider, model: target.id });
  return convertMessages(target, { messages: [
    { role: 'user', content: 'Start', timestamp: 0 }, assistant,
    { role: 'toolResult', toolName: call.name, toolCallId: call.id, content: [{ type: 'text', text: 'Instructions' }], isError: false, timestamp: 0 },
  ] });
}

describe('Google host-inserted tool history', () => {
  test.each([true, false])('uses the documented literal signature for synthetic calls (same model: %s)', (sameModel) => {
    const contents = convert({ ...fauxToolCall('read_skill', {}), synthetic: true }, sameModel);
    expect(contents[1]?.parts?.[0]).toMatchObject({
      functionCall: { name: 'read_skill' }, thoughtSignature: 'skip_thought_signature_validator',
    });
    expect(contents[2]?.parts?.[0]?.functionResponse?.name).toBe('read_skill');
  });

  test('preserves real signatures and does not turn ordinary unsigned calls into synthetic calls', () => {
    const call = fauxToolCall('read_skill', {});
    expect(convert({ ...call, thoughtSignature: 'c2lnbmF0dXJl' })[1]?.parts?.[0]?.thoughtSignature).toBe('c2lnbmF0dXJl');
    expect(convert(call)[1]?.parts?.[0]?.thoughtSignature).toBeUndefined();
    expect(convert({ ...call, thoughtSignature: 'c2lnbmF0dXJl' }, false)[1]?.parts?.[0]?.thoughtSignature).toBeUndefined();
  });

  test.each(['gemini-2.5-flash', 'claude-sonnet'])('does not add a Gemini 3 marker to %s', (id) => {
    expect(convert({ ...fauxToolCall('read_skill', {}), synthetic: true }, true, { ...model, id })[1]?.parts?.[0]?.thoughtSignature).toBeUndefined();
  });
});
