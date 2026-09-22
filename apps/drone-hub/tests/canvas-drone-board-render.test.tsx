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
}: {
  drone: DroneSummary;
  onCreateChat?: (droneId: string) => Promise<boolean>;
  onCloneChat?: CloneChat;
  onDeleteChats?: DockProps['onDeleteChats'];
  onRenameChat?: DockProps['onRenameChat'];
  onActivateChat?: DockProps['onActivateChat'];
}) {
  const noop = () => {};
  return (
    <DndContext>
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
    </DndContext>
  );
}

test('a drone board fills itself, follows new chats, and leaves the global board alone', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
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
    const onCloneChat: CloneChat = async (_droneId, chatName) => {
      cloned.push(chatName);
      return { ok: true, chatName: `${chatName}-copy` };
    };
    const drone = makeDrone(['default', 'plan'], [['side-1', 'plan']]);
    await act(async () =>
      root.render(<Dock drone={drone} onCloneChat={onCloneChat} onActivateChat={(_d, chatName) => activated.push(chatName)} />),
    );

    // Clicking a side chat brings its window forward but leaves the keyboard on the canvas.
    await act(async () => Simulate.click(card('side-1')));
    expect(focusRequests).toEqual([{ droneId: 'alpha', chatName: 'side-1', keyboardFocus: false }]);
    expect(activated).toEqual([]);
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').selectedDroneIds).toEqual([alpha('side-1')]);
    await act(async () => Simulate.keyDown(viewport(), { key: 'c', ctrlKey: true }));
    await act(async () => Simulate.keyDown(viewport(), { key: 'v', ctrlKey: true }));
    expect(cloned).toEqual(['side-1']);

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

    // A title being edited is saved when the field loses focus, and dropped on Escape.
    const renames: string[] = [];
    const onRenameChat: NonNullable<DockProps['onRenameChat']> = async (_droneId, _chatName, newName) => {
      renames.push(newName);
      return { ok: true, chatName: newName };
    };
    await act(async () => root.render(<Dock drone={drone} onRenameChat={onRenameChat} />));
    await act(async () => Simulate.doubleClick(card('plan')));
    let input = container.querySelector('input') as unknown as HTMLInputElement;
    await act(async () => Simulate.change(input, { target: { value: 'plan b' } } as never));
    await act(async () => Simulate.blur(input));
    expect(renames).toEqual(['plan b']);
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan b'], [['side-1', 'plan b']])} onRenameChat={onRenameChat} />));
    await act(async () => Simulate.doubleClick(card('plan b')));
    input = container.querySelector('input') as unknown as HTMLInputElement;
    await act(async () => Simulate.change(input, { target: { value: 'plan c' } } as never));
    await act(async () => Simulate.keyDown(input, { key: 'Escape' }));
    await act(async () => Simulate.blur(input));
    expect(renames).toEqual(['plan b']);
    expect(container.querySelector('input')).toBeNull();
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
