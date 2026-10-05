import { describe, expect, test } from 'bun:test';

import {
  applyBackfillResult,
  applyCheckResult,
  applyRecordResult,
  askViews,
  changedFilePaths,
  DEFAULT_CHAT_ASKS_SETTINGS,
  newChatAskRecord,
  normalizeChatAsksSettings,
  overrideAsk,
  parseChatAsksSettingsInput,
  type AskChatExchanges,
  type ChatAsksSettings,
} from '../src/hub/chat-asks/chat-asks-model';
import { ChatAskTracker, type AskCallKind } from '../src/hub/chat-asks/ChatAskTracker';
import { exchangesFromNativeMessages, exchangesFromStoredTurns } from '../src/hub/chat-asks/chat-ask-service';

const chat = { chatId: 'c1', droneId: 'd1', chatName: 'chat-1' };
const at = '2026-10-05T10:00:00.000Z';
const message = (id: string, runId = id) => ({ id, at, text: `message ${id}`, runId });

describe('ask settings', () => {
  test('default to off and round-trip through validation', () => {
    const settings = normalizeChatAsksSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.autoTrack).toBe(false);
    expect(parseChatAsksSettingsInput(settings)).toEqual(settings);
  });

  test('reject unsupported models', () => {
    expect(() => parseChatAsksSettingsInput({ ...DEFAULT_CHAT_ASKS_SETTINGS, check: { provider: 'codex', model: 'nope', thinkingLevel: 'low' } }))
      .toThrow('checking');
  });
});

describe('ask state', () => {
  test('records asks, repeats reopen settled ones, and replacements retire them', () => {
    const record = newChatAskRecord(chat, at);
    applyRecordResult(record, message('m1'), { asks: [{ kind: 'request', text: 'make the button black' }, { kind: 'rule', text: 'always run tests' }, { kind: 'bogus', text: 'x' }], repeats: [], replaces: [] });
    expect(record.asks.map((ask) => [ask.id, ask.kind, ask.status])).toEqual([['a1', 'request', 'open'], ['a2', 'rule', 'open']]);
    record.asks[0]!.status = 'done';
    record.asks[0]!.note = 'Done.';
    applyRecordResult(record, message('m2'), { asks: [], repeats: ['a1'], replaces: ['a2'] });
    expect(record.asks[0]).toMatchObject({ status: 'open', messageIds: ['m1', 'm2'], previous: { status: 'done', note: 'Done.' } });
    expect(record.asks[1]).toMatchObject({ status: 'replaced', replacedBy: 'm2' });
  });

  test('checks judge open asks; unaddressed asks of the run become not done; rules and user choices are left alone', () => {
    const record = newChatAskRecord(chat, at);
    applyRecordResult(record, message('m1'), { asks: [{ kind: 'request', text: 'fix login' }, { kind: 'question', text: 'why does it loop?' }, { kind: 'rule', text: 'be brief' }], repeats: [], replaces: [] });
    applyRecordResult(record, message('m0'), { asks: [{ kind: 'request', text: 'older thing' }], repeats: [], replaces: [] });
    overrideAsk(record, 'a4', 'dismissed', at);
    applyCheckResult(record, { runId: 'm1', finished: true, reply: 'Fixed.', files: [] }, ['m1'], {
      results: [{ id: 'a1', status: 'done', note: 'Fixed the redirect.' }, { id: 'a3', status: 'done', note: 'x' }, { id: 'a4', status: 'done', note: 'x' }],
    }, at);
    expect(record.asks.map((ask) => ask.status)).toEqual(['done', 'not_done', 'open', 'dismissed']);
    expect(record.asks[1]!.note).toBe('The run ended without addressing it.');
  });

  test('backfill keeps statuses but rules stay active', () => {
    const record = newChatAskRecord(chat, at);
    applyBackfillResult(record, [message('m1'), message('m2')], {
      asks: [
        { kind: 'request', text: 'add tests', messageId: 'm1', status: 'done', note: 'Added 3 tests.' },
        { kind: 'rule', text: 'no new deps', messageId: 'm2', status: 'done', note: '' },
        { kind: 'question', text: 'which db?', messageId: 'missing', status: 'weird', note: '' },
      ],
    }, at);
    expect(record.asks.map((ask) => [ask.kind, ask.status, ask.messageIds[0]])).toEqual([
      ['request', 'done', 'm1'], ['rule', 'open', 'm2'], ['question', 'open', 'm2'],
    ]);
  });

  test('open asks of a running run are in progress', () => {
    const record = newChatAskRecord(chat, at);
    applyRecordResult(record, message('m1', 'r1'), { asks: [{ kind: 'request', text: 'x' }, { kind: 'rule', text: 'y' }], repeats: [], replaces: [] });
    const views = askViews(record, new Set(['r1']), new Map([['m1', 'r1']]));
    expect(views.map((view) => view.inProgress)).toEqual([true, false]);
  });

  test('changed file paths are found in any version of file changes', () => {
    expect(changedFilePaths({ version: 1, workspaces: [{ entries: [{ path: 'a.ts' }, { path: 'b.ts' }] }] })).toEqual(['a.ts', 'b.ts']);
    expect(changedFilePaths({ version: 2, workspaces: [{ previewEntries: [{ path: 'c.ts' }] }, { previewEntries: [{ path: 'c.ts' }] }] })).toEqual(['c.ts']);
    expect(changedFilePaths(undefined)).toEqual([]);
  });
});

