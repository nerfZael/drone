import React from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

const FOLLOW_THRESHOLD = 72;
const LOAD_OLDER_THRESHOLD = 40;
const REARM_LOAD_OLDER_THRESHOLD = 96;

export function useLatestMessageScroll(
  conversationId: string,
  loading = false,
  options: { onReachTop?: () => Promise<unknown> | unknown } = {},
) {
  const ref = React.useRef<ScrollView | null>(null);
  const activeConversation = React.useRef(conversationId);
  const followLatest = React.useRef(true);
  const loadingRef = React.useRef(loading);
  const onReachTopRef = React.useRef(options.onReachTop);
  const loadOlderArmed = React.useRef(true);
  const scrollPosition = React.useRef({ height: 0, y: 0 });
  const prependPosition = React.useRef<{ height: number; y: number } | null>(null);
  const prependGeneration = React.useRef(0);
  onReachTopRef.current = options.onReachTop;
  const [positionedConversation, setPositionedConversation] = React.useState('');
  loadingRef.current = loading;
  if (activeConversation.current !== conversationId) {
    activeConversation.current = conversationId;
    followLatest.current = true;
    loadOlderArmed.current = true;
    prependPosition.current = null;
    prependGeneration.current += 1;
  }
  const scrollToLatest = React.useCallback((animated = false) => {
    requestAnimationFrame(() => ref.current?.scrollToEnd({ animated }));
  }, []);
  const positionAndReveal = React.useCallback(() => {
    if (!conversationId || loading || activeConversation.current !== conversationId) return;
    requestAnimationFrame(() => {
      if (loadingRef.current || activeConversation.current !== conversationId) return;
      ref.current?.scrollToEnd({ animated: false });
      requestAnimationFrame(() => {
        if (!loadingRef.current && activeConversation.current === conversationId) {
          setPositionedConversation(conversationId);
        }
      });
    });
  }, [conversationId, loading]);
  const preserveScrollOnPrepend = React.useCallback(
    async (load: () => Promise<unknown> | unknown) => {
      const generation = ++prependGeneration.current;
      prependPosition.current = { ...scrollPosition.current };
      try {
        await load();
      } finally {
        setTimeout(() => {
          if (prependGeneration.current === generation) prependPosition.current = null;
        }, 1_500);
      }
    },
    [],
  );
  const onScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      scrollPosition.current = { height: contentSize.height, y: contentOffset.y };
      followLatest.current =
        contentSize.height - layoutMeasurement.height - contentOffset.y <= FOLLOW_THRESHOLD;
      if (contentOffset.y > REARM_LOAD_OLDER_THRESHOLD) {
        loadOlderArmed.current = true;
      } else if (
        contentOffset.y <= LOAD_OLDER_THRESHOLD &&
        loadOlderArmed.current &&
        onReachTopRef.current
      ) {
        loadOlderArmed.current = false;
        void preserveScrollOnPrepend(() => onReachTopRef.current?.());
      }
    },
    [preserveScrollOnPrepend],
  );
  const onLayout = React.useCallback(() => {
    if (!followLatest.current) return;
    scrollToLatest(false);
  }, [scrollToLatest]);
  const onContentSizeChange = React.useCallback(
    (_width: number, height: number) => {
      const prepend = prependPosition.current;
      if (prepend && height > prepend.height) {
        prependGeneration.current += 1;
        prependPosition.current = null;
        followLatest.current = false;
        ref.current?.scrollTo({
          y: prepend.y + (height - prepend.height),
          animated: false,
        });
        return;
      }
      if (!followLatest.current) return;
      if (loading) scrollToLatest(false);
      else positionAndReveal();
    },
    [loading, positionAndReveal, scrollToLatest],
  );

  React.useEffect(() => {
    if (!conversationId) return;
    followLatest.current = true;
    if (loading) {
      setPositionedConversation((current) =>
        current === conversationId ? '' : current,
      );
      return;
    }
    const retry = setTimeout(positionAndReveal, 80);
    return () => {
      clearTimeout(retry);
    };
  }, [conversationId, loading, positionAndReveal]);

  return {
    ref,
    onContentSizeChange,
    onLayout,
    onScroll,
    preserveScrollOnPrepend,
    contentVisible:
      !conversationId || loading || positionedConversation === conversationId,
  };
}
