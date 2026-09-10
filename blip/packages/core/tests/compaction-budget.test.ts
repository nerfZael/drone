import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AssistantMessageEventStream,
  estimateContextTokens,
  fauxAssistantMessage,
  type Model,
} from '@mariozechner/pi-ai';
import type { AgentMessage, StreamFn } from '@mariozechner/pi-agent-core';
import { BlipContextManager } from '../src/context-manager';
import { SessionStore, compactStoredSession } from '../src/node';
import { createBlipSession } from '../src/blip-session';
import { summaryText } from './helpers/compaction-fixtures';
import type { BlipRuntimeEvent } from '../src/types';

const model: Model<any> = {
  id: 'budget-test',
  name: 'Test',
  provider: 'faux',
  api: 'faux',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  contextWindow: 16_000,
  maxTokens: 500,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const settings = {
  auto: true,
  reserveTokens: 1000,
  keepRecentTokens: 100,
  keepRecentTurns: 2,
  summaryMaxTokens: 200,
};

async function fixture(oldText = 'old response '.repeat(500)) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'compaction-budget-'));
  const repository = new SessionStore(workspace);
  const state = await repository.create({
    provider: model.provider,
    model: model.id,
    permissionMode: 'read-only',
    toolProfile: 'read-only',
  });
  await repository.appendMessage(state, { role: 'user', content: 'Old task', timestamp: 0 });
  await repository.appendMessage(state, fauxAssistantMessage(oldText));
  await repository.appendMessage(state, {
    role: 'user',
    content: 'Keep the latest request exactly',
    timestamp: 1,
  });
  const events: BlipRuntimeEvent[] = [];
  const requests: { maxTokens?: number }[] = [];
  let summary = summaryText('Continue work');
  const streamFn: StreamFn = (_model, _context, options) => {
    requests.push({ maxTokens: options?.maxTokens });
    const stream = new AssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'stop', message: fauxAssistantMessage(summary) });
    return stream;
  };
  const manager = new BlipContextManager({
    state,
    repository,
    model,
    settings,
    streamFn,
    activeTurnId: () => undefined,
    systemPrompt: () => '',
    tools: () => [],
    replaceAgentMessages: () => {},
    emit: async (event) => {
      events.push(event);
    },
  });
  return {
    workspace,
    repository,
    state,
    events,
    requests,
    streamFn,
    manager,
    setSummary: (text: string) => {
      summary = text;
    },
  };
}

