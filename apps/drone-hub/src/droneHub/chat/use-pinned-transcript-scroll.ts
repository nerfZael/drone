import React from 'react';

const DEFAULT_BOTTOM_THRESHOLD_PX = 48;

export function isTranscriptPinned({
  scrollHeight,
  scrollTop,
  clientHeight,
  threshold = DEFAULT_BOTTOM_THRESHOLD_PX,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  threshold?: number;
}): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function computePrependedTranscriptScrollTop({
  previousScrollTop,
  previousScrollHeight,
  nextScrollHeight,
  clientHeight,
}: {
  previousScrollTop: number;
  previousScrollHeight: number;
  nextScrollHeight: number;
  clientHeight: number;
}): number {
  const heightDelta = Math.max(0, nextScrollHeight - previousScrollHeight);
  const maxScrollTop = Math.max(0, nextScrollHeight - clientHeight);
  return Math.min(maxScrollTop, Math.max(0, previousScrollTop + heightDelta));
}

export function shouldAutoFollowTranscript({
  enabled,
  pinned,
  preservingPrepend,
}: {
  enabled: boolean;
  pinned: boolean;
  preservingPrepend: boolean;
}): boolean {
  return enabled && pinned && !preservingPrepend;
}

export function usePinnedTranscriptScroll({
  contextKey,
  contentVersion,
  enabled = true,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD_PX,
}: {
  contextKey: string;
  contentVersion: unknown;
  enabled?: boolean;
  bottomThreshold?: number;
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const pinnedRef = React.useRef(true);
  const preservingPrependRef = React.useRef(false);
  const [scrollNode, setScrollNode] = React.useState<HTMLDivElement | null>(null);
  const [contentNode, setContentNode] = React.useState<HTMLDivElement | null>(null);

  const bindScrollRef = React.useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollNode((current) => (current === node ? current : node));
  }, []);

  const bindContentRef = React.useCallback((node: HTMLDivElement | null) => {
    setContentNode((current) => (current === node ? current : node));
  }, []);

  const updatePinned = React.useCallback(
    (node: HTMLDivElement | null = scrollRef.current) => {
      if (!node) return;
      pinnedRef.current = isTranscriptPinned({
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        threshold: bottomThreshold,
      });
    },
    [bottomThreshold],
  );

  const scrollToBottom = React.useCallback(
    (options: { force?: boolean; retries?: number } = {}) => {
      const { force = false, retries = 4 } = options;
      if (force) pinnedRef.current = true;
      let triesRemaining = retries;
      const attempt = () => {
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (!node) {
            if (triesRemaining > 0) {
              triesRemaining -= 1;
              attempt();
            }
            return;
          }
          if (!force && !pinnedRef.current) return;
          node.scrollTop = node.scrollHeight;
          updatePinned(node);
          if (force) pinnedRef.current = true;
          const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
          if (gap > 1 && triesRemaining > 0) {
            triesRemaining -= 1;
            attempt();
          }
        });
      };
      attempt();
    },
    [updatePinned],
  );

  const preserveScrollOnPrepend = React.useCallback(
    async <T,>(load: () => Promise<T>): Promise<T> => {
      const node = scrollRef.current;
      const previousScrollHeight = node?.scrollHeight ?? 0;
      const previousScrollTop = node?.scrollTop ?? 0;
      preservingPrependRef.current = true;
      let result: T;
      try {
        result = await load();
      } catch (error) {
        preservingPrependRef.current = false;
        throw error;
      }
      requestAnimationFrame(() => {
        const current = scrollRef.current;
        if (current) {
          current.scrollTop = computePrependedTranscriptScrollTop({
            previousScrollTop,
            previousScrollHeight,
            nextScrollHeight: current.scrollHeight,
            clientHeight: current.clientHeight,
          });
          updatePinned(current);
        }
        preservingPrependRef.current = false;
      });
      return result;
    },
    [updatePinned],
  );

  React.useLayoutEffect(() => {
    if (!enabled || !scrollNode) return;
    pinnedRef.current = true;
    scrollToBottom({ force: true });
  }, [contentNode, contextKey, enabled, scrollNode, scrollToBottom]);

  React.useEffect(() => {
    if (!shouldAutoFollowTranscript({
      enabled,
      pinned: pinnedRef.current,
      preservingPrepend: preservingPrependRef.current,
    })) return;
    scrollToBottom();
  }, [contentVersion, enabled, scrollToBottom]);

  React.useEffect(() => {
    if (!enabled || !scrollNode) return;
    const onScroll = () => updatePinned(scrollNode);
    scrollNode.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollNode.removeEventListener('scroll', onScroll);
  }, [contextKey, enabled, scrollNode, updatePinned]);

  React.useEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return;
    if (!scrollNode && !contentNode) return;
    const observer = new ResizeObserver(() => {
      if (shouldAutoFollowTranscript({
        enabled,
        pinned: pinnedRef.current,
        preservingPrepend: preservingPrependRef.current,
      })) {
        scrollToBottom({ retries: 1 });
      }
    });
    if (scrollNode) observer.observe(scrollNode);
    if (contentNode) observer.observe(contentNode);
    return () => observer.disconnect();
  }, [contentNode, contextKey, enabled, scrollNode, scrollToBottom]);

  return {
    bindContentRef,
    bindScrollRef,
    preserveScrollOnPrepend,
    scrollRef,
    scrollToBottom,
    updatePinned,
  };
}
