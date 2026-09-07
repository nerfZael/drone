import React from 'react';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';

const DEFAULT_BOTTOM_THRESHOLD_PX = 48;
type TranscriptScrollSnapshot = {
  scrollTop: number;
  scrollHeight: number;
  pinned: boolean;
};
type TranscriptScrollMetrics = Pick<HTMLDivElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>;

function transcriptScrollMetrics(node: HTMLDivElement): TranscriptScrollMetrics {
  return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
}

const transcriptScrollByContext = new Map<string, TranscriptScrollSnapshot>();

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (!droneId) return;
    for (const key of transcriptScrollByContext.keys()) {
      if (key.startsWith(`${droneId}:`)) transcriptScrollByContext.delete(key);
    }
  });
}

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
  const lastScrollMetricsRef = React.useRef<TranscriptScrollMetrics | null>(null);
  const scrollGenerationRef = React.useRef(0);
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
      lastScrollMetricsRef.current = transcriptScrollMetrics(node);
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
      const generation = scrollGenerationRef.current;
      let triesRemaining = retries;
      const attempt = () => {
        requestAnimationFrame(() => {
          if (generation !== scrollGenerationRef.current) return;
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
      const generation = scrollGenerationRef.current;
      const previousScrollHeight = node?.scrollHeight ?? 0;
      const previousScrollTop = node?.scrollTop ?? 0;
      preservingPrependRef.current = true;
      let result: T;
      try {
        result = await load();
      } catch (error) {
        if (generation === scrollGenerationRef.current) preservingPrependRef.current = false;
        throw error;
      }
      requestAnimationFrame(() => {
        if (generation !== scrollGenerationRef.current) return;
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
    preservingPrependRef.current = false;
    if (!enabled || !scrollNode) return;
    lastScrollMetricsRef.current = transcriptScrollMetrics(scrollNode);
    let restoreFrame: number | null = null;
    const saved = transcriptScrollByContext.get(contextKey);
    if (!saved) {
      pinnedRef.current = true;
      scrollToBottom({ force: true });
    } else {
      pinnedRef.current = saved.pinned;
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = null;
        if (saved.pinned) {
          scrollNode.scrollTop = scrollNode.scrollHeight;
        } else {
          scrollNode.scrollTop = computePrependedTranscriptScrollTop({
            previousScrollTop: saved.scrollTop,
            previousScrollHeight: saved.scrollHeight,
            nextScrollHeight: scrollNode.scrollHeight,
            clientHeight: scrollNode.clientHeight,
          });
        }
        updatePinned(scrollNode);
      });
    }
    return () => {
      // Queued follow/prepend work belongs to this chat and this scroll surface.
      scrollGenerationRef.current += 1;
      if (restoreFrame != null) window.cancelAnimationFrame(restoreFrame);
      if (scrollNode.scrollHeight <= 0) return;
      transcriptScrollByContext.set(contextKey, {
        scrollTop: scrollNode.scrollTop,
        scrollHeight: scrollNode.scrollHeight,
        // pinnedRef is updated while the surface is live. Measuring again in
        // cleanup can observe the transient pre-scroll state from React Strict
        // Mode (or a container whose layout is already collapsing) and turn an
        // intended bottom-pinned chat into a saved scroll-to-top position.
        pinned: pinnedRef.current,
      });
    };
  }, [bottomThreshold, contentNode, contextKey, enabled, scrollNode, scrollToBottom, updatePinned]);

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
    const onScroll = () => {
      const previous = lastScrollMetricsRef.current;
      const current = transcriptScrollMetrics(scrollNode);
      // A delayed event from our own scroll (or browser scroll anchoring) can
      // arrive after more messages/images have increased the bottom gap. Only
      // upward movement should detach an already-pinned chat. A shrinking scroll
      // range can also move scrollTop upwards by clamping it, without user input.
      const rangeShrank = previous && (
        previous.scrollHeight > current.scrollHeight ||
        previous.clientHeight < current.clientHeight
      );
      if (!pinnedRef.current || !previous || (!rangeShrank && current.scrollTop < previous.scrollTop)) {
        updatePinned(scrollNode);
      } else {
        lastScrollMetricsRef.current = current;
      }
    };
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
