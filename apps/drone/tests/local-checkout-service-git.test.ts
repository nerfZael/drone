import { afterEach, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalCheckoutService } from '../src/hub/local-checkout-service';

type RunResult = { code: number; stdout: string; stderr: string };

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function run(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runOrThrow(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  return await runOrThrow('git', ['-C', repoRoot, ...args]);
}

async function createGitHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-local-checkout-git-'));
  tempRoots.push(root);
  const hostRepo = path.join(root, 'host');
  const containerRepo = path.join(root, 'container');
  const exportsRoot = path.join(root, 'exports');
  await fs.mkdir(hostRepo, { recursive: true });
  await git(hostRepo, ['init', '--quiet']);
  await git(hostRepo, ['config', 'user.name', 'Test']);
  await git(hostRepo, ['config', 'user.email', 'test@example.com']);
  await fs.writeFile(
    path.join(hostRepo, '.gitignore'),
    ['.env', 'node_modules/', ''].join('\n'),
  );
  await fs.writeFile(path.join(hostRepo, 'app.txt'), 'host base\n');
  await git(hostRepo, ['add', '.gitignore', 'app.txt']);
  await git(hostRepo, ['commit', '--quiet', '-m', 'base']);
  const baseSha = (await git(hostRepo, ['rev-parse', 'HEAD'])).trim();

  await runOrThrow('git', ['clone', '--quiet', hostRepo, containerRepo]);
  await git(containerRepo, ['config', 'user.name', 'Test']);
  await git(containerRepo, ['config', 'user.email', 'test@example.com']);
  await fs.writeFile(path.join(containerRepo, 'app.txt'), 'container commit\n');
  await git(containerRepo, ['add', 'app.txt']);
  await git(containerRepo, ['commit', '--quiet', '-m', 'container change']);
  await git(containerRepo, ['config', 'dvm.baseSha', baseSha]);
  const containerHead = (await git(containerRepo, ['rev-parse', 'HEAD'])).trim();

  await fs.writeFile(path.join(hostRepo, '.env'), 'SECRET=preserved\n');
  await fs.mkdir(path.join(hostRepo, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(hostRepo, 'node_modules', 'cache.txt'), 'keep me\n');

  const registry: any = {
    settings: {},
    drones: {
      alpha: {
        id: 'alpha',
        name: 'Alpha',
        runtime: 'container',
        repoPath: hostRepo,
        containerName: 'alpha',
        repo: { dest: containerRepo },
      },
    },
  };
  let exportNumber = 0;
  let timestamp = 0;

  const service = new LocalCheckoutService({
    loadRegistry: async () => registry,
    updateRegistry: async (mutator: (value: any) => any) => await mutator(registry),
    findDroneIdByRef: (_value: any, ref: string) =>
      registry.drones[ref] ? { kind: 'real', id: ref } : null,
    droneRuntime: () => 'container',
    droneRootPath: () => exportsRoot,
    gitTopLevel: async (repoPath: string) =>
      (await git(repoPath, ['rev-parse', '--show-toplevel'])).trim(),
    gitIsClean: async (repoRoot: string) =>
      (await git(repoRoot, ['status', '--porcelain'])).trim().length === 0,
    gitResolveCommitSha: async (repoRoot: string, ref: string) => {
      const result = await run('git', [
        '-C',
        repoRoot,
        'rev-parse',
        '--verify',
        `${ref}^{commit}`,
      ]);
      return result.code === 0 ? result.stdout.trim() : null;
    },
    updateHostRef: async ({ repoRoot, refName, target }: any) => {
      await git(repoRoot, ['update-ref', refName, target]);
    },
    importBundleHeadToHostRef: async ({ repoRoot, bundlePath, refName }: any) => {
      const heads = await runOrThrow('git', ['bundle', 'list-heads', bundlePath]);
      const sourceRef = heads.trim().split(/\s+/)[1];
      await git(repoRoot, ['fetch', '--quiet', '--force', bundlePath, `${sourceRef}:${refName}`]);
      return (await git(repoRoot, ['rev-parse', refName])).trim();
    },
    dvmExec: async (_container: string, command: string, args: string[]) =>
      await run(command, args),
    dvmRepoExport: async ({ outDir, base, head, full }: any) => {
      await fs.mkdir(outDir, { recursive: true });
      const exportedPath = path.join(outDir, `snapshot-${++exportNumber}.bundle`);
      const revision = full ? head : `${base}..${head}`;
      await git(containerRepo, ['bundle', 'create', exportedPath, revision]);
      return { exportedPath };
    },
    runHostCommand: async (command: string, args: string[], options?: any) =>
      await run(command, args, options),
    nowIso: () => new Date(++timestamp * 1_000).toISOString(),
  } as any);

  return {
    service,
    hostRepo,
    containerRepo,
    containerHead,
  };
}

describe('LocalCheckoutService with real Git repositories', () => {
  test('preserves ignored host files across committed and working-tree snapshots', async () => {
    const harness = await createGitHarness();

    await harness.service.useLocally('alpha');
    expect((await fs.readFile(path.join(harness.hostRepo, 'app.txt'), 'utf8')).trim()).toBe(
      'container commit',
    );
    expect((await fs.readFile(path.join(harness.hostRepo, '.env'), 'utf8')).trim()).toBe(
      'SECRET=preserved',
    );
    expect(
      (await fs.readFile(path.join(harness.hostRepo, 'node_modules', 'cache.txt'), 'utf8')).trim(),
    ).toBe('keep me');

    await fs.writeFile(path.join(harness.containerRepo, 'app.txt'), 'working change\n');
    await fs.writeFile(path.join(harness.containerRepo, 'new.txt'), 'untracked change\n');
    await harness.service.setAutoUpdates('all');
    await harness.service.update();
    expect((await fs.readFile(path.join(harness.hostRepo, 'app.txt'), 'utf8')).trim()).toBe(
      'working change',
    );
    expect((await fs.readFile(path.join(harness.hostRepo, 'new.txt'), 'utf8')).trim()).toBe(
      'untracked change',
    );
    expect((await fs.readFile(path.join(harness.hostRepo, '.env'), 'utf8')).trim()).toBe(
      'SECRET=preserved',
    );

    await harness.service.setAutoUpdates('commits');
    await harness.service.update();
    expect((await git(harness.hostRepo, ['rev-parse', 'HEAD'])).trim()).toBe(
      harness.containerHead,
    );
    expect(await fs.stat(path.join(harness.hostRepo, 'new.txt')).catch(() => null)).toBeNull();

    await harness.service.returnToOriginal();
    expect((await fs.readFile(path.join(harness.hostRepo, 'app.txt'), 'utf8')).trim()).toBe(
      'host base',
    );
    expect((await fs.readFile(path.join(harness.hostRepo, '.env'), 'utf8')).trim()).toBe(
      'SECRET=preserved',
    );
  });

  test('promotes the exact working tree and restores the host before Apply', async () => {
    const harness = await createGitHarness();
    await harness.service.useLocally('alpha');
    await fs.writeFile(path.join(harness.containerRepo, 'app.txt'), 'tested working tree\n');
    await fs.writeFile(path.join(harness.containerRepo, 'new.txt'), 'tested untracked file\n');
    await harness.service.setAutoUpdates('all');
    const updated = await harness.service.update();
    const testedTree = (await git(harness.hostRepo, ['rev-parse', 'HEAD^{tree}'])).trim();
    expect(updated.session.snapshotKind).toBe('working-tree');

    const prepared = await harness.service.prepareApply('alpha');
    expect(prepared.session).toBeNull();
    expect(prepared.autoUpdates).toBe('off');
    expect((await git(harness.containerRepo, ['rev-parse', 'HEAD'])).trim()).toBe(
      prepared.expectedHeadSha,
    );
    expect((await git(harness.containerRepo, ['rev-parse', 'HEAD^{tree}'])).trim()).toBe(
      testedTree,
    );
    expect((await git(harness.containerRepo, ['status', '--porcelain'])).trim()).toBe('');
    expect((await fs.readFile(path.join(harness.hostRepo, 'app.txt'), 'utf8')).trim()).toBe(
      'host base',
    );
    expect((await fs.readFile(path.join(harness.hostRepo, '.env'), 'utf8')).trim()).toBe(
      'SECRET=preserved',
    );
  });
});
