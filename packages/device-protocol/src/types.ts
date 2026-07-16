export const DEVICE_PROTOCOL_VERSION = 1 as const;

export type DevicePlatform = 'desktop' | 'server' | 'android' | 'unknown';

export type DevicePublicIdentity = {
  id: string;
  name: string;
  platform: DevicePlatform;
  publicKey: JsonWebKey;
};

export type CapabilityDescriptor = {
  id: string;
  version: number;
  operations: string[];
};

export type CapabilityGrant = {
  capability: string;
  version: number;
  operations: string[];
};

export type ProviderCredentialId = 'openai' | 'codex' | 'groq';

export type ProviderCredentialRequest = {
  version: 1;
  transferId: string;
  recipientPublicKey: JsonWebKey;
};

export type ProviderCredentialEnvelope = {
  version: 1;
  transferId: string;
  credential: ProviderCredentialId;
  senderPublicKey: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
  tag: string;
  signature: string;
};

export type MeshDevice = DevicePublicIdentity & {
  administrator: boolean;
  grants: CapabilityGrant[];
  endpoints: string[];
  revokedAt: string | null;
  addedAt: string;
  updatedAt: string;
};

export type PairingPayload = {
  version: 1;
  endpoint: string;
  token: string;
  inviterDeviceId: string;
  expiresAt: string;
};

export type PairingClaim = {
  token: string;
  claimSecret: string;
  inviterDeviceId: string;
  endpoint: string;
  expiresAt: string;
  device: DevicePublicIdentity;
  signature: string;
};

export type PairingApproval = {
  networkId: string;
  device: MeshDevice;
  devices: MeshDevice[];
  capabilities: CapabilityDescriptor[];
  endpoint: string;
};

export type SignedRouteAnnouncement = {
  type: 'mesh.route';
  version: 1;
  deviceId: string;
  sequence: number;
  endpoint: string | null;
  announcedAt: string;
  expiresAt: string;
  signature: string;
};

export type SignedCapabilityRequest = {
  type: 'capability.request';
  version: 1;
  requestId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  capability: string;
  capabilityVersion: number;
  operation: string;
  payload: unknown;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  maxHops: 1;
  signature: string;
};

export type CapabilityResponse = {
  type: 'capability.response';
  version: 1;
  requestId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

export type CapabilityEvent = {
  type: 'capability.event';
  version: 1;
  sourceDeviceId: string;
  capability: string;
  capabilityVersion: number;
  event: string;
  payload: Record<string, any>;
  issuedAt: string;
};

export type MeshSocketMessage =
  | { type: 'auth.challenge'; nonce: string; deviceId: string; signature: string }
  | { type: 'auth.response'; deviceId: string; signature: string }
  | {
      type: 'auth.ready';
      deviceId: string;
      networkId: string;
      capabilities: CapabilityDescriptor[];
    }
  | { type: 'auth.error'; message: string }
  | SignedRouteAnnouncement
  | SignedCapabilityRequest
  | CapabilityResponse
  | CapabilityEvent;
