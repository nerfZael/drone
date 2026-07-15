import { describe, expect, test } from 'bun:test';
import {
  codexAccessTokenExpiresAt,
  parseCodexAuthJson,
  parseStoredCodexAuth,
} from '../src/local-assistant/codex-auth-format';
import { consumeCodexSseResponse, parseCodexSseResponse } from '../src/local-assistant/codex-sse';

function token(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('phone Codex authentication', () => {
  test('extracts a transferable Codex CLI login and its expiry', () => {
    const accessToken = token({
      exp: 2_000_000_000,
      'https://api.openai.com/auth': { chatgpt_account_id: 'account_123' },
    });
    expect(
      parseCodexAuthJson(
        JSON.stringify({
          tokens: { access_token: accessToken, refresh_token: 'refresh_123' },
        }),
      ),
    ).toEqual({
      accessToken,
      refreshToken: 'refresh_123',
      accountId: 'account_123',
      expiresAt: 2_000_000_000_000,
    });
    expect(codexAccessTokenExpiresAt(accessToken)).toBe(2_000_000_000_000);
  });

  test('rejects saved credentials without a refresh token', () => {
    expect(() =>
      parseStoredCodexAuth(
        JSON.stringify({ accessToken: 'access', accountId: 'account', expiresAt: null }),
      ),
    ).toThrow('incomplete');
  });
});

describe('phone Codex SSE', () => {
  test('returns the completed response from a buffered stream', () => {
    const response = { id: 'response_1', status: 'completed', output: [] };
    const raw = [
      `data: ${JSON.stringify({ type: 'response.created', response: { id: 'response_1' } })}`,
      `data: ${JSON.stringify({ type: 'response.completed', response })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    expect(parseCodexSseResponse(raw)).toEqual(response);
  });

  test('surfaces a failed response', () => {
    const raw = `data: ${JSON.stringify({
      type: 'response.failed',
      response: { error: { message: 'subscription unavailable' } },
    })}\n\n`;
    expect(() => parseCodexSseResponse(raw)).toThrow('subscription unavailable');
  });

  test('consumes Codex events incrementally before completion', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Checking"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Done"}\n\n',
      'data: {"type":"response.completed","response":{"id":"response-streamed","status":"completed","output":[]}}\n\n',
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    );
    const seen: string[] = [];
    const completed = await consumeCodexSseResponse(response, (event) => seen.push(event.type));
    expect(seen).toEqual([
      'response.reasoning_summary_text.delta',
      'response.output_text.delta',
      'response.completed',
    ]);
    expect(completed.id).toBe('response-streamed');
    expect(completed.output).toEqual([
      {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'Checking' }],
      },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Done', annotations: [] }],
      },
    ]);
  });

  test('keeps a final answer delivered only as a completed output item', () => {
    const message = {
      id: 'message_1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: 'The repository contains apps, packages, and shared tooling.',
          annotations: [],
        },
      ],
    };
    const raw = [
      `data: ${JSON.stringify({ type: 'response.output_item.done', item: message })}`,
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: { id: 'response-sparse', status: 'completed', output: [] },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');

    expect(parseCodexSseResponse(raw).output).toEqual([message]);
  });
});
