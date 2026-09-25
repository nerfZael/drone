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

test('parallel: each message gets a worker at once; workers reply in their own threads; questions are answered from state', async () => {
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
  }, { config: { parallel: true } });
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

test('parallel: steer reaches a busy worker with its next tool result; fork continues from a worker; after waits', async () => {
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
  }, { config: { parallel: true } });
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
  }, { config: { parallel: true }, channels: [chatChannel(), keypadChannel(), workspaceChannel({ root: dir })] });
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
