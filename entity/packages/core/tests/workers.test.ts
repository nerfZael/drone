import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chatChannel, keypadChannel, workspaceChannel } from '../src/index.js';
import { lastUserMessage, makeEntity, ownTask, sleep, until } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function setup(...args: Parameters<typeof makeEntity>) {
  const h = makeEntity(...args);
  cleanups.push(() => h.entity.close());
  return h;
}
function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'entity-ws-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'app.ts'), 'export const answer = 41;\n');
  return dir;
}

test('workers: each message gets a worker at once; workers reply in their own threads; questions are answered from state', async () => {
  let releaseFirst!: () => void;
  const firstBusy = new Promise<void>(r => { releaseFirst = r; });
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head') {
      if (message === 'fix the flaky test') await call('dispatch', { task: 'fix the flaky test', name: 'flaky' });
      if (message === 'add a changelog entry') await call('dispatch', { task: 'add a changelog entry', name: 'changelog' });
      if (message === "how's the test fix going?") await call('say', { text: 'task-3 is still on it' });
    }
    if (input.role === 'task' && ownTask(input) === 'fix the flaky test') {
      await firstBusy;
      await call('say', { text: 'fixed: the test raced on a timer' });
      await call('finish_task', { result: 'fixed flaky test' });
    }
    if (input.role === 'task' && ownTask(input) === 'add a changelog entry') {
      await call('say', { text: 'changelog entry added' });
      await call('finish_task', { result: 'changelog' });
    }
  }, {});
  h.entity.start();
  const m1 = h.entity.input('chat_message', { text: 'fix the flaky test' });
  await until(() => h.of('limb_spawned').length === 1);
  const m2 = h.entity.input('chat_message', { text: 'add a changelog entry' });
  await until(() => h.said().includes('changelog entry added'));
  h.entity.input('chat_message', { text: "how's the test fix going?" });
  await until(() => h.said().includes('task-3 is still on it'));
  releaseFirst();
  await until(() => h.said().includes('fixed: the test raced on a timer'));
  const replies = h.of('chat_message', b => b.startsWith('task-'));
  expect(replies.find(e => e.data.text === 'fixed: the test raced on a timer')!.data.reply_to).toBe(m1.seq);
  expect(replies.find(e => e.data.text === 'changelog entry added')!.data.reply_to).toBe(m2.seq);
  expect(h.of('task_done')).toHaveLength(2);
  expect(h.mind.forgotten).toEqual([]); // finished workers keep their conversation for follow-ups
});

test('workers: steer reaches a busy worker with its next tool result; fork continues from a worker; after waits', async () => {
  const seen: string[] = [];
  let go!: () => void;
  const gate = new Promise<void>(r => { go = r; });
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head') {
      if (message === 'refactor auth') await call('dispatch', { task: 'refactor auth', name: 'auth' });
      if (message === 'keep the old API') await call('steer', { worker: 'task-3', text: 'keep the old API' });
      if (message === 'do the same for billing') await call('fork', { worker: 'task-3', task: 'do the same for billing' });
      if (message === 'then write docs') await call('dispatch', { task: 'write docs', after: 'task-3' });
    }
    if (input.role === 'task' && input.limbId === 'task-3') {
      await gate;
      seen.push(await call('note', { text: 'working' }));
      await call('finish_task', { result: 'auth refactored' });
    }
    if (input.role === 'task' && input.limbId !== 'task-3') await call('finish_task', { result: `${input.limbId} done` });
  }, {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'refactor auth' });
  await until(() => h.mind.runs.some(r => r.limbId === 'task-3'));
  h.entity.input('chat_message', { text: 'keep the old API' });
  await until(() => h.of('steered').length === 1);
  h.entity.input('chat_message', { text: 'then write docs' });
  await until(() => h.of('limb_spawned').length === 2);
  expect(h.mind.runs.some(r => r.limbId === 'task-6')).toBe(false); // waiting for task-3
  go();
  await until(() => h.of('task_done').length === 2);
  expect(seen[0]).toContain('[updates while you worked]');
  expect(seen[0]).toContain('keep the old API');
  h.entity.input('chat_message', { text: 'do the same for billing' });
  await until(() => h.of('task_done').length === 3);
  expect(h.mind.forks).toHaveLength(1);
  expect(h.mind.forks[0][0]).toBe('task-3');
});

