export type ShortcutDraftChatDisposition = 'wait' | 'delete' | 'retain';

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

export async function publishThenSendShortcutDraftChat(input: {
  publish: () => Promise<void>;
  send: () => Promise<boolean>;
  onPublishError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await input.publish();
  } catch (error: unknown) {
    input.onPublishError(error);
    return false;
  }
  return await input.send();
}
