import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { DndContext } from '@dnd-kit/core';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import { FOCUS_SIDE_CHAT_EVENT, type FocusSideChatDetail } from '../src/droneHub/app/side-chat-events';
import { DroneCanvasDock } from '../src/droneHub/canvas/DroneCanvasDock';
import {
  EMPTY_CANVAS_BOARD,
  getCanvasBoardActions,
  selectCanvasBoard,
  useDroneCanvasStore,
} from '../src/droneHub/canvas/use-drone-canvas-store';
import type { DroneSummary } from '../src/droneHub/types';

const agent = { kind: 'builtin', id: 'claude' };
const alpha = (chatName: string) => createCanvasChatNodeId('alpha', chatName);

function makeDrone(
  chats: string[],
  sideChats: Array<[string, string]> = [],
  chatCloneSources: Record<string, string> = {},
): DroneSummary {
  return {
    id: 'alpha',
    name: 'Alpha',
    chats,
    chatCloneSources,
    sideChats: sideChats.map(([name, sourceChatName]) => ({ name, sourceChatName, checkpointId: 'c1', agent })),
  } as unknown as DroneSummary;
}

type DockProps = React.ComponentProps<typeof DroneCanvasDock>;
type CloneChat = NonNullable<DockProps['onCloneChat']>;

function Dock({
  drone,
  onCreateChat,
  onCloneChat,
  onDeleteChats,
  onRenameChat,
  onActivateChat,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
}: {
  drone: DroneSummary;
  onCreateChat?: (droneId: string) => Promise<boolean>;
  onCloneChat?: CloneChat;
  onDeleteChats?: DockProps['onDeleteChats'];
  onRenameChat?: DockProps['onRenameChat'];
  onActivateChat?: DockProps['onActivateChat'];
  onSendCanvasPrompt?: DockProps['onSendCanvasPrompt'];
  onCreateCanvasDroneFromDraft?: DockProps['onCreateCanvasDroneFromDraft'];
}) {
  const noop = () => {};
  return (
    <ActiveComposerProvider><DndContext>
      <DroneCanvasDock
        boardDrone={drone}
        droneById={{ alpha: drone }}
        droneNameById={{ alpha: 'Alpha' }}
        droneRepoById={{}}
        fleetParentIdByDroneId={{}}
        fleetAssignedIdsByDroneId={{}}
        chatNodeStateById={{}}
        onCreateChat={onCreateChat}
        onCloneChat={onCloneChat}
        onDeleteChats={onDeleteChats}
        onRenameChat={onRenameChat}
        onActivateChat={onActivateChat}
        onSendCanvasPrompt={onSendCanvasPrompt}
        onCreateCanvasDroneFromDraft={onCreateCanvasDroneFromDraft}
        spawnAgentMenuEntries={[]}
        spawnAgentKey=""
        onSpawnAgentKeyChange={noop}
        onOpenCustomAgentModal={noop}
        spawnAgentConfig={agent as never}
        spawnModel=""
        onSpawnModelChange={noop}
        createRepoMenuEntries={[]}
        createRepoPath=""
        onCreateRepoPathChange={noop}
        createGroup=""
        onCreateGroupChange={noop}
      />
    </DndContext></ActiveComposerProvider>
  );
}

