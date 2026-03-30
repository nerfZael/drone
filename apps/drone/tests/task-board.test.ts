import { describe, expect, test } from 'bun:test';
import {
  listScopedTasksForDroneScope,
  removeScopedTaskFromBoard,
  removeTasksForScope,
  renameTasksForScope,
  sanitizeTaskBoardState,
} from '../src/hub/task-board';

describe('task board helpers', () => {
  test('removes only the matching scoped task', () => {
    const board = {
      taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            {
              id: 'task-1',
              title: 'Delete me',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-a',
              playbookId: 'playbook-a',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:00:00.000Z',
            },
            {
              id: 'task-1',
              title: 'Keep me',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-b',
              playbookId: 'playbook-b',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:00:00.000Z',
            },
          ],
        },
      ],
    };

    const removed = removeScopedTaskFromBoard(board, 'task-1', 'playbook-a', '/tmp/repo-a');

    expect(removed.removed).toBe(true);
    expect(removed.board.lanes[0]?.cards).toMatchObject([
      {
        id: 'task-1',
        title: 'Keep me',
        playbookId: 'playbook-b',
        repoPath: '/tmp/repo-b',
      },
    ]);
  });

  test('lists repo-scoped tasks when no playbook scope is provided', () => {
    const board = {
      taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            {
              id: 'task-1',
              title: 'Repo bug',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-a',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:00:00.000Z',
            },
            {
              id: 'task-2',
              title: 'Playbook bug',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-a',
              playbookId: 'playbook-a',
              createdAt: '2026-03-25T01:00:00.000Z',
              updatedAt: '2026-03-25T01:00:00.000Z',
            },
            {
              id: 'task-3',
              title: 'Other repo bug',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-b',
              createdAt: '2026-03-25T02:00:00.000Z',
              updatedAt: '2026-03-25T02:00:00.000Z',
            },
            {
              id: 'task-4',
              title: 'Group bug',
              description: '',
              typeId: 'bug',
              scopeType: 'group',
              scopeValue: 'feature-a',
              repoPath: '/tmp/repo-a',
              createdAt: '2026-03-25T03:00:00.000Z',
              updatedAt: '2026-03-25T03:00:00.000Z',
            },
          ],
        },
      ],
    };

    const tasks = listScopedTasksForDroneScope(board, '/tmp/repo-a');

    expect(tasks.map((task) => task.id)).toEqual(['task-2', 'task-1']);
  });

  test('lists only global tasks for no-repo drones', () => {
    const board = {
      taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            {
              id: 'task-1',
              title: 'Global task',
              description: '',
              typeId: 'bug',
              scopeType: 'global',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:00:00.000Z',
            },
            {
              id: 'task-2',
              title: 'Drone task',
              description: '',
              typeId: 'bug',
              scopeType: 'drone',
              scopeValue: 'drone-1',
              createdAt: '2026-03-25T01:00:00.000Z',
              updatedAt: '2026-03-25T01:00:00.000Z',
            },
          ],
        },
      ],
    };

    const tasks = listScopedTasksForDroneScope(board, '');

    expect(tasks.map((task) => task.id)).toEqual(['task-1']);
  });

  test('removes the matching repo-scoped task when no playbook scope is provided', () => {
    const board = {
      taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            {
              id: 'task-1',
              title: 'Delete me',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-a',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:00:00.000Z',
            },
            {
              id: 'task-1',
              title: 'Keep me',
              description: '',
              typeId: 'bug',
              repoPath: '/tmp/repo-b',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:00:00.000Z',
            },
          ],
        },
      ],
    };

    const removed = removeScopedTaskFromBoard(board, 'task-1', '', '/tmp/repo-a');

    expect(removed.removed).toBe(true);
    expect(removed.board.lanes[0]?.cards).toMatchObject([
      {
        id: 'task-1',
        title: 'Keep me',
        repoPath: '/tmp/repo-b',
      },
    ]);
  });

  test('assigns legacy cards to repo or global scopes during sanitization', () => {
    const board = sanitizeTaskBoardState({
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            { id: 'repo-task', title: 'Repo task', description: '', typeId: 'bug', repoPath: '/tmp/repo-a' },
            { id: 'global-task', title: 'Global task', description: '', typeId: 'bug' },
          ],
        },
      ],
    });

    expect(board.lanes[0]?.cards[0]).toMatchObject({
      id: 'repo-task',
      scopeType: 'repo',
      scopeValue: '/tmp/repo-a',
      repoPath: '/tmp/repo-a',
    });
    expect(board.lanes[0]?.cards[1]).toMatchObject({
      id: 'global-task',
      scopeType: 'global',
    });
  });

  test('normalizes repo-scoped cards to their board repo during sanitization', () => {
    const board = sanitizeTaskBoardState({
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            {
              id: 'repo-task',
              title: 'Repo task',
              description: '',
              typeId: 'bug',
              scopeType: 'repo',
              scopeValue: '/tmp/repo-a',
              repoPath: '/tmp/stale-repo',
            },
          ],
        },
      ],
    });

    expect(board.lanes[0]?.cards[0]).toMatchObject({
      id: 'repo-task',
      scopeType: 'repo',
      scopeValue: '/tmp/repo-a',
      repoPath: '/tmp/repo-a',
    });
  });

  test('removes all tasks for a deleted scope', () => {
    const board = sanitizeTaskBoardState({
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            { id: 'group-a', title: 'Group A', description: '', typeId: 'bug', scopeType: 'group', scopeValue: 'alpha' },
            { id: 'group-b', title: 'Group B', description: '', typeId: 'bug', scopeType: 'group', scopeValue: 'beta' },
          ],
        },
      ],
    });

    const removed = removeTasksForScope(board, 'group', 'alpha');

    expect(removed.removedCount).toBe(1);
    expect(removed.board.lanes[0]?.cards.map((card) => card.id)).toEqual(['group-b']);
  });

  test('renames all tasks for a renamed group scope', () => {
    const board = sanitizeTaskBoardState({
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            { id: 'group-a', title: 'Group A', description: '', typeId: 'bug', scopeType: 'group', scopeValue: 'alpha' },
            { id: 'group-b', title: 'Group B', description: '', typeId: 'bug', scopeType: 'group', scopeValue: 'beta' },
          ],
        },
      ],
    });

    const renamed = renameTasksForScope(board, 'group', 'alpha', 'gamma');

    expect(renamed.renamedCount).toBe(1);
    expect(renamed.board.lanes[0]?.cards[0]).toMatchObject({
      id: 'group-a',
      scopeType: 'group',
      scopeValue: 'gamma',
    });
  });
});
