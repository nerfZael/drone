export function mobileAssistantComposerExpanded(input: {
  focused: boolean;
  value: string;
  hasAttachments: boolean;
  voiceActive: boolean;
  voiceError: string;
  /** The Companion sheet is open: stay a single line unless the user is typing or recording. */
  collapsedByCompanion?: boolean;
}): boolean {
  if (input.collapsedByCompanion && !input.focused && !input.voiceActive && !input.voiceError) return false;
  return (
    input.focused ||
    Boolean(input.value.trim()) ||
    input.hasAttachments ||
    input.voiceActive ||
    Boolean(input.voiceError)
  );
}

export function mobileAssistantComposerCollapsesOnBack(input: {
  focused: boolean;
  value: string;
  hasAttachments: boolean;
  voiceActive: boolean;
  alwaysExpanded: boolean;
}): boolean {
  return (
    input.focused &&
    !input.alwaysExpanded &&
    !input.value.trim() &&
    !input.hasAttachments &&
    !input.voiceActive
  );
}

export function mobileAssistantStopVisible(input: {
  running: boolean;
  hasStopAction: boolean;
  voiceActive: boolean;
}): boolean {
  return input.running && input.hasStopAction && !input.voiceActive;
}
