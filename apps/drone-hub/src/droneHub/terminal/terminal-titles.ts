import React from 'react';

/**
 * What a terminal session should be called, from the two things an editor's terminal uses:
 * the title a program gives itself with the window-title escape sequence (an editor, an
 * agent's current task), and the name of the foreground process, which the daemon reports.
 * Entries are keyed like terminal views but outlive them: an idle view is dropped after a
 * while, and a program will not announce its title again just because the view came back.
 */
export type TerminalSessionNaming = { programTitle?: string; process?: string };

type Entry = TerminalSessionNaming & { programTitleAt?: number };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, TerminalSessionNaming> = new Map();

const MAX_TITLE_LENGTH = 120;
// The daemon learns of a new foreground process up to about a second after it starts, so
// a title this recent belongs to the process being announced, not to the one before it.
const TITLE_BELONGS_TO_NEW_PROCESS_MS = 1500;
const SHELLS = new Set([
  'bash',
  'zsh',
  'sh',
  'fish',
  'dash',
  'ksh',
  'tcsh',
  'csh',
  'ash',
  'nu',
  'pwsh',
]);

function oneLine(raw: string, maxLength: number): string {
  // Control characters have no place in a label and could only come from a broken sequence.
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeTerminalProgramTitle(raw: string): string {
  return oneLine(raw, MAX_TITLE_LENGTH);
}

/** A login shell reports itself as "-bash"; it is still bash. */
function normalizeProcess(raw: string): string {
  return oneLine(raw, 64).replace(/^-/, '');
}

/**
 * A shell's own title is its prompt ("user@host: directory"), which says less than "bash"
 * does in a list, so a shell goes by its name. Any other program goes by the title it
 * chose, or by its name when it chose none.
 */
export function terminalSessionLabel(
  naming: TerminalSessionNaming | undefined,
  fallback: string,
): string {
  const process = naming?.process ?? '';
  if (process && SHELLS.has(process)) return process;
  return naming?.programTitle || process || fallback;
}

function publish(): void {
  snapshot = new Map(
    [...entries].map(([key, { programTitle, process }]) => [key, { programTitle, process }]),
  );
  for (const listener of listeners) listener();
}

export function setTerminalProgramTitle(key: string, raw: string, now = performance.now()): void {
  const programTitle = normalizeTerminalProgramTitle(raw) || undefined;
  const entry = entries.get(key) ?? {};
  if (entry.programTitle === programTitle) return;
  entries.set(key, { ...entry, programTitle, programTitleAt: programTitle ? now : undefined });
  publish();
}

export function setTerminalProcess(key: string, raw: string, now = performance.now()): void {
  const process = normalizeProcess(raw) || undefined;
  const entry = entries.get(key) ?? {};
  if (entry.process === process) return;
  // A title is the word of the program that set it. Once another program is in front, an
  // older title would mislabel it; tmux itself keeps showing the stale one.
  const titleIsStale =
    entry.programTitleAt !== undefined &&
    now - entry.programTitleAt > TITLE_BELONGS_TO_NEW_PROCESS_MS;
  entries.set(key, titleIsStale ? { process } : { ...entry, process });
  publish();
}

export function forgetTerminalSessionNaming(key: string): void {
  if (entries.delete(key)) publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

export function useTerminalSessionNaming(): ReadonlyMap<string, TerminalSessionNaming> {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
