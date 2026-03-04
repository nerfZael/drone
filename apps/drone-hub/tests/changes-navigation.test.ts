import { beforeEach, describe, expect, test } from 'bun:test';
import {
  consumeRequestedPullRequestForDrone,
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
});
