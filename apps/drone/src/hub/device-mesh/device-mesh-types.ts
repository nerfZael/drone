import type {
  CapabilityDescriptor,
  CapabilityGrant,
  DevicePublicIdentity,
  MeshDevice,
  PairingApproval,
  SignedRouteAnnouncement,
} from '@drone/device-protocol';

export type StoredInvitation = {
  id: string;
  tokenHash: string;
  endpoint: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
};

export type PendingDevice = {
  id: string;
  invitationId: string;
  claimSecretHash: string;
  device: DevicePublicIdentity;
  requestedAt: string;
  approval: PairingApproval | null;
  rejectedAt: string | null;
};

export type DeviceMeshState = {
  version: 1;
  networkId: string;
  selfDeviceId: string;
  devices: Record<string, MeshDevice>;
  invitations: Record<string, StoredInvitation>;
  pending: Record<string, PendingDevice>;
  routes: Record<string, SignedRouteAnnouncement>;
};

export type CapabilityContext = {
  sourceDevice: MeshDevice;
  requestId: string;
};

export type CapabilityHandler = {
  descriptor: CapabilityDescriptor;
  invoke(operation: string, payload: unknown, context: CapabilityContext): Promise<unknown>;
  close?(): void | Promise<void>;
  revokeDevice?(deviceId: string): void | Promise<void>;
};

export type DeviceMeshAdminUpdate = {
  name?: string;
  administrator?: boolean;
  grants?: CapabilityGrant[];
  endpoints?: string[];
};

export type DeviceMeshAuditEntry = {
  id: string;
  at: string;
  requestId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  capability: string;
  operation: string;
  outcome: 'allowed' | 'denied' | 'failed';
  errorCode: string | null;
  resource: {
    assistantHomeDeviceId: string;
    threadId: string;
    rootId: string;
    path: string;
  } | null;
};
