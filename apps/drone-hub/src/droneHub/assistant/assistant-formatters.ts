export function formatUpdatedAt(raw: string): string {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'now';
  if (delta < 60 * 60_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(delta / (60 * 60_000)))}h`;
  return new Date(ms).toLocaleDateString();
}

export function formatArtifactSize(bytesRaw: number): string {
  const bytes = Number(bytesRaw);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function assistantThreadStatusTone(status: AssistantThreadStatus): string {
  if (status === 'running') return 'bg-[var(--green)]';
  if (status === 'waiting_for_approval') return 'bg-[var(--accent)]';
  if (status === 'error') return 'bg-[var(--red)]';
  return 'bg-[var(--muted-dim)]';
}

export function assistantThreadStatusLabel(
  status: AssistantThreadStatus | undefined,
  fallback: string,
): string {
  if (!status) return fallback;
  return status.replace(/_/g, ' ');
}
import type { AssistantThreadStatus } from './assistant-types';
