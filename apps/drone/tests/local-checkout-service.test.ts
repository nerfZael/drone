import { describe, expect, test } from 'bun:test';
import {
  LocalCheckoutError,
  LocalCheckoutService,
} from '../src/hub/local-checkout-service';

const RETURN_SHA = '1'.repeat(40);
const A_HEAD = '2'.repeat(40);
const A_TREE = 'a'.repeat(40);
const A_WORKING = '4'.repeat(40);
const A_WORKING_TREE = 'b'.repeat(40);
const B_HEAD = '3'.repeat(40);
const B_TREE = 'c'.repeat(40);
const PROMOTED_HEAD = '5'.repeat(40);
const C_RETURN_SHA = '6'.repeat(40);
const C_HEAD = '7'.repeat(40);
const C_TREE = 'd'.repeat(40);

function createHarness() {
  const registry: any = {
    settings: {},
    drones: {
      a: {
        id: 'a',
        name: 'Alpha',
        runtime: 'container',
        repoPath: '/repo',
        containerName: 'alpha',
        repo: { dest: '/work/repo' },
      },
      b: {
        id: 'b',
        name: 'Beta',
        runtime: 'container',
        repoPath: '/repo',
        containerName: 'beta',
        repo: { dest: '/work/repo' },
      },
      c: {
        id: 'c',
        name: 'Charlie',
        runtime: 'container',
        repoPath: '/repo-c',
        containerName: 'charlie',
        repo: { dest: '/work/repo' },
      },
    },
  };
  const hostHeads: Record<string, string> = {
    '/repo': RETURN_SHA,
    '/repo-c': C_RETURN_SHA,
  };
  let timestamp = 0;
  let delayNextCapture: Promise<void> | null = null;
  let mergeBaseCode = 1;
  let latestSnapshotSha = '';
  let importedShaOverride = '';
  let failNextRegistryWrite = false;
  const checkouts: string[] = [];

  const snapshotFor = (container: string, includeDirty: boolean) => {
    if (container === 'beta') {
      return {
        head: B_HEAD,
        tree: B_TREE,
        snapshot: B_HEAD,
        dirtyCount: 0,
      };
    }
    if (container === 'charlie') {
      return {
        head: C_HEAD,
        tree: C_TREE,
        snapshot: C_HEAD,
        dirtyCount: 0,
      };
    }
    return includeDirty
      ? {
          head: A_HEAD,
          tree: A_WORKING_TREE,
          snapshot: A_WORKING,
          dirtyCount: 2,
        }
      : {
          head: A_HEAD,
          tree: A_TREE,
          snapshot: A_HEAD,
          dirtyCount: 2,
        };
  };

  const service = new LocalCheckoutService({
    loadRegistry: async () => registry,
    updateRegistry: async (mutator: (value: any) => any) => {
      if (failNextRegistryWrite) {
        failNextRegistryWrite = false;
        throw new Error('registry write failed');
      }
      return await mutator(registry);
    },
    findDroneIdByRef: (_value: any, ref: string) =>
      registry.drones[ref] ? { kind: 'real', id: ref } : null,
    droneRuntime: () => 'container',
    droneRootPath: () => '/tmp/drone-local-checkout-tests',
    gitTopLevel: async (repoPath: string) => repoPath,
    gitIsClean: async () => true,
    gitResolveCommitSha: async () => null,
    updateHostRef: async () => {},
    importBundleHeadToHostRef: async () => importedShaOverride || latestSnapshotSha,
    dvmExec: async (container: string, _cmd: string, args: string[]) => {
      const script = args[1] ?? '';
      if (script.includes('DRONE_LOCAL_PROMOTED')) {
        return {
          code: 0,
          stdout: `DRONE_LOCAL_PROMOTED\t${PROMOTED_HEAD}\n`,
          stderr: '',
        };
      }
      if (delayNextCapture) {
        const delay = delayNextCapture;
        delayNextCapture = null;
        await delay;
      }
      const snapshot = snapshotFor(container, script.includes('tmp_index='));
      latestSnapshotSha = snapshot.snapshot;
      return {
        code: 0,
        stdout: [
          'some unrelated command output',
          [
            'DRONE_LOCAL_SNAPSHOT',
            snapshot.head,
            snapshot.tree,
            snapshot.snapshot,
            snapshot.dirtyCount,
            RETURN_SHA,
          ].join('\t'),
          '',
        ].join('\n'),
        stderr: '',
      };
    },
    dvmRepoExport: async () => ({ exportedPath: '/tmp/nonexistent-test.bundle' }),
    runHostCommand: async (_command: string, args: string[]) => {
      const repoRoot = args[1] ?? '/repo';
      const gitArgs = args.slice(2);
      if (gitArgs[0] === 'rev-parse' && gitArgs[1] === 'HEAD') {
        return { code: 0, stdout: `${hostHeads[repoRoot]}\n`, stderr: '' };
      }
      if (gitArgs[0] === 'symbolic-ref') {
        return { code: 0, stdout: 'main\n', stderr: '' };
      }
      if (gitArgs[0] === 'rev-parse' && gitArgs[1] === '--git-path') {
        return {
          code: 0,
          stdout: `/tmp/missing-drone-local-checkout-test/${gitArgs[2]}\n`,
          stderr: '',
        };
      }
      if (gitArgs[0] === 'checkout') {
        const target = gitArgs.at(-1) ?? '';
        hostHeads[repoRoot] =
          target === 'main'
            ? repoRoot === '/repo-c'
              ? C_RETURN_SHA
              : RETURN_SHA
            : target;
        checkouts.push(target);
        return { code: 0, stdout: '', stderr: '' };
      }
      if (gitArgs[0] === 'merge-base') {
        return {
          code: mergeBaseCode,
          stdout: '',
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    nowIso: () => new Date(++timestamp * 1_000).toISOString(),
  } as any);

  return {
    service,
    registry,
    checkouts,
    hostHead: (repoRoot = '/repo') => hostHeads[repoRoot],
    setHostHead: (sha: string) => {
      hostHeads['/repo'] = sha;
    },
    setHostDescendsFromSnapshot: (value: boolean) => {
      mergeBaseCode = value ? 0 : 1;
    },
    setMergeBaseCode: (code: number) => {
      mergeBaseCode = code;
    },
    setImportedShaOverride: (sha: string) => {
      importedShaOverride = sha;
    },
    failNextRegistryWrite: () => {
      failNextRegistryWrite = true;
    },
    delayCaptureUntil: (promise: Promise<void>) => {
      delayNextCapture = promise;
    },
  };
}

describe('LocalCheckoutService', () => {
  test('switches the active drone in place and returns to the original branch', async () => {
    const harness = createHarness();

    const first = await harness.service.useLocally('a');
    expect(first.session.droneId).toBe('a');
    expect(first.operation).toBeNull();
    expect(harness.hostHead()).toBe(A_HEAD);

    const second = await harness.service.useLocally('b');
    expect(second.session.droneId).toBe('b');
    expect(second.session.returnRef).toBe('main');
    expect(second.session.returnSha).toBe(RETURN_SHA);
    expect(harness.hostHead()).toBe(B_HEAD);

    const returned = await harness.service.returnToOriginal();
    expect(returned.session).toBeNull();
    expect(returned.autoUpdates).toBe('off');
    expect(harness.hostHead()).toBe(RETURN_SHA);
    expect(harness.checkouts).toEqual([A_HEAD, B_HEAD, 'main']);
  });

  test('moves progressively between committed and all-change snapshots', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');

    await harness.service.setAutoUpdates('all');
    const allChanges = await harness.service.update();
    expect(allChanges.session.snapshotKind).toBe('working-tree');
    expect(allChanges.session.sourceDirtyFileCount).toBe(2);
    expect(harness.hostHead()).toBe(A_WORKING);

    await harness.service.setAutoUpdates('commits');
    const commitsOnly = await harness.service.update();
    expect(commitsOnly.session.snapshotKind).toBe('commit');
    expect(harness.hostHead()).toBe(A_HEAD);
  });

  test('restores the first repository when switching local use across repositories', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');

    const switched = await harness.service.useLocally('c');
    expect(switched.session.droneId).toBe('c');
    expect(switched.session.repoRoot).toBe('/repo-c');
    expect(switched.session.returnSha).toBe(C_RETURN_SHA);
    expect(harness.hostHead('/repo')).toBe(RETURN_SHA);
    expect(harness.hostHead('/repo-c')).toBe(C_HEAD);

    await harness.service.returnToOriginal();
    expect(harness.hostHead('/repo')).toBe(RETURN_SHA);
    expect(harness.hostHead('/repo-c')).toBe(C_RETURN_SHA);
  });

  test('rolls both repositories back if saving a cross-repository switch fails', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');
    harness.failNextRegistryWrite();

    await expect(harness.service.useLocally('c')).rejects.toThrow('registry write failed');
    expect(harness.registry.settings.localCheckout.session.droneId).toBe('a');
    expect(harness.hostHead('/repo')).toBe(A_HEAD);
    expect(harness.hostHead('/repo-c')).toBe(C_RETURN_SHA);
  });

  test('rolls the host back if saving an update fails', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');
    await harness.service.setAutoUpdates('all');
    harness.failNextRegistryWrite();

    await expect(harness.service.update()).rejects.toThrow('registry write failed');
    expect(harness.hostHead()).toBe(A_HEAD);
    expect(harness.registry.settings.localCheckout.session.snapshotSha).toBe(A_HEAD);
  });

  test('Return recovers a clean checkout that was switched outside DroneHub', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');
    harness.setHostHead('9'.repeat(40));

    const returned = await harness.service.returnToOriginal();
    expect(returned.session).toBeNull();
    expect(harness.hostHead()).toBe(RETURN_SHA);
  });

  test('Return does not discard commits made in the local checkout', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');
    harness.setHostHead('9'.repeat(40));
    harness.setHostDescendsFromSnapshot(true);

    await expect(harness.service.returnToOriginal()).rejects.toMatchObject({
      code: 'local_checkout_has_commits',
    });
    expect(harness.hostHead()).toBe('9'.repeat(40));
  });

  test('Return stops when Git cannot determine commit ancestry', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');
    harness.setHostHead('9'.repeat(40));
    harness.setMergeBaseCode(128);

    await expect(harness.service.returnToOriginal()).rejects.toMatchObject({
      code: 'local_git_check_failed',
    });
    expect(harness.hostHead()).toBe('9'.repeat(40));
  });

  test('rejects an imported commit that does not match the captured snapshot', async () => {
    const harness = createHarness();
    harness.setImportedShaOverride('9'.repeat(40));

    await expect(harness.service.useLocally('a')).rejects.toMatchObject({
      code: 'snapshot_import_mismatch',
    });
    expect(harness.hostHead()).toBe(RETURN_SHA);
  });

  test('rejects invalid Auto-updates values', async () => {
    const harness = createHarness();

    await expect(harness.service.setAutoUpdates('everything')).rejects.toMatchObject({
      code: 'invalid_auto_updates',
      status: 400,
    });
  });

  test('does not enable Auto-updates without an active local drone', async () => {
    const harness = createHarness();

    await expect(harness.service.setAutoUpdates('all')).rejects.toMatchObject({
      code: 'local_checkout_inactive',
    });
    expect(harness.registry.settings.localCheckout).toBeUndefined();
  });

  test('requires the selected drone when preparing Apply', async () => {
    const harness = createHarness();

    await expect(harness.service.prepareApply('')).rejects.toMatchObject({
      code: 'missing_drone_id',
      status: 400,
    });
  });

  test('cancels stale queued work before it can change the host', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');

    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    harness.delayCaptureUntil(captureGate);

    const staleUpdate = harness.service.update({ includeDirty: true });
    const switchDrone = harness.service.useLocally('b');
    releaseCapture();

    await expect(staleUpdate).rejects.toMatchObject<Partial<LocalCheckoutError>>({
      code: 'local_operation_cancelled',
    });
    const switched = await switchDrone;
    expect(switched.session.droneId).toBe('b');
    expect(harness.hostHead()).toBe(B_HEAD);
  });

  test('promotes the exact working snapshot before apply and restores the branch', async () => {
    const harness = createHarness();
    await harness.service.useLocally('a');
    await harness.service.setAutoUpdates('all');
    await harness.service.update();

    const prepared = await harness.service.prepareApply('a');
    expect(prepared.expectedHeadSha).toBe(PROMOTED_HEAD);
    expect(prepared.session).toBeNull();
    expect(prepared.autoUpdates).toBe('off');
    expect(harness.hostHead()).toBe(RETURN_SHA);
  });
});
