const STOPPED_RUN_ERROR_PATTERN =
  /^(?:assistant run (?:was )?stopped|stopped by user|stopped before submission|stopped because the drone was (?:archived|deleted|stopped|restarted))\.?$/i;

export function isStoppedRunError(value: unknown): boolean {
  return STOPPED_RUN_ERROR_PATTERN.test(String(value ?? '').trim());
}

export function stoppedRunDetail(value: unknown): string {
  const message = String(value ?? '').trim();
  if (/^stopped by user\.?$/i.test(message)) return 'Stopped by you.';
  if (/^stopped before submission\.?$/i.test(message)) return 'Stopped before it was sent.';
  if (/^assistant run (?:was )?stopped\.?$/i.test(message)) return 'The run was stopped.';
  return message || 'The run was stopped.';
}
