import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replayRuntime, snapshotLimbs, type Mind } from '@entity/core';
import { HubRouter } from '../src/hub/hub-router';
import { registerEntityRoutes } from '../src/hub/entity/entity-routes';
import { EntitySession, entityConfigFrom, reasoningFor } from '../src/hub/entity/entity-session';
import { EntityProfiles } from '../src/hub/entity/entity-profiles';
import { EntityPrompts } from '../src/hub/entity/entity-prompts';
import { fileConversationStore, PiAiMind, type ConversationStore } from '../src/hub/entity/entity-mind';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function harness(sessionsDir: string | null = null) {
  const systems: string[] = [];
  const mind: Mind = {
    async run(input) {
      systems.push(input.system);
      if (input.prompt.includes(' user chat_message {"text":"press 556"}')) await input.callTool('press', { keys: '556' });
      return {};
    },
  };
  const prompts = new EntityPrompts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'entity-prompts-')), 'prompts.json'));
  const session = new EntitySession(() => undefined, {}, () => mind, { sessionsDir, prompts });
  const profiles = new EntityProfiles(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'entity-profiles-')), 'profiles.json'));
  let result: { status: number; body: any } = { status: 0, body: null };
  let body: unknown = null;
  const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
  registerEntityRoutes(router, { session, profiles, prompts, isModel: async id => id.startsWith('openai-codex/') });
  const call = async (method: 'GET' | 'POST', path: string, payload?: unknown) => {
    body = payload ?? null;
    await router.handle({ method } as any, {} as any, new URL(`http://hub.test${path}`)).catch(() => {});
    return result;
  };
  return { session, call, systems };
}

test('entity routes: start, send input, and see the entity act; bad input and running reconfiguration are refused', async () => {
  const { session, call } = harness();
  try {
    expect((await call('GET', '/api/entity/state')).body.snapshot.status).toBe('idle');
    const models = { head: { model: 'openai-codex/gpt-6-sol', reasoning: 'high' }, task: { model: 'openai-codex/gpt-6-luna', reasoning: 'low' }, voice: null };
    expect((await call('POST', '/api/entity/config', { models })).body.config.models).toEqual(models);
    expect((await call('POST', '/api/entity/control', { action: 'start' })).body.status).toBe('running');
    expect((await call('POST', '/api/entity/input', { type: 'chat_message', data: { text: 'press 556' } })).status).toBe(200);
    for (let i = 0; i < 100 && session.state().events.filter(e => e.type === 'key_down' && e.by !== 'user').length < 3; i++) await sleep(10);
    expect(session.state().events.filter(e => e.type === 'key_down' && e.by !== 'user').map(e => e.data.key).join('')).toBe('556');
    // A clicked option answers a question: the message carries the question's seq.
    const answered = (await call('POST', '/api/entity/input', { type: 'chat_message', data: { text: 'Staging', reply_to: 2 } })).body.seq;
    expect(session.state().events.find(e => e.seq === answered)?.data).toEqual({ text: 'Staging', reply_to: 2 });
    const several = (await call('POST', '/api/entity/input', { type: 'chat_message', data: { text: '1. Both\n2. —', reply_to: 2, picks: ['Both', ''] } })).body.seq;
    expect(session.state().events.find(e => e.seq === several)?.data).toEqual({ text: '1. Both\n2. —', reply_to: 2, picks: ['Both', ''] });
    expect((await call('POST', '/api/entity/input', { type: 'key_down', data: { key: 'x' } })).status).toBe(400);
    expect((await call('POST', '/api/entity/input', { type: 'teleport', data: {} })).status).toBe(400);
    expect((await call('POST', '/api/entity/config', { evaluator: 'jev' })).status).toBe(409);
    expect((await call('POST', '/api/entity/config', { models: { ...models, head: { model: 'openai/gpt-4o', reasoning: 'high' } } })).status).toBe(400);
    await call('POST', '/api/entity/control', { action: 'reset' });
    expect(session.state().snapshot.status).toBe('idle');
    expect(session.state().events).toHaveLength(0);
  } finally {
    session.close();
  }
});

