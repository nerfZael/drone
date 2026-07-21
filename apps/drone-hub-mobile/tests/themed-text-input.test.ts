import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const sourceRoot = new URL('../src/', import.meta.url);
const componentPath = 'components/ThemedTextInput.tsx';

function sourceFilesUsing(pattern: RegExp): string[] {
  return Array.from(new Bun.Glob('**/*.tsx').scanSync({ cwd: sourceRoot.pathname }))
    .filter((path) => pattern.test(readFileSync(new URL(path, sourceRoot), 'utf8')))
    .sort();
}

describe('mobile themed text input boundary', () => {
  test('keeps native text inputs behind the shared themed component', () => {
    expect(sourceFilesUsing(/<TextInput(?:\s|\/)/)).toEqual([componentPath]);
  });

  test('owns cursor and selection defaults in one place', () => {
    expect(sourceFilesUsing(/\b(?:cursorColor|selectionColor)=/)).toEqual([componentPath]);
  });
});
