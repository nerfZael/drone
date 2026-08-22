export type CodexDaemonRestartRecoveryAction =
  | 'none'
  | 'resume-queued'
  | 'fail-running';

export function codexDaemonRestartRecoveryAction(opts: {
  state: string;
  owned: boolean;
  createdAt: string;
  nowMs?: number;
  graceMs?: number;
}): CodexDaemonRestartRecoveryAction {
  if (opts.owned) return 'none';
  const createdMs = Date.parse(String(opts.createdAt ?? ''));
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const graceMs = Number.isFinite(opts.graceMs)
    ? Math.max(0, Number(opts.graceMs))
    : 2_000;
  if (!Number.isFinite(createdMs) || nowMs - createdMs <= graceMs) return 'none';
  if (opts.state === 'queued') return 'resume-queued';
  if (opts.state === 'running') return 'fail-running';
  return 'none';
}
