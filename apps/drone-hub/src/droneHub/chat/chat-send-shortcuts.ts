export type ChatMessageDeliveryMode = 'asap' | 'queue';
export type ChatComposerShortcutAction = ChatMessageDeliveryMode | 'new-chat';

export type ChatSendShortcutInput = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  hasContent: boolean;
};

export function chatSendShortcut(input: ChatSendShortcutInput): ChatComposerShortcutAction | null {
  if (!input.hasContent) return null;
  if (input.key === 'Tab' && !input.shiftKey && !input.ctrlKey && !input.metaKey && !input.altKey)
    return 'queue';
  if (input.key !== 'Enter' || input.shiftKey) return null;
  if (input.ctrlKey || input.metaKey) return 'new-chat';
  return 'asap';
}