test('workspace: tools stay inside the root, and a file claimed by one worker is refused to another', async () => {
  const dir = workspace();
  const results: Record<string, string> = {};
  let holdA!: () => void;
  const aHolds = new Promise<void>(r => { holdA = r; });
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head' && message === 'a') await call('dispatch', { task: 'edit app A', name: 'a' });
    if (input.role === 'head' && message === 'b') await call('dispatch', { task: 'edit app B', name: 'b' });
    if (input.role === 'task' && ownTask(input) === 'edit app A') {
      results.read = await call('read_file', { path: 'app.ts' });
      results.edit = await call('edit_file', { path: 'app.ts', old_text: '41', new_text: '42' });
      results.escape = await call('write_file', { path: '../outside.txt', content: 'x' });
      results.git = await call('write_file', { path: '.git/config', content: 'x' });
      await aHolds;
      await call('finish_task', { result: 'done' });
    }
    if (input.role === 'task' && ownTask(input) === 'edit app B') {
      results.b = await call('write_file', { path: 'app.ts', content: 'overwrite' });
      await call('finish_task', { result: 'gave up' });
    }
  }, { channels: [chatChannel(), keypadChannel(), workspaceChannel({ root: dir })] });
  h.entity.start();
  h.entity.input('chat_message', { text: 'a' });
  await until(() => results.git !== undefined);
  h.entity.input('chat_message', { text: 'b' });
  await until(() => results.b !== undefined);
  holdA();
  expect(results.read).toContain('41');
  expect(results.edit).toStartWith('edited app.ts');
  expect(results.escape).toContain('outside the workspace');
  expect(results.git).toContain('.git');
  expect(results.b).toContain('claimed by task-3');
  expect(readFileSync(path.join(dir, 'app.ts'), 'utf8')).toBe('export const answer = 42;\n');
  await until(() => h.of('task_done').length === 2);
  expect(h.entity.snapshot().limbs.find(l => l.id === 'head')).toBeDefined();
});

test('workspace: run is only offered when commands are allowed', async () => {
  const dir = workspace();
  const off = workspaceChannel({ root: dir });
  const on = workspaceChannel({ root: dir, allowCommands: true });
  expect(off.effects.some(e => e.name === 'run')).toBe(false);
  const run = on.effects.find(e => e.name === 'run')!;
  const events: string[] = [];
  const out = await run.apply({ command: 'echo hi && cat app.ts' }, { caller: { limbId: 't', kind: 'llm', readSeq: 0 }, world: on.init(), emit: (type) => { events.push(type); return {} as never; }, now: () => 0, events: () => [] });
  expect(out).toContain('exit 0');
  expect(out).toContain('answer = 41');
  expect(events).toEqual(['command_ran']);
  await sleep(1);
});

test('work view data: tool calls are logged with outcomes, busy workers get summaries, and the user can message or stop a worker', async () => {
  const summaries: string[] = [];
  const summarizer = { async summarize(input: { task: string; activity: string }) { summaries.push(input.activity); return { done: ['read the file'], doing: ['editing'], next: ['run tests'] }; } };
  let release!: () => void;
  const hold = new Promise<void>(r => { release = r; });
  const heard: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'work') await call('dispatch', { task: 'do some work', name: 'worker' });
    if (input.role === 'task') {
      for (let i = 0; i < 4; i++) await call('note', { text: `step ${i}` });
      await call('press', { key: 'x' }); // invalid: logged as not ok
      await hold;
      heard.push(await call('note', { text: 'after' }));
      await call('finish_task', { result: 'done' });
    }
  }, { config: { summaryEveryCalls: 4, summaryIntervalMs: 0 }, summarizer });
  h.entity.start();
  h.entity.input('chat_message', { text: 'work' });
  await until(() => h.of('work_summary').length === 1);
  const summary = h.of('work_summary')[0];
  expect(summary.data).toMatchObject({ limb: 'task-3', done: ['read the file'], doing: ['editing'], next: ['run tests'] });
  expect(summaries[0]).toContain('called note: step 0');
  await until(() => h.of('tool_done').some(e => e.data.ok === false));
  expect(h.of('tool_called', b => b === 'task-3').map(e => e.data.name)).toContain('press');
  expect(h.entity.messageWorker('task-3', 'use tabs, not spaces')).toContain('next tool result');
  release();
  await until(() => heard.length === 1);
  expect(heard[0]).toContain('Message from the user: use tabs, not spaces');
  await until(() => h.of('task_done').length === 1);
  const worker = h.entity.snapshot().limbs.find(l => l.id === 'task-3')!;
  expect(worker.endedAt).toBeGreaterThan(worker.createdAt);
  expect(worker.replyTo).toBeGreaterThan(0);
  expect(h.entity.stopWorker('task-3')).toContain('already done');
});

test('a worker that runs out of turns is continued with its conversation, then marked failed at the cap; one that ends quietly keeps its last reply as result', async () => {
  let turns = 0;
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head' && message === 'long') await call('dispatch', { task: 'long work', name: 'long' });
    if (input.role === 'head' && message === 'short') await call('dispatch', { task: 'short work', name: 'short' });
    if (input.role === 'task' && ownTask(input) === 'long work') { turns++; return; }
    if (input.role === 'task' && ownTask(input) === 'short work') await call('say', { text: 'here is the answer' });
  }, { config: { taskContinuations: 2 } });
  // The scripted mind reports running out of turns for the long worker.
  const run = h.mind.run.bind(h.mind);
  h.mind.run = async input => ({ ...(await run(input)), ...(input.role === 'task' && ownTask(input) === 'long work' ? { stopReason: 'max_steps' as const } : {}) });
  h.entity.start();
  h.entity.input('chat_message', { text: 'long' });
  await until(() => h.of('task_done').length === 1);
  expect(turns).toBe(3);
  expect(h.of('task_continued')).toHaveLength(2);
  expect(h.of('task_done')[0].data).toMatchObject({ status: 'failed' });
  h.entity.input('chat_message', { text: 'short' });
  await until(() => h.of('task_done').length === 2);
  expect(h.of('task_done')[1].data).toMatchObject({ status: 'done', result: 'here is the answer' });
});
