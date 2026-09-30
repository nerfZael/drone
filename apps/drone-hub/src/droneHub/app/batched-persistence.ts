import type { PersistStorage, StorageValue } from 'zustand/middleware';

/** Batch serialization as well as storage writes, without delaying durability. */
export function createPersistenceBatch<T>(storage: PersistStorage<T> | undefined) {
  let depth = 0;
  const pending = new Map<string, StorageValue<T>>();
  return {
    batch<R>(action: () => R): R {
      depth += 1;
      try {
        return action();
      } finally {
        depth -= 1;
        if (depth === 0) {
          const writes = [...pending];
          pending.clear();
          for (const [name, value] of writes) storage?.setItem(name, value);
        }
      }
    },
    storage: storage ? {
      getItem: (name: string) => pending.get(name) ?? storage.getItem(name),
      setItem(name: string, value: StorageValue<T>) {
        if (depth > 0) pending.set(name, value);
        else return storage.setItem(name, value);
      },
      removeItem(name: string) {
        pending.delete(name);
        return storage.removeItem(name);
      },
    } satisfies PersistStorage<T> : undefined,
  };
}
