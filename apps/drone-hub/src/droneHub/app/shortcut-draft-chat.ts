export type ShortcutDraftChatDisposition = 'wait' | 'delete' | 'retain';

export function shouldRetainOptimisticallyHiddenDraftChat(input: {
  abandoned: boolean;
  cleanupComplete: boolean;
  authoritativeChatPresent: boolean;
}): boolean {
  return (input.abandoned && !input.cleanupComplete) || input.authoritativeChatPresent;
}

export function shortcutDraftChatDisposition(input: {
  active: boolean;
  wasActivated: boolean;
  stillDraft: boolean;
  hasDraftContent: boolean;
  submissionInFlight: boolean;
}): ShortcutDraftChatDisposition {
  if (!input.wasActivated) return 'wait';
  if (input.submissionInFlight) return 'wait';
  if (!input.stillDraft) return 'retain';
  if (input.active) return 'wait';
  return input.hasDraftContent ? 'retain' : 'delete';
}

/** The Hub answers 409 when the chat is no longer a draft, as when a summary that still listed it as one lagged. */
export function isDraftChatAlreadyPublishedError(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 409;
}

export async function publishThenSendShortcutDraftChat(input: {
  publish: () => Promise<void>;
  send: () => Promise<boolean>;
  onPublishError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await input.publish();
  } catch (error: unknown) {
    if (!isDraftChatAlreadyPublishedError(error)) {
      input.onPublishError(error);
      return false;
    }
  }
  return await input.send();
}
