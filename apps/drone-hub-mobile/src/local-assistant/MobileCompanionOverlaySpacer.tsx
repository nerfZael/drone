import React from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useMobileCompanion } from './MobileCompanionContext';

const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };

/** Keeps the chat composer above the Companion sheet, animating with it. */
export function MobileCompanionOverlaySpacer() {
  const inset = useMobileCompanion().overlayInset;
  const height = useSharedValue(inset);
  React.useEffect(() => {
    height.value = withTiming(inset, SETTLE);
  }, [height, inset]);
  const style = useAnimatedStyle(() => ({ height: height.value }));
  return <Animated.View accessible={false} pointerEvents="none" style={style} />;
}
