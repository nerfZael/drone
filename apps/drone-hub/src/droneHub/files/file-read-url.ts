const MEDIA_FILE_EXTENSIONS = new Set([
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

export function desktopFileReadUrl(droneIdRaw: string, pathRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const filePath = String(pathRaw ?? '').trim();
  const base = `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}`;
  return MEDIA_FILE_EXTENSIONS.has(fileExtension(filePath)) ? `${base}&metadata=1` : base;
}

function fileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}
