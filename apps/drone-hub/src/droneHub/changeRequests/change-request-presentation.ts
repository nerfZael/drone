import type { ChangeRequestView } from '@drone/hub-model/change-requests';

export function changeRequestStatusLabel(request: ChangeRequestView): string {
  if (request.status !== 'open') return request.status;
  if (request.conflicted) return 'conflicted';
  if (request.stale) return 'stale';
  return 'open';
}

export function changeRequestStatusClasses(request: ChangeRequestView): string {
  const status = changeRequestStatusLabel(request);
  if (status === 'merged')
    return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
  if (status === 'conflicted')
    return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
  if (status === 'stale')
    return 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]';
  return 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]';
}

export function shortChangeRequestSha(value: string | null): string {
  return value ? value.slice(0, 8) : '—';
}

export function relativeChangeRequestTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
