import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

import { bashQuote } from './hub-format';

export type RequestedByteRange =
  | { kind: 'full' }
  | { kind: 'invalid' }
  | { kind: 'from'; start: number; end: number | null }
  | { kind: 'suffix'; length: number };

export type ResolvedByteRange =
  | { kind: 'full'; start: 0; end: number; length: number }
  | { kind: 'range'; start: number; end: number; length: number };

export function parseRequestedByteRange(value: unknown): RequestedByteRange {
  const header = String(value ?? '').trim();
  if (!header.startsWith('bytes=')) return { kind: 'full' };
  const raw = header.slice('bytes='.length).trim();
  if (raw.includes(',')) return { kind: 'invalid' };
  const match = /^(\d*)-(\d*)$/.exec(raw);
  if (!match) return { kind: 'invalid' };
  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (!startRaw) {
    const length = safeInteger(endRaw);
    return length != null && length > 0 ? { kind: 'suffix', length } : { kind: 'invalid' };
  }
  const start = safeInteger(startRaw);
  const end = endRaw ? safeInteger(endRaw) : null;
  if (start == null || (endRaw && end == null)) return { kind: 'invalid' };
  return { kind: 'from', start, end };
}

export function resolveByteRange(
  requested: RequestedByteRange,
  totalBytes: number,
): ResolvedByteRange | null {
  if (requested.kind === 'invalid') return null;
  if (requested.kind === 'full') {
    return { kind: 'full', start: 0, end: Math.max(-1, totalBytes - 1), length: totalBytes };
  }
  if (totalBytes <= 0) return null;
  if (requested.kind === 'suffix') {
    const start = Math.max(0, totalBytes - requested.length);
    return { kind: 'range', start, end: totalBytes - 1, length: totalBytes - start };
  }
  if (requested.start >= totalBytes || (requested.end != null && requested.end < requested.start)) {
    return null;
  }
  const end = Math.min(requested.end ?? totalBytes - 1, totalBytes - 1);
  return { kind: 'range', start: requested.start, end, length: end - requested.start + 1 };
}

export async function readHostMediaRange(input: {
  targetPath: string;
  maxBytes: number;
  requestedRange: RequestedByteRange;
  includeRevision: boolean;
  retainBytes?: boolean;
  signal?: AbortSignal;
  allocateBytes?: (length: number) => Buffer;
}): Promise<{
  bytes: Buffer;
  totalBytes: number;
  range: ResolvedByteRange;
  servedRevision: string | null;
}> {
  const stat = await fs.stat(input.targetPath);
  if (!stat.isFile()) {
    const error = Object.assign(new Error(`file not found: ${input.targetPath}`), {
      code: 'ENOENT',
    });
    throw error;
  }
  const totalBytes = Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : 0;
  if (totalBytes > input.maxBytes) {
    throw Object.assign(new Error('media too large'), {
      statusCode: 413,
      size: totalBytes,
    });
  }
  const range = resolveByteRange(input.requestedRange, totalBytes);
  if (!range) {
    throw Object.assign(new Error('requested range is not satisfiable'), {
      statusCode: 416,
      size: totalBytes,
    });
  }

  const retainBytes = input.retainBytes !== false;
  if (!input.includeRevision) {
    return {
      bytes: retainBytes
        ? await readExactRange(
            input.targetPath,
            range.start,
            range.length,
            totalBytes,
            input.signal,
            input.allocateBytes,
          )
        : Buffer.alloc(0),
      totalBytes,
      range,
      servedRevision: null,
    };
  }

  const hash = crypto.createHash('sha256');
  const selected = retainBytes
    ? (input.allocateBytes ?? ((length) => Buffer.alloc(length)))(range.length)
    : Buffer.alloc(0);
  let selectedBytes = 0;
  let streamedBytes = 0;
  for await (const rawChunk of createReadStream(input.targetPath, { signal: input.signal })) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    hash.update(chunk);
    const chunkStart = streamedBytes;
    const chunkEnd = chunkStart + chunk.length;
    const selectedStart = Math.max(range.start, chunkStart);
    const selectedEnd = Math.min(range.end + 1, chunkEnd);
    if (selectedStart < selectedEnd) {
      if (retainBytes) {
        const sourceStart = selectedStart - chunkStart;
        const copied = chunk.copy(selected, selectedBytes, sourceStart, selectedEnd - chunkStart);
        selectedBytes += copied;
      }
    }
    streamedBytes = chunkEnd;
    if (streamedBytes > input.maxBytes) {
      throw Object.assign(new Error('media too large'), { statusCode: 413, size: streamedBytes });
    }
  }
  ensureStableLength(streamedBytes, totalBytes);
  if (retainBytes) ensureStableLength(selectedBytes, range.length);
  return {
    bytes: selected,
    totalBytes,
    range,
    servedRevision: `sha256:${hash.digest('hex')}`,
  };
}

