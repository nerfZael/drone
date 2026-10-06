import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { Window } from 'happy-dom';
import { expect, mock, test } from 'bun:test';

// Radix decides whether a DOM exists when it is first imported, before these tests make one, and then never opens a
// popover. Its layout effect is React's own here, so the model pickers open as in the app.
mock.module('@radix-ui/react-use-layout-effect', () => ({ useLayoutEffect: React.useLayoutEffect }));
import { DndContext } from '@dnd-kit/core';
import { createCanvasChatNodeId, createCanvasDroneNodeId, parseCanvasChatNodeId, parseCanvasDroneNodeId } from '../src/droneHub/app/app-config';
import { FOCUS_SIDE_CHAT_EVENT, type FocusSideChatDetail } from '../src/droneHub/app/side-chat-events';
import { NODE_HEIGHT_PX, getNodeWidthPx } from '../src/droneHub/canvas/node-metrics';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';
import { DroneCanvasDock } from '../src/droneHub/canvas/DroneCanvasDock';
import { CARD_HOVER_DELAY_MS } from '../src/droneHub/canvas/card-hover';
import { useFleetAssignmentDropState } from '../src/droneHub/app/use-fleet-assignment-drop-state';
import { forgetStaleChatCard, placeClonedChatOnDroneBoard } from '../src/droneHub/canvas/drone-board';
import { beginChatDeletion, markChatsDeleted, useChatDeletionStore } from '../src/droneHub/app/chat-deletion-store';
import {
  EMPTY_CANVAS_BOARD,
  getCanvasBoardActions,
  selectCanvasBoard,
  topicBoardKey,
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

/** What Radix popovers need of a DOM, beyond what each test sets up. */
function popoverGlobals(dom: Window) {
  return {
    getComputedStyle: dom.getComputedStyle.bind(dom),
    NodeFilter: dom.NodeFilter,
    ShadowRoot: dom.ShadowRoot,
    HTMLInputElement: dom.HTMLInputElement,
    FocusEvent: dom.FocusEvent,
    KeyboardEvent: dom.KeyboardEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
  };
}

const resolveAgentKey = (key: string) =>
  (key === 'native' ? { kind: 'native' } : { kind: 'builtin', id: key.replace(/^builtin:/, '') }) as never;
type CloneChat = NonNullable<DockProps['onCloneChat']>;

function Dock({
  children,
  drone,
  onCreateChat,
  onCloneChat,
  onDeleteChats,
  onRenameChat,
  onActivateChat,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
  chatNodeStateById = {},
  droneRepoById = {},
  onRenameDrone,
  onDeleteDrones,
}: {
  children?: React.ReactNode;
  drone: DroneSummary;
  onCreateChat?: DockProps['onCreateChat'];
  onCloneChat?: CloneChat;
  onDeleteChats?: DockProps['onDeleteChats'];
  onRenameChat?: DockProps['onRenameChat'];
  onActivateChat?: DockProps['onActivateChat'];
  onSendCanvasPrompt?: DockProps['onSendCanvasPrompt'];
  onCreateCanvasDroneFromDraft?: DockProps['onCreateCanvasDroneFromDraft'];
  chatNodeStateById?: DockProps['chatNodeStateById'];
  droneRepoById?: DockProps['droneRepoById'];
  onRenameDrone?: DockProps['onRenameDrone'];
  onDeleteDrones?: DockProps['onDeleteDrones'];
}) {
  const noop = () => {};
  return (
    <ActiveComposerProvider><DndContext>
      {children}
      <DroneCanvasDock
        boardDrone={drone}
        droneById={{ alpha: drone }}
        droneNameById={{ alpha: 'Alpha' }}
        droneRepoById={droneRepoById}
        fleetParentIdByDroneId={{}}
        fleetAssignedIdsByDroneId={{}}
        chatNodeStateById={chatNodeStateById}
        onCreateChat={onCreateChat}
        onCloneChat={onCloneChat}
        onDeleteChats={onDeleteChats}
        onRenameChat={onRenameChat}
        onRenameDrone={onRenameDrone}
        onActivateChat={onActivateChat}
        onSendCanvasPrompt={onSendCanvasPrompt}
        onCreateCanvasDroneFromDraft={onCreateCanvasDroneFromDraft}
        spawnAgentMenuEntries={[{ value: 'builtin:codex', label: 'Codex' }, { value: 'builtin:claude', label: 'Claude Code' }]}
        spawnAgentKey=""
        onOpenCustomAgentModal={noop}
        resolveAgentKey={resolveAgentKey}
        spawnModel=""
        createRepoMenuEntries={[]}
        createRepoPath=""
        onCreateRepoPathChange={noop}
        createGroup=""
        onCreateGroupChange={noop}
        onDeleteDrones={onDeleteDrones}
      />
    </DndContext></ActiveComposerProvider>
  );
}

/** F2 renames the one selected card. */
async function renameCard(card: Element) {
  const id = card.getAttribute('data-drone-id')!;
  const boardDroneId = useDroneCanvasStore.getState().scope === 'drone'
    ? parseCanvasDroneNodeId(id) ?? parseCanvasChatNodeId(id)?.droneId ?? null
    : null;
  await act(async () => getCanvasBoardActions(boardDroneId).setSelectedDroneIds([id]));
  await act(async () => Simulate.keyDown(card, { key: 'F2' }));
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
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
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
    expect(container.querySelectorAll('svg > path[stroke]').length).toBe(1);

    // A sidebar clone gets the same treatment: beside its source, connected by a line.
    await act(async () =>
      root.render(
        <Dock drone={makeDrone(['default', 'plan', 'plan-copy'], [['side-1', 'plan']], { 'plan-copy': 'plan' })} />,
      ),
    );
    const clone = board().nodesByDroneId[alpha('plan-copy')];
    expect(clone.x).toBe(side.x);
    expect(clone.y).toBeGreaterThan(side.y);
    expect(container.querySelectorAll('svg > path[stroke]').length).toBe(2);

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

    // The new chat lands where it was double-clicked, even when its reused name ("Untitled 2",
    // after an empty draft was thrown away) still has a card stored from the earlier chat.
    await act(async () => getCanvasBoardActions('alpha').upsertNodes([{ droneId: alpha('Untitled 2'), label: 'Untitled 2', x: 5, y: 5 }]));
    const onCreateUntitled = async () => {
      // Like the app: the fresh name's left-over card is forgotten before the chat is listed.
      forgetStaleChatCard('alpha', 'Untitled 2');
      return true;
    };
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} onCreateChat={onCreateUntitled} />));
    await act(async () => Simulate.doubleClick(viewport as unknown as Element, { button: 0, clientX: 6000, clientY: 4000 }));
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'Untitled 2'])} onCreateChat={onCreateUntitled} />));
    const { panX, panY, scale } = board();
    const untitled = board().nodesByDroneId[alpha('Untitled 2')];
    expect(Math.abs(untitled.x - (6000 - panX) / scale)).toBeLessThan(200);
    expect(Math.abs(untitled.y - (4000 - panY) / scale)).toBeLessThan(100);

    // Deleted outside the canvas (the sidebar): its card goes at once and is not laid out again
    // while the summary still lists the chat, and nothing is left for a later chat of that name.
    await act(async () => {
      markChatsDeleted([{ droneId: 'alpha', chatName: 'Untitled 2' }]);
      getCanvasBoardActions('alpha').removeNodes([alpha('Untitled 2')]);
    });
    expect(nodeIds()).not.toContain(alpha('Untitled 2'));
    expect(board().nodesByDroneId[alpha('Untitled 2')]).toBeUndefined();
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} onCreateChat={onCreateUntitled} />));
    expect(useChatDeletionStore.getState().deletedAtByNodeId).toEqual({});
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} onCreateChat={onCreateChat} />));

    // Copy two cards, move the cursor away, paste: both clones start at once, keep the
    // group's shape around the cursor, and a group paste does not flip the main chat.
    const calls: Array<{ chatName: string; opts: Parameters<CloneChat>[2]; finish: () => void }> = [];
    // Like the app: the clone's card is placed once its name is picked, before the server copy finishes.
    const onCloneChat: CloneChat = (droneId, chatName, opts) =>
      new Promise((resolve) => {
        const name = `${chatName}-pasted`;
        placeClonedChatOnDroneBoard(droneId, chatName, name, { position: opts?.boardPosition });
        opts?.onPlaced?.(name);
        calls.push({ chatName, opts, finish: () => resolve({ ok: true, chatName: name }) });
      });
    const sentTo: string[][] = [];
    const onSendCanvasPrompt: NonNullable<DockProps['onSendCanvasPrompt']> = async (targets) => {
      sentTo.push(targets.map((target) => target.chatName).sort());
      return { ok: true };
    };
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'])} onCloneChat={onCloneChat} onSendCanvasPrompt={onSendCanvasPrompt} />));
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
    // The clones are shown and selected while still copying, so Q can record into them right away.
    expect([...board().selectedDroneIds].sort()).toEqual([alpha('default-pasted'), alpha('plan-pasted')]);
    expect(board().nodesByDroneId[alpha('plan-pasted')]).toMatchObject(positionOf('plan'));
    // A message to them waits until the server has created both clones.
    const input = container.querySelector('[data-canvas-message-bar] textarea')!;
    await act(async () => Simulate.change(input as unknown as Element, { target: { value: 'Continue' } } as never));
    await act(async () => { Simulate.keyDown(input as unknown as Element, { key: 'Enter', nativeEvent: new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) } as never); });
    expect(sentTo).toEqual([]);
    await act(async () => {
      calls[0].finish();
      calls[1].finish();
    });
    expect(sentTo).toEqual([['default-pasted', 'plan-pasted']]);
    expect([...board().selectedDroneIds].sort()).toEqual([alpha('default-pasted'), alpha('plan-pasted')]);

    // Switching to the global board shows the hand-curated nodes, untouched.
    const globalButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Global')!;
    await act(async () => globalButton.click());
    expect(nodeIds()).toEqual([createCanvasChatNodeId('beta', 'default')]);

    // A retained shared canvas keeps the global view and in-progress message
    // while the selected drone changes underneath it.
    const globalNode = createCanvasChatNodeId('beta', 'default');
    await act(async () => {
      getCanvasBoardActions(null).setSelectedDroneIds([globalNode]);
      getCanvasBoardActions(null).setViewport(120, 80, 0.75);
    });
    const globalViewport = container.querySelector('[data-drone-canvas-viewport="1"]');
    const globalInput = container.querySelector('[data-canvas-message-bar] textarea')!;
    await act(async () => Simulate.change(globalInput as unknown as Element, { target: { value: 'Keep this global message' } } as never));
    const beta = { ...makeDrone(['default', 'review']), id: 'beta', name: 'Beta' };
    await act(async () => root.render(<Dock drone={beta} />));
    expect(container.querySelector('[data-drone-canvas-viewport="1"]')).toBe(globalViewport);
    expect(container.querySelector('[data-canvas-message-bar] textarea')).toBe(globalInput);
    expect((globalInput as unknown as HTMLTextAreaElement).value).toBe('Keep this global message');
    expect(nodeIds()).toEqual([globalNode]);
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), null)).toMatchObject({
      panX: 120, panY: 80, scale: 0.75, selectedDroneIds: [globalNode],
    });
    // The drone tab still follows the newly selected drone without remounting.
    await act(async () => useDroneCanvasStore.getState().setScope('drone'));
    expect(nodeIds().sort()).toEqual(['default', 'review'].map((name) => createCanvasChatNodeId('beta', name)).sort());
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

