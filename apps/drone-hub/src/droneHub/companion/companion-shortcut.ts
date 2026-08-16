export const COMPANION_SHORTCUT_DOUBLE_TAP_MS = 400;

export function shouldConsumeCompanionProposalShortcut({
  matched,
  shortcutKey,
  canApply,
}: {
  matched: boolean;
  shortcutKey: string | null | undefined;
  canApply: boolean;
}): boolean {
  if (!matched) return false;
  return canApply || shortcutKey === 'capslock';
}

type CompanionRecordingEscapeInput = {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  voiceStatus: string;
};

export function shouldCancelCompanionRecordingWithEscape({
  key,
  repeat,
  isComposing,
  voiceStatus,
}: CompanionRecordingEscapeInput): boolean {
  return (
    key === 'Escape' &&
    !repeat &&
    !isComposing &&
    (voiceStatus === 'starting' || voiceStatus === 'recording' || voiceStatus === 'paused')
  );
}

export function isCompanionShortcutDoubleTap(
  previousTimestamp: number,
  currentTimestamp: number,
): boolean {
  const elapsed = currentTimestamp - previousTimestamp;
  return previousTimestamp > 0 && elapsed >= 0 && elapsed <= COMPANION_SHORTCUT_DOUBLE_TAP_MS;
}
