import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeMobileDroneCreatePreferences,
  type MobileDroneCreatePreferences,
} from './create-preferences-model';

const CREATE_PREFERENCES_KEY = 'droneHub.createPreferencesByDeviceAndRepo.v2';
const NO_REPO_KEY = '__no_repo__';

function repoKey(repoPathRaw: string): string {
  return String(repoPathRaw ?? '').trim() || NO_REPO_KEY;
}

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
  repoPathRaw: string,
): Promise<MobileDroneCreatePreferences | null> {
  const deviceId = String(deviceIdRaw ?? '').trim();
  if (!deviceId) return null;
  const preferences = await loadPreferenceMap();
  const byRepo = preferences[deviceId];
  if (!byRepo || typeof byRepo !== 'object' || Array.isArray(byRepo)) return null;
  return normalizeMobileDroneCreatePreferences(
    (byRepo as Record<string, unknown>)[repoKey(repoPathRaw)],
  );
}

export async function saveMobileDroneCreatePreferences(
  deviceIdRaw: string,
  repoPathRaw: string,
  preferences: MobileDroneCreatePreferences,
): Promise<void> {
  const deviceId = String(deviceIdRaw ?? '').trim();
  if (!deviceId) return;
  const current = await loadPreferenceMap();
  const currentForDevice =
    current[deviceId] && typeof current[deviceId] === 'object' && !Array.isArray(current[deviceId])
      ? (current[deviceId] as Record<string, unknown>)
      : {};
  await AsyncStorage.setItem(
    CREATE_PREFERENCES_KEY,
    JSON.stringify({
      ...current,
      [deviceId]: { ...currentForDevice, [repoKey(repoPathRaw)]: preferences },
    }),
  );
}
