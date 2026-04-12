export type ParseResult = {
  value: unknown;
  nextIndex: number;
};

export type ExtractedLiteralRange<T> = {
  start: number;
  end: number;
  items: T[];
};

type TextRange = {
  start: number;
  end: number;
};

export class MessageLiteralParser {
  private readonly text: string;
  private index: number;

  constructor(text: string, startIndex = 0) {
    this.text = text;
    this.index = startIndex;
  }

  parseRoot(): ParseResult | null {
    this.skipWhitespace();
    const value = this.parseValue();
    if (value == null) return null;
    this.skipWhitespace();
    if (this.peek() === ';') {
      this.index += 1;
      this.skipWhitespace();
    }
    return {
      value,
      nextIndex: this.index,
    };
  }

  private parseValue(): unknown | null {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === '\'' || ch === '`') return this.parseString();
    if (ch === '-' || this.isDigit(ch)) return this.parseNumber();
    if (this.isIdentifierStart(ch)) {
      const ident = this.parseIdentifier();
      if (ident === 'true') return true;
      if (ident === 'false') return false;
      if (ident === 'null') return null;
      return ident;
    }
    return null;
  }

  private parseObject(): Record<string, unknown> | null {
    if (this.peek() !== '{') return null;
    this.index += 1;
    const out: Record<string, unknown> = {};
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.index += 1;
      return out;
    }
    while (this.index < this.text.length) {
      this.skipWhitespace();
      const key = this.parseObjectKey();
      if (!key) return null;
      this.skipWhitespace();
      if (this.peek() !== ':') return null;
      this.index += 1;
      const value = this.parseValue();
      if (value == null && this.peek(-1) !== 'l') return null;
      out[key] = value;
      this.skipWhitespace();
      const next = this.peek();
      if (next === ',') {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === '}') {
          this.index += 1;
          return out;
        }
        continue;
      }
      if (next === '}') {
        this.index += 1;
        return out;
      }
      return null;
    }
    return null;
  }

  private parseArray(): unknown[] | null {
    if (this.peek() !== '[') return null;
    this.index += 1;
    const out: unknown[] = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.index += 1;
      return out;
    }
    while (this.index < this.text.length) {
      const value = this.parseValue();
      if (value == null && this.peek(-1) !== 'l') return null;
      out.push(value);
      this.skipWhitespace();
      const next = this.peek();
      if (next === ',') {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === ']') {
          this.index += 1;
          return out;
        }
        continue;
      }
      if (next === ']') {
        this.index += 1;
        return out;
      }
      return null;
    }
    return null;
  }

  private parseObjectKey(): string | null {
    const ch = this.peek();
    if (ch === '"' || ch === '\'' || ch === '`') {
      const value = this.parseString();
      return typeof value === 'string' ? value : null;
    }
    if (!this.isIdentifierStart(ch)) return null;
    return this.parseIdentifier();
  }

  private parseString(): string | null {
    const quote = this.peek();
    if (quote !== '"' && quote !== '\'' && quote !== '`') return null;
    this.index += 1;
    let out = '';
    while (this.index < this.text.length) {
      const ch = this.text[this.index];
      this.index += 1;
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      if (this.index >= this.text.length) return null;
      const esc = this.text[this.index];
      this.index += 1;
      if (esc === 'n') out += '\n';
      else if (esc === 'r') out += '\r';
      else if (esc === 't') out += '\t';
      else if (esc === '\\') out += '\\';
      else if (esc === '\'' || esc === '"' || esc === '`') out += esc;
      else out += esc;
    }
    return null;
  }

  private parseNumber(): number | null {
    const start = this.index;
    if (this.peek() === '-') this.index += 1;
    let sawDigit = false;
    while (this.isDigit(this.peek())) {
      sawDigit = true;
      this.index += 1;
    }
    if (this.peek() === '.') {
      this.index += 1;
      while (this.isDigit(this.peek())) {
        sawDigit = true;
        this.index += 1;
      }
    }
    if (!sawDigit) return null;
    const raw = this.text.slice(start, this.index);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseIdentifier(): string {
    const start = this.index;
    this.index += 1;
    while (this.isIdentifierPart(this.peek())) this.index += 1;
    return this.text.slice(start, this.index);
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index] ?? '')) this.index += 1;
  }

  private peek(offset = 0): string {
    const idx = this.index + offset;
    return idx >= 0 && idx < this.text.length ? this.text[idx] ?? '' : '';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isIdentifierStart(ch: string): boolean {
    return /[A-Za-z_$]/.test(ch);
  }

  private isIdentifierPart(ch: string): boolean {
    return /[A-Za-z0-9_$-]/.test(ch);
  }
}

