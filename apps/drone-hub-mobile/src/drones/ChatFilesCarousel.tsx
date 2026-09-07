import React from 'react';
import {
  BackHandler,
  Keyboard,
  StyleSheet,
  View,
  type ViewProps,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { mobileChatFilesProgress, mobileChatFilesSnapOpen } from './mobile-chat-files-paging';

const PAGE_SPRING = { stiffness: 700, damping: 52, mass: 1, overshootClamping: true };

export const ChatFilesGestureContext = React.createContext<ReturnType<typeof Gesture.Pan> | null>(
  null,
);

export function ChatFilesCarousel({
  open,
  enabled,
  onOpenChange,
  onReveal,
  children,
  renderFiles,
}: {
  open: boolean;
  enabled: boolean;
  onOpenChange(open: boolean): void;
  onReveal(): void;
  children: ViewProps['children'];
  renderFiles(active: boolean): ViewProps['children'];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = React.useState(windowWidth);
  const [dragging, setDragging] = React.useState(false);
  const progress = useSharedValue(open ? 1 : 0);
  const target = useSharedValue(open ? 1 : 0);
  const start = useSharedValue(0);
  const startTarget = useSharedValue(0);
  const gestureActive = useSharedValue(false);
  const beginDrag = React.useCallback(() => {
    Keyboard.dismiss();
    onReveal();
    setDragging(true);
  }, [onReveal]);
  const finishDrag = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      setDragging(false);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    const nextTarget = open ? 1 : 0;
    // Preserve the velocity-aware spring started on release.
    if (target.value === nextTarget) return;
    target.value = nextTarget;
    progress.value = withSpring(nextTarget, PAGE_SPRING);
  }, [open, progress, target]);
  React.useEffect(() => {
    if (!enabled || !open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpenChange(false);
      return true;
    });
    return () => subscription.remove();
  }, [enabled, onOpenChange, open]);

  const gesture = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetX(open ? 8 : -8)
        .failOffsetX(open ? -8 : 8)
        .failOffsetY([-18, 18])
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          gestureActive.value = true;
          cancelAnimation(progress);
          start.value = progress.value;
          startTarget.value = target.value;
          runOnJS(beginDrag)();
        })
        .onUpdate((event) => {
          progress.value = mobileChatFilesProgress(start.value, event.translationX, width);
        })
        .onEnd((event, success) => {
          // RNGH also calls onEnd for cancellation, before onFinalize. Publishing a
          // destination here would leave target out of sync with the restored page.
          if (!success) return;
          const nextOpen = mobileChatFilesSnapOpen(progress.value, event.velocityX);
          target.value = nextOpen ? 1 : 0;
          progress.value = withSpring(target.value, {
            ...PAGE_SPRING,
            velocity: -event.velocityX / Math.max(1, width),
          });
          runOnJS(finishDrag)(nextOpen);
        })
        .onFinalize((_event, success) => {
          if (!gestureActive.value) return;
          gestureActive.value = false;
          if (success) return;
          target.value = startTarget.value;
          progress.value = withSpring(target.value, PAGE_SPRING);
          runOnJS(finishDrag)(startTarget.value === 1);
        }),
    [
      enabled,
      open,
      width,
      progress,
      target,
      start,
      startTarget,
      gestureActive,
      beginDrag,
      finishDrag,
    ],
  );
  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * width }],
  }));

  return (
    <ChatFilesGestureContext.Provider value={gesture}>
      <GestureDetector gesture={gesture}>
        <View
          collapsable={false}
          style={styles.viewport}
          onLayout={(event) => {
            const nextWidth = event.nativeEvent.layout.width;
            if (nextWidth > 0) setWidth(nextWidth);
          }}
        >
          <Animated.View style={[styles.strip, { width: width * 2 }, stripStyle]}>
            <View
              style={[styles.page, { width }]}
              pointerEvents={open ? 'none' : 'auto'}
              accessibilityElementsHidden={open}
              importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
            >
              {children}
            </View>
            <View
              style={[styles.page, { width }]}
              pointerEvents={open ? 'auto' : 'none'}
              accessibilityElementsHidden={!open}
              importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
            >
              {renderFiles(enabled && (open || dragging))}
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
    </ChatFilesGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  strip: { flex: 1, flexDirection: 'row' },
  page: { height: '100%', minHeight: 0 },
});
