import React from 'react';

/** How long the pointer must rest on a card before its steps show. */
export const CARD_HOVER_DELAY_MS = 450;

/**
 * The card the pointer rests on, for the steps panel. A card shows only after the pointer has stayed on it a moment,
 * so passing over cards, or the board moving under a still pointer while panning, shows nothing; leaving hides it at
 * once. Kept outside React state so a hover renders the panel alone, not the whole canvas.
 */
export type CardHover = {
  subscribe: (listener: () => void) => () => void;
  shown: () => string | null;
  /** The pointer entered a card, or left one (null). */
  hover: (id: string | null) => void;
  /** Hides the panel now and forgets the card the pointer is on, e.g. when a pan or drag starts. */
  clear: () => void;
};

export function createCardHover(delayMs = CARD_HOVER_DELAY_MS): CardHover {
  let shown: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const show = (id: string | null) => {
    if (shown === id) return;
    shown = id;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shown: () => shown,
    hover(id) {
      cancel();
      if (id === null || id !== shown) show(null);
      if (id === null) return;
      timer = setTimeout(() => {
        timer = null;
        show(id);
      }, delayMs);
    },
    clear() {
      cancel();
      show(null);
    },
  };
}

/** Renders what the hovered card shows; only this re-renders when hover changes. */
export function HoveredCard({ hover, children }: { hover: CardHover; children: (id: string) => React.ReactNode }) {
  const id = React.useSyncExternalStore(hover.subscribe, hover.shown);
  return id === null ? null : <>{children(id)}</>;
}
