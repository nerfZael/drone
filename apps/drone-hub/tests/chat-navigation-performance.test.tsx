import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import { adaptNativeAgentChatSurface } from '../src/droneHub/chat/agent-chat-surface-adapters';
import { ChatSurface } from '../src/droneHub/chat/ChatSurface';
import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { AssistantMessageRow } from '../src/droneHub/assistant/AssistantTranscript';
import { ChangedFilesCard } from '../src/droneHub/chat/ChangedFilesCard';
import { LinkedChangeRequestCards } from '../src/droneHub/chat/LinkedChangeRequestCards';
import { AgentMessageExtras } from '../src/droneHub/chat/AgentMessageExtras';
import { ChatMessageBody } from '../src/droneHub/chat/ChatMessageBody';
import { droneHubQueryClient } from '../src/droneHub/query-client';
import { loadAgentRunDiffFiles } from '../src/droneHub/chat/agent-run-diffs';
import { AssistantDock } from '../src/droneHub/assistant/AssistantDock';
import { useBlipThreadSession } from '../src/droneHub/assistant/useBlipThreadSession';
import { deleteNativeChatSnapshot, readNativeChatSnapshot, writeNativeChatHistory, writeNativeChatSnapshot } from '../src/droneHub/assistant/native-chat-cache';

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
  droneHubQueryClient.clear();
  dom.happyDOM.cancelAsync();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('native rows skip unchanged parent renders, but update changed text and link actions', async () => {
  let contentReads = 0;
  const message = { role: 'assistant' as const, id: 'memo-message', get content() {
    contentReads += 1;
    return [{ type: 'text' as const, text: 'Read the [result](https://example.com).' }];
  } };
  const opened: string[] = [];
  const onOpenLink = () => { opened.push('first'); return true; };
  await render(<AssistantMessageRow message={message} messageExtras={{ messageId: 'm', onOpenLink }} />);
  contentReads = 0;
  await render(<AssistantMessageRow message={message} messageExtras={{ messageId: 'm', onOpenLink }} />);
  expect(contentReads).toBe(0);
  await render(<AssistantMessageRow message={message} messageExtras={{ messageId: 'm', onOpenLink: () => { opened.push('latest'); return true; } }} />);
  host.querySelector<HTMLAnchorElement>('a')!.click();
  expect(opened).toEqual(['latest']);
  await render(<AssistantMessageRow message={{ ...message, content: 'Updated result.' }} messageExtras={{ messageId: 'm' }} />);
  expect(host.textContent).toContain('Updated result.');
});

const entries = [
  { path: 'first.ts', status: 'added' as const, additions: 2, deletions: 0 },
  { path: 'second.ts', status: 'modified' as const, additions: 1, deletions: 1 },
];
const counts = { changed: 2, additions: 3, deletions: 1, modified: 1 };
const changes = {
  version: 2 as const, capturedAt: '2026-09-27T00:00:00Z', counts,
  workspaces: [{ targetId: 'drone:d1', droneId: 'd1', label: 'Repository', diffArtifactId: 'navigation-artifact', counts, previewEntries: entries }],
};

test('changed-file previews appear immediately and reuse saved pages across responses and reopening', async () => {
  let reads = 0;
  let complete!: () => void;
  globalThis.fetch = (async () => {
    reads += 1;
    await new Promise<void>((resolve) => { complete = resolve; });
    return Response.json({ ok: true, files: { entries, counts, total: 2, offset: 0, nextOffset: null, metadataTruncated: false } });
  }) as typeof fetch;
  await render(<ChangedFilesCard fileChanges={changes} initiallyExpanded />);
  expect(host.textContent).toContain('first.ts');
  expect(host.textContent).not.toContain('Loading changed files');
  const height = host.querySelector<HTMLElement>('.dh-changed-files-scrollbar')!.style.height;
  complete();
  await settle();
  await render(<ChangedFilesCard fileChanges={structuredClone(changes)} initiallyExpanded />);
  expect(reads).toBe(1);
  expect(host.querySelector<HTMLElement>('.dh-changed-files-scrollbar')!.style.height).toBe(height);
  await render(null);
  await render(<ChangedFilesCard fileChanges={changes} initiallyExpanded />);
  expect(host.textContent).toContain('second.ts');
  expect(host.textContent).not.toContain('Loading changed files');
  expect(reads).toBe(1);
});

test('cancelling one artifact consumer preserves another consumer and failures remain retryable', async () => {
  let reads = 0;
  let complete!: () => void;
  globalThis.fetch = (async () => {
    reads += 1;
    await new Promise<void>((resolve) => { complete = resolve; });
    return Response.json({ ok: true, files: { entries, counts, total: 2, offset: 0, nextOffset: null } });
  }) as typeof fetch;
  const controller = new AbortController();
  const first = loadAgentRunDiffFiles('shared-artifact', { signal: controller.signal }).catch((error) => error.name);
  const second = loadAgentRunDiffFiles('shared-artifact');
  controller.abort();
  complete();
  expect(await first).toBe('AbortError');
  expect((await second).entries).toEqual(entries);
  expect(reads).toBe(1);
  globalThis.fetch = (async () => Response.json({ error: 'temporary' }, { status: 503 })) as typeof fetch;
  await expect(loadAgentRunDiffFiles('retry-artifact')).rejects.toThrow();
  globalThis.fetch = (async () => Response.json({ ok: true, files: { entries } })) as typeof fetch;
  expect((await loadAgentRunDiffFiles('retry-artifact')).entries).toEqual(entries);
});

