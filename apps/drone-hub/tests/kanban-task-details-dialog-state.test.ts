import { describe, expect, test } from 'bun:test';
import {
  KANBAN_TASK_UNTITLED_FALLBACK,
  normalizeKanbanTaskTitleDraft,
  resolveCommittedKanbanTaskTitle,
} from '../src/droneHub/app/kanban-task-details-dialog-state';

describe('kanban task details dialog state', () => {
  test('preserves interior spacing semantics while normalizing committed titles', () => {
    expect(normalizeKanbanTaskTitleDraft('Ship   task board   polish')).toBe('Ship task board polish');
    expect(normalizeKanbanTaskTitleDraft('  Fix popup close on drag\n\nextra notes')).toBe('Fix popup close on drag');
  });

  test('keeps the previous saved title when a draft is cleared', () => {
    expect(resolveCommittedKanbanTaskTitle('', 'Existing title')).toBe('Existing title');
    expect(resolveCommittedKanbanTaskTitle('   ', 'Existing title')).toBe('Existing title');
  });

  test('falls back to an untitled label when both draft and prior title are empty', () => {
    expect(resolveCommittedKanbanTaskTitle('', '')).toBe(KANBAN_TASK_UNTITLED_FALLBACK);
  });
});
