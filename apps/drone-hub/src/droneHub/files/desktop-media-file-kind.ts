export type DesktopMediaFileKind = 'image' | 'video';

const IMAGE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'tif',
  'tiff',
]);

const VIDEO_FILE_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'ogv',
  'ogg',
  'avi',
  'mkv',
  'wmv',
]);

export function desktopMediaFileKindForExtension(
  extension: string,
): DesktopMediaFileKind | null {
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return 'video';
  return null;
}
