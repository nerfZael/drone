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
  initialPosition = 'restore',
}: {
  contextKey: string;
  contentVersion: unknown;
  enabled?: boolean;
  bottomThreshold?: number;
  /** Where a newly selected/mounted chat opens; same-chat layout changes still restore. */
  initialPosition?: 'restore' | 'bottom';
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const pinnedRef = React.useRef(true);
  const preservingPrependRef = React.useRef(false);
  const lastScrollMetricsRef = React.useRef<TranscriptScrollMetrics | null>(null);
  const hiddenRef = React.useRef(false);
  const scrollGenerationRef = React.useRef(0);
  const lastRestoredContextRef = React.useRef<string | null>(null);
  const [scrollNode, setScrollNode] = React.useState<HTMLDivElement | null>(null);
  const [contentNode, setContentNode] = React.useState<HTMLDivElement | null>(null);

  const bindScrollRef = React.useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollNode((current) => (current === node ? current : node));
  }, []);

  const bindContentRef = React.useCallback((node: HTMLDivElement | null) => {
    setContentNode((current) => (current === node ? current : node));
  }, []);

  const restoreAfterHidden = React.useCallback((node: HTMLDivElement): boolean => {
    // Dockview detaches inactive tabs without unmounting React. Their zero
    // geometry is not a reading position, and reattachment can emit a scroll
    // event before ResizeObserver. Restore before either event measures it.
    if (node.clientHeight <= 0) {
      hiddenRef.current = true;
      return false;
    }
    if (hiddenRef.current) {
      hiddenRef.current = false;
      node.scrollTop = pinnedRef.current ? node.scrollHeight : Math.min(
        lastScrollMetricsRef.current?.scrollTop ?? 0,
        Math.max(0, node.scrollHeight - node.clientHeight),
      );
      lastScrollMetricsRef.current = transcriptScrollMetrics(node);
    }
    return true;
  }, []);

  const updatePinned = React.useCallback(
    (node: HTMLDivElement | null = scrollRef.current) => {
      if (!node || !restoreAfterHidden(node)) return;
      lastScrollMetricsRef.current = transcriptScrollMetrics(node);
      pinnedRef.current = isTranscriptPinned({
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        threshold: bottomThreshold,
      });
    },
    [bottomThreshold, restoreAfterHidden],
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
          if (!restoreAfterHidden(node)) return;
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
    [restoreAfterHidden, updatePinned],
  );

  // Layout effects and ResizeObserver run before paint. Deferring their scroll
  // write to another frame exposes the old position while the content resizes.
  const followBeforePaint = React.useCallback(() => {
    const node = scrollRef.current;
    if (!enabled || !node || !restoreAfterHidden(node) || !shouldAutoFollowTranscript({
      enabled,
      pinned: pinnedRef.current,
      preservingPrepend: preservingPrependRef.current,
    })) return;
    node.scrollTop = node.scrollHeight;
    updatePinned(node);
  }, [enabled, restoreAfterHidden, updatePinned]);

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
        if (current && restoreAfterHidden(current)) {
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
    [restoreAfterHidden, updatePinned],
  );

  React.useLayoutEffect(() => {
    preservingPrependRef.current = false;
    if (!enabled || !scrollNode) return;
    const changedContext = lastRestoredContextRef.current !== contextKey;
    lastRestoredContextRef.current = contextKey;
    const saved = initialPosition === 'bottom' && changedContext
      ? undefined
      : transcriptScrollByContext.get(contextKey);
    hiddenRef.current = scrollNode.clientHeight <= 0;
    lastScrollMetricsRef.current = saved ? { ...saved, clientHeight: scrollNode.clientHeight } : null;
    if (hiddenRef.current) {
      // Selecting/restoring a chat can itself happen while its tab is hidden.
      // Keep the intended position until the scroll surface has a layout.
      pinnedRef.current = saved?.pinned ?? true;
    } else if (!saved) {
      pinnedRef.current = true;
      scrollNode.scrollTop = scrollNode.scrollHeight;
      updatePinned(scrollNode);
    } else {
      pinnedRef.current = saved.pinned;
      scrollNode.scrollTop = saved.pinned ? scrollNode.scrollHeight : computePrependedTranscriptScrollTop({
        previousScrollTop: saved.scrollTop,
        previousScrollHeight: saved.scrollHeight,
        nextScrollHeight: scrollNode.scrollHeight,
        clientHeight: scrollNode.clientHeight,
      });
      updatePinned(scrollNode);
    }
    return () => {
      // Queued follow/prepend work belongs to this chat and this scroll surface.
      scrollGenerationRef.current += 1;
      // React can already have replaced this element's messages with the next
      // chat before layout-effect cleanup. Save the last live measurements of
      // this chat, not the incoming chat's initial scroll position.
      const metrics = lastScrollMetricsRef.current;
      if (!metrics || metrics.scrollHeight <= 0) return;
      transcriptScrollByContext.set(contextKey, {
        scrollTop: metrics.scrollTop,
        scrollHeight: metrics.scrollHeight,
        // pinnedRef is updated while the surface is live. Measuring again in
        // cleanup can observe the transient pre-scroll state from React Strict
        // Mode (or a container whose layout is already collapsing) and turn an
        // intended bottom-pinned chat into a saved scroll-to-top position.
        pinned: pinnedRef.current,
      });
    };
  }, [contentNode, contextKey, enabled, initialPosition, scrollNode, updatePinned]);

  React.useLayoutEffect(followBeforePaint, [contentVersion, followBeforePaint]);

  React.useEffect(() => {
    if (!enabled || !scrollNode) return;
    const onScroll = () => {
      if (!restoreAfterHidden(scrollNode)) return;
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
  }, [contextKey, enabled, scrollNode, restoreAfterHidden, updatePinned]);

  React.useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return;
    if (!scrollNode && !contentNode) return;
    const observer = new ResizeObserver(followBeforePaint);
    if (scrollNode) observer.observe(scrollNode);
    if (contentNode) observer.observe(contentNode);
    return () => observer.disconnect();
  }, [contentNode, contextKey, enabled, scrollNode, followBeforePaint]);

  return {
    bindContentRef,
    bindScrollRef,
    preserveScrollOnPrepend,
    scrollRef,
    scrollToBottom,
    updatePinned,
  };
}
