import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EMPTY_CANVAS_BOARD, getCanvasBoardActions, useDroneCanvasStore } from '../src/droneHub/canvas/use-drone-canvas-store';

test('canvas persistence defers serialization, bounds staleness, and saves the latest boards without selections', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const timers = new Map<number, { run: () => void; delay: number }>();
  let nextTimer = 0;
  let now = 1000;
  const originalNow = Date.now;
  useDroneCanvasStore.persist.clearStorage();
  for (const [key, value] of Object.entries({
    window: dom,
    setTimeout: (run: () => void, delay: number) => { timers.set(++nextTimer, { run, delay }); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Date.now = () => now;
  try {
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, optimisticMembersByDroneId: {}, scope: 'global' });
    let serializedNodes = 0;
    const node = { droneId: 'draft:a', label: 'A', x: 10, y: 20 };
    const trackedNode = { ...node, toJSON() { serializedNodes++; return node; } };
    useDroneCanvasStore.setState({ nodesByDroneId: { 'draft:a': trackedNode }, nodeOrder: ['draft:a'] });
    const actions = getCanvasBoardActions('alpha');
    actions.upsertNodes([{ droneId: 'chat:a', label: 'chat', x: 5, y: 6 }]);
    actions.setSelectedDroneIds(['chat:a']);
    useDroneCanvasStore.getState().setDraftPromptForNode('draft:a', 'Keep this prompt');
    useDroneCanvasStore.getState().setSelectedDroneIds(['draft:a']);
    for (let i = 0; i < 100; i++) useDroneCanvasStore.getState().setPan(i, i * 2);
    expect(serializedNodes).toBe(0);
    expect(dom.localStorage.length).toBe(0);
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].delay).toBe(180);

    // A continuous gesture cannot keep postponing persistence beyond 900ms.
    now += 850;
    actions.moveNode('chat:a', 30, 40);
    expect([...timers.values()][0].delay).toBe(50);
    expect(serializedNodes).toBe(0);
    [...timers.values()][0].run();
    expect(serializedNodes).toBe(1);
    expect(timers.size).toBe(0);
    const key = useDroneCanvasStore.persist.getOptions().name;
    const saved = JSON.parse(dom.localStorage.getItem(key)!);
    expect(saved.version).toBe(3);
    expect(saved.state).toMatchObject({ panX: 99, panY: 198, draftPromptByNodeId: { 'draft:a': 'Keep this prompt' } });
    expect(saved.state.selectedDroneIds).toBeUndefined();
    expect(saved.state.droneBoards.alpha.selectedDroneIds).toBeUndefined();
    expect(saved.state.droneBoards.alpha.nodesByDroneId['chat:a']).toMatchObject({ x: 30, y: 40 });
    expect(saved.state.optimisticMembersByDroneId).toBeUndefined();

    // Rehydrating with an unflushed edit reads the newest snapshot, not the older disk copy.
    useDroneCanvasStore.getState().setPan(500, 600);
    await useDroneCanvasStore.persist.rehydrate();
    expect(useDroneCanvasStore.getState().panX).toBe(500);
    expect(useDroneCanvasStore.getState().selectedDroneIds).toEqual([]);
    useDroneCanvasStore.persist.clearStorage();
    expect(timers.size).toBe(0);
    expect(dom.localStorage.getItem(key)).toBeNull();
  } finally {
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, optimisticMembersByDroneId: {}, scope: 'drone' });
    useDroneCanvasStore.persist.clearStorage();
    Date.now = originalNow;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.close();
  }
});
