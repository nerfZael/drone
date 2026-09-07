import React from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme';
import { clampImagePreviewOffset, clampImagePreviewScale } from './image-preview-zoom';
import { ChatFilesGestureContext } from './ChatFilesCarousel';

const DOUBLE_TAP_SCALE = 2.5;

export function ZoomableImageStage({
  resetKey,
  enabled = true,
  active = true,
  children,
}: {
  resetKey: string;
  enabled?: boolean;
  active?: boolean;
  children: React.ComponentProps<typeof View>['children'];
}) {
  const [showHint, setShowHint] = React.useState(false);
  const [zoomed, setZoomed] = React.useState(false);
  const pageGesture = React.useContext(ChatFilesGestureContext);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);
  const stageWidth = useSharedValue(0);
  const stageHeight = useSharedValue(0);

  const resetZoom = React.useCallback(() => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }, [scale, translateX, translateY]);

  useAnimatedReaction(
    () => scale.value > 1.01,
    (nextZoomed, previousZoomed) => {
      if (nextZoomed !== previousZoomed) runOnJS(setZoomed)(nextZoomed);
    },
  );

  React.useEffect(() => {
    if (!active || !enabled || !zoomed) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (scale.value <= 1.01) return false;
      resetZoom();
      return true;
    });
    return () => subscription.remove();
  }, [active, enabled, resetZoom, scale, zoomed]);

  React.useEffect(() => {
    resetZoom();
    if (!enabled || !active) {
      setShowHint(false);
      return;
    }

    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), 2800);
    return () => clearTimeout(timer);
  }, [active, enabled, resetKey, resetZoom]);

  const pinchGesture = Gesture.Pinch()
    .enabled(enabled && active)
    .onStart(() => {
      startScale.value = scale.value;
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      const nextScale = clampImagePreviewScale(startScale.value * event.scale);
      const scaleRatio = nextScale / Math.max(1, startScale.value);
      const focalX = event.focalX - stageWidth.value / 2;
      const focalY = event.focalY - stageHeight.value / 2;
      const nextTranslateX = focalX - scaleRatio * (focalX - startTranslateX.value);
      const nextTranslateY = focalY - scaleRatio * (focalY - startTranslateY.value);
      scale.value = nextScale;
      translateX.value = clampImagePreviewOffset(nextTranslateX, stageWidth.value, nextScale);
      translateY.value = clampImagePreviewOffset(nextTranslateY, stageHeight.value, nextScale);
    })
    .onEnd(() => {
      if (scale.value > 1.01) return;
      scale.value = withTiming(1, { duration: 160 });
      translateX.value = withTiming(0, { duration: 160 });
      translateY.value = withTiming(0, { duration: 160 });
    });

  const panGesture = Gesture.Pan()
    .enabled(enabled && active)
    .maxPointers(1)
    .minDistance(1)
    .onTouchesDown((_event, manager) => {
      // Ignoring onUpdate is too late: an active pan already owns the touch.
      // Fail before recognition so a fitted image allows the page's back swipe.
      if (scale.value <= 1.01) manager.fail();
    })
    .onStart(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1.01) return;
      translateX.value = clampImagePreviewOffset(
        startTranslateX.value + event.translationX,
        stageWidth.value,
        scale.value,
      );
      translateY.value = clampImagePreviewOffset(
        startTranslateY.value + event.translationY,
        stageHeight.value,
        scale.value,
      );
    });

  // While zoomed, image panning must win even if the page's horizontal threshold
  // is crossed in the same native touch event.
  if (pageGesture) panGesture.blocksExternalGesture(pageGesture);

  const doubleTapGesture = Gesture.Tap()
    .enabled(enabled && active)
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((event, success) => {
      if (!success) return;
      if (scale.value > 1.01) {
        scale.value = withTiming(1, { duration: 180 });
        translateX.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
        return;
      }

      const focalX = event.x - stageWidth.value / 2;
      const focalY = event.y - stageHeight.value / 2;
      scale.value = withTiming(DOUBLE_TAP_SCALE, { duration: 180 });
      translateX.value = withTiming(
        clampImagePreviewOffset(
          focalX - DOUBLE_TAP_SCALE * focalX,
          stageWidth.value,
          DOUBLE_TAP_SCALE,
        ),
        { duration: 180 },
      );
      translateY.value = withTiming(
        clampImagePreviewOffset(
          focalY - DOUBLE_TAP_SCALE * focalY,
          stageHeight.value,
          DOUBLE_TAP_SCALE,
        ),
        { duration: 180 },
      );
    });

  const gesture = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View
      accessible={enabled}
      accessibilityRole={enabled ? 'image' : undefined}
      accessibilityLabel={enabled ? 'Image file preview' : undefined}
      accessibilityHint={
        enabled ? 'Pinch to zoom, drag to pan, or double tap to zoom and reset' : undefined
      }
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (stageWidth.value > 0 && (stageWidth.value !== width || stageHeight.value !== height)) {
          resetZoom();
        }
        stageWidth.value = width;
        stageHeight.value = height;
      }}
      style={styles.stage}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.content, animatedStyle]}>{children}</Animated.View>
      </GestureDetector>
      {enabled && showHint ? (
        <View pointerEvents="none" style={styles.hint}>
          <Text style={styles.hintText}>Pinch or double-tap to zoom</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.crust,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(17, 17, 27, 0.82)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hintText: { color: colors.text, fontSize: 10, fontWeight: '700' },
});
