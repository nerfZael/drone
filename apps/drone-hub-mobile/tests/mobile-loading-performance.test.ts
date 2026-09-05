import { describe, expect, test } from 'bun:test';
import { MobileListRefreshCoordinator } from '../src/drones/mobile-list-refresh-coordinator';
import { loadMobileDroneList } from '../src/drones/load-mobile-drone-list';
import { canReuseMobileMediaPreview } from '../src/drones/reuse-media-preview';
import { uploadChatAttachments } from '../src/drones/upload-chat-attachments';
import {
  EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
  normalizeMobileDroneListPayload,
  resolveMobileDroneListSnapshot,
} from '../src/drones/drone-sidebar-model';

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('mobile list refresh work', () => {
  test('applies a completed snapshot during a notification burst and preserves a foreground refresh', async () => {
    const coordinator = new MobileListRefreshCoordinator();
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const calls: boolean[] = [];
    const applied: number[] = [];
    const task = async (quiet: boolean) => {
      const index = calls.length;
      calls.push(quiet);
      await gates[index]!.promise;
      applied.push(index);
    };
    const first = coordinator.request('hub', true, task);
    let foregroundDone = false;
    const foreground = coordinator.request('hub', false, task).then(() => {
      foregroundDone = true;
    });
    for (let i = 0; i < 50; i++) coordinator.request('hub', true, task);
    expect(calls).toEqual([true]);
    gates[0]!.resolve();
    await first;
    expect(applied).toEqual([0]);
    expect(calls).toEqual([true, false]);
    expect(foregroundDone).toBe(false);
    gates[1]!.resolve();
    await foreground;
    expect(applied).toEqual([0, 1]);
  });

  test('cancels the old target and prevents queued work leaking into a replacement', async () => {
    const coordinator = new MobileListRefreshCoordinator();
    const old = Promise.withResolvers<void>();
    let signal!: AbortSignal;
    let oldCalls = 0;
    const task = async (_quiet: boolean, next: AbortSignal) => {
      signal = next;
      oldCalls++;
      await old.promise;
    };
    const first = coordinator.request('a', true, task);
    coordinator.request('a', false, task);
    coordinator.reset();
    expect(signal.aborted).toBe(true);
    const quietCalls: boolean[] = [];
    await coordinator.request('a', true, async (quiet) => {
      quietCalls.push(quiet);
    });
    old.resolve();
    await first;
    expect(oldCalls).toBe(1);
    expect(quietCalls).toEqual([true]);
  });

  test('passes cancellation into the actual drone-list transport', async () => {
    const controller = new AbortController();
    await loadMobileDroneList(
      async (_target, _operation, _payload, signal) => {
        expect(signal).toBe(controller.signal);
        return { drones: [] };
      },
      'hub',
      true,
      controller.signal,
    );
  });
});

describe('sidebar snapshot sharing', () => {
  const payload = () =>
    normalizeMobileDroneListPayload({
      drones: [
        { id: 'a', name: 'A', chats: ['default'], busyChats: [] },
        { id: 'b', name: 'B', chats: ['default'], busyChats: [] },
      ],
    });
  const initial = () =>
    resolveMobileDroneListSnapshot({
      current: EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
      targetId: 'hub',
      payload: payload(),
    });
  test('unchanged refreshes keep list, row, chat-array and sidebar identities', () => {
    const current = initial();
    const next = resolveMobileDroneListSnapshot({ current, targetId: 'hub', payload: payload() });
    expect(next).toEqual(current);
    expect(next.drones).toBe(current.drones);
    expect(next.sidebar).toBe(current.sidebar);
  });
  test('updates changed fields while retaining untouched rows and chat arrays', () => {
    const current = initial();
    const changed = payload();
    changed.drones[0]!.busyChats = ['default'];
    const next = resolveMobileDroneListSnapshot({ current, targetId: 'hub', payload: changed });
    expect(next.drones[0]).not.toBe(current.drones[0]);
    expect(next.drones[0]!.busyChats).toEqual(['default']);
    expect(next.drones[0]!.chats).toBe(current.drones[0]!.chats);
    expect(next.drones[1]).toBe(current.drones[1]);
  });
  test('preserves identities through reorder but isolates devices and removed rows', () => {
    const current = initial();
    const reordered = payload();
    reordered.drones.reverse();
    const next = resolveMobileDroneListSnapshot({ current, targetId: 'hub', payload: reordered });
    expect(next.drones[0]).toBe(current.drones[1]);
    const other = resolveMobileDroneListSnapshot({
      current,
      targetId: 'other',
      payload: payload(),
    });
    expect(other.drones[0]).not.toBe(current.drones[0]);
    const removed = payload();
    removed.drones.pop();
    expect(
      resolveMobileDroneListSnapshot({ current, targetId: 'hub', payload: removed }).drones,
    ).toHaveLength(1);
  });
});

describe('cached media reuse', () => {
  const preview = {
    path: '/a.png',
    name: 'a.png',
    kind: 'image' as const,
    mime: 'image/png',
    size: 123,
    mtimeMs: 7,
    revision: 'sha256:abc',
    uri: 'file:///cache/a',
  };
  test('skips downloading unchanged media only when cached bytes still exist', () => {
    expect(canReuseMobileMediaPreview(preview, { ...preview }, true)).toBe(true);
    expect(canReuseMobileMediaPreview(preview, { ...preview }, false)).toBe(false);
    for (const patch of [
      { revision: null },
      { revision: 'changed' },
      { size: 456 },
      { path: '/b.png' },
    ]) {
      expect(canReuseMobileMediaPreview(preview, { ...preview, ...patch }, true)).toBe(false);
    }
  });
  test('reuses in-memory SVG bytes but never accepts a missing revision', () => {
    const svg = { ...preview, mime: 'image/svg+xml', content: '<svg/>' };
    expect(canReuseMobileMediaPreview(svg, { ...svg }, false)).toBe(true);
    expect(
      canReuseMobileMediaPreview({ ...svg, revision: null }, { ...svg, revision: null }, false),
    ).toBe(false);
  });
});

describe('attachment upload batches', () => {
  test('uploads two at a time and preserves attachment order despite out-of-order completion', async () => {
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<string>());
    const started: number[] = [];
    const result = uploadChatAttachments(
      [0, 1, 2, 3],
      async (index) => {
        started.push(index);
        return gates[index]!.promise;
      },
      async () => {
        throw new Error('Unexpected cleanup');
      },
    );
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve('one');
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[2]!.resolve('two');
    await tick();
    gates[3]!.resolve('three');
    gates[0]!.resolve('zero');
    expect(await result).toEqual(['zero', 'one', 'two', 'three']);
  });
  test('stops scheduling on failure and cleans up successes that finish after the failure', async () => {
    const gates = [Promise.withResolvers<string>(), Promise.withResolvers<string>()];
    const started: number[] = [];
    const cleaned: string[][] = [];
    const error = new Error('Upload failed');
    const result = uploadChatAttachments(
      [0, 1, 2],
      async (index) => {
        started.push(index);
        return gates[index]!.promise;
      },
      async (ids) => {
        cleaned.push(ids);
      },
    );
    void result.catch(() => undefined);
    gates[0]!.reject(error);
    await tick();
    expect(cleaned).toEqual([]);
    gates[1]!.resolve('late-success');
    await expect(result).rejects.toBe(error);
    expect(started).toEqual([0, 1]);
    expect(cleaned).toEqual([['late-success']]);
  });
});
