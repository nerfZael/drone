import { afterEach, expect, test } from 'bun:test';
import { chatChannel, type Channel, type Evaluator } from '../src/index.js';
import { lastUserMessage, makeEntity, sleep, until } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function setup(...args: Parameters<typeof makeEntity>) {
  const h = makeEntity(...args);
  cleanups.push(() => { h.expectReplayable(); h.entity.close(); });
  return h;
}

test('the newest voice run owns the voice: an older run gets "superseded"', async () => {
  const results: Record<string, string> = {};
  let release!: () => void;
  const slow = new Promise<void>(r => { release = r; });
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (message === 'first') { await slow; results.first = await call('say', { text: 'answer to first' }); }
    if (message === 'second') results.second = await call('say', { text: 'answer to second' });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'first' });
  await until(() => h.mind.runs.some(r => lastUserMessage(r) === 'first'));
  h.entity.input('chat_message', { text: 'second' });
  await until(() => results.second !== undefined);
  release();
  await until(() => results.first !== undefined);
  expect(results.second).toBe('sent');
  expect(results.first).toStartWith('superseded');
  expect(h.said()).toEqual(['answer to second']);
});

test('invalid watches and effects are rejected with an error the model can act on', async () => {
  const results: string[] = [];
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    results.push(await call('set_watch', { watch: { name: 'bad', on: { event: 'key_down' }, do: { hold: true } } }));
    results.push(await call('set_watch', { watch: { name: 'bad effect', on: { event: 'key_down' }, do: { effect: 'teleport' } } }));
    results.push(await call('press', { key: '5' }));
    results.push(await call('run_program', { name: 'broken', code: 'this is not javascript(' }));
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => results.length === 4);
  expect(results[0]).toStartWith('error: invalid watch');
  expect(results[1]).toContain('unknown effect "teleport"');
  expect(results[2]).toContain('press.keys is required');
  expect(results[3]).toContain('SyntaxError');
  expect(h.of('watch_installed')).toHaveLength(0);
});

test('effects are rejected only when something they depend on changed', async () => {
  const board: Channel<{ moves: string[] }> = {
    name: 'board', describe: 'test board', inputs: ['board_changed'],
    init: () => ({ moves: [] }),
    reduce() {},
    render: () => ({}),
    effects: [{
      name: 'move', description: 'move', risk: 'limb',
      parameters: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] },
      dependsOn: () => [{ type: 'board_changed' }],
      apply(args: { to: string }, ctx) { ctx.world.moves.push(args.to); return 'moved'; },
    }],
  };
  const results: string[] = [];
  let step = 0;
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'play') return;
    if (step++ === 0) {
      h.entity.input('key_down', { key: '1' }); // unrelated: not a conflict
      results.push(await call('move', { to: 'a1' }));
      h.entity.input('board_changed', {}); // related: stale
      results.push(await call('move', { to: 'b2' }));
    }
  }, { channels: [chatChannel(), board, (await import('../src/index.js')).keypadChannel()] });
  h.entity.start();
  h.entity.input('chat_message', { text: 'play' });
  await until(() => results.length === 2);
  expect(results[0]).toBe('moved');
  expect(results[1]).toStartWith('stale');
});

test('output stops are scoped: "work" leaves the voice free, "subtree" blocks it, resume lifts it', async () => {
  const results: string[] = [];
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    await call('run_program', { name: 'loop', code: 'for (;;) { await wait(5); }' });
    await call('stop_output', { reason: 'test' });
    results.push(await call('say', { text: 'still talking' }));
    await call('stop_output', { reason: 'quiet', scope: 'subtree' });
    results.push(await call('say', { text: 'blocked' }));
    await call('resume_output');
    results.push(await call('say', { text: 'back' }));
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => results.length === 3);
  expect(results).toEqual(['sent', 'output stopped: quiet. Nothing was done.', 'sent']);
  expect(h.of('program_cancelled')).toHaveLength(1);
});

