import type { AgentRunFileChangeEntry } from '@blip/protocol';

export const MOBILE_DIFF_MAX_CHARACTERS = 120_000;
export const MOBILE_DIFF_MAX_LINES = 4_000;

export type MobileDiffLineKind = 'addition' | 'deletion' | 'context' | 'note';

export type MobileDiffLine = {
  kind: MobileDiffLineKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

export type MobileDiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: MobileDiffLine[];
};

type MobileDiffNonContentKind = 'binary' | 'empty' | 'malformed' | 'too-large' | 'unavailable';

export type MobileDiffRenderModel =
  | {
      kind: 'diff';
      hunks: MobileDiffHunk[];
      truncated: boolean;
      lineCount: number;
    }
  | {
      kind: MobileDiffNonContentKind;
      message: string;
      truncated: boolean;
    };

export type MobileChangedFileStatusTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

export type MobileChangedFileStatusPresentation = {
  code: string;
  label: string;
  tone: MobileChangedFileStatusTone;
};

export type MobileDiffLoadError = {
  kind: 'error' | 'too-large' | 'unavailable';
  message: string;
  retryable: boolean;
};

export function buildMobileDiffRenderModel(input: {
  entry: AgentRunFileChangeEntry;
  patch: string;
  truncated?: boolean;
}): MobileDiffRenderModel {
  const patch = normalizePatch(input.patch);
  const truncated = input.truncated === true || patch.includes('… diff truncated …');

  if (input.entry.binary || binaryDiffPattern.test(patch)) {
    return {
      kind: 'binary',
      message: 'This is a binary file, so there are no text lines to review.',
      truncated,
    };
  }
  if (!patch.trim()) {
    return {
      kind: 'empty',
      message: 'This file has no line-level changes to display.',
      truncated,
    };
  }
  if (patch.length > MOBILE_DIFF_MAX_CHARACTERS) {
    return {
      kind: 'too-large',
      message: 'This diff is too large to render safely on this phone.',
      truncated: true,
    };
  }

  const rawLines = patch.split('\n');
  if (rawLines.length > MOBILE_DIFF_MAX_LINES) {
    return {
      kind: 'too-large',
      message: 'This diff contains too many lines to render safely on this phone.',
      truncated: true,
    };
  }

  const hunks = parseHunks(rawLines);
  const lineCount = hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
  if (hunks.length === 0 || lineCount === 0) {
    return {
      kind: 'malformed',
      message: truncated
        ? 'The stored diff was truncated before a readable hunk could be recovered.'
        : 'The stored patch is not a readable unified diff.',
      truncated,
    };
  }
  return { kind: 'diff', hunks, truncated, lineCount };
}

export function mobileChangedFileStatusPresentation(
  entry: Pick<AgentRunFileChangeEntry, 'status'>,
): MobileChangedFileStatusPresentation {
  switch (entry.status) {
    case 'added':
      return { code: 'A', label: 'Added', tone: 'success' };
    case 'deleted':
      return { code: 'D', label: 'Deleted', tone: 'danger' };
    case 'renamed':
      return { code: 'R', label: 'Renamed', tone: 'accent' };
    case 'copied':
      return { code: 'C', label: 'Copied', tone: 'accent' };
    case 'type-changed':
      return { code: 'T', label: 'Type changed', tone: 'warning' };
    case 'unmerged':
      return { code: 'U', label: 'Unmerged', tone: 'danger' };
    case 'modified':
      return { code: 'M', label: 'Modified', tone: 'warning' };
    default:
      return { code: '?', label: 'Changed', tone: 'neutral' };
  }
}

export function mobileDiffLoadError(error: any): MobileDiffLoadError {
  const code = String(error?.code ?? '');
  const status = Number(/^HUB_(\d+)$/.exec(code)?.[1] ?? error?.status ?? 0);
  const message = String(error?.message ?? error ?? 'Unable to load historical diff.');
  if (
    status === 413 ||
    /(?:too large|size limit|artifact size limit|run changed many files)/i.test(message)
  ) {
    return { kind: 'too-large', message, retryable: false };
  }
  if (
    code === 'INVALID_REQUEST' ||
    (status >= 400 && status < 500 && status !== 408 && status !== 429)
  ) {
    return { kind: 'unavailable', message, retryable: false };
  }
  return { kind: 'error', message, retryable: true };
}

const binaryDiffPattern = /(^|\n)(Binary files .* differ|GIT binary patch)(\n|$)/;
const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s?(.*))?$/;

function normalizePatch(value: string): string {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function parseHunks(rawLines: string[]): MobileDiffHunk[] {
  const hunks: MobileDiffHunk[] = [];
  let current: MobileDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index] ?? '';
    const header = hunkHeaderPattern.exec(rawLine);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = {
        header: rawLine,
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (rawLine.startsWith('+')) {
      current.lines.push({
        kind: 'addition',
        content: rawLine.slice(1),
        oldLine: null,
        newLine,
      });
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith('-')) {
      current.lines.push({
        kind: 'deletion',
        content: rawLine.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine += 1;
      continue;
    }
    if (rawLine.startsWith(' ')) {
      current.lines.push({
        kind: 'context',
        content: rawLine.slice(1),
        oldLine,
        newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith('\\') || rawLine.includes('… diff truncated …')) {
      current.lines.push({
        kind: 'note',
        content: rawLine,
        oldLine: null,
        newLine: null,
      });
      continue;
    }
    if (rawLine || index < rawLines.length - 1) {
      current.lines.push({
        kind: 'note',
        content: rawLine,
        oldLine: null,
        newLine: null,
      });
    }
  }
  return hunks;
}
