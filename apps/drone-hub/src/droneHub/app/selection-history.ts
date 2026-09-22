import type { DroneSummary } from '../types';
import { selectableDroneChats } from './drone-selection-helpers';

export type SelectionHistoryEntry = { droneId: string; chatName: string };

/** Match the selection hook's default-chat fallback when a drone has no chat list yet. */
export function isSelectionHistoryEntryAvailable(
  entry: SelectionHistoryEntry,
  drone: DroneSummary | undefined,
): boolean {
  if (!drone) return false;
  const chats = selectableDroneChats(drone);
  return chats.includes(entry.chatName) || (chats.length === 0 && entry.chatName === 'default');
}

function sameSelection(a: SelectionHistoryEntry | undefined, b: SelectionHistoryEntry): boolean {
  return a?.droneId === b.droneId && a.chatName === b.chatName;
}

/** Session-local browser-style history, bounded to avoid retaining unlimited selections. */
export class SelectionHistory {
  private entries: SelectionHistoryEntry[] = [];
  private index = -1;
  private detached = false;

  record(entry: SelectionHistoryEntry | null): void {
    if (!entry) {
      this.detached = true;
      return;
    }
    this.detached = false;
    if (sameSelection(this.entries[this.index], entry)) return;
    this.entries = [...this.entries.slice(0, this.index + 1), entry].slice(-200);
    this.index = this.entries.length - 1;
  }

  move(direction: -1 | 1, available: (entry: SelectionHistoryEntry) => boolean): SelectionHistoryEntry | null {
    const current = this.detached ? undefined : this.entries[this.index];
    const start = this.detached && direction === -1 ? this.index : this.index + direction;
    for (let index = start; index >= 0 && index < this.entries.length; index += direction) {
      const entry = this.entries[index];
      if (!available(entry) || (current && sameSelection(current, entry))) continue;
      this.index = index;
      this.detached = false;
      return entry;
    }
    return null;
  }
}
