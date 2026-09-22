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
// Shortcuts that may act while text is being typed: the keyboard handlers
// above let these through for a focused text field, and a shortcut promoted
// to a desktop-wide one keeps the same manners (see use-global-shortcut-client).
const GLOBAL_SHORTCUTS_ALLOWED_WHILE_TYPING = new Set<string>([
  'openQuickOpen',
  'toggleVoiceClipboardRecording',
  'toggleCompanion',
  'applyCompanionProposal',
  'snipCompanion',
  'captureCompanionScreen',
  'toggleChatVoiceRecordingPause',
  'discardChatVoiceRecording',
  'toggleChatComposerEditorMode',
]);

export function isTextEntryElement(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = String(element.tagName ?? '').toUpperCase();
  return (element as HTMLElement).isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Whether a desktop-wide shortcut, delivered by the OS rather than by a key
 * event, should act now. While the app is focused on a text field (a card
 * being renamed, a composer), plain keys are text; only the shortcuts the
 * key handlers accept there are acted on.
 */
export function shouldRunGlobalShortcutAction(args: {
  actionId: string;
  documentFocused: boolean;
  activeElement: Element | null | undefined;
}): boolean {
  if (!args.documentFocused || !isTextEntryElement(args.activeElement)) return true;
  return GLOBAL_SHORTCUTS_ALLOWED_WHILE_TYPING.has(args.actionId);
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
