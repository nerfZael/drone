import { expect, test } from 'bun:test';
import { holdUnsavedChanges } from '../src/droneHub/app/desktop-unsaved-changes';

test('the desktop close prompt hears every unsaved change until each is released', () => {
  const reported: string[][] = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { droneHubDesktop: { setUnsavedChanges: (labels: string[]) => reported.push(labels) } };
  try {
    const releaseFiles = holdUnsavedChanges(['notes.md', 'main.ts']);
    const releaseSettings = holdUnsavedChanges(['Companion settings']);
    // A second editor naming the same file is listed once.
    const releaseSameFile = holdUnsavedChanges(['notes.md']);
    releaseFiles();
    releaseSameFile();
    releaseSettings();
    expect(reported).toEqual([
      ['notes.md', 'main.ts'],
      ['notes.md', 'main.ts', 'Companion settings'],
      ['notes.md', 'main.ts', 'Companion settings'],
      ['Companion settings', 'notes.md'],
      ['Companion settings'],
      [],
    ]);
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});

test('the browser build has no desktop bridge and reports nothing', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    expect(() => holdUnsavedChanges(['notes.md'])()).not.toThrow();
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});