test('workers: dispatched by the head, reply to the user themselves, do not wake the head when done, and keep their session', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'think hard') await call('dispatch', { task: 'plan something', name: 'planner' });
    if (input.role === 'task') {
      expect(input.sessionKey).toBe(input.limbId);
      expect(input.tools.some(t => t.name === 'spawn' || t.name === 'report')).toBe(false);
      expect(await call('say', { text: 'the plan' })).toBe('sent');
      await call('finish_task', { result: 'planned' });
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'think hard' });
  await until(() => h.of('task_done').length === 1);
  expect(h.said()).toEqual(['the plan']);
  expect(h.of('task_done')[0].data).toMatchObject({ status: 'done', result: 'planned' });
  await sleep(30);
  expect(h.mind.runs.filter(r => r.role === 'head')).toHaveLength(2); // session start and the message, not the finish
  expect(h.mind.forgotten).toEqual([]);
});

test('cancel asks a task to wrap up, then kills it after the grace period', async () => {
  let taskResult = '';
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'start') await call('dispatch', { task: 'long work' });
    if (input.role === 'head' && lastUserMessage(input) === 'stop') taskResult = await call('cancel', { id: 'worker-3' });
    if (input.role === 'task') { while (!input.signal.aborted) await sleep(5); }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'start' });
  await until(() => h.of('limb_spawned').length === 1);
  h.entity.input('chat_message', { text: 'stop' });
  await until(() => h.of('task_done').length === 1);
  expect(taskResult).toContain('cancel requested');
  expect(h.of('task_done')[0].data.status).toBe('killed');
});

test('cancel lets a worker say where it got to and finish; it ends as cancelled', async () => {
  const results: string[] = [];
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'start') await call('dispatch', { task: 'long work' });
    if (input.role === 'head' && lastUserMessage(input) === 'stop') await call('cancel', { id: 'worker-3' });
    if (input.role === 'task') {
      let result = '';
      while (!result.startsWith('cancel requested')) { result = await call('press', { keys: '1' }); await sleep(5); }
      results.push(result, await call('say', { text: 'stopped after step 3' }), await call('finish_task', { result: 'partial' }));
    }
  }, { config: { cancelGraceMs: 2000 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'start' });
  await until(() => h.of('limb_spawned').length === 1);
  h.entity.input('chat_message', { text: 'stop' });
  await until(() => h.of('task_done').length === 1);
  expect(results.slice(1)).toEqual(['sent', 'task finished']);
  expect(h.of('task_done')[0].data).toMatchObject({ status: 'cancelled', result: 'partial' });
});

test('the heartbeat wakes the head only while workers are active, not for its own standing watches', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'mirror' && input.prompt.includes('"woken_because":"user message"')) {
      await call('set_watch', { watch: { name: 'mirror', on: { event: 'key_down' }, do: { effect: 'press', args: { keys: '$key' } } } });
    }
  }, { config: { headHeartbeatMs: 20 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'mirror' });
  await until(() => h.of('watch_installed').length === 1);
  await sleep(100);
  expect(h.of('run_started').filter(e => e.data.reason === 'heartbeat')).toHaveLength(0);
});

test('a crashing task limb is restarted up to the cap, then fails upward', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'go') await call('dispatch', { task: 'crash' });
    if (input.role === 'task') throw new Error('model outage');
  }, { config: { restartMax: 2 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('task_done').length === 1);
  expect(h.of('limb_failed')).toHaveLength(3);
  expect(h.of('task_done')[0].data.status).toBe('failed');
});

test('pause freezes programs and blocks effects; resume continues and tells the head how long it was paused', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'count') await call('run_program', { name: 'count', code: 'for (let i = 1; i <= 5; i++) { await say(String(i)); await wait(20); }' });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'count' });
  await until(() => h.said().length >= 2);
  h.entity.pause();
  const atPause = h.said().length;
  await sleep(80);
  expect(h.said().length).toBe(atPause);
  h.entity.resume();
  await until(() => h.said().length === 5);
  expect(h.of('session_resumed')[0].data.paused_for_ms).toBeGreaterThanOrEqual(70);
  expect(h.mind.runs.at(-1)!.prompt).toContain('resumed after');
});

