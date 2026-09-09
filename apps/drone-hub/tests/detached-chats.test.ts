import { placeDetachedChat } from '../src/droneHub/app/detached-chat-placement';
import { resolveChatNameForDrone } from '../src/droneHub/app/helpers';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { detachedChatKey, detachableDroneChat, normalizeDetachedChats, useDetachedChatStore } from '../src/droneHub/app/detached-chat-store';
import { consumeChatFileOpen, requestChatFileOpen, CHAT_OPEN_FILE_EVENT } from '../src/droneHub/app/chat-file-navigation';
import { ASSISTANT_OPEN_DRONE_CHAT_EVENT } from '../src/droneHub/assistant/open-drone-chat-event';
import { agentRunChangesDroneId, hasRequestedAgentRunChanges, requestAgentRunChanges, consumeRequestedAgentRunChanges, CHANGES_OPEN_AGENT_RUN_EVENT } from '../src/droneHub/changes/navigation';
import { consumePendingSideChat, requestSideChat } from '../src/droneHub/app/side-chat-events';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  useDetachedChatStore.setState({ chats: {} });
});
afterEach(() => {
  useDetachedChatStore.setState({ chats: {} });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
const bounds = { x: 412, y: 81, width: 430, height: 570 };

describe('detached chat state', () => {
  test('offers the drone action only for a lone default chat', () => {
    expect(detachableDroneChat({ chats: ['default'] })).toBe('default');
    for (const chats of [[], ['review'], ['default', 'review']]) expect(detachableDroneChat({ chats })).toBeNull();
    expect(detachableDroneChat({ chats: ['default'], workflowChats: ['workflow'] })).toBeNull();
  });
  test('identifies chats by owner and preserves size and position after closing', () => {
    const key = detachedChatKey('a', 'default');
    const state = useDetachedChatStore.getState();
    state.detach('a', 'default');
    state.detach('b', 'default');
    state.saveBounds(key, bounds);
    state.attach(key);
    expect(useDetachedChatStore.getState().chats[key]).toEqual({ droneId: 'a', chatName: 'default', open: false, bounds });
    expect(useDetachedChatStore.getState().chats[detachedChatKey('b', 'default')].open).toBe(true);
    state.detach('a', 'default');
    expect(useDetachedChatStore.getState().chats[key].bounds).toEqual(bounds);
    expect(Object.keys(useDetachedChatStore.getState().chats)).toHaveLength(2);
  });
  test('keeps a detached chat and its bounds through rename, then forgets it on deletion', () => {
    const state = useDetachedChatStore.getState();
    state.detach('a', 'review');
    state.saveBounds(detachedChatKey('a', 'review'), bounds);
    state.rename('a', 'review', 'planning');
    expect(useDetachedChatStore.getState().chats[detachedChatKey('a', 'review')]).toBeUndefined();
    expect(useDetachedChatStore.getState().chats[detachedChatKey('a', 'planning')]).toEqual({ droneId: 'a', chatName: 'planning', open: true, bounds });
    state.detach('b', 'default');
    state.forgetDrone('a');
    expect(Object.values(useDetachedChatStore.getState().chats).map(c => c.droneId)).toEqual(['b']);
    state.forgetChat('b', 'default');
    expect(useDetachedChatStore.getState().chats).toEqual({});
  });
  test('restores valid preferences while rejecting corrupt bounds and identities', () => {
    const valid = { droneId: 'a', chatName: 'default', open: true, bounds };
    expect(normalizeDetachedChats({ arbitraryKey: valid })).toEqual({ [detachedChatKey('a', 'default')]: valid });
    expect(normalizeDetachedChats({ bad: null, missing: { droneId: 'a' }, invalid: { ...valid, bounds: { ...bounds, width: -1 } } })).toEqual({
      [detachedChatKey('a', 'default')]: { droneId: 'a', chatName: 'default', open: true },
    });
  });
});

test('reopening avoids a window that took the saved spot, preserving the saved size', () => {
  const workspace = { width: 1100, height: 800 };
  const saved = { x: 660, y: 0, width: 440, height: 560 };
  expect(placeDetachedChat(workspace, [], 0, saved)).toEqual(saved);
  const topLeft = { ...saved, x: 0, y: 0 };
  expect(placeDetachedChat(workspace, [{ x: 0, y: 0, ...workspace, floating: false }], 0, topLeft)).toEqual(topLeft);
  const reopened = placeDetachedChat(workspace, [{ x: 0, y: 0, ...workspace }, { ...saved, x: saved.x + 1, y: saved.y + 1 }], 1, saved);
  expect([reopened.x, reopened.y]).not.toEqual([saved.x, saved.y]);
  expect([reopened.width, reopened.height]).toEqual([saved.width, saved.height]);
});

test('new windows fit beside existing floating chats even when the main workspace fills the backdrop', () => {
  const workspace = { width: 1100, height: 800 };
  const main = { x: 0, y: 0, ...workspace, floating: false };
  const first = placeDetachedChat(workspace, [main], 0);
  const next = placeDetachedChat(workspace, [main, { ...first, floating: true }], 1);
  expect(next.x + next.width <= first.x || next.x >= first.x + first.width || next.y + next.height <= first.y || next.y >= first.y + first.height).toBe(true);
});

describe('detached chat navigation', () => {
  test('retains an explicitly selected workflow chat instead of opening default', () => {
    expect(resolveChatNameForDrone({ chats: ['default'], workflowChats: ['workflow-review'] } as any, 'workflow-review')).toBe('workflow-review');
  });
  test('requests the owner before opening a file and waits for that workspace', () => {
    const events: string[] = [];
    window.addEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, (event) => { events.push('navigate'); expect((event as CustomEvent).detail).toMatchObject({ droneId: 'a', chatName: 'review' }); });
    window.addEventListener(CHAT_OPEN_FILE_EVENT, () => events.push('file'));
    const request = { droneId: 'a', chatName: 'review', ref: { path: 'src/app.ts', line: 17, column: 3 } };
    requestChatFileOpen(request);
    expect(events).toEqual(['navigate', 'file']);
    expect(consumeChatFileOpen('b')).toBeNull();
    expect(consumeChatFileOpen('a')).toEqual(request);
    expect(consumeChatFileOpen('a')).toBeNull();
  });
  test('a newer file click supersedes a still-pending navigation', () => {
    requestChatFileOpen({ droneId: 'a', chatName: 'default', ref: { path: 'a.ts' } });
    requestChatFileOpen({ droneId: 'b', chatName: 'default', ref: { path: 'b.ts' } });
    expect(consumeChatFileOpen('a')).toBeNull();
    expect(consumeChatFileOpen('b')?.ref.path).toBe('b.ts');
  });
  test('diffs without workspace ownership fall back to the chat owner; multi-workspace diffs use the clicked workspace', () => {
    const changes = { workspaces: [{ targetId: 'legacy' }, { targetId: 'remote', droneId: 'b' }] } as any;
    expect(agentRunChangesDroneId(changes, { workspaceTargetId: 'legacy' }, 'a')).toBe('a');
    expect(agentRunChangesDroneId(changes, { workspaceTargetId: 'remote' }, 'a')).toBe('b');
  });
  test('diff selection stays pending until the owning drone opens it', () => {
    const events: string[] = [];
    window.addEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, () => events.push('navigate'));
    window.addEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, event => { events.push('diff'); expect((event as CustomEvent).detail.droneId).toBe('a'); });
    const request = { droneId: 'a', fileChanges: {} as any, initialSelection: { workspaceTargetId: 'container' } };
    requestAgentRunChanges(request);
    expect(events).toEqual(['navigate', 'diff']);
    expect(hasRequestedAgentRunChanges('b')).toBe(false);
    expect(consumeRequestedAgentRunChanges('b')).toBeNull();
    expect(hasRequestedAgentRunChanges('a')).toBe(true);
    expect(consumeRequestedAgentRunChanges('a')).toEqual(request);
  });
  test('branch shortcut resolves a detached tab to its owner and checkpoint', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const key = detachedChatKey('a', 'review');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      querySelector: () => ({ dataset: { sideChatName: key } }),
      querySelectorAll: () => [{ dataset: { detachedChatKey: key, chatDroneId: 'a', chatName: 'review' }, querySelector: () => ({ dataset: { sideChatCheckpointId: 'answer' } }) }],
    } });
    try {
      expect(requestSideChat('unrelated-drone')).toBe(true);
      expect(consumePendingSideChat('unrelated-drone')).toBeNull();
      expect(consumePendingSideChat('a')).toEqual({ droneId: 'a', target: { sourceChatName: 'review', checkpointId: 'answer' } });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
  test('branching a detached answer waits for the source workspace', () => {
    const target = { sourceChatName: 'review', checkpointId: 'completed-answer' };
    expect(requestSideChat('a', target)).toBe(true);
    expect(consumePendingSideChat('b')).toBeNull();
    expect(consumePendingSideChat('a')).toEqual({ droneId: 'a', target });
    expect(consumePendingSideChat('a')).toBeNull();
  });
});
