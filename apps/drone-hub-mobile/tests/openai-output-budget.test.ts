import { expect, test } from 'bun:test';
import { createOpenAiMobileStream } from '../src/local-assistant/openai-chat-client';

test('mobile OpenAI forwards the requested output ceiling to the API', async () => {
  const original = globalThis.fetch;
  let body: any;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const response = createOpenAiMobileStream('test-key')(
      { id: 'gpt-test', api: 'openai-completions', provider: 'openai' } as any,
      { messages: [] },
      { maxTokens: 512 },
    );
    await (await response).result();
    expect(body.max_completion_tokens).toBe(512);
  } finally {
    globalThis.fetch = original;
  }
});
