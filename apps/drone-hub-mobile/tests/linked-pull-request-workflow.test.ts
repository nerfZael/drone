import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  MOBILE_PULL_REQUEST_MERGE_METHOD_OPTIONS,
  mobilePullRequestActionGuardError,
  mobilePullRequestActionUnavailableReason,
  mobilePullRequestMergePresentation,
  normalizeMobilePullRequestMergeMethod,
  performMobilePullRequestMerge,
  type MobilePullRequestMergeMethod,
} from '../src/drones/linked-pull-request-model';

const methods = MOBILE_PULL_REQUEST_MERGE_METHOD_OPTIONS.map((option) => [
  option.value,
  option.label,
] as const);

describe('mobile linked pull request workflow', () => {
  test.each(methods)('passes %s through the API and names %s in success', async (method, label) => {
    const requests: unknown[][] = [];
    const notice = await performMobilePullRequestMerge({
      request: async (...args) => {
        requests.push(args);
        return { ok: true, merged: true };
      },
      targetDeviceId: 'hub-1',
      droneId: 'drone-1',
      pullNumber: 42,
      method,
    });

    expect(requests).toEqual([
      [
        'hub-1',
        'drone-control',
        'repo.pull-requests.merge',
        { droneId: 'drone-1', pullNumber: 42, method },
      ],
    ]);
    expect(notice).toBe(`Merged PR #42 using ${label}.`);
  });

  test.each(methods)('names %s as %s in normal confirmation', (method, label) => {
    const presentation = mobilePullRequestMergePresentation({
      method,
      blockedReason: null,
      forceReason: null,
      confirmation: {
        title: 'Merge PR #42?',
        message: 'Merge into main.',
        confirmLabel: 'Merge',
        destructive: false,
      },
    });

    expect(presentation).toMatchObject({
      canRequestMerge: true,
      buttonLabel: 'Merge',
      accessibilityLabel: `Merge using ${label}`,
      confirmation: {
        message: `Merge into main. Selected method: ${label}.`,
        confirmLabel: `Merge (${label})`,
        destructive: false,
      },
    });
  });

  test('keeps policy-blocked pull requests disabled', () => {
    const presentation = mobilePullRequestMergePresentation({
      method: 'squash',
      blockedReason: 'merge conflicts detected',
      forceReason: null,
      confirmation: {
        title: 'Merge PR #42?',
        message: 'Merge into main.',
        confirmLabel: 'Merge',
        destructive: false,
      },
    });

    expect(presentation.canRequestMerge).toBe(false);
    expect(presentation.buttonLabel).toBe('Blocked');
    expect(presentation.accessibilityLabel).toBe('Merge blocked: merge conflicts detected');
  });

  test('keeps force merge explicit and separately destructive', () => {
    const presentation = mobilePullRequestMergePresentation({
      method: 'rebase',
      blockedReason: null,
      forceReason: 'checks are failing',
      confirmation: {
        title: 'Force merge PR #42?',
        message: 'Checks are failing. Merge into main using rebasing.',
        confirmLabel: 'Force merge',
        destructive: true,
      },
    });

    expect(presentation).toMatchObject({
      canRequestMerge: true,
      buttonLabel: 'Force merge',
      accessibilityLabel: 'Force merge using Rebase',
      confirmation: {
        title: 'Force merge PR #42?',
        confirmLabel: 'Force merge (Rebase)',
        destructive: true,
      },
    });
  });

  test('explains older-Hub capability gaps for merge and close', () => {
    expect(
      mobilePullRequestActionUnavailableReason({
        action: 'merge',
        supported: false,
        granted: true,
      }),
    ).toBe('The selected Hub must be updated to merge pull requests from mobile.');
    expect(
      mobilePullRequestActionUnavailableReason({
        action: 'close',
        supported: false,
        granted: false,
      }),
    ).toBe('The selected Hub must be updated to close pull requests from mobile.');
  });

  test('explains phone permission gaps for merge and close', () => {
    expect(
      mobilePullRequestActionUnavailableReason({
        action: 'merge',
        supported: true,
        granted: false,
      }),
    ).toBe('This phone has not been granted pull request merge access.');
    expect(
      mobilePullRequestActionUnavailableReason({
        action: 'close',
        supported: true,
        granted: false,
      }),
    ).toBe('This phone has not been granted pull request close access.');
  });

  test('blocks stale-scope actions before sending a request', () => {
    expect(
      mobilePullRequestActionGuardError({
        expectedScope: 'hub-1\u0000drone-1',
        currentScope: 'hub-1\u0000drone-2',
        unavailableReason: null,
        busyAction: null,
      }),
    ).toBe('The selected drone changed. Open the pull request and try again.');
  });

  test('blocks busy actions before sending a request', () => {
    expect(
      mobilePullRequestActionGuardError({
        expectedScope: 'hub-1\u0000drone-1',
        currentScope: 'hub-1\u0000drone-1',
        unavailableReason: null,
        busyAction: { pullNumber: 7, action: 'close' },
      }),
    ).toBe('Another pull request action is already in progress.');
  });

  test.each(methods)(
    'preserves recoverable API errors and names %s as %s',
    async (method, label) => {
      await expect(
        performMobilePullRequestMerge({
          request: async () => ({ ok: false, error: 'Branch protection rejected the merge' }),
          targetDeviceId: 'hub-1',
          droneId: 'drone-1',
          pullNumber: 42,
          method,
        }),
      ).rejects.toThrow(
        `Could not merge PR #42 using ${label}: Branch protection rejected the merge`,
      );
    },
  );

  test('normalizes persisted methods and safely falls back to merge commit', () => {
    expect(normalizeMobilePullRequestMergeMethod('SQUASH')).toBe('squash');
    expect(normalizeMobilePullRequestMergeMethod('rebase')).toBe('rebase');
    expect(normalizeMobilePullRequestMergeMethod('unsupported')).toBe('merge');
  });

  test('covers the complete supported merge-method set', () => {
    expect(methods.map(([method]) => method)).toEqual<MobilePullRequestMergeMethod[]>([
      'merge',
      'squash',
      'rebase',
    ]);
  });

  test('keeps the card wired to persistence, scoped actions, polling, and close confirmation', () => {
    const hookSource = readFileSync(
      new URL('../src/drones/use-drone-linked-pull-requests.ts', import.meta.url),
      'utf8',
    );
    const cardSource = readFileSync(
      new URL('../src/drones/LinkedPullRequestAttachment.tsx', import.meta.url),
      'utf8',
    );

    expect(hookSource).toContain('saveMobilePullRequestMergeMethod(normalized)');
    expect(hookSource).toContain('PENDING_CHECKS_REFRESH_MS');
    expect(hookSource).toContain('OPEN_PULL_REQUEST_REFRESH_MS');
    expect(hookSource).toContain('currentActionScope.current === actionScope');
    expect(cardSource).toContain('context.setMergeMethod(option.value)');
    expect(cardSource).toContain('context.merge(pullRequest.number, action.method)');
    expect(cardSource).toContain('pullRequestCloseConfirmation');
    expect(cardSource).toContain('confirmationBusy || anyActionBusy');
  });
});
