import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LocalAssistantScreen } from '../local-assistant/LocalAssistantScreen';
import { colors } from '../theme';
import { AssistantScreen } from './AssistantScreen';

type AssistantLocation = 'phone' | 'devices';

export function AssistantHomeScreen() {
  const [location, setLocation] = React.useState<AssistantLocation>('phone');
  return (
    <View style={styles.page}>
      <View style={styles.switcher}>
        <LocationButton
          label="ON THIS PHONE"
          active={location === 'phone'}
          onPress={() => setLocation('phone')}
        />
        <LocationButton
          label="ON DEVICES"
          active={location === 'devices'}
          onPress={() => setLocation('devices')}
        />
      </View>
      <View style={styles.content}>
        {location === 'phone' ? <LocalAssistantScreen /> : <AssistantScreen />}
      </View>
    </View>
  );
}

function LocationButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.location, active && styles.locationActive]}>
      <Text style={[styles.locationText, active && styles.locationTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  switcher: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  location: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.panel,
  },
  locationActive: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  locationText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  locationTextActive: { color: colors.accent },
  content: { flex: 1 },
});
