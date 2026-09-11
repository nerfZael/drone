import type { CompanionClientController } from '@drone/assistant-chat';

/** Subscribe before submitting so even an immediate reply or failure is observed. */
export async function waitForCompanionReply(
  controller: CompanionClientController,
  submit: () => Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  let unsubscribe = () => {};
  let onAbort = () => {};
  try {
    return await new Promise<string>((resolve, reject) => {
      onAbort = () => reject(new Error('Voice conversation ended.'));
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      const check = () => {
        const state = controller.getSnapshot();
        if (state.status === 'completed') resolve(state.reply);
        else if (state.status === 'error' || state.status === 'cancelled' || state.status === 'idle') {
          reject(new Error(state.error || 'Companion task was stopped.'));
        }
      };
      unsubscribe = controller.subscribe(check);
      void submit().then(check, reject);
    });
  } finally { unsubscribe(); signal?.removeEventListener('abort', onAbort); }
}
