/** Keep the latest pointer sample; flush before a gesture ends so its last move is not lost. */
export function createFrameBatch<T>(apply: (value: T) => void) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const next = pending;
    pending = null;
    if (next) apply(next.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    flush,
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    },
  };
}
