import { expect, test } from 'bun:test';
import { createTerminalOpenRequests } from '../src/droneHub/terminal/terminal-open-request';

test('prewarm and visible open share a single request; other tabs remain independent', async () => {
  const calls: string[] = [];
  const requests = createTerminalOpenRequests((async (url: string) => {
    calls.push(url);
    return { sessionName: new URL(url, 'http://localhost').searchParams.get('session') };
  }) as any);
  const target = { droneId: 'drone-1', cwd: '/work/a b', sessionName: 'drone-hub-shell' };
  const prewarm = requests.open(target);
  const open = requests.open(target);
  expect(prewarm).toBe(open);
  await open;
  expect(requests.open(target)).toBe(prewarm);
  expect(calls).toHaveLength(1);
  await requests.open({ ...target, sessionName: 'drone-hub-shell-second' });
  expect(calls).toHaveLength(2);
  requests.invalidate(target);
  await requests.open(target);
  expect(calls).toHaveLength(3);
});

test('failed opens are retryable and explicit session IDs prevent duplicate creation on retry', async () => {
  let calls = 0;
  const urls: string[] = [];
  const requests = createTerminalOpenRequests((async (url: string) => {
    urls.push(url);
    if (++calls === 1) throw new Error('offline');
    return { sessionName: 'drone-hub-shell-stable-id' };
  }) as any);
  const target = { droneId: 'drone', cwd: '/tmp', sessionName: 'drone-hub-shell-stable-id' };
  await expect(requests.open(target)).rejects.toThrow('offline');
  await expect(requests.open(target)).resolves.toMatchObject({ sessionName: target.sessionName });
  expect(urls[0]).toBe(urls[1]);
  expect(urls[0]).not.toContain('create=1');
});
