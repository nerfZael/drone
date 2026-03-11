import { describe, expect, test } from 'bun:test';
import { isTransientDroneStartupError } from '../src/droneHub/app/chat-startup-errors';

describe('chat runtime startup error handling', () => {
  test('treats still-starting responses as transient startup errors', () => {
    expect(isTransientDroneStartupError(new Error('drone "abc" is still starting'))).toBe(true);
    expect(isTransientDroneStartupError(new Error('Starting host runtime...'))).toBe(true);
    expect(isTransientDroneStartupError(new Error('still provisioning'))).toBe(true);
  });

  test('does not hide non-startup errors', () => {
    expect(isTransientDroneStartupError(new Error('unknown drone: abc'))).toBe(false);
    expect(isTransientDroneStartupError(new Error('permission denied'))).toBe(false);
  });
});
