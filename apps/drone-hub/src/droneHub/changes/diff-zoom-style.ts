import type React from 'react';
import { editorZoomedPixels } from '../files/editor-zoom';

export function diffZoomStyle(editorZoomLevel: number): React.CSSProperties {
  const fontSize = editorZoomedPixels(11, editorZoomLevel);
  return { '--changes-diff-font-size': `${fontSize}px` } as React.CSSProperties;
}
