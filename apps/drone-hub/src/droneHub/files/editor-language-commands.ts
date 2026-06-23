import type { LanguageLocation, LanguagePosition } from './language-intelligence-api';

type MonacoPosition = { lineNumber: number; column: number };

type MonacoLikeEditor = {
  getPosition?: () => MonacoPosition | null;
  getSelection?: () => MonacoPosition | null | { getStartPosition?: () => MonacoPosition };
};

export type OpenLanguageTarget = (next: {
  path: string;
  name: string;
  line?: number | null;
  column?: number | null;
}) => void;

function normalizePositiveInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

export function activeLanguagePositionFromEditor(
  editor: MonacoLikeEditor | null,
  path: string,
): LanguagePosition | null {
  const filePath = String(path ?? '').trim();
  if (!editor || !filePath) return null;
  const selection = editor.getSelection?.();
  const selectedPosition =
    selection && typeof (selection as any).getStartPosition === 'function'
      ? (selection as { getStartPosition: () => MonacoPosition }).getStartPosition()
      : null;
  const position = selectedPosition ?? editor.getPosition?.() ?? null;
  const line = normalizePositiveInt(position?.lineNumber);
  const column = normalizePositiveInt(position?.column);
  if (!line || !column) return null;
  return { path: filePath, line, column };
}

export function languageLocationName(location: Pick<LanguageLocation, 'path'>): string {
  const path = String(location.path ?? '').trim();
  return path.split('/').filter(Boolean).pop() || path || 'File';
}

export function openLanguageLocationInEditor(
  location: LanguageLocation,
  openTarget: OpenLanguageTarget,
): void {
  openTarget({
    path: location.path,
    name: languageLocationName(location),
    line: location.line,
    column: location.column,
  });
}
