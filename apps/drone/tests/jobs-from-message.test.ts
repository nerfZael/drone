import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_DRONE_NAME_MODEL_ID,
  suggestDroneNameFromMessage,
} from '../src/hub/jobs-from-message';
import { codexObjectCompletionOptions } from '../src/hub/llm-runtime';

function fakeCodexToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-name-test' },
    }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

describe('name suggestion model', () => {
  test('uses GPT-5.6 Luna by default', () => {
    expect(DEFAULT_DRONE_NAME_MODEL_ID).toBe('gpt-5.6-luna');
  });

  test('requests no reasoning for Codex name generation', () => {
    expect(
      codexObjectCompletionOptions({ apiKey: 'token', reasoning: 'none', maxRetries: 1 }),
    ).toEqual({
      apiKey: 'token',
      reasoningEffort: 'none',
      maxRetries: 1,
    });
  });

  test('sends GPT-5.6 Luna with no reasoning through the OpenAI fallback', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: any[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          id: 'resp-name-test',
          created_at: 1_786_000_000,
          model: DEFAULT_DRONE_NAME_MODEL_ID,
          output: [
            {
              type: 'message',
              role: 'assistant',
              id: 'msg-name-test',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ name: 'fix login loop' }),
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 4,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const name = await suggestDroneNameFromMessage('Fix the login redirect loop', {
        provider: 'openai',
        apiKey: 'test-openai-key',
      });
      expect(name).toBe('Fix login loop');
      const requestBody = requestBodies[0];
      expect(requestBody?.model).toBe(DEFAULT_DRONE_NAME_MODEL_ID);
      expect(requestBody?.reasoning).toEqual({ effort: 'none' });
      expect(requestBody?.temperature).toBeUndefined();
      expect(JSON.stringify(requestBody)).toContain('Fix login loop');
      expect(JSON.stringify(requestBody)).toContain('do not default to dash-case');

      const identifier = await suggestDroneNameFromMessage('Fix the login redirect loop', {
        provider: 'openai',
        apiKey: 'test-openai-key',
        style: 'identifier',
      });
      expect(identifier).toBe('fix-login-loop');
      expect(JSON.stringify(requestBodies[1])).toContain('identifier must be dash-case');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sends GPT-5.6 Luna with explicit no reasoning through Codex auth', async () => {
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;
    let requestBody: any = null;
    globalThis.WebSocket = undefined as any;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ error: { message: 'stop after request capture' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await expect(
        suggestDroneNameFromMessage('Fix the login redirect loop', {
          provider: 'codex',
          apiKey: fakeCodexToken(),
        }),
      ).rejects.toThrow('stop after request capture');
      expect(requestBody?.model).toBe(DEFAULT_DRONE_NAME_MODEL_ID);
      expect(requestBody?.reasoning).toEqual({ effort: 'none', summary: 'auto' });
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
    }
  });
});
