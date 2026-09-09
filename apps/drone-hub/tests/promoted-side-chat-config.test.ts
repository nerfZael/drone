import React from 'react';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as selection from '../src/droneHub/app/chat-selection-model';
import { isDroneStartingOrSeeding } from '../src/droneHub/app/helpers';
import type { useChatConfigState } from '../src/droneHub/app/use-chat-config-state';
import type { ChatInfo } from '../src/domain';
import type { DroneSummary } from '../src/droneHub/types';

// Exercise the real configuration hook through promotion and summary updates.
// Only model discovery, telemetry, and cache storage are substituted.
function configHarness() {
  let cursor = 0;
  const slots: any[] = [];
  const effects: Array<() => void> = [];
  const cache = new Map<string, any>();
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
    './chat-runtime-cache': {
      readFreshChatRuntimeCache: (key: string) => cache.get(key) ?? null,
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
      return exports.useChatConfigState!({ selectedDrone: drone.id, selectedChat: chat, droneById: { [drone.id]: drone }, requestJson: async () => { throw new Error('Unexpected request'); } });
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
    expect(render(drone, 'default').chatInfo).toEqual(main);
    expect(render(drone, side.name).chatInfo).toEqual(config);
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
