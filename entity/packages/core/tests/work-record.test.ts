import { afterEach, expect, test } from 'bun:test';
import type { AskTracker } from '../src/index.js';
import { lastUserMessage, makeEntity, ownTask, sleep, until } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function setup(...args: Parameters<typeof makeEntity>) {
  const h = makeEntity(...args);
  cleanups.push(() => { h.expectReplayable(); h.entity.close(); });
  return h;
}
const blockUntilAborted = (signal: AbortSignal) => new Promise<void>(r => signal.addEventListener('abort', () => r()));

test('cause: work started for a burst of messages names them; work the entity starts by itself says what set it off and why', async () => {
  let refused = '';
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'and the menu') {
      await call('dispatch', { task: 'Audit the landing page and the menu', name: 'Landing and menu', why: 'You asked for both pages.' });
      await call('set_timer', { after_ms: 20, label: 'combine' });
    }
    if (input.role === 'head' && input.prompt.includes('timer \\"combine\\"')) {
      refused = await call('dispatch', { task: 'Combine the audits', name: 'Shortlist' });
      await call('dispatch', { task: 'Combine the audits', name: 'Shortlist', why: 'One list is easier to act on; you did not ask for it.' });
    }
    if (input.role === 'task') await blockUntilAborted(input.signal);
  }, { config: { messageDebounceMs: 30 } });
  h.entity.start();
  const first = h.entity.input('chat_message', { text: 'audit the landing page' });
  const second = h.entity.input('chat_message', { text: 'and the menu' });
  await until(() => h.of('limb_spawned').length === 2);
  const [audit, shortlist] = h.of('limb_spawned').map(e => h.entity.snapshot().limbs.find(l => l.id === e.data.id)!);
  expect(audit.cause).toEqual({ kind: 'user', seqs: [first.seq, second.seq] });
  expect(audit.why).toBe('You asked for both pages.');
  expect(shortlist.cause).toEqual({ kind: 'timer' });
  expect(refused).toContain('no user message asked for this');
  expect(shortlist.why).toContain('you did not ask for it');
  // Each run says what woke it.
  expect(h.of('run_started', b => b === 'head').map(e => e.data.kind)).toEqual(expect.arrayContaining(['session', 'user', 'timer']));
});

test('cause: a batch, a steer and a reroute record their reasons and the messages behind them', async () => {
  const h = setup(async (input, call) => {
    const said = lastUserMessage(input);
    if (input.role === 'head' && said === 'audit three areas') {
      await call('dispatch_many', { title: 'Audits', items: [{ task: 'a', name: 'A' }, { task: 'b', name: 'B' }, { task: 'c', name: 'C' }], why: 'One agent per area, as you asked.' });
    }
    if (input.role === 'head' && said === 'focus A on speed') await call('steer', { worker: 'worker-4', text: 'focus on speed', why: 'It is about A.' });
    if (input.role === 'task') await blockUntilAborted(input.signal);
  });
  h.entity.start();
  const ask = h.entity.input('chat_message', { text: 'audit three areas' });
  await until(() => h.of('limb_spawned').length === 3);
  expect(h.of('group_started')[0].data).toMatchObject({ cause: { kind: 'user', seqs: [ask.seq] }, why: 'One agent per area, as you asked.' });
  for (const l of h.entity.snapshot().limbs.filter(l => l.role === 'task')) expect(l.cause).toEqual({ kind: 'user', seqs: [ask.seq] });
  const steer = h.entity.input('chat_message', { text: 'focus A on speed' });
  await until(() => h.of('steered').length === 1);
  expect(h.of('steered')[0].data.why).toBe('It is about A.');
  expect(h.entity.reroute(steer.seq, 'separate')).toContain('started');
  const moved = h.entity.snapshot().limbs.find(l => l.role === 'task' && l.replyTo === steer.seq)!;
  expect(moved.cause).toEqual({ kind: 'user', seqs: [steer.seq] });
});

