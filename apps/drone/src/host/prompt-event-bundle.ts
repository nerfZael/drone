import {
  renderEventNotificationPrompt,
  type EventNotificationPromptEvent,
} from '@drone/assistant-chat';
import type { PromptQueueItem } from './prompt-queue-repository';

export type PromptEventBundle = {
  sealed?: boolean;
  maxEvents?: number;
  events: Array<EventNotificationPromptEvent & { deliveryId: string }>;
  // Retain the occupied slot after removal: a later message must keep its place.
  humanMessage?: { id: string; text: string; removed?: boolean };
};

export const MAX_PROMPT_BUNDLE_EVENTS = 100;
export const MAX_PROMPT_BUNDLE_CHARS = 256_000;

export function renderPromptEventBundle(bundle: PromptEventBundle): string {
  return renderEventNotificationPrompt({
    events: bundle.events,
    // An event keeps its original detail budget as the bundle grows.
    providerContentBudget: 60_000 * bundle.events.length,
    userMessage: bundle.humanMessage?.removed ? undefined : bundle.humanMessage?.text,
  });
}

export function mergePromptEventBundle(
  current: PromptQueueItem,
  incoming: PromptQueueItem,
  source: 'human' | 'subscription',
): PromptQueueItem | null {
  if (!current.eventBundle) return null;
  if (source === 'human' && current.eventBundle.humanMessage) return null;
  const eventBundle: PromptEventBundle =
    source === 'human'
      ? { ...current.eventBundle, humanMessage: { id: incoming.id, text: incoming.prompt } }
      : {
          ...current.eventBundle,
          events: [
            ...current.eventBundle.events,
            ...(incoming.eventBundle?.events ?? []).filter(
              (event) =>
                !current.eventBundle!.events.some(
                  (existing) => existing.deliveryId === event.deliveryId,
                ),
            ),
          ],
        };
  const maxEvents = Math.min(
    current.eventBundle.maxEvents ?? MAX_PROMPT_BUNDLE_EVENTS,
    incoming.eventBundle?.maxEvents ?? MAX_PROMPT_BUNDLE_EVENTS,
  );
  if (eventBundle.events.length > maxEvents) return null;
  eventBundle.maxEvents = maxEvents;
  const prompt = renderPromptEventBundle(eventBundle);
  if (prompt.length > MAX_PROMPT_BUNDLE_CHARS) return null;
  const next: PromptQueueItem = {
    ...current,
    ...(source === 'human'
      ? {
          model: incoming.model,
          messageId: incoming.messageId,
          cwd: incoming.cwd,
          attachments: incoming.attachments,
          nativePrompt: incoming.nativePrompt,
        }
      : {}),
    eventBundle,
    prompt,
  };
  if (next.nativePrompt) {
    const previousText = source === 'human' ? incoming.prompt : current.prompt;
    // Native preparation appends attachment references to the original message.
    // Preserve those references while replacing the event envelope.
    if (!next.nativePrompt.text.startsWith(previousText)) return null;
    next.nativePrompt = {
      ...next.nativePrompt,
      text: prompt + next.nativePrompt.text.slice(previousText.length),
    };
  }
  return next;
}

export function removeBundleHumanMessage(current: PromptQueueItem): PromptQueueItem | null {
  if (!current.eventBundle?.humanMessage || current.eventBundle.humanMessage.removed) return null;
  const eventBundle = {
    ...current.eventBundle,
    humanMessage: { ...current.eventBundle.humanMessage, text: '', removed: true },
  };
  const prompt = renderPromptEventBundle(eventBundle);
  return {
    ...current,
    eventBundle,
    prompt,
    model: undefined,
    messageId: undefined,
    cwd: undefined,
    attachments: undefined,
    nativePrompt: current.nativePrompt ? { text: prompt, images: [] } : undefined,
  };
}
