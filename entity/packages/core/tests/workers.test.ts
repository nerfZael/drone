import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chatChannel, keypadChannel, workspaceChannel, type MindRunInput } from '../src/index.js';
import { lastUserMessage, makeEntity, ownTask, sleep, stableState, until } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function setup(...args: Parameters<typeof makeEntity>) {
  const h = makeEntity(...args);
  cleanups.push(() => { h.expectReplayable(); h.entity.close(); });
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
      if (message === "how's the test fix going?") await call('say', { text: 'worker-3 is still on it' });
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
  await until(() => h.said().includes('worker-3 is still on it'));
  releaseFirst();
  await until(() => h.said().includes('fixed: the test raced on a timer'));
  const replies = h.of('chat_message', b => b.startsWith('worker-'));
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
      if (message === 'keep the old API') await call('steer', { worker: 'worker-3', text: 'keep the old API' });
      if (message === 'do the same for billing') await call('fork', { worker: 'worker-3', task: 'do the same for billing' });
      if (message === 'then write docs') await call('dispatch', { task: 'write docs', after: 'worker-3' });
    }
    if (input.role === 'task' && input.limbId === 'worker-3') {
      await gate;
      seen.push(await call('note', { text: 'working' }));
      await call('finish_task', { result: 'auth refactored' });
    }
    if (input.role === 'task' && input.limbId !== 'worker-3') await call('finish_task', { result: `${input.limbId} done` });
  }, {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'refactor auth' });
  await until(() => h.mind.runs.some(r => r.limbId === 'worker-3'));
  h.entity.input('chat_message', { text: 'keep the old API' });
  await until(() => h.of('steered').length === 1);
  h.entity.input('chat_message', { text: 'then write docs' });
  await until(() => h.of('limb_spawned').length === 2);
  expect(h.mind.runs.some(r => r.limbId === 'worker-6')).toBe(false); // waiting for worker-3
  go();
  await until(() => h.of('task_done').length === 2);
  expect(seen[0]).toContain('[updates while you worked]');
  expect(seen[0]).toContain('keep the old API');
  h.entity.input('chat_message', { text: 'do the same for billing' });
  await until(() => h.of('task_done').length === 3);
  expect(h.mind.forks).toHaveLength(1);
  expect(h.mind.forks[0][0]).toBe('worker-3');
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
      await aHolds;
      await call('finish_task', { result: 'gave up' });
    }
  }, { channels: [chatChannel(), keypadChannel(), workspaceChannel({ root: dir })] });
  h.entity.start();
  h.entity.input('chat_message', { text: 'a' });
  await until(() => results.git !== undefined);
  h.entity.input('chat_message', { text: 'b' });
  await until(() => results.b !== undefined);
  // Who blocks whom is a fact in state, not something to read out of the refusal text.
  const b = h.entity.snapshot().limbs.find(l => l.name === 'b')!;
  expect(b.blockedBy).toEqual({ limb: 'worker-3', path: 'app.ts' });
  holdA();
  expect(results.read).toContain('41');
  expect(results.edit).toStartWith('edited app.ts');
  expect(results.escape).toContain('outside the workspace');
  expect(results.git).toContain('.git');
  expect(results.b).toContain('claimed by worker-3');
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
  expect(summary.data).toMatchObject({ limb: 'worker-3', done: ['read the file'], doing: ['editing'], next: ['run tests'] });
  expect(summaries[0]).toContain('called note: step 0');
  await until(() => h.of('tool_done').some(e => e.data.ok === false));
  expect(h.of('tool_called', b => b === 'worker-3').map(e => e.data.name)).toContain('press');
  expect(h.entity.messageWorker('worker-3', 'use tabs, not spaces')).toContain('next tool result');
  release();
  await until(() => heard.length === 1);
  expect(heard[0]).toContain('Message from the user: use tabs, not spaces');
  await until(() => h.of('task_done').length === 1);
  const worker = h.entity.snapshot().limbs.find(l => l.id === 'worker-3')!;
  expect(worker.endedAt).toBeGreaterThan(worker.createdAt);
  expect(worker.replyTo).toBeGreaterThan(0);
  expect(h.entity.stopWorker('worker-3')).toContain('already done');
});