test('watches that fire too often are rate limited; programs are throttled instead', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    await call('set_watch', { watch: { name: 'echo', on: { event: 'key_down' }, do: { effect: 'press', args: { keys: '$key' } } } });
  }, { config: { reflexPerSecond: 3 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('watch_installed').length === 1);
  for (let i = 0; i < 6; i++) h.entity.input('key_down', { key: '1' });
  await sleep(10);
  expect(h.entityKeys('key_down')).toHaveLength(3);
  expect(h.entity.snapshot().health.some(x => x.message.includes('rate limited'))).toBe(true);
});

test('level watches fire after a duration: typing for a while wakes the head', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'watch me') await call('set_watch', { watch: { name: 'long typing', on: { level: 'user.typing', for_ms: 40 }, do: { wake: { reason: 'typing a long time' } } } });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'watch me' });
  await until(() => h.of('watch_installed').length === 1);
  h.entity.input('draft_changed', { text: 'h' });
  await sleep(20);
  expect(h.of('watch_woke')).toHaveLength(0);
  await until(() => h.of('watch_woke').length === 1);
  expect(h.mind.runs.at(-1)!.prompt).toContain('typing a long time');
});

test('judge and sense: batched into one evaluator call, sensed levels feed watches, answers are logged', async () => {
  const calls: string[][] = [];
  const evaluator: Evaluator = {
    async evaluate(questions, state) {
      calls.push(questions.map(q => q.question));
      const changed = state.includes('pizza');
      return Object.fromEntries(questions.map(q => [q.id, q.question.includes('subject') ? (changed ? 0.9 : 0.1) : 0.7]));
    },
  };
  const results: string[] = [];
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'stop if I change the subject') {
      results.push(await call('set_watch', { watch: { name: 'subject', on: { sense: 'did the user change the subject?', above: 0.75 }, do: { stop_output: { reason: 'subject changed', scope: 'subtree' } } } }));
      results.push(await call('run_program', { name: 'judges', code: 'const [a, b] = await Promise.all([judge("is it sunny?"), judge("is it late?")]); console.log(a, b);' }));
    }
  }, { evaluator, jev: { senseIntervalMs: 5 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'stop if I change the subject' });
  await until(() => h.of('judged').length === 2);
  expect(calls.some(c => c.length === 2 && c.includes('is it sunny?') && c.includes('is it late?'))).toBe(true);
  h.entity.input('chat_message', { text: 'anyway, I love pizza' });
  await until(() => h.of('output_stopped').length === 1);
  expect(results[0]).toContain('sense level sense.did_the_user_change_the_subject');
  expect(h.of('sensed').length).toBeGreaterThan(0);
});

test('reset archives the old log and starts clean', async () => {
  const h = setup(async () => {});
  h.entity.start();
  h.entity.input('chat_message', { text: 'hi' });
  const archived = h.entity.reset();
  expect(archived.some(e => e.type === 'chat_message')).toBe(true);
  expect(h.entity.log.length).toBe(0);
  expect(h.entity.status).toBe('idle');
});

test('programs read events in order and never miss one between nextEvent calls', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    await call('run_program', { name: 'reader', code: `
      const down = await nextEvent({ type: 'key_down', by: 'user' }, 1000);
      await wait(40); // the key_up happens while we are not waiting
      const up = await nextEvent({ type: 'key_up', by: 'user' }, 1000);
      console.log(down.data.key, up.data.key, up.t - down.t >= 0);` });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('program_started').length === 1);
  h.entity.input('key_down', { key: '1' });
  await sleep(10);
  h.entity.input('key_up', { key: '1' });
  await until(() => h.of('program_log').length === 1);
  expect(h.of('program_log')[0].data.message).toBe('1 1 true');
});

test('keypad events carry held_ms and gap_ms, so programs need no timing arithmetic', async () => {
  const h = setup(async () => {});
  h.entity.start();
  h.entity.input('key_down', { key: '1' });
  await sleep(30);
  h.entity.input('key_up', { key: '1' });
  await sleep(20);
  h.entity.input('key_down', { key: '1' });
  const [up] = h.of('key_up');
  const downs = h.of('key_down');
  expect(Number(up.data.held_ms)).toBeGreaterThanOrEqual(25);
  expect(downs[0].data.gap_ms).toBeUndefined();
  expect(Number(downs[1].data.gap_ms)).toBeGreaterThanOrEqual(15);
});

