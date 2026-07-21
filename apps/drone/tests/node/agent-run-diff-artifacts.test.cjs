const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const {
  cleanupAgentRunDiffArtifacts,
  persistAgentRunDiffArtifact,
  readAgentRunFileDiff,
  resetAgentRunDiffArtifactsForTests,
} = require('../../dist/hub/agent-run-diff-artifacts.js');
const {
  captureDroneRunFileChangesBaseline,
  finalizeDroneRunFileChanges,
} = require('../../dist/hub/run-file-changes.js');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const tempRoots = [];

function tempDirectory(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `agent-run-diffs-${label}-`));
  tempRoots.push(directory);
  return directory;
}

function useDroneDataDir() {
  const dataDir = path.join(tempDirectory('data'), 'drone-data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
  resetAgentRunDiffArtifactsForTests();
  return dataDir;
}

function git(repoPath, ...args) {
  const result = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function createRepository() {
  const repoPath = tempDirectory('repo');
  git(repoPath, 'init', '--quiet');
  git(repoPath, 'config', 'user.email', 'test@example.com');
  git(repoPath, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repoPath, 'src'));
  fs.writeFileSync(path.join(repoPath, 'src', 'existing.ts'), 'one\ntwo\n');
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '--quiet', '-m', 'base');
  return repoPath;
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  resetAgentRunDiffArtifactsForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('agent run diff artifacts', () => {
  test('stores compressed patches outside the transcript and reads one file on demand', async () => {
    const dataDir = useDroneDataDir();
    const patch =
      'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
    const artifactId = await persistAgentRunDiffArtifact({
      owner: { droneId: 'drone-1', chatName: 'default', promptId: 'prompt-1' },
      targetId: 'drone:drone-1',
      label: 'Drone 1',
      entries: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 }],
      readPatch: async () => patch,
    });

    assert.ok(artifactId);
    const artifactDir = path.join(dataDir, 'agent-run-diffs', artifactId);
    assert.equal(fs.existsSync(path.join(artifactDir, '0000.patch.gz')), true);
    assert.equal(
      fs.readFileSync(path.join(artifactDir, 'manifest.json'), 'utf8').includes(patch),
      false,
    );
    const loaded = await readAgentRunFileDiff({ artifactId, path: 'src/a.ts' });
    assert.equal(loaded.artifactId, artifactId);
    assert.equal(loaded.path, 'src/a.ts');
    assert.equal(loaded.patch, patch);
    assert.equal(loaded.truncated, false);
    assert.ok(Date.parse(loaded.createdAt));
    assert.deepEqual(loaded.owner, {
      droneId: 'drone-1',
      chatName: 'default',
      promptId: 'prompt-1',
    });
  });

  test('captures only changes made during the agent run', async () => {
    useDroneDataDir();
    const repoPath = createRepository();
    fs.appendFileSync(path.join(repoPath, 'src', 'existing.ts'), 'dirty before run\n');
    const drone = { runtime: 'host', repoAttached: true, repoPath, name: 'Host drone' };
    const baseline = await captureDroneRunFileChangesBaseline({
      droneId: 'host-1',
      drone,
      owner: { chatName: 'default', promptId: 'prompt-1' },
    });
    fs.appendFileSync(path.join(repoPath, 'src', 'existing.ts'), 'added by run\n');

    const summary = await finalizeDroneRunFileChanges({ baseline, drone });
    const artifactId = summary.workspaces[0].diffArtifactId;
    assert.ok(artifactId);
    const historical = await readAgentRunFileDiff({
      artifactId,
      path: 'src/existing.ts',
    });
    assert.match(historical.patch, /\+added by run/);
    assert.doesNotMatch(historical.patch, /^\+dirty before run$/m);
    assert.deepEqual(historical.owner, {
      droneId: 'host-1',
      chatName: 'default',
      promptId: 'prompt-1',
    });
  });

  test('expires old artifacts and removes their files', async () => {
    const dataDir = useDroneDataDir();
    const artifactId = await persistAgentRunDiffArtifact({
      owner: { droneId: 'drone-1', threadId: 'thread-1', turnId: 'turn-1' },
      targetId: 'drone:drone-1',
      label: 'Drone 1',
      entries: [{ path: 'new.txt', status: 'added', additions: 1, deletions: 0 }],
      readPatch: async () => '+new\n',
    });

    assert.deepEqual(
      await cleanupAgentRunDiffArtifacts({
        nowMs: Date.now() + 100 * 24 * 60 * 60 * 1000,
        force: true,
      }),
      { removed: 1 },
    );
    assert.equal(fs.existsSync(path.join(dataDir, 'agent-run-diffs', artifactId)), false);
    await assert.rejects(
      readAgentRunFileDiff({ artifactId, path: 'new.txt' }),
      (error) => error.statusCode === 404,
    );
  });
});
