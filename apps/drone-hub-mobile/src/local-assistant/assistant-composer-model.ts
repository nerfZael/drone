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

type MobileAssistantComposerSwipe = {
  translationX: number;
  translationY: number;
  velocityY?: number;
};

export function mobileAssistantComposerSwipeProgress(input: MobileAssistantComposerSwipe): number {
  'worklet';
  const upwardDistance = -input.translationY;
  if (upwardDistance <= 0) return 0;
  const horizontalDrift = Math.abs(input.translationX);
  const directionPenalty = Math.max(0, horizontalDrift - upwardDistance) * 0.25;
  const velocityBoost = Math.min(20, Math.max(0, (-(input.velocityY ?? 0) - 300) / 20));
  return Math.max(0, Math.min(1, (upwardDistance + velocityBoost - directionPenalty) / 64));
}

export function mobileAssistantComposerSwipeStartsVoice(
  input: MobileAssistantComposerSwipe,
): boolean {
  'worklet';
  return mobileAssistantComposerSwipeProgress(input) >= 0.5;
}

export function mobileAssistantStopVisible(input: {
  running: boolean;
  hasStopAction: boolean;
  voiceActive: boolean;
}): boolean {
  return input.running && input.hasStopAction && !input.voiceActive;
}
