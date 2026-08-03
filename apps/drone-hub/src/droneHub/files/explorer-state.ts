import type { DroneFsEntry } from '../types';

export type FileClipboardState = {
  entries: DroneFsEntry[];
} | null;

export function selectedEntriesFromPaths(entries: DroneFsEntry[], selectedPaths: ReadonlySet<string>): DroneFsEntry[] {
  if (selectedPaths.size === 0) return [];
  return entries.filter((entry) => selectedPaths.has(entry.path));
}

export function topLevelSelectedEntries(entries: DroneFsEntry[]): DroneFsEntry[] {
  const selected = [...entries].sort((a, b) => a.path.length - b.path.length);
  const out: DroneFsEntry[] = [];
  for (const entry of selected) {
    if (out.some((parent) => parent.kind === 'directory' && isPathInsideOrEqual(parent.path, entry.path))) continue;
    out.push(entry);
  }
  const outPaths = new Set(out.map((entry) => entry.path));
  return entries.filter((entry) => outPaths.has(entry.path));
}

export function toggleSelectedPath(
  selectedPaths: ReadonlySet<string>,
  path: string,
  selected?: boolean,
): Set<string> {
  const next = new Set(selectedPaths);
  const shouldSelect = selected ?? !next.has(path);
  if (shouldSelect) next.add(path);
  else next.delete(path);
  return next;
}

export function pruneSelectedPaths(selectedPaths: ReadonlySet<string>, entries: DroneFsEntry[]): Set<string> {
  const visiblePaths = new Set(entries.map((entry) => entry.path));
  const next = new Set<string>();
  for (const selectedPath of selectedPaths) {
    if (visiblePaths.has(selectedPath)) next.add(selectedPath);
  }
  return next;
}

export function allVisibleSelected(entries: DroneFsEntry[], selectedPaths: ReadonlySet<string>): boolean {
  return entries.length > 0 && entries.every((entry) => selectedPaths.has(entry.path));
}

export function fileNameStemSelectionEnd(nameRaw: string): number {
  const name = String(nameRaw ?? '');
  const extensionIndex = name.lastIndexOf('.');
  return extensionIndex > 0 ? extensionIndex : name.length;
}

export function setAllVisibleSelected(
  entries: DroneFsEntry[],
  selectedPaths: ReadonlySet<string>,
  selected: boolean,
): Set<string> {
  const next = new Set(selectedPaths);
  for (const entry of entries) {
    if (selected) next.add(entry.path);
    else next.delete(entry.path);
  }
  return next;
}

export function isPathInsideOrEqual(parentPathRaw: string | null | undefined, childPathRaw: string | null | undefined): boolean {
  const parent = String(parentPathRaw ?? '').trim().replace(/[\/\\]+$/g, '');
  const child = String(childPathRaw ?? '').trim().replace(/[\/\\]+$/g, '');
  if (!parent || !child) return false;
  if (parent === child) return true;
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return child.startsWith(`${parent}${separator}`);
}

export function movedPathForEntry(entry: DroneFsEntry, targetDir: string, activePath: string | null | undefined): string | null {
  const active = String(activePath ?? '').trim();
  if (!active || !isPathInsideOrEqual(entry.path, active)) return null;
  const baseTarget = joinFsPath(targetDir, entry.name);
  if (active === entry.path) return baseTarget;
  const suffix = active.slice(entry.path.replace(/[\/\\]+$/g, '').length).replace(/^[\/\\]+/, '');
  return suffix ? joinFsPath(baseTarget, suffix) : baseTarget;
}

export function renamedPathForEntry(entry: DroneFsEntry, nextName: string, activePath: string | null | undefined): string | null {
  const parent = parentFsPath(entry.path);
  return movedPathForEntry({ ...entry, path: entry.path, name: nextName }, parent, activePath);
}

export function parentFsPath(rawPath: string): string {
  const text = String(rawPath ?? '').trim().replace(/[\/\\]+$/g, '');
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  if (slash <= 0) return text.startsWith('/') ? '/' : '.';
  return text.slice(0, slash);
}

function joinFsPath(dirRaw: string, nameRaw: string): string {
  const dir = String(dirRaw ?? '').trim();
  const name = String(nameRaw ?? '').trim().replace(/^[\/\\]+/, '');
  if (!dir || dir === '.') return name;
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[\/\\]+$/g, '')}${separator}${name}`;
}
