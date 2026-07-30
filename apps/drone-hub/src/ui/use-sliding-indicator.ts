import * as React from 'react';

export type SlidingIndicatorRect = { left: number; width: number };

/**
 * Measures the currently selected item inside a container so a single
 * indicator element can glide between selections instead of each item
 * repainting its own active style. Positions are relative to the
 * container's padding box.
 */
export function useSlidingIndicator<T>(
  value: T,
  itemRefs: React.RefObject<Map<T, HTMLElement>>,
): {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  indicator: SlidingIndicatorRect | null;
} {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = React.useState<SlidingIndicatorRect | null>(null);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const target = itemRefs.current?.get(value);
    if (!container || !target) {
      setIndicator(null);
      return;
    }
    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setIndicator({
        left: targetRect.left - containerRect.left - container.clientLeft,
        width: targetRect.width,
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(target);
    return () => observer.disconnect();
  }, [value, itemRefs]);

  return { containerRef, indicator };
}
