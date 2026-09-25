import { pendingPromptIsWaiting } from '@drone/assistant-chat';
import type { ChatTimelineGroup } from './chat-timeline-items';

/** Submission order stays stable even when priority changes execution order. */
export function chatExecutionOrder(groups: readonly ChatTimelineGroup[]) {
  const notes = new Map<number, string>();
  let activeEarlier: { id: string; prompt: string } | null = null;
  for (let index = 0; index < groups.length; index++) {
    const entry = groups[index]!.primary;
    const started = Date.parse(entry.item.startedAt ?? '');
    if (Number.isFinite(started)) {
      const passedEarlier = groups.slice(0, index).some(({ primary: earlier }) => {
        if (earlier.kind === 'turn' && (earlier.item.userOnly || earlier.item.silentCompletion)) return false;
        if (earlier.kind === 'pending' && (earlier.item.state === 'failed' || earlier.item.action)) return false;
        const earlierStarted = Date.parse(earlier.item.startedAt ?? '');
        return Number.isFinite(earlierStarted) ? earlierStarted > started : earlier.kind === 'pending';
      });
      if (passedEarlier) notes.set(index, entry.item.deliveryMode === 'asap'
        ? 'ASAP: started before an earlier queued request. Messages stay in sent order.'
        : 'Started before an earlier queued request. Messages stay in sent order.');
    }
    if (entry.kind === 'pending' && entry.item.state === 'sent' && !entry.item.action &&
        !pendingPromptIsWaiting(entry.item) && Number.isFinite(started) &&
        groups.slice(index + 1).some(({ primary }) => primary.kind === 'turn' && !primary.item.userOnly)) {
      activeEarlier = { id: entry.item.id, prompt: entry.item.prompt };
    }
  }
  return { notes, activeEarlier };
}