test('an older head run can no longer act once a newer run exists, except to leave a note', async () => {
  const results: string[] = [];
  let release!: () => void;
  const slow = new Promise<void>(r => { release = r; });
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'first') {
      await slow;
      results.push(await call('press', { keys: '1' }), await call('note', { text: 'was about to press 1' }));
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'first' });
  await until(() => h.mind.runs.some(r => lastUserMessage(r) === 'first'));
  h.entity.input('chat_message', { text: 'second' });
  await until(() => h.mind.runs.some(r => lastUserMessage(r) === 'second'));
  release();
  await until(() => results.length === 2);
  expect(results[0]).toStartWith('superseded');
  expect(results[1]).toBe('noted');
});

test('a stop halts the work in flight; a program the head starts afterwards runs, one a watch starts afterwards does not', async () => {
  const results: string[] = [];
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    await call('run_program', { name: 'old', code: 'while (true) { await press("1"); await wait(10); }' });
    await call('set_watch', { watch: { name: 'relauncher', on: { event: 'key_down', key: '7' }, do: { run_program: { name: 'from watch', code: 'await press("7")' } } } });
    results.push(await call('stop_output', { reason: 'replacing the program' }));
    results.push(await call('run_program', { name: 'new', code: 'await press("2")' }));
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => results.length === 2);
  await until(() => h.entityKeys('key_down').some(e => e.data.key === '2'));
  h.entity.input('key_down', { key: '7' });
  await sleep(50);
  expect(h.of('program_cancelled').map(e => e.data.name)).toEqual(['old']);
  expect(h.entityKeys('key_down').some(e => e.data.key === '7')).toBe(false);
});

test('program events are strict: a wrong field fails the program at once, naming the real fields', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'go') await call('run_program', { name: 'guess', code: 'const e = await nextEvent({ type: "key_down" }, 5000); if (e.event.data.key === "1") await say("one");' });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('program_started').length === 1);
  h.entity.input('key_down', { key: '1' });
  await until(() => h.of('program_failed').length === 1);
  expect(String(h.of('program_failed')[0].data.reason)).toContain('event has no field "event"; it has seq, t, at, type, by, data');
  expect(h.said()).toEqual([]);
});

test('optional fields in event.data stay loose, and a program can wake its author at most once a second', async () => {
  const reasons: string[] = [];
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'go' && input.prompt.includes('"woken_because":"user message"')) {
      await call('run_program', { name: 'decoder', code: 'const e = await nextEvent({ type: "key_down" }, 5000); const gap = e.data.gap_ms ?? 0; log(wake("user pressed " + e.data.key + " after " + gap)); log(wake("again"));' });
    }
    const time = input.prompt.slice(input.prompt.lastIndexOf('\nTIME\n') + 6);
    const reason = String(JSON.parse(time).woken_because);
    if (reason.startsWith('program')) reasons.push(reason);
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('program_started').length === 1);
  h.entity.input('key_down', { key: '7' });
  await until(() => h.of('program_finished').length === 1 && reasons.some(r => r.includes('user pressed')));
  expect(h.of('program_log').map(e => e.data.message)).toEqual(['woken', 'rate limited: at most one wake per second']);
  expect(h.of('program_woke')).toHaveLength(1);
  expect(reasons[0]).toContain('user pressed 7 after 0');
});

