import type { TranscriptItem } from '../types';

export function transcriptMessageId(item: TranscriptItem): string {
  const explicit = typeof item.id === 'string' ? item.id.trim() : '';
  if (explicit) return explicit;
  const session = String(item.session ?? '').trim() || 'session';
  const turn = String(item.turn ?? '');
  const timestamp = String(item.completedAt ?? item.at ?? '').trim() || 'at';
  return `${session}:${turn}:${timestamp}`;
}
