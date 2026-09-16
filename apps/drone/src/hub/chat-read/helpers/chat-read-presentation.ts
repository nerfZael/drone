/** Bounded model-facing presentation, shared by the chat read endpoint and MCP. */
export function pendingChatSummary(response: any, limit: number, maxCharsPerField: number) {
  const pendingMessages = Array.isArray(response?.pending) ? response.pending : [];
  const pending = pendingMessages.slice(0, limit).map((item: any) => {
    const prompt = truncateString(String(item?.prompt ?? ''), maxCharsPerField);
    return {
      id: cleanString(item?.id),
      at: cleanString(item?.at),
      state: cleanString(item?.state, 'queued'),
      status: response?.draft === true ? 'held_in_draft' : cleanString(item?.state, 'queued'),
      prompt: prompt.value,
      promptOriginalLength: prompt.originalLength,
      ...(prompt.truncated ? { promptTruncated: true } : {}),
    };
  });
  return {
    draft: response?.draft === true,
    pending,
    pendingCount: pendingMessages.length,
    pendingTruncated: pendingMessages.length > pending.length,
    ...(response?.draft === true && pendingMessages.length > 0
      ? {
          message:
            'Pending messages are held until this draft chat is published. They have not started execution.',
        }
      : {}),
  };
}

export function boundedTranscriptTurn(
  turn: any,
  maxCharsPerField: number,
  includeActivity = false,
) {
  // Deliberate conversational projection: never spread raw turn data into model text.
  const result: Record<string, unknown> = {};
  for (const key of ['id', 'at', 'promptAt', 'startedAt', 'completedAt', 'model', 'reasoning']) {
    if (typeof turn?.[key] === 'string') result[key] = turn[key].slice(0, 256);
  }
  if (Number.isSafeInteger(turn?.turn) && turn.turn > 0) result.turn = turn.turn;
  for (const key of ['ok', 'inheritedFromClone', 'silentCompletion']) {
    if (typeof turn?.[key] === 'boolean') result[key] = turn[key];
  }
  for (const key of ['prompt', 'output', 'error']) {
    if (typeof turn?.[key] !== 'string') continue;
    const next = truncateString(turn[key], maxCharsPerField);
    result[key] = next.value;
    result[`${key}OriginalLength`] = next.originalLength;
    if (next.truncated) {
      result[`${key}Truncated`] = true;
      result.truncated = true;
    }
  }
  const summary = turn?.activitySummary;
  if (summary?.available === true) {
    result.activitySummary = {
      available: true,
      source: typeof summary.source === 'string' ? summary.source.slice(0, 128) : undefined,
      messageCount: boundedCount(summary.messageCount),
      toolCallCount: boundedCount(summary.toolCallCount),
      truncated: summary.truncated === true,
    };
  }
  if (turn?.fileChanges?.counts) {
    const changes = turn.fileChanges;
    const counts = changes.counts;
    result.fileChangesSummary = {
      changed: boundedCount(counts.changed),
      additions: boundedCount(counts.additions),
      deletions: boundedCount(counts.deletions),
      ...(['exact', 'base-normalized', 'partial', 'unavailable'].includes(changes.attribution)
        ? { attribution: changes.attribution }
        : {}),
      ...(changes.truncated === true || changes.metadataTruncated === true
        ? { truncated: true }
        : {}),
    };
  }
  if (Array.isArray(turn?.attachments) && turn.attachments.length > 0) {
    result.attachmentCount = turn.attachments.length;
  }
  // Detailed evidence is opt-in. The shared Blip result budget still applies to model requests.
  if (includeActivity && turn?.activity) result.activity = turn.activity;
  return result;
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0;
}

function cleanString(value: unknown, fallback = ''): string {
  return String(value ?? '').trim() || fallback;
}

function truncateString(value: unknown, maxChars: number) {
  const text = String(value ?? '');
  return {
    value: text.slice(0, maxChars),
    originalLength: text.length,
    truncated: text.length > maxChars,
  };
}
