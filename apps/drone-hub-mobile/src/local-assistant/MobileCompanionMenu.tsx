import React from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Check from 'lucide-react-native/icons/check';

import { colors, radii } from '../theme';

export type MobileCompanionMenuTone = 'neutral' | 'accent' | 'success' | 'danger';

export type MobileCompanionMenuItem = {
  id: string;
  label: string;
  detail?: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  section?: string;
  tone?: MobileCompanionMenuTone;
  /** A toggle row: shows a check mark and stays open after presses. */
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Keep the menu open after this action, for toggles and multi-step controls. */
  keepOpen?: boolean;
  onPress(): void;
};

const toneColor: Record<MobileCompanionMenuTone, string> = {
  neutral: colors.muted,
  accent: colors.accent,
  success: colors.online,
  danger: colors.danger,
};

const ENTER = { duration: 220, easing: Easing.out(Easing.cubic) };
const EXIT = { duration: 180, easing: Easing.in(Easing.quad) };

/**
 * The Companion options sheet, the mobile counterpart of the desktop "…" popover.
 * Rendered inside the Companion layer rather than a Modal so it can slide and be dragged away.
 */
export function MobileCompanionMenu({
  visible,
  items,
  children,
  onClose,
}: {
  visible: boolean;
  items: MobileCompanionMenuItem[];
  children?: React.JSX.Element | null;
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [rendered, setRendered] = React.useState(visible);
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);
  const sheetHeight = useSharedValue(height);

  React.useEffect(() => {
    if (visible) {
      setRendered(true);
      translateY.value = height;
      translateY.value = withTiming(0, ENTER);
      backdrop.value = withTiming(1, ENTER);
      return;
    }
    if (!rendered) return;
    backdrop.value = withTiming(0, EXIT);
    translateY.value = withTiming(sheetHeight.value + 40, EXIT, (finished) => {
      if (finished) runOnJS(setRendered)(false);
    });
    // The exit animation continues from wherever a drag left the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  const dragGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activeOffsetY(10)
        .failOffsetX([-50, 50])
        .failOffsetY(-14)
        .onUpdate((event) => {
          translateY.value = Math.max(0, event.translationY);
          backdrop.value = Math.max(0, 1 - event.translationY / Math.max(1, sheetHeight.value));
        })
        .onEnd((event) => {
          const shouldDismiss =
            event.translationY > sheetHeight.value * 0.35 ||
            (event.translationY > 40 && event.velocityY > 1_100);
          if (shouldDismiss) {
            runOnJS(onClose)();
          } else {
            translateY.value = withTiming(0, ENTER);
            backdrop.value = withTiming(1, ENTER);
          }
        })
        .onFinalize((_event, success) => {
          if (!success) {
            translateY.value = withTiming(0, ENTER);
            backdrop.value = withTiming(1, ENTER);
          }
        }),
    [backdrop, onClose, sheetHeight, translateY],
  );
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!rendered) return null;

  return (
    <View style={styles.layer} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close Companion options"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <GestureDetector gesture={dragGesture}>
        <Animated.View
          accessibilityViewIsModal
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
          style={[styles.sheet, { marginBottom: insets.bottom + 10 }, sheetStyle]}
        >
          <View style={styles.grabber} />
          <ScrollView
            accessibilityLabel="Companion options"
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {children}
            {items.map((item, index) => {
              const Icon = item.icon;
              const tone = item.tone ?? (item.selected ? 'accent' : 'neutral');
              const showSection = item.section && item.section !== items[index - 1]?.section;
              const keepOpen = item.keepOpen ?? item.selected !== undefined;
              return (
                <React.Fragment key={item.id}>
                  {showSection ? (
                    <Text style={[styles.section, index > 0 && styles.sectionSpaced]}>{item.section}</Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    accessibilityState={{
                      disabled: item.disabled,
                      ...(item.selected !== undefined ? { selected: item.selected } : {}),
                    }}
                    disabled={item.disabled || item.loading}
                    onPress={() => {
                      if (!keepOpen) onClose();
                      item.onPress();
                    }}
                    style={({ pressed }) => [
                      styles.item,
                      item.disabled && styles.itemDisabled,
                      pressed && styles.itemPressed,
                    ]}
                  >
                    <View style={[styles.iconWell, styles[`iconWell_${tone}`]]}>
                      <Icon color={toneColor[tone]} size={16} strokeWidth={2} />
                    </View>
                    <View style={styles.copy}>
                      <Text numberOfLines={1} style={[styles.label, tone === 'danger' && styles.labelDanger]}>
                        {item.label}
                      </Text>
                      {item.detail ? (
                        <Text numberOfLines={2} style={styles.detail}>
                          {item.detail}
                        </Text>
                      ) : null}
                    </View>
                    {item.loading ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : item.selected ? (
                      <Check color={toneColor[tone]} size={16} strokeWidth={2.4} />
                    ) : null}
                  </Pressable>
                </React.Fragment>
              );
            })}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 210,
    elevation: 32,
    justifyContent: 'flex-end',
  },
  backdrop: { backgroundColor: colors.overlaySoft },
  sheet: {
    maxHeight: '80%',
    marginHorizontal: 10,
    borderRadius: radii.xlarge,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
    shadowColor: colors.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 20,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    marginTop: 8,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    opacity: 0.6,
  },
  content: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10 },
  section: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  sectionSpaced: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle, paddingTop: 10 },
  item: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.large,
  },
  itemDisabled: { opacity: 0.45 },
  itemPressed: { backgroundColor: colors.whiteWash },
  iconWell: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.controlSurface,
  },
  iconWell_neutral: {},
  iconWell_accent: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  iconWell_success: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  iconWell_danger: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  copy: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  labelDanger: { color: colors.danger },
  detail: { marginTop: 2, color: colors.muted, fontSize: 11.5, lineHeight: 15 },
});