test('a worker that runs out of turns is continued with its conversation, then marked failed at the cap; one that ends quietly keeps its last reply as result', async () => {
  let turns = 0;
  // A worker's later wakes show only what changed, so its task is known from its first one.
  const tasks = new Map<string, string>();
  const taskOf = (input: MindRunInput) => { if (!tasks.has(input.limbId)) tasks.set(input.limbId, ownTask(input)); return tasks.get(input.limbId); };
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head' && message === 'long') await call('dispatch', { task: 'long work', name: 'long' });
    if (input.role === 'head' && message === 'short') await call('dispatch', { task: 'short work', name: 'short' });
    if (input.role === 'task' && taskOf(input) === 'long work') { turns++; return; }
    if (input.role === 'task' && taskOf(input) === 'short work') await call('say', { text: 'here is the answer' });
  }, { config: { taskContinuations: 2 } });
  // The scripted mind reports running out of turns for the long worker.
  const run = h.mind.run.bind(h.mind);
  h.mind.run = async input => ({ ...(await run(input)), ...(input.role === 'task' && taskOf(input) === 'long work' ? { stopReason: 'max_steps' as const } : {}) });
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

test('workers: dispatch_many starts a batch; past the running limit workers queue and start as others finish; a queued worker can be steered or stopped', async () => {
  const release = new Map<string, () => void>();
  const started: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'fix all five') {
      const result = await call('dispatch_many', { title: 'Open issues', items: [1, 2, 3, 4, 5].map(n => ({ task: `issue ${n}`, name: `#${n}` })) });
      expect(result).toContain('5 workers (2 started, 3 queued)');
    }
    if (input.role === 'task') {
      started.push(ownTask(input));
      await new Promise<void>(r => release.set(ownTask(input), r));
      await call('finish_task', { result: `${ownTask(input)} done` });
    }
  }, { config: { maxTasks: 2 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'fix all five' });
  await until(() => h.of('limb_spawned').length === 5 && started.length === 2);
  const group = h.of('group_started')[0].data;
  expect(group).toMatchObject({ title: 'Open issues', count: 5 });
  const workers = h.entity.snapshot().limbs.filter(l => l.role === 'task');
  expect(workers.every(l => l.group === group.id)).toBe(true);
  expect(workers.map(l => l.status)).toEqual(['running', 'running', 'queued', 'queued', 'queued']);
  expect(h.entity.messageWorker(workers[2].id, 'use the new API')).toContain('queued');
  expect(h.entity.stopWorker(workers[4].id)).toContain('before it started');
  release.get('issue 1')!();
  await until(() => started.length === 3);
  expect(started[2]).toBe('issue 3');
  expect(h.mind.runs.find(r => r.limbId === workers[2].id)!.prompt).toContain('use the new API');
  release.get('issue 2')!();
  await until(() => started.length === 4);
  release.get('issue 3')!(); release.get('issue 4')!();
  await until(() => h.of('task_done').length === 5);
  expect(h.of('task_done').map(e => e.data.status).sort()).toEqual(['cancelled', 'done', 'done', 'done', 'done']);
});

test('workers: watches and programs carry a short label', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    await call('set_watch', { watch: { name: 'run tests when quiet', label: 'tests on quiet', on: { event: 'key_down' }, do: { wake: { reason: 'x' } } } });
    await call('run_program', { name: 'hammer', label: 'reset ×20', code: 'await wait(1000)' });
  }, {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('program_started').length === 1);
  const labels = h.entity.snapshot().limbs.filter(l => l.kind === 'code').map(l => l.label);
  expect(labels.sort()).toEqual(['reset ×20', 'tests on quiet']);
});

