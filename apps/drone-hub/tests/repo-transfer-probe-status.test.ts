import { describe, expect, test } from 'bun:test';
import { normalizeRepoTransferProbeStatus } from '../src/droneHub/app/repo-transfer-probe-status';

describe('repo transfer probe status', () => {
  test('maps no-change probes to a disabled nothing-to-sync state', () => {
    expect(
      normalizeRepoTransferProbeStatus({
        ok: true,
        status: 200,
        data: { ok: true, mode: 'no-changes', noChanges: true },
      }),
    ).toEqual({
      code: null,
      detail: 'Already up to date with this drone.',
      kind: 'nothing-to-sync',
      label: 'Nothing to sync',
      syncAllowed: false,
    });
  });

  test('maps dirty source probes to a syncable confirmation state', () => {
    expect(
      normalizeRepoTransferProbeStatus({
        ok: false,
        status: 409,
        data: { ok: false, code: 'source_drone_dirty', dirtyFileCount: 2 },
      }),
    ).toEqual({
      code: 'source_drone_dirty',
      detail: 'Source drone has 2 files. Sync can snapshot them first after confirmation.',
      kind: 'sync-with-confirmation',
      label: 'Needs confirmation',
      syncAllowed: true,
    });
  });

  test('maps unexpected failures to a blocked state', () => {
    expect(
      normalizeRepoTransferProbeStatus({
        ok: false,
        status: 409,
        data: { ok: false, code: 'repo_mismatch', error: 'source and target drones are not attached to the same host repo' },
      }),
    ).toEqual({
      code: 'repo_mismatch',
      detail: 'source and target drones are not attached to the same host repo',
      kind: 'blocked',
      label: 'Sync unavailable',
      syncAllowed: false,
    });
  });
});
