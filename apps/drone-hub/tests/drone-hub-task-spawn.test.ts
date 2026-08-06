import { describe, expect, test } from 'bun:test';
import { buildDroneHubTaskQueueSpec } from '../src/droneHub/chat/drone-hub-task-spawn';

describe('drone hub task spawn queue spec', () => {
  test('builds a clone request for clone mode', () => {
    expect(
      buildDroneHubTaskQueueSpec({
        mode: 'clone',
        requestedName: 'Auth fix',
        taskDescription: 'Trace the callback path.',
        sourceDroneId: 'dr-123',
        sourceContext: { group: 'platform', repoPath: '/work/repo' },
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedModel: 'gpt-5.4',
        repoDefaults: {
          repoBranchSource: 'remote',
          repoCreateRemoteBranch: 'origin/main',
        },
      }),
    ).toEqual({
      name: 'Auth fix',
      runtime: 'container',
      group: 'platform',
      repoPath: '/work/repo',
      fleetParentId: 'dr-123',
      cloneFrom: 'dr-123',
      cloneChats: false,
      seedAgent: { kind: 'builtin', id: 'codex' },
      seedModel: 'gpt-5.4',
      seedChat: 'default',
      seedPrompt: 'Trace the callback path.',
      seedSubmittedAt: expect.any(String),
    });
  });

  test('builds a fresh create request for spawn mode using repo defaults', () => {
    expect(
      buildDroneHubTaskQueueSpec({
        mode: 'spawn',
        requestedName: 'Auth fix',
        taskDescription: 'Trace the callback path.',
        sourceDroneId: 'dr-123',
        sourceContext: { group: 'platform', repoPath: '/work/repo' },
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedModel: 'gpt-5.4',
        repoDefaults: {
          repoBranchSource: 'remote',
          repoCreateRemoteBranch: 'origin/main',
        },
      }),
    ).toEqual({
      name: 'Auth fix',
      group: 'platform',
      repoPath: '/work/repo',
      fleetParentId: 'dr-123',
      runtime: 'container',
      repoBranchSource: 'remote',
      remoteBranch: 'origin/main',
      seedChat: 'default',
      seedAgent: { kind: 'builtin', id: 'codex' },
      seedModel: 'gpt-5.4',
      seedPrompt: 'Trace the callback path.',
      seedSubmittedAt: expect.any(String),
    });
  });

  test('spawn mode falls back to no-repo create semantics when the source has no repo', () => {
    expect(
      buildDroneHubTaskQueueSpec({
        mode: 'spawn',
        requestedName: 'Docs',
        taskDescription: 'Write the README update.',
        sourceDroneId: 'dr-123',
        sourceContext: { group: '', repoPath: '' },
        seedAgent: { kind: 'builtin', id: 'cursor' },
        seedModel: '',
        repoDefaults: {
          repoBranchSource: 'remote',
          repoCreateRemoteBranch: 'origin/main',
        },
      }),
    ).toEqual({
      name: 'Docs',
      fleetParentId: 'dr-123',
      runtime: 'container',
      repoBranchSource: 'host',
      seedChat: 'default',
      seedAgent: { kind: 'builtin', id: 'cursor' },
      seedPrompt: 'Write the README update.',
      seedSubmittedAt: expect.any(String),
    });
  });
});