test('workers: a batch shows one progress line in the chat; its workers reply in their threads; the front limb hears when it ends', async () => {
  const release = new Map<string, () => void>();
  let finished = '';
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'fix three' && input.prompt.includes('"woken_because":"user message"')) {
      await call('dispatch_many', { title: 'Three fixes', items: [{ task: 'fix a', name: 'a' }, { task: 'fix b', name: 'b' }, { task: 'fix c', name: 'c' }] });
    }
    const reason = String(JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\nTIME\n') + 6)).woken_because);
    if (input.role === 'head' && reason.startsWith('batch')) finished = reason;
    if (input.role === 'task') {
      expect(input.system).toContain('Three fixes');
      expect(await call('say', { text: `working on ${ownTask(input)}` })).toBe('posted in your thread');
      await new Promise<void>(r => release.set(ownTask(input), r));
      await call('finish_task', { result: `${ownTask(input)} done` });
    }
  }, { config: { maxTasks: 2 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'fix three' });
  await until(() => release.size === 2);
  const line = h.of('chat_message').find(e => e.data.group)!;
  expect(line.data.text).toBe('Three fixes: 0 of 3 done, 2 running, 1 queued.');
  // Thread replies are logged but kept out of the chat's state.
  const chat = h.entity.snapshot().world.chat as { messages: { text: string }[] };
  expect(chat.messages.map(m => m.text)).toEqual(['fix three', 'Three fixes: 0 of 3 done, 2 running, 1 queued.']);
  release.get('fix a')!();
  await until(() => release.size === 3);
  release.get('fix b')!(); release.get('fix c')!();
  await until(() => finished !== '');
  const updates = h.of('chat_message_updated').map(e => e.data.text);
  expect(updates[updates.length - 1]).toBe('Three fixes: 3 of 3 done.');
  expect((h.entity.snapshot().world.chat as { messages: { text: string }[] }).messages[1].text).toBe('Three fixes: 3 of 3 done.');
  expect(finished).toContain('batch "Three fixes" finished. Three fixes: 3 of 3 done.');
  expect(finished).toContain('c: done: fix c done');
});

test('workers: a steer for after waits until the worker finishes, then it continues in the same conversation', async () => {
  let release!: () => void;
  const prompts: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'build the game') await call('dispatch', { task: 'build the game', name: 'game' });
    if (input.role === 'head' && lastUserMessage(input) === 'then add tests') expect(await call('steer', { worker: 'worker-3', text: 'add tests', when: 'after' })).toContain('once it finishes');
    if (input.role === 'task') {
      prompts.push(input.prompt);
      if (prompts.length === 1) { await new Promise<void>(r => { release = r; }); await call('finish_task', { result: 'game built' }); }
      else await call('finish_task', { result: 'tests added' });
    }
  }, {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'build the game' });
  await until(() => prompts.length === 1);
  h.entity.input('chat_message', { text: 'then add tests' });
  await until(() => h.of('steered').length === 1);
  await sleep(30);
  expect(prompts).toHaveLength(1); // not interrupted
  release();
  await until(() => h.of('task_done').length === 2);
  expect(prompts[1]).toContain('queued for after that | Message from the user (via head): add tests');
  expect(h.of('task_done').map(e => e.data.result)).toEqual(['game built', 'tests added']);
});

test('review: the front limb\'s answers get a second look; a wrong one is struck and corrected below, the rest count as confirmed', async () => {
  const reviews: string[] = [];
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.limbId === 'head' && input.prompt.includes('"woken_because":"user message"')) {
      if (message === 'hi') await call('say', { text: 'hey!' });
      if (message === 'what is 17 * 3?') await call('say', { text: '17 * 3 is 41' });
    }
    if (input.limbId === 'reviewer') {
      reviews.push(JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\nTIME\n') + 6)).woken_because);
      const wrong = h.of('chat_message').find(e => e.data.text === '17 * 3 is 41');
      if (wrong) expect(await call('amend', { seq: wrong.seq, verdict: 'correct', text: '17 * 3 is 51' })).toContain('corrected');
    }
  }, { config: { review: 'separate', reviewQuietMs: 40 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'hi' });
  await until(() => h.of('message_reviewed').length === 1);
  expect(h.of('message_reviewed')[0].data).toMatchObject({ verdict: 'confirmed', implicit: true });
  h.entity.input('chat_message', { text: 'what is 17 * 3?' });
  await until(() => h.of('message_reviewed').length === 2);
  const wrong = h.of('chat_message').find(e => e.data.text === '17 * 3 is 41')!;
  const fix = h.of('chat_message').find(e => e.data.corrects === wrong.seq)!;
  expect(fix).toMatchObject({ by: 'reviewer', data: { text: '17 * 3 is 51' } });
  expect(h.of('message_reviewed')[1].data).toMatchObject({ seq: wrong.seq, verdict: 'corrected', by: fix.seq });
  expect(reviews).toHaveLength(2);
  const chat = h.entity.snapshot().world.chat as { messages: { seq: number; correctedBy?: number }[] };
  expect(chat.messages.find(m => m.seq === wrong.seq)!.correctedBy).toBe(fix.seq);
});

