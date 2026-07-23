export type ChatMessageDeliveryMode = 'asap' | 'queue';

export type ChatSendShortcutInput = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  hasContent: boolean;
};

export function chatSendShortcut(input: ChatSendShortcutInput): ChatMessageDeliveryMode | null {
  if (!input.hasContent) return null;
  if (input.key === 'Tab' && !input.shiftKey && !input.ctrlKey && !input.metaKey && !input.altKey)
    return 'queue';
  if (input.key !== 'Enter' || input.shiftKey) return null;
  return input.ctrlKey || input.metaKey ? 'queue' : 'asap';
}
