import { describe, expect, test } from 'bun:test';
import {
  buildDraftDroneCreatePayload,
  filterSpawnAgentMenuEntriesForRuntime,
  materializeAgentsMdForCreate,
  resolveAgentsMdLibraryFileIdForCreate,
  resolveAgentsMdOverrideForCreate,
  runtimeSupportsCustomAgents,
  shouldAutoRenameDraftDrone,
} from '../src/droneHub/app/drone-create-runtime';
import type { UiMenuSelectEntry } from '../src/ui/components';

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

  test('includes an AGENTS.md override in the primary draft-composer payload', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'guided-drone',
      repoPath: '/work/repo',
      runtime: 'container',
      repoBranchSelection: {
        repoBranchSource: 'host',
        pullHostBranchBeforeCreate: false,
      },
      seedAgent: null,
      seedModel: null,
      agentsMd: '# Instructions for this drone',
      prompt: '',
    });

    expect(payload).toMatchObject({
      name: 'guided-drone',
      repoPath: '/work/repo',
      runtime: 'container',
      agentsMd: '# Instructions for this drone',
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

  test('includes AGENTS.md overrides only for repo-attached container creates', () => {
    expect(
      resolveAgentsMdOverrideForCreate({
        enabled: true,
        content: '# Per-drone instructions',
        repoPath: '/work/repo',
        runtime: 'container',
        isClone: false,
      }),
    ).toBe('# Per-drone instructions');
    expect(
      resolveAgentsMdOverrideForCreate({
        enabled: true,
        content: '',
        repoPath: '/work/repo',
        runtime: 'container',
        isClone: false,
      }),
    ).toBe('');
    expect(
      resolveAgentsMdOverrideForCreate({
        enabled: true,
        content: '# Ignored',
        repoPath: '',
        runtime: 'container',
        isClone: false,
      }),
    ).toBeUndefined();
    expect(
      resolveAgentsMdOverrideForCreate({
        enabled: true,
        content: '# Ignored',
        repoPath: '/work/repo',
        runtime: 'host',
        isClone: false,
      }),
    ).toBeUndefined();
  });

  test('selects a saved AGENTS.md file only when a custom override is not active', () => {
    expect(
      resolveAgentsMdLibraryFileIdForCreate({
        fileId: 'backend',
        customOverrideEnabled: false,
        repoPath: '/work/repo',
        runtime: 'container',
        isClone: false,
      }),
    ).toBe('backend');
    expect(
      resolveAgentsMdLibraryFileIdForCreate({
        fileId: 'backend',
        customOverrideEnabled: true,
        repoPath: '/work/repo',
        runtime: 'container',
        isClone: false,
      }),
    ).toBeUndefined();
  });

  test('materializes saved content while giving a custom override precedence', async () => {
    const loadedIds: string[] = [];
    const loadLibraryFile = async (fileId: string) => {
      loadedIds.push(fileId);
      return '# Saved instructions\n';
    };

    expect(
      await materializeAgentsMdForCreate({
        libraryFileId: 'backend',
        loadLibraryFile,
      }),
    ).toBe('# Saved instructions\n');
    expect(
      await materializeAgentsMdForCreate({
        customOverride: '',
        libraryFileId: 'backend',
        loadLibraryFile,
      }),
    ).toBe('');
    expect(loadedIds).toEqual(['backend']);
  });
});
