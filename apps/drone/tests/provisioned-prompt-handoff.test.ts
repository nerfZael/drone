import { describe, expect, test } from 'bun:test';

import { ProvisionedPromptHandoffStore } from '../src/hub/provisioned-prompt-handoff';
import { seededDroneRunFileChangesBaseline } from '../src/hub/run-file-changes';

describe('provisioned prompt handoff', () => {
  test('is consumed once and rejects stale startup state', () => {
    let now = 1_000;
    const store = new ProvisionedPromptHandoffStore(() => now, 500);
    const handoff = {
      droneId: 'drone-1',
      chatName: 'default',
      promptId: 'prompt-1',
      droneEntry: { id: 'drone-1' },
      registrySnapshot: { drones: { 'drone-1': { id: 'drone-1' } } },
      createdAtMs: now,
    };

    store.register(handoff);
    expect(store.peekForChat({ droneId: 'drone-1', chatName: 'default' })).toBe(handoff);
    expect(store.take(handoff)).toBe(handoff);
    expect(store.peekForChat({ droneId: 'drone-1', chatName: 'default' })).toBeNull();
    expect(store.take(handoff)).toBeNull();

    store.register({ ...handoff, promptId: 'stale', createdAtMs: now });
    now += 501;
    expect(store.take({ ...handoff, promptId: 'stale' })).toBeNull();
  });

  test('builds a baseline from the exact clean seeded commit and tree', () => {
    const baseline = seededDroneRunFileChangesBaseline({
      droneId: 'drone-1',
      label: 'README contents',
      commitOid: '1'.repeat(40),
      treeOid: '2'.repeat(40),
      baseRef: 'main',
      capturedAt: '2026-08-12T15:40:00.000Z',
      owner: { chatName: 'default', promptId: 'prompt-1' },
    });

    expect(baseline).toMatchObject({
      targetId: 'drone:drone-1',
      repoRoot: '/work/repo',
      treeOid: '2'.repeat(40),
      headCommitOid: '1'.repeat(40),
      baseRef: 'main',
      baseTreeOid: '2'.repeat(40),
      baseCommitOid: '1'.repeat(40),
      owner: { droneId: 'drone-1', chatName: 'default', promptId: 'prompt-1' },
    });
    expect(
      seededDroneRunFileChangesBaseline({
        droneId: 'drone-1',
        label: 'README contents',
        commitOid: 'not-a-sha',
        treeOid: '2'.repeat(40),
        owner: { chatName: 'default', promptId: 'prompt-1' },
      }),
    ).toBeNull();
  });
});
