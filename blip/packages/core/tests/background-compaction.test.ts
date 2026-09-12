import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantMessageEventStream, estimateContextTokens, fauxAssistantMessage, fauxToolCall, type Model } from '@mariozechner/pi-ai';
import { BlipContextManager } from '../src/context-manager';
import { SessionStore } from '../src/node';
import { summaryText } from './helpers/compaction-fixtures';
import type { BlipRuntimeEvent } from '../src/types';

const model: Model<any> = { id: 'background-test', name: 'Test', provider: 'faux', api: 'faux',
  baseUrl: '', reasoning: false, input: ['text'], contextWindow: 10_000, maxTokens: 500,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const settings = { auto: true, background: true, reserveTokens: 500, keepRecentTokens: 100,
  keepRecentTurns: 1, summaryMaxTokens: 200 };

async function fixture() {
  const repository = new SessionStore(await mkdtemp(path.join(os.tmpdir(), 'background-compaction-')));
  const state = await repository.create({ provider: 'faux', model: model.id,
    permissionMode: 'read-only', toolProfile: 'read-only' });
  await repository.appendMessage(state, { role: 'user', content: 'Original task', timestamp: 0 });
  await repository.appendMessage(state, fauxAssistantMessage('old '.repeat(8_000)));
  await repository.appendMessage(state, { role: 'user', content: 'Continue, do not publish', timestamp: 1 });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const stream = new AssistantMessageEventStream();
  const events: BlipRuntimeEvent[] = [];
  let calls = 0;
  let prompt = '';
  const manager = new BlipContextManager({ state, repository, model, settings,
    streamFn: (_model, _context, options) => {
      calls++;
      options?.signal?.addEventListener('abort', () => stream.end(fauxAssistantMessage('', { stopReason: 'aborted' })), { once: true });
      started();
      return stream;
    },
    activeTurnId: () => 'turn', systemPrompt: () => prompt, tools: () => [],
    replaceAgentMessages: () => {}, emit: async (e) => { events.push(e); },
  });
  const hook = (reason: 'preflight' | 'overflow' = 'preflight', signal?: AbortSignal) => manager.beforeModelCall({
    context: { systemPrompt: prompt, messages: [], tools: [] }, reason, attempt: 0,
    estimate: async (messages) => estimateContextTokens(model, {
      systemPrompt: prompt, messages: (messages ?? await repository.readModelMessages(state)) as any,
    }),
  }, signal);
  return { repository, state, manager, hook, events, entered, stream, calls: () => calls,
    prompt: (value: string) => { prompt = value; },
    finish: () => stream.end(fauxAssistantMessage(summaryText('Continue; never publish'))),
    checkpoints: async () => (await repository.readTranscript(state)).filter((e) => e.type === 'compaction'),
  };
}

describe('background compaction at model boundaries', () => {
  test('never installs a prepared summary if newly appended context exceeds the target', async () => {
    const f = await fixture();
    await f.hook();
    await f.entered;
    await f.repository.appendMessage(f.state, { role: 'user', content: 'new '.repeat(6500), timestamp: 3 });
    const waiting = f.hook('overflow');
    f.finish();
    await expect(waiting).rejects.toThrow('Compaction could not produce');
    expect(await f.checkpoints()).toHaveLength(0);
    expect(f.calls()).toBe(1);
    expect(JSON.stringify(await f.repository.readModelMessages(f.state))).toContain('new '.repeat(6500));
  });
  test('does not block inference, reuses one job, and preserves newly appended tool calls/results', async () => {
    const f = await fixture();
    expect((await f.hook())?.replaceContext).toBeUndefined();
    await f.entered;
    expect((await f.hook())?.replaceContext).toBeUndefined();
    expect(f.calls()).toBe(1);
    expect(await f.checkpoints()).toHaveLength(0);
    const call = fauxToolCall('read', { path: 'new.ts' });
    await f.repository.appendMessage(f.state, fauxAssistantMessage(call));
    await f.repository.appendMessage(f.state, { role: 'toolResult', toolCallId: call.id,
      toolName: 'read', isError: false, content: [{ type: 'text', text: 'new evidence' }], timestamp: 2 });
    const next = f.hook('overflow');
    f.finish();
    const result = await next;
    expect(result?.replaceContext).toBe(true);
    expect(JSON.stringify(result?.messages)).toContain('new evidence');
    expect(JSON.stringify(result?.messages)).toContain(call.id);
    expect(JSON.stringify(result?.messages)).toContain('Continue, do not publish');
    expect(await f.checkpoints()).toHaveLength(1);
    expect(f.calls()).toBe(1);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'compaction_completed', background: true,
      metrics: expect.objectContaining({ modelCallCount: 1 }) }));
    expect((await f.hook())?.replaceContext).toBeUndefined();
    expect(f.calls()).toBe(1);
  });

  test('preserves appended messages when the prepared plan has no retained tail', async () => {
    const f = await fixture();
    await f.repository.appendMessage(f.state, fauxAssistantMessage('older '.repeat(100)));
    await f.hook();
    await f.entered;
    await f.repository.appendMessage(f.state, { role: 'user', content: 'New requirement after snapshot', timestamp: 3 });
    const next = f.hook('overflow');
    f.finish();
    const result = await next;
    expect(JSON.stringify(result?.messages)).toContain('New requirement after snapshot');
    expect(await f.checkpoints()).toHaveLength(1);
  });

  test('cancellation while waiting at the hard boundary cannot install a checkpoint', async () => {
    const f = await fixture();
    await f.hook();
    await f.entered;
    const controller = new AbortController();
    const waiting = f.hook('overflow', controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    f.manager.abort();
    expect(await f.checkpoints()).toHaveLength(0);
  });

  test('a changed prompt discards the old summary without blocking the next safe request', async () => {
    const f = await fixture();
    await f.hook();
    await f.entered;
    f.prompt('New system constraint');
    expect((await f.hook())?.replaceContext).toBeUndefined();
    expect(await f.checkpoints()).toHaveLength(0);
    expect(f.calls()).toBe(1);
    expect(f.events.some((e) => e.type === 'compaction_failed' && e.reason === 'cancelled')).toBe(true);
  });

  test('a checkpoint appended by another writer invalidates the snapshot', async () => {
    const f = await fixture();
    await f.hook();
    await f.entered;
    await f.repository.appendEntry(f.state, { type: 'compaction', id: 'external', trigger: 'manual',
      createdAt: new Date().toISOString(), summary: 'External checkpoint', tokensBefore: 8000,
      details: { readFiles: [], modifiedFiles: [] } });
    f.finish();
    // Synchronize preparation without committing it; installation remains through the public hook.
    await (f.manager as any).background.promise;
    await f.hook();
    expect((await f.checkpoints()).map((e) => e.id)).toEqual(['external']);
  });
});
