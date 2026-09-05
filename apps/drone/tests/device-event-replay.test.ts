import { expect, test } from 'bun:test';
import { DeviceEventReplay } from '../src/hub/device-mesh/device-event-replay';
import { DeviceReadBudget } from '../src/hub/device-mesh/device-read-budget';

test('event replay isolates recipients, detects retention gaps and resets after restart', () => {
  const replay = new DeviceEventReplay();
  const event = { expiresAt: new Date(Date.now() + 60000).toISOString() } as any;
  const first = replay.append('a', event);
  replay.append('b', event);
  const next = replay.append('a', event);
  expect(replay.after('a', first).entries.map((entry) => entry.cursor)).toEqual([next]);
  expect(new DeviceEventReplay().after('a', first).reset).toBe(true);
  for (let i = 0; i < 1025; i++) replay.append('a', event);
  expect(replay.after('a', first)).toEqual({ reset: true, entries: [] });
  replay.deleteDevice('a');
  expect(replay.after('a', next).entries).toEqual([]);
});

test('read admission is bounded and cancellation invalidates only the affected owner', async () => {
  const budget = new DeviceReadBudget();
  const owner = budget.captureOwner('a');
  const other = await budget.reserveJson(budget.captureOwner('b'));
  const reads = await Promise.all(Array.from({ length: 7 }, () => budget.reserveJson(owner)));
  await expect(budget.reserveJson(owner)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  budget.revokeDevice('a');
  for (const read of reads) {
    expect(() => read.assertActive()).toThrow();
    read.release();
    read.release();
  }
  expect(() => other.assertActive()).not.toThrow();
  other.release();
  const fresh = await budget.reserveJson(budget.captureOwner('a'));
  expect(() => fresh.assertActive()).not.toThrow();
  fresh.release();
  budget.close();
});
