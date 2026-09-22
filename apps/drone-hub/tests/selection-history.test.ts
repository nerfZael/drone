import { describe, expect, test } from 'bun:test';
import type { DroneSummary } from '../src/droneHub/types';
import { isSelectionHistoryEntryAvailable, SelectionHistory } from '../src/droneHub/app/selection-history';
import { cloneDefaultShortcutBindings, migrateNavigationShortcuts } from '../src/droneHub/app/shortcuts';
import { shouldDispatchEditableShortcutAction } from '../src/droneHub/app/lifecycle-effect-helpers';

const a = { droneId: 'one', chatName: 'default' };
const b = { droneId: 'one', chatName: 'review' };
const c = { droneId: 'two', chatName: 'default' };
const available = () => true;

describe('selection history', () => {
  test('goes back and forward across chats and drones without recording traversal', () => {
    const history = new SelectionHistory();
    expect(history.move(-1, available)).toBeNull();
    for (const entry of [a, a, b, c]) history.record(entry);
    expect(history.move(1, available)).toBeNull();
    expect(history.move(-1, available)).toEqual(b);
    history.record(b);
    expect(history.move(-1, available)).toEqual(a);
    expect(history.move(-1, available)).toBeNull();
    expect(history.move(1, available)).toEqual(b);
    history.record(b);
    expect(history.move(1, available)).toEqual(c);
    expect(history.move(1, available)).toBeNull();
  });
  test('new selection after going back clears forward history', () => {
    const history = new SelectionHistory();
    for (const entry of [a, b, c]) history.record(entry);
    history.move(-1, available);
    history.record(a);
    expect(history.move(1, available)).toBeNull();
    expect(history.move(-1, available)).toEqual(b);
  });
  test('skips deleted destinations in both directions and leaves the cursor unchanged at an end', () => {
    const history = new SelectionHistory();
    for (const entry of [a, b, c]) history.record(entry);
    const exists = (entry: typeof a) => entry.chatName !== 'review';
    expect(history.move(-1, exists)).toEqual(a);
    expect(history.move(-1, exists)).toBeNull();
    expect(history.move(1, exists)).toEqual(c);
  });
  test('back from home returns to the last chat', () => {
    const history = new SelectionHistory();
    history.record(a);
    history.record(null);
    expect(history.move(-1, available)).toEqual(a);
    history.record(a);
    expect(history.move(-1, available)).toBeNull();
  });
  test('bounds long histories', () => {
    const history = new SelectionHistory();
    for (let i = 0; i < 250; i++) history.record({ droneId: String(i), chatName: 'default' });
    let count = 0;
    while (history.move(-1, available)) count++;
    expect(count).toBe(199);
  });
});

describe('history shortcuts', () => {
  test('defaults to A/D and frees the old side-chat binding', () => {
    const defaults = cloneDefaultShortcutBindings();
    expect(defaults.navigateBack?.key).toBe('a');
    expect(defaults.navigateForward?.key).toBe('d');
    expect(defaults.toggleSideChatMain).toBeNull();
    const old: Record<string, unknown> = { ...defaults, toggleSideChatMain: defaults.navigateForward };
    delete old.navigateBack;
    delete old.navigateForward;
    expect(migrateNavigationShortcuts(old)).toEqual(defaults);
    expect(migrateNavigationShortcuts(defaults)).toBe(defaults);
  });
  test('preserves custom keys and explicit unbindings', () => {
    const defaults = cloneDefaultShortcutBindings();
    const custom = { ...defaults.navigateBack!, key: 'k' };
    expect(migrateNavigationShortcuts({ toggleSideChatMain: custom, openHome: defaults.navigateBack })).toMatchObject({
      toggleSideChatMain: custom, openHome: defaults.navigateBack, navigateBack: null, navigateForward: defaults.navigateForward,
    });
    const explicit = { navigateBack: null, navigateForward: custom };
    expect(migrateNavigationShortcuts(explicit)).toBe(explicit);
  });
  test('does not navigate while typing', () => {
    for (const matchedActionId of ['navigateBack', 'navigateForward'] as const) {
      expect(shouldDispatchEditableShortcutAction({ matchedActionId,
        targetInPrimaryChatInput: true, targetInCanvasMessageInput: true, targetInAssistantChatInput: true,
      })).toBe(false);
    }
  });
});


describe('history destination availability', () => {
  const drone = (fields: Partial<DroneSummary>) => ({ id: 'one', ...fields } as DroneSummary);

  test('accepts the fallback default chat before a drone has any listed chats', () => {
    expect(isSelectionHistoryEntryAvailable(a, drone({}))).toBe(true);
    expect(isSelectionHistoryEntryAvailable(a, drone({ chats: [] }))).toBe(true);
    expect(isSelectionHistoryEntryAvailable(b, drone({ chats: [] }))).toBe(false);
  });

  test('skips deleted drones and chats, including a removed default chat', () => {
    expect(isSelectionHistoryEntryAvailable(a, undefined)).toBe(false);
    expect(isSelectionHistoryEntryAvailable(a, drone({ chats: ['review'] }))).toBe(false);
    expect(isSelectionHistoryEntryAvailable(b, drone({ chats: ['default'] }))).toBe(false);
    expect(isSelectionHistoryEntryAvailable(b, drone({ chats: ['review'] }))).toBe(true);
  });

  test('retains destinations for workflow and floating chats', () => {
    expect(isSelectionHistoryEntryAvailable(b, drone({ workflowChats: ['review'] }))).toBe(true);
    expect(isSelectionHistoryEntryAvailable(b, drone({ sideChats: [{ name: 'review' }] as DroneSummary['sideChats'] }))).toBe(true);
  });
});
