import type { ShortcutActionId } from './shortcuts';

type EditableShortcutDispatchArgs = {
  matchedActionId: ShortcutActionId | null;
  targetInPrimaryChatInput: boolean;
  targetInCanvasMessageInput: boolean;
  targetInAssistantChatInput: boolean;
};

export function shouldDispatchEditableShortcutAction(_args: EditableShortcutDispatchArgs): boolean {
  const { matchedActionId, targetInPrimaryChatInput, targetInCanvasMessageInput, targetInAssistantChatInput } = _args;
  const inDraftShortcutChatInput = targetInPrimaryChatInput || targetInCanvasMessageInput;
  const inVoiceShortcutChatInput = inDraftShortcutChatInput || targetInAssistantChatInput;
  if (matchedActionId === 'createDraftDrone') return inDraftShortcutChatInput;
  if (matchedActionId === 'toggleVoiceClipboardRecording') {
    return inVoiceShortcutChatInput;
  }
  return false;
}
