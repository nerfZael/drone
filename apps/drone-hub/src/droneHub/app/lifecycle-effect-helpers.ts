import type { DroneSummary } from '../types';
import { isDroneProvisioningPhase } from '../hub-phase';
import type { ShortcutActionId } from './shortcuts';

type TranscriptAutoScrollDecision = {
  nextContextKey: string;
  nextTrackedLength: number;
  shouldScroll: boolean;
};

type ComputeTranscriptAutoScrollDecisionArgs = {
  chatUiMode: 'transcript' | 'cli';
  selectedDrone: string | null;
  selectedChat: string;
  previousContextKey: string;
  previousTrackedLength: number;
  transcripts: readonly unknown[] | null;
  pendingCount: number;
};

type EditableShortcutDispatchArgs = {
  matchedActionId: ShortcutActionId | null;
  targetInPrimaryChatInput: boolean;
  targetInCanvasMessageInput: boolean;
  targetInAssistantChatInput: boolean;
};

export function computeTranscriptAutoScrollDecision({
  chatUiMode,
  selectedDrone,
  selectedChat,
  previousContextKey,
  previousTrackedLength,
  transcripts,
  pendingCount,
}: ComputeTranscriptAutoScrollDecisionArgs): TranscriptAutoScrollDecision {
  const contextKey = `${selectedDrone ?? ''}\u0000${selectedChat ?? ''}`;
  if (chatUiMode !== 'transcript') {
    return {
      nextContextKey: contextKey,
      nextTrackedLength: previousTrackedLength,
      shouldScroll: false,
    };
  }
  if (previousContextKey !== contextKey) {
    // Ignore first render after context switch; UI may still reflect stale rows.
    return {
      nextContextKey: contextKey,
      nextTrackedLength: -1,
      shouldScroll: false,
    };
  }
  // Wait until transcript data for the active context is loaded before sampling.
  if (!Array.isArray(transcripts)) {
    return {
      nextContextKey: contextKey,
      nextTrackedLength: previousTrackedLength,
      shouldScroll: false,
    };
  }
  const nextLen = transcripts.length + pendingCount;
  if (nextLen > 0 && nextLen !== previousTrackedLength) {
    return {
      nextContextKey: contextKey,
      nextTrackedLength: nextLen,
      shouldScroll: true,
    };
  }
  return {
    nextContextKey: contextKey,
    nextTrackedLength: previousTrackedLength,
    shouldScroll: false,
  };
}

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
