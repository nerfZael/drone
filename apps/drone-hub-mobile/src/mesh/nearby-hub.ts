import { throwIfAborted } from '@drone/device-protocol';
import { discoverHub, hubDiscoveryEndpoints, type DiscoveredHub } from './discover-hub';

/** DNS-SD metadata is not proof of identity; verify with discoverHub before pairing. */
export type NearbyHub = DiscoveredHub & { key: string };
export async function verifyNearbyHub(
  candidate: NearbyHub,
  options: Parameters<typeof discoverHub>[1],
): Promise<DiscoveredHub> {
  const hub = await discoverHub(candidate.endpoint, options);
  throwIfAborted(options.signal);
  if (hub.id !== candidate.id)
    throw new Error('Nearby Hub identity did not match. Pairing was not started.');
  return hub;
}
export function parseNearbyHub(body: string): NearbyHub {
  if (body.length > 2048) throw new Error('Oversized nearby advertisement');
  const hub = JSON.parse(body);
  if (
    typeof hub.key !== 'string' ||
    !hub.key ||
    hub.key.length > 255 ||
    typeof hub.id !== 'string' ||
    !hub.id ||
    hub.id.length > 128 ||
    typeof hub.name !== 'string' ||
    !hub.name.trim() ||
    hub.name.length > 80 ||
    typeof hub.endpoint !== 'string' ||
    hub.endpoint.length > 240 ||
    !hub.endpoint.startsWith('https://') ||
    hubDiscoveryEndpoints(hub.endpoint)[0] !== hub.endpoint
  )
    throw new Error('Invalid nearby advertisement');
  return { key: hub.key, id: hub.id, name: hub.name, endpoint: hub.endpoint };
}
