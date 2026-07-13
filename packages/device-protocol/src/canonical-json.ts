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
