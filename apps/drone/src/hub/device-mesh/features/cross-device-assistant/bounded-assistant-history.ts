const MAX_HISTORY_BYTES = 180 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024;

function truncateUtf8(value: unknown, maxBytes: number): string {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return source;
  return `${bytes
    .subarray(0, Math.max(0, maxBytes - 3))
    .toString('utf8')
    .replace(/\uFFFD+$/u, '')}…`;
}

type SanitizeState = { truncated: boolean };

function sanitize(value: unknown, depth = 0, state: SanitizeState = { truncated: false }): unknown {
  if (typeof value === 'string') {
    if (value.length > 4_000) state.truncated = true;
    return value.slice(0, 4_000);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= 7) {
    state.truncated = true;
    return '[nested value omitted]';
  }
  if (Array.isArray(value)) {
    if (value.length > 40) state.truncated = true;
    return value.slice(0, 40).map((item) => sanitize(item, depth + 1, state));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50) state.truncated = true;
    return Object.fromEntries(
      entries.slice(0, 50).map(([key, item]) => [key, sanitize(item, depth + 1, state)]),
    );
  }
  return String(value ?? '');
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return truncateUtf8(value, 12_000);
  if (!Array.isArray(value)) return truncateUtf8(JSON.stringify(sanitize(value)), 12_000);
  return truncateUtf8(
    value
      .map((item: any) =>
        typeof item === 'string'
          ? item
          : typeof item?.text === 'string'
            ? item.text
            : JSON.stringify(sanitize(item)),
      )
      .join('\n'),
    12_000,
  );
}

function boundedDetails(value: unknown): unknown {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  if (source.type === 'workspace_transfer') {
    const rawFiles = Array.isArray(source.files) ? source.files : [];
    const important = rawFiles.filter((file: any) =>
      ['failed', 'retrying', 'transferring'].includes(String(file?.status ?? '')),
    );
    const nearby = [
      ...rawFiles.filter((file: any) => file?.status === 'completed').slice(-5),
      ...rawFiles.filter((file: any) => file?.status === 'pending').slice(0, 10),
    ];
    const files = Array.from(new Set([...important, ...nearby])).slice(0, 24).map((file: any) => ({
      sourcePath: String(file?.sourcePath ?? '').slice(0, 800),
      destinationPath: String(file?.destinationPath ?? '').slice(0, 800),
      size: Number(file?.size) || 0,
      transferredBytes: Number(file?.transferredBytes) || 0,
      retries: Number(file?.retries) || 0,
      status: String(file?.status ?? 'pending').slice(0, 24),
      ...(file?.error ? { error: String(file.error).slice(0, 1_000) } : {}),
    }));
    const endpoint = (candidate: any) => ({
      targetId: String(candidate?.targetId ?? '').slice(0, 300),
      targetLabel: String(candidate?.targetLabel ?? '').slice(0, 300),
      path: String(candidate?.path ?? '').slice(0, 1_000),
    });
    return {
      type: 'workspace_transfer',
      phase: String(source.phase ?? ''),
      source: endpoint(source.source),
      destination: endpoint(source.destination),
      fileCount: Number(source.fileCount) || 0,
      completedFiles: Number(source.completedFiles) || 0,
      totalBytes: Number(source.totalBytes) || 0,
      transferredBytes: Number(source.transferredBytes) || 0,
      retries: Number(source.retries) || 0,
      resumedFiles: Number(source.resumedFiles) || undefined,
      resumeToken: source.resumeToken ? String(source.resumeToken).slice(0, 200) : undefined,
      failure: source.failure
        ? {
            sourcePath: String(source.failure.sourcePath ?? '').slice(0, 800) || undefined,
            destinationPath:
              String(source.failure.destinationPath ?? '').slice(0, 800) || undefined,
            error: String(source.failure.error ?? '').slice(0, 2_000),
            resumable: source.failure.resumable === true,
            cleanupError:
              String(source.failure.cleanupError ?? '').slice(0, 1_000) || undefined,
          }
        : undefined,
      files,
      filesTruncated: Math.max(0, rawFiles.length - files.length),
    };
  }
  const details = sanitize(value);
  if (Buffer.byteLength(JSON.stringify(details)) <= 8 * 1024) return details;
  return {
    target: sanitize(source.target),
    meshRoute: sanitize(source.meshRoute),
    truncated: true,
  };
}