test('global canvas drags only show agent chat drop actions while over that chat pane', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'global' });
  useDroneCanvasStore.getState().upsertNodes([
    { droneId: alpha('default'), label: 'default', x: 0, y: 0 },
    { droneId: createCanvasChatNodeId('beta', 'default'), label: 'Beta', x: 200, y: 0 },
  ]);
  function AgentPane({ id }: { id: string }) {
    const drop = useFleetAssignmentDropState({ currentDrone: { id } as DroneSummary,
      currentDroneLabel: id, openDroneErrorModal: () => {}, onRequestDropActions: () => ({ ok: true }) });
    return <div ref={drop.setFleetDropNodeRef} data-test-agent={id} data-hint={drop.fleetDropHintVisible}
      data-fleet-assignment-drop-zone="1" data-fleet-assignment-owner-id={id}>Agent conversation</div>;
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const move = async (type: string, x: number) => {
    await act(async () => {
      dom.dispatchEvent(new dom.MouseEvent(type, { clientX: x, clientY: 100, buttons: type === 'mouseup' ? 0 : 1 }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
  };
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default'])}>
      <AgentPane id="beta" /><AgentPane id="gamma" />
    </Dock>));
    const card = container.querySelector(`[data-drone-id="${alpha('default')}"]`)!;
    const betaCard = container.querySelector(`[data-drone-id="${createCanvasChatNodeId('beta', 'default')}"]`)!;
    const viewport = container.querySelector('[data-drone-canvas-viewport]')!;
    const betaPane = container.querySelector('[data-test-agent="beta"]')!;
    const gammaPane = container.querySelector('[data-test-agent="gamma"]')!;
    // happy-dom has no hit testing. Exercise real drag handling against each surface.
    Object.defineProperty(dom.document, 'elementsFromPoint', { configurable: true,
      value: (x: number) => [x < 200 ? viewport : x < 400 ? betaCard : x < 600 ? betaPane : gammaPane] });
    await act(async () => Simulate.mouseDown(card as unknown as Element, { button: 0, clientX: 10, clientY: 10 }));
    await move('mousemove', 100);
    expect(betaPane.getAttribute('data-hint')).toBe('false');
    expect(gammaPane.getAttribute('data-hint')).toBe('false');
    await move('mousemove', 300); // Another card owned by the same drone as the open agent chat.
    expect(betaPane.getAttribute('data-hint')).toBe('false');
    await move('mousemove', 500); // Explicitly entering that chat still permits a drop.
    expect(betaPane.getAttribute('data-hint')).toBe('true');
    expect(gammaPane.getAttribute('data-hint')).toBe('false');
    await move('mousemove', 700);
    expect(betaPane.getAttribute('data-hint')).toBe('false');
    expect(gammaPane.getAttribute('data-hint')).toBe('true');
    await move('mousemove', 100);
    expect(betaPane.getAttribute('data-hint')).toBe('false');
    expect(gammaPane.getAttribute('data-hint')).toBe('false');
    await move('mouseup', 100);
    expect(useDroneCanvasStore.getState().nodesByDroneId[alpha('default')]!.x).not.toBe(0);
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
    // While the hub deletes them, each card shows it is going away.
    const deleteCalls: Array<Array<{ droneId: string; chatName: string }>> = [];
    let finishDelete: () => void = () => {};
    const onDeleteChats: NonNullable<DockProps['onDeleteChats']> = async (targets) => {
      deleteCalls.push([...targets]);
      const end = beginChatDeletion(targets);
      await new Promise<void>((resolve) => { finishDelete = resolve; });
      for (const target of targets) end(target);
      return targets.map((target) => ({ ...target, ok: true }));
    };
    const deleteAndFinish = async (event: Record<string, unknown>) => {
      await act(async () => Simulate.keyDown(viewport(), event));
      await act(async () => finishDelete());
    };
    await act(async () => root.render(<Dock drone={drone} onCloneChat={onCloneChat} onDeleteChats={onDeleteChats} />));
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    const otherPositions = () => Object.fromEntries(Object.entries(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodesByDroneId)
      .filter(([nodeId]) => nodeId !== alpha('plan') && nodeId !== alpha('side-1'))
      .map(([nodeId, node]) => [nodeId, { x: node.x, y: node.y }]));
    const positionsBeforeDelete = otherPositions();
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete' }));
    expect(card('plan').getAttribute('aria-busy')).toBe('true');
    expect(card('plan').textContent).toContain('Deleting');
    expect(card('default').getAttribute('aria-busy')).toBeNull();
    await act(async () => finishDelete());
    expect(deleteCalls).toEqual([[{ droneId: 'alpha', chatName: 'plan' }, { droneId: 'alpha', chatName: 'side-1' }]]);
    // Deleting cards leaves every other card where it was.
    expect(otherPositions()).toEqual(positionsBeforeDelete);
    // The summary still lists the deleted chats until it refreshes: their cards go at once
    // instead of being placed again as if they were new chats.
    expect(card('plan')).toBeNull();
    expect(card('side-1')).toBeNull();
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodesByDroneId[alpha('plan')]).toBeUndefined();
    // Once the summary drops them, chats created again under those names get cards again.
    const recreateDeletedChats = async () => {
      await act(async () => root.render(<Dock drone={makeDrone(['default'])} onCloneChat={onCloneChat} onDeleteChats={onDeleteChats} />));
      expect(otherPositions()).toEqual(positionsBeforeDelete);
      await act(async () => root.render(<Dock drone={drone} onCloneChat={onCloneChat} onDeleteChats={onDeleteChats} />));
    };
    await recreateDeletedChats();
    expect(card('plan')).not.toBeNull();
    expect(card('side-1')).not.toBeNull();
    // With the modifier held it is the same request, not one per card.
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await deleteAndFinish({ key: 'Delete', shiftKey: true });
    expect(deleteCalls.length).toBe(2);
    await recreateDeletedChats();

    // Right-drag pans the canvas, so right-click on a card opens no menu; the keyboard copies the whole selection.
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('plan'), alpha('side-1')]));
    await act(async () => Simulate.contextMenu(card('side-1'), { clientX: 20, clientY: 20 }));
    expect(dom.document.querySelectorAll('[role="menuitem"]').length).toBe(0);
    await act(async () => Simulate.keyDown(viewport(), { key: 'c', ctrlKey: true }));
    const clonesBeforePaste = cloned.length;
    await act(async () => Simulate.keyDown(viewport(), { key: 'v', ctrlKey: true }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(cloned.slice(clonesBeforePaste).sort()).toEqual(['plan', 'side-1']);

    // A title being edited is saved when the field loses focus, and dropped on Escape.
    const renames: string[] = [];
    const onRenameChat: NonNullable<DockProps['onRenameChat']> = async (_droneId, _chatName, newName) => {
      renames.push(newName);
      return { ok: true, chatName: newName };
    };
    await act(async () => root.render(<Dock drone={drone} onRenameChat={onRenameChat} />));
    const planBeforeRename = { ...selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodesByDroneId[alpha('plan')] };
    const edgeCount = () => container.querySelectorAll('svg > path[stroke]').length;
    const edgesBeforeRename = edgeCount();
    const originalWidth = (card('plan') as unknown as HTMLElement).style.width;
    const originalTransform = (card('plan') as unknown as HTMLElement).style.transform;
    await renameCard(card('plan'));
    let input = container.querySelector('[data-canvas-node] input') as unknown as HTMLInputElement;
    await act(async () => Simulate.change(input, { target: { value: 'A much longer name that should grow while typing' } } as never));
    expect(parseFloat((card('plan') as unknown as HTMLElement).style.width)).toBeGreaterThan(parseFloat(originalWidth));
    expect((card('plan') as unknown as HTMLElement).style.transform).toBe(originalTransform);
    await act(async () => Simulate.change(input, { target: { value: 'plan' } } as never));
    expect((card('plan') as unknown as HTMLElement).style.width).toBe(originalWidth);
    await act(async () => Simulate.change(input, { target: { value: 'plan b' } } as never));
    const renamePositions: Array<{ x: number; y: number }> = [];
    const unsubscribe = useDroneCanvasStore.subscribe((state) => {
      const renamed = selectCanvasBoard(state, 'alpha').nodesByDroneId[alpha('plan b')];
      if (renamed) renamePositions.push({ x: renamed.x, y: renamed.y });
    });
    try {
      await act(async () => Simulate.blur(input));
    } finally {
      unsubscribe();
    }
    expect(renamePositions.length).toBeGreaterThan(0);
    for (const position of renamePositions) {
      expect(position).toEqual({ x: planBeforeRename.x, y: planBeforeRename.y });
    }
    expect(renames).toEqual(['plan b']);
    // Until the summary refreshes, the renamed card stays put with its lines, and the old
    // name is not laid out again as if it were a new chat.
    expect(card('plan')).toBeNull();
    expect(card('plan b')).not.toBeNull();
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodesByDroneId[alpha('plan b')])
      .toMatchObject({ x: planBeforeRename.x, y: planBeforeRename.y });
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodesByDroneId[alpha('plan')]).toBeUndefined();
    expect(edgeCount()).toBe(edgesBeforeRename);
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan b'], [['side-1', 'plan b']])} onRenameChat={onRenameChat} />));
    await renameCard(card('plan b'));
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
  let transcriptionGate: Promise<void> | null = null;
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
    FileReader: dom.FileReader, File: dom.File, MediaRecorder: Recorder, ...popoverGlobals(dom),
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/transcriptions') && transcriptionGate) await transcriptionGate;
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
    // The composer stays, with the settings for new cards, but sends to no one.
    expect(container.querySelector('[data-canvas-message-bar]')?.hasAttribute('hidden')).toBe(false);
    expect(input().getAttribute('placeholder')).toBe('Select chats to message');
    // The selected cards show who a message goes to: no recipient line above the composer.
    expect(container.querySelector('[data-selected-chats-composer-meta]')).toBeNull();
    expect(container.querySelector('[data-canvas-message-bar] [data-chat-composer-runtime-picker]')).not.toBeNull();
    for (const shortcut of ['q', 's', 'Tab']) {
      const event = new dom.KeyboardEvent('keydown', { key: shortcut, bubbles: true, cancelable: true });
      await act(async () => { viewport().dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element));
    expect((input() as unknown as HTMLTextAreaElement).value).toBe('Keep my attachment');
    expect(container.textContent).toContain('notes.txt');
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('plan')}"]`) as unknown as Element, { ctrlKey: true }));
    // The full composer stays open with a selection; there is no collapsed "Message …" button.
    expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent?.startsWith('Message '))).toBe(false);
    expect(container.textContent).toContain('notes.txt');
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
    const recordingControl = (label: string) => container.querySelector(`button[aria-label="${label}"]`)!;
    const expectRecordingVisible = (label: string) => {
      const control = recordingControl(label);
      expect(control).not.toBeNull();
      expect(control.closest('[hidden]')).toBeNull();
    };
    await key(viewport() as unknown as Element, 'Escape');
    expectRecordingVisible('Pause recording');
    await act(async () => getCanvasBoardActions('alpha').clearSelection());
    expectRecordingVisible('Stop recording and transcribe');
    expect(container.querySelector('[data-selected-chats-composer-meta]')).toBeNull();
    const sendRecording = recordingControl('Transcribe and send recording') ?? recordingControl('Send');
    expect((sendRecording as unknown as HTMLButtonElement).disabled).toBe(true);
    await act(async () => Simulate.click(recordingControl('Pause recording') as unknown as Element));
    expectRecordingVisible('Resume recording');
    await act(async () => Simulate.click(recordingControl('Resume recording') as unknown as Element));
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element));
    expectRecordingVisible('Pause recording');
    expect(container.querySelector('[data-active-composer-id]')).toBe(recordingComposer);
    await key(viewport() as unknown as Element, 's');
    await act(async () => { await settle(); });
    expect(sends.at(-1)).toMatchObject({ payload: { prompt: 'Recorded message' }, context: { deliveryMode: 'queue' } });
    expect(dom.document.activeElement).toBe(viewport());
    await key(dom.document.activeElement as unknown as Element, 'q');
    expect(recordings).toBe(2);
    await key(dom.document.activeElement as unknown as Element, 'Tab');
    expect(sends.at(-1)).toMatchObject({ payload: { prompt: 'Recorded message' }, context: { deliveryMode: 'asap' } });
    expect(dom.document.activeElement).toBe(viewport());
    // With no recipients, stopping still keeps the transcript for a later selection.
    await key(dom.document.activeElement as unknown as Element, 'q');
    await act(async () => getCanvasBoardActions('alpha').clearSelection());
    const sendsBeforeStop = sends.length;
    let finishTranscription!: () => void;
    transcriptionGate = new Promise<void>((resolve) => { finishTranscription = resolve; });
    await act(async () => {
      Simulate.click(recordingControl('Stop recording and transcribe') as unknown as Element);
      await settle();
    });
    expectRecordingVisible('Discard recording');
    expect(container.textContent).toContain('Transcribing');
    await act(async () => { finishTranscription(); await settle(); });
    transcriptionGate = null;
    expect(sends).toHaveLength(sendsBeforeStop);
    await act(async () => Simulate.click(container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element));
    expect((input() as unknown as HTMLTextAreaElement).value).toBe('Recorded message');
    // One picker shows the model and reasoning the chat will use.
    expect(container.querySelector('[data-chat-composer-model-picker] > button')?.textContent).toBe('Saved model (Low)');
    expect(container.querySelector('select')).toBeNull();
    expect(configs).toEqual([]);
    const modelTrigger = container.querySelector('[data-chat-composer-model-picker] > button')!;
    await act(async () => (modelTrigger as unknown as HTMLButtonElement).click());
    const dialogButton = (text: string) => Array.from(dom.document.querySelectorAll('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === text) as unknown as HTMLButtonElement;
    await act(async () => dialogButton('High').click());
    expect(modelTrigger.textContent).toBe('Saved model (High)');
    await type('Do not send from model controls');
    const beforeMenuKeys = sends.length;
    await key(modelTrigger as unknown as Element, 'Tab');
    expect(sends).toHaveLength(beforeMenuKeys);
    await act(async () => (modelTrigger as unknown as HTMLButtonElement).click());
    await act(async () => dialogButton('Saved model').click());
    await key(dom.document.querySelector('button[title="other-model"]') as unknown as Element, 's');
    await key(dom.document.querySelector('button[title="other-model"]') as unknown as Element, 'Tab');
    expect(sends).toHaveLength(beforeMenuKeys);
    await act(async () => (dom.document.querySelector('button[title="other-model"]') as unknown as HTMLButtonElement).click());
    expect(configs).toEqual([]); // Choices are staged; they never rewrite a selected chat just by clicking.
    await type('With overrides');
    await key(input() as unknown as Element, 'Enter');
    expect((sends.at(-1) as any).overrides).toEqual({ model: 'other-model', reasoning: 'high' });
    expect(modelTrigger.textContent).toBe('Saved model (Low)');
    // While chats that exist are selected, the one-off override stands in for the canvas's own settings.
    expect(container.querySelector('[data-chat-composer-runtime-picker]')).toBeNull();
    // Global-board drafts use the same attachments and retain the spawn-count control.
    await act(async () => useDroneCanvasStore.getState().setNewCardSettings({
      agentKey: 'builtin:codex', model: 'saved-model', reasoning: 'high', permissionMode: 'write', approvalPolicy: 'none',
    }));
    await act(async () => (Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Global') as unknown as HTMLButtonElement).click());
    await act(async () => { Simulate.doubleClick(viewport() as unknown as Element, { button: 0, clientX: 200, clientY: 200 }); await settle(); });
    // The keyboard stays on the canvas, so Q records into the new draft at once.
    expect(dom.document.activeElement).toBe(viewport());
    // The new drone is set up from the composer, before typing: its repository beside the recipient line, and the
    // canvas's agent, model, and access in the toolbar's picker.
    expect(container.querySelector('[data-selected-chats-composer-meta] [data-canvas-draft-controls]')).not.toBeNull();
    expect(container.querySelector('[data-chat-composer-runtime-picker] > button')?.textContent).toBe('Codex · Saved model (High)');
    expect(container.querySelector('[data-chat-composer-model-picker]')).toBeNull();
    const recordingsBeforeDraft = recordings;
    await key(viewport() as unknown as Element, 'q');
    expect(recordings).toBe(recordingsBeforeDraft + 1);
    await key(dom.document.activeElement as unknown as Element, 'q');
    await act(async () => { await settle(); });
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
    expect(created[0]).toMatchObject({ prompt: 'Create with notes', attachments: [{ name: 'notes.txt', dataBase64: 'aGVsbG8=' }],
      overrides: { agentKey: 'builtin:codex', model: 'saved-model', reasoning: 'high', permissionMode: 'write', approvalPolicy: 'none' } });
    expect(created[1].attachments).toEqual(created[0].attachments);
  } finally {
    await act(async () => root.unmount());
    // A closed popover hands focus back on a timer; let it run while this window is still the DOM.
    await new Promise((resolve) => setTimeout(resolve, 5));
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', newCardSettings: null });
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
  const mouse = async (type: string, x: number, y: number, buttons = type === 'mouseup' ? 0 : 1) => {
    await act(async () => { dom.dispatchEvent(new dom.MouseEvent(type, { clientX: x, clientY: y, buttons, bubbles: true })); await settle(); });
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
    const tiles = () => Array.from(composer().querySelectorAll('[data-reference-tile] [role="img"]')).map((tile) => tile.getAttribute('title'));
    expect(tiles()).toEqual(['Chat "plan" in Alpha']);

    const input = container.querySelector('[data-canvas-message-bar] textarea')!;
    await act(async () => Simulate.change(input as unknown as Element, { target: { value: 'Compare with this' } } as never));
    await act(async () => { Simulate.keyDown(input as unknown as Element, { key: 'Enter', nativeEvent: new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) } as never); await settle(); });
    expect(sends).toHaveLength(1);
    expect(sends[0].targets).toEqual([{ droneId: 'alpha', chatName: 'default' }]);
    expect(sends[0].payload.prompt).toBe('Compare with this\n\nReferenced drones and chats:\n- Chat "plan" in drone "Alpha" (drone id: alpha)');
    expect(tiles()).toEqual([]);

    // A lost mouseup: the next move with the button up drops the card where it is instead of dragging it along.
    await act(async () => Simulate.mouseDown(card('plan'), { button: 0, clientX: 10, clientY: 10 }));
    await mouse('mousemove', 100, 100);
    await mouse('mousemove', 100, 100, 0);
    const released = board().nodesByDroneId[alpha('plan')];
    expect(released.x).not.toBe(planStart.x);
    await mouse('mousemove', 300, 300, 0);
    expect(board().nodesByDroneId[alpha('plan')]).toMatchObject({ x: released.x, y: released.y });

    // Right-drag pans even when it starts on a card, and ends once the right button is up.
    const panStart = { x: board().panX, y: board().panY };
    await act(async () => Simulate.mouseDown(card('plan'), { button: 2, clientX: 10, clientY: 10 }));
    await mouse('mousemove', 60, 40, 2);
    expect({ x: board().panX, y: board().panY }).toEqual({ x: panStart.x + 50, y: panStart.y + 30 });
    await mouse('mousemove', 200, 200, 0);
    expect({ x: board().panX, y: board().panY }).toEqual({ x: panStart.x + 50, y: panStart.y + 30 });
    expect(board().nodesByDroneId[alpha('plan')]).toMatchObject({ x: released.x, y: released.y });
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


test('a drone card shows its runtime as an icon, and chats linked to it leave repo and branch to it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'global', panX: 0, panY: 0, scale: 1 });
  const droneCard = createCanvasDroneNodeId('alpha');
  const chatCard = alpha('default');
  useDroneCanvasStore.getState().upsertNodes([
    { droneId: droneCard, label: 'Alpha', x: 100, y: 100 },
    { droneId: chatCard, label: 'default', x: 100, y: 300 },
  ]);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const drone = { ...makeDrone(['default']), runtime: 'host', repoBranch: 'dvm/work' } as unknown as DroneSummary;
  const card = (id: string) => container.querySelector(`[data-drone-id="${id}"]`) as unknown as HTMLElement;
  try {
    await act(async () => root.render(<Dock drone={drone} droneRepoById={{ alpha: 'frontier' }} />));
    expect(card(droneCard).querySelector('[data-canvas-drone-runtime="host"]')).not.toBeNull();
    expect(card(droneCard).textContent).not.toMatch(/Drone|Host|Container/);
    expect(card(droneCard).textContent).toContain('frontier');
    expect(card(droneCard).textContent).toContain('dvm/work');
    expect(card(chatCard).textContent).toBe('default');
    // A selected drone card sends to its default chat; the composer's input is named for it.
    await act(async () => useDroneCanvasStore.getState().setSelectedDroneIds([droneCard]));
    expect(container.querySelector('[data-selected-chats-composer] textarea')?.getAttribute('aria-label')).toBe('Message default (Alpha)');
    expect(container.querySelector('[data-selected-chats-composer]')?.textContent).not.toContain('To default');
    await act(async () => useDroneCanvasStore.getState().setSelectedDroneIds([]));

    // The global canvas draws a copy's line to its original, not to the drone.
    await act(async () => root.render(<Dock
      drone={{ ...drone, chats: ['default', 'default - Copy'], chatCloneSources: { 'default - Copy': 'default' } } as DroneSummary}
      droneRepoById={{ alpha: 'frontier' }}
    />));
    await act(async () => useDroneCanvasStore.getState().upsertNodes([{ droneId: alpha('default - Copy'), label: 'default - Copy', x: 300, y: 300 }]));
    const edgeDashes = () => [...container.querySelectorAll('svg > path[stroke]')].map((path) => path.getAttribute('stroke-dasharray'));
    expect(edgeDashes()).toEqual(['2 5', '4 4']); // Drone to original, original to copy.
    await act(async () => useDroneCanvasStore.getState().removeNodes([alpha('default - Copy')]));

    // F2 on a drone card renames the drone in place, like a chat card.
    const droneRenames: string[] = [];
    await act(async () => root.render(<Dock drone={drone} droneRepoById={{ alpha: 'frontier' }}
      onRenameDrone={async (droneId, newName) => { droneRenames.push(`${droneId}:${newName}`); return { ok: true }; }} />));
    await renameCard(card(droneCard));
    const renameInput = card(droneCard).querySelector('input') as unknown as HTMLInputElement;
    expect(renameInput.value).toBe('Alpha');
    expect(card(droneCard).querySelector('[data-canvas-drone-runtime]')).not.toBeNull();
    await act(async () => Simulate.change(renameInput, { target: { value: 'Beta' } } as never));
    await act(async () => Simulate.keyDown(renameInput, { key: 'Enter' }));
    expect(droneRenames).toEqual(['alpha:Beta']);
    expect(card(droneCard).querySelector('input')).toBeNull();
    expect(card(droneCard).textContent).toContain('Beta');

    // Without its drone's card, a chat names its own repository and branch.
    await act(async () => useDroneCanvasStore.getState().removeNodes([droneCard]));
    expect(card(chatCard).textContent).toContain('frontier');
    expect(card(chatCard).textContent).toContain('dvm/work');
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

test('detailed cards show state, time and cost, and spread the stored arrangement without moving it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const runningSince = new Date(Date.now() - 65_000).toISOString();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string | URL | Request) => Response.json(String(input).includes('/api/usage/chats')
      ? { ok: true, chats: [{ droneId: 'alpha', chatName: 'default', estimatedCost: 0.42, tokens: 1000, unpriced: 0, runningSince, lastEndedAt: null }] }
      : String(input).includes('/api/chats/steps')
        ? { ok: true, steps: [{ droneId: 'alpha', chatName: 'default', turnId: 't1', done: ['Read the parser'], doing: ['Splitting the tokenizer'], next: ['Run tests'], final: false, updatedAt: runningSince }] }
        : String(input).includes('/api/settings/chat-steps')
          ? { ok: true, settings: { enabled: true, model: 'openai-codex/gpt-6-luna', reasoning: 'low' } }
          : { ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'global', panX: 0, panY: 0, scale: 1 });
  const chatCard = alpha('default');
  useDroneCanvasStore.getState().upsertNodes([{ droneId: chatCard, label: 'default', x: 100, y: 200 }]);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const card = () => container.querySelector(`[data-drone-id="${chatCard}"]`) as unknown as HTMLElement;
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} chatNodeStateById={{
      [chatCard]: { statusOk: true, statusError: null, busy: true, unreadAgentMessage: true, lastAgentSnippet: 'Refactoring the parser' },
    }} />));
    expect(card().querySelector('[data-canvas-detailed-card]')).toBeNull();
    const toggle = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Detailed cards') as unknown as HTMLButtonElement;
    await act(async () => { toggle.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(card().querySelector('[data-canvas-detailed-card]')?.getAttribute('data-canvas-detailed-card')).toBe('working');
    // Its steps say what it is doing now, and the dots count them.
    // The card has no sentence of its own; what it is doing is in its hover text and the steps panel.
    expect(card().textContent).not.toContain('Splitting the tokenizer');
    expect(card().querySelector('[title*="Splitting the tokenizer"]')).not.toBeNull();
    // Its steps are not drawn on the card: a summary is rewritten as the chat works, so it is no progress bar.
    expect(card().querySelector('[data-canvas-card-progress]')).toBeNull();
    expect(card().querySelector('[data-canvas-detailed-card] [aria-label="1 done, 1 in progress, 1 next"]')).toBeNull();
    // Its state is the sidebar's icon at the top right, not a word.
    expect(card().querySelector('[data-canvas-card-state="working"] svg, [data-canvas-card-state="working"] span')).not.toBeNull();
    expect(card().textContent).not.toContain('working');
    expect(container.textContent).toContain('Steps: gpt-6-luna · Low');
    // Its panel opens on the page, not inside the canvas that would clip and cover it.
    const stepsButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('Steps')) as unknown as HTMLButtonElement;
    await act(async () => { stepsButton.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    const settingsPanel = dom.document.querySelector('[role="dialog"][aria-label="Chat step tracking"]');
    expect(settingsPanel?.parentElement).toBe(dom.document.body);
    expect(container.contains(settingsPanel as never)).toBe(false);
    await act(async () => (dom.document.querySelector('.fixed.inset-0') as unknown as HTMLElement).click());
    expect(dom.document.querySelector('[aria-label="Chat step tracking"][role="dialog"]')).toBeNull();
    // While it works, its clock sits beside its state; its cost is off the card, in the canvas total and on hover.
    expect(card().querySelector('[data-canvas-card-clock]')?.textContent).toContain('1m');
    expect(card().textContent).not.toContain('$0.42');
    expect(container.querySelector('[data-canvas-cost-total]')?.textContent).toBe('$0.42');
    // An unread reply is flagged once the chat is idle, as in the sidebar; while it works on, no corner dot.
    expect(card().querySelector('[data-canvas-card-unread]')).toBeNull();
    expect(card().querySelector('[data-canvas-detailed-card]')?.textContent).not.toContain('$0.42');
    // Positioned by its slot, so moving it does not render the card.
    expect((card().parentElement as unknown as HTMLElement).style.translate).toBe('225px 250px');
    // It looks like the Entity's cards and sits on their darker ground.
    expect(card().classList.contains('dh-canvas-work')).toBe(true);
    expect(container.querySelector('[data-drone-canvas-viewport]')?.classList.contains('dh-canvas-work-ground')).toBe(true);
    // The card keeps one line; resting the pointer on it shows every step in a panel at the canvas's bottom left.
    expect(card().textContent).not.toContain('Read the parser');
    expect(card().style.height).toBe('38px');
    // As wide as its short name needs, not a fixed width.
    expect(parseFloat(card().style.width)).toBeLessThan(200);
    const panel = () => container.querySelector('[data-canvas-steps-panel]');
    const rest = () => act(async () => new Promise((resolve) => setTimeout(resolve, CARD_HOVER_DELAY_MS + 20)));
    expect(panel()).toBeNull();
    // Passing over it shows nothing: the panel waits for the pointer to rest there.
    await act(async () => Simulate.mouseEnter(card()));
    expect(panel()).toBeNull();
    await act(async () => Simulate.mouseLeave(card()));
    await rest();
    expect(panel()).toBeNull();
    await act(async () => Simulate.mouseEnter(card()));
    await rest();
    expect(panel()?.textContent).toContain('Read the parser');
    expect(panel()?.textContent).toContain('Run tests');
    // The panel says how long and what it cost, and lists the current step once.
    expect(panel()?.querySelector('[data-canvas-steps-panel-usage]')?.textContent).toContain('$0.42');
    expect(panel()?.textContent?.split('Splitting the tokenizer').length).toBe(2);
    await act(async () => Simulate.mouseLeave(card()));
    expect(panel()).toBeNull();
    // Selecting the card does not: the panel follows the pointer only.
    await act(async () => useDroneCanvasStore.getState().setSelectedDroneIds([chatCard]));
    expect(panel()).toBeNull();
    await act(async () => useDroneCanvasStore.getState().setSelectedDroneIds([]));
    // A chat that has had no message yet has no steps, so hovering it shows no panel.
    const chatState = { [chatCard]: { statusOk: true, statusError: null, busy: true, unreadAgentMessage: true, lastAgentSnippet: 'Refactoring the parser' } };
    await act(async () => root.render(<Dock drone={{ ...makeDrone(['default']), draftChats: { default: true } } as unknown as DroneSummary}
      chatNodeStateById={chatState} />));
    await act(async () => Simulate.mouseEnter(card()));
    expect(panel()).toBeNull();
    await act(async () => Simulate.mouseLeave(card()));
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} chatNodeStateById={chatState} />));
    // Dragging moves the stored position by the pointer's distance in compact space.
    await act(async () => Simulate.mouseDown(card(), { button: 0, clientX: 300, clientY: 400 }));
    await act(async () => {
      dom.dispatchEvent(new dom.MouseEvent('mousemove', { clientX: 345, clientY: 425, buttons: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      dom.dispatchEvent(new dom.MouseEvent('mouseup', { clientX: 345, clientY: 425, buttons: 0 }));
    });
    expect(useDroneCanvasStore.getState().nodesByDroneId[chatCard]).toMatchObject({ x: 120, y: 220 });
    await act(async () => useDroneHubUiStore.getState().setCanvasDetailedCards(false));
    expect(card().querySelector('[data-canvas-detailed-card]')).toBeNull();
    expect((card().parentElement as unknown as HTMLElement).style.translate).toBe('120px 220px');
  } finally {
    await act(async () => root.unmount());
    useDroneHubUiStore.getState().setCanvasDetailedCards(false);
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('the canvas keeps its own settings for new cards, and a new chat follows changes made while it is selected', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const configs: unknown[] = [];
  const createdChats: unknown[] = [];
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true, ...popoverGlobals(dom),
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/config')) configs.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, models: [] });
    },
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', newCardSettings: {
    agentKey: 'builtin:codex', model: '', reasoning: '', permissionMode: 'write', approvalPolicy: 'auto',
  } });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
  const drone = { ...makeDrone(['default', 'Untitled']), draftChats: { Untitled: true } } as unknown as DroneSummary;
  const picker = () => container.querySelector('[data-chat-composer-runtime-picker] > button') as unknown as HTMLButtonElement | null;
  // No layout here: nothing covers the point a double-click lands on.
  const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
  dom.HTMLElement.prototype.getBoundingClientRect = () => new dom.DOMRect(0, 0, 0, 0);
  const panelButton = (text: string) => Array.from(dom.document.querySelectorAll('[role="dialog"] button'))
    .find((button) => button.textContent?.trim() === text) as unknown as HTMLButtonElement;
  try {
    await act(async () => { root.render(<Dock drone={drone} onCreateChat={async (droneId, settings) => {
      createdChats.push({ droneId, settings });
      return true;
    }} />); await settle(); });
    // With nothing selected, the composer still shows what new cards start with.
    expect(picker()?.textContent).toBe('Codex · Auto');
    // Access and approvals show as small icons beside the model, so every setting fits on the one button.
    const choiceIcons = () => Array.from(picker()?.querySelectorAll('[data-chat-composer-runtime-choice]') ?? [])
      .map((icon) => icon.getAttribute('aria-label'));
    expect(choiceIcons()).toEqual(['Access: Write', 'Approvals: Auto']);
    // A double-click makes a chat with those settings, whichever chat was selected last.
    await act(async () => { Simulate.doubleClick(container.querySelector('[data-drone-canvas-viewport]') as unknown as Element, { button: 0, clientX: 200, clientY: 200 }); await settle(); });
    expect(createdChats).toEqual([{ droneId: 'alpha', settings: {
      agentKey: 'builtin:codex', model: '', reasoning: '', permissionMode: 'write', approvalPolicy: 'auto',
    } }]);

    // A new chat that has had no message follows the picker; another agent keeps only the access it can use.
    await act(async () => { getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('Untitled')]); await settle(); });
    await act(async () => picker()!.click());
    await act(async () => panelButton('Codex').click());
    await act(async () => { panelButton('Claude Code').click(); await settle(); });
    const claude = { agentKey: 'builtin:claude', model: '', reasoning: '', permissionMode: 'execute', approvalPolicy: 'ask' };
    expect(useDroneCanvasStore.getState().newCardSettings).toEqual(claude as never);
    // Claude Code has neither setting, so neither icon.
    expect(choiceIcons()).toEqual([]);
    // No approval policy at all: the server refuses one, even the default, for an agent without approvals.
    expect(configs).toEqual([{ agent: { kind: 'builtin', id: 'claude' }, model: null, reasoning: null,
      agentPermissionMode: 'execute' }]);

    // A chat that has had its first message keeps its own settings, with a one-off override instead.
    await act(async () => { getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('default')]); await settle(); });
    expect(picker()).toBeNull();
    expect(configs).toHaveLength(1);
    expect(useDroneCanvasStore.getState().newCardSettings).toEqual(claude as never);
  } finally {
    await act(async () => root.unmount());
    // A closed popover hands focus back on a timer; let it run while this window is still the DOM.
    await new Promise((resolve) => setTimeout(resolve, 5));
    dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', newCardSettings: null });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('rectangle selection opens exactly one selected card only after release', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => { frames.set(++frameId, run); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'global', panX: 0, panY: 0, scale: 1 });
  const droneCard = createCanvasDroneNodeId('alpha');
  const chatCard = alpha('fork');
  useDroneCanvasStore.getState().upsertNodes([
    { droneId: droneCard, label: 'Alpha', x: 100, y: 100 },
    { droneId: chatCard, label: 'fork', x: 500, y: 100 },
  ]);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const opened: string[] = [];
  const pointer = (type: string, x: number, y: number) => dom.dispatchEvent(new dom.MouseEvent(type, {
    clientX: x, clientY: y, buttons: type === 'mouseup' ? 0 : 1,
  }));
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'fork'], [['fork', 'default']])}
      onActivateChat={(id, chat) => opened.push(`${id}:${chat}`)} />));
    const viewport = container.querySelector('[data-drone-canvas-viewport]') as unknown as HTMLElement;
    viewport.getBoundingClientRect = () => new dom.DOMRect(0, 0, 1000, 800) as unknown as DOMRect;
    const start = async (x: number, ctrlKey = false) => {
      await act(async () => Simulate.mouseDown(viewport, { button: 0, clientX: x, clientY: 90, ctrlKey }));
    };
    const release = async (x: number) => {
      // The final move is still queued: mouseup must use the flushed selection.
      await act(async () => { pointer('mousemove', x, 110); pointer('mouseup', x, 110); });
    };
    await start(90);
    await release(110);
    expect(opened).toEqual(['alpha:default']);
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([droneCard]);
    opened.length = 0;
    await start(490);
    await release(510);
    expect(opened).toEqual(['alpha:fork']);
    opened.length = 0;

    await start(90);
    await act(async () => {
      pointer('mousemove', 110, 110);
      for (const [id, run] of [...frames]) { frames.delete(id); run(0); }
    });
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([droneCard]);
    expect(opened).toEqual([]); // A transient single hit during a larger drag must not navigate.
    await release(510);
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([droneCard, chatCard]);
    expect(opened).toEqual([]);

    await act(async () => useDroneCanvasStore.getState().setSelectedDroneIds([droneCard]));
    await start(490, true);
    await release(510);
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([droneCard, chatCard]);
    expect(opened).toEqual([]); // Count the whole additive selection, not just new hits.
    await start(900);
    await release(920);
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([]);
    expect(opened).toEqual([]);
    await start(90);
    await act(async () => { pointer('mousemove', 110, 110); dom.dispatchEvent(new dom.Event('blur')); });
    expect(opened).toEqual([]); // Cancelling a gesture must not open its selection.

    await act(async () => useDroneCanvasStore.getState().setScope('drone'));
    const actions = getCanvasBoardActions('alpha');
    await act(async () => {
      actions.setViewport({ panX: 0, panY: 0, scale: 1 });
      actions.moveNodes([{ droneId: alpha('default'), x: 100, y: 100 }, { droneId: chatCard, x: 500, y: 100 }]);
    });
    await start(490);
    await release(510);
    expect(opened).toEqual(['alpha:fork']);
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