test('results: a worker finishes with its outcome and points, which views and replays share; bad points are refused', async () => {
  const replies: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'audit') await call('dispatch', { task: 'Audit the landing page', name: 'Landing page' });
    if (input.role === 'task') {
      await call('say', { text: 'The page promises things the game lacks.' });
      replies.push(await call('finish_task', { result: 'It promises missing features.', points: 'not a list' }));
      replies.push(await call('finish_task', {
        result: 'The page promises things the game does not have.',
        points: [
          { label: 'Honest promises', text: 'The copy advertises generators and patrol.', section: '1. Fix the public promise' },
          { label: '  ', text: 'dropped: no label' },
          { label: 'Share metadata', text: 'Add search and social preview tags.' },
        ],
      }));
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'audit' });
  await until(() => h.of('task_done').length === 1);
  expect(replies[0]).toStartWith('error:');
  const worker = h.entity.snapshot().limbs.find(l => l.role === 'task')!;
  expect(worker.result).toBe('The page promises things the game does not have.');
  expect(worker.points).toEqual([
    { label: 'Honest promises', text: 'The copy advertises generators and patrol.', section: '1. Fix the public promise' },
    { label: 'Share metadata', text: 'Add search and social preview tags.' },
  ]);
});

test('rounds: open-ended work reports a line per round; the head sees the latest round in its state', async () => {
  let headSaw = '';
  const h = setup(async (input, call) => {
    const said = lastUserMessage(input);
    if (input.role === 'head' && said === 'keep improving the design') await call('dispatch', { task: 'Improve the design, keep iterating', name: 'Design pass' });
    if (input.role === 'head' && said === 'how is the design going?') headSaw = input.prompt;
    if (input.role === 'task') {
      await call('report_round', { text: 'Tightened hero spacing' });
      expect(await call('report_round', { text: '  ' })).toStartWith('error:');
      await call('report_round', { text: 'Primary buttons black' });
      await blockUntilAborted(input.signal);
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'keep improving the design' });
  await until(() => h.of('work_round').length === 2);
  expect(h.entity.snapshot().limbs.find(l => l.role === 'task')).toMatchObject({ rounds: 2, lastRound: 'Primary buttons black' });
  h.entity.input('chat_message', { text: 'how is the design going?' });
  await until(() => headSaw !== '');
  expect(headSaw).toContain('round 2: Primary buttons black');
});

/** A tracker that splits on " and ", treats "?" as a question and "always" as a rule, repeats by text, and resolves what the evidence names. */
function scriptedTracker() {
  const calls: string[] = [];
  const tracker: AskTracker = {
    async split({ message, earlier }) {
      calls.push(`split:${message}`);
      const parts = message.replace(/^again: /, '').split(' and ');
      const repeats = earlier.filter(a => parts.includes(a.text)).map(a => a.id);
      const fresh = parts.filter(p => !earlier.some(a => a.text === p));
      const replaces = message.startsWith('instead ') ? earlier.filter(a => a.kind === 'rule').map(a => a.id) : [];
      return { asks: fresh.map(text => ({ kind: text.endsWith('?') ? 'question' as const : text.startsWith('always') || text.startsWith('instead') ? 'rule' as const : 'do' as const, text })), repeats, replaces, usage: { input: 10, output: 5, cost: 0.001 } };
    },
    async resolve({ asks, evidence }) {
      calls.push(`resolve:${asks.map(a => a.text).join('|')}`);
      return { resolved: asks.filter(a => evidence.toLowerCase().includes(a.text.replace('?', '').split(' ').pop()!.toLowerCase())).map(a => ({ id: a.id, note: 'from the result' })) };
    },
  };
  return { tracker, calls };
}

test('asks: messages are split into asks; finished work and replies resolve them; asking again reopens; rules reach every limb', async () => {
  const { tracker, calls } = scriptedTracker();
  let workerSaw = '';
  let worker = '';
  const h = setup(async (input, call) => {
    const said = lastUserMessage(input);
    if (input.role === 'head' && said === 'make the buttons black and fix the footer') worker = (await call('dispatch', { task: said, name: 'Styling' })).split(' ')[1];
    if (input.role === 'head' && said === 'what is the stack?') await call('say', { text: 'TypeScript and Bun on the stack.' });
    if (input.role === 'head' && said === 'again: make the buttons black') await call('steer', { worker, text: 'the buttons are still not black' });
    if (input.role === 'task') {
      workerSaw = input.prompt;
      await call('say', { text: 'Buttons are now black.' });
      await call('finish_task', { result: 'Made the buttons black.' });
    }
  }, { asks: tracker });
  h.entity.start();
  h.entity.input('chat_message', { text: 'always keep the old API' });
  await until(() => h.of('ask_recorded').length === 1);
  h.entity.input('chat_message', { text: 'make the buttons black and fix the footer' });
  await until(() => h.of('ask_resolved').length === 1);
  const asks = () => h.entity.snapshot().asks;
  expect(asks().map(a => [a.kind, a.text, a.status])).toEqual([
    ['rule', 'always keep the old API', 'open'],
    ['do', 'make the buttons black', 'resolved'],
    ['do', 'fix the footer', 'open'],
  ]);
  expect(asks()[1]).toMatchObject({ workers: [worker], resolved: { by: worker, note: 'from the result' } });
  expect(asks()[2].workers).toEqual([worker]); // taken, not resolved: the result does not mention the footer
  expect(workerSaw).toContain('"rules":["always keep the old API"]');

  // Asking again after it was resolved opens it again, keeping when and by whom it was resolved.
  h.entity.input('chat_message', { text: 'again: make the buttons black' });
  await until(() => h.of('ask_repeated').length === 1);
  expect(asks()[1]).toMatchObject({ status: 'open', resolved: { by: worker } });
  expect(asks()[1].seqs).toHaveLength(2);

  // A reply resolves a question from the message it answers.
  h.entity.input('chat_message', { text: 'what is the stack?' });
  await until(() => asks().some(a => a.kind === 'question' && a.status === 'resolved'));
  expect(asks().find(a => a.kind === 'question')!.resolved!.by).toBe('head');

  // A new rule can replace an old one.
  h.entity.input('chat_message', { text: 'instead use the new API' });
  await until(() => h.of('ask_replaced').length === 1);
  expect(asks()[0]).toMatchObject({ status: 'replaced' });
  expect(h.entity.snapshot().usageBy.asks.cost).toBeGreaterThan(0);
  expect(calls.filter(c => c.startsWith('split:'))).toHaveLength(5);
});

test('asks: without a tracker there are none, and a reset drops what was still queued', async () => {
  let release: () => void = () => {};
  const slow: AskTracker = {
    split: () => new Promise(r => { release = () => r({ asks: [{ kind: 'do', text: 'late' }] }); }),
    resolve: async () => ({ resolved: [] }),
  };
  const h = setup(async () => {}, { asks: slow });
  h.entity.start();
  h.entity.input('chat_message', { text: 'do something' });
  await sleep(20);
  h.entity.reset();
  release();
  await sleep(20);
  expect(h.entity.snapshot().asks).toEqual([]);
  const none = setup(async () => {});
  none.entity.start();
  none.entity.input('chat_message', { text: 'do something' });
  await sleep(20);
  expect(none.entity.snapshot().asks).toEqual([]);
});

test('asks: one that went to several workers is judged only once all are done, on all their results; the head\'s combined reply can resolve it', async () => {
  const judged: string[] = [];
  const tracker: AskTracker = {
    split: async ({ message }) => ({ asks: message === 'audit both areas and give one list' ? [{ kind: 'do', text: 'One combined list' }] : [] }),
    async resolve({ asks, evidence, by }) {
      judged.push(`${by}: ${evidence.replace(/\n/g, ' / ')}`);
      return { resolved: evidence.includes('Combined:') ? asks.map(a => ({ id: a.id })) : [] };
    },
  };
  let release: () => void = () => {};
  const slow = new Promise<void>(r => { release = r; });
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'audit both areas and give one list') {
      await call('dispatch_many', { title: 'Audit', items: [{ task: 'area A', name: 'A' }, { task: 'area B', name: 'B' }] });
    }
    if (input.role === 'head' && input.prompt.includes('finished.')) await call('say', { text: 'Combined: A1, B1.' });
    if (input.role === 'task' && ownTask(input) === 'area A') await call('finish_task', { result: 'A1' });
    if (input.role === 'task' && ownTask(input) === 'area B') { await slow; await call('finish_task', { result: 'B1' }); }
  }, { asks: tracker });
  h.entity.start();
  h.entity.input('chat_message', { text: 'audit both areas and give one list' });
  await until(() => h.of('task_done').length === 1);
  await sleep(30);
  expect(judged).toEqual([]); // A alone does not get its own verdict on the shared ask
  release();
  await until(() => h.of('ask_resolved').length === 1);
  expect(judged[0]).toContain('A: A1');
  expect(judged[0]).toContain('B: B1');
  expect(h.of('ask_resolved')[0].data.by).toBe('head');
});

