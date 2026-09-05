export const MOBILE_EXPLORER_HEADER_HEIGHT = 48;

export function mobileExplorerExpandedHeight(availableHeight: number): number {
  'worklet';
  return Math.max(
    MOBILE_EXPLORER_HEADER_HEIGHT,
    Math.min(availableHeight, Math.max(220, availableHeight * 0.44)),
  );
}

export function mobileExplorerDragProgress(
  start: number,
  translationY: number,
  travel: number,
): number {
  'worklet';
  return Math.max(0, Math.min(1, start - translationY / Math.max(1, travel)));
}

export function mobileExplorerDragOpens(progress: number, velocityY: number): boolean {
  'worklet';
  return Math.abs(velocityY) > 500 ? velocityY < 0 : progress >= 0.5;
}
