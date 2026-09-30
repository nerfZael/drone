import { expect, test } from 'bun:test';
import { createPersistenceBatch } from '../src/droneHub/app/batched-persistence';

test('nested navigation updates serialize and persist only their final state before returning', () => {
  const writes: string[] = [];
  const { batch, storage } = createPersistenceBatch<{ chat: string }>({
    getItem: () => null,
    setItem: (_name, value) => { writes.push(JSON.stringify(value)); },
    removeItem: () => {},
  });
  batch(() => {
    storage!.setItem('ui', { state: { chat: 'first' } });
    batch(() => storage!.setItem('ui', { state: { chat: 'second' } }));
    expect(storage!.getItem('ui')).toEqual({ state: { chat: 'second' } });
    expect(writes).toHaveLength(0);
  });
  expect(writes).toEqual(['{"state":{"chat":"second"}}']);
});

test('removing storage cancels a pending write and failed actions still persist their completed updates', () => {
  const writes: unknown[] = [];
  const { batch, storage } = createPersistenceBatch({
    getItem: () => null,
    setItem: (_name, value) => { writes.push(value); },
    removeItem: () => {},
  });
  batch(() => {
    storage!.setItem('ui', { state: 1 });
    storage!.removeItem('ui');
  });
  expect(writes).toHaveLength(0);
  expect(() => batch(() => {
    storage!.setItem('ui', { state: 2 });
    throw new Error('navigation failed');
  })).toThrow('navigation failed');
  expect(writes).toEqual([{ state: 2 }]);
});
