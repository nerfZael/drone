import { describe, expect, test } from 'bun:test';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

import { MeshContentSnapshotStore } from '../src/hub/device-mesh/mesh-content-chunk';

describe('mesh content snapshots', () => {
  test('keeps immutable bytes for out-of-order continuation reads', async () => {
    const store = new MeshContentSnapshotStore({ createToken: () => 'snapshot-1' });
    const value = { text: 'x'.repeat(MESH_BINARY_CHUNK_BYTES * 2) };
    const first = await store.createJson({
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

  test('expires, scopes, bounds, and revokes snapshots', async () => {
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
    const create = async (device: string) =>
      (
        await store.createBinary({
          content: Buffer.alloc(MESH_BINARY_CHUNK_BYTES + 1),
          sourceDeviceId: device,
          scope: 'file.preview\0drone-a\0/movie.mp4',
        })
      ).chunk.snapshotToken!;

    const first = await create('phone-a');
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

    const second = await create('phone-b');
    expect(store.size).toBe(2);
    store.revokeDevice('phone-b');
    expect(store.size).toBe(1);
    expect(await create('phone-b')).toStartWith('snapshot-');
    store.revokeDevice('phone-b');
    expect(store.size).toBe(1);

    const third = await create('phone-a');
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

  test('reserves bounded space for concurrent snapshot generation', async () => {
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: 200,
      maxTotalBytes: 300,
    });
    const first = await store.reserve('phone-a', 200);
    let secondAdmitted = false;
    const secondPending = store.reserve('phone-b', 200).then((reservation) => {
      secondAdmitted = true;
      return reservation;
    });
    await Promise.resolve();
    expect(secondAdmitted).toBe(false);
    first.release();
    const second = await secondPending;
    second.release();
    store.close();
    expect(store.reserve('phone-a', 1)).rejects.toThrow('store is closed');
  });

  test('queues capacity pressure without evicting an active transfer', async () => {
    const snapshotBytes = MESH_BINARY_CHUNK_BYTES + 1;
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: snapshotBytes,
      maxTotalBytes: snapshotBytes * 2,
      createToken: () => 'active-snapshot',
    });
    const active = (
      await store.createBinary({
        content: Buffer.alloc(snapshotBytes),
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0movie.mp4',
      })
    ).chunk;
    const reservation = await store.reserve('phone-b', snapshotBytes);
    let thirdAdmitted = false;
    const thirdPending = store.reserve('phone-c', 1).then((value) => {
      thirdAdmitted = true;
      return value;
    });
    await Promise.resolve();
    expect(thirdAdmitted).toBe(false);
    expect(
      store.resume({
        snapshotToken: active.snapshotToken,
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0movie.mp4',
        encoding: 'base64-binary',
        offset: MESH_BINARY_CHUNK_BYTES,
      }).chunk.done,
    ).toBe(true);
    const third = await thirdPending;
    third.release();
    reservation.release();
    store.close();
  });

  test('shares fair admission between media reservations and JSON snapshots', async () => {
    const snapshotBytes = MESH_BINARY_CHUNK_BYTES + 32;
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: snapshotBytes,
      maxTotalBytes: snapshotBytes * 2,
      maxSourceBytes: snapshotBytes,
      createToken: (() => {
        let token = 0;
        return () => `mixed-${++token}`;
      })(),
    });
    const active = await store.createJson({
      value: { text: 'x'.repeat(MESH_BINARY_CHUNK_BYTES) },
      sourceDeviceId: 'phone-a',
      scope: 'directory-a',
    });
    const working = await store.reserve('phone-b', snapshotBytes);
    let mediaAdmitted = false;
    const mediaPending = store.reserve('phone-c', snapshotBytes).then((reservation) => {
      mediaAdmitted = true;
      return reservation;
    });
    await Promise.resolve();
    expect(mediaAdmitted).toBe(false);
    await expect(
      store.createJson({
        value: { text: 'y'.repeat(MESH_BINARY_CHUNK_BYTES) },
        sourceDeviceId: 'phone-d',
        scope: 'directory-d',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    expect((store as any).pendingContentBytes).toBe(0);

    store.resume({
      snapshotToken: active.snapshotToken,
      sourceDeviceId: 'phone-a',
      scope: 'directory-a',
      encoding: 'base64-json-utf8',
      offset: MESH_BINARY_CHUNK_BYTES,
    });
    const media = await mediaPending;
    expect(media.signal.aborted).toBe(false);
    media.release();
    working.release();
    store.close();
  });

  test('reserves only the checked media working set without raising the snapshot limit', async () => {
    const store = new MeshContentSnapshotStore({ maxSnapshotBytes: 32, maxTotalBytes: 64 });
    const first = await store.reserve('phone-a', 32);
    const second = await store.reserve('phone-b', 32);
    const thirdPending = store.reserve('phone-c', 32);
    expect(store.reserve('phone-c', 65)).rejects.toThrow('too large');
    second.release();
    const third = await thirdPending;
    third.release();
    first.release();
    store.close();
  });

  test('prevents one source from monopolizing capacity while another source progresses', async () => {
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: 200,
      maxTotalBytes: 300,
      maxSourceBytes: 200,
    });
    const first = await store.reserve('phone-a', 200);
    const second = await store.reserve('phone-b', 100);
    const thirdPending = store.reserve('phone-c', 100);
    const reacquirePending = store.reserve('phone-a', 200);
    second.release();
    const third = await thirdPending;
    expect((store as any).reservations.size).toBe(2);
    first.release();
    const reacquired = await reacquirePending;
    third.release();
    reacquired.release();
    store.close();
  });

  test('revocation aborts active work, prevents late publish, and releases capacity', async () => {
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: 200,
      maxTotalBytes: 200,
      maxSourceBytes: 200,
    });
    const first = await store.reserve('phone-a', 200);
    const nextPending = store.reserve('phone-b', 200);

    store.revokeDevice('phone-a');

    expect(first.signal.aborted).toBe(true);
    expect(() =>
      first.commitBinary({ content: Buffer.alloc(200), scope: 'file.preview\0late' }),
    ).toThrow('expired');
    const next = await nextPending;
    next.release();
    store.close();
  });

  test('times out stalled reservations without keeping capacity pinned', async () => {
    const store = new MeshContentSnapshotStore({
      maxSnapshotBytes: 32,
      maxTotalBytes: 32,
      maxSourceBytes: 32,
      reservationTtlMs: 10,
    });
    const stalled = await store.reserve('phone-a', 32);
    const nextPending = store.reserve('phone-b', 32);

    await Bun.sleep(20);

    expect(stalled.signal.aborted).toBe(true);
    const next = await nextPending;
    next.release();
    store.close();
  });

  test('cleans up idle snapshots on expiry and supports scoped cancellation', async () => {
    const store = new MeshContentSnapshotStore({
      ttlMs: 10,
      createToken: () => 'snapshot-expiring',
    });
    const snapshot = (
      await store.createBinary({
        content: Buffer.alloc(MESH_BINARY_CHUNK_BYTES + 1),
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0movie.mp4\0sha256:one',
      })
    ).chunk;
    expect((store as any).snapshots.size).toBe(1);
    await Bun.sleep(25);
    expect((store as any).snapshots.size).toBe(0);

    const token = (
      await store.createBinary({
        content: Buffer.alloc(MESH_BINARY_CHUNK_BYTES + 1),
        sourceDeviceId: 'phone-a',
        scope: 'file.preview\0drone-a\0movie.mp4\0sha256:two',
      })
    ).chunk.snapshotToken;
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