test('review: with review "head", the head reviews the voice\'s answers', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'voice' && lastUserMessage(input) === 'capital of Australia?') await call('say', { text: 'Sydney' });
    if (input.role === 'head' && input.prompt.includes('"woken_because":"review')) {
      expect(input.tools.some(t => t.name === 'amend')).toBe(true);
      await call('amend', { seq: h.of('chat_message').find(e => e.data.text === 'Sydney')!.seq, verdict: 'correct', text: 'Canberra, not Sydney.' });
    }
  }, { models: { head: 'test/head', task: 'test/task', voice: 'test/voice' }, config: { review: 'head', reviewQuietMs: 40 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'capital of Australia?' });
  await until(() => h.of('message_reviewed').length === 1);
  expect(h.said()).toEqual(['Sydney', 'Canberra, not Sydney.']);
});

test('reroute: a message steered into a worker can be moved to its own worker or a fork, and the steered worker is told', async () => {
  let release!: () => void;
  const seen: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'build the game') await call('dispatch', { task: 'build the game', name: 'game' });
    if (input.role === 'head' && lastUserMessage(input) === 'also nice sprites') await call('steer', { worker: 'worker-3', text: 'also nice sprites' });
    if (input.role === 'task' && input.limbId === 'worker-3') {
      await new Promise<void>(r => { release = r; });
      seen.push(await call('note', { text: 'still going' }));
      await call('finish_task', { result: 'game' });
    }
    if (input.role === 'task' && input.limbId !== 'worker-3') await call('finish_task', { result: 'sprites' });
  }, {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'build the game' });
  await until(() => h.of('limb_spawned').length === 1);
  const m2 = h.entity.input('chat_message', { text: 'also nice sprites' });
  await until(() => h.of('steered').length === 1);
  expect(h.entity.reroute(m2.seq, 'fork')).toContain('started from worker-3');
  const spawn = h.of('limb_spawned')[1].data;
  expect(spawn).toMatchObject({ fork_of: 'worker-3', reply_to: m2.seq });
  expect(h.of('rerouted')[0].data).toMatchObject({ seq: m2.seq, how: 'fork', from: 'worker-3' });
  release();
  await until(() => h.of('task_done').length === 2);
  expect(seen[0]).toContain('moved their message "also nice sprites" to a separate worker');
});

test('a worker waiting with "after" is not started early by a steer or by pause and resume', async () => {
  let release!: () => void;
  const started: string[] = [];
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head' && message === 'build it') await call('dispatch', { task: 'build it' });
    if (input.role === 'head' && message === 'then document it') await call('dispatch', { task: 'document it', name: 'docs', after: 'worker-3' });
    if (input.role === 'task') {
      started.push(input.limbId);
      if (input.limbId === 'worker-3') { await new Promise<void>(r => { release = r; }); if (input.signal.aborted) return; }
      await call('finish_task', { result: `${input.limbId} done` });
    }
  }, {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'build it' });
  await until(() => started.length === 1);
  h.entity.input('chat_message', { text: 'then document it' });
  await until(() => h.of('limb_spawned').length === 2);
  const docs = String(h.of('limb_spawned')[1].data.id);
  expect(h.entity.snapshot().limbs.find(l => l.id === docs)).toMatchObject({ status: 'waiting', waitFor: 'worker-3' });
  expect(h.entity.messageWorker(docs, 'use markdown')).toContain('waiting for worker-3');
  h.entity.pause();
  h.entity.resume();
  release(); // the paused run winds down after the resume; worker-3 is woken again
  await until(() => started.length === 2);
  await sleep(20);
  expect(started).toEqual(['worker-3', 'worker-3']);
  release();
  await until(() => h.of('task_done').length === 2);
  expect(started).toEqual(['worker-3', 'worker-3', docs]);
  expect(h.of('limb_started')[0].data).toMatchObject({ id: docs, after: 'worker-3' });
  expect(h.mind.runs.find(r => r.limbId === docs)!.prompt).toContain('use markdown');
});

