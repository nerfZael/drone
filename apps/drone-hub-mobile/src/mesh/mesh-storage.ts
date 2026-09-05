import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CapabilityDescriptor, MeshDevice } from '@drone/device-protocol';

const PROFILE_KEY = 'droneHub.meshProfile.v1';

export type MeshConnection = {
  deviceId: string;
  endpoint: string;
  role: 'primary' | 'backup';
};

export type MeshProfile = {
  networkId: string;
  connections: MeshConnection[];
  devices: MeshDevice[];
  capabilitiesByDevice: Record<string, CapabilityDescriptor[]>;
  routeSequences?: Record<string, number>;
};

export async function loadMeshProfile(): Promise<MeshProfile | null> {
  const stored = await AsyncStorage.getItem(PROFILE_KEY);
  if (!stored) return null;
  try {
    const profile = JSON.parse(stored) as MeshProfile;
    if (
      !profile.networkId ||
      !Array.isArray(profile.connections) ||
      !Array.isArray(profile.devices)
    )
      throw new Error('saved mesh profile is invalid');
    const deviceIds = new Set(profile.devices.map((device) => device.id));
    let primaryAssigned = false;
    profile.connections = profile.connections
      .filter(
        (connection) =>
          typeof connection?.deviceId === 'string' &&
          typeof connection?.endpoint === 'string' &&
          deviceIds.has(connection.deviceId),
      )
      .map((connection) => {
        const primary = connection.role === 'primary' && !primaryAssigned;
        if (primary) primaryAssigned = true;
        return { ...connection, role: primary ? ('primary' as const) : ('backup' as const) };
      });
    if (!primaryAssigned && profile.connections[0]) profile.connections[0].role = 'primary';
    profile.capabilitiesByDevice ??= {};
    return profile;
  } catch {
    throw new Error(
      'The saved device profile could not be read. Its data has been preserved; restore the profile before pairing again.',
    );
  }
}

export async function saveMeshProfile(profile: MeshProfile): Promise<void> {
  if ((await AsyncStorage.getItem(`${PROFILE_KEY}.preHttpV2`)) === null) {
    const previous = await AsyncStorage.getItem(PROFILE_KEY);
    if (previous !== null) await AsyncStorage.setItem(`${PROFILE_KEY}.preHttpV2`, previous);
  }
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function clearMeshProfile(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_KEY);
}
