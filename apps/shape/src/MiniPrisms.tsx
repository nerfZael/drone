import { Rect, Shader } from "@shopify/react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import { useDerivedValue } from "react-native-reanimated";

import { miniPrismShader } from "./mini-prism-shader";

const CHILD_COUNT = 5;
const CHILD_BOX_SIZE = 96;
const CHILD_LIFETIME_SECONDS = 9;

type MiniPrismsProps = {
  clock: SharedValue<number>;
  height: number;
  pixelRatio: number;
  reduceMotion: boolean;
  width: number;
};

type MiniPrismProps = MiniPrismsProps & {
  index: number;
};

export function MiniPrisms(props: MiniPrismsProps) {
  return Array.from({ length: CHILD_COUNT }, (_, index) => (
    <MiniPrism key={index} {...props} index={index} />
  ));
}

function MiniPrism({ clock, height, index, pixelRatio, reduceMotion, width }: MiniPrismProps) {
  const motion = useDerivedValue(() => {
    const seconds = clock.value / 1000;
    const startDelay = 1.1 + index * 1.35;
    const localTime = seconds - startDelay;
    const isActive = localTime >= 0 ? 1 : 0;
    const phase = reduceMotion
      ? 0.68
      : ((Math.max(localTime, 0) % CHILD_LIFETIME_SECONDS) / CHILD_LIFETIME_SECONDS);
    const travel = phase < 0.04
      ? 0
      : 1 - Math.pow(1 - Math.min(1, (phase - 0.04) / 0.42), 3);
    const laneWidth = Math.min(width * 0.16, 64);
    const laneOffset = (index - (CHILD_COUNT - 1) / 2) * laneWidth;
    const separation = Math.sin(Math.min(1, travel) * Math.PI) * width * 0.025;
    const direction = index % 2 === 0 ? -1 : 1;
    const centerX = width * 0.5 + laneOffset * travel + separation * direction;
    const startY = height * 0.54;
    const endY = height * 0.87;
    const centerY = startY + (endY - startY) * travel;
    const fadeIn = Math.min(1, phase / 0.035);
    const fadeOut = 1 - Math.max(0, Math.min(1, (phase - 0.90) / 0.10));

    return {
      centerX,
      centerY,
      opacity: (reduceMotion ? 0.78 : isActive) * fadeIn * fadeOut,
      phase,
      seconds: reduceMotion ? index * 0.7 : seconds,
    };
  });

  const x = useDerivedValue(() => motion.value.centerX - CHILD_BOX_SIZE / 2);
  const y = useDerivedValue(() => motion.value.centerY - CHILD_BOX_SIZE / 2);
  const uniforms = useDerivedValue(() => ({
    boxSize: CHILD_BOX_SIZE,
    center: [motion.value.centerX, motion.value.centerY],
    opacity: motion.value.opacity,
    phase: motion.value.phase,
    pixelRatio,
    seed: index / CHILD_COUNT,
    time: motion.value.seconds,
  }));

  if (!miniPrismShader) return null;

  return (
    <Rect height={CHILD_BOX_SIZE} width={CHILD_BOX_SIZE} x={x} y={y}>
      <Shader source={miniPrismShader} uniforms={uniforms} />
    </Rect>
  );
}