test('freeze pauses a task limb and a program at their next action, and resume continues them with nothing lost', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'go') {
      // Dispatch first: the freeze wakes the head, and a newer run supersedes this one.
      await call('dispatch', { task: 'press 4 then 5' });
      await call('set_watch', { watch: { name: 'freeze on 9', on: { level: 'key.9.held' }, do: { stop_output: { reason: 'user holds 9', mode: 'freeze' } } } });
      await call('set_watch', { watch: { name: 'resume on release', on: { event: 'key_up', key: '9' }, do: { resume_output: {} } } });
      await call('run_program', { name: 'steps', code: 'for (const k of ["1","2","3"]) { await press(k); await wait(30); }' });
    }
    if (input.role === 'task') {
      await call('press', { keys: '4' });
      await sleep(60);
      await call('press', { keys: '5' });
      await call('press', { keys: '9' }); // the task pressing 9 must not freeze anything: levels default to the user's
      await call('finish_task', { result: 'done' });
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.entityKeys('key_down').length >= 1);
  h.entity.input('key_down', { key: '9' });
  await sleep(15);
  const frozenAt = h.entity.log.length;
  await sleep(120);
  expect(h.entityKeys('key_down', frozenAt)).toHaveLength(0);
  h.entity.input('key_up', { key: '9' });
  await until(() => h.of('task_done').length === 1 && h.of('program_finished').length === 1);
  expect(h.entityKeys('key_down').map(e => e.data.key).sort().join('')).toBe('123459');
  expect(h.of('output_stopped')).toHaveLength(1);
});

test('watch conditions combine: fire on a key only while the user has stopped typing and is not holding 0', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) !== 'go') return;
    await call('set_watch', { watch: {
      name: 'press when idle', on: { event: 'key_down', key: '1' }, do: { effect: 'press', args: { keys: '2' } },
      when: { all: [{ quiet: 'draft_changed', for_ms: 50 }, { not: { level: 'key.0.held' } }] },
    } });
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'go' });
  await until(() => h.of('watch_installed').length === 1);
  h.entity.input('draft_changed', { text: 'typ' });
  h.entity.input('key_down', { key: '1' }); // still typing: no fire
  await sleep(70);
  h.entity.input('key_down', { key: '0' });
  h.entity.input('key_down', { key: '1' }); // holding 0: no fire
  h.entity.input('key_up', { key: '0' });
  h.entity.input('key_down', { key: '1' }); // idle and 0 released: fires
  expect(h.entityKeys('key_down').map(e => e.data.key)).toEqual(['2']);
});

test('the built-in draft sense waits for a typing pause before waking the head', async () => {
  const evaluator = { async evaluate(questions: { id: string }[]) { return Object.fromEntries(questions.map(q => [q.id, 0.9])); } };
  const h = setup(async () => {}, { evaluator, jev: { senseIntervalMs: 5 } });
  h.entity.start();
  for (const text of ['h', 'ho', 'how', 'how are', 'how are you']) { h.entity.input('draft_changed', { text }); await sleep(100); }
  expect(h.of('watch_woke')).toHaveLength(0);
  await until(() => h.of('watch_woke').length === 1);
});

test('with a voice limb: the voice answers first, simple messages never reach the head, and handoff wakes the head', async () => {
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (input.role === 'voice') {
      expect(input.tools.some(t => t.name === 'set_watch')).toBe(false);
      if (message === 'hi') await call('say', { text: 'hey!' });
      if (message === 'repeat after me') { await call('say', { text: 'on it' }); await call('handoff', { note: 'set up key mirroring' }); }
    }
    if (input.role === 'head' && input.prompt.includes('voice handed off: set up key mirroring')) {
      await call('set_watch', { watch: { name: 'mirror', on: { event: 'key_down' }, do: { effect: 'press', args: { keys: '$key' } } } });
      expect(await call('say', { text: 'mirroring your keys now' })).toBe('sent');
    }
  }, { models: { head: 'test/head', task: 'test/task', voice: 'test/voice' } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'hi' });
  await until(() => h.said().includes('hey!'));
  expect(h.mind.runs.filter(r => r.role === 'head')).toHaveLength(0);
  h.entity.input('chat_message', { text: 'repeat after me' });
  await until(() => h.said().includes('mirroring your keys now'));
  expect(h.said()).toEqual(['hey!', 'on it', 'mirroring your keys now']);
  h.entity.input('key_down', { key: '4' });
  expect(h.entityKeys('key_down').map(e => e.data.key)).toEqual(['4']);
});

