import React from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  AppDrawerNavigationItem,
  DrawerDevicePickerItem,
} from '../local-assistant/AssistantThreadDrawer';
import { LocalAssistantScreen } from '../local-assistant/LocalAssistantScreen';
import { AssistantScreen } from './AssistantScreen';

export type AssistantLocation = 'phone' | 'devices';

export type AssistantAppHeaderState = {
  title: string;
  subtitle: string;
  statusTone: 'online' | 'muted' | 'error';
  accessOpen?: boolean;
  accessDisabled?: boolean;
  onToggleAccess?(): void;
  onDelete?(): void;
};

const APP_HEADER_HEIGHT = 54;

export function AssistantHomeScreen({
  drawerOpen,
  drawerOffset,
  navigationItems,
  openingGestureActive,
  onDrawerOpenChange,
  location,
  activeDeviceId,
  devicePickerItems,
  onDeviceChange,
  onHeaderChange,
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
  location: AssistantLocation;
  activeDeviceId: string;
  devicePickerItems: DrawerDevicePickerItem[];
  onDeviceChange(deviceId: string): void;
  onHeaderChange(header: AssistantAppHeaderState | null): void;
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
            activeDeviceId={activeDeviceId}
            devicePickerItems={devicePickerItems}
            onDeviceChange={onDeviceChange}
            onHeaderChange={onHeaderChange}
          />
        ) : (
          <AssistantScreen
            drawerOpen={drawerOpen}
            drawerOffset={drawerOffset}
            navigationItems={navigationItems}
            openingGestureActive={openingGestureActive}
            onDrawerOpenChange={onDrawerOpenChange}
            homeId={activeDeviceId}
            devicePickerItems={devicePickerItems}
            onDeviceChange={onDeviceChange}
            onHeaderChange={onHeaderChange}
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