test('repeated change-request mentions share one read and show cache updates together', async () => {
  let reads = 0;
  globalThis.fetch = (async () => {
    reads += 1;
    return Response.json({ ok: true, request: { number: 42, title: 'Shared request', status: 'open', conflicted: false } });
  }) as typeof fetch;
  const content = <>{Array.from({ length: 5 }, (_, index) => <LinkedChangeRequestCards key={index} droneId="d1" text="See CR #42." />)}</>;
  await render(content);
  await settle();
  expect(reads).toBe(1);
  expect(host.querySelectorAll('details')).toHaveLength(5);
  expect(host.textContent?.match(/Shared request/g)).toHaveLength(5);
  droneHubQueryClient.setQueryData(['linked-change-request', 'd1', 42], { number: 42, title: 'Updated request', status: 'closed' });
  await settle();
  expect(host.textContent?.match(/Updated request/g)).toHaveLength(5);
  await render(null);
  await render(content);
  expect(reads).toBe(1);
  expect(host.textContent).not.toContain('Loading change request');
});

test('image previews retain their frame before and after loading or failure', async () => {
  await render(<AgentMessageExtras text="![Result](https://example.com/result.png)" messageId="image" />);
  const image = host.querySelector('img')!;
  const frame = image.parentElement!;
  expect(frame.className).toContain('aspect-video');
  expect(image.className).toContain('h-full');
  image.dispatchEvent(new dom.Event('load') as unknown as Event);
  expect(frame.className).toContain('aspect-video');
  image.dispatchEvent(new dom.Event('error') as unknown as Event);
  await settle();
  expect(frame.className).toContain('aspect-video');
  expect(frame.textContent).toContain('Failed to load image');
  await render(<ChatMessageBody role="user" images={[{ key: 'attachment', src: 'data:image/png;base64,AA==', alt: 'Attached' }]} />);
  expect(host.querySelector('img')!.parentElement!.className).toContain('h-44');
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

test('native chat restores a cached conversation, refreshes it, and never displays another drone history', async () => {
  const cached = nativeVisit('warm-native', 'Cached conversation');
  writeNativeChatSnapshot('warm-native', 'default', cached);
  writeNativeChatHistory(cached.initialHistory);
  const responses: Array<() => void> = [];
  let bootstrapReads = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/native')) {
      bootstrapReads += 1;
      const id = url.includes('warm-native') ? 'warm-native' : 'cold-native';
      return new Promise<Response>((resolve) => responses.push(() => resolve(Response.json(nativeVisit(id, `Fresh conversation ${id}`)))));
    }
    if (url.includes('/history')) return Response.json(nativeVisit('warm-native', 'Fresh conversation warm-native').initialHistory);
    return Response.json({ ok: true, drones: [], deliveries: [], events: [], models: [], agents: [], providers: [] });
  }) as typeof fetch;
  const pane = (droneId: string) => <QueryClientProvider client={droneHubQueryClient}>
    <ActiveComposerProvider>
    <DndContext>
    <ChatSurface adapter={adaptNativeAgentChatSurface()}>
      <AssistantDock autoFocus={false}
        nativeChat={{ droneId, chatName: 'default' }} messageFeatures={{ droneId }} />
    </ChatSurface>
    </DndContext>
    </ActiveComposerProvider>
  </QueryClientProvider>;
  try {
    await render(pane('warm-native'));
    expect(host.textContent).toContain('Cached conversation');
    expect(host.textContent).not.toContain('Loading conversation');
    expect(bootstrapReads).toBe(1);
    responses.shift()!();
    await settle();
    await settle();
    expect(host.textContent).toContain('Fresh conversation warm-native');
    await render(pane('cold-native'));
    expect(host.textContent).not.toContain('Fresh conversation warm-native');
    expect(host.textContent).toContain('Loading conversation');
    await render(pane('warm-native'));
    expect(host.textContent).toContain('Fresh conversation warm-native');
    expect(host.textContent).not.toContain('Loading conversation');
    // A response for the chat we already left cannot replace the current chat.
    responses.shift()!();
    await settle();
    expect(host.textContent).not.toContain('Fresh conversation cold-native');
    expect(readNativeChatSnapshot('warm-native', 'default')?.initialHistory?.entries).toHaveLength(1);
  } finally {
    await render(null);
    responses.splice(0).forEach((respond) => respond());
    await settle();
    deleteNativeChatSnapshot('warm-native', 'default');
    deleteNativeChatSnapshot('cold-native', 'default');
  }
});
