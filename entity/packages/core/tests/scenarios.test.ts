// M1 "done when": scenarios 1-4 and 9 from entity/docs/demo.md pass as stories.
// The scripted mind stands in for the LLM; everything else is the real runtime.
import { afterEach, expect, test } from 'bun:test';
import { lastUserMessage, makeEntity, sleep, until } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function setup(...args: Parameters<typeof makeEntity>) {
  const h = makeEntity(...args);
  cleanups.push(() => h.entity.close());
  return h;
}

test('scenario 1: hello gets a response, possibly unprompted', async () => {
  const h = setup(async (input, call) => {
    if (input.prompt.includes('"woken_because":"session started"')) await call('say', { text: 'Hi, I am here.' });
    else if (lastUserMessage(input) === 'hello') await call('press', { keys: '1' });
  });
  h.entity.start();
  await until(() => h.said().length === 1);
  h.entity.input('chat_message', { text: 'hello' });
  await until(() => h.entityKeys('key_down').length === 1);
  expect(h.said()).toEqual(['Hi, I am here.']);
});

test('scenario 2: "press 556" presses 5, 5, 6', async () => {
  const h = setup(async (input, call) => { if (lastUserMessage(input) === 'Press 556') await call('press', { keys: '556' }); });
  h.entity.start();
  h.entity.input('chat_message', { text: 'Press 556' });
  await until(() => h.entityKeys('key_down').length === 3);
  expect(h.entityKeys('key_down').map(e => e.data.key).join('')).toBe('556');
});

test('scenario 3: mirroring runs as a watch with no LLM call per key, and ignores its own presses', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input).startsWith('Repeat after me')) {
      expect(await call('set_watch', { watch: { name: 'mirror', on: { event: 'key_down' }, do: { effect: 'press', args: { keys: '$key' } } } })).toContain('installed');
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'Repeat after me' });
  await until(() => h.of('watch_installed').length === 1);
  const runsBefore = h.mind.runs.length;
  for (const key of ['3', '7', '1']) {
    const before = h.entity.log.length;
    const t = h.entity.now();
    h.entity.input('key_down', { key });
    h.entity.input('key_up', { key });
    const echo = h.entityKeys('key_down', before);
    expect(echo.map(e => e.data.key)).toEqual([key]); // exactly one press: no echo loop
    expect(echo[0].t - t).toBeLessThan(50);
  }
  expect(h.mind.runs.length).toBe(runsBefore);
});

test('scenario 4: a counting program stops the moment 5 is pressed, and the voice can acknowledge at once', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input).startsWith('Count')) {
      await call('set_watch', { watch: { name: 'stop on 5', on: { event: 'key_down', key: '5' }, do: { stop_output: { reason: 'user pressed 5' } } } });
      await call('run_program', { name: 'count', code: 'for (let i = 1; i <= 50; i++) { await say(String(i)); await wait(10); }' });
    }
    if (input.prompt.includes('"woken_because":"output stopped: user pressed 5"')) {
      expect(await call('say', { text: 'Stopped counting.' })).toBe('sent');
    }
  }, { config: { limbPerSecond: 1000 } });
  h.entity.start();
  h.entity.input('chat_message', { text: 'Count to 50, stop when I press 5' });
  // The count runs at 100/s here; the default 5 "limb" effects/s would throttle it (see runtime.test.ts).
  const numbers = () => h.said().filter(text => /^\d+$/.test(text));
  await until(() => numbers().length >= 11);
  h.entity.input('key_down', { key: '5' });
  const atPress = numbers().length;
  await until(() => h.said().includes('Stopped counting.'));
  await sleep(50);
  expect(numbers().length).toBe(atPress);
  expect(h.of('program_cancelled')).toHaveLength(1);
});

test('scenario 9: hold 6 while the user holds 5', async () => {
  const h = setup(async (input, call) => {
    if (lastUserMessage(input).startsWith('Hold 6')) {
      await call('set_watch', { watch: { name: 'follow down', on: { event: 'key_down', key: '5' }, do: { effect: 'key_down', args: { key: '6' } } } });
      await call('set_watch', { watch: { name: 'follow up', on: { event: 'key_up', key: '5' }, do: { effect: 'key_up', args: { key: '6' } } } });
    }
  });
  h.entity.start();
  h.entity.input('chat_message', { text: 'Hold 6 while I hold 5' });
  await until(() => h.of('watch_installed').length === 2);
  h.entity.input('key_down', { key: '5' });
  expect(h.entity.snapshot().levels['key.6.held']?.value).toMatch(/^watch-/);
  await sleep(20);
  h.entity.input('key_up', { key: '5' });
  expect(h.entity.snapshot().levels['key.6.held']).toBeUndefined();
});
