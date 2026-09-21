import { expect, test } from 'bun:test';
import { readDirectoryWithRetry } from '../src/droneHub/files/read-directory-with-retry';

const pausedMessage = '(HTTP code 409) container stopped/paused - Container drone-source is paused, unpause the container before exec';

test('waits through clone pauses, including Docker errors wrapped by the Hub, then recovers', async () => {
  for (const status of [409, 500]) {
    let attempts = 0;
    const result = await readDirectoryWithRetry(async () => {
      if (++attempts === 4) return ['docs', 'node_modules'];
      throw Object.assign(new Error(pausedMessage), { status });
    }, new AbortController().signal, undefined, { delayMs: 1 });
    expect(result).toEqual(['docs', 'node_modules']);
    expect(attempts).toBe(4);
  }
});

test('bounds paused-container retries and explains a persistent pause', async () => {
  let attempts = 0;
  await expect(readDirectoryWithRetry(async () => {
    attempts++;
    throw Object.assign(new Error(pausedMessage), { status: 500 });
  }, new AbortController().signal, undefined, { delayMs: 1, pausedTimeoutMs: 5 })).rejects.toThrow('drone is still paused');
  expect(attempts).toBeGreaterThan(1);
});

test('does not treat stopped containers or unrelated server errors as clone pauses', async () => {
  for (const message of ['Container drone-source is not running', 'filesystem failed']) {
    let attempts = 0;
    await expect(readDirectoryWithRetry(async () => {
      attempts++;
      throw Object.assign(new Error(message), { status: 500 });
    }, new AbortController().signal)).rejects.toThrow(message);
    expect(attempts).toBe(1);
  }
});

test('navigation cancels a paused-container retry', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await expect(readDirectoryWithRetry(async () => {
    attempts++;
    throw Object.assign(new Error(pausedMessage), { status: 500 });
  }, controller.signal, () => controller.abort(), { delayMs: 100 })).rejects.toMatchObject({ name: 'AbortError' });
  expect(attempts).toBe(1);
});

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
