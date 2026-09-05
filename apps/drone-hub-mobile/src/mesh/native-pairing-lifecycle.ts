type NativePairing = { start(descriptor: string): Promise<void>; stop(): Promise<void> };

// The native listener is a singleton, even across React screen unmount/remounts.
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => undefined).then(action);
  pending = next;
  return next;
}

export function startNativePairing(
  native: NativePairing,
  descriptor: string,
  isCurrent: () => boolean,
) {
  return serialize(async () => {
    if (!isCurrent()) return false;
    await native.start(descriptor);
    if (isCurrent()) return true;
    // Clean up before a later session can start, never after it.
    await native.stop();
    return false;
  });
}

export function stopNativePairing(native: NativePairing) {
  return serialize(() => native.stop());
}

export function refreshNativePairing(
  native: NativePairing & { refresh(descriptor: string): Promise<void> },
  descriptor: string,
  isCurrent: () => boolean,
) {
  return serialize(async () => {
    if (!isCurrent()) return false;
    await native.refresh(descriptor);
    return isCurrent();
  });
}
