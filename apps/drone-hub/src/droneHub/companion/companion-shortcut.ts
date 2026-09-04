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

export function companionProposalShortcutGesture(
  previousTimestamp: number,
  currentTimestamp: number,
): 'schedule-apply' | 'toggle-auto-approve' {
  return isCompanionShortcutDoubleTap(previousTimestamp, currentTimestamp)
    ? 'toggle-auto-approve'
    : 'schedule-apply';
}

export function shouldAutoExecuteCompanionProposal({
  enabled,
  status,
  operationCount,
  hasExecutionContext,
  executing,
  executed,
}: {
  enabled: boolean;
  status: string;
  operationCount: number;
  hasExecutionContext: boolean;
  executing: boolean;
  executed: boolean;
}): boolean {
  return (
    enabled &&
    status === 'completed' &&
    operationCount > 0 &&
    hasExecutionContext &&
    !executing &&
    !executed
  );
}