test('canvas gestures avoid unrelated card renders and layout reads, and use the latest panned coordinates', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => { frames.set(++nextFrame, run); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } })),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const flushFrames = async () => act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(run => run(0));
  });
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, optimisticMembersByDroneId: {}, scope: 'drone' });
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const board = () => selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha');
  const actions = getCanvasBoardActions('alpha');
  const renders = new Map<string, number>();
  const chats = ['default', ...Array.from({ length: 99 }, (_, i) => `chat-${i}`)];
  const states = Object.fromEntries(chats.map(name => [alpha(name), {
    statusOk: true, statusError: null, busy: false, unreadAgentMessage: false,
    get lastAgentSnippet() { renders.set(name, (renders.get(name) ?? 0) + 1); return null; },
  }]));
  let unsubscribe = () => {};
  let layoutReads = 0;
  const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
  dom.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-canvas-node')) layoutReads++;
    // Other suites patch the shared happy-dom prototype; keep this fixture layout deterministic.
    return new dom.DOMRect();
  };
  try {
    await act(async () => root.render(<Dock drone={makeDrone(chats)} chatNodeStateById={states} onRenameChat={async (_id, _name, chatName) => ({ ok: true, chatName })} />));
    await flushFrames();
    const viewport = container.querySelector('[data-drone-canvas-viewport]') as unknown as Element;
    const card = (name: string) => container.querySelector(`[data-drone-id="${alpha(name)}"]`) as unknown as Element;
    expect(container.querySelectorAll('[data-canvas-node]')).toHaveLength(100);
    renders.clear(); layoutReads = 0;
    for (let i = 0; i < 10; i++) await act(async () => actions.setPan(100 + i, 200 + i));
    expect(renders.size).toBe(0);
    expect(layoutReads).toBe(0);
    // Panning moves the outer element; the world inside it only scales.
    expect((container.querySelector('[data-canvas-pan]') as unknown as HTMLElement).style.transform).toBe('translate(109px, 209px)');
    expect((container.querySelector('[data-canvas-world]') as unknown as HTMLElement).style.transform).toBe('scale(1)');

    // Wheel samples add up to one target, and the zoom glides there, anchored under the pointer.
    const anchor = { x: 400, y: 300 };
    const wheel = (deltaY: number, ctrlKey = false) => {
      const event = new dom.WheelEvent('wheel', { deltaY, ctrlKey, bubbles: true, cancelable: true });
      // happy-dom's WheelEvent drops the pointer position from its init.
      Object.defineProperties(event, { clientX: { value: anchor.x }, clientY: { value: anchor.y } });
      viewport.dispatchEvent(event as never);
      return event;
    };
    const anchoredAt = () => (anchor.x - board().panX) / board().scale;
    let pinch: { defaultPrevented: boolean } | null = null;
    await act(async () => {
      wheel(-100);
      pinch = wheel(-100, true);
    });
    // A pinch arrives as Ctrl+wheel: it zooms the canvas, not the whole window.
    expect(pinch!.defaultPrevented).toBe(true);
    expect(board().scale).toBe(1);
    await flushFrames();
    // Part of the way after one frame, then on until it arrives, the same board point under the pointer throughout.
    const firstStep = board().scale;
    expect(firstStep).toBeGreaterThan(1);
    expect(firstStep).toBeLessThan(Math.exp(0.3));
    expect(anchoredAt()).toBeCloseTo(anchor.x - 109, 0);
    for (let i = 0; i < 40; i++) await flushFrames();
    expect(board().scale).toBeCloseTo(Math.exp(0.3), 8);
    expect(anchoredAt()).toBeCloseTo(anchor.x - 109, 0);
    // A zoom scales the whole board: no card renders, and nothing on a card resizes itself to the zoom.
    expect(renders.size).toBe(0);
    expect(layoutReads).toBe(0);
    const slot = (name: string) => card(name).parentElement as unknown as HTMLElement;
    expect(slot('default').style.scale).toBe('');
    expect((container.querySelector('[data-canvas-world]') as unknown as HTMLElement).style.transform).toBe(`scale(${board().scale})`);
    // Anything else that sets the zoom mid-glide (Fit, Reset) takes over.
    await act(async () => wheel(-300));
    await flushFrames();
    await act(async () => actions.setScale(0.5));
    for (let i = 0; i < 10; i++) await flushFrames();
    expect(board().scale).toBe(0.5);

    renders.clear();
    await act(async () => actions.moveNode(alpha('default'), 750, 300));
    expect(renders.size).toBe(0); // Only its slot moves.
    expect(slot('default').style.translate).toBe('750px 300px');
    expect(layoutReads).toBe(0);

    await renameCard(card('chat-0'));
    await flushFrames();
    renders.clear();
    await act(async () => Simulate.change(container.querySelector('[data-canvas-node] input') as unknown as Element, { target: { value: 'a longer chat title' } } as never));
    expect([...renders.keys()]).toEqual(['chat-0']);
    expect(layoutReads).toBe(0);
    await act(async () => Simulate.keyDown(container.querySelector('[data-canvas-node] input') as unknown as Element, { key: 'Escape', nativeEvent: {} } as never));

    renders.clear();
    await act(async () => useDroneCanvasStore.getState().addOptimisticBoardMember('alpha', {
      chatName: 'new-chat', sourceChatName: 'default', sideChat: false, addedAt: Date.now(),
    }));
    expect(container.querySelectorAll('[data-canvas-node]')).toHaveLength(101);
    expect(renders.size).toBe(0);
    await act(async () => {
      useDroneCanvasStore.getState().dropOptimisticBoardMembers('alpha', ['new-chat']);
      actions.removeNodes([alpha('new-chat')]);
    });
    expect(container.querySelectorAll('[data-canvas-node]')).toHaveLength(100);
    expect(renders.size).toBe(0);

    // Hundreds of pointer samples before a frame produce one update; release flushes the last sample.
    await act(async () => Simulate.mouseDown(card('default'), { button: 0, clientX: 10, clientY: 10 }));
    const start = board().nodesByDroneId[alpha('default')];
    let updates = 0;
    unsubscribe = useDroneCanvasStore.subscribe((next, prev) => {
      if (next.droneBoards.alpha?.nodesByDroneId !== prev.droneBoards.alpha?.nodesByDroneId) updates++;
    });
    await act(async () => {
      for (let i = 1; i <= 100; i++) dom.dispatchEvent(new dom.MouseEvent('mousemove', { clientX: 10 + i, clientY: 10, buttons: 1 }));
    });
    expect(updates).toBe(0);
    await flushFrames();
    expect(updates).toBe(1);
    expect(board().nodesByDroneId[alpha('default')].x).toBe(start.x + 200);
    await act(async () => {
      dom.dispatchEvent(new dom.MouseEvent('mousemove', { clientX: 120, clientY: 10, buttons: 1 }));
      dom.dispatchEvent(new dom.MouseEvent('mouseup', { clientX: 120, clientY: 10, buttons: 0 }));
    });
    expect(updates).toBe(2);
    expect(board().nodesByDroneId[alpha('default')].x).toBe(start.x + 220);
    unsubscribe();
    await flushFrames();

    // Switching boards cancels a queued gesture instead of moving the new board.
    const oldPan = board().panX;
    await act(async () => {
      Simulate.mouseDown(viewport, { button: 2, clientX: 10, clientY: 10 });
      dom.dispatchEvent(new dom.MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 2 }));
      useDroneCanvasStore.getState().setScope('global');
    });
    await flushFrames();
    await act(async () => dom.dispatchEvent(new dom.MouseEvent('mousemove', { clientX: 200, clientY: 200, buttons: 2 })));
    await flushFrames();
    expect(board().panX).toBe(oldPan);
    expect(useDroneCanvasStore.getState().panX).toBe(32);

    // Creation after a pan must use the current viewport even though the board did not rerender.
    await act(async () => useDroneCanvasStore.getState().setPan(150, 250));
    await act(async () => Simulate.doubleClick(viewport, { button: 0, clientX: 600, clientY: 500 }));
    const draft = Object.values(useDroneCanvasStore.getState().nodesByDroneId)[0];
    expect(draft.x).toBe(450 - getNodeWidthPx('Untitled') / 2);
    expect(draft.y).toBe(250 - NODE_HEIGHT_PX / 2);
  } finally {
    unsubscribe();
    await act(async () => root.unmount());
    dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, optimisticMembersByDroneId: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('back and forward switch between the global and this drone boards, and a double click opens a card\'s drone', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', panX: 0, panY: 0, scale: 1 });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const opened: string[] = [];
  const scope = () => useDroneCanvasStore.getState().scope;
  const viewport = () => container.querySelector('[data-drone-canvas-viewport]') as unknown as Element;
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'fork'])}
      onActivateChat={(id, chat) => opened.push(`${id}:${chat}`)} />));
    // What a double-click makes next is in the composer's picker, the same on every board.
    const picker = () => container.querySelector('[data-chat-composer-runtime-picker] > button')?.textContent;
    const pickerOnDroneBoard = picker();
    expect(pickerOnDroneBoard).toBe('Cursor · Auto');
    // Backspace goes back to the global board, Shift+Backspace forward to this drone's; so do Alt+Left and Alt+Right.
    await act(async () => Simulate.keyDown(viewport(), { key: 'Backspace' }));
    expect(scope()).toBe('global');
    expect(picker()).toBe(pickerOnDroneBoard);
    await act(async () => Simulate.keyDown(viewport(), { key: 'Backspace' }));
    expect(scope()).toBe('global');
    await act(async () => Simulate.keyDown(viewport(), { key: 'Backspace', shiftKey: true }));
    expect(scope()).toBe('drone');
    await act(async () => Simulate.keyDown(viewport(), { key: 'ArrowLeft', altKey: true }));
    expect(scope()).toBe('global');
    await act(async () => Simulate.keyDown(viewport(), { key: 'ArrowRight', altKey: true }));
    expect(scope()).toBe('drone');
    // The mouse's back and forward side buttons.
    await act(async () => Simulate.mouseUp(viewport(), { button: 3 }));
    expect(scope()).toBe('global');
    await act(async () => Simulate.mouseUp(viewport(), { button: 4 }));
    expect(scope()).toBe('drone');

    // On the global board, Backspace with a card selected navigates and never removes the card; Delete does.
    await act(async () => useDroneCanvasStore.getState().setScope('global'));
    const chatCard = alpha('fork');
    await act(async () => {
      useDroneCanvasStore.getState().upsertNodes([{ droneId: chatCard, label: 'fork', x: 100, y: 100 }]);
      useDroneCanvasStore.getState().setSelectedDroneIds([chatCard]);
    });
    await act(async () => Simulate.keyDown(viewport(), { key: 'Backspace' }));
    expect(scope()).toBe('global');
    expect(useDroneCanvasStore.getState().nodesByDroneId[chatCard]).toBeTruthy();

    // A middle click on a card does nothing; a double click opens its chat and that drone's own board.
    const card = container.querySelector(`[data-drone-id="${chatCard}"]`) as unknown as Element;
    await act(async () => Simulate.auxClick(card, { button: 1 }));
    expect(opened).toEqual([]);
    expect(scope()).toBe('global');
    await act(async () => Simulate.doubleClick(card, { button: 0 }));
    expect(opened).toEqual(['alpha:fork']);
    expect(scope()).toBe('drone');
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

