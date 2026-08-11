import { describe, expect, test } from 'bun:test';
import {
  appendSidebarOptimisticCommand,
  createSidebarOptimisticJournal,
  replaceSidebarConfirmedState,
  settleSidebarOptimisticCommand,
  sidebarOptimisticJournalValue,
} from '../src/sidebar';

type Command = { amount: number };
const apply = (value: number, command: Command) => value + command.amount;

describe('sidebar optimistic journal', () => {
  test('replays every pending command immediately in insertion order', () => {
    let journal = createSidebarOptimisticJournal<number, Command>(10);
    journal = appendSidebarOptimisticCommand(journal, { id: 'first', command: { amount: 2 } });
    journal = appendSidebarOptimisticCommand(journal, { id: 'second', command: { amount: 5 } });
    expect(sidebarOptimisticJournalValue(journal, apply)).toBe(17);
  });

  test('rebases newer commands over an acknowledged server snapshot', () => {
    let journal = createSidebarOptimisticJournal<number, Command>(10);
    journal = appendSidebarOptimisticCommand(journal, { id: 'first', command: { amount: 2 } });
    journal = appendSidebarOptimisticCommand(journal, { id: 'second', command: { amount: 5 } });
    journal = settleSidebarOptimisticCommand(journal, 'first', 12);
    expect(sidebarOptimisticJournalValue(journal, apply)).toBe(17);
  });

  test('rejects only one command and retains newer changes', () => {
    let journal = createSidebarOptimisticJournal<number, Command>(10);
    journal = appendSidebarOptimisticCommand(journal, { id: 'first', command: { amount: 2 } });
    journal = appendSidebarOptimisticCommand(journal, { id: 'second', command: { amount: 5 } });
    journal = settleSidebarOptimisticCommand(journal, 'first');
    expect(sidebarOptimisticJournalValue(journal, apply)).toBe(15);
  });

  test('replays pending commands over registry refreshes', () => {
    let journal = createSidebarOptimisticJournal<number, Command>(10);
    journal = appendSidebarOptimisticCommand(journal, { id: 'pending', command: { amount: 5 } });
    journal = replaceSidebarConfirmedState(journal, 20);
    expect(sidebarOptimisticJournalValue(journal, apply)).toBe(25);
  });
});