test('results: a result past one line is refused twice with a pointer to points, then cut', async () => {
  const replies: string[] = [];
  const long = `Found ${'many things '.repeat(30)}`;
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'go') await call('dispatch', { task: 'audit', name: 'Audit' });
    if (input.role === 'task') for (let i = 0; i < 3 && !replies.includes('task finished'); i++) replies.push(await call('finish_task', { result: long }));
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('task_done').length === 1);
  expect(replies[0]).toContain('put the findings or parts in points');
  expect(replies[2]).toBe('task finished');
  expect(String(h.of('task_done')[0].data.result).length).toBeLessThanOrEqual(200);
});

test('cause: a message a run read but did not act on (the user kept typing) is still the cause of what the next run starts', async () => {
  const h = setup(async (input, call) => {
    // The first run sees the request but the user sends another message before it acts: it is superseded.
    if (input.role === 'head' && lastUserMessage(input) === 'add an agent for the examples') { await sleep(40); await call('say', { text: 'On it.' }); }
    if (input.role === 'head' && lastUserMessage(input) === 'and keep answers short') await call('dispatch', { task: 'Audit the examples', name: 'Examples' });
    if (input.role === 'task') await blockUntilAborted(input.signal);
  });
  h.entity.start();
  const first = h.entity.input('chat_message', { text: 'add an agent for the examples' });
  await until(() => h.of('run_started', b => b === 'head').length === 2);
  const second = h.entity.input('chat_message', { text: 'and keep answers short' });
  await until(() => h.of('limb_spawned').length === 1);
  expect(h.entity.snapshot().limbs.find(l => l.role === 'task')!.cause).toEqual({ kind: 'user', seqs: [first.seq, second.seq] });
});

