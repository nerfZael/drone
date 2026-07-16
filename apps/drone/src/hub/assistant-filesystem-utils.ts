import path from 'node:path';

import {
  ASSISTANT_BASH_DEFAULT_TIMEOUT_MS,
  ASSISTANT_BASH_MAX_TIMEOUT_MS,
  ASSISTANT_SEARCH_MAX_CONTEXT_LINES,
  bufferLooksBinary,
  extensionLower,
  isLikelyImagePath,
  isLikelyTextMimeType,
  isLikelyVideoPath,
  sortFsEntries,
  type ContainerFsEntry,
} from './filesystem-media';

export function ensureAssistantTextFile(
  pathRaw: string,
  buf: Buffer,
  mimeRaw: string | null,
): void {
  const mime = String(mimeRaw ?? '')
    .trim()
    .toLowerCase();
  if (!isLikelyTextMimeType(mime) || bufferLooksBinary(buf)) {
    throw new Error(`file is not text: ${pathRaw}`);
  }
}

export function normalizeOptionalPositiveLineNumber(
  raw: unknown,
  label: string,
): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

export function normalizeAssistantSearchContext(raw: unknown, label: string): number {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return Math.min(ASSISTANT_SEARCH_MAX_CONTEXT_LINES, n);
}

export function splitTextLinesPreserveEndings(content: string): string[] {
  if (!content) return [];
  const parts = content.split('\n');
  const lineCount = content.endsWith('\n') ? parts.length - 1 : parts.length;
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    lines.push(`${parts[index] ?? ''}${index < parts.length - 1 ? '\n' : ''}`);
  }
  return lines;
}

export function applyAssistantReadLineRange(
  content: string,
  opts: { startLine?: unknown; endLine?: unknown },
): {
  content: string;
  lineRange?: { startLine: number; endLine: number; totalLines: number; returnedLines: number };
} {
  const requested = opts.startLine != null || opts.endLine != null;
  if (!requested) return { content };
  const startLine = normalizeOptionalPositiveLineNumber(opts.startLine, 'startLine') ?? 1;
  const requestedEndLine = normalizeOptionalPositiveLineNumber(opts.endLine, 'endLine');
  if (requestedEndLine != null && startLine > requestedEndLine)
    throw new Error('startLine must be less than or equal to endLine');

  const lines = splitTextLinesPreserveEndings(content);
  const totalLines = lines.length;
  if (totalLines === 0) {
    return {
      content: '',
      lineRange: { startLine: 1, endLine: 0, totalLines: 0, returnedLines: 0 },
    };
  }
  if (startLine > totalLines) throw new Error(`startLine exceeds file line count (${totalLines})`);
  const endLine = Math.min(requestedEndLine ?? totalLines, totalLines);
  const selected = lines.slice(startLine - 1, endLine);
  return {
    content: selected.join(''),
    lineRange: {
      startLine,
      endLine,
      totalLines,
      returnedLines: selected.length,
    },
  };
}

export function clampAssistantBashTimeoutMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return ASSISTANT_BASH_DEFAULT_TIMEOUT_MS;
  return Math.min(ASSISTANT_BASH_MAX_TIMEOUT_MS, Math.max(1000, Math.floor(n)));
}

export function truncateUtf8Bytes(
  textRaw: unknown,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const text = String(textRaw ?? '');
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  return {
    text: `${buf.subarray(0, maxBytes).toString('utf8')}\n[truncated to ${maxBytes} bytes]`,
    truncated: true,
  };
}

export function parseAssistantSearchOutput(
  text: string,
  limit: number,
): Array<{ path: string; line: number | null; text: string }> {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .flatMap((line) => {
      const match = /^(.+?):(\d+):(.*)$/.exec(line);
      if (!match) return [];
      return [
        { path: match[1] ?? '', line: Number(match[2] ?? NaN) || null, text: match[3] ?? '' },
      ];
    });
}

export function parseAssistantSearchContextOutput(
  text: string,
  limit: number,
): Array<{
  path: string;
  line: number | null;
  text: string;
  context: Array<{ line: number; kind: 'before' | 'match' | 'after'; text: string }>;
}> {
  const matches: Array<{
    path: string;
    line: number | null;
    text: string;
    context: Array<{ line: number; kind: 'before' | 'match' | 'after'; text: string }>;
  }> = [];
  const byId = new Map<string, (typeof matches)[number]>();
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    const parts = line.split('\t');
    if (parts[0] === '__MATCH__' && parts.length >= 5) {
      if (matches.length >= limit) continue;
      const id = String(parts[1] ?? '');
      const filePath = Buffer.from(parts[2] ?? '', 'base64').toString('utf8');
      const lineNumber = Number(parts[3] ?? NaN);
      const match = {
        path: filePath,
        line: Number.isFinite(lineNumber) ? Math.floor(lineNumber) : null,
        text: Buffer.from(parts[4] ?? '', 'base64').toString('utf8'),
        context: [],
      };
      matches.push(match);
      byId.set(id, match);
      continue;
    }
    if (parts[0] !== '__CONTEXT__' || parts.length < 6) continue;
    const match = byId.get(String(parts[1] ?? ''));
    if (!match) continue;
    const contextLine = Number(parts[3] ?? NaN);
    const kindRaw = parts[4] ?? '';
    const kind =
      kindRaw === 'before' || kindRaw === 'after' || kindRaw === 'match' ? kindRaw : null;
    if (!Number.isFinite(contextLine) || !kind) continue;
    match.context.push({
      line: Math.floor(contextLine),
      kind,
      text: Buffer.from(parts[5] ?? '', 'base64').toString('utf8'),
    });
  }
  return matches;
}

export function parseAssistantFindOutput(text: string, limit: number): ContainerFsEntry[] {
  const entries: ContainerFsEntry[] = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.replace(/\r$/, '').split('\t');
    if (parts.length < 4) continue;
    const pathText = parts[0] ?? '';
    const kindRaw = parts[1] ?? '';
    const sizeRaw = parts[2] ?? '';
    const mtimeRaw = parts[3] ?? '';
    const kind: ContainerFsEntry['kind'] =
      kindRaw === 'd' ? 'directory' : kindRaw === 'f' ? 'file' : 'other';
    const sizeNum = Number(sizeRaw);
    const mtimeSec = Number(mtimeRaw);
    const name = path.basename(pathText) || pathText;
    entries.push({
      name,
      path: pathText,
      kind,
      size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : null,
      mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
      ext: kind === 'file' ? extensionLower(name) || null : null,
      isImage: kind === 'file' ? isLikelyImagePath(name) : false,
      isVideo: kind === 'file' ? isLikelyVideoPath(name) : false,
    });
    if (entries.length >= limit) break;
  }
  sortFsEntries(entries);
  return entries;
}