function hasOverlap<T>(ranges: ExtractedLiteralRange<T>[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function hasTextRangeOverlap(ranges: TextRange[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

export function isBoundaryChar(ch: string, side: 'left' | 'right'): boolean {
  if (!ch) return true;
  if (/\s/.test(ch)) return true;
  return side === 'left' ? /[([{:>,;"'`-]/.test(ch) : /[\])}:<,.;!?"'`-]/.test(ch);
}

export function cleanupMessageAfterLiteralRemoval(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractStructuredMessageItems<T>(opts: {
  text: string;
  tryParseLiteral: (text: string) => T[] | null;
  tryParseLiteralAt: (text: string, startIndex: number) => ExtractedLiteralRange<T> | null;
}): {
  cleanedText: string;
  items: T[];
} {
  const text = String(opts.text ?? '');
  if (!text.trim()) return { cleanedText: '', items: [] };

  const ranges: ExtractedLiteralRange<T>[] = [];
  const fenceRanges: TextRange[] = [];
  const fencePattern = /```[^\n`]*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(fencePattern)) {
    const full = String(match[0] ?? '');
    const body = String(match[1] ?? '').trim();
    if (!full || !body) continue;
    const start = match.index ?? -1;
    const end = start + full.length;
    if (start < 0) continue;
    fenceRanges.push({ start, end });
    const items = opts.tryParseLiteral(body);
    if (!items || items.length === 0) continue;
    if (hasOverlap(ranges, start, end)) continue;
    ranges.push({ start, end, items });
  }

  const inlineCodePattern = /`([^`\n]+)`/g;
  for (const match of text.matchAll(inlineCodePattern)) {
    const full = String(match[0] ?? '');
    const body = String(match[1] ?? '').trim();
    if (!full || !body) continue;
    const start = match.index ?? -1;
    const end = start + full.length;
    if (start < 0 || hasTextRangeOverlap(fenceRanges, start, end)) continue;
    const items = opts.tryParseLiteral(body);
    if (!items || items.length === 0) continue;
    if (hasOverlap(ranges, start, end)) continue;
    ranges.push({ start, end, items });
  }

  for (let index = 0; index < text.length; index += 1) {
    if (hasOverlap(ranges, index, index + 1)) continue;
    if (hasTextRangeOverlap(fenceRanges, index, index + 1)) continue;
    const ch = text[index] ?? '';
    if (ch !== '{' && ch !== '[') continue;
    const parsed = opts.tryParseLiteralAt(text, index);
    if (!parsed) continue;
    if (hasOverlap(ranges, parsed.start, parsed.end)) continue;
    const prev = parsed.start > 0 ? text[parsed.start - 1] ?? '' : '';
    const next = parsed.end < text.length ? text[parsed.end] ?? '' : '';
    if (!isBoundaryChar(prev, 'left') || !isBoundaryChar(next, 'right')) continue;
    ranges.push(parsed);
    index = Math.max(index, parsed.end - 1);
  }

  if (ranges.length === 0) return { cleanedText: text.trim(), items: [] };

  ranges.sort((left, right) => left.start - right.start);
  const items = ranges.flatMap((range) => range.items);
  let cursor = 0;
  let cleaned = '';
  for (const range of ranges) {
    if (range.start > cursor) cleaned += text.slice(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) cleaned += text.slice(cursor);

  return {
    cleanedText: cleanupMessageAfterLiteralRemoval(cleaned),
    items,
  };
}
