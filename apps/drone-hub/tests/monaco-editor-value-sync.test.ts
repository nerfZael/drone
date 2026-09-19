import { describe, expect, test } from 'bun:test';
import {
  MonacoEditorValueSynchronizer,
  replaceMonacoEditorValue,
} from '../src/droneHub/files/monaco-editor-value-sync';

describe('MonacoEditorValueSynchronizer', () => {
  test('ignores an older React echo after Monaco has accepted a newer keystroke', () => {
    const sync = new MonacoEditorValueSynchronizer();

    sync.recordLocalChange('/repo/file.ts', 'first edit');
    sync.recordLocalChange('/repo/file.ts', 'first edit plus another key');

    expect(
      sync.shouldApplyIncoming(
        '/repo/file.ts',
        'first edit',
        'first edit plus another key',
      ),
    ).toBe(false);
  });

  test('applies content that did not originate from the editor', () => {
    const sync = new MonacoEditorValueSynchronizer();
    sync.recordLocalChange('/repo/file.ts', 'local edit');

    expect(
      sync.shouldApplyIncoming('/repo/file.ts', 'external edit', 'local edit'),
    ).toBe(true);
  });

  test('does not mistake edits from another file for local echoes', () => {
    const sync = new MonacoEditorValueSynchronizer();
    sync.recordLocalChange('/repo/first.ts', 'shared text');

    expect(
      sync.shouldApplyIncoming('/repo/second.ts', 'shared text', 'other text'),
    ).toBe(true);
  });
});

describe('replaceMonacoEditorValue', () => {
  test('restores Monaco view state after replacing external content', () => {
    const calls: string[] = [];
    let content = 'before';
    const viewState = { cursorState: [{ lineNumber: 2, column: 4 }] };
    const editor = {
      getModel: () => ({
        getValue: () => content,
        getFullModelRange: () => ({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 7,
        }),
      }),
      saveViewState: () => {
        calls.push('save');
        return viewState;
      },
      executeEdits: (_source: string, edits: Array<{ text: string }>) => {
        calls.push('edit');
        content = edits[0]?.text ?? '';
        return true;
      },
      pushUndoStop: () => {
        calls.push('undo');
        return true;
      },
      restoreViewState: (state: unknown) => {
        expect(state).toBe(viewState);
        calls.push('restore');
      },
    } as any;

    replaceMonacoEditorValue(editor, 'after');

    expect(content).toBe('after');
    expect(calls).toEqual(['save', 'edit', 'undo', 'restore']);
  });
});
