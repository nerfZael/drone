import { expect, mock, test } from 'bun:test';
mock.module('react-native', () => ({ Platform: { OS: 'android' } }));
let tickListener: ((event: { id: string }) => void) | undefined;
const calls: string[] = [];
let sequence = 0; let failArm = false;
let listener: ((event: { id: string; action: string }) => void) | undefined;
let stopped: (() => void) | undefined;
mock.module('expo-crypto', () => ({ randomUUID: () => `control-${++sequence}` }));
mock.module('../src/local-assistant/mobile-live-background', () => ({
  startMobileLiveBackground: async (onStop: () => void) => {
    calls.push('service.start'); stopped = onStop; return async () => { calls.push('service.stop'); };
  },
}));
mock.module('expo-modules-core', () => ({ requireOptionalNativeModule: () => ({
  armStandbyControls: async (id: string) => { calls.push(`standby:${id}`); },
  armControls: async (id: string) => { calls.push(`arm:${id}`); if (failArm) throw new Error('No controls'); },
  updateControls: async (id: string, state: string) => { calls.push(`state:${id}:${state}`); },
  disarmControls: async (id: string) => { calls.push(`disarm:${id}`); },
  playCue: async (id: string, cue: string) => { calls.push(`cue:${id}:${cue}`); },
  addListener: (event: string, callback: any) => {
    if (event === 'controlTick') { tickListener = callback; return { remove() { tickListener = undefined; } }; }
    listener = callback; return { remove() { listener = undefined; } };
  },
}) }));
const { openMobileLiveControls } = await import('../src/local-assistant/mobile-live-controls');

test('headset controls stay armed while paused and filter stale media commands', async () => {
  calls.length = 0; const actions: string[] = [];
  const controls = await openMobileLiveControls((action) => actions.push(action));
  const id = `control-${sequence}`;
  await controls.update('paused'); await controls.cue('stopped');
  expect(calls).not.toContain('service.stop');
  listener?.({ id: 'old', action: 'play' });
  listener?.({ id, action: 'play' }); listener?.({ id, action: 'pause' });
  expect(actions).toEqual(['play', 'pause']);
  stopped?.(); expect(actions.at(-1)).toBe('end');
  const stale = listener;
  await controls.release(); await controls.release();
  stale?.({ id, action: 'play' });
  await controls.update('recording'); await controls.cue('recording');
  expect(actions).toEqual(['play', 'pause', 'end']);
  expect(calls.slice(-2)).toEqual([`disarm:${id}`, 'service.stop']);
  expect(calls.filter((call) => call === 'service.stop')).toHaveLength(1);
});

test('failed control registration releases the foreground service and event listener', async () => {
  calls.length = 0; failArm = true;
  try {
    await expect(openMobileLiveControls(() => {})).rejects.toThrow('No controls');
    expect(listener).toBeUndefined(); expect(calls.at(-1)).toBe('service.stop');
  } finally { failArm = false; }
});


test('standby registers paused natively rather than briefly starting playback', async () => {
  calls.length = 0;
  const controls = await openMobileLiveControls(() => {}, true);
  try {
    expect(calls).toEqual(['service.start', `standby:control-${sequence}`]);
  } finally { await controls.release(); }
});


test('native ticks drive only their owned clock and release cancels pending work', async () => {
  const controls = await openMobileLiveControls(() => {});
  let fired = 0;
  controls.schedule(() => { fired++; }, 0);
  tickListener?.({ id: 'stale' }); expect(fired).toBe(0);
  tickListener?.({ id: `control-${sequence}` }); expect(fired).toBe(1);
  tickListener?.({ id: `control-${sequence}` }); expect(fired).toBe(1);
  controls.schedule(() => { fired++; }, 0);
  const stale = tickListener;
  await controls.release();
  stale?.({ id: `control-${sequence}` });
  expect(fired).toBe(1); expect(tickListener).toBeUndefined();
});
