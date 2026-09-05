import { Rect, Shader, Text, matchFont } from "@shopify/react-native-skia";
import type { SkFont } from "@shopify/react-native-skia";
import { useMemo } from "react";
import type { SharedValue } from "react-native-reanimated";
import { useDerivedValue } from "react-native-reanimated";

import { miniPrismShader } from "./mini-prism-shader";
import { projectBudCenter } from "./mitosis-motion";

const CHILD_BOX_SIZE = 96;
const CHILD_LIFETIME_SECONDS = 9;
const CHILD_NAMES = [
  "FastRabbit",
  "QuickFox",
  "SwiftOtter",
  "BrightOwl",
  "NimbleWolf",
] as const;
const CHILD_COUNT = CHILD_NAMES.length;
const LABEL_OFFSET = 38;

type MiniPrismsProps = {
  clock: SharedValue<number>;
  height: number;
  morph: SharedValue<number>;
  pixelRatio: number;
  reduceMotion: boolean;
  rotationX: SharedValue<number>;
  rotationY: SharedValue<number>;
  shape: SharedValue<number>;
  width: number;
};

type MiniPrismProps = MiniPrismsProps & {
  font: SkFont;
  index: number;
  name: string;
};

export function MiniPrisms(props: MiniPrismsProps) {
  const font = useMemo(
    () => matchFont({ fontFamily: "System", fontSize: 9.5, fontWeight: "500" }),
    [],
  );

  return CHILD_NAMES.map((name, index) => (
    <MiniPrism key={name} {...props} font={font} index={index} name={name} />
  ));
}

function MiniPrism({
  clock,
  font,
  height,
  index,
  morph,
  name,
  pixelRatio,
  reduceMotion,
  rotationX,
  rotationY,
  shape,
  width,
}: MiniPrismProps) {
  const labelWidth = font.measureText(name).width;
  const motion = useDerivedValue(() => {
    const seconds = clock.value / 1000;
    const startDelay = 1.1 + index * 1.35;
    const localTime = seconds - startDelay;
    const isActive = localTime >= 0 ? 1 : 0;
    const phase = reduceMotion
      ? 0.68
      : ((Math.max(localTime, 0) % CHILD_LIFETIME_SECONDS) / CHILD_LIFETIME_SECONDS);
    const travel = phase < 0.20
      ? 0
      : 1 - Math.pow(1 - Math.min(1, (phase - 0.20) / 0.26), 3);
    const laneWidth = Math.min(width * 0.16, 64);
    const laneOffset = (index - (CHILD_COUNT - 1) / 2) * laneWidth;
    const separation = Math.sin(Math.min(1, travel) * Math.PI) * width * 0.025;
    const direction = index % 2 === 0 ? -1 : 1;
    const origin = projectBudCenter({
      height,
      index,
      morph: morph.value,
      phase: Math.min(phase, 0.17),
      rotationX: rotationX.value,
      rotationY: rotationY.value + seconds * 0.16,
      shape: shape.value,
      width,
    });
    const centerX = origin.x + (width * 0.5 + laneOffset - origin.x) * travel
      + separation * direction;
    const endY = height * 0.87;
    const centerY = origin.y + (endY - origin.y) * travel;
    const handoff = Math.max(0, Math.min(1, (phase - 0.175) / 0.025));
    const fadeOut = 1 - Math.max(0, Math.min(1, (phase - 0.90) / 0.10));
    const labelReveal = Math.max(0, Math.min(1, (phase - 0.30) / 0.08));

    return {
      centerX,
      centerY,
      labelOpacity: (reduceMotion ? 0.78 : isActive) * fadeOut * labelReveal * 0.72,
      opacity: (reduceMotion ? 0.78 : isActive * handoff) * fadeOut,
      phase,
      seconds: reduceMotion ? index * 0.7 : seconds,
    };
  });

  const x = useDerivedValue(() => motion.value.centerX - CHILD_BOX_SIZE / 2);
  const y = useDerivedValue(() => motion.value.centerY - CHILD_BOX_SIZE / 2);
  const labelX = useDerivedValue(() => motion.value.centerX - labelWidth / 2);
  const labelY = useDerivedValue(() => motion.value.centerY + LABEL_OFFSET);
  const labelOpacity = useDerivedValue(() => motion.value.labelOpacity);
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
    <>
      <Rect height={CHILD_BOX_SIZE} width={CHILD_BOX_SIZE} x={x} y={y}>
        <Shader source={miniPrismShader} uniforms={uniforms} />
      </Rect>
      <Text
        color="#B8B2CE"
        font={font}
        opacity={labelOpacity}
        text={name}
        x={labelX}
        y={labelY}
      />
    </>
  );
}
