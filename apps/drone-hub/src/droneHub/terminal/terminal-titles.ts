import React from 'react';

/**
 * Titles that programs give their own terminal with the window-title escape sequence (a
 * shell's prompt, an editor, an agent's current task). They are keyed like terminal views
 * but outlive them: an idle view is dropped after a while, and the program will not
 * announce its title again just because the view came back.
 */
const titles = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, string> = new Map();

const MAX_TITLE_LENGTH = 120;

export function normalizeTerminalProgramTitle(raw: string): string {
  // Control characters have no place in a label and could only come from a broken sequence.
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

function publish(): void {
  snapshot = new Map(titles);
  for (const listener of listeners) listener();
}

export function setTerminalProgramTitle(key: string, raw: string): void {
  const title = normalizeTerminalProgramTitle(raw);
  if ((titles.get(key) ?? '') === title) return;
  if (title) titles.set(key, title);
  else titles.delete(key);
  publish();
}

export function forgetTerminalProgramTitle(key: string): void {
  if (titles.delete(key)) publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

export function useTerminalProgramTitles(): ReadonlyMap<string, string> {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