test('review: a review run that crashes leaves its answers unchecked, never confirmed', async () => {
  const h = setup(async (input, call) => {
    if (input.limbId === 'head' && lastUserMessage(input) === 'hi') await call('say', { text: 'hey!' });
    if (input.limbId === 'reviewer') throw new Error('model outage');
  }, { config: { review: 'separate', reviewQuietMs: 40 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'hi' });
  await until(() => h.of('message_reviewed').length === 1);
  expect(h.of('message_reviewed')[0].data).toMatchObject({ verdict: 'unchecked', reason: 'failed' });
});

test('review: with review "head", a verdict is not superseded by a newer head run', async () => {
  let release!: () => void;
  let verdict = '';
  const h = setup(async (input, call) => {
    if (input.role === 'voice' && lastUserMessage(input) === 'capital of Australia?') await call('say', { text: 'Sydney' });
    if (input.role === 'head' && input.prompt.includes('"woken_because":"review')) {
      await new Promise<void>(r => { release = r; });
      verdict = await call('amend', { seq: h.of('chat_message').find(e => e.data.text === 'Sydney')!.seq, verdict: 'correct', text: 'Canberra.' });
    }
  }, { models: { head: 'test/head', task: 'test/task', voice: 'test/voice' }, config: { review: 'head', reviewQuietMs: 40 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'capital of Australia?' });
  await until(() => !!release);
  h.entity.wake('head', 'heartbeat');
  release();
  await until(() => h.of('message_reviewed').length === 1);
  expect(verdict).toContain('corrected');
  expect(h.said()).toEqual(['Sydney', 'Canberra.']);
});

test('context: in a big batch, a worker sees its siblings without their tasks, and the front limb sees one line per worker', async () => {
  const release: (() => void)[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'fix all of them') {
      await call('dispatch_many', { title: 'Fix files', items: Array.from({ length: 40 }, (_, i) => ({ task: `fix file ${i}: ${'x'.repeat(2000)}`, name: `file ${i}` })) });
    }
    if (input.role === 'task') await new Promise<void>(r => release.push(r));
  }, { config: { maxTasks: 40 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'fix all of them' });
  await until(() => h.mind.runs.filter(r => r.role === 'task').length === 40);
  const worker = h.mind.runs.filter(r => r.role === 'task').at(-1)!; // the last one started sees all 39 siblings
  expect(worker.prompt.split('x'.repeat(2000)).length - 1).toBe(1); // only its own task in full
  expect(worker.prompt.length).toBeLessThan(10_000);
  const siblings = stableState(worker).workers as string[];
  expect(siblings).toHaveLength(31); // 30 shown, then "(9 more not shown)"
  h.entity.wake('head', 'look');
  await until(() => h.mind.runs.filter(r => r.role === 'head').length === 3);
  const head = h.mind.runs.filter(r => r.role === 'head').at(-1)!;
  expect(stableState(head).workers).toHaveLength(40);
  expect(head.prompt.length).toBeLessThan(12_000); // batch members show the batch title, not their tasks
  for (const r of release) r();
});

test('context: a worker\'s later wakes show only the state that changed; the stable part holds no ages', async () => {
  let release!: () => void;
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'go') await call('dispatch', { task: 'the job', name: 'job' });
    if (input.role === 'head' && lastUserMessage(input) === 'note it') await call('note', { text: 'remember the blue one' });
    if (input.role === 'task' && ownTask(input) === 'the job') await new Promise<void>(r => { release = r; });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => !!release);
  release();
  await until(() => h.of('task_done').length === 1);
  h.entity.input('chat_message', { text: 'note it' });
  await until(() => h.of('note').length === 1);
  expect(h.entity.messageWorker('worker-3', 'one more thing')).toContain('picked the conversation back up');
  await until(() => h.mind.runs.filter(r => r.limbId === 'worker-3').length === 2);
  const [first, second] = h.mind.runs.filter(r => r.limbId === 'worker-3');
  expect(stableState(first).task).toBe('the job');
  expect(second.prompt).toContain('STATE (stable, only what changed since your last wake)');
  expect(stableState(second)).toEqual({ notes: ['remember the blue one'] });
  expect(second.prompt).toContain('Message from the user: one more thing');
  await until(() => h.of('task_done').length === 2);
  // The head's stable part is the same from wake to wake when only time passes.
  h.entity.wake('head', 'a');
  await sleep(20);
  h.entity.wake('head', 'b');
  await sleep(20);
  const heads = h.mind.runs.filter(r => r.role === 'head').slice(-2).map(r => JSON.stringify(stableState(r)));
  expect(heads[0]).toBe(heads[1]);
});

