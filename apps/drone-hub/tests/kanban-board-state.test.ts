import { describe, expect, test } from 'bun:test';
import {
  cardMatchesKanbanScope,
  createDefaultKanbanBoardState,
  moveKanbanCard,
  parsePastedKanbanCard,
  resolveKanbanCardScope,
  sanitizeKanbanBoardState,
} from '../src/droneHub/app/kanban-board-state';

describe('kanban board state helpers', () => {
  test('creates a default board with the standard workflow lanes', () => {
    const board = createDefaultKanbanBoardState();
    expect(board.lanes.map((lane) => lane.title)).toEqual(['To do', 'In progress', 'Review', 'Done']);
    expect(board.lanes.every((lane) => lane.cards.length === 0)).toBe(true);
  });

  test('sanitizes invalid persisted state and preserves valid cards', () => {
    const board = sanitizeKanbanBoardState({
      lanes: [
        null,
        {
          title: ' Backlog ',
          cards: [
            { title: ' Wire board mode ', description: 'Add workspace routing.', repoPath: '/tmp/repo-a' },
            { id: 'task-2', title: ' polish ', description: 42 },
          ],
        },
      ],
    });

    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0]?.title).toBe('Backlog');
    expect(board.lanes[0]?.cards).toEqual([
      expect.objectContaining({
        title: 'Wire board mode',
        description: 'Add workspace routing.',
        repoPath: '/tmp/repo-a',
      }),
      expect.objectContaining({
        id: 'task-2',
        title: 'polish',
        description: '42',
      }),
    ]);
  });

  test('parses pasted text into title and description', () => {
    expect(parsePastedKanbanCard('Fix flaky test')).toEqual({
      title: 'Fix flaky test',
      description: '',
      needsGeneratedTitle: false,
    });

    expect(
      parsePastedKanbanCard(`
        Refactor task board header

        Reuse the agent and repo controls from draft chat.
        Keep the model override inline.
      `),
    ).toEqual({
      title: 'Refactor task board header',
      description: 'Refactor task board header\n\nReuse the agent and repo controls from draft chat.\nKeep the model override inline.',
      needsGeneratedTitle: true,
    });

    expect(parsePastedKanbanCard('')).toBeNull();
  });

  test('moves cards within and across lanes', () => {
    const board = sanitizeKanbanBoardState({
      lanes: [
        {
          id: 'todo',
          title: 'To do',
          cards: [
            { id: 'a', title: 'A', description: '' },
            { id: 'b', title: 'B', description: '' },
          ],
        },
        {
          id: 'review',
          title: 'Review',
          cards: [{ id: 'c', title: 'C', description: '' }],
        },
      ],
    });

    const reordered = moveKanbanCard(board, {
      cardId: 'b',
      fromLaneId: 'todo',
      toLaneId: 'todo',
      toIndex: 0,
    });
    expect(reordered.lanes[0]?.cards.map((card) => card.id)).toEqual(['b', 'a']);

    const movedAcross = moveKanbanCard(reordered, {
      cardId: 'a',
      fromLaneId: 'todo',
      toLaneId: 'review',
      toIndex: 1,
    });
    expect(movedAcross.lanes[0]?.cards.map((card) => card.id)).toEqual(['b']);
    expect(movedAcross.lanes[1]?.cards.map((card) => card.id)).toEqual(['c', 'a']);
  });

  test('maps legacy repo cards to repo scope and empty cards to global scope', () => {
    const board = sanitizeKanbanBoardState({
      lanes: [
        {
          id: 'lane-1',
          title: 'To do',
          cards: [
            { id: 'repo-task', title: 'Repo task', description: '', repoPath: '/tmp/repo-a' },
            { id: 'global-task', title: 'Global task', description: '' },
          ],
        },
      ],
    });

    expect(resolveKanbanCardScope(board.lanes[0]!.cards[0]!)).toEqual({
      scopeType: 'repo',
      scopeValue: '/tmp/repo-a',
    });
    expect(resolveKanbanCardScope(board.lanes[0]!.cards[1]!)).toEqual({
      scopeType: 'global',
      scopeValue: '',
    });
  });

  test('matches cards against scoped board selections', () => {
    expect(
      cardMatchesKanbanScope(
        { id: 'task-1', title: 'Repo task', description: '', typeId: 'idea', repoPath: '/tmp/repo-a' },
        { scopeType: 'repo', scopeValue: '/tmp/repo-a' },
      ),
    ).toBe(true);
    expect(
      cardMatchesKanbanScope(
        { id: 'task-2', title: 'Group task', description: '', typeId: 'idea', scopeType: 'group', scopeValue: 'feature-x' },
        { scopeType: 'group', scopeValue: 'feature-x' },
      ),
    ).toBe(true);
    expect(
      cardMatchesKanbanScope(
        { id: 'task-3', title: 'Other group', description: '', typeId: 'idea', scopeType: 'group', scopeValue: 'feature-y' },
        { scopeType: 'group', scopeValue: 'feature-x' },
      ),
    ).toBe(false);
  });
});
