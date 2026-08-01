import {
  MATERIAL_FILE_EXTENSION_ICONS,
  MATERIAL_FILE_NAME_ICONS,
  MATERIAL_FOLDER_NAME_ICONS,
  MATERIAL_ICON_SVGS,
  MATERIAL_OPEN_FOLDER_NAME_ICONS,
} from './material-icons.generated';

export type FileIconId = keyof typeof MATERIAL_ICON_SVGS;

function basename(path: string | null | undefined): string {
  const value = String(path ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase();
  if (!value) return '';
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : value;
}

function association(
  associations: Readonly<Record<string, string>>,
  key: string,
): FileIconId | undefined {
  const iconId = associations[key];
  return iconId && iconId in MATERIAL_ICON_SVGS ? (iconId as FileIconId) : undefined;
}

export function fileIconIdForPath(path: string | null | undefined): FileIconId {
  const name = basename(path);
  if (!name) return 'file';

  const exact = association(MATERIAL_FILE_NAME_ICONS, name);
  if (exact) return exact;

  const segments = name.split('.');
  for (let index = 1; index < segments.length; index += 1) {
    const extension = segments.slice(index).join('.');
    const matched = association(MATERIAL_FILE_EXTENSION_ICONS, extension);
    if (matched) return matched;
  }

  return 'file';
}

export function folderIconIdForPath(path: string | null | undefined, open = false): FileIconId {
  const name = basename(path);
  if (!name) return open ? 'folder-open' : 'folder';
  const associations = open ? MATERIAL_OPEN_FOLDER_NAME_ICONS : MATERIAL_FOLDER_NAME_ICONS;
  return association(associations, name) ?? (open ? 'folder-open' : 'folder');
}

export function fileIconSvg(iconId: FileIconId): string {
  return MATERIAL_ICON_SVGS[iconId];
}

export function fileIconSvgForPath(path: string | null | undefined): string {
  return fileIconSvg(fileIconIdForPath(path));
}

export function folderIconSvgForPath(path: string | null | undefined, open = false): string {
  return fileIconSvg(folderIconIdForPath(path, open));
}