describe('chat exchanges', () => {
  test('stored turns group by run; waiting prompts keep their run unfinished', () => {
    const exchanges = exchangesFromStoredTurns(
      [
        { id: 't1', at, prompt: 'first', ok: true, output: 'Done one.' },
        { id: 't2', at, prompt: 'second', ok: true, output: 'Done two.', runId: 'r2' },
        { id: 't3', at, prompt: 'more for two', ok: false, output: '', error: 'stopped', runId: 'r2' },
      ] as any,
      [
        { id: 't3', at, prompt: 'more for two', state: 'sent', runId: 'r2' },
        { id: 'p4', at, prompt: 'third', state: 'queued' },
        { id: 'p5', at, prompt: 'gone', state: 'failed' },
      ],
    );
    expect(exchanges.messages.map((item) => [item.id, item.runId])).toEqual([['t1', 't1'], ['t2', 'r2'], ['t3', 'r2'], ['p4', 'p4']]);
    expect(exchanges.runs).toEqual([
      { runId: 't1', finished: true, reply: 'Done one.', files: [] },
      { runId: 'r2', finished: true, reply: 'Done two.', error: 'stopped', files: [] },
      { runId: 'p4', finished: false, active: false, reply: '', files: [] },
    ]);
  });

  test('a run\'s later success clears an earlier failure, files add up, and queued runs are not active', () => {
    const exchanges = exchangesFromStoredTurns(
      [
        { id: 't1', at, prompt: 'go', ok: false, output: '', error: 'boom', runId: 'r1', fileChanges: { version: 1, workspaces: [{ entries: [{ path: 'a.ts' }] }] } },
        { id: 't2', at, prompt: 'and this', ok: true, output: 'Done.', runId: 'r1', fileChanges: { version: 2, workspaces: [{ previewEntries: [{ path: 'b.ts' }] }] } },
      ] as any,
      [{ id: 'p3', at, prompt: 'next', state: 'queued', executionState: 'queued' }, { id: 'p4', at, prompt: 'now', state: 'sent', executionState: 'running' }],
    );
    expect(exchanges.runs).toEqual([
      { runId: 'r1', finished: true, reply: 'Done.', files: ['a.ts', 'b.ts'] },
      { runId: 'p3', finished: false, active: false, reply: '', files: [] },
      { runId: 'p4', finished: false, active: true, reply: '', files: [] },
    ]);
  });

  test('native messages: each user message starts a run; the last is unfinished while the chat runs', () => {
    const exchanges = exchangesFromNativeMessages([
      { id: 'u1', role: 'user', at, text: 'hi' },
      { id: 'x1', role: 'assistant', at, text: 'Looking' },
      { id: 'x2', role: 'assistant', at, text: 'Done.' },
      { id: 'u2', role: 'user', at, text: 'next' },
    ], true);
    expect(exchanges.runs).toEqual([
      { runId: 'u1', finished: true, reply: 'Done.', files: [] },
      { runId: 'u2', finished: false, reply: '', files: [] },
    ]);
  });
});

