import React from 'react';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as selection from '../src/droneHub/app/chat-selection-model';
import { isDroneStartingOrSeeding } from '../src/droneHub/app/helpers';
import type { useChatConfigState } from '../src/droneHub/app/use-chat-config-state';
import type { ChatInfo } from '../src/domain';
import * as agentModelPicks from '../src/droneHub/app/agent-model-picks';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';
import type { DroneSummary } from '../src/droneHub/types';

// Exercise the real configuration hook through promotion and summary updates.
// Only model discovery, telemetry, and cache storage are substituted.
function configHarness(cache = new Map<string, any>(), requestJson: (url: string, init?: any) => Promise<any> = async () => {
  throw new Error('Unexpected request');
}) {
  let cursor = 0;
  const slots: any[] = [];
  const effects: Array<() => void> = [];
  const useMemo = (factory: () => any, deps: any[]) => {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const react = {
    ...React,
    useMemo,
    useCallback: (callback: any, deps: any[]) => useMemo(() => callback, deps),
    useState(initial: any) {
      const state = useMemo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [state.value, (next: any) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useEffect(effect: () => void, deps: any[]) {
      useMemo(() => { effects.push(effect); }, deps);
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/droneHub/app/use-chat-config-state.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: { useChatConfigState?: typeof useChatConfigState } = {};
  const dependencies: Record<string, unknown> = {
    react,
    './chat-selection-model': selection,
    './helpers': { isDroneStartingOrSeeding },
    './hooks': { isNotFoundError: () => false },
    './use-agent-model-catalog': { useAgentModelCatalog: () => ({ models: [], loading: false }) },
    './chat-load-telemetry': { markChatLoadConfigResolved() {} },
    './agent-model-picks': agentModelPicks,
    './chat-runtime-cache': {
      readChatRuntimeSnapshot: (key: string) => cache.get(key) ?? null,
      writeChatRuntimeCache: (key: string, value: any) => cache.set(key, value),
      deleteChatRuntimeCache: (key: string) => cache.delete(key),
    },
  };
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, exports);
  return (drone: DroneSummary, chat: string) => {
    const render = () => {
      cursor = 0;
      return exports.useChatConfigState!({ selectedDrone: drone.id, selectedChat: chat, droneById: { [drone.id]: drone }, requestJson });
    };
    render();
    effects.splice(0).forEach((effect) => effect());
    return render();
  };
}

const side = { name: 'side-promoted', sourceChatName: 'default', checkpointId: 'answer', agent: { kind: 'native' } };
const drone = { id: 'promotion-drone', chats: ['default'], sideChats: [side] } as DroneSummary;

test.each([{ kind: 'native' }, { kind: 'builtin', id: 'codex' }] as const)(
  'promoted side chat accepts its %j configuration and retains it when revisited', (agent) => {
    const render = configHarness();
    const main = { chat: 'default', agent: { kind: 'builtin', id: 'claude' } } as ChatInfo;
    render(drone, 'default').resolveChatInfoFromState(main);
    expect(render(drone, 'default').chatInfo).toEqual(main);
    const promoted = render(drone, side.name);
    expect(promoted.loadingChatInfo).toBe(true);
    expect(promoted.chatInfo).toBeNull();
    const config = { chat: side.name, agent } as ChatInfo;
    promoted.resolveChatInfoFromState(config);
    const loaded = render(drone, side.name);
    expect(loaded.chatInfo).toEqual(config);
    expect(selection.chatConfigResolutionState({ currentChatIsDraft: false, hasChats: true, metadataAvailable: Boolean(loaded.chatInfo), loading: loaded.loadingChatInfo })).toBe('ready');
    const revisitedMain = render(drone, 'default');
    expect(revisitedMain.chatInfo).toEqual(main);
    expect(revisitedMain.loadingChatInfo).toBe(false);
    const revisitedSide = render(drone, side.name);
    expect(revisitedSide.chatInfo).toEqual(config);
    expect(revisitedSide.loadingChatInfo).toBe(false);
    expect(drone.chats).toEqual(['default']);
  },
);

test('a newly created side chat becomes eligible when its summary arrives', () => {
  const render = configHarness();
  const before = { ...drone, sideChats: [] };
  expect(render(before, side.name).loadingChatInfo).toBe(false);
  expect(render(drone, side.name).loadingChatInfo).toBe(true);
  render(drone, side.name).resolveChatInfoFromState({ chat: side.name, agent: side.agent } as ChatInfo);
  expect(render(drone, side.name).chatInfo?.chat).toBe(side.name);
  // Removing it must still invalidate its cached metadata.
  expect(render(before, side.name).chatInfo).toBeNull();
});


test.each(['same-drone', 'other-drone'])(
  'a revisited chat keeps its active configuration after cache expiry (%s)', (destination) => {
    const cache = new Map<string, any>();
    const render = configHarness(cache);
    const config = { chat: 'default', agent: { kind: 'builtin', id: 'codex' } } as ChatInfo;
    render(drone, 'default').resolveChatInfoFromState(config);
    const otherDrone = destination === 'same-drone' ? drone : { ...drone, id: 'another-drone' };
    const otherChat = destination === 'same-drone' ? side.name : 'default';
    render(otherDrone, otherChat).resolveChatInfoFromState({ chat: otherChat, agent: { kind: 'native' } } as ChatInfo);
    expect(render(drone, 'default').chatInfo).toEqual(config);

    // Expiry does not itself render React; sending a message or receiving an
    // update does. No new configuration response arrives for a cached chat.
    cache.clear();
    const afterUpdate = render({ ...drone }, 'default');
    expect(afterUpdate.chatInfo).toEqual(config);
    expect(afterUpdate.loadingChatInfo).toBe(false);
    expect(afterUpdate.chatInfoError).toBeNull();
    expect(selection.chatConfigResolutionState({
      currentChatIsDraft: false, hasChats: true,
      metadataAvailable: Boolean(afterUpdate.chatInfo), loading: afterUpdate.loadingChatInfo,
    })).toBe('ready');
  },
);

test('a chat switched back to an agent gets the model and reasoning last picked for it', async () => {
  const previous = useDroneHubUiStore.getState().agentModelPicks;
  const bodies: any[] = [];
  const render = configHarness(new Map(), async (_url, init) => { bodies.push(JSON.parse(init.body)); return {}; });
  try {
    useDroneHubUiStore.setState({ agentModelPicks: {} });
    render(drone, 'default').resolveChatInfoFromState(
      { chat: 'default', agent: { kind: 'builtin', id: 'claude' }, model: 'opus', reasoning: null } as ChatInfo,
    );
    // Only the reasoning changes; the model it goes with is remembered too.
    await render(drone, 'default').setChatModelSettings({ reasoning: 'High' });
    await render(drone, 'default').setChatAgent({ kind: 'builtin', id: 'codex' });
    expect(render(drone, 'default').chatInfo).toMatchObject({ model: null, reasoning: null });
    await render(drone, 'default').setChatAgent({ kind: 'builtin', id: 'claude' });
    expect(bodies.at(-1)).toMatchObject({ agent: { kind: 'builtin', id: 'claude' }, model: 'opus', reasoning: 'high' });
    expect(render(drone, 'default').chatInfo).toMatchObject({ model: 'opus', reasoning: 'high' });
  } finally {
    useDroneHubUiStore.setState({ agentModelPicks: previous });
  }
});

test('an open chat takes an agent change announced by another view', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  try {
    const render = configHarness();
    const codex = { chat: 'default', agent: { kind: 'builtin', id: 'codex' }, model: 'gpt-6.1-sol', reasoning: 'medium' } as ChatInfo;
    render(drone, 'default').resolveChatInfoFromState(codex);
    // As the canvas composer does for a new chat selected on the board.
    const settings = { agent: { kind: 'builtin', id: 'claude' }, model: 'claude-opus-5-5', reasoning: null, agentPermissionMode: 'execute' };
    events.dispatchEvent(new CustomEvent('drone-hub:chat-model-settings-changed', { detail: { droneId: drone.id, chatName: 'default', settings } }));
    expect(render(drone, 'default').chatInfo).toEqual({ ...codex, ...settings } as ChatInfo);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete (globalThis as { window?: unknown }).window;
  }
});
