import { describe, expect, test } from 'bun:test';
import { removeScopedTaskFromBoard } from '../src/hub/task-board';

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
});
