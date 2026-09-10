import React from 'react';

const useLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function useCompactChat(ref: React.RefObject<HTMLElement>, mounted = true): boolean {
  const [compact, setCompact] = React.useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    const floatingChat = root?.closest('.dh-floating-chat');
    if (!root || !floatingChat) return;
    // Share the container-query setting used by the slim composer.
    const update = () => setCompact(
      getComputedStyle(root).getPropertyValue('--chat-compact').trim() === '1',
    );
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(floatingChat);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return compact;
}
