import { describe, expect, test } from 'bun:test';
import React from 'react';
import {
  activeLanguagePositionFromEditor,
  openLanguageLocationInEditor,
} from '../src/droneHub/files/editor-language-commands';
import { ReferencesResultsPanel } from '../src/droneHub/files/ReferencesResultsPanel';

function findButtonByTitle(node: any, title: string): any | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.props?.title === title) return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const found = findButtonByTitle(child, title);
    if (found) return found;
  }
  return null;
}

describe('editor language commands', () => {
  test('reads the active Monaco selection position', () => {
    const position = activeLanguagePositionFromEditor(
      {
        getPosition: () => ({ lineNumber: 9, column: 3 }),
        getSelection: () => ({
          getStartPosition: () => ({ lineNumber: 4, column: 12 }),
        }),
      },
      '/work/repo/src/index.ts',
    );

    expect(position).toEqual({ path: '/work/repo/src/index.ts', line: 4, column: 12 });
  });

  test('opens language locations through the editor open-file callback', () => {
    const opened: any[] = [];
    openLanguageLocationInEditor(
      {
        path: '/work/repo/src/defs.ts',
        line: 7,
        column: 5,
      },
      (next) => opened.push(next),
    );

    expect(opened).toEqual([
      { path: '/work/repo/src/defs.ts', name: 'defs.ts', line: 7, column: 5 },
    ]);
  });

  test('references panel opens selected references through its callback', () => {
    const opened: any[] = [];
    const element = ReferencesResultsPanel({
      state: {
        open: true,
        loading: false,
        error: null,
        truncated: false,
        references: [
          {
            path: '/work/repo/src/defs.ts',
            line: 3,
            column: 11,
            preview: 'export const value = 1;',
          },
        ],
      },
      onOpenReference: (next) => opened.push(next),
      onClose: () => undefined,
    });

    const button = findButtonByTitle(element, '/work/repo/src/defs.ts:3:11');
    expect(button).not.toBeNull();
    button.props.onClick();

    expect(opened).toEqual([
      { path: '/work/repo/src/defs.ts', name: 'defs.ts', line: 3, column: 11 },
    ]);
  });
});
