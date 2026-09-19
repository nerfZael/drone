import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as selection from '../src/droneHub/app/chat-selection-model';
import * as builder from '../src/droneHub/app/external-agent-composer-controls';
import { isDroneStartingOrSeeding } from '../src/droneHub/app/helpers';

test('window model picker loads its own configuration and saves model/reasoning to that chat only', async () => {
  let cursor = 0;
  const slots: any[] = [];
  const effects: Array<() => void> = [];
  const cache = new Map<string, any>();
  const calls: Array<{ url: string; body: unknown }> = [];
  const reads: any[] = [];
  const useMemo = (factory: () => any, deps: any[]) => {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const react = {
    useMemo, useCallback: (callback: any, deps: any[]) => useMemo(() => callback, deps),
    useRef: (value: any) => useMemo(() => ({ current: value }), []),
    useState(initial: any) {
      const state = useMemo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [state.value, (next: any) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useEffect(effect: () => void, deps: any[]) { useMemo(() => { effects.push(effect); }, deps); },
  };
  const dependencies: Record<string, any> = {
    react, './chat-selection-model': selection, './external-agent-composer-controls': builder,
    './helpers': { isDroneStartingOrSeeding }, './hooks': { isNotFoundError: () => false },
    './chat-load-telemetry': { markChatLoadConfigResolved() {} },
    './chat-runtime-cache': {
      readFreshChatRuntimeCache: (key: string) => cache.get(key),
      writeChatRuntimeCache: (key: string, value: any) => cache.set(key, value),
      deleteChatRuntimeCache: (key: string) => cache.delete(key),
    },
    './use-agent-model-catalog': { useAgentModelCatalog: () => ({ models: [
      { id: 'model-two', label: 'Model two', reasoningLevels: ['low', 'high'], defaultReasoningLevel: 'high' },
    ], loading: false, stale: false, error: null }) },
    '../http': { requestJson: async (url: string, options: any) => { calls.push({ url, body: JSON.parse(options.body) }); return {}; } },
    './chat-api': { fetchDroneChatStateCached: async (target: any) => {
      reads.push(target);
      return { notModified: false, chatInfo: { name: target.droneId, chat: target.chatName,
        agent: { kind: 'builtin', id: 'codex' }, model: 'model-one', reasoning: 'low' } };
    } },
  };
  function load(name: string) {
    const compiled = ts.transpileModule(readFileSync(new URL(`../src/droneHub/app/${name}.ts`, import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: any = {};
    new Function('require', 'exports', compiled)((id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected import: ${id}`);
      return dependencies[id];
    }, exports);
    return exports;
  }
  dependencies['./use-chat-config-state'] = load('use-chat-config-state');
  const { useWindowChatModelControls } = load('use-window-chat-model-controls');
  const drone = { id: 'other-drone', chats: ['default'], sideChats: [{ name: 'fork-A' }] };
  const render = () => {
    cursor = 0;
    const result = useWindowChatModelControls(drone, 'fork-A', []);
    effects.splice(0).forEach(effect => effect());
    return result;
  };
  render();
  await Promise.resolve();
  const picker = render().controls.controls[0];
  expect(reads).toEqual([expect.objectContaining({ droneId: 'other-drone', chatName: 'fork-A', includeConfig: true })]);
  expect(picker.currentModel).toBe('model-one');
  picker.onSelect({ provider: 'external', id: 'model-two' }, 'model');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(calls).toEqual([{ url: '/api/drones/other-drone/chats/fork-A/config', body: { model: 'model-two', reasoning: 'high' } }]);
  expect(render().controls.controls[0].currentModel).toBe('model-two');
});
