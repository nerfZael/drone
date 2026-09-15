import type { CompanionClientController } from './companion-client.js';
import type { CompanionLiveConversation } from './CompanionLiveConversation.js';

/** Observe new completions for this Live session, independently of who submitted the work. */
export function connectCompanionLiveReplies(
  controller: CompanionClientController,
  conversation: Pick<CompanionLiveConversation, 'deliverBackendReply' | 'deliverBackendUpdate'>,
): { ready(): void; stop(): void } {
  let previous = controller.getSnapshot();
  let ready = false;
  let stopped = false;
  const pending: string[] = [];
  // Progress is transient. During connection setup it is discarded rather than
  // replayed after a completion or a newer user request.
  const unsubscribeUpdates = controller.subscribeAssistantUpdates(({ text }) => {
    if (ready && !stopped) conversation.deliverBackendUpdate(text);
  });
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot();
    const completed = state.status === 'completed' && previous.status !== 'completed';
    previous = state;
    if (!completed || stopped) return;
    if (ready) conversation.deliverBackendReply(state.reply);
    else pending.push(state.reply);
  });
  return {
    ready() {
      if (stopped) return;
      ready = true;
      for (const reply of pending.splice(0)) conversation.deliverBackendReply(reply);
    },
    stop() {
      stopped = true;
      unsubscribe();
      unsubscribeUpdates();
      pending.length = 0;
    },
  };
}
