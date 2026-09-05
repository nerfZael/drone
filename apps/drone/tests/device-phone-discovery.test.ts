import crypto from 'node:crypto';
import { expect, test } from 'bun:test';
import {
  phonePairingSigningText,
  phonePairingCode,
  phonePairingCodeText,
  type PhonePairingPresence,
  type PhonePairingOffer,
} from '@drone/device-protocol';
import {
  DevicePhoneDiscovery,
  isTailscalePairingIPv4,
  verifyPhonePresence,
} from '../src/hub/device-mesh/device-phone-discovery';
import {
  deviceIdForPublicKey,
  signDeviceText,
  verifyDeviceText,
  type LocalDeviceIdentity,
} from '../src/hub/device-mesh/device-identity';
import { verifyPhoneOffer } from '../../drone-hub-mobile/src/mesh/verify-phone-offer';

function identity(name: string): LocalDeviceIdentity {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = pair.publicKey.export({ format: 'jwk' });
  return {
    id: deviceIdForPublicKey(publicKey),
    name,
    platform: 'android',
    publicKey,
    privateKey: pair.privateKey,
  };
}

test('LAN and Tailscale scans do not share a single-flight result', async () => {
  const hub = identity('Hub');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let tailscaleReads = 0;
  const requests: string[] = [];
  const discovery = new DevicePhoneDiscovery(
    {
      refreshTailscale: async () => {
        tailscaleReads++;
        return { connected: true, peers: [{ name: 'Phone', online: true, ips: ['100.100.10.2'] }] };
      },
    } as any,
    {} as any,
    hub,
    (async (url) => {
      requests.push(String(url));
      await gate;
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
    () => [{ name: 'LAN', ips: ['192.168.1.2'] }],
  );
  const nearby = discovery.scan(true);
  const all = discovery.scan(false);
  release();
  await Promise.all([nearby, all]);
  expect(tailscaleReads).toBe(1);
  expect(requests).toContain('http://100.100.10.2:8792/.well-known/dronehub-phone');
});

test('temporary phone discovery and offers bind both identities, session, expiry, and confirmation code', async () => {
  const phone = identity('Phone');
  const hub = identity('Desktop');
  const presence: PhonePairingPresence = {
    type: 'dronehub.phone.presence',
    version: 1,
    session: crypto.randomBytes(24).toString('base64url'),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    device: {
      id: phone.id,
      name: phone.name,
      platform: phone.platform,
      publicKey: phone.publicKey,
    },
  };
  const signed = {
    ...presence,
    signature: signDeviceText(phone, phonePairingSigningText(presence)),
  };
  expect(verifyPhonePresence(signed)).toEqual(presence);
  expect(() => verifyPhonePresence({ ...signed, session: 'tampered-session-xxxxxxxx' })).toThrow();
  expect(() => verifyPhonePresence({ ...signed, expiresAt: new Date(0).toISOString() })).toThrow();
  let offered: PhonePairingOffer & { signature: string };
  let revoked = false;
  const requests: string[] = [];
  let useLan = false;
  let holdNextRead: Promise<void> | null = null;
  const discovery = new DevicePhoneDiscovery(
    {
      refreshTailscale: async () => ({
        connected: true,
        peers: [
          { online: true, ips: ['192.168.1.1'], name: 'not-tailnet' },
          { online: true, ips: ['100.100.10.2'], name: 'phone' },
        ],
      }),
      status: () => ({ publicEndpoint: 'https://desktop.tail.ts.net:8791' }),
    } as any,
    {
      read: async () => {
        const hold = holdNextRead;
        holdNextRead = null;
        if (hold) await hold;
        return {
          devices: {
            [hub.id]: { ...hub, administrator: true },
            ...(revoked ? { [phone.id]: { revokedAt: 'revoked' } } : {}),
          },
        };
      },
    } as any,
    hub,
    (async (url, init) => {
      requests.push(String(url));
      if (init?.method === 'POST') {
        offered = JSON.parse(String(init.body));
        return new Response('{}', { status: 202 });
      }
      return Response.json(signed);
    }) as typeof fetch,
    () => (useLan ? [{ name: 'Nearby phone', ips: ['8.8.8.8', '192.168.1.5'] }] : []),
  );
  expect(await discovery.scan()).toMatchObject([{ deviceId: phone.id, name: 'Phone' }]);
  expect(requests).toEqual(['http://100.100.10.2:8792/.well-known/dronehub-phone']);
  await expect(discovery.offer('unknown')).rejects.toThrow('expired');
  let releaseAuthorization!: () => void;
  holdNextRead = new Promise<void>((resolve) => {
    releaseAuthorization = resolve;
  });
  const firstOffer = discovery.offer(phone.id);
  // A rescan during the authorization read must not orphan the cached offer/code.
  try {
    await discovery.scan();
  } finally {
    releaseAuthorization();
  }
  const result = await firstOffer;
  const offer = await verifyPhoneOffer(offered!, presence.session, phone.id, async (key) =>
    deviceIdForPublicKey(key),
  );
  expect(verifyDeviceText(hub.publicKey, phonePairingSigningText(offer), offered!.signature)).toBe(
    true,
  );
  expect(result.code).toBe(
    phonePairingCode(crypto.createHash('sha256').update(phonePairingCodeText(offer)).digest('hex')),
  );
  expect(result.code).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
  expect((await discovery.offer(phone.id)).code).toBe(result.code);
  useLan = true;
  requests.length = 0;
  expect(await discovery.scan(true)).toMatchObject([
    { deviceId: phone.id, machineName: 'Nearby phone' },
  ]);
  expect(requests).toEqual(['http://192.168.1.5:8792/.well-known/dronehub-phone']);
  expect((await discovery.offer(phone.id)).code).toBe(result.code);
  await discovery.scan();
  expect((await discovery.offer(phone.id)).code).toBe(result.code);
  await expect(
    verifyPhoneOffer(offered!, 'another-session', phone.id, async (key) =>
      deviceIdForPublicKey(key),
    ),
  ).rejects.toThrow();
  await expect(
    verifyPhoneOffer(offered!, presence.session, hub.id, async (key) => deviceIdForPublicKey(key)),
  ).rejects.toThrow();
  await expect(
    verifyPhoneOffer(
      { ...offered!, endpoint: 'https://attacker.invalid' },
      presence.session,
      phone.id,
      async (key) => deviceIdForPublicKey(key),
    ),
  ).rejects.toThrow();
  revoked = true;
  await expect(discovery.offer(phone.id)).rejects.toThrow('revoked');
});

test('phone discovery probes only Tailscale IPv4 addresses', () => {
  expect(isTailscalePairingIPv4('100.64.0.1')).toBe(true);
  expect(isTailscalePairingIPv4('100.127.255.254')).toBe(true);
  for (const ip of [
    '127.0.0.1',
    '100.064.0.1',
    '192.168.0.1',
    '100.128.0.1',
    '100.64.0.999',
    '100.64.0.1/evil',
    'http://100.64.0.1',
  ])
    expect(isTailscalePairingIPv4(ip)).toBe(false);
});
