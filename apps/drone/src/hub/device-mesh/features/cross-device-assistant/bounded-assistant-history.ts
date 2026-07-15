const MAX_HISTORY_BYTES = 180 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024;

function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 4_000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= 7) return '[nested value omitted]';
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, sanitize(item, depth + 1)]),
    );
  }
  return String(value ?? '');
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return JSON.stringify(sanitize(value)).slice(0, 12_000);
  return value
    .map((item: any) =>
      typeof item === 'string'
        ? item
        : typeof item?.text === 'string'
          ? item.text
          : JSON.stringify(sanitize(item)),
    )
    .join('\n')
    .slice(0, 12_000);
}

function boundedDetails(value: unknown): unknown {
  const details = sanitize(value);
  if (Buffer.byteLength(JSON.stringify(details)) <= 8 * 1024) return details;
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    target: sanitize(source.target),
    meshRoute: sanitize(source.meshRoute),
    truncated: true,
  };
}

function boundedEntry(entry: any): unknown {
  const sanitized = sanitize(entry);
  if (Buffer.byteLength(JSON.stringify(sanitized)) <= MAX_ENTRY_BYTES) return sanitized;
  const message = entry?.message ?? {};
  return {
    sequence: Number(entry?.sequence ?? 0),
    id: String(entry?.id ?? ''),
    timestamp: String(entry?.timestamp ?? ''),
    message: {
      role: String(message?.role ?? 'unknown'),
      content: contentText(message?.content),
      timestamp: message?.timestamp,
      details: boundedDetails(message?.details),
      truncated: true,
    },
  };
}

export function boundedAssistantHistory(history: any, maxBytes = MAX_HISTORY_BYTES): unknown {
  const entries = (Array.isArray(history?.entries) ? history.entries : [])
    .slice(-60)
    .map(boundedEntry);
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
      hasOlder: history?.page?.hasOlder === true,
    },
  };
  const byteLimit = Math.max(32 * 1024, Math.min(MAX_HISTORY_BYTES, maxBytes));
  while (result.entries.length > 1 && Buffer.byteLength(JSON.stringify(result)) > byteLimit)
    result.entries.shift();
  return result;
}