export function buildContainerMediaRangeScript(input: {
  targetPath: string;
  maxBytes: number;
  requestedRange: RequestedByteRange;
  includeRevision: boolean;
  includeBody?: boolean;
}): string {
  const rangeKind = input.requestedRange.kind;
  const rangeStart = input.requestedRange.kind === 'from' ? input.requestedRange.start : 0;
  const rangeEnd =
    input.requestedRange.kind === 'from' && input.requestedRange.end != null
      ? input.requestedRange.end
      : -1;
  const suffixLength = input.requestedRange.kind === 'suffix' ? input.requestedRange.length : 0;
  return [
    'set -euo pipefail',
    `target=${bashQuote(input.targetPath)}`,
    `max=${String(input.maxBytes)}`,
    `range_kind=${bashQuote(rangeKind)}`,
    `range_start=${String(rangeStart)}`,
    `range_end=${String(rangeEnd)}`,
    `suffix_length=${String(suffixLength)}`,
    `include_revision=${input.includeRevision ? '1' : '0'}`,
    `include_body=${input.includeBody === false ? '0' : '1'}`,
    'if [ ! -f "$target" ]; then echo "__ERR__\tnot-file"; exit 3; fi',
    'size=$(wc -c < "$target" | tr -d "[:space:]")',
    'if [ -z "$size" ]; then size=0; fi',
    'if [ "$size" -gt "$max" ]; then printf "__ERR__\ttoo-large\t%s\n" "$size"; exit 4; fi',
    'start=0',
    'end=$((size - 1))',
    'partial=0',
    'case "$range_kind" in',
    '  invalid) printf "__ERR__\trange\t%s\n" "$size"; exit 5 ;;',
    '  from)',
    '    partial=1',
    '    start="$range_start"',
    '    if [ "$range_end" -ge 0 ]; then end="$range_end"; fi',
    '    if [ "$start" -ge "$size" ] || [ "$end" -lt "$start" ]; then printf "__ERR__\trange\t%s\n" "$size"; exit 5; fi',
    '    if [ "$end" -ge "$size" ]; then end=$((size - 1)); fi',
    '    ;;',
    '  suffix)',
    '    partial=1',
    '    if [ "$size" -le 0 ] || [ "$suffix_length" -le 0 ]; then printf "__ERR__\trange\t%s\n" "$size"; exit 5; fi',
    '    start=$((size - suffix_length))',
    '    if [ "$start" -lt 0 ]; then start=0; fi',
    '    ;;',
    'esac',
    'count=$size',
    'if [ "$partial" -eq 1 ]; then count=$((end - start + 1)); fi',
    'mime=""',
    'if command -v file >/dev/null 2>&1; then mime=$(file -Lb --mime-type -- "$target" 2>/dev/null || true); fi',
    'revision=""',
    'actual_size="$size"',
    'data=""',
    'tmp=""',
    'watchdog_pid=""',
    'cleanup() { if [ -n "$watchdog_pid" ]; then kill "$watchdog_pid" 2>/dev/null || true; fi; if [ -n "$tmp" ]; then rm -rf -- "$tmp"; fi; }',
    'trap cleanup EXIT',
    "trap 'exit 124' HUP INT TERM",
    '( sleep 55; kill -TERM "$$" ) &',
    'watchdog_pid="$!"',
    'if [ "$include_revision" -eq 1 ] || { [ "$partial" -eq 0 ] && [ "$include_body" -eq 1 ]; }; then',
    '  tmp=$(mktemp -d)',
    '  snapshot="$tmp/snapshot"',
    '  if ! head -c "$((max + 1))" -- "$target" > "$snapshot"; then echo "__ERR__\tread-failed"; exit 6; fi',
    '  actual_size=$(wc -c < "$snapshot" | tr -d "[:space:]")',
    '  if [ "$actual_size" -gt "$max" ]; then printf "__ERR__\ttoo-large\t%s\n" "$actual_size"; exit 4; fi',
    '  if [ "$include_revision" -eq 1 ]; then revision=$(sha256sum -- "$snapshot" | awk \'{print $1}\'); fi',
    '  if [ "$include_body" -eq 1 ]; then',
    '    data="$tmp/data"',
    '    dd if="$snapshot" iflag=skip_bytes,count_bytes skip="$start" count="$count" status=none > "$data"',
    '  fi',
    'elif [ "$partial" -eq 1 ] && [ "$include_body" -eq 1 ]; then',
    '  tmp=$(mktemp -d)',
    '  data="$tmp/data"',
    '  dd if="$target" iflag=skip_bytes,count_bytes skip="$start" count="$count" status=none > "$data"',
    'fi',
    'if [ "$include_revision" -eq 0 ]; then actual_size=$(wc -c < "$target" | tr -d "[:space:]"); fi',
    'printf "__META__\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$mime" "$size" "$start" "$count" "$partial" "$revision" "$actual_size"',
    'if [ "$include_body" -eq 1 ]; then base64 < "$data" | tr -d "\\n"; fi',
  ].join('\n');
}

function safeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readExactRange(
  filePath: string,
  start: number,
  length: number,
  expectedTotalBytes: number,
  signal?: AbortSignal,
  allocateBytes: (length: number) => Buffer = Buffer.alloc,
): Promise<Buffer> {
  const bytes = allocateBytes(length);
  const handle = await fs.open(filePath, 'r');
  let offset = 0;
  try {
    while (offset < length) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const read = await handle.read(bytes, offset, length - offset, start + offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const finalStat = await handle.stat();
    ensureStableLength(finalStat.size, expectedTotalBytes);
  } finally {
    await handle.close();
  }
  ensureStableLength(offset, length);
  return bytes;
}

function ensureStableLength(actual: number, expected: number) {
  if (actual === expected) return;
  throw Object.assign(new Error('file changed while it was being read'), {
    code: 'FILE_CHANGED_DURING_READ',
    statusCode: 409,
  });
}
