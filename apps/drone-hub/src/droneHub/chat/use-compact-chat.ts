import React from 'react';

const useLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function useCompactChat(ref: React.RefObject<HTMLElement>, mounted = true): boolean {
  const [compact, setCompact] = React.useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    const floatingChat = root?.closest('.dh-floating-chat');
    if (!root || !floatingChat) return;
    // A chat in its own desktop window lives in that window's document, and
    // only that window's observer reports its resizes.
    const view = (root.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    // Share the container-query setting used by the slim composer.
    const update = () => setCompact(
      view.getComputedStyle(root).getPropertyValue('--chat-compact').trim() === '1',
    );
    update();
    if (typeof view.ResizeObserver === 'undefined') return;
    const observer = new view.ResizeObserver(update);
    observer.observe(floatingChat);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return compact;
}
