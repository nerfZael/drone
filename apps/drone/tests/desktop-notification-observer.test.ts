import { expect, test } from 'bun:test';
import { DesktopNotificationObserver, type DesktopNotificationEvent } from '../src/hub/notifications/DesktopNotificationObserver';

const chat = { droneId: 'drone', chatName: 'review' };
const status = (id: string, state = 'completed', idle = true) => ({
  droneName: 'Reviewer', idle,
  reason: state === 'failed' ? 'latest_user_failed' : idle ? 'latest_agent_message' : 'active_user_messages',
  latest: { id, status: state, role: state === 'failed' ? 'user' : 'agent' },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('baselines existing history, reports fast completions and failures once, ignores stopped runs', async () => {
  let current = status('old');
  const events: DesktopNotificationEvent[] = [];
  const observer = new DesktopNotificationObserver(async () => current, (event) => events.push(event));
  observer.update([chat]); await tick();
  expect(events).toHaveLength(0);
  current = status('new');
  observer.update([chat]); await tick();
  observer.update([chat]); await tick();
  expect(events.map((event) => event.kind)).toEqual(['finished']);
  expect(events[0]).toMatchObject({ ...chat, droneName: 'Reviewer' });
  current = status('failure', 'failed');
  observer.update([chat]); await tick();
  observer.update([chat]); await tick();
  expect(events.map((event) => event.kind)).toEqual(['finished', 'failed']);
  current = { ...status('agent-failure', 'failed'), reason: 'latest_agent_message' };
  observer.update([chat]); await tick();
  expect(events.at(-1)?.kind).toBe('failed');
  current = status('stopped', 'stopped');
  observer.update([chat]); await tick();
  expect(events).toHaveLength(3);
  observer.close();
});

test('detects busy to idle with the same message and ignores new chat history', async () => {
  let current = status('turn', 'completed', false);
  const events: DesktopNotificationEvent[] = [];
  const observer = new DesktopNotificationObserver(async () => current, (event) => events.push(event));
  observer.update([chat]); await tick();
  current = status('turn');
  observer.update([chat]); await tick();
  observer.update([{ ...chat, chatName: 'imported' }]); await tick();
  expect(events).toHaveLength(1);
  observer.update([], [chat]);
  observer.update([chat]); await tick();
  expect(events).toHaveLength(1);
  observer.close();
});

test('serializes invalidations and suppresses a late read after disconnect', async () => {
  let resolve!: (value: ReturnType<typeof status>) => void;
  let calls = 0;
  const events: DesktopNotificationEvent[] = [];
  const observer = new DesktopNotificationObserver(() => { calls++; return new Promise((r) => { resolve = r; }); }, (event) => events.push(event));
  observer.update([chat]);
  observer.update([chat]);
  expect(calls).toBe(1);
  resolve(status('old')); await tick();
  expect(calls).toBe(2);
  observer.close();
  resolve(status('new')); await tick();
  expect(events).toHaveLength(0);
});

test('a removed and re-added chat cannot adopt an in-flight read from its old incarnation', async () => {
  const reads: Array<(value: ReturnType<typeof status>) => void> = [];
  const events: DesktopNotificationEvent[] = [];
  const observer = new DesktopNotificationObserver(() => new Promise((resolve) => reads.push(resolve)), (event) => events.push(event));
  observer.update([chat]);
  reads.shift()!(status('baseline')); await tick();
  observer.update([chat]);
  observer.update([], [chat]);
  observer.update([chat]);
  reads.shift()!(status('old-inflight')); await tick();
  reads.shift()!(status('restored-history')); await tick();
  expect(events).toHaveLength(0);
  observer.update([chat]);
  reads.shift()!(status('new-completion')); await tick();
  expect(events).toHaveLength(1);
  observer.close();
});
