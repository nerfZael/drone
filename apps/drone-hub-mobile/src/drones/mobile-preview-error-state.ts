export type MobilePreviewErrorMode = 'blocking' | 'refresh';

export function mobilePreviewErrorMode(input: {
  background: boolean;
  previewKind: 'text' | 'image' | 'video' | 'binary' | null;
}): MobilePreviewErrorMode {
  return input.background && input.previewKind ? 'refresh' : 'blocking';
}