test('asks: work started by a run that read two messages is linked only to the asks it serves; the dropped one stays untaken', async () => {
  const linked: string[] = [];
  const tracker: AskTracker = {
    split: async ({ message }) => ({ asks: [{ kind: 'do', text: message }] }),
    resolve: async () => ({ resolved: [] }),
    async link({ asks, task }) { linked.push(task); return { ids: asks.filter(a => task.includes(a.text)).map(a => a.id) }; },
  };
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'audit the docs') await call('dispatch', { task: 'audit the docs', name: 'Audit' });
    if (input.role === 'task') await blockUntilAborted(input.signal);
  }, { asks: tracker, config: { messageDebounceMs: 30 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'polish the readme' });
  h.entity.input('chat_message', { text: 'audit the docs' });
  await until(() => h.of('ask_linked').length === 1);
  await sleep(20);
  const asks = h.entity.snapshot().asks;
  expect(asks.find(a => a.text === 'audit the docs')!.workers).toHaveLength(1);
  expect(asks.find(a => a.text === 'polish the readme')!.workers).toEqual([]);
  expect(linked).toEqual(['audit the docs']);
});

test('rounds: a worker that sets a timer for its next round and ends its run waits for it instead of finishing', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'polish in rounds') await call('dispatch', { task: 'polish in rounds', name: 'Polish' });
    if (input.role === 'task') {
      await call('report_round', { text: `round ${h.of('work_round').length + 1}` });
      if (h.of('work_round').length < 2) await call('set_timer', { after_ms: 30, label: 'next round' });
      else await call('finish_task', { result: 'Two rounds done.', points: [] });
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'polish in rounds' });
  await until(() => h.of('work_round').length === 1 && h.of('run_finished', b => b.startsWith('worker')).length === 1);
  expect(h.entity.snapshot().limbs.find(l => l.role === 'task')!.status).toBe('running');
  await until(() => h.of('task_done').length === 1);
  expect(h.entity.snapshot().limbs.find(l => l.role === 'task')).toMatchObject({ status: 'done', rounds: 2, result: 'Two rounds done.' });
});

