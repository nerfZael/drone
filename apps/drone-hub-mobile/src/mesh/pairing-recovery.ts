import type { PairingPayload } from '@drone/device-protocol';
import type { MeshProfile } from './mesh-storage';

export function assertKnownRecoveryTarget(
  payload: PairingPayload,
  profile: MeshProfile | null,
): void {
  if (!profile) return;
  const inviter = profile.devices.find((device) => device.id === payload.inviterDeviceId);
  if (inviter && !inviter.revokedAt) return;
  throw new Error(
    'This connection code is not from a device in your current mesh. Use a code from a known Hub or forget the current mesh before joining another one.',
  );
}
