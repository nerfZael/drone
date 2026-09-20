/**
 * Monaco's Markdown grammar gives list markers the same `keyword` token as headings, so a
 * theme cannot keep headings bold without also making every `1.` and `-` bold. This gives
 * the markers a token of their own.
 */
export const MARKDOWN_LIST_MARKER_TOKEN = 'keyword.list';

type MonarchRule = unknown;
type MonarchLanguageLike = { tokenizer: Record<string, MonarchRule[]> };

function isListMarkerRule(rule: MonarchRule): rule is [RegExp, string] {
  return (
    Array.isArray(rule) &&
    rule[0] instanceof RegExp &&
    rule[1] === 'keyword' &&
    rule[0].source.includes('\\d+\\.')
  );
}

export function withMarkdownListMarkerToken<T extends MonarchLanguageLike>(language: T): T {
  const root = language.tokenizer.root;
  if (!Array.isArray(root)) return language;
  return {
    ...language,
    tokenizer: {
      ...language.tokenizer,
      root: root.map((rule) => (isListMarkerRule(rule) ? [rule[0], MARKDOWN_LIST_MARKER_TOKEN] : rule)),
    },
  };
}
