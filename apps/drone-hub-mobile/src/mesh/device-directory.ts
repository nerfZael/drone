import {
  canonicalJson,
  routeAnnouncementSigningText,
  type MeshDevice,
} from '@drone/device-protocol';
import { verifyP256Signature } from '../security/p256-signature';
import type { MeshProfile } from './mesh-storage';

export async function acceptDeviceDirectory(
  profile: MeshProfile,
  issuerId: string,
  nonce: string,
  input: any,
  publicKeyId: (key: JsonWebKey) => Promise<string>,
) {
  const issuer = profile.devices.find((device) => device.id === issuerId && !device.revokedAt);
  if (
    !issuer ||
    !input ||
    input.type !== 'device.directory' ||
    input.version !== 2 ||
    input.networkId !== profile.networkId ||
    input.issuerDeviceId !== issuerId ||
    input.nonce !== nonce ||
    !Array.isArray(input.devices) ||
    input.devices.length > 200 ||
    !Array.isArray(input.routes) ||
    input.routes.length > 200 ||
    Math.abs(Date.now() - Date.parse(input.issuedAt)) > 120000 ||
    !Number.isFinite(Date.parse(input.issuedAt))
  )
    throw new Error('Invalid device directory');
  const { signature, ...unsigned } = input;
  if (
    !verifyP256Signature(
      issuer.publicKey,
      `drone-directory-v2\n${canonicalJson(unsigned)}`,
      signature,
    )
  )
    throw new Error('Invalid directory signature');
  const devices = new Map(profile.devices.map((device) => [device.id, device]));
  const seen = new Set<string>();
  for (const candidate of input.devices as MeshDevice[]) {
    if (
      !candidate?.id ||
      seen.has(candidate.id) ||
      (await publicKeyId(candidate.publicKey)) !== candidate.id
    )
      throw new Error('Invalid directory identity');
    seen.add(candidate.id);
    if (!issuer.administrator && candidate.id !== issuer.id) continue;
    const existing = devices.get(candidate.id);
    if (existing?.revokedAt) continue;
    // Directory discovery must not replace destination-owned phone grants or unsigned endpoint hints.
    devices.set(candidate.id, {
      ...candidate,
      // A member may refresh its own metadata, but cannot grant itself network authority.
      administrator: issuer.administrator
        ? candidate.administrator === true
        : existing?.administrator === true,
      grants: existing?.grants ?? [],
      endpoints: existing?.endpoints ?? [],
    });
  }
  const routeSequences = { ...profile.routeSequences };
  for (const route of input.routes) {
    const device = devices.get(route?.deviceId);
    if (
      !device ||
      device.revokedAt ||
      route.type !== 'mesh.route' ||
      route.version !== 1 ||
      !Number.isSafeInteger(route.sequence) ||
      route.sequence <= (routeSequences[device.id] ?? -1)
    )
      continue;
    const issued = Date.parse(route.announcedAt);
    const expires = Date.parse(route.expiresAt);
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > Date.now() + 30000 ||
      expires <= Date.now() ||
      expires - issued > 7 * 24 * 3600000
    )
      continue;
    const { signature: routeSignature, ...announcement } = route;
    if (
      !verifyP256Signature(
        device.publicKey,
        routeAnnouncementSigningText(announcement),
        routeSignature,
      )
    )
      continue;
    if (route.endpoint !== null) {
      const endpoint = new URL(route.endpoint);
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.pathname !== '/'
      )
        continue;
    }
    devices.set(device.id, { ...device, endpoints: route.endpoint ? [route.endpoint] : [] });
    routeSequences[device.id] = route.sequence;
  }
  return { devices: [...devices.values()], routeSequences };
}
