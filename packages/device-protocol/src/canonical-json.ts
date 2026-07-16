function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, normalize(source[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function capabilityRequestSigningText(
  request: Omit<import('./types').SignedCapabilityRequest, 'signature'>,
): string {
  return `drone-device-request-v1\n${canonicalJson(request)}`;
}

export function pairingClaimSigningText(
  claim: Omit<import('./types').PairingClaim, 'signature'>,
): string {
  const key = claim.device.publicKey;
  return `drone-device-pairing-claim-v1\n${canonicalJson({
    token: claim.token,
    claimSecret: claim.claimSecret,
    inviterDeviceId: claim.inviterDeviceId,
    endpoint: claim.endpoint.replace(/\/+$/, ''),
    expiresAt: claim.expiresAt,
    device: {
      id: claim.device.id,
      name: claim.device.name,
      platform: claim.device.platform,
      publicKey: { crv: key.crv, kty: key.kty, x: key.x, y: key.y },
    },
  })}`;
}

export function socketAuthSigningText(deviceId: string, nonce: string): string {
  return `drone-device-auth-v1\n${deviceId}\n${nonce}`;
}

export function socketServerAuthSigningText(
  serverDeviceId: string,
  clientDeviceId: string,
  nonce: string,
): string {
  return `drone-device-server-auth-v1\n${serverDeviceId}\n${clientDeviceId}\n${nonce}`;
}

export function routeAnnouncementSigningText(
  route: Omit<import('./types').SignedRouteAnnouncement, 'signature'>,
): string {
  return `drone-device-route-v1\n${canonicalJson(route)}`;
}

export function providerCredentialEnvelopeSigningText(
  envelope: Omit<import('./types').ProviderCredentialEnvelope, 'signature'>,
  senderDeviceId: string,
  recipientDeviceId: string,
): string {
  return `drone-provider-credential-envelope-v1\n${senderDeviceId}\n${recipientDeviceId}\n${canonicalJson(envelope)}`;
}
