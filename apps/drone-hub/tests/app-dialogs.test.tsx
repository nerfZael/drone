import React from 'react';
import { afterEach, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AppPromptDialog,
  alertDialog,
  appDialogQueue,
  confirmDeleteDialog,
  confirmDialog,
  confirmDiscardDialog,
  promptDialog,
  registerAppDialogSurface,
} from '../src/ui/AppConfirmDialog';

let detachHost: (() => void) | null = null;
afterEach(() => {
  detachHost?.();
  detachHost = null;
});

test('a confirmation waits for the host and answers with the button pressed', async () => {
  detachHost = appDialogQueue.attachHost();
  const deleted = confirmDeleteDialog('Delete notes.md?');
  expect(appDialogQueue.current()).toMatchObject({
    kind: 'confirm', title: 'Delete notes.md?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true,
  });
  appDialogQueue.settle(true);
  expect(await deleted).toBe(true);
  expect(appDialogQueue.current()).toBeNull();

  const discarded = confirmDiscardDialog('Discard unsaved skill edits?');
  expect(appDialogQueue.current()).toMatchObject({ confirmLabel: 'Discard', destructive: true });
  appDialogQueue.settle(false);
  expect(await discarded).toBe(false);
});

test('dialogs asked for at the same time are shown one after another, and the host hears about each', async () => {
  detachHost = appDialogQueue.attachHost();
  let notices = 0;
  const unsubscribe = appDialogQueue.subscribe(() => { notices += 1; });
  const first = confirmDialog({ title: 'First?', confirmLabel: 'Yes' });
  const second = alertDialog({ title: 'Second', message: 'Details' });
  const third = promptDialog({ title: 'Third', initialValue: 'docs', confirmLabel: 'Rename' });
  expect(notices).toBe(3);
  expect(appDialogQueue.current()?.title).toBe('First?');
  appDialogQueue.settle(true);
  expect(appDialogQueue.current()?.title).toBe('Second');
  appDialogQueue.settle();
  expect(appDialogQueue.current()).toMatchObject({ kind: 'prompt', initialValue: 'docs' });
  appDialogQueue.settle('guides');
  expect([await first, await second, await third]).toEqual([true, undefined, 'guides']);
  unsubscribe();
});

test('a cancelled prompt answers null, and an empty answer is still an answer', async () => {
  detachHost = appDialogQueue.attachHost();
  const cancelled = promptDialog({ title: 'New file', confirmLabel: 'Create' });
  appDialogQueue.settle(null);
  expect(await cancelled).toBeNull();
  const empty = promptDialog({ title: 'New file', confirmLabel: 'Create' });
  appDialogQueue.settle('');
  expect(await empty).toBe('');
});

test('nobody is left waiting: no host, or a host going away, counts as declined', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(await confirmDialog({ title: 'Anyone there?', confirmLabel: 'Yes' })).toBe(false);
    expect(await promptDialog({ title: 'Anyone there?', confirmLabel: 'Yes' })).toBeNull();
  } finally {
    console.warn = warn;
  }
  const detach = appDialogQueue.attachHost();
  const pending = [confirmDialog({ title: 'One?', confirmLabel: 'Yes' }), promptDialog({ title: 'Two', confirmLabel: 'OK' })] as const;
  detach();
  expect(await pending[0]).toBe(false);
  expect(await pending[1]).toBeNull();
  expect(appDialogQueue.current()).toBeNull();
});

test('the prompt is the app’s own dialog with a labelled field', () => {
  const html = renderToStaticMarkup(
    <AppPromptDialog
      request={{ id: 1, kind: 'prompt', resolve() {}, title: 'Rename folder', message: 'Path relative to the skill folder.', label: 'New path', initialValue: 'docs', confirmLabel: 'Rename' }}
      onSettle={() => {}}
    />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).toContain('Rename folder');
  expect(html).toContain('Path relative to the skill folder.');
  expect(html).toContain('aria-label="New path"');
  expect(html).toContain('value="docs"');
  expect(html).toContain('>Rename</span></button>');
  expect(html).toContain('Cancel');
});

test('the app never falls back to the browser’s built-in confirm, prompt or alert', () => {
  const offenders: string[] = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name);
      if (statSync(entry).isDirectory()) visit(entry);
      else if (/\.tsx?$/.test(name) && /\bwindow\.(confirm|prompt|alert)\(/.test(readFileSync(entry, 'utf8'))) offenders.push(entry);
    }
  };
  visit(new URL('../src', import.meta.url).pathname);
  expect(offenders).toEqual([]);
});

test('a dialog asked for from a chat’s own desktop window opens in that window', async () => {
  detachHost = appDialogQueue.attachHost();
  const popupBody = { nodeName: 'BODY' } as unknown as HTMLElement;
  let popupFocused = true;
  const unregister = registerAppDialogSurface({ body: popupBody, hasFocus: () => popupFocused } as unknown as Document);
  const fromPopup = confirmDialog({ title: 'Pull host changes?', confirmLabel: 'Pull changes' });
  expect(appDialogQueue.current()?.container).toBe(popupBody);
  appDialogQueue.settle(true);
  await fromPopup;

  popupFocused = false;
  const fromHub = confirmDialog({ title: 'Pull host changes?', confirmLabel: 'Pull changes' });
  expect(appDialogQueue.current()?.container).toBeUndefined();
  appDialogQueue.settle(false);
  await fromHub;

  unregister();
  popupFocused = true;
  const afterClose = confirmDialog({ title: 'Pull host changes?', confirmLabel: 'Pull changes' });
  expect(appDialogQueue.current()?.container).toBeUndefined();
  appDialogQueue.settle(false);
  await afterClose;
});
