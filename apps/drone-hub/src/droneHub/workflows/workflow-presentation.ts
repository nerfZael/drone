export const ACTIVE_WORKFLOW_RUN_STATUSES = new Set(['queued', 'running', 'cancelling']);
export const TERMINAL_WORKFLOW_RUN_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'denied',
]);

export function workflowTimeLabel(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

export function workflowStatusClass(status: string): string {
  if (status === 'completed') return 'text-[var(--green)] bg-[var(--green-subtle)]';
  if (status === 'failed' || status === 'cancelled' || status === 'denied') {
    return 'text-[var(--red)] bg-[var(--red-subtle)]';
  }
  return 'text-[var(--accent)] bg-[var(--accent-subtle)]';
}

export function workflowStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
