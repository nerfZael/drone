const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const {
  AGENT_RUN_DIFF_FILE_PATCH_MAX_BYTES,
  AGENT_RUN_DIFF_TOTAL_PATCH_MAX_BYTES,
  cleanupAgentRunDiffArtifacts,
  listAgentRunDiffFiles,
  persistAgentRunDiffArtifact,
  readAgentRunFileDiff,
  resetAgentRunDiffArtifactsForTests,
} = require('../../dist/hub/agent-run-diff-artifacts.js');
const {
  captureAssistantArtifactRunFileChangesBaseline,
  captureDroneRunFileChangesBaseline,
  finalizeAssistantArtifactRunFileChanges,
  finalizeDroneRunFileChanges,
} = require('../../dist/hub/run-file-changes.js');
const { runAssistantArtifactAction } = require('../../dist/hub/assistant-artifacts.js');
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
  fs.writeFileSync(path.join(repoPath, 'deleted.txt'), 'delete me\n');
  fs.writeFileSync(path.join(repoPath, 'renamed.txt'), 'rename me\n');
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
      counts: { changed: 1, additions: 1, deletions: 1 },
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
    const listed = await listAgentRunDiffFiles({ artifactId, offset: 0, limit: 1 });
    assert.deepEqual(listed.entries, [
      { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 },
    ]);
    assert.equal(listed.total, 1);
    assert.equal(listed.nextOffset, null);
  });

  test('pages complete metadata while retaining patches only for the bounded prefix', async () => {
    useDroneDataDir();
    const entries = ['a.ts', 'b.ts', 'c.ts'].map((filePath, index) => ({
      path: filePath,
      status: 'modified',
      additions: index + 1,
      deletions: index,
    }));
    let patchReads = 0;
    const artifactId = await persistAgentRunDiffArtifact({
      owner: { droneId: 'drone-1', chatName: 'default' },
      targetId: 'drone:drone-1',
      label: 'Drone 1',
      counts: { changed: 3, additions: 6, deletions: 3 },
      entries,
      patchEntryLimit: 1,
      readPatch: async (entry) => {
        patchReads += 1;
        return `diff --git a/${entry.path} b/${entry.path}\n`;
      },
    });

    const firstPage = await listAgentRunDiffFiles({ artifactId, offset: 0, limit: 2 });
    const secondPage = await listAgentRunDiffFiles({
      artifactId,
      offset: firstPage.nextOffset,
      limit: 2,
    });
    assert.deepEqual(firstPage.entries, entries.slice(0, 2));
    assert.deepEqual(secondPage.entries, entries.slice(2));
    assert.equal(firstPage.nextOffset, 2);
    assert.equal(secondPage.nextOffset, null);
    assert.equal(patchReads, 1);
    await assert.rejects(
      readAgentRunFileDiff({ artifactId, path: 'b.ts' }),
      (error) => error.statusCode === 413 && /many files/.test(error.message),
    );
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
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'new file\n');
    fs.unlinkSync(path.join(repoPath, 'deleted.txt'));
    fs.renameSync(path.join(repoPath, 'renamed.txt'), path.join(repoPath, 'moved.txt'));

    const summary = await finalizeDroneRunFileChanges({ baseline, drone });
    const artifactId = summary.workspaces[0].diffArtifactId;
    assert.ok(artifactId);
    const historical = await readAgentRunFileDiff({
      artifactId,
      path: 'src/existing.ts',
    });
    assert.match(historical.patch, /\+added by run/);
    assert.doesNotMatch(historical.patch, /^\+dirty before run$/m);
    assert.match(
      (await readAgentRunFileDiff({ artifactId, path: 'new.txt' })).patch,
      /new file mode/,
    );
    assert.match(
      (await readAgentRunFileDiff({ artifactId, path: 'deleted.txt' })).patch,
      /deleted file mode/,
    );
    assert.match(
      (await readAgentRunFileDiff({ artifactId, path: 'moved.txt' })).patch,
      /rename from renamed\.txt[\s\S]*rename to moved\.txt/,
    );
    assert.deepEqual(historical.owner, {
      droneId: 'host-1',
      chatName: 'default',
      promptId: 'prompt-1',
    });
  });

  test('bounds Git patch output before storing a large run diff', async () => {
    useDroneDataDir();
    const repoPath = createRepository();
    const largePath = path.join(repoPath, 'large.txt');
    fs.writeFileSync(largePath, 'before\n');
    git(repoPath, 'add', 'large.txt');
    git(repoPath, 'commit', '--quiet', '-m', 'add large fixture');
    const drone = { runtime: 'host', repoAttached: true, repoPath, name: 'Host drone' };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-large', drone });
    fs.writeFileSync(largePath, `${'x'.repeat(AGENT_RUN_DIFF_TOTAL_PATCH_MAX_BYTES + 1024)}\n`);

    const summary = await finalizeDroneRunFileChanges({ baseline, drone });
    const artifactId = summary.workspaces[0].diffArtifactId;
    assert.ok(artifactId);
    const historical = await readAgentRunFileDiff({ artifactId, path: 'large.txt' });

    assert.equal(historical.truncated, true);
    assert.ok(
      Buffer.byteLength(historical.patch, 'utf8') <= AGENT_RUN_DIFF_FILE_PATCH_MAX_BYTES + 64,
    );
    assert.match(historical.patch, /diff truncated/);
  });

  test('captures native assistant artifact workspace changes', async () => {
    useDroneDataDir();
    await runAssistantArtifactAction('thread-1', {
      action: 'write',
      path: 'notes/existing.md',
      content: 'before\n',
      mode: 'create',
    });
    const baseline = await captureAssistantArtifactRunFileChangesBaseline({
      threadId: 'thread-1',
      turnId: 'turn-1',
    });

    await runAssistantArtifactAction('thread-1', {
      action: 'write',
      path: 'notes/existing.md',
      content: 'after\n',
      mode: 'overwrite',
    });
    await runAssistantArtifactAction('thread-1', {
      action: 'write',
      path: 'report.md',
      content: '# Report\n',
      mode: 'create',
    });

    const workspace = await finalizeAssistantArtifactRunFileChanges({ baseline });
    assert.deepEqual(
      {
        targetId: workspace.targetId,
        droneId: workspace.droneId,
        label: workspace.label,
        counts: workspace.counts,
        entries: workspace.previewEntries,
      },
      {
        targetId: 'artifacts:thread-1',
        droneId: undefined,
        label: 'Artifacts',
        counts: { changed: 2, additions: 2, deletions: 1 },
        entries: [
          { path: 'notes/existing.md', status: 'modified', additions: 1, deletions: 1 },
          { path: 'report.md', status: 'added', additions: 1, deletions: 0 },
        ],
      },
    );
    assert.ok(workspace.diffArtifactId);
    const historical = await readAgentRunFileDiff({
      artifactId: workspace.diffArtifactId,
      path: 'notes/existing.md',
    });
    assert.match(historical.patch, /-before[\s\S]*\+after/);
    assert.deepEqual(historical.owner, { threadId: 'thread-1', turnId: 'turn-1' });
    assert.equal(fs.existsSync(baseline.temporaryGitDir), false);
  });

  test('expires old artifacts and removes their files', async () => {
    const dataDir = useDroneDataDir();
    const artifactId = await persistAgentRunDiffArtifact({
      owner: { droneId: 'drone-1', threadId: 'thread-1', turnId: 'turn-1' },
      targetId: 'drone:drone-1',
      label: 'Drone 1',
      counts: { changed: 1, additions: 1, deletions: 0 },
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

  test('removes abandoned artifact directories after a safety grace period', async () => {
    const dataDir = useDroneDataDir();
    const root = path.join(dataDir, 'agent-run-diffs');
    const orphan = path.join(root, '018fdce7-6e20-7d31-a78c-3f95d665cc72');
    const temporary = path.join(
      root,
      '.018fdce7-6e20-7d31-a78c-3f95d665cc73.018fdce7-6e20-7d31-a78c-3f95d665cc74.tmp',
    );
    const unrelated = path.join(root, 'keep-me');
    for (const directory of [orphan, temporary, unrelated]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.utimesSync(directory, new Date(0), new Date(0));
    }

    await cleanupAgentRunDiffArtifacts({ nowMs: Date.now(), force: true });

    assert.equal(fs.existsSync(orphan), false);
    assert.equal(fs.existsSync(temporary), false);
    assert.equal(fs.existsSync(unrelated), true);
  });
});
