import React from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

const FOLLOW_THRESHOLD = 72;

export function useLatestMessageScroll(conversationId: string, loading = false) {
  const ref = React.useRef<ScrollView | null>(null);
  const activeConversation = React.useRef(conversationId);
  const followLatest = React.useRef(true);
  const loadingRef = React.useRef(loading);
  const [positionedConversation, setPositionedConversation] = React.useState('');
  loadingRef.current = loading;
  if (activeConversation.current !== conversationId) {
    activeConversation.current = conversationId;
    followLatest.current = true;
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
  const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    followLatest.current =
      contentSize.height - layoutMeasurement.height - contentOffset.y <= FOLLOW_THRESHOLD;
  }, []);
  const onLayout = React.useCallback(() => {
    if (!followLatest.current) return;
    scrollToLatest(false);
  }, [scrollToLatest]);
  const onContentSizeChange = React.useCallback(() => {
    if (!followLatest.current) return;
    if (loading) scrollToLatest(false);
    else positionAndReveal();
  }, [loading, positionAndReveal, scrollToLatest]);

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
    contentVisible:
      !conversationId || loading || positionedConversation === conversationId,
  };
}
