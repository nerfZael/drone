import { describe, expect, test } from 'bun:test';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

import { MeshContentSnapshotStore } from '../src/hub/device-mesh/mesh-content-chunk';

describe('mesh content snapshots', () => {
  test('keeps immutable bytes for out-of-order continuation reads', () => {
    const store = new MeshContentSnapshotStore({ createToken: () => 'snapshot-1' });
    const value = { text: 'x'.repeat(MESH_BINARY_CHUNK_BYTES * 2) };
    const first = store.createJson({
      value,
      sourceDeviceId: 'phone-a',
      scope: 'files.list\0drone-a\0/work',
    });

    expect(first.snapshotToken).toBe('snapshot-1');
    for (const offset of [-1, 1, 1.5, first.totalBytes]) {
      expect(() =>
        store.resume({
          snapshotToken: first.snapshotToken,
          sourceDeviceId: 'phone-a',
          scope: 'files.list\0drone-a\0/work',
          encoding: 'base64-json-utf8',
          offset,
        }),
      ).toThrow('offset is outside');
    }
    const last = store.resume({
      snapshotToken: first.snapshotToken,
      sourceDeviceId: 'phone-a',
      scope: 'files.list\0drone-a\0/work',
      encoding: 'base64-json-utf8',
      offset: MESH_BINARY_CHUNK_BYTES * 2,
    }).chunk;
    const middle = store.resume({
      snapshotToken: first.snapshotToken,
      sourceDeviceId: 'phone-a',
      scope: 'files.list\0drone-a\0/work',
      encoding: 'base64-json-utf8',
      offset: MESH_BINARY_CHUNK_BYTES,
    }).chunk;

    expect(last.done).toBe(true);
    expect(middle.offset).toBe(MESH_BINARY_CHUNK_BYTES);
    expect(middle.snapshotToken).toBe(first.snapshotToken);
    expect(store.size).toBe(0);
  });

  test('expires, scopes, bounds, and revokes snapshots', () => {
    let now = 1_000;
    let token = 0;
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: MESH_BINARY_CHUNK_BYTES * 2,
      maxTotalBytes: (MESH_BINARY_CHUNK_BYTES + 1) * 3,
      maxSourceBytes: (MESH_BINARY_CHUNK_BYTES + 1) * 3,
      ttlMs: 50,
      now: () => now,
      createToken: () => `snapshot-${++token}`,
    });
    const create = (device: string) =>
      store.createBinary({
        content: Buffer.alloc(MESH_BINARY_CHUNK_BYTES + 1),
        sourceDeviceId: device,
        scope: 'file.preview\0drone-a\0/movie.mp4',
      }).chunk.snapshotToken!;

    const first = create('phone-a');
    expect(() =>
      store.resume({
        snapshotToken: first,
        sourceDeviceId: 'phone-b',
        scope: 'file.preview\0drone-a\0/movie.mp4',
        encoding: 'base64-binary',
        offset: MESH_BINARY_CHUNK_BYTES,
      }),
    ).toThrow('does not match');
    expect(() =>
      store.resume({
        snapshotToken: first,
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0/other.mp4',
        encoding: 'base64-binary',
        offset: MESH_BINARY_CHUNK_BYTES,
      }),
    ).toThrow('does not match');

    const second = create('phone-b');
    expect(store.size).toBe(2);
    store.revokeDevice('phone-b');
    expect(store.size).toBe(1);
    expect(create('phone-b')).toStartWith('snapshot-');
    store.revokeDevice('phone-b');
    expect(store.size).toBe(1);

    const third = create('phone-a');
    now += 51;
    expect(() =>
      store.resume({
        snapshotToken: third,
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0/movie.mp4',
        encoding: 'base64-binary',
        offset: MESH_BINARY_CHUNK_BYTES,
      }),
    ).toThrow('expired');
  });

  test('reserves bounded space for concurrent snapshot generation', () => {
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: 200,
      maxTotalBytes: 300,
    });
    const release = store.reserve('phone-a', 200);
    expect(() => store.reserve('phone-b', 200)).toThrow('limit is full');
    release();
    const releaseSecond = store.reserve('phone-b', 200);
    releaseSecond();
    store.close();
    expect(() => store.reserve('phone-a', 1)).toThrow('store is closed');
  });

  test('rejects capacity pressure without evicting an active transfer', () => {
    const snapshotBytes = MESH_BINARY_CHUNK_BYTES + 1;
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: snapshotBytes,
      maxTotalBytes: snapshotBytes * 2,
      createToken: () => 'active-snapshot',
    });
    const active = store.createBinary({
      content: Buffer.alloc(snapshotBytes),
      sourceDeviceId: 'phone-a',
      scope: 'file.preview\0drone-a\0movie.mp4',
    }).chunk;
    const release = store.reserve('phone-b', snapshotBytes);
    expect(() => store.reserve('phone-c', 1)).toThrow('limit is full');
    expect(
      store.resume({
        snapshotToken: active.snapshotToken,
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0movie.mp4',
        encoding: 'base64-binary',
        offset: MESH_BINARY_CHUNK_BYTES,
      }).chunk.done,
    ).toBe(true);
    release();
    store.close();
  });

  test('reserves only the checked media working set without raising the snapshot limit', () => {
    const store = new MeshContentSnapshotStore({ maxSnapshotBytes: 32, maxTotalBytes: 64 });
    const release = store.reserve('phone-a', 32);
    expect(() => store.reserve('phone-a', 1)).toThrow('for this device is full');
    const releaseOther = store.reserve('phone-b', 32);
    expect(() => store.reserve('phone-c', 1)).toThrow('limit is full');
    expect(() => store.reserve('phone-c', 65)).toThrow('too large');
    releaseOther();
    release();
    const releaseAgain = store.reserve('phone-c', 32);
    expect(releaseAgain).toBeFunction();
    releaseAgain();
    store.close();
  });

  test('prevents one source from monopolizing capacity while another source progresses', () => {
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: 200,
      maxTotalBytes: 300,
      maxSourceBytes: 200,
    });
    const releaseA = store.reserve('phone-a', 200);
    expect(() => store.reserve('phone-a', 1)).toThrow('for this device is full');
    const releaseB = store.reserve('phone-b', 100);
    expect(() => store.reserve('phone-c', 1)).toThrow('limit is full');
    releaseB();
    const releaseC = store.reserve('phone-c', 100);
    releaseA();
    const releaseBRetry = store.reserve('phone-b', 200);
    releaseC();
    releaseBRetry();
    store.close();
  });

  test('cleans up idle snapshots on expiry and supports scoped cancellation', async () => {
    const store = new MeshContentSnapshotStore({
      ttlMs: 10,
      createToken: () => 'snapshot-expiring',
    });
    const snapshot = store.createBinary({
      content: Buffer.alloc(MESH_BINARY_CHUNK_BYTES + 1),
      sourceDeviceId: 'phone-a',
      scope: 'file.preview\0drone-a\0movie.mp4\0sha256:one',
    }).chunk;
    expect((store as any).snapshots.size).toBe(1);
    await Bun.sleep(25);
    expect((store as any).snapshots.size).toBe(0);

    const token = store.createBinary({
      content: Buffer.alloc(MESH_BINARY_CHUNK_BYTES + 1),
      sourceDeviceId: 'phone-a',
      scope: 'file.preview\0drone-a\0movie.mp4\0sha256:two',
    }).chunk.snapshotToken;
    expect(() =>
      store.cancel({
        snapshotToken: token,
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0movie.mp4\0sha256:other',
      }),
    ).toThrow('does not match');
    store.cancel({
      snapshotToken: token,
      sourceDeviceId: 'phone-a',
      scope: 'file.preview\0drone-a\0movie.mp4\0sha256:two',
    });
    expect(store.size).toBe(0);
    store.close();
  });
});
