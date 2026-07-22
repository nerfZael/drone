export function mobileAssistantComposerExpanded(input: {
  focused: boolean;
  value: string;
  hasAttachments: boolean;
  voiceActive: boolean;
  voiceError: string;
}): boolean {
  return (
    input.focused ||
    Boolean(input.value.trim()) ||
    input.hasAttachments ||
    input.voiceActive ||
    Boolean(input.voiceError)
  );
}

export function mobileAssistantStopVisible(input: {
  running: boolean;
  hasStopAction: boolean;
  voiceActive: boolean;
}): boolean {
  return input.running && input.hasStopAction && !input.voiceActive;
}