describe('ask tracker', () => {
  function setup(initial: AskChatExchanges, settingsPatch: Partial<ChatAsksSettings> = {}) {
    let exchanges = initial;
    const calls: Array<{ kind: AskCallKind; prompt: string; attribution: unknown }> = [];
    const responses: Record<AskCallKind, unknown[]> = { record: [], check: [], backfill: [] };
    let saved: unknown[] = [];
    let running: Array<{ droneId: string; chatName: string }> = [];
    let patch = settingsPatch;
    let located: typeof chat | null = chat;
    let version: string | null = null;
    let reads = 0;
    let now = Date.parse(at);
    const tracker = new ChatAskTracker({
      settings: async () => ({ ...DEFAULT_CHAT_ASKS_SETTINGS, enabled: true, ...patch }),
      resolveChat: (droneId, chatName) => (droneId === 'd1' && chatName === 'chat-1' ? chat : null),
      locateChat: () => located,
      readExchanges: () => { reads += 1; return exchanges; },
      version: () => version,
      runningChats: () => running,
      generate: async ({ kind, prompt, attribution }) => {
        calls.push({ kind, prompt, attribution });
        const next = responses[kind].shift();
        if (next instanceof Error) throw next;
        return next ?? (kind === 'check' ? { results: [] } : { asks: [], repeats: [], replaces: [] });
      },
      cost: (chatId) => ({ cost: chatId ? 0.01 : 0.05, calls: 1, unpriced: 0 }),
      save: (records) => { saved = records; },
      now: () => now,
    });
    const run = async () => { await tracker.tick(); await tracker.idle(); };
    return {
      tracker, calls, responses, run,
      saved: () => saved,
      setExchanges: (next: AskChatExchanges) => { exchanges = next; },
      setRunning: (next: typeof running) => { running = next; },
      setSettings: (next: Partial<ChatAsksSettings>) => { patch = next; },
      setLocated: (next: typeof chat | null) => { located = next; },
      setVersion: (next: string | null) => { version = next; },
      reads: () => reads,
      advance: (ms: number) => { now += ms; },
    };
  }

  test('messages sent while Asks was off in Settings are skipped, not caught up', async () => {
    const env = setup({ messages: [], runs: [] });
    env.tracker.setTracking('d1', 'chat-1', true);
    await env.run();
    env.setSettings({ enabled: false });
    env.setExchanges({ messages: [message('m1'), message('m2')], runs: [{ runId: 'm1', finished: true, reply: 'ok', files: [] }, { runId: 'm2', finished: false, reply: '', files: [] }] });
    await env.run();
    env.setSettings({});
    await env.run();
    // Only the message of the run still working is recorded.
    expect(env.calls.map((call) => [call.kind, call.prompt.includes('message m2')])).toEqual([['record', true]]);
  });

  test('with several runs waiting, each is judged only on asks raised by then', async () => {
    const env = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: false, reply: '', files: [] }] });
    env.tracker.setTracking('d1', 'chat-1', true);
    env.responses.record.push({ asks: [{ kind: 'request', text: 'fix A' }], repeats: [], replaces: [] });
    await env.run();
    env.setExchanges({
      messages: [message('m1'), message('m2')],
      runs: [{ runId: 'm1', finished: true, reply: 'Did A.', files: [] }, { runId: 'm2', finished: true, reply: 'Did B.', files: [] }],
    });
    env.responses.record.push({ asks: [{ kind: 'request', text: 'fix B' }], repeats: ['a1'], replaces: [] });
    env.responses.check.push({ results: [{ id: 'a1', status: 'done', note: 'A' }, { id: 'a2', status: 'done', note: 'B' }] });
    await env.run();
    const checks = env.calls.filter((call) => call.kind === 'check');
    // The first run's check is skipped: a1 was asked again in m2, and a2 only came up in m2.
    expect(checks).toHaveLength(1);
    expect(checks[0]!.prompt).toContain('a1');
    expect(checks[0]!.prompt).toContain('a2');
    expect(env.tracker.view('d1', 'chat-1').asks.map((ask) => [ask.id, ask.status])).toEqual([['a1', 'done'], ['a2', 'done']]);
  });

  test('a missing chat is looked for again only after a while', async () => {
    const env = setup({ messages: [], runs: [] });
    env.tracker.setTracking('d1', 'chat-1', true);
    env.setLocated(null);
    await env.run();
    await env.run();
    env.setLocated(chat);
    await env.run();
    expect(env.reads()).toBe(0);
    env.advance(5 * 60_000 + 1);
    await env.run();
    expect(env.reads()).toBe(1);
  });

  test('a chat whose stored messages have not changed is not read again', async () => {
    const env = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: true, reply: 'ok', files: [] }] });
    env.setVersion('v1');
    env.tracker.setTracking('d1', 'chat-1', true);
    await env.run();
    const reads = env.reads();
    await env.run();
    await env.run();
    expect(env.reads()).toBe(reads);
    env.setVersion('v2');
    await env.run();
    expect(env.reads()).toBe(reads + 1);
  });

  test('queued messages are open, not in progress', async () => {
    const env = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: false, active: false, reply: '', files: [] }] });
    env.tracker.setTracking('d1', 'chat-1', true);
    env.responses.record.push({ asks: [{ kind: 'request', text: 'later' }], repeats: [], replaces: [] });
    await env.run();
    expect(env.tracker.view('d1', 'chat-1').asks[0]).toMatchObject({ status: 'open', inProgress: false });
  });

  test('backfills history once, then records new messages and checks finished runs, attributed to the chat', async () => {
    const env = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: true, reply: 'Done.', files: [] }] });
    env.tracker.setTracking('d1', 'chat-1', true);
    env.responses.backfill.push({ asks: [{ kind: 'request', text: 'old ask', messageId: 'm1', status: 'done', note: 'ok' }] });
    await env.run();
    expect(env.calls.map((call) => call.kind)).toEqual(['backfill']);
    expect(env.calls[0]!.attribution).toEqual({ purpose: 'asks', ...chat });

    env.setExchanges({
      messages: [message('m1'), message('m2')],
      runs: [{ runId: 'm1', finished: true, reply: 'Done.', files: [] }, { runId: 'm2', finished: false, reply: '', files: [] }],
    });
    env.responses.record.push({ asks: [{ kind: 'question', text: 'why?' }], repeats: [], replaces: [] });
    await env.run();
    expect(env.calls.map((call) => call.kind)).toEqual(['backfill', 'record']);
    expect(env.calls[1]!.prompt).toContain('AGENT\'S PREVIOUS REPLY\nDone.');
    let view = env.tracker.view('d1', 'chat-1');
    expect(view.asks.map((ask) => [ask.text, ask.status, ask.inProgress])).toEqual([['old ask', 'done', false], ['why?', 'open', true]]);
    expect(view.cost.cost).toBe(0.01);
    expect(env.tracker.totalCost().cost).toBe(0.05);

    env.setExchanges({
      messages: [message('m1'), message('m2')],
      runs: [{ runId: 'm1', finished: true, reply: 'Done.', files: [] }, { runId: 'm2', finished: true, reply: 'Because X.', files: [] }],
    });
    env.responses.check.push({ results: [{ id: 'a2', status: 'done', note: 'Because X.' }] });
    await env.run();
    await env.run();
    expect(env.calls.map((call) => call.kind)).toEqual(['backfill', 'record', 'check']);
    view = env.tracker.view('d1', 'chat-1');
    expect(view.asks[1]).toMatchObject({ status: 'done', note: 'Because X.', inProgress: false });
    expect(view.processing).toBe(false);
  });

  test('a failure is shown and retried later, not dropped', async () => {
    const env = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: false, reply: '', files: [] }] });
    env.tracker.setTracking('d1', 'chat-1', true);
    env.responses.record.push(new Error('rate limited'));
    await env.run();
    expect(env.tracker.view('d1', 'chat-1')).toMatchObject({ error: 'rate limited', processing: true });
    await env.run();
    expect(env.calls.filter((call) => call.kind === 'record')).toHaveLength(1);
  });

  test('turning tracking off stops work and keeps the list; back on skips what was missed', async () => {
    const env = setup({ messages: [], runs: [] });
    env.tracker.setTracking('d1', 'chat-1', true);
    await env.run();
    env.tracker.setTracking('d1', 'chat-1', false);
    env.setExchanges({ messages: [message('m1')], runs: [{ runId: 'm1', finished: true, reply: 'ok', files: [] }] });
    await env.run();
    expect(env.calls).toHaveLength(0);
    expect(env.tracker.view('d1', 'chat-1').tracking).toBe(false);
    env.tracker.setTracking('d1', 'chat-1', true);
    await env.run();
    expect(env.calls).toHaveLength(0);
  });

  test('automatic tracking picks up running chats from their current run, but not chats turned off', async () => {
    const env = setup({ messages: [message('m1'), message('m2')], runs: [{ runId: 'm1', finished: true, reply: 'ok', files: [] }, { runId: 'm2', finished: false, reply: '', files: [] }] }, { autoTrack: true });
    env.setRunning([{ droneId: 'd1', chatName: 'chat-1' }]);
    await env.run();
    expect(env.calls.map((call) => call.kind)).toEqual(['record']);
    expect(env.calls[0]!.prompt).toContain('message m2');

    const off = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: false, reply: '', files: [] }] }, { autoTrack: true });
    off.tracker.setTracking('d1', 'chat-1', false);
    off.setRunning([{ droneId: 'd1', chatName: 'chat-1' }]);
    await off.run();
    expect(off.calls).toHaveLength(0);
  });

  test('every tracked chat gets a turn, not only the first few', async () => {
    const recorded: string[] = [];
    const identity = (chatName: string) => ({ chatId: `id-${chatName}`, droneId: 'd1', chatName });
    const tracker = new ChatAskTracker({
      settings: async () => ({ ...DEFAULT_CHAT_ASKS_SETTINGS, enabled: true }),
      resolveChat: (_droneId, chatName) => identity(chatName),
      locateChat: (record) => record,
      readExchanges: (target) => ({ messages: [message(`m-${target.chatName}`)], runs: [{ runId: `m-${target.chatName}`, finished: false, reply: '', files: [] }] }),
      runningChats: () => [],
      generate: async ({ kind, attribution }) => {
        if (kind === 'record') recorded.push(String(attribution.chatName));
        return { asks: [], repeats: [], replaces: [] };
      },
      cost: () => ({ cost: 0, calls: 0, unpriced: 0 }),
      now: () => Date.parse(at),
    });
    const names = ['c1', 'c2', 'c3', 'c4', 'c5'];
    for (const name of names) tracker.setTracking('d1', name, true);
    for (let tick = 0; tick < 3; tick += 1) { await tracker.tick(); await tracker.idle(); }
    expect([...recorded].sort()).toEqual(names);
  });

  test('event notifications are not recorded as asks', async () => {
    const env = setup({
      messages: [{ ...message('m1'), text: '<dronehub_event_notification>CI failed</dronehub_event_notification>' }],
      runs: [{ runId: 'm1', finished: false, reply: '', files: [] }],
    });
    env.tracker.setTracking('d1', 'chat-1', true);
    await env.run();
    expect(env.calls).toHaveLength(0);
    expect(env.tracker.view('d1', 'chat-1').processing).toBe(false);
  });

  test('the user can settle an ask, and the checker leaves it alone', async () => {
    const env = setup({ messages: [message('m1')], runs: [{ runId: 'm1', finished: false, reply: '', files: [] }] });
    env.tracker.setTracking('d1', 'chat-1', true);
    env.responses.record.push({ asks: [{ kind: 'request', text: 'x' }], repeats: [], replaces: [] });
    await env.run();
    env.tracker.override('d1', 'chat-1', 'a1', 'done');
    env.setExchanges({ messages: [message('m1')], runs: [{ runId: 'm1', finished: true, reply: 'nope', files: [] }] });
    await env.run();
    expect(env.calls.map((call) => call.kind)).toEqual(['record']);
    expect(env.tracker.view('d1', 'chat-1').asks[0]).toMatchObject({ status: 'done', manual: true });
  });
});