test('a topic shows its drones with all of their chats; Delete takes a drone off it, Shift+Delete deletes it, and either deletes a chat', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLInputElement: dom.HTMLInputElement, Node: dom.Node, Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true, ...popoverGlobals(dom),
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', topics: [], activeTopicId: null });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const deletedChats: string[] = [];
  const deletedDrones: string[][] = [];
  const viewport = () => container.querySelector('[data-drone-canvas-viewport]') as unknown as Element;
  const shown = () => [...container.querySelectorAll('[data-canvas-node]')].map((node) => node.getAttribute('data-drone-id')).sort();
  const droneCard = createCanvasDroneNodeId('alpha');
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default', 'plan'])}
      onDeleteChats={async (targets) => {
        deletedChats.push(...targets.map((target) => target.chatName));
        return targets.map((target) => ({ ...target, ok: true }));
      }}
      onDeleteDrones={(droneIds) => { deletedDrones.push(droneIds); }} />));
    // A topic made from the toolbar opens empty, named in place.
    await act(async () => Simulate.click(container.querySelector('[data-canvas-topic-switcher] button') as unknown as Element));
    // The menu sits on the page, not in the toolbar, which scrolls sideways and would clip it.
    expect(dom.document.querySelector('[role="menu"][aria-label="Topics"]')).not.toBeNull();
    expect(container.querySelector('[role="menu"][aria-label="Topics"]')).toBeNull();
    const newTopic = [...dom.document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'New topic') as unknown as Element;
    await act(async () => Simulate.click(newTopic));
    const nameInput = container.querySelector('[data-canvas-topic-rename]') as unknown as HTMLInputElement;
    await act(async () => Simulate.change(nameInput, { target: { value: 'Auth rework' } } as never));
    await act(async () => Simulate.keyDown(nameInput, { key: 'Enter' }));
    const topicId = useDroneCanvasStore.getState().activeTopicId!;
    expect(useDroneCanvasStore.getState().scope).toBe('topic');
    expect(container.querySelector('[data-canvas-topic-switcher]')?.textContent).toContain('Auth rework');
    expect(shown()).toEqual([]);

    // Adding the drone brings its card and every chat.
    await act(async () => useDroneCanvasStore.getState().addDronesToTopic(topicId, ['alpha']));
    expect(shown()).toEqual([alpha('default'), alpha('plan'), droneCard].sort());
    const actions = getCanvasBoardActions(topicBoardKey(topicId));

    // Delete or Shift+Delete on a chat deletes it.
    await act(async () => actions.setSelectedDroneIds([alpha('plan')]));
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete' }));
    await act(async () => actions.setSelectedDroneIds([alpha('default')]));
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete', shiftKey: true }));
    expect(deletedChats).toEqual(['plan', 'default']);

    // Shift+Delete on a drone card asks the app to delete the drone; the topic waits for that.
    await act(async () => actions.setSelectedDroneIds([droneCard]));
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete', shiftKey: true }));
    expect(deletedDrones).toEqual([['alpha']]);
    expect(useDroneCanvasStore.getState().topics[0].droneIds).toEqual(['alpha']);

    // Delete takes the drone and its chats off the topic; nothing is deleted.
    await act(async () => actions.setSelectedDroneIds([droneCard]));
    await act(async () => Simulate.keyDown(viewport(), { key: 'Delete' }));
    expect(useDroneCanvasStore.getState().topics[0].droneIds).toEqual([]);
    expect(deletedDrones).toHaveLength(1);
    expect(deletedChats).toEqual(['plan', 'default']);
    expect(shown()).toEqual([]);

    // Double-click makes a new drone draft here, as on the global board.
    await act(async () => Simulate.doubleClick(viewport(), { button: 0, clientX: 200, clientY: 200 }));
    expect(shown()).toHaveLength(1);
    expect(shown()[0]?.startsWith('draft:')).toBe(true);
    expect(container.querySelector('[data-canvas-new-card-defaults]')).toBeNull();

    // Delete topic… asks first (the dialog itself is covered in canvas-topics.test.tsx); nothing goes yet.
    await act(async () => Simulate.click(container.querySelector('[data-canvas-topic-switcher] button') as unknown as Element));
    const deleteItem = [...dom.document.querySelectorAll('[role="menuitem"]')].find((entry) => entry.textContent === 'Delete topic…') as unknown as Element;
    await act(async () => Simulate.click(deleteItem));
    expect(useDroneCanvasStore.getState().topics.map((topic) => topic.id)).toEqual([topicId]);
  } finally {
    await act(async () => root.unmount());
    // A closed popover hands focus back on a timer; let it run while this window is still the DOM.
    await new Promise((resolve) => setTimeout(resolve, 5));
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', topics: [], activeTopicId: null });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('pasting the same text twice in the canvas composer puts it in the message instead of attaching it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true, ...popoverGlobals(dom),
    fetch: async () => Response.json({ ok: true, models: [] }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const input = () => container.querySelector('[data-canvas-message-bar] textarea')! as unknown as HTMLTextAreaElement;
  const attachments = () => container.querySelector('[data-canvas-message-bar] [aria-label="Attachments"]')?.textContent ?? '';
  const paste = async (text: string) => {
    let prevented = false;
    const clipboardData = { files: [], items: [], types: ['text/plain'], getData: (type: string) => type === 'text/plain' ? text : '' };
    await act(async () => Simulate.paste(input() as unknown as Element, { clipboardData, preventDefault: () => { prevented = true; } } as never));
    return prevented;
  };
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} />));
    // To a chat on the canvas, as in the agent chat: the first paste attaches, the same paste again goes in the text.
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('default')]));
    expect(await paste('stack trace line 1\nline 2')).toBe(true);
    expect(attachments()).toContain('stack trace line 1');
    expect(await paste('stack trace line 1\nline 2')).toBe(false);
    expect(attachments()).toBe('');

    // With nothing selected the composer still edits that message: the second paste's text stays in it.
    await act(async () => getCanvasBoardActions('alpha').clearSelection());
    expect(await paste('kept text')).toBe(true);
    expect(await paste('kept text')).toBe(false);
    expect(attachments()).toBe('');
    await act(async () => Simulate.change(input() as unknown as Element, { target: { value: 'kept text' } } as never));
    expect(input().value).toBe('kept text');
    await act(async () => getCanvasBoardActions('alpha').setSelectedDroneIds([alpha('default')]));
    expect(input().value).toBe('kept text');

    // And for a new drone on the global board.
    await act(async () => useDroneCanvasStore.getState().setScope('global'));
    await act(async () => { Simulate.doubleClick(container.querySelector('[data-drone-canvas-viewport]') as unknown as Element, { button: 0, clientX: 200, clientY: 200 }); });
    expect(useDroneCanvasStore.getState().selectedDroneIds[0]?.startsWith('draft:')).toBe(true);
    expect(await paste('notes for the new drone')).toBe(true);
    expect(attachments()).toContain('notes for the new drone');
    expect(await paste('notes for the new drone')).toBe(false);
    expect(attachments()).toBe('');
  } finally {
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 5));
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', newCardSettings: null });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('middle-click holds the cursor in the canvas: it edge-pans, clicks reach the card under it, and middle-click releases it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'global' });
  useDroneCanvasStore.getState().upsertNodes([{ droneId: alpha('default'), label: 'default', x: 0, y: 0 }]);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  // happy-dom has no layout and no pointer lock: give the panel a size and lock the way a browser does.
  const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
  dom.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('ui-panel') ? new dom.DOMRect(0, 0, 1000, 600) : new dom.DOMRect();
  };
  // The lock pans on the page's own animation frames: a 60Hz clock like a browser's.
  Object.defineProperty(dom, 'requestAnimationFrame', { configurable: true,
    value: (run: FrameRequestCallback) => setTimeout(() => run(performance.now()), 16) });
  Object.defineProperty(dom, 'cancelAnimationFrame', { configurable: true, value: (id: number) => clearTimeout(id) });
  let lockedElement: Element | null = null;
  Object.defineProperty(dom.document, 'pointerLockElement', { configurable: true, get: () => lockedElement });
  const lockChanged = () => dom.document.dispatchEvent(new dom.Event('pointerlockchange'));
  Object.defineProperty(dom.HTMLElement.prototype, 'requestPointerLock', { configurable: true,
    value(this: Element) { lockedElement = this; lockChanged(); } });
  Object.defineProperty(dom.document, 'exitPointerLock', { configurable: true, value() { lockedElement = null; lockChanged(); } });
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} />));
    const panel = container.querySelector('.ui-panel') as unknown as HTMLElement;
    const viewport = container.querySelector('[data-drone-canvas-viewport]') as unknown as Element;
    const card = container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element;
    const cursor = () => dom.document.querySelector('[data-canvas-edge-pan-cursor]') as unknown as HTMLElement;
    Object.defineProperty(dom.document, 'elementFromPoint', { configurable: true,
      value: (x: number) => (x < 200 ? card : viewport) });
    // The real mouse while locked: movement only, always at the panel. Movement arrives on pointer events,
    // each followed by its mouse event.
    const mouse = (type: string, init: Record<string, number> = {}) => act(async () => {
      if (type === 'mousemove') {
        panel.dispatchEvent(new dom.PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'mouse', ...init }) as never);
      }
      panel.dispatchEvent(new dom.MouseEvent(type, { bubbles: true, cancelable: true, ...init }) as never);
    });

    await act(async () => Simulate.mouseDown(viewport, { button: 1, clientX: 500, clientY: 300 }));
    expect(lockedElement).toBe(panel as unknown as Element);
    expect(cursor().style.display).toBe('');
    expect(cursor().style.transform).toBe('translate3d(500px, 300px, 0)');

    // A click lands on the card under the drawn cursor, not where the real one was held.
    await mouse('mousemove', { movementX: -380 });
    expect(cursor().style.transform).toBe('translate3d(120px, 300px, 0)');
    await mouse('mousedown', { button: 0, buttons: 1 });
    await mouse('mouseup', { button: 0 });
    await mouse('click', { button: 0, detail: 1 });
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([alpha('default')]);

    // Pushed against the right edge, it stops there and the board pans right; a card held meanwhile stays under
    // the cursor, travelling with it across the board.
    const panX = useDroneCanvasStore.getState().panX;
    await mouse('mousedown', { button: 0, buttons: 1 });
    for (let i = 0; i < 4; i++) await mouse('mousemove', { movementX: 300, buttons: 1 });
    expect(cursor().style.transform).toBe('translate3d(999px, 300px, 0)');
    // The cursor turns into an arrow pointing the way the board moves.
    expect(dom.document.querySelector('[data-canvas-edge-pan-arrow]')?.getAttribute('data-canvas-edge-pan-arrow')).toBe('1,0');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    // Off the edge it stops panning; then the card is dropped.
    await mouse('mousemove', { movementX: -100, buttons: 1 });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    const panned = panX - useDroneCanvasStore.getState().panX;
    await mouse('mouseup', { button: 0 });
    expect(panned).toBeGreaterThan(50);
    expect(useDroneCanvasStore.getState().panX).toBe(panX - panned);
    expect(useDroneCanvasStore.getState().panY).toBe(EMPTY_CANVAS_BOARD.panY);
    expect(useDroneCanvasStore.getState().nodesByDroneId[alpha('default')].x).toBeCloseTo(899 - 120 + panned, 0);
    for (let i = 0; i < 2; i++) await mouse('mousemove', { movementX: 300 });
    // A spike no hand could make is ignored rather than throwing the cursor across the canvas.
    await mouse('mousemove', { movementX: -900 });
    expect(cursor().style.transform).toBe('translate3d(999px, 300px, 0)');

    await mouse('mousedown', { button: 1, buttons: 4 });
    expect(lockedElement).toBeNull();
    expect(cursor().style.display).toBe('none');
    const stopped = useDroneCanvasStore.getState().panX;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(useDroneCanvasStore.getState().panX).toBe(stopped);
  } finally {
    await act(async () => root.unmount());
    dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('in the desktop app middle-click holds the real cursor: the app walls it in, the edges pan, and Esc, middle-click or the app releases it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ ok: true, models: [], agent: { kind: 'builtin', id: 'codex' } }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'global' });
  useDroneCanvasStore.getState().upsertNodes([{ droneId: alpha('default'), label: 'default', x: 0, y: 0 }]);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
  dom.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('ui-panel') ? new dom.DOMRect(0, 0, 1000, 600) : new dom.DOMRect();
  };
  Object.defineProperty(dom, 'requestAnimationFrame', { configurable: true,
    value: (run: FrameRequestCallback) => setTimeout(() => run(performance.now()), 16) });
  Object.defineProperty(dom, 'cancelAnimationFrame', { configurable: true, value: (id: number) => clearTimeout(id) });
  // The desktop app's bridge: it answers whether it walled the cursor in, and can end the hold itself.
  const walls: Array<Record<string, number>> = [];
  let released = 0;
  let confineResult = { ok: true } as { ok: boolean; unsupported?: boolean };
  let appEnds: (() => void) | null = null;
  Object.defineProperty(dom, 'droneHubDesktop', { configurable: true, value: {
    confineCursor: async (rect: Record<string, number>) => { walls.push(rect); return confineResult; },
    releaseCursor: async () => { released++; return true; },
    onCursorConfineEnded: (callback: () => void) => { appEnds = callback; return () => { appEnds = null; }; },
  } });
  let pointerLocks = 0;
  Object.defineProperty(dom.HTMLElement.prototype, 'requestPointerLock', { configurable: true, value() { pointerLocks++; } });
  try {
    await act(async () => root.render(<Dock drone={makeDrone(['default'])} />));
    const viewport = container.querySelector('[data-drone-canvas-viewport]') as unknown as Element;
    const card = container.querySelector(`[data-drone-id="${alpha('default')}"]`) as unknown as Element;
    const zones = () => container.querySelector('[data-canvas-edge-pan-zones]');
    const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
    const hold = async () => {
      await act(async () => Simulate.mouseDown(viewport, { button: 1, clientX: 500, clientY: 300 }));
      await wait(0);
    };
    // The real mouse: ordinary events where the cursor is.
    const at = (target: Element, type: string, clientX: number, init: Record<string, number> = {}) => act(async () => {
      target.dispatchEvent(new dom.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 300, ...init }) as never);
    });

    await hold();
    expect(walls).toEqual([{ x: 0, y: 0, width: 1000, height: 600 }]);
    expect(pointerLocks).toBe(0);
    expect(zones()).not.toBeNull();
    // Nothing is drawn: the real cursor stays.
    expect((dom.document.querySelector('[data-canvas-edge-pan-cursor]') as unknown as HTMLElement).style.display).toBe('none');
    // Clicks are the browser's own and reach the card as usual.
    await at(card, 'mousedown', 50, { button: 0, buttons: 1 });
    await at(card, 'mouseup', 50, { button: 0 });
    await at(card, 'click', 50, { button: 0, detail: 1 });
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([alpha('default')]);

    // Against the right edge it pans right at a steady speed from the start.
    const panX = useDroneCanvasStore.getState().panX;
    await at(viewport, 'mousemove', 998);
    await wait(200);
    const early = panX - useDroneCanvasStore.getState().panX;
    await wait(200);
    const later = panX - useDroneCanvasStore.getState().panX - early;
    expect(early).toBeGreaterThan(50);
    expect(Math.abs(later - early) / early).toBeLessThan(0.4);
    expect(useDroneCanvasStore.getState().panY).toBe(EMPTY_CANVAS_BOARD.panY);
    // Held against the left edge a little short of the bottom corner, as the walls can stop a diagonal push,
    // it pans down and left.
    const beforeCorner = useDroneCanvasStore.getState();
    await act(async () => {
      viewport.dispatchEvent(new dom.MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 590 }) as never);
    });
    await wait(150);
    expect(useDroneCanvasStore.getState().panX).toBeGreaterThan(beforeCorner.panX + 20);
    expect(useDroneCanvasStore.getState().panY).toBeLessThan(beforeCorner.panY - 20);
    await at(viewport, 'mousemove', 500);

    // Escape releases, and only releases: the selection stays.
    await act(async () => { dom.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }) as never); });
    expect(zones()).toBeNull();
    expect(released).toBe(1);
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([alpha('default')]);
    const stopped = useDroneCanvasStore.getState().panX;
    await wait(60);
    expect(useDroneCanvasStore.getState().panX).toBe(stopped);

    // The app ends the hold (the window lost focus or moved).
    await hold();
    expect(zones()).not.toBeNull();
    await act(async () => appEnds?.());
    expect(zones()).toBeNull();
    expect(released).toBe(2);

    // Middle-click releases, and does not hold again.
    await hold();
    await at(viewport, 'mousedown', 500, { button: 1, buttons: 4 });
    await wait(0);
    expect(zones()).toBeNull();
    expect(released).toBe(3);
    expect(walls).toHaveLength(3);

    // Where the app cannot wall the cursor in, the canvas draws its own instead.
    confineResult = { ok: false, unsupported: true };
    await hold();
    expect(pointerLocks).toBe(1);
  } finally {
    await act(async () => root.unmount());
    dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone' });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});