function boundedEntry(entry: any): unknown {
  const state = { truncated: false };
  const sanitized = sanitize(entry, 0, state) as Record<string, any>;
  if (Buffer.byteLength(JSON.stringify(sanitized)) <= MAX_ENTRY_BYTES) {
    if (!state.truncated) return sanitized;
    return {
      ...sanitized,
      meshTruncated: true,
      ...(sanitized.message && typeof sanitized.message === 'object'
        ? { message: { ...sanitized.message, meshTruncated: true } }
        : {}),
    };
  }
  const message = entry?.message ?? {};
  return {
    sequence: Number(entry?.sequence ?? 0),
    id: truncateUtf8(entry?.id, 300),
    timestamp: truncateUtf8(entry?.timestamp, 100),
    message: {
      role: String(message?.role ?? 'unknown'),
      content: contentText(message?.content),
      timestamp: message?.timestamp,
      details: boundedDetails(message?.details),
      toolCallId: message?.toolCallId ? String(message.toolCallId).slice(0, 300) : undefined,
      toolName: message?.toolName ? String(message.toolName).slice(0, 200) : undefined,
      isError: message?.isError === true,
      errorMessage: message?.errorMessage ? truncateUtf8(message.errorMessage, 4_000) : undefined,
      meshTruncated: true,
    },
    meshTruncated: true,
  };
}

export function boundedAssistantHistory(history: any, maxBytes = MAX_HISTORY_BYTES): unknown {
  const sourceEntries = Array.isArray(history?.entries) ? history.entries : [];
  const responseTrimmed = sourceEntries.length > 60;
  const entries = sourceEntries.slice(-60).map(boundedEntry) as any[];
  const contentTruncated = entries.some((entry) => entry?.meshTruncated === true);
  const result = {
    version: 1,
    threadId: String(history?.threadId ?? ''),
    sessionId: history?.sessionId ? String(history.sessionId) : null,
    entries,
    page: {
      limit: Number(history?.page?.limit ?? entries.length),
      beforeCursor: Number.isFinite(history?.page?.beforeCursor)
        ? Number(history.page.beforeCursor)
        : null,
      hasOlder: history?.page?.hasOlder === true || responseTrimmed,
      responseTruncated: responseTrimmed,
      contentTruncated,
    },
  };
  const requestedLimit = Number.isFinite(maxBytes) ? Number(maxBytes) : MAX_HISTORY_BYTES;
  const byteLimit = Math.max(0, Math.min(MAX_HISTORY_BYTES, requestedLimit));
  while (result.entries.length > 1 && Buffer.byteLength(JSON.stringify(result)) > byteLimit) {
    result.entries.shift();
    result.page.hasOlder = true;
    result.page.responseTruncated = true;
  }
  if (result.entries.length === 1 && Buffer.byteLength(JSON.stringify(result)) > byteLimit) {
    if (byteLimit < 4 * 1024) {
      result.entries = [];
      result.page.hasOlder = true;
      result.page.responseTruncated = true;
    } else {
      const entry = result.entries[0] as any;
      result.entries[0] = {
        sequence: Number(entry?.sequence ?? 0),
        id: truncateUtf8(entry?.id, 160),
        timestamp: truncateUtf8(entry?.timestamp, 80),
        message: {
          role: String(entry?.message?.role ?? 'unknown'),
          content: truncateUtf8(
            contentText(entry?.message?.content),
            Math.max(256, byteLimit - 2_000),
          ),
          meshTruncated: true,
        },
        meshTruncated: true,
      };
      result.page.contentTruncated = true;
    }
  }
  if (result.page.hasOlder && result.entries.length > 0) {
    const firstSequence = Number(result.entries[0]?.sequence);
    if (Number.isFinite(firstSequence) && firstSequence > 0)
      result.page.beforeCursor = firstSequence;
  }
  return result;
}
