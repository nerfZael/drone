import React from 'react';
import {
  fileIconIdForPath,
  fileIconSvg,
  folderIconIdForPath,
  type FileIconId,
} from '@drone/file-icons';

type FileTypeIconProps = {
  path: string | null | undefined;
  className?: string;
  size?: number;
};

const dataUriByIconId = new Map<FileIconId, string>();

function dataUriForIcon(iconId: FileIconId): string {
  const cached = dataUriByIconId.get(iconId);
  if (cached) return cached;
  const uri = `data:image/svg+xml,${encodeURIComponent(fileIconSvg(iconId))}`;
  dataUriByIconId.set(iconId, uri);
  return uri;
}

function MaterialIconImage({
  iconId,
  className,
  size = 15,
}: Omit<FileTypeIconProps, 'path'> & { iconId: FileIconId }) {
  return (
    <img
      src={dataUriForIcon(iconId)}
      className={className}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function FileTypeIcon({ path, className, size = 15 }: FileTypeIconProps) {
  return <MaterialIconImage iconId={fileIconIdForPath(path)} className={className} size={size} />;
}

export function FolderTypeIcon({ path, className, size = 15 }: FileTypeIconProps) {
  // The tree chevron already communicates expansion on desktop, so keep the
  // calmer closed-folder silhouette in both states.
  return <MaterialIconImage iconId={folderIconIdForPath(path)} className={className} size={size} />;
}
