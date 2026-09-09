import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import path from 'node:path';

// Guards for the Tailwind + CSS-token styling conventions in this app.
//
// 1. Font sizes must use the named utilities registered in tailwind.config.ts
//    (`text-11`, `text-caption`, ...). Tailwind cannot tell whether an
//    arbitrary `text-[var(--x)]` is a size or a color, and emits a `color:`
//    rule for it, so the size never applies and any real color class on the
//    same element is overridden.
// 2. Every `var(--token)` referenced by a component must be defined somewhere,
//    otherwise the declaration silently resolves to nothing.

const appRoot = path.resolve(import.meta.dir, '..');

type Source = { file: string; text: string };

async function readSources(patterns: string[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const pattern of patterns) {
    for await (const rel of new Glob(pattern).scan({ cwd: appRoot, onlyFiles: true })) {
      const file = path.join(appRoot, rel);
      out.push({ file: rel, text: await Bun.file(file).text() });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

const SIZE_TOKEN = String.raw`(?:text-[0-9][0-9-]*|type-[a-z]+|[a-z-]+-size)`;
const AMBIGUOUS_TEXT_SIZE = new RegExp(String.raw`\btext-\[(?:length:)?var\(--${SIZE_TOKEN}\)\]`, 'g');

describe('style tokens', () => {
  test('font sizes use the named Tailwind utilities, not arbitrary var() values', async () => {
    const sources = await readSources(['src/**/*.tsx', 'src/**/*.ts']);
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      for (const match of text.matchAll(AMBIGUOUS_TEXT_SIZE)) {
        offenders.push(`${file}:${lineOf(text, match.index ?? 0)} ${match[0]}`);
      }
    }
    expect(
      offenders,
      'Use text-11 / text-caption etc. (see fontSize in tailwind.config.ts) instead of text-[var(--…)]',
    ).toEqual([]);
  });

  test('every CSS variable referenced by components is defined', async () => {
    const css = await readSources(['src/**/*.css']);
    const code = await readSources(['src/**/*.tsx', 'src/**/*.ts', 'tailwind.config.ts']);

    const defined = new Set<string>();
    for (const { text } of css) {
      for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(match[1]);
    }
    // Tokens set from code: inline `style={{ '--x': … }}` keys and setProperty calls.
    for (const { text } of code) {
      for (const match of text.matchAll(/['"`](--[a-z0-9-]+)['"`]\s*[:,)]/gi)) defined.add(match[1]);
    }

    const missing = new Map<string, string[]>();
    for (const { file, text } of code) {
      for (const match of text.matchAll(/var\((--[a-z0-9-]+)\)/gi)) {
        const token = match[1];
        if (token.startsWith('--tw-') || defined.has(token)) continue;
        const list = missing.get(token) ?? [];
        if (list.length < 3) list.push(`${file}:${lineOf(text, match.index ?? 0)}`);
        missing.set(token, list);
      }
    }
    expect(
      [...missing.entries()].map(([token, where]) => `${token} <- ${where.join(', ')}`),
      'Define the token in src/styles.css or fix the reference',
    ).toEqual([]);
  });
});
