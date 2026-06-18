const locks = new Map<string, Promise<void>>();

async function acquireLock(key: string): Promise<() => void> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chained = previous
    .catch(() => {
      // Keep the lock chain alive even if an earlier waiter failed.
    })
    .then(() => current);
  locks.set(key, chained);
  await previous.catch(() => undefined);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (locks.get(key) === chained) locks.delete(key);
    releaseCurrent();
  };
}

export async function withMutationLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const uniqueKeys = Array.from(new Set(keys)).sort();
  const releases: Array<() => void> = [];
  try {
    for (const key of uniqueKeys) {
      releases.push(await acquireLock(key));
    }
    return await fn();
  } finally {
    for (const release of releases.reverse()) release();
  }
}
