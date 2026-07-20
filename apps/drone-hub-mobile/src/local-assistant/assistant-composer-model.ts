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
