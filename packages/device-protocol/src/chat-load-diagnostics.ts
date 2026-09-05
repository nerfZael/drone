export type MobileChatLoadRecord = {
  version: 1;
  navigationId: string;
  targetDeviceId: string;
  droneId: string;
  chatName: string;
  platform: string;
  startedAt: string;
  durationMs: number;
  status: 'completed' | 'error' | 'timeout' | 'superseded' | 'backgrounded';
  milestones: Record<string, number>;
  requests: Array<{
    requestId: string;
    operation: string;
    outcome: string;
    timings: Record<string, number>;
    serverRequestId?: string;
  }>;
};

// Allowlisted numeric measurements only: never retain payloads, URLs, or error text.
export function normalizeMobileChatLoad(raw: unknown): MobileChatLoadRecord | null {
  const value = raw as MobileChatLoadRecord;
  const text = (v: unknown, max = 128): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  const duration = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 3_600_000;
  const numbers = (v: unknown) =>
    Object.fromEntries(
      Object.entries(v && typeof v === 'object' ? v : {})
        .slice(0, 32)
        .filter(([key, val]) => /^[a-zA-Z][a-zA-Z0-9_.]{0,47}$/.test(key) &&
          (key === 'responseBytes' ? typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 && val <= 100_000_000 : duration(val))),
    );
  if (
    !value ||
    value.version !== 1 ||
    !text(value.navigationId) ||
    !text(value.targetDeviceId) ||
    !text(value.droneId) ||
    !text(value.chatName) ||
    !['android', 'ios', 'web'].includes(value.platform) ||
    !text(value.startedAt, 40) ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !duration(value.durationMs) ||
    !['completed', 'error', 'timeout', 'superseded', 'backgrounded'].includes(value.status)
  )
    return null;
  return {
    version: 1,
    navigationId: value.navigationId,
    targetDeviceId: value.targetDeviceId,
    droneId: value.droneId,
    chatName: value.chatName,
    platform: value.platform,
    startedAt: new Date(value.startedAt).toISOString(),
    durationMs: value.durationMs,
    status: value.status,
    milestones: numbers(value.milestones),
    requests: (Array.isArray(value.requests) ? value.requests : [])
      .slice(0, 16)
      .flatMap((r) =>
        r &&
        text(r.requestId) &&
        ['chat.read', 'chats.list'].includes(r.operation) &&
        ['completed', 'error', 'aborted'].includes(r.outcome)
          ? [
              {
                requestId: r.requestId,
                operation: r.operation,
                outcome: r.outcome,
                timings: numbers(r.timings),
                ...(text(r.serverRequestId) ? { serverRequestId: r.serverRequestId } : {}),
              },
            ]
          : [],
      ),
  };
}
