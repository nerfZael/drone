type MobileDictationDismissGesture = {
  translationX: number;
  translationY: number;
  velocityY?: number;
  cardHeight: number;
};

export function mobileDictationDismissDistance(cardHeight: number): number {
  'worklet';
  const measuredHeight = cardHeight > 0 ? cardHeight : 177;
  return Math.min(160, Math.max(96, measuredHeight * 0.58));
}

export function mobileDictationDismissProgress(input: MobileDictationDismissGesture): number {
  'worklet';
  const downwardDistance = Math.max(0, input.translationY);
  return Math.min(1, downwardDistance / mobileDictationDismissDistance(input.cardHeight));
}

export function mobileDictationShouldDismiss(input: MobileDictationDismissGesture): boolean {
  'worklet';
  const downwardDistance = Math.max(0, input.translationY);
  const directionIsDownward = downwardDistance >= Math.abs(input.translationX) * 0.8;
  const completedPull = mobileDictationDismissProgress(input) >= 1;
  const deliberateFlick = downwardDistance >= 52 && (input.velocityY ?? 0) >= 1_100;
  return directionIsDownward && (completedPull || deliberateFlick);
}
