import { expect } from 'bun:test';
import { chatChannel, Entity, keypadChannel, replayRuntime, type EntityEvent, type EntityOptions, type Mind, type MindRunInput } from '../src/index.js';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(2);
  }
}

export type Script = (input: MindRunInput, call: (name: string, args?: Record<string, unknown>) => Promise<string>) => Promise<string | void>;

/** A mind that runs a test script instead of a model. */
export function scriptedMind(script: Script): Mind & { runs: MindRunInput[]; forgotten: string[]; forks: [string, string][] } {
  const runs: MindRunInput[] = [];
  const forgotten: string[] = [];
  const forks: [string, string][] = [];
  return {
    runs,
    forgotten,
    forks,
    fork(from, to) { forks.push([from, to]); return !forgotten.includes(from); },
    async run(input) {
      runs.push(input);
      const text = await script(input, (name, args = {}) => input.callTool(name, args));
      if (input.signal.aborted) throw new Error('aborted');
      return { text: text ?? undefined };
    },
    forget(key) { forgotten.push(key); },
  };
}

export function makeEntity(script: Script, options: Partial<EntityOptions> = {}) {
  const mind = scriptedMind(script);
  const entity = new Entity({
    mind,
    channels: [chatChannel(), keypadChannel()],
    models: { head: 'test/head', task: 'test/task' },
    ...options,
    config: { messageDebounceMs: 5, tickMs: 5, cancelGraceMs: 50, ...options.config },
  });
  const events = () => entity.log.all() as EntityEvent[];
  const of = (type: string, by?: (b: string) => boolean) => events().filter(e => e.type === type && (!by || by(e.by)));
  const entityKeys = (type: 'key_down' | 'key_up', after = 0) => of(type, b => b !== 'user').filter(e => e.seq > after);
  const said = () => of('chat_message', b => b !== 'user').map(e => String(e.data.text));
  /** The log is the only source of truth: replaying it must rebuild exactly the runtime state the entity holds. */
  const expectReplayable = () => expect(replayRuntime(events(), entity.runtime().setup)).toEqual(entity.runtime() as ReturnType<typeof replayRuntime>);
  return { entity, mind, events, of, entityKeys, said, expectReplayable };
}

export const lastUserMessage = (input: MindRunInput) => {
  const lines = input.prompt.split('\n').filter(line => line.includes(' user chat_message '));
  const last = lines.at(-1);
  return last ? JSON.parse(last.slice(last.indexOf('{'))).text as string : '';
};

/** A task limb's own task (the top-level "task" in its state, not the workers list). */
export const ownTask = (input: MindRunInput) => stableState(input).task as string ?? '';

/** The STATE (stable) part of a prompt. For a worker's later wakes, only what changed since its last one. */
export const stableState = (input: MindRunInput): Record<string, unknown> => {
  const lines = input.prompt.split('\n');
  const at = lines.findIndex(line => line.startsWith('STATE (stable'));
  return at < 0 ? {} : JSON.parse(lines[at + 1]);
};
