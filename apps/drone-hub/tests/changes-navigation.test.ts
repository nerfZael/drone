import { beforeEach, describe, expect, test } from 'bun:test';
import {
  clearSelectedPullRequestForDrone,
  consumeRequestedAgentRunChanges,
  consumeRequestedPullRequestForDrone,
  requestAgentRunChanges,
  requestChangesPullRequest,
  selectedPullRequestForDrone,
} from '../src/droneHub/changes/navigation';

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
});

describe('changes navigation requests', () => {
  test('routes a historical run to the matching drone changes panel once', () => {
    const request = {
      droneId: 'drone-a',
      initialSelection: { workspaceTargetId: 'drone:drone-a', path: 'src/a.ts' },
      fileChanges: {
        version: 2 as const,
        capturedAt: '2026-07-22T00:00:00.000Z',
        counts: { changed: 1, additions: 1, deletions: 0 },
        workspaces: [
          {
            targetId: 'drone:drone-a',
            droneId: 'drone-a',
            label: 'Drone A',
            counts: { changed: 1, additions: 1, deletions: 0 },
            previewEntries: [
              { path: 'src/a.ts', status: 'modified' as const, additions: 1, deletions: 0 },
            ],
          },
        ],
      },
    };

    requestAgentRunChanges(request);

    expect(consumeRequestedAgentRunChanges('drone-b')).toBeNull();
    expect(consumeRequestedAgentRunChanges('drone-a')).toEqual(request);
    expect(consumeRequestedAgentRunChanges('drone-a')).toBeNull();
  });

  test('stores selected PR and consumes pending open request once', () => {
    requestChangesPullRequest({ droneId: 'drone-a', pullNumber: 42 });

    expect(selectedPullRequestForDrone('drone-a')).toBe(42);
    expect(consumeRequestedPullRequestForDrone('drone-a')).toBe(42);
    expect(consumeRequestedPullRequestForDrone('drone-a')).toBeNull();
    expect(selectedPullRequestForDrone('drone-a')).toBe(42);
  });

  test('tracks pending requests independently per drone', () => {
    requestChangesPullRequest({ droneId: 'drone-a', pullNumber: 7 });
    requestChangesPullRequest({ droneId: 'drone-b', pullNumber: 9 });

    expect(consumeRequestedPullRequestForDrone('drone-b')).toBe(9);
    expect(consumeRequestedPullRequestForDrone('drone-a')).toBe(7);
    expect(consumeRequestedPullRequestForDrone('drone-b')).toBeNull();
  });

  test('clears selected PR without affecting other drones', () => {
    requestChangesPullRequest({ droneId: 'drone-a', pullNumber: 11 });
    requestChangesPullRequest({ droneId: 'drone-b', pullNumber: 12 });

    clearSelectedPullRequestForDrone('drone-a');

    expect(selectedPullRequestForDrone('drone-a')).toBeNull();
    expect(selectedPullRequestForDrone('drone-b')).toBe(12);
  });
});
