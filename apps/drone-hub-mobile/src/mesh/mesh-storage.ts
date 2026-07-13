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
};

export async function loadMeshProfile(): Promise<MeshProfile | null> {
  const stored = await AsyncStorage.getItem(PROFILE_KEY);
  if (!stored) return null;
  const profile = JSON.parse(stored) as MeshProfile;
  if (!profile.networkId || !Array.isArray(profile.connections)) return null;
  profile.connections = profile.connections.map((connection, index) => ({
    ...connection,
    role:
      connection.role === 'primary' || connection.role === 'backup'
        ? connection.role
        : index === 0
          ? 'primary'
          : 'backup',
  }));
  profile.capabilitiesByDevice ??= {};
  return profile;
}

export async function saveMeshProfile(profile: MeshProfile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function clearMeshProfile(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_KEY);
}