test('a drone board fills itself, follows new chats, and leaves the global board alone', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    fetch: async () => new Response(JSON.stringify({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } })),
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
  useDroneCanvasStore
    .getState()
    .upsertNodes([{ droneId: createCanvasChatNodeId('beta', 'default'), label: 'default', x: 0, y: 0 }]);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const nodeIds = () =>
    Array.from(container.querySelectorAll('[data-canvas-node="1"]')).map((el) => el.getAttribute('data-drone-id'));
  const board = () => selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha');
  try {
    // Nothing was dragged in: the board lays out every chat on its own.
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'])} />));
    expect(nodeIds().sort()).toEqual([alpha('default'), alpha('plan')].sort());
    expect(useDroneCanvasStore.getState().nodeOrder).toEqual([createCanvasChatNodeId('beta', 'default')]);

    // The user arranges a chat; a side chat forked from it then lands beside it, with an edge.
    await act(async () => getCanvasBoardActions('alpha').moveNode(alpha('plan'), 500, 400));
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'], [['side-1', 'plan']])} />));
    expect(nodeIds()).toContain(alpha('side-1'));
    const side = board().nodesByDroneId[alpha('side-1')];
    expect(board().nodesByDroneId[alpha('plan')]).toMatchObject({ x: 500, y: 400 });
    expect(side.x).toBeGreaterThan(500);
    expect(side.y).toBe(400);
    expect(container.querySelectorAll('svg path[stroke]').length).toBe(1);

    // A sidebar clone gets the same treatment: beside its source, connected by a line.
    await act(async () =>
      root.render(
        <Dock drone={makeDrone(['default', 'plan', 'plan-copy'], [['side-1', 'plan']], { 'plan-copy': 'plan' })} />,
      ),
    );
    const clone = board().nodesByDroneId[alpha('plan-copy')];
    expect(clone.x).toBe(side.x);
    expect(clone.y).toBeGreaterThan(side.y);
    expect(container.querySelectorAll('svg path[stroke]').length).toBe(2);

    // A deleted chat disappears from view; Delete cannot hide a chat that exists.
    await act(async () => root.render(<Dock drone={makeDrone(['default'], [])} />));
    expect(nodeIds()).toEqual([alpha('default')]);
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('default')]));
    const viewport = container.querySelector('[data-drone-canvas-viewport="1"]')!;
    await act(async () => getCanvasBoardActions('alpha').moveNode(alpha('default'), 700, 700));
    await act(async () => Simulate.keyDown(viewport as unknown as Element, { key: 'Delete' }));
    expect(nodeIds()).toEqual([alpha('default')]);
    expect(board().nodesByDroneId[alpha('default')]).toMatchObject({ x: 700, y: 700 });

    // Double-click on empty canvas asks for a new chat in this drone instead of a draft drone.
    // (Far outside any node: other suites leave a patched getBoundingClientRect on the shared prototype.)
    const created: string[] = [];
    const onCreateChat = async (droneId: string) => {
      created.push(droneId);
      return true;
    };
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} onCreateChat={onCreateChat} />));
    await act(async () => Simulate.doubleClick(viewport as unknown as Element, { button: 0, clientX: 5000, clientY: 5000 }));
    expect(created).toEqual(['alpha']);
    expect(nodeIds().some((id) => String(id).startsWith('draft:'))).toBe(false);

    // Copy two cards, move the cursor away, paste: both clones start at once, keep the
    // group's shape around the cursor, and a group paste does not flip the main chat.
    const calls: Array<{ chatName: string; opts: Parameters<CloneChat>[2]; finish: (name: string) => void }> = [];
    const onCloneChat: CloneChat = (_droneId, chatName, opts) =>
      new Promise((resolve) => {
        calls.push({ chatName, opts, finish: (name) => resolve({ ok: true, chatName: name }) });
      });
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'])} onCloneChat={onCloneChat} />));
    await act(async () => {
      getCanvasBoardActions('alpha').moveNode(alpha('default'), 0, 0);
      getCanvasBoardActions('alpha').moveNode(alpha('plan'), 200, 120);
      getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('default'), alpha('plan')]);
    });
    await act(async () => Simulate.keyDown(viewport as unknown as Element, { key: 'c', ctrlKey: true }));
    await act(async () => Simulate.mouseMove(viewport as unknown as Element, { clientX: 4000, clientY: 3000 }));
    await act(async () => Simulate.keyDown(viewport as unknown as Element, { key: 'v', ctrlKey: true }));
    expect(calls.map((call) => call.chatName).sort()).toEqual(['default', 'plan']);
    const positionOf = (chatName: string) => calls.find((call) => call.chatName === chatName)!.opts!.boardPosition!;
    expect(positionOf('plan').x - positionOf('default').x).toBe(200);
    expect(positionOf('plan').y - positionOf('default').y).toBe(120);
    expect(positionOf('default').x).toBeGreaterThan(1000);
    expect(calls.every((call) => call.opts?.select === false)).toBe(true);
    await act(async () => {
      calls[0].finish('copy-a');
      calls[1].finish('copy-b');
    });

    // Switching to the global board shows the hand-curated nodes, untouched.
    const globalButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Global')!;
    await act(async () => globalButton.click());
    expect(nodeIds()).toEqual([createCanvasChatNodeId('beta', 'default')]);
  } finally {
    await act(async () => root.unmount());
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('side chat cards copy, paste and delete like any other card, and a rename is kept on click-away', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    fetch: async () => new Response(JSON.stringify({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } })),
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    // The rename field focuses itself on the next frame.
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const card = (chatName: string) => container.querySelector(`[data-drone-id="${alpha(chatName)}"]`) as unknown as Element;
  const viewport = () => container.querySelector('[data-drone-canvas-viewport="1"]') as unknown as Element;
  // The workspace that owns the floating side chat window.
  const focusRequests: FocusSideChatDetail[] = [];
  const onFocusSideChat = (event: Event) => {
    focusRequests.push((event as CustomEvent<FocusSideChatDetail>).detail);
    event.preventDefault();
  };
  dom.addEventListener(FOCUS_SIDE_CHAT_EVENT, onFocusSideChat);
  try {
    const cloned: string[] = [];
    const activated: string[] = [];
    const onCloneChat: CloneChat = async (_droneId, chatName, opts) => {
      cloned.push(chatName);
      // Opening the clone would move focus away, reproducing the original paste bug.
      if (opts?.select !== false) (dom.document.activeElement as HTMLElement | null)?.blur();
      return { ok: true, chatName: `${chatName}-copy-${cloned.length}` };
    };
    const drone = makeDrone(['default', 'plan'], [['side-1', 'plan']]);
    await act(async () =>
      root.render(<Dock drone={drone} onCloneChat={onCloneChat} onActivateChat={(_d, chatName) => activated.push(chatName)} />),
    );

    // Clicking a side chat opens it as the main chat, like any other card, and keeps the keyboard on the canvas.
    await act(async () => Simulate.click(card('side-1')));
    expect(activated).toEqual(['side-1']);
    expect(focusRequests).toEqual([]);
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').selectedDroneIds).toEqual([alpha('side-1')]);
    await act(async () => Simulate.keyDown(viewport(), { key: 'c', ctrlKey: true }));
    await act(async () => Simulate.keyDown(viewport(), { key: 'v', ctrlKey: true }));
    expect(cloned).toEqual(['side-1']);
    expect(dom.document.activeElement).toBe(viewport());
    // Send the next paste to the real focused element, without another click or copy.
    await act(async () => {
      dom.document.activeElement!.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(cloned).toEqual(['side-1', 'side-1']);
    expect(dom.document.activeElement).toBe(viewport());

    // Ctrl toggles individual cards and Shift extends a range from the last clicked card.
    await act(async () => Simulate.click(card('default')));
    await act(async () => Simulate.click(card('side-1'), { shiftKey: true }));
    const ordered = selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodeOrder;
    const start = ordered.indexOf(alpha('default'));
    const end = ordered.indexOf(alpha('side-1'));
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').selectedDroneIds)
      .toEqual(ordered.slice(Math.min(start, end), Math.max(start, end) + 1));
    await act(async () => Simulate.click(card('plan'), { ctrlKey: true }));
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').selectedDroneIds).not.toContain(alpha('plan'));

    // Delete asks once for the whole selection, side chat included, and the cards go together.
    const deleteCalls: Array<Array<{ droneId: string; chatName: string }>> = [];
    const onDeleteChats: NonNullable<DockProps['onDeleteChats']> = async (targets) => {
      deleteCalls.push([...targets]);
      return targets.map((target) => ({ ...target, ok: true }));
    };
    await act(async () => root.render(<Dock drone={drone} onCloneChat={onCloneChat} onDeleteChats={onDeleteChats} />));
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete' }));
    expect(deleteCalls).toEqual([[{ droneId: 'alpha', chatName: 'plan' }, { droneId: 'alpha', chatName: 'side-1' }]]);
    // With the modifier held it is the same request, not one per card.
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete', shiftKey: true }));
    expect(deleteCalls.length).toBe(2);

    // Right-click preserves a multi-selection; an unselected card becomes the sole target.
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await act(async () => Simulate.contextMenu(card('side-1'), { clientX: 20, clientY: 20 }));
    const menuItem = (label: string) => Array.from(dom.document.querySelectorAll('[role="menuitem"]'))
      .find((el) => el.textContent?.includes(label)) as unknown as HTMLButtonElement;
    // The menu copies the targeted cards; Paste clones every copied chat.
    await act(async () => menuItem('Copy 2 chats').click());
    await act(async () => Simulate.contextMenu(card('side-1'), { clientX: 20, clientY: 20 }));
    const clonesBeforeMenuPaste = cloned.length;
    await act(async () => menuItem('Paste').click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(cloned.slice(clonesBeforeMenuPaste).sort()).toEqual(['plan', 'side-1']);
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await act(async () => Simulate.contextMenu(card('side-1'), { clientX: 20, clientY: 20 }));
    let item = menuItem('Delete');
    expect(item.textContent).toContain('Delete 2 chats');
    await act(async () => (item as unknown as HTMLButtonElement).click());
    expect(deleteCalls[2]).toEqual([{ droneId: 'alpha', chatName: 'plan' }, { droneId: 'alpha', chatName: 'side-1' }]);
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await act(async () => Simulate.contextMenu(card('default'), { clientX: 20, clientY: 20 }));
    item = menuItem('Delete');
    expect(item.textContent).toContain('Delete chat');
    await act(async () => (item as unknown as HTMLButtonElement).click());
    expect(deleteCalls[3]).toEqual([{ droneId: 'alpha', chatName: 'default' }]);

    // A title being edited is saved when the field loses focus, and dropped on Escape.
    const renames: string[] = [];
    const onRenameChat: NonNullable<DockProps['onRenameChat']> = async (_droneId, _chatName, newName) => {
      renames.push(newName);
      return { ok: true, chatName: newName };
    };
    await act(async () => root.render(<Dock drone={drone} onRenameChat={onRenameChat} />));
    await act(async () => Simulate.doubleClick(card('plan')));
    let input = container.querySelector('[data-canvas-node] input') as unknown as HTMLInputElement;
    await act(async () => Simulate.change(input, { target: { value: 'plan b' } } as never));
    await act(async () => Simulate.blur(input));
    expect(renames).toEqual(['plan b']);
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan b'], [['side-1', 'plan b']])} onRenameChat={onRenameChat} />));
    await act(async () => Simulate.doubleClick(card('plan b')));
    input = container.querySelector('[data-canvas-node] input') as unknown as HTMLInputElement;
    await act(async () => Simulate.change(input, { target: { value: 'plan c' } } as never));
    await act(async () => Simulate.keyDown(input, { key: 'Escape' }));
    await act(async () => Simulate.blur(input));
    expect(renames).toEqual(['plan b']);
    expect(container.querySelector('[data-canvas-node] input')).toBeNull();
  } finally {
    dom.removeEventListener(FOCUS_SIDE_CHAT_EVENT, onFocusSideChat);
    await act(async () => root.unmount());
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('canvas composer sends queued and ASAP messages, retains attachments, and records with Q then S', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const sends: Array<{ targets: unknown; payload: any; context: any }> = [];
  const configs: any[] = [];
  const created: any[] = [];
  let failSend = false;
  let recordings = 0;
  class Recorder extends dom.EventTarget {
    static isTypeSupported() { return true; }
    state = 'inactive';
    mimeType = 'audio/webm';
    start() { this.state = 'recording'; recordings += 1; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const data = new dom.Event('dataavailable');
      Object.assign(data, { data: new Blob(['voice']) });
      this.dispatchEvent(data);
      this.dispatchEvent(new dom.Event('stop'));
    }
  }
  Object.defineProperty(dom, 'MediaRecorder', { configurable: true, value: Recorder });
  // happy-dom has no layout; reflect whether the canvas composer is collapsed.
  Object.defineProperty(dom.HTMLElement.prototype, 'offsetParent', { configurable: true, get() {
    return this.closest('[hidden]') ? null : dom.document.body;
  } });
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    FileReader: dom.FileReader, File: dom.File, MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/config')) configs.push(JSON.parse(String(init?.body)));
      const body = url.includes('/transcriptions') ? { text: 'Recorded message' }
        : url.includes('/model-catalog') ? { models: [{ id: 'saved-model', label: 'Saved model', reasoningLevels: ['low', 'high'] }, { id: 'other-model', label: 'Other model', reasoningLevels: ['low', 'high'] }] }
        : { name: 'Alpha', chat: decodeURIComponent(url.match(/\/chats\/([^/]+)/)?.[1] ?? 'default'), agent: { kind: 'builtin', id: 'codex' }, model: 'saved-model', reasoning: 'low', models: [] };
      return new Response(JSON.stringify({ ok: true, ...body }), { headers: { 'content-type': 'application/json' } });
    },
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const settle = () => new Promise(resolve => setTimeout(resolve, 15));
  const viewport = () => container.querySelector('[data-drone-canvas-viewport]')!;
  const input = () => container.querySelector('[data-canvas-message-bar] textarea')!;
  const type = async (value: string) => { await act(async () => Simulate.change(input() as unknown as Element, { target: { value } } as never)); };
  const key = async (target: Element, key: string) => {
    await act(async () => { Simulate.keyDown(target, { key, nativeEvent: new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) } as never); await settle(); });
  };
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'])} onSendCanvasPrompt={async (targets, payload, context, overrides) => {
      sends.push({ targets, payload, context, overrides } as any);
      return { ok: !failSend, error: failSend ? 'Try again' : undefined };
    }} onCreateCanvasDroneFromDraft={async payload => {
      created.push(payload);
      return { ok: true, droneId: `created-${created.length}`, droneName: `Created ${created.length}` };
    }} />));
    await act(async () => { Simulate.click(container.querySelector('[data-canvas-node]') as unknown as Element); await settle(); });
    expect(container.querySelector('[data-canvas-message-bar] [data-active-composer-id]')).not.toBeNull();
    await type('Queued message');
    await key(input() as unknown as Element, 'Enter');
    expect(sends[0]).toMatchObject({ targets: [{ droneId: 'alpha', chatName: 'default' }], payload: { prompt: 'Queued message', attachments: [] }, context: { deliveryMode: 'queue' } });
    await type('ASAP message');
    await key(input() as unknown as Element, 'Tab');
    expect(sends[1].context.deliveryMode).toBe('asap');
    const fileInput = container.querySelector('input[type="file"]')!;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new dom.File(['hello'], 'notes.txt', { type: 'text/plain' })] });
    await act(async () => Simulate.change(fileInput as unknown as Element));
    await type('Keep my attachment');
    await act(async () => getCanvasBoardActions('alpha').clearSelection());
    expect(container.querySelector('[data-canvas-message-bar]')?.hasAttribute('hidden')).toBe(true);
    for (const shortcut of ['q', 's', 'Tab']) {
      const event = new dom.KeyboardEvent('keydown', { key: shortcut, bubbles: true, cancelable: true });
      await act(async () => { viewport().dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element));
    expect((input() as unknown as HTMLTextAreaElement).value).toBe('Keep my attachment');
    expect(container.textContent).toContain('notes.txt');
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('plan')}"]`) as unknown as Element, { ctrlKey: true }));
    await act(async () => (container.querySelector('[aria-label="Collapse canvas composer"]') as unknown as HTMLButtonElement).click());
    expect(container.textContent).toContain('notes.txt');
    await act(async () => (Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('Message ')) as unknown as HTMLButtonElement).click());
    await key(input() as unknown as Element, 'Tab');
    expect(sends[2].payload.attachments[0]).toMatchObject({ name: 'notes.txt', dataBase64: 'aGVsbG8=' });
    expect(sends[2].context.deliveryMode).toBe('asap');
    expect((sends[2].targets as unknown[]).length).toBe(2);
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('plan')}"]`) as unknown as Element, { ctrlKey: true }));
    await type('Broadcast');
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('plan')}"]`) as unknown as Element, { ctrlKey: true }));
    await key(viewport() as unknown as Element, 's');
    expect(sends.at(-1)?.targets).toEqual([{ droneId: 'alpha', chatName: 'default' }, { droneId: 'alpha', chatName: 'plan' }]);
    expect(sends.at(-1)?.payload.prompt).toBe('Broadcast');
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('plan')}"]`) as unknown as Element, { ctrlKey: true }));
    failSend = true;
    await type('Keep on failure');
    await key(input() as unknown as Element, 'Enter');
    expect((input() as unknown as HTMLTextAreaElement).value).toBe('Keep on failure');
    failSend = false;
    await type('');
    // Q works on the canvas without moving focus into the text field; S transcribes and queues.
    await act(async () => (viewport() as unknown as HTMLElement).focus());
    await key(viewport() as unknown as Element, 'q');
    expect(recordings).toBe(1);
    const recordingComposer = container.querySelector('[data-active-composer-id]');
    await act(async () => getCanvasBoardActions('alpha').clearSelection());
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element));
    expect(container.querySelector('[data-active-composer-id]')).toBe(recordingComposer);
    await key(viewport() as unknown as Element, 's');
    await act(async () => { await settle(); });
    expect(sends.at(-1)).toMatchObject({ payload: { prompt: 'Recorded message' }, context: { deliveryMode: 'queue' } });
    await act(async () => (viewport() as unknown as HTMLElement).focus());
    await key(viewport() as unknown as Element, 'q');
    await key(viewport() as unknown as Element, 'Tab');
    expect(sends.at(-1)).toMatchObject({ payload: { prompt: 'Recorded message' }, context: { deliveryMode: 'asap' } });
    expect(container.textContent).toContain('Model: Unchanged');
    expect(configs).toEqual([]);
    await act(async () => Simulate.change(container.querySelector('select[aria-label="Reasoning override for selected chats"]') as unknown as Element, { target: { value: 'high' } } as never));
    const modelTrigger = container.querySelector('[data-chat-composer-model-picker] > button')!;
    await type('Do not send from model controls');
    const beforeMenuKeys = sends.length;
    await key(modelTrigger as unknown as Element, 'Tab');
    expect(sends).toHaveLength(beforeMenuKeys);
    await act(async () => (modelTrigger as unknown as HTMLButtonElement).click());
    await key(container.querySelector('button[title="other-model"]') as unknown as Element, 's');
    await key(container.querySelector('button[title="other-model"]') as unknown as Element, 'Tab');
    expect(sends).toHaveLength(beforeMenuKeys);
    await act(async () => (container.querySelector('button[title="other-model"]') as unknown as HTMLButtonElement).click());
    expect(configs).toEqual([]); // Choices are staged; they never rewrite a selected chat just by clicking.
    await type('With overrides');
    await key(input() as unknown as Element, 'Enter');
    expect((sends.at(-1) as any).overrides).toEqual({ model: 'other-model', reasoning: 'high' });
    expect(container.textContent).toContain('Model: Unchanged');
    // Global-board drafts use the same attachments and retain the spawn-count control.
    await act(async () => (Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Global') as unknown as HTMLButtonElement).click());
    await act(async () => { Simulate.doubleClick(viewport() as unknown as Element, { button: 0, clientX: 200, clientY: 200 }); await settle(); });
    await type('Create with notes');
    const draftFileInput = container.querySelector('input[type="file"]')!;
    Object.defineProperty(draftFileInput, 'files', { configurable: true, value: [new dom.File(['hello'], 'notes.txt', { type: 'text/plain' })] });
    await act(async () => Simulate.change(draftFileInput as unknown as Element));
    const draftNodeId = useDroneCanvasStore.getState().selectedDroneIds[0];
    await act(async () => useDroneCanvasStore.getState().clearSelection());
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${draftNodeId}"]`) as unknown as Element));
    expect((input() as unknown as HTMLTextAreaElement).value).toBe('Create with notes');
    expect(container.textContent).toContain('notes.txt');
    await act(async () => Simulate.change(container.querySelector('[aria-label="Number of drones"]') as unknown as Element, { target: { value: '2' } } as never));
    await key(input() as unknown as Element, 'Enter');
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ prompt: 'Create with notes', attachments: [{ name: 'notes.txt', dataBase64: 'aGVsbG8=' }] });
    expect(created[1].attachments).toEqual(created[0].attachments);
  } finally {
    await act(async () => root.unmount());
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('dragging a card onto the canvas composer references it in the message without moving it or changing recipients', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const sends: Array<{ targets: unknown; payload: any }> = [];
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } })),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const settle = () => new Promise(resolve => setTimeout(resolve, 15));
  const card = (chatName: string) => container.querySelector(`[data-drone-id="${alpha(chatName)}"]`) as unknown as Element;
  const composer = () => container.querySelector('[data-selected-chats-composer]')!;
  const board = () => selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha');
  const mouse = async (type: string, x: number, y: number) => {
    await act(async () => { dom.dispatchEvent(new dom.MouseEvent(type, { clientX: x, clientY: y, bubbles: true })); });
  };
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'])} onSendCanvasPrompt={async (targets, payload) => {
      sends.push({ targets, payload });
      return { ok: true };
    }} />));
    await act(async () => { Simulate.click(card('default')); await settle(); });
    // happy-dom has no layout: place the composer at 400–600 on both axes.
    Object.defineProperty(composer(), 'getBoundingClientRect', { configurable: true,
      value: () => ({ left: 400, right: 600, top: 400, bottom: 600, width: 200, height: 200, x: 400, y: 400 }) });
    const planStart = board().nodesByDroneId[alpha('plan')];
    await act(async () => Simulate.mouseDown(card('plan'), { button: 0, clientX: 10, clientY: 10 }));
    await mouse('mousemove', 500, 500);
    expect(composer().getAttribute('data-reference-drop-active')).toBe('true');
    await mouse('mouseup', 500, 500);
    expect(board().selectedDroneIds).toEqual([alpha('default')]);
    expect(board().nodesByDroneId[alpha('plan')]).toMatchObject({ x: planStart.x, y: planStart.y });
    expect(composer().textContent).toContain('1 referenced');
    expect(composer().textContent).toContain('Chat in Alpha');

    const input = container.querySelector('[data-canvas-message-bar] textarea')!;
    await act(async () => Simulate.change(input as unknown as Element, { target: { value: 'Compare with this' } } as never));
    await act(async () => { Simulate.keyDown(input as unknown as Element, { key: 'Enter', nativeEvent: new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) } as never); await settle(); });
    expect(sends).toHaveLength(1);
    expect(sends[0].targets).toEqual([{ droneId: 'alpha', chatName: 'default' }]);
    expect(sends[0].payload.prompt).toBe('Compare with this\n\nReferenced drones and chats:\n- Chat "plan" in drone "Alpha" (drone id: alpha, chat: plan)');
    expect(composer().textContent).not.toContain('referenced');
  } finally {
    await act(async () => root.unmount());
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});
