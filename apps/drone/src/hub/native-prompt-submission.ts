import type { HubAssistantService } from './assistant';
import type { BlipAssistantHost } from './assistant/blip-assistant-host';

type AssistantPromptInput =
  | string
  | { text: string; images: Array<{ type: 'image'; data: string; mimeType: string }> };

export function createNativePromptSubmitter({
  assistantService,
  blipAssistantHost,
  notifyNativePromptQueueChanged,
  startAssistantPromptDrain,
  hubLog,
}: {
  assistantService: Pick<
    HubAssistantService,
    | 'beginNativeThreadPrompt'
    | 'promptDeliveryMode'
    | 'enqueueThreadPromptWithResult'
    | 'claimQueuedPrompt'
    | 'completeQueuedPrompt'
    | 'failQueuedPrompt'
  >;
  blipAssistantHost: Pick<BlipAssistantHost, 'isThreadRunning' | 'promptThread'>;
  notifyNativePromptQueueChanged: (threadId: string) => Promise<void>;
  startAssistantPromptDrain: (threadId: string) => { promise: Promise<void> };
  hubLog: (level: 'warn', message: string, data: Record<string, unknown>) => void;
}) {
  return async (input: {
    threadId: string;
    promptId?: string;
    prompt: string;
    promptImages?: Array<{ type: 'image'; data: string; mimeType: string }>;
    deliveryMode?: 'queue' | 'asap';
    submissionSource?: import('../host/prompt-queue-repository').PromptSubmissionSource;
  }) => {
    await assistantService.beginNativeThreadPrompt(input.threadId);
    const promptInput: AssistantPromptInput = input.promptImages?.length
      ? { text: input.prompt, images: input.promptImages }
      : input.prompt;
    const deliveryMode =
      input.deliveryMode ?? (await assistantService.promptDeliveryMode(input.threadId));
    const enqueueResult = await assistantService.enqueueThreadPromptWithResult(input.threadId, {
      id: input.promptId,
      prompt: input.prompt,
      promptImages: input.promptImages,
      deliveryMode,
      submissionSource: input.submissionSource,
    });
    // Enqueueing can resolve a pending question request and resume the thread.
    // Re-check after the durable queue event so an ASAP message can steer that
    // resumed turn instead of waiting for it to finish.
    const steerImmediately =
      deliveryMode === 'asap' && blipAssistantHost.isThreadRunning(input.threadId);
    const queued = enqueueResult.prompt;
    // Reservations already exist when provisioning hands them to the native worker.
    // Only new entries notify the generic worker; duplicate notifications feed it back
    // into itself. The durable claim, not insertion, protects against double delivery.
    if (enqueueResult.inserted) await notifyNativePromptQueueChanged(input.threadId);
    if (!enqueueResult.needsDrain) return queued;
    if (enqueueResult.inserted && steerImmediately && !enqueueResult.interruptedPromptId) {
      const claimed = await assistantService.claimQueuedPrompt(input.threadId, queued.id, {
        allowConcurrent: true,
      });
      if (!claimed) throw new Error('built-in prompt could not be claimed');
      await notifyNativePromptQueueChanged(input.threadId);
      void blipAssistantHost
        .promptThread(input.threadId, promptInput, undefined, 'asap')
        .then(async () => {
          await assistantService.completeQueuedPrompt(input.threadId, queued.id);
          await notifyNativePromptQueueChanged(input.threadId);
        })
        .catch(async (error) => {
          await assistantService.failQueuedPrompt(input.threadId, queued.id, error);
          await notifyNativePromptQueueChanged(input.threadId);
        });
      return queued;
    }
    const drain = startAssistantPromptDrain(input.threadId);
    void drain.promise.catch((error: any) => {
      hubLog('warn', 'assistant queued prompt drain failed', {
        threadId: input.threadId,
        error: error?.message ?? String(error),
      });
    });
    return queued;
  };
}
