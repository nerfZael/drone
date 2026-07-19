import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeMobileDroneCreatePreferences,
  type MobileDroneCreatePreferences,
} from './create-preferences-model';

const CREATE_PREFERENCES_KEY = 'droneHub.createPreferencesByDevice.v1';

async function loadPreferenceMap(): Promise<Record<string, unknown>> {
  try {
    const raw = await AsyncStorage.getItem(CREATE_PREFERENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadMobileDroneCreatePreferences(
  deviceIdRaw: string,
): Promise<MobileDroneCreatePreferences | null> {
  const deviceId = String(deviceIdRaw ?? '').trim();
  if (!deviceId) return null;
  const preferences = await loadPreferenceMap();
  return normalizeMobileDroneCreatePreferences(preferences[deviceId]);
}

export async function saveMobileDroneCreatePreferences(
  deviceIdRaw: string,
  preferences: MobileDroneCreatePreferences,
): Promise<void> {
  const deviceId = String(deviceIdRaw ?? '').trim();
  if (!deviceId) return;
  const current = await loadPreferenceMap();
  await AsyncStorage.setItem(
    CREATE_PREFERENCES_KEY,
    JSON.stringify({ ...current, [deviceId]: preferences }),
  );
}
