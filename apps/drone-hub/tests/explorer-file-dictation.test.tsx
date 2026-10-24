import React from 'react';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';

// The microphone is a stand-in only while this file's test runs;
// other test files in the same process get the real modules.
let stubbed = false;
let voice: {
  onTranscript: (text: string, deliveryId: string, route: string | null) => Promise<boolean>;
  routeKey?: () => string | null;
} | null = null;
// mock.module patches an imported module's namespace in place, so the real exports are
// copied out first; reading them through the namespace later would call the stand-ins.
const realVoice = { ...(await import('../src/droneHub/chat/use-continuous-chat-voice')) };
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
  dom.happyDOM.cancelAsync();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];

  }
});

const file = (name: string) => ({
  name, path: `/repo/${name}`, kind: 'file' as const, size: 1, mtimeMs: null, ext: name.split('.').pop() ?? null, isImage: false, isVideo: false,
});
const noOpenedFile = {
  path: null, name: null, loading: false, saving: false, error: null, kind: 'text' as const, mime: null, size: 0, content: '',
  dirty: false, mtimeMs: null, targetLine: null, targetColumn: null, navigationSeq: 0,
};

test('the explorer starts and stops dictation into a file and marks the file dictated last', async () => {
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { DroneFilesDock } = await import('../src/droneHub/files/DroneFilesDock');
  const { FileDictationProvider } = await import('../src/droneHub/files/FileDictationContext');
  const appended: Array<{ droneId: string; path: string; line: string }> = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root!.render(
    <FileDictationProvider>
      <DroneFilesDock
        droneId="notes" droneName="notes" path="/repo" homePath="/repo"
        entries={[file('ideas.md'), file('todo.md')]} loading={false} error={null}
        onOpenPath={() => {}} onOpenFile={() => {}} onRefresh={() => {}}
        openedFile={noOpenedFile}
        fileDictation={{ appendLine: async (input) => { appended.push(input); return true; }, open() {} }}
      />
    </FileDictationProvider>,
  ));
  await settle();

  const row = (name: string) => container.querySelector(`[data-file-explorer-path="/repo/${name}"] [role="treeitem"]`)!;
  const mark = (name: string) => container.querySelector<HTMLButtonElement>(`[data-file-explorer-path="/repo/${name}"] button[aria-label*="${name}"]`);
  const menuItem = (name: string, label: string) => {
    flushSync(() => { row(name).dispatchEvent(new (window as any).MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find((item) => item.textContent === label);
  };
  expect(mark('ideas.md')).toBeNull();

  menuItem('ideas.md', 'Dictate to File')!.click();
  await settle();
  expect(mark('ideas.md')?.getAttribute('aria-pressed')).toBe('true');
  expect(mark('ideas.md')?.getAttribute('aria-label')).toStartWith('Stop dictation to ideas.md');
  expect(await voice!.onTranscript('a thought', 'd1', voice!.routeKey!())).toBe(true);
  expect(appended).toEqual([{ droneId: 'notes', path: '/repo/ideas.md', line: 'a thought' }]);

  // Another file waits while the microphone is taken.
  expect(menuItem('todo.md', 'Dictate to File')?.disabled).toBe(true);
  flushSync(() => { document.dispatchEvent(new (window as any).PointerEvent('pointerdown', { bubbles: true })); });

  menuItem('ideas.md', 'Stop Dictation')!.click();
  await settle();
  // Idle, the last file keeps a muted mark so the toggle shortcut's target shows.
  expect(mark('ideas.md')?.getAttribute('aria-pressed')).toBe('false');
  expect(mark('ideas.md')?.getAttribute('aria-label')).toStartWith('Dictate to ideas.md again');
  expect(mark('todo.md')).toBeNull();

  flushSync(() => { mark('ideas.md')!.click(); });
  await settle();
  expect(mark('ideas.md')?.getAttribute('aria-pressed')).toBe('true');
  flushSync(() => { mark('ideas.md')!.click(); });
  await settle();
  expect(mark('ideas.md')?.getAttribute('aria-pressed')).toBe('false');
});
