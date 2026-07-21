import type { AssistantMessage, AssistantQueuedPrompt } from './assistant-types';
import { assistantUserPromptIsVisible } from './assistant-message-model';

export type AssistantStartupPrompt = {
  prompt: string;
  at: string;
};

export type AssistantStartupPromptPresentation = {
  canonicalVisible: boolean;
  matchingQueuedPrompt: AssistantQueuedPrompt | null;
  reconciled: boolean;
  showOptimistic: boolean;
};

export function resolveAssistantStartupPromptPresentation(args: {
  startupPrompt?: AssistantStartupPrompt | null;
  messages: AssistantMessage[];
  queuedPrompts: AssistantQueuedPrompt[];
}): AssistantStartupPromptPresentation {
  const prompt = String(args.startupPrompt?.prompt ?? '').trim();
  if (!prompt) {
    return {
      canonicalVisible: false,
      matchingQueuedPrompt: null,
      reconciled: false,
      showOptimistic: false,
    };
  }

  const startupAtMs = Date.parse(String(args.startupPrompt?.at ?? ''));
  const matchingQueuedPrompt =
    args.queuedPrompts
      .filter((queued) => String(queued.prompt ?? '').trim() === prompt)
      .map((queued) => ({ queued, createdAtMs: Date.parse(String(queued.createdAt ?? '')) }))
      .filter(
        ({ createdAtMs }) =>
          !Number.isFinite(startupAtMs) ||
          !Number.isFinite(createdAtMs) ||
          createdAtMs >= startupAtMs - 5_000,
      )
      .sort((a, b) => {
        if (!Number.isFinite(startupAtMs)) return 0;
        const aDistance = Number.isFinite(a.createdAtMs)
          ? Math.abs(a.createdAtMs - startupAtMs)
          : Number.POSITIVE_INFINITY;
        const bDistance = Number.isFinite(b.createdAtMs)
          ? Math.abs(b.createdAtMs - startupAtMs)
          : Number.POSITIVE_INFINITY;
        return aDistance - bDistance;
      })[0]?.queued ?? null;
  const canonicalVisible = assistantUserPromptIsVisible(args.messages, {
    prompt,
    createdAt: matchingQueuedPrompt?.createdAt ?? args.startupPrompt?.at,
  });
  const failed = matchingQueuedPrompt?.status === 'failed';

  return {
    canonicalVisible,
    matchingQueuedPrompt,
    reconciled: canonicalVisible || failed,
    showOptimistic: !canonicalVisible && !failed,
  };
}
