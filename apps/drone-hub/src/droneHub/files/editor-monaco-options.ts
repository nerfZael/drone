import { editorZoomedPixels } from './editor-zoom';
import {
  DRONE_HUB_MONACO_FONT_FAMILY,
  DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
  type MonacoEditorProps,
} from './monaco-editor-loader';

export const DRONE_HUB_EDITOR_FONT_SIZE_PX = 14;
export const DRONE_HUB_EDITOR_LINE_HEIGHT_PX = 21;

/** Text metrics for the plain textarea an editor falls back to, so it matches Monaco. */
export function droneHubEditorTextStyle(zoomLevel: number): { fontSize: string; lineHeight: string } {
  return {
    fontSize: `${editorZoomedPixels(DRONE_HUB_EDITOR_FONT_SIZE_PX, zoomLevel)}px`,
    lineHeight: `${editorZoomedPixels(DRONE_HUB_EDITOR_LINE_HEIGHT_PX, zoomLevel)}px`,
  };
}

/**
 * The look and feel every full editor surface shares. Callers spread their own
 * options (read-only state, padding) after it.
 */
export function droneHubMonacoEditorOptions(zoomLevel: number): NonNullable<MonacoEditorProps['options']> {
  return {
    fontFamily: DRONE_HUB_MONACO_FONT_FAMILY,
    fontSize: editorZoomedPixels(DRONE_HUB_EDITOR_FONT_SIZE_PX, zoomLevel),
    lineHeight: editorZoomedPixels(DRONE_HUB_EDITOR_LINE_HEIGHT_PX, zoomLevel),
    lineNumbersMinChars: 3,
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    // The caret jumps to where you click, as in VS Code; gliding there reads as lag.
    cursorSmoothCaretAnimation: 'off',
    smoothScrolling: true,
    minimap: { enabled: false },
    scrollbar: DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 16, bottom: 24 },
    'semanticHighlighting.enabled': true,
    bracketPairColorization: { enabled: true },
    guides: {
      indentation: true,
      highlightActiveIndentation: true,
      bracketPairs: false,
      bracketPairsHorizontal: false,
    },
  };
}
