import { describe, expect, test } from 'bun:test';
import {
  buildDraftDroneCreatePayload,
  filterSpawnAgentMenuEntriesForRuntime,
  runtimeSupportsCustomAgents,
} from '../src/droneHub/app/drone-create-runtime';
import type { UiMenuSelectEntry } from '../src/ui/menuSelect';

describe('draft drone create runtime support', () => {
  test('includes host runtime in draft create payloads', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'host-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'host',
      pullHostBranchBeforeCreate: true,
      seedAgent: { kind: 'builtin', id: 'cursor' },
      seedModel: 'gpt-5',
      prompt: 'boot',
    });

    expect(payload).toEqual({
      name: 'host-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'host',
      pullHostBranchBeforeCreate: true,
      seedChat: 'default',
      seedAgent: { kind: 'builtin', id: 'cursor' },
      seedModel: 'gpt-5',
      seedPrompt: 'boot',
    });
  });

  test('omits chat seed fields when creating an empty drone', () => {
    const payload = buildDraftDroneCreatePayload({
      name: 'empty-drone',
      group: 'ops',
      repoPath: '/work/repo',
      runtime: 'container',
      pullHostBranchBeforeCreate: true,
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
