import React from 'react';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';
import type { useFileEditorState } from '../src/droneHub/app/use-file-editor-state';
import type { useFileDictation } from '../src/droneHub/files/FileDictationContext';
import type { SaveAsRequestOptions } from '../src/droneHub/files/SaveAsDialog';

// The microphone and the save dialog are stand-ins only while this file's test runs;
// other test files in the same process get the real modules.
let stubbed = false;
let voice: {
  onTranscript: (text: string, deliveryId: string, route: string | null) => Promise<boolean>;
  routeKey?: () => string | null;
} | null = null;
let saveAs: ((options: SaveAsRequestOptions) => Promise<boolean>) | null = null;
// mock.module patches an imported module's namespace in place, so the real exports are
// copied out first; reading them through the namespace later would call the stand-ins.
const realVoice = { ...(await import('../src/droneHub/chat/use-continuous-chat-voice')) };
const realSaveAs = { ...(await import('../src/droneHub/files/SaveAsDialog')) };
mock.module('../src/droneHub/chat/use-continuous-chat-voice', () => ({
  ...realVoice,
  useContinuousChatVoice: (options: Parameters<typeof realVoice.useContinuousChatVoice>[0]) => {
    if (!stubbed) return realVoice.useContinuousChatVoice(options);
    voice = options;
    const [status, setStatus] = React.useState<'idle' | 'listening'>('idle');
    const statusRef = React.useRef(status);
    statusRef.current = status;
    return {
      status,
      pendingCount: 0,
      durationMillis: 0,
      getStatus: () => statusRef.current,
      start: async () => { statusRef.current = 'listening'; setStatus('listening'); return true; },
      stop: async () => { statusRef.current = 'idle'; setStatus('idle'); },
      togglePause: async () => {},
    };
  },
}));
mock.module('../src/droneHub/files/SaveAsDialog', () => ({
  ...realSaveAs,
  requestSaveAs: (options: SaveAsRequestOptions) =>
    stubbed && saveAs ? saveAs(options) : realSaveAs.requestSaveAs(options),
}));

let dom: Window;
let root: Root | undefined;
const previous = new Map<string, PropertyDescriptor | undefined>();
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
beforeEach(() => {
  stubbed = true;
  dom = new Window();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'localStorage']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key] });
  }
});
afterEach(async () => {
  const { flushSync } = await import('react-dom');
  flushSync(() => root?.unmount());
  root = undefined;
  stubbed = false;
  voice = null;
  saveAs = null;
  dom.happyDOM.cancelAsync();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
});

test('dictation into an unsaved file fills its editor and carries on into the file it is saved as', async () => {
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { useFileEditorState } = await import('../src/droneHub/app/use-file-editor-state');
  const { FileDictationProvider, useFileDictation } = await import('../src/droneHub/files/FileDictationContext');
  const drone = { id: 'notes', name: 'notes', runtime: 'host', repoPath: '/repo', chats: ['default'] } as any;
  const writes: Array<{ path: string; content: string; expectedRevision?: string | null }> = [];
  const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    if (url.endsWith('/fs/file') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      return { ok: true, path: body.path, size: body.content.length, revision: `r${writes.length}` } as T;
    }
    return {} as T;
  };
  let editor!: ReturnType<typeof useFileEditorState>;
  let dictation!: NonNullable<ReturnType<typeof useFileDictation>>;
  function App() {
    editor = useFileEditorState({ currentDrone: drone, requestJson: request, onRefreshFsList() {} });
    dictation = useFileDictation()!;
    return null;
  }
  root = createRoot(document.createElement('div'));
  flushSync(() => root!.render(<FileDictationProvider><App /></FileDictationProvider>));
  await settle();

  flushSync(() => { editor.createUntitledFile(); });
  const untitled = editor.openedFileTabs.find((tab) => tab.untitled)!;
  await dictation.start({
    droneId: drone.id,
    droneName: drone.name,
    path: untitled.path,
    name: untitled.name,
    appendLine: editor.appendAndSaveFileDictationLine,
    open() {},
  });
  await settle();
  const untitledRoute = voice!.routeKey!();

  expect(await voice!.onTranscript('first thought', 'd1', untitledRoute)).toBe(true);
  await settle();
  expect(editor.openedFileTabs.find((tab) => tab.tabId === untitled.tabId)?.content).toBe('first thought');
  expect(writes).toEqual([]);

  saveAs = async (options) => {
    const outcome = await options.save({ path: '/repo/notes.md', directory: '/repo', name: 'notes.md', overwrite: true });
    return outcome.ok;
  };
  expect(await editor.saveFileTab(untitled.tabId)).toBe(true);
  await settle();
  expect(writes).toEqual([{ path: '/repo/notes.md', content: 'first thought' }]);
  expect(dictation.target).toMatchObject({ path: '/repo/notes.md', name: 'notes.md' });

  // A thought heard before the save still lands, now in the saved file.
  expect(await voice!.onTranscript('second thought', 'd2', untitledRoute)).toBe(true);
  await settle();
  expect(writes[1]).toEqual({ path: '/repo/notes.md', content: 'first thought\nsecond thought', expectedRevision: 'r1' });
  const saved = editor.openedFileTabs.find((tab) => tab.path === '/repo/notes.md');
  expect(saved).toMatchObject({ untitled: false, content: 'first thought\nsecond thought', dirty: false });
});

test('a thought heard while an unsaved file is being written stays in its editor as unsaved text', async () => {
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { useFileEditorState } = await import('../src/droneHub/app/use-file-editor-state');
  const { FileDictationProvider, useFileDictation } = await import('../src/droneHub/files/FileDictationContext');
  const drone = { id: 'notes', name: 'notes', runtime: 'host', repoPath: '/repo', chats: ['default'] } as any;
  let finishWrite!: () => void;
  const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    if (url.endsWith('/fs/file') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      return { ok: true, path: body.path, size: body.content.length, revision: 'r1' } as T;
    }
    return {} as T;
  };
  let editor!: ReturnType<typeof useFileEditorState>;
  let dictation!: NonNullable<ReturnType<typeof useFileDictation>>;
  function App() {
    editor = useFileEditorState({ currentDrone: drone, requestJson: request, onRefreshFsList() {} });
    dictation = useFileDictation()!;
    return null;
  }
  root = createRoot(document.createElement('div'));
  flushSync(() => root!.render(<FileDictationProvider><App /></FileDictationProvider>));
  await settle();
  flushSync(() => { editor.createUntitledFile(); });
  const untitled = editor.openedFileTabs.find((tab) => tab.untitled)!;
  await dictation.start({
    droneId: drone.id, droneName: drone.name, path: untitled.path, name: untitled.name,
    appendLine: editor.appendAndSaveFileDictationLine, open() {},
  });
  await settle();
  const route = voice!.routeKey!();
  await voice!.onTranscript('first thought', 'd1', route);
  await settle();

  saveAs = async (options) =>
    (await options.save({ path: '/repo/notes.md', directory: '/repo', name: 'notes.md', overwrite: true })).ok;
  const saving = editor.saveFileTab(untitled.tabId);
  await settle();
  expect(await voice!.onTranscript('while saving', 'd2', route)).toBe(true);
  await settle();
  finishWrite();
  expect(await saving).toBe(true);
  await settle();
  expect(editor.openedFileTabs.find((tab) => tab.path === '/repo/notes.md')).toMatchObject({
    content: 'first thought\nwhile saving',
    dirty: true,
  });
});
