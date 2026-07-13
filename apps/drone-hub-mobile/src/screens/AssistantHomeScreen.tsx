import React from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppDrawerNavigationItem } from '../local-assistant/AssistantThreadDrawer';
import { LocalAssistantScreen } from '../local-assistant/LocalAssistantScreen';
import { AssistantScreen } from './AssistantScreen';

export type AssistantLocation = 'phone' | 'devices';

const APP_HEADER_HEIGHT = 54;

export function AssistantHomeScreen({
  drawerOpen,
  drawerOffset,
  navigationItems,
  openingGestureActive,
  onDrawerOpenChange,
  location,
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
  location: AssistantLocation;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      keyboardVerticalOffset={insets.top + APP_HEADER_HEIGHT}
    >
      <View style={styles.content}>
        {location === 'phone' ? (
          <LocalAssistantScreen
            drawerOpen={drawerOpen}
            drawerOffset={drawerOffset}
            navigationItems={navigationItems}
            openingGestureActive={openingGestureActive}
            onDrawerOpenChange={onDrawerOpenChange}
          />
        ) : (
          <AssistantScreen
            drawerOpen={drawerOpen}
            drawerOffset={drawerOffset}
            navigationItems={navigationItems}
            openingGestureActive={openingGestureActive}
            onDrawerOpenChange={onDrawerOpenChange}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flex: 1 },
});
