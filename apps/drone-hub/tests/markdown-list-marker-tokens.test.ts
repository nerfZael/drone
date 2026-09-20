import { describe, expect, test } from 'bun:test';
// @ts-expect-error Monaco ships this grammar without type declarations.
import { language as markdownLanguage } from 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js';
import {
  MARKDOWN_LIST_MARKER_TOKEN,
  withMarkdownListMarkerToken,
} from '../src/droneHub/files/markdown-list-marker-tokens';
import { DESKTOP_THEMES, desktopMonacoTheme } from '../src/theme';

type Rule = [RegExp, unknown];

describe('markdown list marker tokens', () => {
  test("splits list markers from headings in Monaco's own grammar", () => {
    const patched = withMarkdownListMarkerToken(markdownLanguage);
    const markerRules = (patched.tokenizer.root as Rule[]).filter(
      (rule) => Array.isArray(rule) && rule[1] === MARKDOWN_LIST_MARKER_TOKEN,
    );
    expect(markerRules).toHaveLength(1);
    expect(markerRules[0][0].test('1. first')).toBe(true);
    expect(markerRules[0][0].test('- bullet')).toBe(true);
    expect(markerRules[0][0].test('# Heading')).toBe(false);
    // Everything else, headings included, is the grammar Monaco shipped.
    expect(patched.tokenizer.root).toHaveLength(markdownLanguage.tokenizer.root.length);
    expect(markdownLanguage.tokenizer.root.some((rule: Rule) => rule[1] === MARKDOWN_LIST_MARKER_TOKEN)).toBe(false);
  });

  test('themes colour list markers without the heading weight', () => {
    for (const theme of DESKTOP_THEMES) {
      const { rules } = desktopMonacoTheme(theme.id).definition;
      const marker = rules.find((rule) => rule.token === `${MARKDOWN_LIST_MARKER_TOKEN}.md`);
      expect(marker?.foreground).toBeTruthy();
      expect(marker?.fontStyle).toBeUndefined();
      expect(rules.find((rule) => rule.token === 'keyword.md')?.fontStyle).toBe('bold');
    }
  });
});
