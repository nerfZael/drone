export const MOBILE_EXPLORER_HEADER_HEIGHT = 48;

export function mobileExplorerExpandedHeight(availableHeight: number): number {
  'worklet';
  return Math.max(
    MOBILE_EXPLORER_HEADER_HEIGHT,
    Math.min(availableHeight, Math.max(220, availableHeight * 0.44)),
  );
}

export function mobileExplorerTallHeight(availableHeight: number): number {
  'worklet';
  return Math.max(mobileExplorerExpandedHeight(availableHeight), (availableHeight * 2) / 3);
}

export function mobileExplorerDragProgress(
  start: number,
  translationY: number,
  travel: number,
  upperTravel?: number,
): number {
  'worklet';
  const lower = Math.max(1, travel);
  if (upperTravel === undefined) return Math.max(0, Math.min(1, start - translationY / lower));
  const upper = Math.max(1, upperTravel);
  const height = Math.min(1, start) * lower + Math.max(0, start - 1) * upper - translationY;
  return Math.max(0, Math.min(2, height <= lower ? height / lower : 1 + (height - lower) / upper));
}

export function mobileExplorerSnapPosition(
  progress: number,
  velocityY: number,
  start: number,
): number {
  'worklet';
  // Require deliberate travel away from the resting position, even on a fast release.
  if (Math.abs(progress - start) < 0.3) return start;
  if (Math.abs(velocityY) > 500) {
    return Math.max(0, Math.min(2, velocityY < 0 ? Math.ceil(progress) : Math.floor(progress)));
  }
  return Math.max(0, Math.min(2, Math.round(progress)));
}

export function mobileExplorerDragOpens(progress: number, velocityY: number): boolean {
  'worklet';
  return Math.abs(velocityY) > 500 ? velocityY < 0 : progress >= 0.5;
}
