const DRONE_OP_LOCKS = new Map<string, Promise<void>>();

export async function withDroneOpLock<T>(keyRaw: string, fn: () => Promise<T>): Promise<T> {
  const key = String(keyRaw ?? '').trim();
  if (!key) return await fn();
  const prev = DRONE_OP_LOCKS.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const chained = prev.then(() => gate);
  DRONE_OP_LOCKS.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    try {
      release();
    } finally {
      if (DRONE_OP_LOCKS.get(key) === chained) DRONE_OP_LOCKS.delete(key);
    }
  }
}

