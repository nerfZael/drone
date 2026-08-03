import type { DroneSummary } from '../types';
import { isDroneProvisioningPhase } from '../hub-phase';
import type { ShortcutActionId } from './shortcuts';

type EditableShortcutDispatchArgs = {
  matchedActionId: ShortcutActionId | null;
  matchedShortcutKey?: string | null;
  targetInPrimaryChatInput: boolean;
  targetInCanvasMessageInput: boolean;
  targetInAssistantChatInput: boolean;
};

export function shouldDispatchEditableShortcutAction(_args: EditableShortcutDispatchArgs): boolean {
  const {
    matchedActionId,
    matchedShortcutKey,
    targetInPrimaryChatInput,
    targetInCanvasMessageInput,
    targetInAssistantChatInput,
  } = _args;
  const inDraftShortcutChatInput = targetInPrimaryChatInput || targetInCanvasMessageInput;
  const inVoiceShortcutChatInput = inDraftShortcutChatInput || targetInAssistantChatInput;
  if (matchedActionId === 'openQuickOpen') return true;
  if (matchedActionId === 'createDraftDrone') {
    return matchedShortcutKey === 'tab' && inDraftShortcutChatInput;
  }
  if (matchedActionId === 'toggleVoiceClipboardRecording') {
    return inVoiceShortcutChatInput;
  }
  return false;
}
export function shouldHandoffDraftChatWorkspace(args: {
  hubPhase?: DroneSummary['hubPhase'];
  creating: boolean;
  autoRenaming: boolean;
  hasSelectedDrone: boolean;
}): boolean {
  return (
    args.hasSelectedDrone &&
    !args.creating &&
    !args.autoRenaming &&
    !isDroneProvisioningPhase(args.hubPhase)
  );
}
