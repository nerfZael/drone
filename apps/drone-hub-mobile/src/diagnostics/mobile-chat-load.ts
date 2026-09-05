import type { MobileChatLoadRecord } from '@drone/device-protocol';

let config: {
  uuid: () => string;
  platform: string;
  save: (record: MobileChatLoadRecord) => Promise<void>;
} | null = null;
export function configureMobileChatDiagnostics(value: NonNullable<typeof config>) {
  config = value;
}
type Target = { targetDeviceId: string; droneId: string; chatName: string };
type Span = {
  record: MobileChatLoadRecord;
  start: number;
  timer: ReturnType<typeof setTimeout>;
  heartbeat: ReturnType<typeof setInterval>;
};
let active: Span | null = null;
const now = () => performance.now();
const elapsed = (span: Span) => Math.max(0, Math.round((now() - span.start) * 10) / 10);
const matches = (span: Span, target: Target) =>
  span.record.targetDeviceId === target.targetDeviceId &&
  span.record.droneId === target.droneId &&
  span.record.chatName === target.chatName;
export function finishMobileChatLoad(status: MobileChatLoadRecord['status'], target?: Target) {
  const span = active;
  if (!span || (target && !matches(span, target))) return;
  active = null;
  clearTimeout(span.timer);
  clearInterval(span.heartbeat);
  span.record.durationMs = elapsed(span);
  span.record.status = status;
  void config?.save(span.record).catch(() => undefined);
}
export function beginMobileChatLoad(target: Target, reuse = false) {
  if (!config) return;
  if (
    reuse &&
    active &&
    active.record.targetDeviceId === target.targetDeviceId &&
    active.record.droneId === target.droneId
  ) {
    active.record.chatName = target.chatName || active.record.chatName;
    return;
  }
  finishMobileChatLoad('superseded');
  let previousTick = now();
  const heartbeat = setInterval(() => {
    if (!active) return;
    const tick = now();
    active.record.milestones.maxJsTimerDelayMs = Math.max(
      active.record.milestones.maxJsTimerDelayMs ?? 0,
      tick - previousTick - 250,
    );
    previousTick = tick;
  }, 250);
  active = {
    start: now(),
    heartbeat,
    timer: setTimeout(() => finishMobileChatLoad('timeout'), 45_000),
    record: {
      version: 1,
      navigationId: config.uuid(),
      ...target,
      chatName: target.chatName || 'default',
      platform: config.platform,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'timeout',
      milestones: { tap: 0 },
      requests: [],
    },
  };
}
export function markMobileChatLoad(target: Target, name: string) {
  if (active && matches(active, target) && active.record.milestones[name] === undefined)
    active.record.milestones[name] = elapsed(active);
}
export function mobileChatApplied(target: Target, kind: 'cached' | 'fresh') {
  if (!active || !matches(active, target)) return null;
  markMobileChatLoad(target, `${kind}Applied`);
  return { navigationId: active.record.navigationId, kind };
}
export function mobileChatCommitted(token: ReturnType<typeof mobileChatApplied>) {
  if (!token || !active || token.navigationId !== active.record.navigationId) return;
  const span = active;
  span.record.milestones[`${token.kind}Committed`] = elapsed(span);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (active !== span) return;
      if (token.kind === 'cached' && span.record.milestones.freshCommitted !== undefined) return;
      span.record.milestones[`${token.kind}Frame`] = elapsed(span);
      if (token.kind === 'fresh') finishMobileChatLoad('completed');
    }),
  );
}
export function observeMobileChatRequest(
  targetDeviceId: string,
  operation: string,
  payload: any,
  requestId: string,
) {
  const span = active;
  if (
    !span ||
    !['chat.read', 'chats.list'].includes(operation) ||
    span.record.targetDeviceId !== targetDeviceId ||
    span.record.droneId !== payload?.droneId ||
    (operation === 'chat.read' && span.record.chatName !== payload?.chatName) ||
    span.record.requests.length >= 16
  )
    return null;
  const started = now();
  const record: MobileChatLoadRecord['requests'][number] = {
    requestId,
    operation,
    outcome: 'aborted',
    timings: { startMs: elapsed(span) },
  };
  span.record.requests.push(record);
  return {
    mark(name: string) {
      if (active === span) record.timings[name] = Math.max(0, now() - started);
    },
    timing(name: string, value: number) {
      if (active === span && Number.isFinite(value)) record.timings[name] = Math.max(0, value);
    },
    serverId(value?: string) {
      if (active === span && value) record.serverRequestId = value;
    },
    finish(outcome: 'completed' | 'error' | 'aborted') {
      if (active === span) {
        record.outcome = outcome;
        record.timings.durationMs = Math.max(0, now() - started);
      }
    },
  };
}
