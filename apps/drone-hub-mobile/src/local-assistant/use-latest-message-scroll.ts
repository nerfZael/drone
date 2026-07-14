import React from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

const FOLLOW_THRESHOLD = 72;

export function useLatestMessageScroll(conversationId: string) {
  const ref = React.useRef<ScrollView | null>(null);
  const activeConversation = React.useRef(conversationId);
  const followLatest = React.useRef(true);
  if (activeConversation.current !== conversationId) {
    activeConversation.current = conversationId;
    followLatest.current = true;
  }
  const scrollToLatest = React.useCallback((animated = false) => {
    requestAnimationFrame(() => ref.current?.scrollToEnd({ animated }));
  }, []);
  const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    followLatest.current =
      contentSize.height - layoutMeasurement.height - contentOffset.y <= FOLLOW_THRESHOLD;
  }, []);
  const onLayout = React.useCallback(() => {
    if (followLatest.current) scrollToLatest(false);
  }, [scrollToLatest]);
  const onContentSizeChange = React.useCallback(() => {
    if (followLatest.current) scrollToLatest(false);
  }, [scrollToLatest]);

  React.useEffect(() => {
    if (!conversationId) return;
    followLatest.current = true;
    const frame = requestAnimationFrame(() => scrollToLatest(false));
    const retry = setTimeout(() => scrollToLatest(false), 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(retry);
    };
  }, [conversationId, scrollToLatest]);

  return { ref, onContentSizeChange, onLayout, onScroll };
}
