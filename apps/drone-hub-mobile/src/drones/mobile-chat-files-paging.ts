export function mobileChatFilesProgress(
  start: number,
  translationX: number,
  width: number,
): number {
  'worklet';
  return Math.max(0, Math.min(1, start - translationX / Math.max(1, width)));
}

export function mobileChatFilesSnapOpen(progress: number, velocityX: number): boolean {
  'worklet';
  return Math.abs(velocityX) > 320 ? velocityX < 0 : progress >= 0.5;
}
