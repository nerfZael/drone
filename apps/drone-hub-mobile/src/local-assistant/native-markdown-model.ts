export type NativeMarkdownInline = {
  type: 'text' | 'strong' | 'emphasis' | 'strike' | 'code' | 'link';
  text: string;
  href?: string;
};

export type NativeMarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'mermaid'; text: string }
  | { type: 'quote'; text: string; callout: string }
  | {
      type: 'list';
      ordered: boolean;
      items: Array<{ text: string; checked: boolean | null }>;
    }
  | { type: 'divider' }
  | { type: 'table'; headers: string[]; rows: string[][] };

export type NativeMarkdownHeadingBlock = Extract<NativeMarkdownBlock, { type: 'heading' }>;

export type NativeMarkdownSection = {
  id: string;
  heading: NativeMarkdownHeadingBlock;
  content: NativeMarkdownBlock[];
  children: NativeMarkdownSection[];
};

export type NativeMarkdownOutline = {
  preamble: NativeMarkdownBlock[];
  sections: NativeMarkdownSection[];
  sectionIds: string[];
};

function stableNativeHeadingId(
  heading: NativeMarkdownHeadingBlock,
  occurrences: Map<string, number>,
): string {
  const identity = `${heading.level}:${heading.text.trim().toLocaleLowerCase()}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(36);
  const occurrence = (occurrences.get(identity) ?? 0) + 1;
  occurrences.set(identity, occurrence);
  return `heading-${digest}-${occurrence}`;
}

export function buildNativeMarkdownOutline(
  blocks: NativeMarkdownBlock[],
): NativeMarkdownOutline {
  const preamble: NativeMarkdownBlock[] = [];
  const sections: NativeMarkdownSection[] = [];
  const sectionIds: string[] = [];
  const stack: NativeMarkdownSection[] = [];
  let activeSection: NativeMarkdownSection | null = null;
  const headingOccurrences = new Map<string, number>();

  blocks.forEach((block) => {
    if (block.type !== 'heading') {
      if (activeSection) activeSection.content.push(block);
      else preamble.push(block);
      return;
    }

    const section: NativeMarkdownSection = {
      id: stableNativeHeadingId(block, headingOccurrences),
      heading: block,
      content: [],
      children: [],
    };
    while (
      stack.length > 0 &&
      (stack[stack.length - 1]?.heading.level ?? 0) >= block.level
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(section);
    else sections.push(section);
    stack.push(section);
    activeSection = section;
    sectionIds.push(section.id);
  });

  return { preamble, sections, sectionIds };
}

export function nativeMarkdownHasCodeBlock(text: string): boolean {
  return /^\s*```/m.test(String(text ?? ''));
}

const INLINE_PATTERN =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\)|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<]+)/g;

export function parseNativeMarkdownInline(text: string): NativeMarkdownInline[] {
  const source = String(text ?? '');
  const result: NativeMarkdownInline[] = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) result.push({ type: 'text', text: source.slice(cursor, index) });
    if (token.startsWith('`')) {
      result.push({ type: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      result.push({ type: 'strong', text: token.slice(2, -2) });
    } else if (token.startsWith('~~')) {
      result.push({ type: 'strike', text: token.slice(2, -2) });
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      result.push(
        link
          ? { type: 'link', text: link[1]!, href: link[2]!.trim() }
          : { type: 'text', text: token },
      );
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      result.push({ type: 'link', text: token, href: token });
    } else {
      result.push({ type: 'emphasis', text: token.slice(1, -1) });
    }
    cursor = index + token.length;
  }
  if (cursor < source.length) result.push({ type: 'text', text: source.slice(cursor) });
  return result.length > 0 ? result : [{ type: 'text', text: source }];
}

export function nativeMarkdownInlineText(text: string): string {
  return parseNativeMarkdownInline(text).map((token) => token.text).join('');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (!line.trim()) return true;
  if (/^\s*```/.test(line)) return true;
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
  if (line.trim() && /^\s{0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '')) return true;
  if (/^\s{0,3}>/.test(line)) return true;
  if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) return true;
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  return line.includes('|') && isTableDivider(lines[index + 1] ?? '');
}

export function parseNativeMarkdown(text: string): NativeMarkdownBlock[] {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks: NativeMarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*```\s*([^\s`]*)/.exec(line);
    if (fence) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) {
        content.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ?? '';
      const blockText = content.join('\n');
      blocks.push(
        language.trim().toLowerCase() === 'mermaid'
          ? { type: 'mermaid', text: blockText }
          : { type: 'code', language, text: blockText },
      );
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
      index += 1;
      continue;
    }

    const setextHeading = /^\s{0,3}(=+|-+)\s*$/.exec(lines[index + 1] ?? '');
    if (line.trim() && setextHeading) {
      blocks.push({
        type: 'heading',
        level: setextHeading[1]!.startsWith('=') ? 1 : 2,
        text: line.trim(),
      });
      index += 2;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'divider' });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      const quoteText = quote.join('\n').trim();
      const calloutMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(quoteText);
      blocks.push({
        type: 'quote',
        text: calloutMatch ? quoteText.slice(calloutMatch[0].length) : quoteText,
        callout: calloutMatch?.[1]?.toLowerCase() ?? '',
      });
      continue;
    }

    const listMatch = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: Array<{ text: string; checked: boolean | null }> = [];
      while (index < lines.length) {
        const itemMatch = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(lines[index]!);
        if (!itemMatch || Boolean(itemMatch[2]) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.+)$/.exec(itemMatch[3]!);
        items.push({
          text: task?.[2] ?? itemMatch[3]!,
          checked: task ? task[1]!.toLowerCase() === 'x' : null,
        });
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(tableCells(lines[index]!));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}
