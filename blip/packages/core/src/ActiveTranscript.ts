import type { TranscriptEntry } from './types.js';

/** Collect newest-first entries only as far as the latest checkpoint's retained boundary. */
export class ActiveTranscript {
  private readonly entries: TranscriptEntry[] = [];
  private checkpoint?: Extract<TranscriptEntry, { type: 'compaction' }>;
  private readonly required = new Set<string>();

  /** Returns true once older entries can safely be skipped. Missing boundaries read to the start. */
  add(entry: TranscriptEntry): boolean {
    const invalidPin = entry.id === this.checkpoint?.retainedUserEntryId &&
      (entry.type !== 'message' || entry.message.role !== 'user');
    const boundary = !invalidPin && this.required.delete(entry.id);
    if (entry.type === 'message' || entry.type === 'compaction' || boundary) {
      this.entries.push(entry);
    }
    if (boundary && this.required.size === 0) return true;
    if (!this.checkpoint && entry.type === 'compaction') {
      this.checkpoint = entry;
      if (entry.firstKeptEntryId) this.required.add(entry.firstKeptEntryId);
      if (entry.retainedUserEntryId) this.required.add(entry.retainedUserEntryId);
      return this.required.size === 0;
    }
    return false;
  }

  finish(): TranscriptEntry[] {
    return this.entries.reverse();
  }
}
