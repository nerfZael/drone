import React from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { catppuccin, colors } from '../theme';

type CircuitRobotLoaderProps = {
  label?: string;
  size?: number;
};

type CircuitRay = {
  d: string;
  delay: number;
  duration: number;
  dashLength: number;
  color: string;
};

const CIRCUIT_RAYS: CircuitRay[] = [
  {
    d: 'M67 86 H30 V67 H-54 V48 H-210 V30 H-520',
    delay: 180,
    duration: 4680,
    dashLength: 42,
    color: catppuccin.mauve,
  },
  {
    d: 'M130 88 H162 V70 H246 V52 H402 V34 H620',
    delay: 820,
    duration: 5210,
    dashLength: 53,
    color: catppuccin.lavender,
  },
  {
    d: 'M96 59 V30 H74 V-32 H94 V-182 H72 V-440',
    delay: 1310,
    duration: 4430,
    dashLength: 38,
    color: catppuccin.blue,
  },
  {
    d: 'M104 130 V158 H128 V226 H108 V384 H128 V660',
    delay: 360,
    duration: 5060,
    dashLength: 49,
    color: catppuccin.mauve,
  },
  {
    d: 'M78 70 H58 V48 H18 V26 H-132 V6 H-430',
    delay: 710,
    duration: 4780,
    dashLength: 44,
    color: catppuccin.lavender,
  },
  {
    d: 'M122 124 H150 V146 H202 V170 H370 V190 H560',
    delay: 1220,
    duration: 5320,
    dashLength: 56,
    color: catppuccin.blue,
  },
  {
    d: 'M88 62 V40 H54 V20 H22 V-70 H-250',
    delay: 420,
    duration: 4510,
    dashLength: 39,
    color: catppuccin.mauve,
  },
  {
    d: 'M112 62 V42 H148 V20 H182 V-74 H380',
    delay: 940,
    duration: 4930,
    dashLength: 47,
    color: catppuccin.lavender,
  },
  {
    d: 'M68 98 H16 V82 H-78 V62 H-252 V42 H-560',
    delay: 1510,
    duration: 5270,
    dashLength: 51,
    color: catppuccin.blue,
  },
  {
    d: 'M132 98 H182 V82 H282 V104 H424 V84 H660',
    delay: 230,
    duration: 4630,
    dashLength: 43,
    color: catppuccin.mauve,
  },
  {
    d: 'M92 130 V156 H66 V214 H42 V360 H-260',
    delay: 1130,
    duration: 5150,
    dashLength: 55,
    color: catppuccin.lavender,
  },
  {
    d: 'M108 59 V36 H132 V-24 H110 V-170 H136 V-460',
    delay: 610,
    duration: 4370,
    dashLength: 37,
    color: catppuccin.blue,
  },
  {
    d: 'M70 110 H34 V130 H-70 V150 H-252 V172 H-520',
    delay: 1380,
    duration: 4990,
    dashLength: 48,
    color: catppuccin.mauve,
  },
  {
    d: 'M128 76 H158 V56 H214 V34 H380 V12 H600',
    delay: 510,
    duration: 5290,
    dashLength: 54,
    color: catppuccin.lavender,
  },
  {
    d: 'M82 124 H58 V146 H10 V170 H-150 V192 H-440',
    delay: 1020,
    duration: 4570,
    dashLength: 41,
    color: catppuccin.blue,
  },
  {
    d: 'M118 68 H142 V46 H190 V24 H336 V4 H540',
    delay: 160,
    duration: 4870,
    dashLength: 46,
    color: catppuccin.mauve,
  },
  {
    d: 'M100 58 V24 H118 V-28 H96 V-206 H116 V-520',
    delay: 790,
    duration: 5340,
    dashLength: 57,
    color: catppuccin.lavender,
  },
  {
    d: 'M100 130 V162 H84 V238 H104 V398 H86 V660',
    delay: 1260,
    duration: 4490,
    dashLength: 40,
    color: catppuccin.blue,
  },
  {
    d: 'M132 110 H170 V130 H258 V110 H410 V132 H650',
    delay: 330,
    duration: 5090,
    dashLength: 50,
    color: catppuccin.mauve,
  },
  {
    d: 'M76 78 H44 V58 H-28 V38 H-190 V18 H-500',
    delay: 910,
    duration: 4740,
    dashLength: 45,
    color: catppuccin.lavender,
  },
  {
    d: 'M124 116 H154 V138 H218 V160 H356 V184 H590',
    delay: 1450,
    duration: 5240,
    dashLength: 52,
    color: catppuccin.blue,
  },
  {
    d: 'M86 128 V150 H56 V190 H28 V330 H-230',
    delay: 470,
    duration: 4610,
    dashLength: 42,
    color: catppuccin.mauve,
  },
  {
    d: 'M114 128 V150 H148 V192 H176 V330 H390',
    delay: 1080,
    duration: 4960,
    dashLength: 49,
    color: catppuccin.lavender,
  },
  {
    d: 'M68 92 H4 V110 H-102 V130 H-292 V150 H-600',
    delay: 670,
    duration: 4310,
    dashLength: 36,
    color: catppuccin.blue,
  },
];

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

