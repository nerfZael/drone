import React from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompanionScreen } from '@drone/assistant-chat';
import { NativeMarkdown } from './NativeMarkdown';
import { colors } from '../theme';
import { useMobileReadingDensity } from '../mobile-reading-density';

/** Both the floating sheet and the Android assistant use the same native renderer and fit transaction. */
export function MobileCompanionScreenPanel({ screen, fullscreen = false, bottomOffset = 0, availableHeight, availableWidth }: { screen: CompanionScreen; fullscreen?: boolean; bottomOffset?: number; availableHeight: number; availableWidth?: number }) {
  const state = React.useSyncExternalStore(screen.subscribe, screen.getSnapshot);
  const window = useWindowDimensions();
  const density = useMobileReadingDensity();
  const insets = useSafeAreaInsets();
  const width = Math.floor(Math.max(0, Math.min(window.width - insets.left - insets.right - 40, availableWidth ?? Infinity) - 24));
  const height = Math.floor(Math.max(0, availableHeight));
  React.useLayoutEffect(() => { screen.resize(width, height, `native:${density}:fontScale=${window.fontScale}`); }, [screen, width, height, window.fontScale, density]);
  React.useEffect(() => () => screen.detach(), [screen]);
  return <View pointerEvents="box-none" style={fullscreen ? { position: 'absolute', top: 0, width: width + 24, alignSelf: 'center' } : { position: 'absolute', bottom: bottomOffset, right: 20 + insets.right, width: width + 24 }}>
    {state.markdown ? <View accessibilityLabel="Companion display" style={{ padding: 12, borderRadius: 12, backgroundColor: colors.surface1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss Companion display" onPress={() => screen.clear()} style={{ height: 44, justifyContent: 'center' }}><Text maxFontSizeMultiplier={1.5} style={{ fontSize: 14, lineHeight: 22, color: colors.muted, textAlign: 'right' }}>Dismiss</Text></Pressable>
      <NativeMarkdown text={state.markdown} />
    </View> : null}
    {state.candidate ? <View key={`${state.candidate.id}:${width}:${height}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', top: 0, width, opacity: 0 }} onLayout={(event) => {
      const layout = event.nativeEvent.layout;
      screen.measured(state.candidate!.id, layout.width, layout.height);
    }}><NativeMarkdown text={state.candidate.markdown} /></View> : null}
  </View>;
}
