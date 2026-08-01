import React from 'react';
import { parse, SvgAst, type JsxAST } from 'react-native-svg';
import {
  fileIconIdForPath,
  fileIconSvg,
  folderIconIdForPath,
  type FileIconId,
} from '@drone/file-icons';

type NativeFileTypeIconProps = {
  path: string | null | undefined;
  size?: number;
  opacity?: number;
};

const astByIconId = new Map<FileIconId, JsxAST | null>();

function astForIcon(iconId: FileIconId): JsxAST | null {
  if (astByIconId.has(iconId)) return astByIconId.get(iconId) ?? null;
  const ast = parse(fileIconSvg(iconId));
  astByIconId.set(iconId, ast);
  return ast;
}

function MaterialSvgIcon({
  iconId,
  size,
  opacity,
}: {
  iconId: FileIconId;
  size: number;
  opacity?: number;
}) {
  return <SvgAst ast={astForIcon(iconId)} override={{ width: size, height: size, opacity }} />;
}

export function NativeFileTypeIcon({ path, size = 16, opacity }: NativeFileTypeIconProps) {
  return <MaterialSvgIcon iconId={fileIconIdForPath(path)} size={size} opacity={opacity} />;
}

export function NativeFolderTypeIcon({
  path,
  open = false,
  size = 16,
  opacity,
}: NativeFileTypeIconProps & { open?: boolean }) {
  return <MaterialSvgIcon iconId={folderIconIdForPath(path, open)} size={size} opacity={opacity} />;
}