describe('shared compaction validation', () => {
  test('manual compaction honors an independent summary cap and reports measured savings', async () => {
    const f = await fixture();
    await f.manager.compact();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].maxTokens).toBeLessThanOrEqual(200);
    const event = f.events.find((event) => event.type === 'compaction_completed');
    expect(event?.type === 'compaction_completed' && event.tokensAfter < event.tokensBefore).toBe(
      true,
    );
    const messages = await f.repository.readModelMessages(f.state);
    expect(messages[1]).toMatchObject({ role: 'user', content: 'Keep the latest request exactly' });
  });

  test('rejects an oversized summary without a second generation or checkpoint', async () => {
    const f = await fixture();
    f.setSummary(summaryText('x'.repeat(2000)));
    await f.manager.compact();
    expect(f.requests).toHaveLength(1);
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'compaction_skipped',
        reason: 'summary exceeded its token budget',
      }),
    );
    expect(
      (await f.repository.readTranscript(f.state)).some((entry) => entry.type === 'compaction'),
    ).toBe(false);
  });

  test('large file inventories cannot consume the summary budget, and complete metadata stays saved', async () => {
    const f = await fixture();
    f.state.changedFiles = Array.from({ length: 2_000 }, (_, i) => `/repo/src/modified-file-${i}.ts`);
    f.state.readFiles = Array.from({ length: 2_000 }, (_, i) => `/repo/src/read-file-${i}.ts`);
    await f.manager.compact();
    const checkpoint = (await f.repository.readTranscript(f.state)).find((entry) => entry.type === 'compaction');
    expect(checkpoint?.type).toBe('compaction');
    if (checkpoint?.type !== 'compaction') throw new Error('Checkpoint was not installed');
    expect(checkpoint.details.modifiedFiles).toHaveLength(2_000);
    expect(checkpoint.details.readFiles).toHaveLength(2_000);
    expect(checkpoint.summary).toContain('Additional paths are stored in checkpoint metadata');
    expect(checkpoint.summary.length).toBeLessThanOrEqual(800);
    const metadata = checkpoint.summary.slice(checkpoint.summary.indexOf('\n\n## File Metadata'));
    expect(f.requests[0].maxTokens! + Math.ceil(metadata.length / 4)).toBeLessThanOrEqual(200);
  });

  test('manual compaction cannot enlarge a small conversation', async () => {
    const f = await fixture('tiny');
    await f.manager.compact();
    expect(f.events.some((event) => event.type === 'compaction_completed')).toBe(false);
    expect(await f.repository.readModelMessages(f.state)).toHaveLength(3);
  });

  test('checks host transforms before generating, and stops an unsafe preflight', async () => {
    const f = await fixture();
    const transform = (messages: AgentMessage[]) => [
      ...messages,
      { role: 'user' as const, content: 'fixed '.repeat(20_000), timestamp: 2 },
    ];
    const estimate = async (messages?: AgentMessage[]) =>
      estimateContextTokens(model, {
        messages: transform(messages ?? (await f.repository.readModelMessages(f.state))) as any,
      });
    await expect(
      f.manager.beforeModelCall({
        context: { systemPrompt: '', messages: [], tools: [] },
        reason: 'preflight',
        attempt: 0,
        estimate,
      }),
    ).rejects.toThrow('Compaction could not produce');
    expect(f.requests).toHaveLength(0);
    expect(
      (await f.repository.readTranscript(f.state)).some((entry) => entry.type === 'compaction'),
    ).toBe(false);
  });

  test('manual stored-session API uses cancellation and the same usage/completion events', async () => {
    const f = await fixture();
    await compactStoredSession({
      sessionRepository: f.repository,
      session: f.state,
      model,
      settings,
      streamFn: f.streamFn,
      eventSink: (event) => {
        f.events.push(event);
      },
    });
    expect(
      f.events.some((event) => event.type === 'usage_observed' && event.purpose === 'compaction'),
    ).toBe(true);
    expect(f.events.some((event) => event.type === 'compaction_completed')).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      compactStoredSession({
        sessionRepository: f.repository,
        session: f.state,
        model,
        settings,
        streamFn: f.streamFn,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.requests).toHaveLength(1);
  });

  test('an already-aborted automatic compaction makes no model request', async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.manager.beforeModelCall(
        {
          context: { systemPrompt: '', messages: [], tools: [] },
          reason: 'overflow',
          attempt: 1,
          estimate: async () => estimateContextTokens(model, { messages: [] }),
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.requests).toHaveLength(0);
  });

  test('manual cancellation during prompt refresh prevents summary submission and blocks concurrent prompts', async () => {
    const f = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refresh = 0;
    const handle = await createBlipSession({
      workspaceRoot: f.workspace,
      model,
      permissionMode: 'read-only',
      toolProfile: 'read-only',
      sessionRepository: f.repository,
      sessionId: f.state.id,
      compactionSettings: settings,
      streamFn: f.streamFn,
      promptProvider: async () => {
        if (++refresh > 1) {
          entered();
          await gate;
        }
        return 'host instructions';
      },
    });
    const compacting = handle.compact();
    await enteredPromise;
    await expect(handle.prompt('must wait')).rejects.toThrow('already processing');
    await expect(handle.enqueue('must not disappear')).rejects.toThrow('compacting');
    expect(() => handle.steer('must not disappear')).toThrow('compacting');
    handle.abort();
    release();
    await expect(compacting).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.requests).toHaveLength(0);
    expect(handle.running).toBe(false);
    handle.close();
  });

  test('detects history changes during a summary instead of installing a stale checkpoint', async () => {
    const f = await fixture();
    await expect(
      compactStoredSession({
        sessionRepository: f.repository,
        session: f.state,
        model,
        settings,
        streamFn: async (...args) => {
          await f.repository.appendMessage(f.state, {
            role: 'user',
            content: 'New instruction',
            timestamp: 3,
          });
          return f.streamFn(...args);
        },
      }),
    ).rejects.toThrow('history changed');
    expect(
      (await f.repository.readTranscript(f.state)).some((entry) => entry.type === 'compaction'),
    ).toBe(false);
  });
});
