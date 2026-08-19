export type MarkdownOutlineSection = {
  id: string;
  level: number;
  title: string;
  content: string;
  headingStartLine: number;
  headingEndLine: number;
  contentStartLine: number;
  children: MarkdownOutlineSection[];
};

export type MarkdownOutline = {
  preamble: string;
  preambleStartLine: number;
  sections: MarkdownOutlineSection[];
  sectionIds: string[];
};

type HeadingMatch = {
  line: number;
  endLine: number;
  level: number;
  title: string;
};

function trimSectionContent(
  lines: string[],
  sourceStartIndex: number,
): { text: string; startLine: number } {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) start += 1;
  while (end > start && !lines[end - 1]?.trim()) end -= 1;
  return {
    text: lines.slice(start, end).join('\n'),
    startLine: sourceStartIndex + start + 1,
  };
}

function atxHeading(line: string): Pick<HeadingMatch, 'level' | 'title'> | null {
  const match = /^ {0,3}(#{1,6})(?:[\t ]+|$)(.*)$/.exec(line);
  if (!match) return null;
  const title = String(match[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '').trim();
  return { level: String(match[1]).length, title };
}

function setextLevel(line: string): 1 | 2 | null {
  const match = /^ {0,3}(=+|-+)[\t ]*$/.exec(line);
  if (!match) return null;
  return String(match[1]).startsWith('=') ? 1 : 2;
}

function fenceMarker(line: string): { marker: '`' | '~'; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  const run = String(match[1]);
  return { marker: run[0] as '`' | '~', length: run.length };
}

function closesFence(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const escapedMarker = fence.marker === '`' ? '`' : '~';
  const match = new RegExp(`^ {0,3}(${escapedMarker}{${fence.length},})[\\t ]*$`).exec(line);
  return Boolean(match);
}

function findHeadings(lines: string[]): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const marker = fenceMarker(line);
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }

    const atx = atxHeading(line);
    if (atx) {
      headings.push({ line: lineIndex, endLine: lineIndex, ...atx });
      continue;
    }

    const level = setextLevel(lines[lineIndex + 1] ?? '');
    if (!level || !line.trim() || /^ {0,3}>/.test(line)) continue;
    headings.push({
      line: lineIndex,
      endLine: lineIndex + 1,
      level,
      title: line.trim(),
    });
    lineIndex += 1;
  }

  return headings;
}

function stableHeadingId(
  heading: Pick<HeadingMatch, 'level' | 'title'>,
  occurrences: Map<string, number>,
): string {
  const identity = `${heading.level}:${heading.title.trim().toLocaleLowerCase()}`;
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

export function parseMarkdownOutline(rawText: string): MarkdownOutline {
  const lines = String(rawText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const headings = findHeadings(lines);
  if (headings.length === 0) {
    const preamble = trimSectionContent(lines, 0);
    return {
      preamble: preamble.text,
      preambleStartLine: preamble.startLine,
      sections: [],
      sectionIds: [],
    };
  }

  const preamble = trimSectionContent(lines.slice(0, headings[0]?.line ?? 0), 0);
  const roots: MarkdownOutlineSection[] = [];
  const stack: MarkdownOutlineSection[] = [];
  const sectionIds: string[] = [];
  const headingOccurrences = new Map<string, number>();

  headings.forEach((heading, index) => {
    const nextHeading = headings[index + 1];
    const id = stableHeadingId(heading, headingOccurrences);
    const contentSourceStart = heading.endLine + 1;
    const content = trimSectionContent(
      lines.slice(contentSourceStart, nextHeading?.line ?? lines.length),
      contentSourceStart,
    );
    const section: MarkdownOutlineSection = {
      id,
      level: heading.level,
      title: heading.title || 'Untitled heading',
      content: content.text,
      headingStartLine: heading.line + 1,
      headingEndLine: heading.endLine + 1,
      contentStartLine: content.startLine,
      children: [],
    };

    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= section.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(section);
    else roots.push(section);
    stack.push(section);
    sectionIds.push(id);
  });

  return {
    preamble: preamble.text,
    preambleStartLine: preamble.startLine,
    sections: roots,
    sectionIds,
  };
}
