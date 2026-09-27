import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { AgentMessageExtras } from '../src/droneHub/chat/AgentMessageExtras';
import { useBlipThreadSession } from '../src/droneHub/assistant/useBlipThreadSession';

let dom: Window;
let root: Root;
let host: HTMLElement;
const originals = new Map<string, PropertyDescriptor | undefined>();
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
const render = async (content: React.ReactNode) => {
  flushSync(() => root.render(content));
  await settle();
};
beforeEach(() => {
  dom = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'MutationObserver',
    'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'fetch', 'WebSocket']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    if (key === 'fetch' || key === 'WebSocket') continue;
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key] });
  }
  globalThis.WebSocket = class { send() {} close() {} } as any;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  dom.happyDOM.cancelAsync();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('inline image previews and editor clicks use the same contextual file path', async () => {
  const opened: string[] = [];
  await render(<AgentMessageExtras
    text="Renders in `/work/repo/graphics-review/seedship-v3-concepts/`: `seedship-flying-bow.png`."
    messageId="contextual-image" droneId="drone-1" droneHomePath="/work/repo"
    onOpenFileReference={ref => opened.push(ref.path)} />);
  const image = host.querySelector('img')!;
  const path = '/work/repo/graphics-review/seedship-v3-concepts/seedship-flying-bow.png';
  expect(new URL(image.src).searchParams.get('path')).toBe(path);
  expect(host.querySelectorAll('img')).toHaveLength(1);
  image.closest('button')!.click();
  expect(opened).toEqual([path]);
});

test('the ore preview recovers from a failed root-path image when its directory context arrives', async () => {
  const opened: string[] = [];
  const preview = (text: string) => <AgentMessageExtras text={text} messageId="ore-preview"
    droneId="drone-1" droneHomePath="/work/repo" onOpenFileReference={ref => opened.push(ref.path)} />;
  await render(preview('`ore-r2-side-by-side.png`'));
  host.querySelector('img')!.dispatchEvent(new dom.Event('error') as unknown as Event);
  await settle();
  expect(host.textContent).toContain('Failed to load image');
  await render(preview('I rebuilt the ore concepts. There are two now, A and B, in ' +
    '`graphics-review/environment/ore/`: `ore-r2-side-by-side.png` shows both, and the ' +
    'round-1 versions are in `round-1/` for comparison.'));
  const image = host.querySelector('img')!;
  const path = '/work/repo/graphics-review/environment/ore/ore-r2-side-by-side.png';
  expect(new URL(image.src).searchParams.get('path')).toBe(path);
  expect(host.textContent).not.toContain('Failed to load image');
  image.closest('button')!.click();
  expect(opened).toEqual([path]);
});

function nativeVisit(droneId: string, text: string) {
  const threadId = `thread-${droneId}`;
  const accessScope = { readMode: 'all', writeMode: 'all', executeMode: 'all', droneIds: [] };
  return {
    ok: true, chatId: threadId, nativeChatId: threadId,
    threads: [{ id: threadId, ownerDroneId: droneId, ownerChatName: 'default', title: droneId,
      createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z', status: 'idle',
      provider: 'openai', model: 'test', thinkingLevel: 'medium', enabledTools: [], enabledWorkspaceIds: [],
      accessScope, agentPermissionMode: 'execute', approvalPolicy: 'ask', autoApprove: false,
      promptDeliveryMode: 'queue', queuedPrompts: [], systemPrompt: '', systemPromptUpdatedAt: null, error: null }],
    pendingApprovals: [], pendingQuestionRequests: [], models: [], defaultEnabledTools: [], availableTools: [], availableWorkspaces: [],
    defaultModel: { provider: 'openai', model: 'test', thinkingLevel: 'medium' }, accessScope,
    initialHistory: { version: 1, threadId, sessionId: null,
      entries: [{ id: `entry-${droneId}`, sequence: 1, timestamp: '2026-09-27T00:00:00Z',
        message: { role: 'assistant', content: [{ type: 'text', text }] } }],
      page: { limit: 200, beforeCursor: null, hasOlder: false } },
  } as any;
}

test('a late bootstrap refresh does not remove newer messages or reset a running chat', async () => {
  const cached = nativeVisit('refresh-order', 'Cached conversation').initialHistory;
  const latest = { ...cached, entries: [...cached.entries, {
    ...cached.entries[0], id: 'newer-entry', sequence: 2,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Newer live response' }] },
  }] };
  let session: ReturnType<typeof useBlipThreadSession>;
  function Probe({ history }: { history: any }) {
    session = useBlipThreadSession({ threadId: cached.threadId, enabled: true, initialHistory: history });
    return <div>{session.running ? 'Running' : 'Idle'}:{session.messages.map((message) => message.id).join(',')}</div>;
  }
  globalThis.fetch = (async () => Response.json(latest)) as typeof fetch;
  await render(<Probe history={cached} />);
  session!.handleStreamEvent({ type: 'connected', version: 1, threadId: cached.threadId, running: true });
  await settle();
  expect(host.textContent).toContain('Running');
  expect(host.textContent).toContain('newer-entry');
  await render(<Probe history={structuredClone(cached)} />);
  expect(host.textContent).toContain('Running');
  expect(host.textContent).toContain('newer-entry');
});
