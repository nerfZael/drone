import { expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { canonicalJson, routeAnnouncementSigningText } from '@drone/device-protocol';
import { acceptDeviceDirectory } from '../src/mesh/device-directory';

function identity() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = pair.publicKey.export({ format: 'jwk' });
  const id = keyId(publicKey);
  return {
    id,
    publicKey,
    sign: (text: string) =>
      crypto
        .sign('sha256', Buffer.from(text), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' })
        .toString('base64url'),
  };
}
function keyId(key: JsonWebKey) {
  return `device_${crypto
    .createHash('sha256')
    .update(canonicalJson({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }))
    .digest('base64url')
    .slice(0, 24)}`;
}
test('signed directories preserve phone grants and verify device-owned routes without accepting rollbacks', async () => {
  const hub = identity();
  const peer = identity();
  const now = new Date().toISOString();
  const member = (who: typeof hub, administrator: boolean) => ({
    id: who.id,
    publicKey: who.publicKey,
    name: who.id,
    platform: 'desktop' as const,
    administrator,
    grants: [],
    endpoints: [],
    revokedAt: null,
    addedAt: now,
    updatedAt: now,
  });
  const grant = { capability: 'drone-control', version: 1, operations: ['chat.read'] };
  const profile: any = {
    networkId: 'network',
    devices: [{ ...member(hub, true), grants: [grant] }, member(peer, false)],
    connections: [],
    capabilitiesByDevice: {},
  };
  const route = {
    type: 'mesh.route' as const,
    version: 1 as const,
    deviceId: peer.id,
    sequence: 2,
    endpoint: 'https://peer.tail.ts.net:8791',
    announcedAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const unsigned = {
    type: 'device.directory',
    version: 2,
    networkId: 'network',
    issuerDeviceId: hub.id,
    nonce: 'fresh',
    issuedAt: now,
    devices: [
      member(hub, true),
      { ...member(peer, false), endpoints: ['https://unverified.invalid'] },
    ],
    routes: [{ ...route, signature: peer.sign(routeAnnouncementSigningText(route)) }],
  };
  const signed = () => ({
    ...unsigned,
    signature: hub.sign(`drone-directory-v2\n${canonicalJson(unsigned)}`),
  });
  const next = await acceptDeviceDirectory(profile, hub.id, 'fresh', signed(), async (key) =>
    keyId(key),
  );
  expect(next.devices.find((device) => device.id === hub.id)?.grants).toEqual([grant]);
  expect(next.devices.find((device) => device.id === peer.id)?.endpoints).toEqual([route.endpoint]);
  expect(next.routeSequences[peer.id]).toBe(2);
  await expect(
    acceptDeviceDirectory(profile, hub.id, 'different', signed(), async (key) => keyId(key)),
  ).rejects.toThrow();
  const old = { ...route, sequence: 1, endpoint: 'https://old.tail.ts.net' };
  unsigned.routes = [{ ...old, signature: peer.sign(routeAnnouncementSigningText(old)) }];
  const again = await acceptDeviceDirectory(
    { ...profile, ...next },
    hub.id,
    'fresh',
    signed(),
    async (key) => keyId(key),
  );
  expect(again.devices.find((device) => device.id === peer.id)?.endpoints).toEqual([
    route.endpoint,
  ]);
  const promotion = {
    ...unsigned,
    issuerDeviceId: peer.id,
    devices: [member(peer, true), { ...member(hub, true), revokedAt: now }],
    routes: [],
  };
  const deniedPromotion = await acceptDeviceDirectory(
    profile,
    peer.id,
    'fresh',
    {
      ...promotion,
      signature: peer.sign(`drone-directory-v2\n${canonicalJson(promotion)}`),
    },
    async (key) => keyId(key),
  );
  expect(deniedPromotion.devices.find((device) => device.id === peer.id)?.administrator).toBe(
    false,
  );
  expect(deniedPromotion.devices.find((device) => device.id === hub.id)?.revokedAt).toBeNull();
});
