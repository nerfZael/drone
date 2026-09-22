import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useDroneSelectionState } from '../src/droneHub/app/use-drone-selection-state';
import type { DroneSummary } from '../src/droneHub/types';
import { useSelectionHistory } from '../src/droneHub/app/use-selection-history';
import type { SelectionHistoryEntry } from '../src/droneHub/app/selection-history';

test('committed React selections retain forward history after restoration', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const first = { droneId: 'first', chatName: 'default' };
  const second = { droneId: 'first', chatName: 'review' };
  const third = { droneId: 'second', chatName: 'default' };
  let select!: (entry: SelectionHistoryEntry) => void;
  let navigation!: ReturnType<typeof useSelectionHistory>;
  let selected = first;
  let setWorkspace!: (visible: boolean) => void;
  let workspace = true;
  let setGroup!: (group: string | null) => void;
  let group: string | null = null;
  const drones = [
    { id: 'first', chats: ['default', 'review'] },
    { id: 'second', chats: ['default'] },
  ] as DroneSummary[];
  const droneById = Object.fromEntries(drones.map((drone) => [drone.id, drone]));
  const droneIds = drones.map((drone) => drone.id);
  const droneIdSet = new Set(droneIds);
  const noop = () => {};

  function Fixture() {
    const [entry, setEntry] = React.useState(first);
    const [visible, setVisible] = React.useState(true);
    setWorkspace = setVisible;
    workspace = visible;
    const [groupSelection, setGroupSelection] = React.useState<string | null>(null);
    const [selectedDroneIds, setSelectedDroneIds] = React.useState(['first']);
    setGroup = setGroupSelection;
    group = groupSelection;
    selected = entry;
    const selection = useDroneSelectionState({
      orderedDroneIds: droneIds, selectedDrone: entry.droneId, selectedChat: entry.chatName,
      selectedDroneIds, activeRepoPath: '', homeOpen: false, draftChat: null,
      droneById, dronesReady: true, dronesFilteredByRepoIdSet: droneIdSet,
      visibleDronesFilteredByRepo: drones, retainedDroneIds: [], startupSeedByDrone: {},
      selectionAnchorRef: React.useRef<string | null>(null),
      preferredSelectedDroneRef: React.useRef<string | null>(null),
      preferredSelectedDroneHoldUntilRef: React.useRef(0),
      scrollChatToBottom: noop, resetGroupDndState: noop, setGroupMoveError: noop,
      setAppView: (view) => setVisible(view === 'workspace'), setHomeOpen: noop,
      setDraftChat: noop, setDraftCreateOpen: noop, setDraftCreateError: noop,
      setSelectedDrone: (next) => setEntry((current) => ({ ...current,
        droneId: (typeof next === 'function' ? next(current.droneId) : next) ?? '',
      })),
      setSelectedChat: (next) => setEntry((current) => ({ ...current,
        chatName: typeof next === 'function' ? next(current.chatName) : next,
      })),
      setSelectedDroneIds, setSelectedGroupMultiChat: setGroupSelection,
    });
    select = (target) => selection.selectDroneChat(target.droneId, target.chatName);
    navigation = useSelectionHistory({
      droneId: visible && !groupSelection ? entry.droneId : null, chatName: entry.chatName,
      ready: true, available: () => true,
      select: (target) => {
        setVisible(true);
        setGroupSelection(null);
        selection.selectDroneChat(target.droneId, target.chatName);
      },
    });
    return <div>{entry.droneId}/{entry.chatName}</div>;
  }
  const host = dom.document.createElement('div');
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () => root.render(<React.StrictMode><Fixture /></React.StrictMode>));
    await act(async () => select(second));
    await act(async () => select(third));
    await act(async () => setWorkspace(false));
    await act(async () => { expect(navigation.navigateBack()).toBe(true); });
    expect(workspace).toBe(true);
    expect(selected).toEqual(third);
    await act(async () => setGroup('group'));
    await act(async () => { expect(navigation.navigateBack()).toBe(true); });
    expect(group).toBeNull();
    expect(selected).toEqual(third);
    await act(async () => { expect(navigation.navigateBack()).toBe(true); });
    expect(selected).toEqual(second);
    await act(async () => { expect(navigation.navigateBack()).toBe(true); });
    expect(selected).toEqual(first);
    await act(async () => { expect(navigation.navigateForward()).toBe(true); });
    expect(selected).toEqual(second);
    await act(async () => { expect(navigation.navigateForward()).toBe(true); });
    expect(selected).toEqual(third);
    await act(async () => { expect(navigation.navigateForward()).toBe(false); });
    await act(async () => { navigation.navigateBack(); });
    await act(async () => select(first));
    await act(async () => { expect(navigation.navigateForward()).toBe(false); });
  } finally {
    await act(async () => root.unmount());
    dom.happyDOM.cancelAsync();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
