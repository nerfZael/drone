/**
 * A wheel or pinch zoom in progress. While it lasts the canvas world is one composited layer that the GPU
 * scales without drawing it again, so nothing inside it may change: cards keep the readability boost they
 * had when it began (drawing every card again at each zoom step drops frames on a full board). It ends once
 * the wheel has been still for a moment; then cards take the boost for the new zoom and are drawn sharp.
 */
export type ZoomGesture = {
  subscribe: (listener: () => void) => () => void;
  /** The zoom cards are boosted for while a gesture lasts; null when none is in progress. */
  frozenScale: () => number | null;
  /** A wheel event, with the zoom before it applies. Starts a gesture or keeps it going. */
  touch: (scale: number) => void;
  end: () => void;
};

export const ZOOM_GESTURE_IDLE_MS = 150;

export function createZoomGesture(idleMs = ZOOM_GESTURE_IDLE_MS): ZoomGesture {
  let frozenScale: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const end = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (frozenScale === null) return;
    frozenScale = null;
    emit();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    frozenScale: () => frozenScale,
    touch(scale) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(end, idleMs);
      if (frozenScale !== null) return;
      frozenScale = scale;
      emit();
    },
    end,
  };
}
