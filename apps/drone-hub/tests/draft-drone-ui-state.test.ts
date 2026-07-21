import { describe, expect, test } from 'bun:test';
import { shouldReadChatRuntimeForHubPhase } from '../src/droneHub/app/helpers';
import { shouldHandoffDraftChatWorkspace } from '../src/droneHub/app/lifecycle-effect-helpers';
import { droneProvisioningLabel, isDroneProvisioningPhase } from '../src/droneHub/hub-phase';

describe('draft drone UI state', () => {
  test('allows draft chat state reads but still blocks provisioning phases', () => {
    expect(shouldReadChatRuntimeForHubPhase('draft')).toBe(true);
    expect(shouldReadChatRuntimeForHubPhase(null)).toBe(true);
    expect(shouldReadChatRuntimeForHubPhase('creating')).toBe(false);
    expect(shouldReadChatRuntimeForHubPhase('starting')).toBe(false);
    expect(shouldReadChatRuntimeForHubPhase('seeding')).toBe(false);
  });

  test('keeps the optimistic conversation mounted until provisioning and automatic naming finish', () => {
    const base = { creating: false, autoRenaming: false, hasSelectedDrone: true };

    expect(shouldHandoffDraftChatWorkspace({ ...base, hubPhase: 'creating' })).toBe(false);
    expect(shouldHandoffDraftChatWorkspace({ ...base, hubPhase: 'starting' })).toBe(false);
    expect(shouldHandoffDraftChatWorkspace({ ...base, hubPhase: 'seeding' })).toBe(false);
    expect(shouldHandoffDraftChatWorkspace({ ...base, hubPhase: null, autoRenaming: true })).toBe(false);
    expect(shouldHandoffDraftChatWorkspace({ ...base, hubPhase: null })).toBe(true);
  });

  test('separates saved drafts from active provisioning and uses one label source', () => {
    expect(isDroneProvisioningPhase('draft')).toBe(false);
    expect(isDroneProvisioningPhase('creating')).toBe(true);
    expect(droneProvisioningLabel('creating')).toBe('Creating');
    expect(droneProvisioningLabel('starting')).toBe('Starting');
    expect(droneProvisioningLabel('seeding')).toBe('Seeding');
  });
});
