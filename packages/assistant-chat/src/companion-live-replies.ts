import type { CompanionClientController } from './companion-client.js';
import type { CompanionLiveConversation } from './CompanionLiveConversation.js';

/** Observe new completions for this Live session, independently of who submitted the work. */
export function connectCompanionLiveReplies(
  controller: CompanionClientController,
  conversation: Pick<CompanionLiveConversation, 'deliverBackendReply' | 'deliverBackendUpdate' | 'deliverBackendError'>,
): { ready(): void; stop(): void } {
  let previous = controller.getSnapshot();
  let ready = false;
  let stopped = false;
  const pending: Array<{ failed: boolean; text: string; announce: boolean }> = [];
  const deliver = (result: { failed: boolean; text: string; announce: boolean }) => {
    if (result.failed) conversation.deliverBackendError(result.text, result.announce);
    else conversation.deliverBackendReply(result.text, result.announce);
  };
  // Progress is transient. During connection setup it is discarded rather than
  // replayed after a completion or a newer user request.
  const unsubscribeUpdates = controller.subscribeAssistantUpdates(({ text }) => {
    if (ready && !stopped) conversation.deliverBackendUpdate(text);
  });
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot();
    const completed = state.status === 'completed' && previous.status !== 'completed';
    const failed = state.status === 'error' && previous.status === 'working';
    previous = state;
    if ((!completed && !failed) || stopped) return;
    const result = { failed, text: failed ? state.error : state.reply, announce: state.replySource === 'subscription' };
    if (ready) deliver(result);
    else pending.push(result);
  });
  return {
    ready() {
      if (stopped) return;
      ready = true;
      for (const result of pending.splice(0)) deliver(result);
    },
    stop() {
      stopped = true;
      unsubscribe();
      unsubscribeUpdates();
      pending.length = 0;
    },
  };
}
