import { describe, expect, test } from 'bun:test';

import { run } from '../src/host/dvm';

describe('bounded host command execution', () => {
  test('stops retaining output at the configured ceiling', async () => {
    const result = await run(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], {
      maxOutputBytes: 1024,
    });
    expect(result.code).toBe(125);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThan(2048);
    expect(result.stderr).toContain('output limit');
  });

  test('aborts a running child and retains timeout failure semantics', async () => {
    const controller = new AbortController();
    const pending = run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ code: 130 });

    await expect(
      run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 10 }),
    ).resolves.toMatchObject({ code: 124 });
  });
});
