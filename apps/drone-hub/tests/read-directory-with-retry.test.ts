import { expect, test } from 'bun:test';
import { readDirectoryWithRetry } from '../src/droneHub/files/read-directory-with-retry';

test('retries a timed-out read once and returns the recovered directory', async () => {
  let attempts = 0;
  const retries: number[] = [];
  const result = await readDirectoryWithRetry(async (signal) => {
    if (++attempts === 2) return ['file'];
    return await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  }, new AbortController().signal, (attempt) => retries.push(attempt), { timeoutMs: 5, delayMs: 1 });
  expect(result).toEqual(['file']);
  expect(retries).toEqual([1]);
});

test('does not retry permission failures and bounds repeated service failures', async () => {
  for (const [status, expected] of [[403, 1], [404, 1], [503, 2]]) {
    let attempts = 0;
    await expect(readDirectoryWithRetry(async () => {
      attempts++;
      throw Object.assign(new Error('failed'), { status });
    }, new AbortController().signal, undefined, { delayMs: 1 })).rejects.toThrow('failed');
    expect(attempts).toBe(expected);
  }
});

test('navigation cancellation stops retry backoff without another request', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await expect(readDirectoryWithRetry(async () => {
    attempts++;
    throw Object.assign(new Error('unavailable'), { status: 503 });
  }, controller.signal, () => controller.abort(), { delayMs: 100 })).rejects.toMatchObject({ name: 'AbortError' });
  expect(attempts).toBe(1);
});
