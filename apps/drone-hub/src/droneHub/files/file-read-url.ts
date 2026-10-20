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

// The media route checks `revision` against the file's sha256, so only a sha256 revision goes
// there. A file over the editor limit carries a `metadata:` revision (size and time) that never
// matches; it goes in `v` instead, which still changes the URL when the file changes.
export function desktopFileMediaUrl(
  droneIdRaw: string,
  pathRaw: string,
  revisionRaw?: string | null,
): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const filePath = String(pathRaw ?? '');
  const revision = String(revisionRaw ?? '').trim();
  const base = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(filePath)}`;
  if (!revision) return base;
  const param = revision.startsWith('sha256:') ? 'revision' : 'v';
  return `${base}&${param}=${encodeURIComponent(revision)}`;
}

function fileExtension(filePath: string): string {
  const name = filePath.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}
