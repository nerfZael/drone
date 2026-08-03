import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFilesystemRuntime } from '../src/hub/filesystem-runtime';
import { bashQuote } from '../src/hub/hub-format';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function quickOpenFilesystemRuntime() {
  const unused = () => {
    throw new Error('Unexpected filesystem runtime dependency call.');
  };
  return createFilesystemRuntime({
    NON_REPO_HOME_CWD: '/tmp/drone-quick-open-home',
    bashQuote,
    defaultDroneHomeCwd: unused,
    droneRepoPathInContainer: unused,
    droneRuntime: unused,
    dvmCopyToContainer: unused,
    dvmExec: unused,
    extensionLower: (filePath: string) => path.extname(filePath).slice(1).toLowerCase(),
    isLikelyImagePath: () => false,
    isLikelyVideoPath: () => false,
    isRepoAttachedDrone: () => false,
    json: unused,
    looksLikeMissingContainerError: () => false,
    normalizeContainerPath: (value: string) => value,
    normalizeDroneCwdForRuntime: unused,
    readJsonBody: unused,
    resolveEffectiveFilesystemSettings: unused,
    runHostCommand: unused,
    sortFsEntries: unused,
    withLockedDroneContainer: unused,
    withReadonlyDroneContainer: unused,
  });
}

describe('filesystem Quick Open search', () => {
  test('returns ordered-subsequence filename and path candidates', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-quick-open-'));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, 'sidebar', 'drone', 'tree'), { recursive: true });
    writeFileSync(path.join(root, 'SidebarDroneTreeList.tsx'), '');
    writeFileSync(path.join(root, 'sidebar', 'drone', 'tree', 'list.ts'), '');
    writeFileSync(path.join(root, 'sdtl.ts'), '');
    writeFileSync(path.join(root, 'unrelated.ts'), '');

    const runtime = quickOpenFilesystemRuntime();
    const script = runtime.buildFsSearchScript({ root, query: 'sdtl', limit: 20, pathFlavor: 'host' });
    const output = execFileSync('bash', ['-lc', script], { encoding: 'utf8' });
    const parsed = runtime.parseFsSearchOutput(output, root);

    const relativePaths = parsed.entries.map((entry) => entry.relativePath);
    expect(relativePaths).toHaveLength(3);
    expect(relativePaths).toContain('SidebarDroneTreeList.tsx');
    expect(relativePaths).toContain('sidebar/drone/tree/list.ts');
    expect(relativePaths).toContain('sdtl.ts');

    const firstOutput = execFileSync(
      'bash',
      ['-lc', runtime.buildFsSearchScript({ root, query: 'sdtl', limit: 1, pathFlavor: 'host' })],
      { encoding: 'utf8' },
    );
    expect(runtime.parseFsSearchOutput(firstOutput, root).entries[0]?.relativePath).toBe('sdtl.ts');
  });
});