test('asks: a clicked answer to the entity\'s question is not an ask, and the work it starts is linked to the message the question was about', async () => {
  const tracker: AskTracker = { split: async ({ message }) => ({ asks: [{ kind: 'do', text: message }] }), resolve: async () => ({ resolved: [] }) };
  let question = 0;
  const h = setup(async (input, call) => {
    const said = lastUserMessage(input);
    if (input.role === 'head' && said === 'also review the shaders') {
      await call('say', { text: 'Join the graphics review or run separately?', options: [{ label: 'Add it to graphics' }, { label: 'Start a separate shader review', recommended: true }] });
      question = h.of('chat_message', b => b === 'head').at(-1)!.seq;
    }
    if (input.role === 'head' && said === 'Start a separate shader review') await call('dispatch', { task: 'Review the shaders', name: 'Shaders' });
    if (input.role === 'task') await blockUntilAborted(input.signal);
  }, { asks: tracker });
  h.entity.start();
  const original = h.entity.input('chat_message', { text: 'also review the shaders' });
  await until(() => question > 0);
  h.entity.input('chat_message', { text: 'Start a separate shader review', reply_to: question });
  await until(() => h.of('ask_linked').length === 1);
  await sleep(20);
  const asks = h.entity.snapshot().asks;
  expect(asks.map(a => a.text)).toEqual(['also review the shaders']);
  expect(asks[0].workers).toHaveLength(1);
  expect(h.entity.snapshot().limbs.find(l => l.role === 'task')!.cause!.seqs).toContain(original.seq);
});

test('after: work that combines a batch waits for every worker in it, ones added later too, and starts with all their results', async () => {
  let combineSaw = '';
  const finish: Record<string, () => void> = {};
  const h = setup(async (input, call) => {
    const said = lastUserMessage(input);
    if (input.role === 'head' && said === 'audit two areas, then one list') {
      await call('dispatch_many', { title: 'Audit', items: [{ task: 'area A', name: 'A' }, { task: 'area B', name: 'B' }] });
      const batch = String(h.of('group_started')[0].data.id);
      expect(await call('dispatch', { task: 'combine', name: 'Combined list', after: batch })).toContain(`every worker of ${batch}`);
      expect(await call('dispatch', { task: 'nope', after: ['worker-404'] })).toContain('no worker or batch');
    }
    if (input.role === 'head' && said === 'add area C') await call('dispatch_many', { batch: String(h.of('group_started')[0].data.id), items: [{ task: 'area C', name: 'C' }] });
    if (input.role === 'task' && ownTask(input) === 'combine') { combineSaw = input.prompt; await call('finish_task', { result: 'One list.', points: [] }); return; }
    if (input.role === 'task') { await new Promise<void>(r => { finish[ownTask(input)] = r; }); await call('finish_task', { result: `${ownTask(input)} done`, points: [] }); }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'audit two areas, then one list' });
  await until(() => !!finish['area A'] && !!finish['area B']);
  const combine = () => h.entity.snapshot().limbs.find(l => l.task === 'combine')!;
  expect(combine()).toMatchObject({ status: 'waiting', afterGroup: String(h.of('group_started')[0].data.id) });
  h.entity.input('chat_message', { text: 'add area C' });
  await until(() => !!finish['area C']);
  finish['area A'](); finish['area B']();
  await until(() => h.of('task_done').length === 2);
  await sleep(20);
  expect(combine().status).toBe('waiting'); // C, added to the batch later, is still running
  finish['area C']();
  await until(() => combine().status === 'done');
  for (const area of ['area A done', 'area B done', 'area C done']) expect(combineSaw).toContain(area);
});