test('the front limb does not act while the user is still typing; a message sent meanwhile supersedes it', async () => {
  const results: string[] = [];
  const h = setup(async (input, call) => {
    const message = lastUserMessage(input);
    if (message === 'actually') { await sleep(40); results.push(await call('say', { text: 'what would you like to change?' })); }
    if (message === "let's convert to python") results.push(await call('say', { text: 'switching to python' }));
  }, { config: { messageSettleMs: 60, messageSettleMaxMs: 2000 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'actually' });
  for (const text of ["let's", "let's convert", "let's convert to python"]) { await sleep(20); h.entity.input('draft_changed', { text }); }
  await sleep(30);
  h.entity.input('chat_message', { text: "let's convert to python" });
  await until(() => results.length === 2);
  expect(results.filter(r => r === 'sent')).toHaveLength(1);
  expect(results.filter(r => r.startsWith('superseded'))).toHaveLength(1);
  expect(h.said()).toEqual(['switching to python']);
});

test('a message sent while the user is still typing waits for them to finish, so a burst gets one wake', async () => {
  const h = setup(async () => {}, { config: { messageSettleMs: 60, messageSettleMaxMs: 2000 } });
  h.entity.start();
  await until(() => h.mind.runs.length === 1); // session started
  h.entity.input('chat_message', { text: 'first part' });
  h.entity.input('draft_changed', { text: 'second' }); // still typing right after sending
  for (const text of ['second part', 'second part here']) { await sleep(20); h.entity.input('draft_changed', { text }); }
  expect(h.mind.runs.length).toBe(1);
  h.entity.input('chat_message', { text: 'second part here' });
  await until(() => h.mind.runs.length === 2);
  await sleep(150);
  expect(h.mind.runs.length).toBe(2);
  expect(h.mind.runs[1].prompt).toContain('first part');
  expect(h.mind.runs[1].prompt).toContain('second part here');
});

test('the front limb never acts while a user message it has not read is waiting', async () => {
  const results: string[] = [];
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'one') {
      h.entity.input('chat_message', { text: 'two' }); // arrives during this run, before it acts
      results.push(await call('say', { text: 'reply to one' }));
    }
    if (lastUserMessage(input) === 'two') results.push(await call('say', { text: 'reply to both' }));
  }, { config: { messageDebounceMs: 50 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'one' });
  await until(() => results.length === 2);
  expect(results[0]).toStartWith('superseded');
  expect(h.said()).toEqual(['reply to both']);
});

test('permissions come from one table per role: a limb is offered its tools, and anything else is refused', async () => {
  const results: Record<string, string> = {};
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'hi') {
      await call('say', { text: 'hello' });
      results.headFinish = await call('finish_task', { result: 'x' });
    }
    if (input.limbId === 'reviewer') {
      results.reviewerTools = input.tools.map(t => t.name).sort().join(',');
      results.reviewerSay = await call('say', { text: 'sneaky' });
      await call('amend', { seq: h.of('chat_message').find(e => e.data.text === 'hello')!.seq, verdict: 'confirm' });
    }
  }, { config: { review: 'separate', reviewQuietMs: 20, codeLimbs: false } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'hi' });
  await until(() => h.of('message_reviewed').length === 1);
  expect(results.headFinish).toContain('you cannot use "finish_task"');
  expect(results.reviewerTools).toBe('amend,handoff,note,read_chat');
  expect(results.reviewerSay).toContain('you cannot use "say"');
  const head = h.mind.runs.find(r => r.role === 'head')!;
  expect(head.tools.some(t => t.name === 'set_watch' || t.name === 'kill')).toBe(false); // code limbs off; kill is cancel with now
  expect(head.system).not.toContain('set_watch installs a watch');
  expect(h.mind.runs.find(r => r.limbId === 'reviewer')!.system).not.toContain('set_watch');
});

