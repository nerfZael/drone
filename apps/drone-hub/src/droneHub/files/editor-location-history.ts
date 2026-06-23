export type EditorLocation = {
  droneId: string;
  path: string;
  name: string;
  line: number | null;
  column: number | null;
};

export type EditorLocationHistory = {
  entries: EditorLocation[];
  index: number;
};

const MAX_HISTORY_ENTRIES = 80;

export const emptyEditorLocationHistory: EditorLocationHistory = {
  entries: [],
  index: -1,
};

function normalizePositiveInt(raw: number | null | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function sameEditorLocation(a: EditorLocation | null | undefined, b: EditorLocation | null | undefined): boolean {
  return Boolean(
    a &&
      b &&
      a.droneId === b.droneId &&
      a.path === b.path &&
      normalizePositiveInt(a.line) === normalizePositiveInt(b.line) &&
      normalizePositiveInt(a.column) === normalizePositiveInt(b.column),
  );
}

export function sanitizeEditorLocation(raw: EditorLocation): EditorLocation | null {
  const droneId = String(raw.droneId ?? '').trim();
  const path = String(raw.path ?? '').trim();
  if (!droneId || !path) return null;
  const name = String(raw.name ?? '').trim() || path.split('/').filter(Boolean).pop() || path;
  return {
    droneId,
    path,
    name,
    line: normalizePositiveInt(raw.line),
    column: normalizePositiveInt(raw.column),
  };
}

export function pushEditorLocation(
  history: EditorLocationHistory,
  nextRaw: EditorLocation,
): EditorLocationHistory {
  const next = sanitizeEditorLocation(nextRaw);
  if (!next) return history;
  const current = history.entries[history.index] ?? null;
  if (sameEditorLocation(current, next)) return history;

  const baseEntries = history.index >= 0 ? history.entries.slice(0, history.index + 1) : [];
  const entries = [...baseEntries, next].slice(-MAX_HISTORY_ENTRIES);
  return {
    entries,
    index: entries.length - 1,
  };
}

export function canGoBackInEditorHistory(history: EditorLocationHistory): boolean {
  return history.index > 0 && history.entries.length > 1;
}

export function canGoForwardInEditorHistory(history: EditorLocationHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1;
}

export function goBackInEditorHistory(history: EditorLocationHistory): {
  history: EditorLocationHistory;
  location: EditorLocation | null;
} {
  if (!canGoBackInEditorHistory(history)) return { history, location: null };
  const index = history.index - 1;
  return {
    history: { ...history, index },
    location: history.entries[index] ?? null,
  };
}

export function goForwardInEditorHistory(history: EditorLocationHistory): {
  history: EditorLocationHistory;
  location: EditorLocation | null;
} {
  if (!canGoForwardInEditorHistory(history)) return { history, location: null };
  const index = history.index + 1;
  return {
    history: { ...history, index },
    location: history.entries[index] ?? null,
  };
}
