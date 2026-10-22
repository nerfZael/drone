import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { Window } from 'happy-dom';
import { expect, mock, test } from 'bun:test';

mock.module('@radix-ui/react-use-layout-effect', () => ({ useLayoutEffect: React.useLayoutEffect }));
import { DndContext } from '@dnd-kit/core';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';
import { useChatDeletionStore } from '../src/droneHub/app/chat-deletion-store';
import { DroneCanvasDock } from '../src/droneHub/canvas/DroneCanvasDock';
import {
  EMPTY_CANVAS_BOARD,
  organizedBoardKey,
  selectCanvasBoard,
  useDroneCanvasStore,
} from '../src/droneHub/canvas/use-drone-canvas-store';
import type { DroneSummary } from '../src/droneHub/types';
import { DETAILED_CARD_SPREAD } from '../src/droneHub/canvas/detailed-card-model';
import type { SidebarMoveIntent } from '@drone/hub-model/sidebar';

const agent = { kind: 'builtin', id: 'claude' };
const alpha = (chatName: string) => createCanvasChatNodeId('alpha', chatName);

const drone = {
  id: 'alpha',
  name: 'Alpha',
  chats: ['default', 'plan', 'plan-copy', 'worker'],
  chatCloneSources: { 'plan-copy': 'plan' },
  chatCreators: { worker: 'plan' },
  sideChats: [
    { name: 'side-1', sourceChatName: 'plan', checkpointId: 'c1', agent, createdAt: '2026-10-01T00:00:00Z' },
    { name: 'chip', sourceChatName: 'plan', kind: 'new', presentation: 'composer', agent, createdAt: '2026-10-02T00:00:00Z' },
  ],
} as unknown as DroneSummary;

function Dock({ onActivateChat, onMoveSidebar }: {
  onActivateChat?: (droneId: string, chatName: string) => void;
  onMoveSidebar?: (intent: SidebarMoveIntent) => Promise<unknown>;
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
        onActivateChat={onActivateChat}
        onMoveSidebar={onMoveSidebar}
        spawnAgentMenuEntries={[]}
        spawnAgentKey=""
        onOpenCustomAgentModal={noop}
        resolveAgentKey={() => ({ kind: 'builtin', id: 'claude' }) as never}
        spawnModel=""
        createRepoMenuEntries={[]}
        createRepoPath=""
        onCreateRepoPathChange={noop}
        createGroup=""
        onCreateGroupChange={noop}
      />
    </DndContext></ActiveComposerProvider>
  );
}

