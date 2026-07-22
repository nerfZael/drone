export type NativeMarkdownInline = {
  type: 'text' | 'strong' | 'emphasis' | 'strike' | 'code' | 'link';
  text: string;
  href?: string;
};

export type NativeMarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'quote'; text: string; callout: string }
  | {
      type: 'list';
      ordered: boolean;
      items: Array<{ text: string; checked: boolean | null }>;
    }
  | { type: 'divider' }
  | { type: 'table'; headers: string[]; rows: string[][] };

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
      blocks.push({ type: 'code', language: fence[1] ?? '', text: content.join('\n') });
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
      index += 1;
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
