import { desktopMediaFileKindForExtension } from './desktop-media-file-kind';

export function desktopFileReadUrl(droneIdRaw: string, pathRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const filePath = String(pathRaw ?? '');
  const base = `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}`;
  return desktopMediaFileKindForExtension(fileExtension(filePath))
    ? `${base}&metadata=1`
    : base;
}

export function desktopFileContentReadUrl(droneIdRaw: string, pathRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const filePath = String(pathRaw ?? '');
  return `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}`;
}

function fileExtension(filePath: string): string {
  const name = filePath.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}
