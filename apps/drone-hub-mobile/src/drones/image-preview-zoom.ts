export const MIN_IMAGE_PREVIEW_SCALE = 1;
export const MAX_IMAGE_PREVIEW_SCALE = 5;

export function clampImagePreviewScale(value: number): number {
  'worklet';
  return Math.min(MAX_IMAGE_PREVIEW_SCALE, Math.max(MIN_IMAGE_PREVIEW_SCALE, value));
}

export function clampImagePreviewOffset(value: number, stageSize: number, scale: number): number {
  'worklet';
  const limit = Math.max(0, (stageSize * (scale - 1)) / 2);
  return Math.min(limit, Math.max(-limit, value));
}
