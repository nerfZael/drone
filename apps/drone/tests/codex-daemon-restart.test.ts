import { describe, expect, test } from 'bun:test';

import { codexDaemonRestartRecoveryAction } from '../src/codex-daemon-restart';

describe('Codex daemon restart recovery', () => {
  const nowMs = Date.parse('2026-08-22T14:23:00.000Z');
  const createdAt = '2026-08-22T14:22:50.000Z';

  test('resumes unowned work that never left the durable queue', () => {
    expect(
      codexDaemonRestartRecoveryAction({ state: 'queued', owned: false, createdAt, nowMs }),
    ).toBe('resume-queued');
  });

  test('fails an unowned running turn instead of risking duplicate side effects', () => {
    expect(
      codexDaemonRestartRecoveryAction({ state: 'running', owned: false, createdAt, nowMs }),
    ).toBe('fail-running');
  });

  test('leaves owned and newly-created work alone', () => {
    expect(
      codexDaemonRestartRecoveryAction({ state: 'queued', owned: true, createdAt, nowMs }),
    ).toBe('none');
    expect(
      codexDaemonRestartRecoveryAction({
        state: 'queued',
        owned: false,
        createdAt: '2026-08-22T14:22:59.000Z',
        nowMs,
      }),
    ).toBe('none');
  });
});
