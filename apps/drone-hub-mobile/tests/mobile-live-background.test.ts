import { expect, mock, test } from 'bun:test';

const listeners = new Set<(event: { sessionId: string }) => void>();
const stopped: string[] = [];
let current = '';
let nextId = 0;
let failStart = false;
let task!: (input: { sessionId: string }) => Promise<void>;
const native = {
  async start(id: string) { if (failStart) throw new Error('Service denied'); current = id; },
  async stop(id: string) { stopped.push(id); if (current === id) current = ''; },
  async isActive(id: string) { return current === id; },
  addListener(_name: string, listener: (event: { sessionId: string }) => void) {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  },
};
mock.module('react-native', () => ({ Platform: { OS: 'android' }, AppRegistry: {
  registerHeadlessTask: (_name: string, factory: () => typeof task) => { task = factory(); },
} }));
mock.module('expo-modules-core', () => ({ requireOptionalNativeModule: () => native }));
mock.module('expo-crypto', () => ({ randomUUID: () => `session-${++nextId}` }));
const { startMobileLiveBackground } = await import('../src/local-assistant/mobile-live-background');
const emit = (sessionId: string) => { for (const listener of listeners) listener({ sessionId }); };

test('notification stop targets only its session and finishes the headless task', async () => {
  let notifications = 0;
  const release = await startMobileLiveBackground(() => { notifications++; });
  let finished = false;
  const running = task({ sessionId: current }).then(() => { finished = true; });
  await Promise.resolve();
  emit('old-session');
  expect(notifications).toBe(0);
  expect(finished).toBe(false);
  emit(current);
  await running;
  expect(finished).toBe(true);
  expect(notifications).toBe(1);
  await release();
  expect(listeners.size).toBe(0);
});

test('a failed service start cleans up and preserves its actionable error', async () => {
  failStart = true;
  try {
    await expect(startMobileLiveBackground(() => {})).rejects.toThrow('Service denied');
    expect(listeners.size).toBe(0);
    expect(stopped.at(-1)).toBe(`session-${nextId}`);
  } finally { failStart = false; }
});

test('late cleanup cannot stop a newer session and late task startup settles', async () => {
  const oldRelease = await startMobileLiveBackground(() => {});
  const oldId = current;
  await oldRelease();
  const release = await startMobileLiveBackground(() => {});
  const newId = current;
  await oldRelease();
  expect(current).toBe(newId);
  await task({ sessionId: oldId });
  await release();
  expect(listeners.size).toBe(0);
});
