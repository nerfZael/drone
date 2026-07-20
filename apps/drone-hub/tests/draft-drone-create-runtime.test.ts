import { describe, expect, test } from 'bun:test';
import {
  buildDraftDroneCreatePayload,
  filterSpawnAgentMenuEntriesForRuntime,
  runtimeSupportsCustomAgents,
  shouldAutoRenameDraftDrone,
} from '../src/droneHub/app/drone-create-runtime';
import type { UiMenuSelectEntry } from '../src/ui/menuSelect';

describe('draft drone create runtime support', () => {
  test('auto-renames blank chat drone names when callers omit the option', () => {
    expect(
      shouldAutoRenameDraftDrone({ name: '', createWithoutChat: false }),
    ).toBe(true);
    expect(
      shouldAutoRenameDraftDrone({ name: 'Named drone', createWithoutChat: false }),
    ).toBe(false);
    expect(
      shouldAutoRenameDraftDrone({ requested: false, name: '', createWithoutChat: false }),
    ).toBe(false);
    expect(
      shouldAutoRenameDraftDrone({ requested: true, name: 'Temporary', createWithoutChat: false }),
    ).toBe(true);
    expect(
      shouldAutoRenameDraftDrone({ requested: true, name: '', createWithoutChat: true }),
    ).toBe(false);
  });

  test('includes host runtime in draft create payloads', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'host-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'host',
      repoBranchSelection: {
        repoBranchSource: 'host',
        pullHostBranchBeforeCreate: true,
      },
      seedAgent: { kind: 'builtin', id: 'cursor' },
      seedModel: 'gpt-5',
      seedReasoning: 'high',
      prompt: 'boot',
    });

    expect(payload).toEqual({
      name: 'host-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'host',
      pullHostBranchBeforeCreate: true,
      repoBranchSource: 'host',
      seedChat: 'default',
      seedAgent: { kind: 'builtin', id: 'cursor' },
      seedModel: 'gpt-5',
      seedReasoning: 'high',
      seedPrompt: 'boot',
      seedSubmittedAt: expect.any(String),
    });
  });

  test('omits chat seed fields when creating an empty drone', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'empty-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'container',
      repoBranchSelection: {
        repoBranchSource: 'host',
        pullHostBranchBeforeCreate: true,
      },
      seedAgent: null,
      seedModel: null,
      prompt: '',
    });

    expect(payload).toEqual({
      name: 'empty-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'container',
      pullHostBranchBeforeCreate: true,
      repoBranchSource: 'host',
    });
  });

  test('includes remote branch selections in draft create payloads', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'remote-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'container',
      repoBranchSelection: {
        repoBranchSource: 'remote',
        pullHostBranchBeforeCreate: true,
        remoteBranch: 'origin/release/next',
      },
      seedAgent: null,
      seedModel: null,
      prompt: '',
    });

    expect(payload).toEqual({
      name: 'remote-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'container',
      pullHostBranchBeforeCreate: true,
      repoBranchSource: 'remote',
      remoteBranch: 'origin/release/next',
    });
  });

  test('includes parent repo seed source when requested', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'child-drone',
      group: 'ops',
      repoPath: '/work/repo',
      fleetParentId: 'parent-1',
      repoSeedFromDroneId: 'parent-1',
      runtime: 'container',
      repoBranchSelection: {
        repoBranchSource: 'host',
        pullHostBranchBeforeCreate: true,
      },
      seedAgent: null,
      seedModel: null,
      prompt: '',
    });

    expect(payload).toEqual({
      name: 'child-drone',
      group: 'ops',
      repoPath: '/work/repo',
      fleetParentId: 'parent-1',
      repoSeedFromDroneId: 'parent-1',
      runtime: 'container',
      pullHostBranchBeforeCreate: true,
      repoBranchSource: 'host',
    });
  });

  test('filters custom agents out of host runtime menus', () => {
    const entries: UiMenuSelectEntry[] = [
      { kind: 'item', value: 'builtin:cursor', label: 'Cursor' },
      { kind: 'separator' },
      { kind: 'item', value: 'custom:local', label: 'Local' },
    ];

    expect(runtimeSupportsCustomAgents('container')).toBe(true);
    expect(runtimeSupportsCustomAgents('host')).toBe(false);
    expect(filterSpawnAgentMenuEntriesForRuntime('container', entries)).toEqual(entries);
    expect(filterSpawnAgentMenuEntriesForRuntime('host', entries)).toEqual([
      { kind: 'item', value: 'builtin:cursor', label: 'Cursor' },
    ]);
  });
});
