import { describe, expect, test } from 'bun:test';

import { companionTextareaUndoValue } from '../src/droneHub/chat/companion-textarea-undo';

describe('Companion textarea undo', () => {
  test('restores the exact value from before the patch in one step', () => {
    const snapshot = {
      before: 'User text',
      after: 'User text\nCompanion addition',
      afterRevision: '2',
    };
    expect(companionTextareaUndoValue(snapshot, snapshot.after, '2')).toBe(snapshot.before);
  });

  test('does not overwrite typing made after the Companion patch', () => {
    const snapshot = { before: 'Before', after: 'After patch', afterRevision: '2' };
    expect(companionTextareaUndoValue(snapshot, 'After patch plus user typing', '3')).toBeNull();
  });

  test('does not overwrite later edits even when their text matches the patched value', () => {
    const snapshot = { before: 'Before', after: 'After patch', afterRevision: '2' };
    expect(companionTextareaUndoValue(snapshot, 'After patch', '4')).toBeNull();
  });

  test('does nothing after the snapshot is cleared', () => {
    expect(companionTextareaUndoValue(null, 'After patch', '2')).toBeNull();
  });
});
