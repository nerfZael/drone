const assert = require('node:assert/strict');
const { test } = require('node:test');

const BetterSqlite3 = require('better-sqlite3');
const {
  SqliteChangeRequestRepository,
} = require('../../dist/hub/change-requests/change-request-repository.js');
const { HubOutboxRepository } = require('../../dist/host/hub-outbox.js');

function memoryHubDatabase() {
  const connection = new BetterSqlite3(':memory:');
  let queue = Promise.resolve();
  return {
    database: {
      path: ':memory:',
      openedAt: new Date().toISOString(),
      read(operation) {
        return operation(connection);
      },
      writeTransaction(_label, operation) {
        const write = queue.then(() =>
          connection.transaction(() => operation(connection)).immediate(),
        );
        queue = write.then(
          () => undefined,
          () => undefined,
        );
        return write;
      },
      diagnostics() {
        throw new Error('not needed');
      },
    },
    close: () => connection.close(),
  };
}

test('change request repository persists and atomically updates GitHub mirror metadata', async () => {
  const memory = memoryHubDatabase();
  try {
    const repository = new SqliteChangeRequestRepository(memory.database);
    const inserted = await repository.insert({
      id: 'request-1',
      status: 'open',
      droneId: 'drone-1',
      droneName: 'Test drone',
      chatId: 'chat-1',
      chatName: 'default',
      repoRoot: '/tmp/repo',
      baseBranch: 'main',
      baseSha: '1'.repeat(40),
      destinationBranch: 'dev',
      snapshotRef: 'refs/drone/change-requests/request-1/snapshot',
      snapshotSha: '2'.repeat(40),
      sourceHeadSha: '2'.repeat(40),
      revision: 1,
      title: 'Test request',
      description: '',
      createdBy: { kind: 'user', id: null, label: 'Test user' },
      mergedBy: null,
      mergeCommitSha: null,
      lastError: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      mergedAt: null,
      closedAt: null,
      githubMirror: null,
    });
    assert.equal(inserted.githubMirror, null);
    assert.equal(repository.getByNumber(inserted.number).id, inserted.id);
    assert.equal(repository.getByNumber(inserted.number + 1), null);

    const mirrored = await repository.update(inserted.id, {
      githubMirror: {
        owner: 'example',
        repo: 'repo',
        pullNumber: 42,
        htmlUrl: 'https://github.com/example/repo/pull/42',
        headBranch: 'drone/change-requests/1-request',
        headSha: '2'.repeat(40),
        baseBranch: 'dev',
        state: 'open',
        autoUpdate: true,
        branchOwnedByDroneHub: true,
        syncedRevision: 1,
        syncedNativeUpdatedAt: inserted.updatedAt,
        mergeCommitSha: null,
        lastError: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    });

    const stored = repository.get(inserted.id);
    assert.equal(stored.githubMirror.pullNumber, 42);
    assert.equal(stored.githubMirror.autoUpdate, true);
    assert.equal(stored.githubMirror.branchOwnedByDroneHub, true);

    await Promise.all([
      repository.update(inserted.id, (current) => ({
        githubMirror: { ...current.githubMirror, autoUpdate: false },
      })),
      repository.update(inserted.id, (current) => ({
        githubMirror: { ...current.githubMirror, lastError: 'sync failed' },
      })),
    ]);

    const updated = repository.get(inserted.id);
    assert.equal(updated.githubMirror.autoUpdate, false);
    assert.equal(updated.githubMirror.lastError, 'sync failed');
    assert.equal(updated.stateVersion, mirrored.stateVersion + 2);
    const events = new HubOutboxRepository(memory.database).list({ status: 'pending' });
    assert.deepEqual(events.at(-1).payload.request, updated);
    assert.ok(events.every((event) => event.topic === 'change-request.events'));
  } finally {
    memory.close();
  }
});
