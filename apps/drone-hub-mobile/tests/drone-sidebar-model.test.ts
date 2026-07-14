import { describe, expect, test } from 'bun:test';
import {
  buildMobileDroneRepoGroups,
  mobileDroneTurnsToAssistantMessages,
  normalizeMobileDroneListPayload,
  normalizeMobileDroneTurns,
  normalizeMobileDrones,
} from '../src/drones/drone-sidebar-model';

describe('mobile drone sidebar model', () => {
  test('groups drones by repo and preserves fleet and chat hierarchy', () => {
    const drones = normalizeMobileDrones([
      {
        id: 'child',
        name: 'Child',
        repoPath: '/work/alpha',
        fleetParentId: 'parent',
        chats: ['default', 'review'],
      },
      { id: 'loose', name: 'Loose', chats: [] },
      { id: 'parent', name: 'Parent', repoPath: '/work/alpha', chats: ['default'] },
      {
        id: 'beta',
        name: 'Beta',
        repoPath: '/work/beta',
        group: 'Delivery/Review',
        chats: ['planning'],
      },
    ]);

    const groups = buildMobileDroneRepoGroups(drones);
    expect(groups.map((group) => group.label)).toEqual(['Ungrouped', 'alpha', 'beta']);
    expect(groups[1]?.roots.map((node) => node.drone.id)).toEqual(['parent']);
    expect(groups[1]?.roots[0]?.children.map((node) => node.drone.id)).toEqual(['child']);
    expect(groups[1]?.roots[0]?.children[0]?.drone.chats).toEqual(['default', 'review']);
    expect(groups[0]?.roots[0]?.drone.chats).toEqual(['default']);
    expect(groups[2]?.folders[0]).toMatchObject({
      path: 'Delivery',
      label: 'Delivery',
      droneCount: 1,
    });
    expect(groups[2]?.folders[0]?.children[0]).toMatchObject({
      path: 'Delivery/Review',
      label: 'Review',
      droneCount: 1,
    });
    expect(groups[2]?.folders[0]?.children[0]?.roots[0]?.drone.id).toBe('beta');
  });

  test('uses non-empty legacy repository metadata before falling back to Ungrouped', () => {
    const drones = normalizeMobileDrones([
      { id: 'nested', repoPath: '', repo: { path: '/work/nested' } },
      { id: 'legacy', repositoryPath: '/work/legacy' },
    ]);

    expect(buildMobileDroneRepoGroups(drones).map((group) => group.label)).toEqual([
      'legacy',
      'nested',
    ]);
  });

  test('uses the versioned repository map when individual summaries omit their paths', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 2,
      drones: [{ id: 'mapped', name: 'Mapped' }],
      repoPathByDroneId: { mapped: '/work/mapped' },
    });

    expect(payload.schemaVersion).toBe(2);
    expect(buildMobileDroneRepoGroups(payload.drones)[0]?.label).toBe('mapped');
  });

  test('keeps orphaned and cyclic children reachable at the repo root', () => {
    const drones = normalizeMobileDrones([
      { id: 'orphan', fleetParentId: 'missing', repoPath: '/repo' },
      { id: 'a', fleetParentId: 'b', repoPath: '/repo' },
      { id: 'b', fleetParentId: 'a', repoPath: '/repo' },
    ]);

    expect(buildMobileDroneRepoGroups(drones)[0]?.roots.map((node) => node.drone.id)).toEqual([
      'orphan',
      'a',
      'b',
    ]);
  });

  test('projects each drone turn into the shared user and assistant transcript model', () => {
    expect(
      mobileDroneTurnsToAssistantMessages([
        { prompt: 'Inspect this', ok: true, output: 'Done' },
        { prompt: 'Try again', ok: false, error: 'Agent failed' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Inspect this' },
      { role: 'assistant', content: 'Done' },
      { role: 'user', content: 'Try again' },
      {
        role: 'assistant',
        isError: true,
        errorMessage: 'Agent failed',
      },
    ]);
  });

  test('normalizes DroneHub transcript metadata for the native chat presentation', () => {
    expect(
      normalizeMobileDroneTurns([
        {
          turn: 4,
          at: '2026-07-14T10:00:00.000Z',
          promptAt: '2026-07-14T09:59:58.000Z',
          completedAt: '2026-07-14T10:00:02.000Z',
          prompt: 'Ship it',
          output: 'Done',
          model: 'gpt-5.2-codex',
          attachments: [{ name: 'plan.md', mime: 'text/markdown', size: 42 }],
        },
      ])[0],
    ).toMatchObject({
      id: 'turn-4',
      turn: 4,
      prompt: 'Ship it',
      output: 'Done',
      ok: true,
      model: 'gpt-5.2-codex',
      attachments: [{ name: 'plan.md', mime: 'text/markdown', size: 42 }],
    });
  });
});
