import { describe, expect, test } from 'bun:test';
import { loadRegistry } from '../src/host/registry';
import {
  KanbanBoardSettingsConflictError,
  resolveKanbanBoardSettingsResponse,
  upsertStoredKanbanBoardSettings,
} from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

describe('kanban board settings persistence', () => {
  test('returns defaults before anything is stored', async () => {
    await withTempDroneDataDir('drone-kanban-settings-', async () => {
      const resolved = await resolveKanbanBoardSettingsResponse();
      expect(resolved.updatedAt).toBeNull();
      expect(Array.isArray(resolved.kanbanBoard.taskTypes)).toBe(true);
      expect(Array.isArray(resolved.kanbanBoard.lanes)).toBe(true);
      expect(resolved.kanbanBoard.lanes.length).toBeGreaterThan(0);
    });
  });

  test('round-trips board state through canonical settings storage', async () => {
    await withTempDroneDataDir('drone-kanban-settings-', async () => {
      await upsertStoredKanbanBoardSettings({
        taskTypes: [
          { id: 'bug', label: 'Bug', active: true },
          { id: 'feature', label: 'Feature', active: true },
        ],
        lanes: [
          {
            id: 'lane-1',
            title: 'To do',
            cards: [
              {
                id: 'task-1',
                title: 'Stripe checkout trusts client credits',
                description: 'Client-supplied credits can mint arbitrary balance after checkout.',
                typeId: 'bug',
                scopeType: 'repo',
                scopeValue: '/tmp/storyspark',
                repoPath: '/tmp/storyspark',
                playbookId: 'playbook-1',
                playbookLabel: 'Find bug',
                createdAt: '2026-03-25T00:00:00.000Z',
                updatedAt: '2026-03-25T00:00:00.000Z',
              },
            ],
          },
        ],
      });

      const resolved = await resolveKanbanBoardSettingsResponse();
      expect(resolved.updatedAt).not.toBeNull();
      expect(resolved.kanbanBoard.lanes[0]?.cards[0]).toMatchObject({
        id: 'task-1',
        title: 'Stripe checkout trusts client credits',
        typeId: 'bug',
        scopeType: 'repo',
        scopeValue: '/tmp/storyspark',
        playbookId: 'playbook-1',
      });

      expect((await loadRegistry()).settings?.kanbanBoard).toBeUndefined();
    });
  });

  test('rejects stale board writes with a conflict error', async () => {
    await withTempDroneDataDir('drone-kanban-settings-', async () => {
      await upsertStoredKanbanBoardSettings({
        taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
        lanes: [{ id: 'lane-1', title: 'To do', cards: [] }],
      });
      const first = await resolveKanbanBoardSettingsResponse();
      await Bun.sleep(2);

      await upsertStoredKanbanBoardSettings(
        {
          taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
          lanes: [
            {
              id: 'lane-1',
              title: 'To do',
              cards: [
                {
                  id: 'task-2',
                  title: 'Fresh task',
                  description: '',
                  typeId: 'bug',
                  createdAt: '2026-03-25T00:00:00.000Z',
                  updatedAt: '2026-03-25T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        first.updatedAt,
      );

      const staleWrite = upsertStoredKanbanBoardSettings(
        {
          taskTypes: [{ id: 'bug', label: 'Bug', active: true }],
          lanes: [{ id: 'lane-1', title: 'To do', cards: [] }],
        },
        first.updatedAt,
      );

      await expect(staleWrite).rejects.toBeInstanceOf(KanbanBoardSettingsConflictError);
    });
  });
});
