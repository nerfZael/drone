import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, type MeshDevice } from '@drone/device-protocol';
import { DeviceMembershipSynchronizer } from '../src/hub/device-mesh/device-membership-synchronizer';
import {
  deviceIdForPublicKey,
  signDeviceText,
  type LocalDeviceIdentity,
} from '../src/hub/device-mesh/device-identity';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';

const tempDirs: string[] = [];

function identity(name: string): LocalDeviceIdentity {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = pair.publicKey.export({ format: 'jwk' });
  return {
    id: deviceIdForPublicKey(publicKey),
    name,
    platform: 'server',
    publicKey,
    privateKey: pair.privateKey,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('device membership synchronization', () => {
  test('does not let a non-administrator promote itself', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-membership-test-'));
    tempDirs.push(directory);
    const local = identity('Local');
    const peer = identity('Peer');
    const store = new DeviceMeshStore(path.join(directory, 'state.json'), local);
    await store.read();
    const addedAt = new Date(Date.now() - 10_000).toISOString();
    const peerRecord: MeshDevice = {
      id: peer.id,
      name: peer.name,
      platform: peer.platform,
      publicKey: peer.publicKey,
      administrator: false,
      grants: [],
      endpoints: [],
      revokedAt: null,
      addedAt,
      updatedAt: addedAt,
    };
    await store.update((state) => {
      state.devices[peer.id] = peerRecord;
    });
    const unsigned = {
      type: 'mesh.membership',
      version: 1,
      issuerDeviceId: peer.id,
      issuedAt: new Date().toISOString(),
      devices: [
        {
          ...peerRecord,
          administrator: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    const event = {
      ...unsigned,
      signature: signDeviceText(peer, `drone-membership-v1\n${canonicalJson(unsigned)}`),
    };

    const synchronizer = new DeviceMembershipSynchronizer(local, store);
    expect(await synchronizer.acceptMembership(event)).toBe(true);
    expect((await store.read()).devices[peer.id].administrator).toBe(false);
  });

  test('propagates display names while rejecting membership name collisions', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-membership-names-'));
    tempDirs.push(directory);
    const local = identity('Local');
    const peer = identity('Peer');
    const store = new DeviceMeshStore(path.join(directory, 'state.json'), local);
    await store.read();
    const addedAt = new Date(Date.now() - 10_000).toISOString();
    const peerRecord: MeshDevice = {
      id: peer.id,
      name: peer.name,
      platform: peer.platform,
      publicKey: peer.publicKey,
      administrator: false,
      grants: [],
      endpoints: [],
      revokedAt: null,
      addedAt,
      updatedAt: addedAt,
    };
    await store.update((state) => {
      state.devices[peer.id] = peerRecord;
    });
    const membership = (name: string, updatedAt: string) => {
      const unsigned = {
        type: 'mesh.membership',
        version: 1,
        issuerDeviceId: peer.id,
        issuedAt: new Date().toISOString(),
        devices: [{ ...peerRecord, name, updatedAt }],
      };
      return {
        ...unsigned,
        signature: signDeviceText(peer, `drone-membership-v1\n${canonicalJson(unsigned)}`),
      };
    };
    const synchronizer = new DeviceMembershipSynchronizer(local, store);
    expect(await synchronizer.acceptMembership(membership('Local', new Date().toISOString()))).toBe(
      false,
    );
    expect((await store.read()).devices[peer.id].name).toBe('Peer');
    expect(
      await synchronizer.acceptMembership(
        membership('Renamed peer', new Date(Date.now() + 1_000).toISOString()),
      ),
    ).toBe(true);
    expect((await store.read()).devices[peer.id].name).toBe('Renamed peer');
  });
});