test('workers: ask holds the worker until the answer, which wakes it with its conversation', async () => {
  const prompts: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'deploy it') await call('dispatch', { task: 'deploy', name: 'deploy' });
    if (input.role === 'head' && lastUserMessage(input) === 'staging') await call('steer', { worker: 'worker-3', text: 'staging' });
    if (input.role === 'task') {
      prompts.push(input.prompt);
      if (prompts.length === 1) { await call('ask', { question: 'Staging or production?' }); return; }
      else { await call('say', { text: 'deployed to staging' }); await call('finish_task', { result: 'staging' }); }
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'deploy it' });
  await until(() => h.said().includes('Staging or production?'));
  await sleep(30);
  const asking = h.entity.snapshot().limbs.find(l => l.id === 'worker-3')!;
  expect(asking).toMatchObject({ status: 'running', runs: [] }); // not finished: it waits for the answer
  expect(asking.asking).toBe(h.of('chat_message').find(e => e.data.text === 'Staging or production?')!.seq);
  h.entity.input('chat_message', { text: 'staging' });
  await until(() => h.of('task_done').length === 1);
  expect(prompts[1]).toContain('Message from the user (via head): staging');
  expect(h.entity.snapshot().limbs.find(l => l.id === 'worker-3')).toMatchObject({ status: 'done', asking: undefined });
});

test('workers: renames, fork and wait links, and usage are runtime facts every view shares', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'go') {
      await call('dispatch', { task: 'first', name: 'first' });
      await call('fork', { worker: 'worker-3', task: 'second' });
      await call('dispatch', { task: 'third', after: 'worker-3' });
    }
    if (input.role === 'task' && input.limbId === 'worker-3') await new Promise<void>(r => input.signal.addEventListener('abort', () => r()));
  });
  const run = h.mind.run.bind(h.mind);
  h.mind.run = async input => ({ ...(await run(input)), usage: { input: 100, output: 10, cost: 0.01 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('limb_spawned').length === 3);
  const [, fork, gated] = h.of('limb_spawned').map(e => String(e.data.id));
  expect(h.entity.renameWorker('worker-3', '  Login  fix ')).toContain('"Login fix"');
  const limbs = h.entity.snapshot().limbs;
  expect(limbs.find(l => l.id === 'worker-3')!.name).toBe('Login fix');
  expect(limbs.find(l => l.id === fork)!.forkOf).toBe('worker-3');
  expect(limbs.find(l => l.id === gated)).toMatchObject({ after: 'worker-3', waitFor: 'worker-3' });
  await until(() => (h.entity.snapshot().usage.cost ?? 0) > 0);
  expect(h.entity.snapshot().limbs.find(l => l.id === 'head')!.usage!.input).toBeGreaterThan(0);
  h.entity.stopWorker('worker-3');
  await until(() => h.of('limb_started').length === 1);
  expect(h.entity.snapshot().limbs.find(l => l.id === gated)).toMatchObject({ after: 'worker-3', waitFor: undefined }); // the link outlives the wait
});