test('entity routes: a session is recorded from Start to Reset and can be replayed exactly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-sessions-'));
  const { session, call } = harness(dir);
  try {
    expect((await call('GET', '/api/entity/sessions')).body.sessions).toHaveLength(0);
    await call('POST', '/api/entity/control', { action: 'start' });
    const id = session.state().sessionId!;
    expect(id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
    await call('POST', '/api/entity/input', { type: 'chat_message', data: { text: 'press 556' } });
    for (let i = 0; i < 100 && session.state().events.filter(e => e.type === 'key_down' && e.by !== 'user').length < 3; i++) await sleep(10);

    // While live: served from memory, listed as live, and already on disk.
    const live = (await call('GET', `/api/entity/sessions/${id}`)).body;
    expect(live.meta.status).toBe('live');
    expect(live.meta.firstMessage).toBe('press 556');
    expect(live.events.map((e: any) => e.seq)).toEqual(session.state().events.map(e => e.seq));
    expect((await call('GET', '/api/entity/sessions')).body.sessions[0]).toMatchObject({ id, status: 'live' });

    // Frames rebuild the channels' state: frame 0 is the full idle state; applying every patch gives the final state.
    // The runtime's own state (limbs, stops, notes) is rebuilt from the log alone.
    expect(live.frames[0]).toMatchObject({ seq: 0 });
    expect(live.frames[0].patch.status).toBe('idle');
    const rebuilt = live.frames.reduce((state: any, frame: any) => ({ ...state, ...frame.patch }), {});
    const now = session.state().snapshot;
    expect(rebuilt.world).toEqual(now.world);
    expect(rebuilt.limbs).toBeUndefined();
    expect(snapshotLimbs(replayRuntime(live.events))).toEqual(now.limbs);
    // Channel state is exact at every event, even inside one runtime turn: at the entity's key_down, before its key_up, the key is held.
    const press = live.events.find((e: any) => e.type === 'key_down' && e.by !== 'user');
    const atPress = live.frames.filter((f: any) => f.seq <= press.seq).reduce((state: any, frame: any) => ({ ...state, ...frame.patch }), {});
    expect(atPress.world.keypad.held[press.data.key]?.by).toBe(press.by);

    await call('POST', '/api/entity/control', { action: 'reset' });
    await sleep(20);
    const ended = (await call('GET', `/api/entity/sessions/${id}`)).body;
    expect(ended.meta).toMatchObject({ status: 'ended', endReason: 'reset' });
    expect(ended.events.length).toBe(live.events.length);
    expect(fs.readFileSync(path.join(dir, id, 'events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(live.events.length);
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect((await call('GET', '/api/entity/sessions/..%2F..%2Fetc')).status).toBe(400);
    expect((await call('GET', '/api/entity/sessions/20990101-000000-zzzz')).status).toBe(404);
  } finally {
    session.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entity session: after a Hub restart the newest session resumes, paused, with its workers\' conversations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-sessions-'));
  const histories: unknown[][] = [];
  const makeMind = (_config: unknown, conversations: ConversationStore): Mind => ({
    async run(input) {
      if (input.role === 'head' && input.prompt.includes(' user chat_message {"text":"work on it"}') && input.prompt.includes('"woken_because":"user message"')) {
        await input.callTool('dispatch', { task: 'the job', name: 'job' });
      }
      if (input.role === 'task') {
        histories.push(conversations.load(input.limbId) ?? []);
        conversations.append(input.limbId, [{ role: 'user', content: `wake ${histories.length}`, timestamp: 0 }]);
        await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
      }
      return {};
    },
  });
  let session = new EntitySession(() => undefined, {}, makeMind, { sessionsDir: dir });
  try {
    session.control('start');
    const id = session.state().sessionId!;
    session.input('chat_message', { text: 'work on it' });
    for (let i = 0; i < 100 && !histories.length; i++) await sleep(10);
    expect(histories).toEqual([[]]);
    session.close();
    expect(JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')).status).toBe('suspended');

    // A new Hub: the same session, paused, its log and the worker's conversation intact.
    session = new EntitySession(() => undefined, {}, makeMind, { sessionsDir: dir });
    expect(session.state().sessionId).toBe(id);
    expect(session.state().snapshot.status).toBe('paused');
    expect(session.state().snapshot.limbs.find(l => l.name === 'job')).toMatchObject({ status: 'running', runs: [] });
    expect(session.sessions()[0]).toMatchObject({ id, status: 'live' });
    session.control('resume');
    for (let i = 0; i < 100 && histories.length < 2; i++) await sleep(10);
    expect(histories[1]).toEqual([{ role: 'user', content: 'wake 1', timestamp: 0 }]);

    // A Reset ends it for good: the next Hub starts fresh.
    session.control('reset');
    session.close();
    session = new EntitySession(() => undefined, {}, makeMind, { sessionsDir: dir });
    expect(session.state().snapshot.status).toBe('idle');
  } finally {
    session.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entity mind: conversations are kept on disk, forked from disk after a restart, and forgotten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-conversations-'));
  try {
    const store = fileConversationStore(dir);
    store.append('worker-3', [{ role: 'user', content: 'a', timestamp: 1 }]);
    store.append('worker-3', [{ role: 'user', content: 'b', timestamp: 2 }]);
    expect(store.load('worker-3')?.map(m => m.content)).toEqual(['a', 'b']);
    const mind = new PiAiMind('medium', store); // a fresh mind, as after a restart: nothing in memory
    expect(mind.fork('worker-3', 'worker-9')).toBe(true);
    expect(store.load('worker-9')?.map(m => m.content)).toEqual(['a', 'b']);
    mind.forget('worker-3');
    expect(store.load('worker-3')).toBeUndefined();
    expect(mind.fork('worker-3', 'worker-10')).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entity profiles: saved, renamed, refused when invalid or a duplicate name, and deleted', async () => {
  const { session, call } = harness();
  try {
    const models = { head: { model: 'openai-codex/gpt-6-sol', reasoning: 'high' }, task: { model: 'openai-codex/gpt-6-sol', reasoning: 'medium' }, voice: { model: 'openai-codex/gpt-6-luna', reasoning: 'off' } };
    const saved = (await call('POST', '/api/entity/profiles', { name: 'Deep', models })).body.profile;
    expect(saved).toMatchObject({ name: 'Deep', models });
    expect((await call('POST', '/api/entity/profiles', { name: 'deep', models })).body.profiles).toHaveLength(1); // same name: replaced
    expect((await call('POST', '/api/entity/profiles', { name: 'Fast', models })).body.profiles).toHaveLength(2);
    expect((await call('POST', '/api/entity/profiles', { id: saved.id, name: 'Fast', models })).status).toBe(409);
    expect((await call('POST', '/api/entity/profiles', { name: 'Bad', models: { ...models, task: { model: 'openai-codex/gpt-6-sol', reasoning: 'extreme' } } })).status).toBe(400);
    expect((await call('POST', '/api/entity/profiles', { id: saved.id, name: 'Careful', models })).body.profile).toMatchObject({ id: saved.id, name: 'Careful' });
    expect((await call('POST', '/api/entity/profiles/delete', { id: saved.id })).body.profiles.map((p: any) => p.name)).toEqual(['Fast']);
    expect((await call('POST', '/api/entity/profiles/delete', { id: saved.id })).status).toBe(404);
  } finally {
    session.close();
  }
});

test('entity config: recordings from before per-part models resume with their models, and each part thinks at its own level', () => {
  const config = entityConfigFrom({ headModel: 'openai-codex/gpt-6-luna', taskModel: 'openai-codex/gpt-6-sol', voiceModel: '', reasoning: 'low', summaries: false });
  expect(config.models).toEqual({ head: { model: 'openai-codex/gpt-6-luna', reasoning: 'low' }, task: { model: 'openai-codex/gpt-6-sol', reasoning: 'low' }, voice: null });
  expect(config.summaries).toBe(false);
  expect('headModel' in config).toBe(false);
  const models = { head: { model: 'h', reasoning: 'high' as const }, task: { model: 't', reasoning: 'low' as const }, voice: { model: 'v', reasoning: 'off' as const } };
  expect(reasoningFor(models, { role: 'head', model: 'h' })).toBe('high');
  expect(reasoningFor(models, { role: 'voice', model: 'v' })).toBe('off');
  expect(reasoningFor(models, { role: 'task', model: 't' })).toBe('low');
  expect(reasoningFor(models, { role: 'task', model: 'h' })).toBe('high'); // a worker sent to the head's model
});

test('entity prompts: every section is listed with its default; an edit is used from the next wake, and reset restores it', async () => {
  const { session, call, systems } = harness();
  try {
    const sections = (await call('GET', '/api/entity/prompts')).body.sections;
    expect(sections.find((x: any) => x.id === 'head_front')).toMatchObject({ edited: false });
    expect(sections.some((x: any) => x.id === 'hub_work_summaries')).toBe(true);
    const saved = (await call('POST', '/api/entity/prompts', { id: 'head_front', text: 'You are the head. Be terse.' })).body.sections;
    expect(saved.find((x: any) => x.id === 'head_front')).toMatchObject({ edited: true, text: 'You are the head. Be terse.' });
    expect((await call('POST', '/api/entity/prompts', { id: 'nope', text: 'x' })).status).toBe(404);
    session.control('start');
    for (let i = 0; i < 100 && !systems.length; i++) await sleep(10);
    expect(systems[0]).toContain('You are the head. Be terse.');
    const reset = (await call('POST', '/api/entity/prompts/reset', { id: 'head_front' })).body.sections;
    expect(reset.find((x: any) => x.id === 'head_front')).toMatchObject({ edited: false });
    // Saving the default text itself is the same as a reset.
    const def = reset.find((x: any) => x.id === 'supersede').default;
    expect((await call('POST', '/api/entity/prompts', { id: 'supersede', text: def })).body.sections.find((x: any) => x.id === 'supersede').edited).toBe(false);
  } finally {
    session.close();
  }
});
