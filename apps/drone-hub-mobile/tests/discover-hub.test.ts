import crypto from 'node:crypto';
import { expect, test } from 'bun:test';
import { canonicalJson } from '@drone/device-protocol';
import { discoverHub, hubDiscoveryEndpoints } from '../src/mesh/discover-hub';
import { verifyNearbyHub } from '../src/mesh/nearby-hub';

test('phone discovery probes standard ports but respects explicit HTTPS endpoints', () => {
  expect(hubDiscoveryEndpoints('desktop.tail.ts.net')).toEqual([
    'https://desktop.tail.ts.net:8791',
    'https://desktop.tail.ts.net',
  ]);
  expect(hubDiscoveryEndpoints('https://desktop.tail.ts.net')).toEqual([
    'https://desktop.tail.ts.net',
  ]);
  for (const address of [
    'http://peer',
    'https://user:password@peer',
    'https://peer/path',
    'https://peer?secret=x',
  ])
    expect(() => hubDiscoveryEndpoints(address)).toThrow();
});

test('phone discovery accepts a fresh signed Hub descriptor and rejects tampering', async () => {
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const descriptor = {
    protocol: 'dronehub-device-mesh',
    protocolVersion: 2,
    nonce: 'fresh',
    device: { id: 'hub', name: 'My desktop', publicKey: key.publicKey.export({ format: 'jwk' }) },
    endpoint: 'https://desktop.tail.ts.net:8791',
  };
  const signature = crypto
    .sign('sha256', Buffer.from(canonicalJson(descriptor)), {
      key: key.privateKey,
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64url');
  const options = {
    nonce: 'fresh',
    signal: new AbortController().signal,
    keyId: async () => 'hub',
    fetchImpl: (async () => Response.json({ ...descriptor, signature })) as typeof fetch,
  };
  expect(await discoverHub(descriptor.endpoint, options)).toEqual({
    id: 'hub',
    name: 'My desktop',
    endpoint: descriptor.endpoint,
  });
  const candidate = {
    key: 'nearby',
    id: 'hub',
    name: 'Unverified advertisement',
    endpoint: descriptor.endpoint,
  };
  expect((await verifyNearbyHub(candidate, options)).name).toBe('My desktop');
  await expect(verifyNearbyHub({ ...candidate, id: 'different-hub' }, options)).rejects.toThrow(
    'identity did not match',
  );
  await expect(discoverHub(descriptor.endpoint, { ...options, nonce: 'stale' })).rejects.toThrow(
    'No verified',
  );
  await expect(
    discoverHub(descriptor.endpoint, { ...options, keyId: async () => 'imposter' }),
  ).rejects.toThrow('No verified');
  await expect(
    discoverHub(descriptor.endpoint, {
      ...options,
      fetchImpl: (async () =>
        Response.json({
          ...descriptor,
          device: { ...descriptor.device, name: 'Tampered' },
          signature,
        })) as typeof fetch,
    }),
  ).rejects.toThrow('No verified');
  const abort = new AbortController();
  abort.abort();
  await expect(
    discoverHub(descriptor.endpoint, { ...options, signal: abort.signal }),
  ).rejects.toThrow();
});