function CircuitTrace({ ray, reducedMotion }: { ray: CircuitRay; reducedMotion: boolean }) {
  const phase = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    phase.setValue(reducedMotion ? 0.72 : 0);
    if (reducedMotion) return undefined;

    const animation = Animated.sequence([
      Animated.delay(ray.delay),
      Animated.loop(
        Animated.timing(phase, {
          duration: ray.duration,
          easing: Easing.linear,
          toValue: 1,
          useNativeDriver: false,
        }),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [phase, ray.delay, ray.duration, reducedMotion]);

  const strokeDashoffset = phase.interpolate({ inputRange: [0, 1], outputRange: [940, -120] });
  const opacity = phase.interpolate({
    inputRange: [0, 0.34, 1],
    outputRange: [0.18, 0.92, 0.16],
  });

  return (
    <G>
      <AnimatedPath
        d={ray.d}
        fill="none"
        opacity={Animated.multiply(opacity, 0.18)}
        stroke={ray.color}
        strokeDasharray={`${ray.dashLength} 900`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4.4}
      />
      <AnimatedPath
        d={ray.d}
        fill="none"
        opacity={opacity}
        stroke={ray.color}
        strokeDasharray={`${ray.dashLength} 900`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.35}
      />
    </G>
  );
}

export function CircuitRobotLoader({
  label = 'Loading Drone Hub',
  size = 220,
}: CircuitRobotLoaderProps) {
  const reducedMotion = useReducedMotion();
  const pulse = React.useRef(new Animated.Value(0)).current;
  const blink = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    pulse.setValue(reducedMotion ? 0.5 : 0);
    blink.setValue(0);
    if (reducedMotion) return undefined;

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          toValue: 0,
          useNativeDriver: false,
        }),
      ]),
    );
    const blinkAnimation = Animated.loop(
      Animated.sequence([
        Animated.delay(2375),
        Animated.timing(blink, {
          duration: 110,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: false,
        }),
        Animated.timing(blink, {
          duration: 110,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: false,
        }),
      ]),
    );
    pulseAnimation.start();
    blinkAnimation.start();
    return () => {
      pulseAnimation.stop();
      blinkAnimation.stop();
    };
  }, [blink, pulse, reducedMotion]);

  const haloRadius = pulse.interpolate({ inputRange: [0, 1], outputRange: [45.6, 49.9] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.56, 1] });
  const beaconRadius = pulse.interpolate({ inputRange: [0, 1], outputRange: [3.5, 4.8] });
  const beaconOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const eyeRadiusY = blink.interpolate({ inputRange: [0, 1], outputRange: [6, 1.05] });

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.container}
    >
      <Svg width={size} height={size} viewBox="0 0 200 200" fill="none">
        <G>
          {CIRCUIT_RAYS.map((ray) => (
            <CircuitTrace key={ray.d} ray={ray} reducedMotion={reducedMotion} />
          ))}
        </G>

        <AnimatedCircle
          cx={100}
          cy={96}
          fill="rgba(203, 166, 247, 0.035)"
          opacity={haloOpacity}
          r={haloRadius}
          stroke="rgba(203, 166, 247, 0.24)"
          strokeWidth={1}
        />

        <Path
          d="M100 56 V40 M91 40 H109"
          stroke={catppuccin.overlay2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
        <AnimatedCircle
          cx={100}
          cy={34}
          fill={catppuccin.mauve}
          opacity={beaconOpacity}
          r={beaconRadius}
        />

        <Rect x={68} y={61} width={68} height={68} rx={13} fill="rgba(17, 17, 27, 0.42)" />
        <Rect
          x={66}
          y={58}
          width={68}
          height={68}
          rx={13}
          fill={colors.panelRaised}
          stroke={catppuccin.overlay2}
          strokeWidth={2}
        />
        <Path
          d="M78 126 H122 L116 138 H84 Z"
          fill={catppuccin.surface0}
          stroke={catppuccin.overlay1}
          strokeLinejoin="round"
          strokeWidth={1.5}
        />
        <Path
          d="M60 80 H66 V106 H60 Z M134 80 H140 V106 H134 Z"
          fill="rgba(203, 166, 247, 0.10)"
          stroke={catppuccin.mauve}
          strokeLinejoin="round"
          strokeWidth={1.5}
        />

        <AnimatedEllipse
          cx={86}
          cy={89}
          fill={catppuccin.mauve}
          opacity={beaconOpacity}
          rx={6}
          ry={eyeRadiusY}
        />
        <AnimatedEllipse
          cx={114}
          cy={89}
          fill={catppuccin.mauve}
          opacity={beaconOpacity}
          rx={6}
          ry={eyeRadiusY}
        />
        <Path
          d="M85 108 H115"
          stroke={catppuccin.overlay2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
        <Path
          d="M76 74 H89 M111 74 H124 M100 58 V70"
          stroke={catppuccin.overlay2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    height: 220,
    justifyContent: 'center',
    width: 220,
  },
});
