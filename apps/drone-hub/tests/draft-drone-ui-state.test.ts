import { describe, expect, test } from 'bun:test';
import { shouldReadChatRuntimeForHubPhase } from '../src/droneHub/app/helpers';

describe('draft drone UI state', () => {
  test('allows draft chat state reads but still blocks provisioning phases', () => {
    expect(shouldReadChatRuntimeForHubPhase('draft')).toBe(true);
    expect(shouldReadChatRuntimeForHubPhase(null)).toBe(true);
    expect(shouldReadChatRuntimeForHubPhase('creating')).toBe(false);
    expect(shouldReadChatRuntimeForHubPhase('starting')).toBe(false);
    expect(shouldReadChatRuntimeForHubPhase('seeding')).toBe(false);
  });
});