test('the organized board lays chats out in trees, with side chats as squares, and leaves the free board alone', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
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
  // happy-dom lays nothing out: give the canvas a size to fit the board into.
  const sizes = { clientWidth: 1200, clientHeight: 800 };
  const sizeOriginals = Object.keys(sizes).map((key) => [key, Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, key)] as const);
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(dom.HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', organizedDroneBoard: true });
  useDroneHubUiStore.setState({ sidebarChatOrderByDrone: { alpha: ['plan', 'default', 'plan-copy', 'worker'] } });
  useChatDeletionStore.setState({ deletedAtByNodeId: {}, deletingByNodeId: {} });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
  const cards = () => Array.from(container.querySelectorAll('[data-canvas-node="1"]')).map((el) => el.getAttribute('data-drone-id'));
  const card = (chatName: string) => container.querySelector(`[data-drone-id="${alpha(chatName)}"]`) as unknown as Element;
  const organizedBoard = () => selectCanvasBoard(useDroneCanvasStore.getState(), organizedBoardKey('alpha'));
  const freeBoard = () => selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha');
  const activated: string[] = [];
  const moves: SidebarMoveIntent[] = [];
  try {
    await act(async () => { root.render(<Dock onActivateChat={(_droneId, chatName) => activated.push(chatName)} onMoveSidebar={async (intent) => { moves.push(intent); }} />); await settle(); });
    // Side chats of both kinds are squares on their source, and the chat plan created a square on plan, not cards.
    expect(cards().sort()).toEqual([alpha('default'), alpha('plan'), alpha('plan-copy')].sort());
    const planSquares = () => Array.from(card('plan').querySelectorAll('[data-canvas-side-chat-square]')).map((el) => el.getAttribute('data-canvas-side-chat-square'));
    expect(planSquares()).toEqual(['worker', 'side-1', 'chip']);
    // Dragged off, the created chat is a card under plan, and stays one.
    const viewportEl = container.querySelector('[data-drone-canvas-viewport="1"]')!;
    Object.assign(viewportEl, { getBoundingClientRect: () => ({ left: 0, right: 1200, width: 1200, top: 0, bottom: 800, height: 800, x: 0, y: 0 }) });
    await act(async () => Simulate.mouseDown(card('plan').querySelector('[data-canvas-side-chat-square="worker"]')!, { button: 0, clientX: 300, clientY: 300 }));
    for (const type of ['mousemove', 'mouseup']) {
      await act(async () => { dom.dispatchEvent(new dom.MouseEvent(type, { clientX: 2, clientY: 2, buttons: type === 'mouseup' ? 0 : 1, bubbles: true })); await settle(); });
    }
    Reflect.deleteProperty(viewportEl, 'getBoundingClientRect');
    expect(cards()).toContain(alpha('worker'));
    expect(planSquares()).toEqual(['side-1', 'chip']);
    expect(useDroneCanvasStore.getState().chatFoldsByDrone.alpha).toEqual({ worker: { card: true } });

    // The sidebar's order: plan's tree first, its copy and worker to its right, the worker below the copy.
    const at = (chatName: string) => organizedBoard().nodesByDroneId[alpha(chatName)]!;
    expect(at('plan-copy').x).toBeGreaterThan(at('plan').x);
    expect(at('plan-copy').y).toBe(at('plan').y);
    expect(at('worker').x).toBe(at('plan-copy').x);
    expect(at('worker').y).toBeGreaterThan(at('plan-copy').y);
    expect(at('default').x).toBe(at('plan').x);
    expect(at('default').y).toBeGreaterThan(at('worker').y);
    // A copy's line is dashed; a created chat's is solid.
    const lines = Array.from(container.querySelectorAll('svg > path[stroke]'));
    expect(lines.map((line) => line.getAttribute('stroke-dasharray') ?? 'solid').sort()).toEqual(['4 4', 'solid']);
    // Positions are worked out, not stored on the drone's own board.
    expect(freeBoard().nodeOrder).toEqual([]);

    // The view is the layout's: the wheel neither zooms nor scrolls it, and there is nothing to fit or reset.
    const viewBefore = (({ panX, panY, scale }) => ({ panX, panY, scale }))(organizedBoard());
    const viewport = container.querySelector('[data-drone-canvas-viewport="1"]')!;
    for (const init of [{ deltaY: -200 }, { deltaY: 300 }, { deltaY: -200, ctrlKey: true }]) {
      await act(async () => { viewport.dispatchEvent(new dom.WheelEvent('wheel', { ...init, bubbles: true, cancelable: true })); await settle(); });
    }
    expect(organizedBoard()).toMatchObject(viewBefore);
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.textContent?.trim())).not.toContain('Fit');

    // A square opens its side chat.
    await act(async () => { Simulate.click(card('plan').querySelector('[data-canvas-side-chat-square="side-1"]')!); await settle(); });
    expect(activated).toEqual(['side-1']);

    // A dragged card goes back to its place.
    const planAt = { ...at('plan') };
    const mouse = async (type: string, x: number, y: number) => {
      await act(async () => {
        dom.dispatchEvent(new dom.MouseEvent(type, { clientX: x, clientY: y, buttons: type === 'mouseup' ? 0 : 1, bubbles: true }));
        await settle();
      });
    };
    await act(async () => Simulate.mouseDown(card('plan'), { button: 0, clientX: 10, clientY: 10 }));
    await mouse('mousemove', 300, 300);
    expect(at('plan').x).not.toBe(planAt.x);
    await mouse('mouseup', 300, 300);
    expect(at('plan')).toMatchObject(planAt);

    // Dragged onto the top of plan's tree, default goes before it: a line shows the slot, and the sidebar moves it.
    // Boxes of their own: other tests can leave happy-dom's boxes anywhere, the composer's over the whole board.
    const boxed = (selector: string, top: number, bottom: number) => Object.assign(container.querySelector(selector)!, {
      getBoundingClientRect: () => ({ left: 0, right: 1200, width: 1200, top, bottom, height: bottom - top, x: 0, y: top }),
    });
    boxed('[data-drone-canvas-viewport="1"]', 0, 800);
    boxed('[data-selected-chats-composer]', 760, 800);
    // The view as it is now: folding a card refits the board.
    const screen = (chatName: string, dx: number, dy: number) => {
      const now = organizedBoard();
      return {
        x: now.panX + (at(chatName).x * DETAILED_CARD_SPREAD.x + dx) * now.scale,
        y: now.panY + (at(chatName).y * DETAILED_CARD_SPREAD.y + dy) * now.scale,
      };
    };
    const line = () => container.querySelector('[data-organized-drop-line]')?.getAttribute('data-organized-drop-line') ?? null;
    const defaultAt = { ...at('default') };
    const from = screen('default', 5, 5);
    await act(async () => Simulate.mouseDown(card('default'), { button: 0, clientX: from.x, clientY: from.y }));
    const onPlan = screen('plan', 8, 3);
    await mouse('mousemove', onPlan.x, onPlan.y);
    expect(line()).toBe('before');
    await mouse('mouseup', onPlan.x, onPlan.y);
    expect(line()).toBeNull();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'chat-tree-move', activeNodeId: 'chat:alpha:default', overNodeId: 'chat:alpha:plan', placement: 'before' });
    // The card goes back until the sidebar's order changes.
    expect(at('default')).toMatchObject(defaultAt);
    // A child has no slot beside a tree: dragged into the gap below default, worker shows nothing and moves nothing.
    const workerFrom = screen('worker', 5, 5);
    await act(async () => Simulate.mouseDown(card('worker'), { button: 0, clientX: workerFrom.x, clientY: workerFrom.y }));
    const onDefault = screen('default', 8, 34);
    await mouse('mousemove', onDefault.x, onDefault.y);
    expect(line()).toBeNull();
    await mouse('mouseup', onDefault.x, onDefault.y);
    expect(moves).toHaveLength(1);
    expect(cards()).toContain(alpha('worker'));

    // Dropped on the middle of worker, default folds into it: a square there, and no card of its own.
    const squaresOn = (chatName: string) => Array.from(card(chatName).querySelectorAll('[data-canvas-side-chat-square]'))
      .map((el) => `${el.getAttribute('data-canvas-side-chat-square')}:${el.getAttribute('data-canvas-square-kind')}`);
    const dragCard = async (chatName: string, onto: { x: number; y: number }) => {
      const start = screen(chatName, 5, 5);
      await act(async () => Simulate.mouseDown(card(chatName), { button: 0, clientX: start.x, clientY: start.y }));
      await mouse('mousemove', onto.x, onto.y);
      // The card it would fold into lights up.
      const lit = Array.from(container.querySelectorAll('[data-canvas-node="1"]'))
        .filter((el) => el.className.includes('border-[var(--accent)]')).map((el) => el.getAttribute('data-drone-id'));
      await mouse('mouseup', onto.x, onto.y);
      return lit;
    };
    expect(await dragCard('default', screen('worker', 10, 15))).toEqual([alpha('worker')]);
    expect(cards()).not.toContain(alpha('default'));
    expect(squaresOn('worker')).toEqual(['default:chat']);
    expect(useDroneCanvasStore.getState().chatFoldsByDrone.alpha).toEqual({ worker: { card: true }, default: { host: 'worker' } });
    // Dragged off its card, the square is a card again.
    const dragSquare = async (host: string, chatName: string, to: { x: number; y: number }, shiftKey = false) => {
      const square = card(host).querySelector(`[data-canvas-side-chat-square="${chatName}"]`)!;
      await act(async () => Simulate.mouseDown(square, { button: 0, clientX: 300, clientY: 300, shiftKey }));
      await mouse('mousemove', to.x, to.y);
      const ghost = container.querySelector('[data-canvas-square-ghost]')?.getAttribute('data-canvas-square-ghost') ?? null;
      await mouse('mouseup', to.x, to.y);
      return ghost;
    };
    // Let go off the board, it stays where it was.
    await dragSquare('worker', 'default', { x: 1500, y: 300 });
    expect(squaresOn('worker')).toEqual(['default:chat']);
    expect(await dragSquare('worker', 'default', { x: 2, y: 2 })).toBe('1');
    expect(cards()).toContain(alpha('default'));
    expect(squaresOn('worker')).toEqual([]);
    // A side chat dragged off is a card beside its source; folded back into plan, it is a square again.
    expect(await dragSquare('plan', 'side-1', { x: 2, y: 2 })).toBe('1');
    expect(cards()).toContain(alpha('side-1'));
    expect(squaresOn('plan')).toEqual(['chip:side-chat']);
    expect(await dragCard('side-1', screen('plan', 10, 15))).toEqual([alpha('plan')]);
    expect(cards()).not.toContain(alpha('side-1'));
    expect(squaresOn('plan')).toEqual(['side-1:side-chat', 'chip:side-chat']);
    // Shift takes them all: onto worker, both of plan's squares move there.
    expect(await dragSquare('plan', 'chip', screen('worker', 10, 15), true)).toBe('2');
    expect(squaresOn('worker')).toEqual(['side-1:side-chat', 'chip:side-chat']);
    expect(squaresOn('plan')).toEqual([]);
    useDroneCanvasStore.getState().setChatFolds('alpha', { worker: { card: true } });
    await act(async () => { await settle(); });

    // Turned off, the drone's own board takes the chats and shows side chats as cards again; on again, the layout is back.
    const toggle = container.querySelector('button[aria-label="Organized layout"]') as unknown as Element;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { Simulate.click(toggle); await settle(); });
    expect(useDroneCanvasStore.getState().organizedDroneBoard).toBe(false);
    expect(cards()).toContain(alpha('side-1'));
    expect(cards()).not.toContain(alpha('chip'));
    expect(freeBoard().nodesByDroneId[alpha('plan')]).toBeDefined();
    await act(async () => { Simulate.click(container.querySelector('button[aria-label="Organized layout"]') as unknown as Element); await settle(); });
    expect(cards()).not.toContain(alpha('side-1'));
    expect(at('plan')).toMatchObject(planAt);

    // A new chat the Hub has not confirmed yet shows where the Hub's sorted list will put it, not at the end.
    await act(async () => {
      useDroneHubUiStore.setState({ sidebarChatOrderByDrone: {} });
      useDroneCanvasStore.getState().addOptimisticBoardMember('alpha', { chatName: 'notes', sourceChatName: '', sideChat: false, addedAt: Date.now() });
      await settle();
    });
    expect(at('notes').x).toBe(at('default').x);
    expect(at('notes').y).toBeGreaterThan(at('default').y);
    expect(at('notes').y).toBeLessThan(at('plan').y);
  } finally {
    useDroneCanvasStore.setState({ optimisticMembersByDroneId: {}, chatFoldsByDrone: {} });
    await act(async () => root.unmount());
    useDroneHubUiStore.setState({ sidebarChatOrderByDrone: {} });
    for (const [key, descriptor] of sizeOriginals) {
      if (descriptor) Object.defineProperty(dom.HTMLElement.prototype, key, descriptor);
      else Reflect.deleteProperty(dom.HTMLElement.prototype, key);
    }
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});
