import { nativeUsageObservation } from '../AgentUsageAccumulator';
import type { UsageDelivery } from '../UsageJournal';

export function nativeUsageDelivery(threadId: string, event: any): UsageDelivery {
  const observation = event.type === 'usage_observed' ? nativeUsageObservation(event) : null;
  const purpose = event.purpose === 'compaction' ? 'compaction' : threadId.startsWith('companion:') ? 'companion' : 'chat';
  if (observation) observation.purpose = purpose;
  return {
    execution: { id: `native:${event.sessionId}:${purpose === 'compaction' ? event.eventId : event.turnId ?? event.eventId}`,
      chatId: threadId, agent: 'native', purpose, startedAt: event.timestamp,
      status: event.type === 'session_finished' ? event.status : purpose === 'compaction' ? 'completed' : 'running' },
    observations: observation ? [observation] : [], replace: false,
  };
}
