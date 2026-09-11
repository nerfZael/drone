import { describe, expect, it } from 'vitest';
import { estimateContextTokens, type Context, type Model } from '@mariozechner/pi-ai/agent-core';
import { runAgentLoop } from '../src/agent-loop';
import { AssistantMessageEventStream } from '@mariozechner/pi-ai/agent-core';
import { ContextTokenTracker } from '../src/ContextTokenTracker';

const model = {
  provider: 'test',
  api: 'test',
  id: 'test',
  contextWindow: 10_000,
} as unknown as Model<any>;
const request: Context = {
  systemPrompt: 'system',
  messages: [{ role: 'user', content: 'request', timestamp: 0 }],
};
const response = (input: number, cacheRead = 0, cacheWrite = 0) =>
  ({
    stopReason: 'stop',
    usage: {
      input,
      cacheRead,
      cacheWrite,
      output: 50,
      totalTokens: input + cacheRead + cacheWrite + 50,
    },
  }) as any;

describe('provider usage calibration', () => {
  it('counts cached input and new tool output exactly once', () => {
    const tracker = new ContextTokenTracker();
    tracker.record(model, request, response(100, 200, 300));
    const next: Context = {
      ...request,
      messages: [
        ...request.messages,
        {
          role: 'toolResult',
          toolCallId: 'id',
          toolName: 'read',
          content: [{ type: 'text', text: 'x'.repeat(4000) }],
          isError: false,
          timestamp: 0,
        },
      ],
    };
    expect(tracker.estimate(model, next).inputTokens).toBe(
      600 +
        estimateContextTokens(model, next).inputTokens -
        estimateContextTokens(model, request).inputTokens,
    );
  });

  it('invalidates calibration after compaction, transforms, model or tool changes', () => {
    const tracker = new ContextTokenTracker();
    tracker.record(model, request, response(9000));
    for (const context of [
      { ...request, messages: [{ role: 'user' as const, content: 'summary', timestamp: 0 }] },
      { ...request, systemPrompt: 'new system' },
      { ...request, tools: [{ name: 'new', description: 'new tool', parameters: {} as any }] },
    ])
      expect(tracker.estimate(model, context)).toEqual(estimateContextTokens(model, context));
    expect(tracker.estimate({ ...model, id: 'other' }, request)).toEqual(
      estimateContextTokens(model, request),
    );
  });

  it('never lowers conservative estimates and ignores failed or missing usage', () => {
    const tracker = new ContextTokenTracker();
    for (const item of [response(1), response(0), { ...response(9999), stopReason: 'error' }]) {
      tracker.record(model, request, item);
      expect(tracker.estimate(model, request)).toEqual(estimateContextTokens(model, request));
    }
  });
});

it('uses calibrated usage between tool rounds and forwards the hook output budget', async () => {
  const estimates: number[] = [];
  const outputBudgets: Array<number | undefined> = [];
  let calls = 0;
  await runAgentLoop(
    [{ role: 'user', content: 'task', timestamp: 0 }],
    {
      systemPrompt: '',
      messages: [],
      tools: [
        {
          name: 'read',
          label: 'Read',
          description: 'Read',
          parameters: { type: 'object', properties: {} } as any,
          execute: async () => ({
            content: [{ type: 'text', text: 'new output '.repeat(100) }],
            details: {},
          }),
        },
      ],
    },
    {
      model,
      convertToLlm: (messages) => messages as any,
      beforeModelCall: async (context) => {
        estimates.push((await context.estimate()).inputTokens);
        return { maxTokens: 123 };
      },
    },
    () => {},
    undefined,
    (_model, _context, options) => {
      outputBudgets.push(options?.maxTokens);
      const first = calls++ === 0;
      const message: any = {
        ...response(5000),
        role: 'assistant',
        api: 'test',
        provider: 'test',
        model: 'test',
        timestamp: 0,
        content: first
          ? [{ type: 'toolCall', id: 'call', name: 'read', arguments: {} }]
          : [{ type: 'text', text: 'done' }],
        stopReason: first ? 'toolUse' : 'stop',
      };
      const stream = new AssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason, message });
      return stream;
    },
  );
  expect(estimates[0]).toBeLessThan(100);
  expect(estimates[1]).toBeGreaterThan(5000);
  expect(outputBudgets).toEqual([123, 123]);
});
