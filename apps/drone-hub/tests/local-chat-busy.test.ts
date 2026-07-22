import { beforeEach, describe, expect, test } from 'bun:test';

const storedValues = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
    removeItem: (key: string) => storedValues.delete(key),
  },
});

const { beginLocalChatBusy, useDroneHubRuntimeStore } = await import(
  '../src/droneHub/app/use-drone-hub-runtime-store'
);

describe('local chat busy state', () => {
  beforeEach(() => {
    useDroneHubRuntimeStore.getState().setLocalBusyChatCountByNodeId({});
  });

  test('keeps a chat busy until every local reporter finishes', () => {
    const finishFirst = beginLocalChatBusy(' drone:default ');
    const finishSecond = beginLocalChatBusy('drone:default');

    expect(useDroneHubRuntimeStore.getState().localBusyChatCountByNodeId).toEqual({
      'drone:default': 2,
    });

    finishFirst();
    finishFirst();
    expect(useDroneHubRuntimeStore.getState().localBusyChatCountByNodeId).toEqual({
      'drone:default': 1,
    });

    finishSecond();
    expect(useDroneHubRuntimeStore.getState().localBusyChatCountByNodeId).toEqual({});
  });

  test('ignores an empty chat node id', () => {
    beginLocalChatBusy('   ')();
    expect(useDroneHubRuntimeStore.getState().localBusyChatCountByNodeId).toEqual({});
  });
});