test('usage: tokens by kind and cost per limb, unpriced calls counted, summaries and senses in the totals', async () => {
  let calls = 0;
  const summarizer = { async summarize() { return { done: ['a'], doing: [], next: [], usage: { input: 50, output: 5, cost: 0.001 } }; } };
  const evaluator = { async evaluate(questions: { id: string }[]) { return { answers: Object.fromEntries(questions.map(q => [q.id, 0.2])), usage: { input: 30, output: 1, cost: null } }; } };
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'go') await call('dispatch', { task: 'work' });
    if (input.role === 'task') { for (let i = 0; i < 4; i++) await call('note', { text: `step ${i}` }); await call('finish_task', { result: 'ok' }); }
  }, { summarizer, evaluator, jev: { senseIntervalMs: 5 }, config: { summaryEveryCalls: 2, summaryIntervalMs: 0 } });
  const run = h.mind.run.bind(h.mind);
  // The first head run has no known price; later runs report cache reads and writes.
  h.mind.run = async input => ({ ...(await run(input)), usage: calls++ === 0 ? { input: 10, output: 1, cost: null } : { input: 100, output: 10, cacheRead: 400, cacheWrite: 20, cost: 0.01 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  h.entity.input('draft_changed', { text: 'hm' });
  await until(() => h.of('task_done').length === 1 && h.of('usage').some(e => e.data.kind === 'summaries') && h.of('usage').some(e => e.data.kind === 'senses'));
  await sleep(20);
  const { usage, usageBy } = h.entity.snapshot();
  expect(usage.unpriced).toBeGreaterThanOrEqual(2); // the first head run and the senses call
  expect(usage.cacheRead).toBeGreaterThan(0);
  expect(usage.cacheWrite).toBeGreaterThan(0);
  const summaries = h.of('usage').filter(e => e.data.kind === 'summaries').length;
  expect(usageBy.summaries).toMatchObject({ input: 50 * summaries, output: 5 * summaries, unpriced: 0 });
  expect(usageBy.summaries.cost).toBeCloseTo(0.001 * summaries);
  expect(usageBy.senses.unpriced).toBeGreaterThan(0);
  const worker = h.entity.snapshot().limbs.find(l => l.role === 'task')!;
  expect(worker.usage).toMatchObject({ cacheRead: 400, cacheWrite: 20, cost: 0.01 });
});

test('batches: more items join an existing batch, with one progress line, even after it ended', async () => {
  let release!: () => void;
  const hold = new Promise<void>(r => { release = r; });
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'head' && message === 'five reviews') await call('dispatch_many', { title: 'Reviews', items: Array.from({ length: 5 }, (_, i) => ({ task: `review ${i}` })) });
    if (input.role === 'head' && message === 'make it 6' && input.prompt.includes('"woken_because":"user message"')) {
      const lines = (stableState(input).workers as string[]);
      const batch = /batch (group-\d+)/.exec(lines[0])![1];
      await call('dispatch_many', { batch, items: [{ task: 'review 5' }], reply_to: h.of('chat_message').find(e => e.data.text === 'make it 6')!.seq });
    }
    if (input.role === 'task') { if (ownTask(input) === 'review 5') await hold; await call('finish_task', { result: 'ok' }); }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'five reviews' });
  await until(() => h.of('group_finished').length === 1);
  h.entity.input('chat_message', { text: 'make it 6' });
  await until(() => h.of('group_extended').length === 1);
  const lines = () => h.of('chat_message').filter(e => e.data.group);
  expect(lines()).toHaveLength(1); // still one progress line
  const progress = lines()[0].seq;
  expect(h.of('chat_message_updated').filter(e => e.data.seq === progress).at(-1)!.data.text).toBe('Reviews: 5 of 6 done, 1 running.');
  release();
  await until(() => h.of('group_finished').length === 2); // it ended again, and the front limb heard about it again
  expect(h.of('chat_message_updated').at(-1)!.data.text).toBe('Reviews: 6 of 6 done.');
  expect(h.of('group_started')).toHaveLength(1);
});

test('review: the reviewer is told when each answer was said, and can withdraw its own wrong correction', async () => {
  const reasons: string[] = [];
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.limbId === 'head' && input.prompt.includes('"woken_because":"user message"')) {
      if (message === 'status?') await call('say', { text: 'Five reviews are done; the sixth is running.' });
      if (message === 'what?') await call('say', { text: 'I meant the count.' });
    }
    if (input.limbId === 'reviewer') {
      reasons.push(JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\nTIME\n') + 6)).woken_because);
      const status = h.of('chat_message').find(e => e.data.text === 'Five reviews are done; the sixth is running.')!;
      const mine = h.of('chat_message').find(e => e.by === 'reviewer' && e.data.corrects === status.seq);
      if (!mine) await call('amend', { seq: status.seq, verdict: 'correct', text: 'Four reviews are done.' });
      else expect(await call('amend', { seq: mine.seq, verdict: 'withdraw', text: 'five were done then' })).toContain('restored');
    }
  }, { config: { review: 'separate', reviewQuietMs: 20 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'status?' });
  await until(() => h.of('message_reviewed').some(e => e.data.verdict === 'corrected'));
  expect(reasons[0]).toMatch(/^review #\d+ \(said \d+\.\ds ago\)$/);
  h.entity.input('chat_message', { text: 'what?' });
  await until(() => h.of('message_reviewed').some(e => e.data.verdict === 'withdrawn'));
  const status = h.of('chat_message').find(e => e.data.text === 'Five reviews are done; the sixth is running.')!;
  expect(h.of('message_reviewed').filter(e => e.data.seq === status.seq).at(-1)!.data).toMatchObject({ verdict: 'confirmed', restored: true });
  const chat = h.entity.snapshot().world.chat as { messages: { seq: number; correctedBy?: number; withdrawn?: boolean; by: string }[] };
  expect(chat.messages.find(m => m.seq === status.seq)!.correctedBy).toBeUndefined();
  expect(chat.messages.find(m => m.by === 'reviewer')!.withdrawn).toBe(true);
});