test('cancel with now stops a worker at once, dropping partial work', async () => {
  const h = setup(async (input, call) => {
    if (input.role === 'head' && lastUserMessage(input) === 'start') await call('dispatch', { task: 'long work' });
    if (input.role === 'head' && lastUserMessage(input) === 'stop now') await call('cancel', { id: 'worker-3', now: true });
    if (input.role === 'task') { while (!input.signal.aborted) await sleep(5); }
  }, { config: { cancelGraceMs: 5000 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'start' });
  await until(() => h.of('limb_spawned').length === 1);
  h.entity.input('chat_message', { text: 'stop now' });
  await until(() => h.of('task_done').length === 1);
  expect(h.of('task_done')[0].data.status).toBe('killed');
  expect(h.of('cancel_requested')).toHaveLength(0);
});

test('sensed levels come from the log; a sense asked only in a condition is dropped with its watch', async () => {
  const evaluator = { async evaluate(questions: { id: string }[]) { return Object.fromEntries(questions.map(q => [q.id, 0.8])); } };
  const h = setup(async (input, call) => {
    if (lastUserMessage(input) === 'watch') {
      await call('set_watch', { watch: { name: 'confused keys', on: { event: 'key_down' }, when: { sense: 'is the user confused?', above: 0.5 }, do: { effect: 'press', args: { keys: '0' } } } });
    }
    if (lastUserMessage(input) === 'drop it') await call('cancel', { id: h.of('watch_installed', b => b === 'head').at(-1)!.data.id as string });
  }, { evaluator, jev: { senseIntervalMs: 5 }, config: { draftAttention: false } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'watch' });
  await until(() => h.entity.levels.get('sense.is_the_user_confused') !== undefined);
  expect(h.entity.levels.get('sense.is_the_user_confused')).toMatchObject({ value: 0.8, by: 'jev' });
  h.entity.input('chat_message', { text: 'drop it' });
  await until(() => h.of('senses_dropped').length === 1);
  expect(h.of('senses_dropped')[0].data.levels).toEqual(['sense.is_the_user_confused']);
  expect(h.entity.levels.get('sense.is_the_user_confused')).toBeUndefined();
});

test('restore: a session rebuilt from its log comes back paused, closes what cannot survive, and carries on after resume', async () => {
  const script = async (input: Parameters<Parameters<typeof makeEntity>[0]>[0], call: (name: string, args?: Record<string, unknown>) => Promise<string>) => {
    if (input.role === 'head' && lastUserMessage(input) === 'set up' && input.prompt.includes('"woken_because":"user message"')) {
      await call('dispatch', { task: 'long work', name: 'long' });
      await call('dispatch', { task: 'next work', name: 'next' });
      await call('set_watch', { watch: { name: 'mirror', on: { event: 'key_down' }, do: { effect: 'press', args: { keys: '$key' } } } });
      await call('run_program', { name: 'ticker', code: 'for (;;) await wait(1000);' });
      await call('set_timer', { after_ms: 150, label: 'check in' });
      await call('note', { text: 'the user likes short answers' });
    }
    if (input.role === 'task') await new Promise<void>(r => input.signal.addEventListener('abort', () => r()));
  };
  const a = setup(script, { config: { maxTasks: 1 } });
  a.entity.start();
  a.entity.input('chat_message', { text: 'set up' });
  await until(() => a.of('note').length === 1 && a.of('program_started').length === 1);
  const events = [...a.events()];
  a.entity.close();

  const b = setup(script, { config: { maxTasks: 1 } });
  b.entity.restore(events);
  expect(b.entity.status).toBe('paused');
  expect(b.of('session_restored')).toHaveLength(1);
  expect(b.of('program_failed')[0].data.reason).toContain('Hub restarted');
  const limbs = b.entity.snapshot().limbs;
  expect(limbs.find(l => l.name === 'long')).toMatchObject({ status: 'running', runs: [] });
  expect(limbs.find(l => l.name === 'next')).toMatchObject({ status: 'queued' });
  expect(b.entity.snapshot().self.notes).toEqual(['the user likes short answers']);
  const workerRuns = () => b.mind.runs.filter(r => r.role === 'task').length;
  b.entity.resume();
  await until(() => workerRuns() === 1); // the running worker picks up again; the queued one still waits
  b.entity.input('key_down', { key: '5' });
  await until(() => b.entityKeys('key_down').length === 1); // the watch was armed again
  await until(() => b.of('timer').length === 1, 3000); // and the timer, with the time it had left
  expect(b.mind.runs.some(r => r.role === 'head' && r.prompt.includes('"woken_because":"timer \\"check in\\""'))).toBe(true);
});
