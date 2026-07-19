import { describe, expect, test } from 'bun:test';
import {
  parseMobileFileReference,
  splitMobileFileReferences,
} from '../src/local-assistant/file-reference';

describe('mobile file references', () => {
  test('parses relative, absolute, and line-addressed paths', () => {
    expect(parseMobileFileReference('src/screens/DronesScreen.tsx:42:7')).toEqual({
      raw: 'src/screens/DronesScreen.tsx:42:7',
      path: 'src/screens/DronesScreen.tsx',
      line: 42,
      column: 7,
    });
    expect(parseMobileFileReference('/work/repo/README.md#L12')).toEqual({
      raw: '/work/repo/README.md#L12',
      path: '/work/repo/README.md',
      line: 12,
      column: null,
    });
    expect(parseMobileFileReference('AGENTS.md')).toMatchObject({ path: 'AGENTS.md' });
  });

  test('rejects links, parent traversal, and ordinary words', () => {
    expect(parseMobileFileReference('https://example.com/file.ts')).toBeNull();
    expect(parseMobileFileReference('vscode://file/work/repo/file.ts')).toBeNull();
    expect(parseMobileFileReference('../secret.txt')).toBeNull();
    expect(parseMobileFileReference('preview')).toBeNull();
    expect(
      splitMobileFileReferences('Using version 1.2.3 from dev@example.com.').some(
        (segment) => segment.type === 'file',
      ),
    ).toBe(false);
    expect(
      splitMobileFileReferences(
        'Open vscode://file/work/repo/src/App.tsx in the desktop app.',
      ).some((segment) => segment.type === 'file'),
    ).toBe(false);
  });

  test('finds file references in normal user and agent text without linking URLs', () => {
    expect(
      splitMobileFileReferences(
        'Open src/App.tsx:9, then read AGENTS.md. Keep https://example.com/docs/file.ts unchanged.',
      )
        .filter((segment) => segment.type === 'file')
        .map((segment) => segment.text),
    ).toEqual(['src/App.tsx:9', 'AGENTS.md']);
  });
});
