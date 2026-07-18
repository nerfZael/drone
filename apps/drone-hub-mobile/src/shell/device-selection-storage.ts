import AsyncStorage from '@react-native-async-storage/async-storage';

const SELECTED_DEVICE_KEY = 'droneHub.selectedDevice.v1';

export async function loadSelectedDeviceId(): Promise<string> {
  return String((await AsyncStorage.getItem(SELECTED_DEVICE_KEY)) ?? '').trim();
}

export async function saveSelectedDeviceId(deviceIdRaw: string): Promise<void> {
  const deviceId = String(deviceIdRaw ?? '').trim();
  if (deviceId) await AsyncStorage.setItem(SELECTED_DEVICE_KEY, deviceId);
  else await AsyncStorage.removeItem(SELECTED_DEVICE_KEY);
}
