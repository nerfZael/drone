import { Canvas, Fill, Shader, useClock } from "@shopify/react-native-skia";
import { PixelRatio, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { MiniPrisms } from "./MiniPrisms";
import { getActiveMitosis, getBudCenter } from "./mitosis-motion";
import { morphShader } from "./morph-shader";

const SHAPE_COUNT = 8;

export function MorphingForm() {
  const { height, width } = useWindowDimensions();
  const clock = useClock();
  const morph = useSharedValue(0);
  const morphTarget = useSharedValue(0);
  const rotationX = useSharedValue(-0.18);
  const rotationY = useSharedValue(0.32);
  const shape = useSharedValue(0);
  const shapeTarget = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const pixelRatio = PixelRatio.get();

  const uniforms = useDerivedValue(() => {
    const seconds = reduceMotion ? 0 : clock.value / 1000;
    const activeMitosis = getActiveMitosis(seconds);
    const budCenter = activeMitosis.index < 0
      ? { x: 0, y: 0, z: 0 }
      : getBudCenter(activeMitosis.index, activeMitosis.phase, shape.value, morph.value);

    return {
      mitosis: [budCenter.x, budCenter.y, budCenter.z, activeMitosis.phase],
      morph: morph.value,
      pixelRatio,
      resolution: [width, height],
      rotation: [rotationX.value, rotationY.value],
      shape: shape.value,
      time: seconds,
    };
  });

  const pan = Gesture.Pan()
    .minDistance(4)
    .onChange((event) => {
      rotationY.value += event.changeX * 0.009;
      rotationX.value = Math.max(
        -1.35,
        Math.min(1.35, rotationX.value - event.changeY * 0.009),
      );
    });

  const singleTap = Gesture.Tap()
    .maxDistance(12)
    .onEnd(() => {
      morphTarget.value = morphTarget.value === 0 ? 1 : 0;
      morph.value = withTiming(morphTarget.value, {
        duration: 760,
        easing: Easing.bezier(0.33, 1, 0.68, 1),
        reduceMotion: ReduceMotion.System,
      });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .maxDistance(18)
    .onEnd(() => {
      morphTarget.value = 0;
      morph.value = withTiming(0, {
        duration: 420,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
      shapeTarget.value += 1;
      shape.value = withTiming(shapeTarget.value, {
        duration: 620,
        easing: Easing.inOut(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });

      if (shapeTarget.value >= SHAPE_COUNT * 16) {
        shapeTarget.value %= SHAPE_COUNT;
        shape.value = shapeTarget.value;
      }
    });

  const gesture = Gesture.Race(pan, Gesture.Exclusive(doubleTap, singleTap));

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityHint="Tap to morph, double tap for the next solid, or drag to rotate"
        accessibilityLabel="Interactive three-dimensional shape"
        accessibilityRole="adjustable"
        style={styles.screen}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            {morphShader ? <Shader source={morphShader} uniforms={uniforms} /> : null}
          </Fill>
          <MiniPrisms
            clock={clock}
            height={height}
            morph={morph}
            pixelRatio={pixelRatio}
            reduceMotion={reduceMotion}
            rotationX={rotationX}
            rotationY={rotationY}
            shape={shape}
            width={width}
          />
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#05060E",
    flex: 1,
  },
});
