#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ContainerManager } from './container/manager';
import { ConfigLoader } from './config/loader';
import { ContainerConfig, PortMapping } from './docker/client';
import { BaseConfigManager } from './config/base';
import { dvmRootPath } from './hostPaths';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as os from 'os';
import * as crypto from 'crypto';

const program = new Command();
const manager = new ContainerManager();
const baseConfig = new BaseConfigManager();

// Allow piping output (e.g. to `head`) without crashing on broken pipe.
process.stdout.on('error', (err: any) => {
  if (err?.code === 'EPIPE') process.exit(0);
});

type ActionHandler<TArgs extends unknown[] = unknown[]> = (
  this: Command,
  ...args: TArgs
) => unknown | Promise<unknown>;

function safeAction<TArgs extends unknown[]>(fn: ActionHandler<TArgs>) {
  return async function (this: Command, ...args: TArgs): Promise<void> {
    try {
      await fn.apply(this, args);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  };
}

function parsePortRangeOrNumber(input: string): number[] {
  const s = input.trim();
  if (!s) return [];
  if (s.includes('-')) {
    const [aRaw, bRaw] = s.split('-', 2);
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`Invalid port range: ${input}`);
    }
    if (a <= 0 || b <= 0 || a > 65535 || b > 65535) {
      throw new Error(`Port out of range (1-65535): ${input}`);
    }
    if (b < a) {
      throw new Error(`Invalid port range (end < start): ${input}`);
    }
    const out: number[] = [];
    for (let p = a; p <= b; p++) out.push(p);
    return out;
  }

  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid port: ${input}`);
  }
  return [n];
}

function parsePortsSpec(raw: string): PortMapping[] {
  const token = raw.trim();
  if (!token) return [];

  if (!token.includes(':')) {
    // Container port(s) only; host port auto-allocated.
    return parsePortRangeOrNumber(token).map((containerPort) => ({ containerPort }));
  }

  const [hostRaw, containerRaw] = token.split(':', 2);
  const hostPorts = parsePortRangeOrNumber(hostRaw);
  const containerPorts = parsePortRangeOrNumber(containerRaw);

  if (hostPorts.length !== containerPorts.length) {
    throw new Error(
      `Port range mapping must be same length (got ${hostRaw} -> ${containerRaw})`
    );
  }

  return hostPorts.map((hostPort, i) => ({
    hostPort,
    containerPort: containerPorts[i]!,
  }));
}

function parsePortsList(rawPorts: string[]): PortMapping[] {
  const ports: PortMapping[] = [];
  const pieces = rawPorts
    .flatMap((p) => String(p).split(','))
    .map((p) => p.trim())
    .filter(Boolean);

  for (const piece of pieces) {
    ports.push(...parsePortsSpec(piece));
  }

  return ports;
}

function normalizeContainerPath(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '/';
  return s.startsWith('/') ? s : `/${s}`;
}

function encodeRemotePath(p: string): string {
  // Keep "/" separators while escaping segments.
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function openEditorOrShell(options: {
  editorCommand: 'code' | 'cursor';
  containerName: string;
  cwd?: string;
  forceShell?: boolean;
}): Promise<void> {
  const name = options.containerName;
  const cwd = normalizeContainerPath(options.cwd || '/');

  // Ensure container is running.
  await manager.startContainer(name);

  if (options.forceShell) {
    await manager.docker.execInteractive(name, [
      'bash',
      '-lc',
      `cd ${JSON.stringify(cwd)} && exec /bin/bash`,
    ]);
    return;
  }

  const details = await manager.docker.getContainerDetails(name);
  if (!details) {
    throw new Error(`Container ${name} not found`);
  }

  const uri = `vscode-remote://attached-container+${details.id}${encodeRemotePath(cwd)}`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(options.editorCommand, ['--folder-uri', uri], { stdio: 'inherit' });
    proc.on('error', async (err: any) => {
      // Fallback: if the editor isn't installed, drop into an interactive shell.
      if (err?.code === 'ENOENT') {
        try {
          await manager.docker.execInteractive(name, ['bash', '-lc', `cd ${JSON.stringify(cwd)} && exec /bin/bash`]);
          resolve();
          return;
        } catch (shellErr) {
          reject(shellErr);
          return;
        }
      }
      reject(err);
    });
    proc.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${options.editorCommand} exited with code ${code}`));
    });
  });
}

async function runLocal(cmd: string, args: string[], options?: { cwd?: string }): Promise<string> {
  const cwd = options?.cwd;
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    proc.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    proc.on('error', (err) => reject(err));
    proc.on('exit', (code) => {
      if (code === 0 || code === null) return resolve(stdout);
      const suffix = `${stdout}${stderr}`.trim();
      reject(
        new Error(
          `${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')} failed (exit ${code})${suffix ? `\n\n${suffix}` : ''}`
        )
      );
    });
  });
}

async function applyGitDiffRangeToWorkingTree(repoRoot: string, revRange: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const diff = spawn('git', ['-C', repoRoot, 'diff', '--binary', revRange], { stdio: ['ignore', 'pipe', 'pipe'] });
    const apply = spawn('git', ['-C', repoRoot, 'apply', '--whitespace=nowarn', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });

    let diffErr = '';
    let applyErr = '';
    let settled = false;
    let diffExit: number | null = null;
    let applyExit: number | null = null;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try {
        diff.kill();
      } catch {
        // ignore
      }
      try {
        apply.kill();
      } catch {
        // ignore
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    diff.stderr.on('data', (chunk) => (diffErr += chunk.toString('utf8')));
    apply.stderr.on('data', (chunk) => (applyErr += chunk.toString('utf8')));

    diff.on('error', fail);
    apply.on('error', fail);
    diff.stdout.pipe(apply.stdin);

    const maybeFinish = () => {
      if (settled) return;
      if (diffExit === null || applyExit === null) return;
      if (diffExit === 0 && applyExit === 0) {
        settled = true;
        resolve();
        return;
      }

      const details = [
        diffErr.trim() ? `git diff stderr:\n${diffErr.trim()}` : '',
        applyErr.trim() ? `git apply stderr:\n${applyErr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      settled = true;
      reject(
        new Error(
          `Failed applying git diff range ${JSON.stringify(revRange)} in ${repoRoot}${details ? `\n\n${details}` : ''}`
        )
      );
    };

    diff.on('close', (code) => {
      diffExit = typeof code === 'number' ? code : 1;
      maybeFinish();
    });
    apply.on('close', (code) => {
      applyExit = typeof code === 'number' ? code : 1;
      maybeFinish();
    });
  });
}

function safeSlug(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo';
}

type RepoStateV1 = {
  schemaVersion: 1;
  containerName?: string;
  containerDest?: string;
  baseBranch?: string;
  lastPatchesDir?: string;
};

function dvmHomeDir(): string {
  return dvmRootPath();
}

function dvmRepoStoreRoot(): string {
  return path.join(dvmHomeDir(), 'repo');
}

function repoKeyFromGitRoot(gitRoot: string): string {
  const slug = safeSlug(path.basename(gitRoot));
  const h = crypto.createHash('sha1').update(gitRoot).digest('hex');
  return `${slug}-${h}`;
}

async function hostGitRootFromPath(hostRepoPath: string): Promise<string> {
  const root = (await runLocal('git', ['-C', hostRepoPath, 'rev-parse', '--show-toplevel'])).trim();
  if (!root) throw new Error(`Could not determine git root for: ${hostRepoPath}`);
  return root;
}

async function hostCurrentBranchOrSha(hostRepoPath: string): Promise<string> {
  const branch = (
    await runLocal('git', ['-C', hostRepoPath, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(async () => '')
  ).trim();
  if (branch) return branch;
  return (await runLocal('git', ['-C', hostRepoPath, 'rev-parse', 'HEAD'])).trim();
}

async function hostBestRemoteUrl(hostRepoPath: string): Promise<string | null> {
  // Prefer origin for predictable behavior.
  const origin = (await runLocal('git', ['-C', hostRepoPath, 'remote', 'get-url', 'origin']).catch(() => '')).trim();
  if (origin) return origin;

  // Fall back to the first configured remote.
  const remotes = (await runLocal('git', ['-C', hostRepoPath, 'remote']).catch(() => ''))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  const first = remotes[0];
  if (!first) return null;

  const fallback = (await runLocal('git', ['-C', hostRepoPath, 'remote', 'get-url', first]).catch(() => '')).trim();
  return fallback || null;
}

async function loadRepoStateForHostPath(hostRepoPath: string): Promise<{
  gitRoot: string;
  statePath: string;
  exportsRoot: string;
  state: RepoStateV1;
}> {
  const gitRoot = await hostGitRootFromPath(hostRepoPath);
  const key = repoKeyFromGitRoot(gitRoot);
  const root = dvmRepoStoreRoot();
  const dir = path.join(root, key);
  const statePath = path.join(dir, 'state.json');
  const exportsRoot = path.join(dir, 'exports');

  let state: RepoStateV1 = { schemaVersion: 1 };
  try {
    const raw = await fs.promises.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schemaVersion === 1) {
      state = parsed as RepoStateV1;
    }
  } catch {
    // ignore missing/corrupt state; we'll overwrite on save
  }

  return { gitRoot, statePath, exportsRoot, state };
}

async function saveRepoState(statePath: string, state: RepoStateV1): Promise<void> {
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

async function buildContainerConfigFromCreateOptions(
  containerName: string,
  options: any
): Promise<{ config: ContainerConfig; usingConfiguredBaseImage: boolean }> {
  let config: ContainerConfig;

  // Determine which image to use (same logic as `dvm create`)
  let imageToUse = options.image;
  let usingConfiguredBaseImage = false;
  if (!imageToUse) {
    if (options.base) {
      const base = await baseConfig.getBase();
      if (base?.image) {
        imageToUse = base.image;
        usingConfiguredBaseImage = true;
        console.log(chalk.blue(`Using base container image: ${base.image}`));
      } else {
        imageToUse = 'ubuntu:latest';
      }
    } else {
      imageToUse = 'ubuntu:latest';
    }
  }

  if (options.config) {
    config = await ConfigLoader.loadFromFile(options.config);
    // Override name if provided
    config.name = containerName;
    // Override network if passed explicitly
    if (options.network) {
      config.network = String(options.network);
    }
    // Override image if base is set and not explicitly provided in config
    if (!options.image && !(config as any).image && options.base) {
      const base = await baseConfig.getBase();
      if (base?.image) {
        config.image = base.image;
        usingConfiguredBaseImage = true;
      }
    } else if (options.image) {
      config.image = options.image;
    }
  } else {
    config = ConfigLoader.createDefaultConfig(containerName, imageToUse);

    if (options.network) {
      config.network = String(options.network);
    }

    // Parse ports
    if (options.ports) {
      config.ports = parsePortsList([options.ports]);
    }

    // Parse environment variables
    if (options.env) {
      config.environment = String(options.env)
        .split(',')
        .map((e: string) => e.trim())
        .filter(Boolean);
    }

    // Parse volumes
    if (options.volume) {
      config.volumes = String(options.volume)
        .split(',')
        .map((v: string) => v.trim())
        .filter(Boolean)
        .map((v: string) => {
          const [source, target] = v.split(':');
          return { source, target, type: 'bind' as const };
        });
    }

    // Persistence
    if (options.noPersist) {
      config.persistence = { enabled: false, path: '/dvm-data' };
    }
  }

  if (config.network && options.createNetwork) {
    await manager.docker.ensureNetwork(config.network);
  }

  return { config, usingConfiguredBaseImage };
}

async function ensureContainerExistsOrCreate(
  containerName: string,
  options: any,
  createIfMissing: boolean
): Promise<void> {
  const exists = await manager.docker.containerExists(containerName);
  if (exists) {
    await manager.startContainer(containerName);
    return;
  }

  if (!createIfMissing) {
    throw new Error(`Container ${containerName} not found (create it first, or omit --no-create)`);
  }

  const { config, usingConfiguredBaseImage } = await buildContainerConfigFromCreateOptions(containerName, options);
  console.log(chalk.blue(`Container ${containerName} not found; creating it...`));
  await manager.createContainer(config, true, {
    // When creating from the configured base image, we want a pure clone:
    // no in-container package installs, no agent install scripts, etc.
    skipProvisioning: usingConfiguredBaseImage,
  });
}

async function repoExportFromContainer(options: {
  containerName: string;
  repoPathInContainer: string;
  outRoot: string;
  format: 'patches' | 'bundle' | 'diff';
  base?: string;
}): Promise<{ localOut: string; base: string }> {
  const containerName = options.containerName;
  const repoPath = normalizeContainerPath(options.repoPathInContainer);
  const outRoot = path.resolve(options.outRoot);
  const format = options.format;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  await fs.promises.mkdir(outRoot, { recursive: true });

  // Ensure container is running and has git.
  await manager.startContainer(containerName);
  await manager.ensureGit(containerName);

  // Determine base ref (explicit, or from repo marker).
  let base = options.base ? String(options.base) : '';
  if (!base) {
    // Prefer git config (untracked). Fall back to legacy repo-root marker if it exists.
    const readBase = await manager.docker.execCommand(containerName, [
      'bash',
      '-lc',
      [
        `cd ${JSON.stringify(repoPath)}`,
        `git config --get dvm.baseSha 2>/dev/null || true`,
        `if [ -z "$(git config --get dvm.baseSha 2>/dev/null || true)" ] && [ -f .dvm-base-sha ]; then cat .dvm-base-sha; fi`,
      ].join('\n'),
    ]);
    base = readBase
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0] || '';
  }
  if (!base) {
    throw new Error(`Missing --base and could not read git config dvm.baseSha from ${repoPath}`);
  }

  const containerTmp = `/tmp/dvm-repo-export-${safeSlug(containerName)}-${Date.now().toString(36)}`;
  const localOut = path.join(outRoot, `${format}-${safeSlug(containerName)}-${stamp}`);

  if (format === 'patches') {
    const patchDir = `${containerTmp}/patches`;
    const script = [
      'set -euo pipefail',
      `rm -rf ${JSON.stringify(containerTmp)}`,
      `mkdir -p ${JSON.stringify(patchDir)}`,
      `cd ${JSON.stringify(repoPath)}`,
      `git format-patch -o ${JSON.stringify(patchDir)} ${JSON.stringify(`${base}..HEAD`)}`,
    ].join('\n');
    await manager.docker.execCommand(containerName, ['bash', '-lc', script]);
    await manager.docker.copyFromContainer(containerName, patchDir, localOut);
    return { localOut, base };
  }

  if (format === 'bundle') {
    const bundleFile = `${containerTmp}/changes.bundle`;
    const script = [
      'set -euo pipefail',
      `rm -rf ${JSON.stringify(containerTmp)}`,
      `mkdir -p ${JSON.stringify(containerTmp)}`,
      `cd ${JSON.stringify(repoPath)}`,
      `git bundle create ${JSON.stringify(bundleFile)} ${JSON.stringify(`${base}..HEAD`)}`,
    ].join('\n');
    await manager.docker.execCommand(containerName, ['bash', '-lc', script]);
    await manager.docker.copyFromContainer(containerName, bundleFile, localOut);
    return { localOut, base };
  }

  if (format === 'diff') {
    const diffFile = `${containerTmp}/changes.diff`;
    const script = [
      'set -euo pipefail',
      `rm -rf ${JSON.stringify(containerTmp)}`,
      `mkdir -p ${JSON.stringify(containerTmp)}`,
      `cd ${JSON.stringify(repoPath)}`,
      `git diff ${JSON.stringify(`${base}..HEAD`)} > ${JSON.stringify(diffFile)}`,
    ].join('\n');
    await manager.docker.execCommand(containerName, ['bash', '-lc', script]);
    await manager.docker.copyFromContainer(containerName, diffFile, localOut);
    return { localOut, base };
  }

  // Should be unreachable due to typing.
  throw new Error(`Unsupported format: ${format}`);
}

async function repoApplyPatchesToQuarantineBranch(options: {
  hostRepoPath: string;
  patchesDir: string;
  branch: string;
  fromRef: string;
  force: boolean;
}): Promise<{ patchesApplied: number }> {
  const hostRepoPath = path.resolve(options.hostRepoPath);
  const patchesDir = path.resolve(options.patchesDir);
  const branch = options.branch;
  const fromRef = options.fromRef;
  const force = options.force;

  // Remember where we started so we can return after applying patches.
  const originalBranch = (
    await runLocal('git', ['-C', hostRepoPath, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(async () => '')
  ).trim();
  const originalHead = (await runLocal('git', ['-C', hostRepoPath, 'rev-parse', 'HEAD'])).trim();

  await runLocal('git', ['-C', hostRepoPath, 'rev-parse', '--is-inside-work-tree']);

  const entries = await fs.promises.readdir(patchesDir);
  const patches = entries
    .filter((e) => e.toLowerCase().endsWith('.patch'))
    .sort()
    .map((e) => path.join(patchesDir, e));

  if (patches.length === 0) {
    throw new Error(`No .patch files found in ${patchesDir}`);
  }

  // Create/switch quarantine branch.
  // If the branch already exists, default to "refresh it" from base (idempotent apply).
  const branchExists = await runLocal('git', ['-C', hostRepoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    .then(() => true)
    .catch(() => false);

  if (force || branchExists) {
    await runLocal('git', ['-C', hostRepoPath, 'switch', '-C', branch, fromRef]);
  } else {
    await runLocal('git', ['-C', hostRepoPath, 'switch', '-c', branch, fromRef]);
  }

  // Apply patches in order.
  for (const p of patches) {
    await runLocal('git', ['-C', hostRepoPath, 'am', p]);
  }

  // Return to the original branch/commit so the user's working context stays on "base".
  if (originalBranch) {
    await runLocal('git', ['-C', hostRepoPath, 'switch', originalBranch]);
  } else {
    // Detached state: switch back to the original HEAD commit.
    await runLocal('git', ['-C', hostRepoPath, 'switch', '--detach', originalHead]);
  }

  return { patchesApplied: patches.length };
}

function assertSafeSessionName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Missing session name');
  if (s.length > 64) throw new Error(`Session name too long (max 64 chars): ${s.length}`);
  if (!/^[A-Za-z0-9_.-]+$/.test(s)) {
    throw new Error(
      `Invalid session name: ${JSON.stringify(
        s
      )}\n\nSession names must match /^[A-Za-z0-9_.-]+$/ (letters, numbers, underscore, dot, dash).`
    );
  }
  return s;
}

function normalizeTmuxKeyName(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return s;

  const lower = s.toLowerCase();

  // Common friendly alias: Shift+Tab.
  if (lower === 'shift+tab' || lower === 'shift-tab' || lower === 'shift_tab') return 'BTab';
  if (lower === 'shift tab' || lower === 'shift\tab') return 'BTab';
  // Common tmux alias spellings users try.
  if (lower === 'btab' || lower === 'b tab') return 'BTab';
  if (lower === 'backtab' || lower === 'back-tab' || lower === 'back_tab') return 'BTab';
  if (lower === 's-tab' || lower === 's_tab' || lower === 'stab') return 'BTab';

  // Common key names in a case-insensitive form.
  const direct: Record<string, string> = {
    // Use C-m for maximum tmux compatibility.
    enter: 'C-m',
    return: 'C-m',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
  };
  const directHit = direct[lower];
  if (directHit) return directHit;

  // Support modifier+key format like "ctrl+c" / "alt+enter" / "shift+tab".
  // tmux uses prefixes like "C-" and "M-" (e.g. "C-c", "M-x", "C-M-f").
  if (s.includes('+')) {
    const parts = s
      .split('+')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const keyRaw = parts[parts.length - 1]!;
      const modsRaw = parts.slice(0, -1);

      const mods: string[] = [];
      let hasShift = false;
      for (const m of modsRaw) {
        const ml = m.toLowerCase();
        if (ml === 'shift' || ml === 's') {
          hasShift = true;
          continue;
        }
        if (ml === 'ctrl' || ml === 'control' || ml === 'c') {
          mods.push('C');
          continue;
        }
        if (ml === 'alt' || ml === 'meta' || ml === 'm') {
          mods.push('M');
          continue;
        }
      }

      const keyLower = keyRaw.toLowerCase();
      if (hasShift && keyLower === 'tab') return 'BTab';

      const keyNorm = direct[keyLower] ?? keyRaw;
      const prefix = mods.join('-');
      if (prefix) return `${prefix}-${keyNorm}`;
    }
  }

  return s;
}

async function tmuxSessionExists(containerName: string, sessionName: string): Promise<boolean> {
  const script = `tmux has-session -t ${JSON.stringify(sessionName)} 2>/dev/null && echo yes || echo no`;
  const out = await manager.docker.execCommand(containerName, ['bash', '-lc', script]);
  return out.trim().split('\n').pop() === 'yes';
}

program
  .name('dvm')
  .description('CLI tool for managing Docker containers as isolated VMs')
  .version('0.1.0');

// Create command
program
  .command('create')
  .description('Create and start a new container')
  .argument('<name>', 'Container name')
  .option('-i, --image <image>', 'Docker image to use (default: ubuntu:latest or base container if set)')
  .option('--no-base', 'Do not use configured base container image (default: use base if set)')
  .option('-p, --ports <ports>', 'Ports to expose (comma-separated, e.g., 3000,8080 or 3000:3000,8080:8080)')
  .option('-n, --network <network>', 'Docker network to attach (user-defined bridge recommended)')
  .option('--create-network', 'Create the network if missing', false)
  .option('--no-persist', 'Disable data persistence')
  .option('-e, --env <env>', 'Environment variables (KEY=value, comma-separated)')
  .option('-v, --volume <volume>', 'Volume mounts (source:target, comma-separated)')
  .option('-c, --config <file>', 'Configuration file (YAML or JSON)')
  .action(safeAction(async (name, options) => {
    let config: import('./docker/client').ContainerConfig;

    // Determine which image to use
    // Check if base is set and --image was not explicitly provided
    let imageToUse = options.image;
    let usingConfiguredBaseImage = false;
    if (!imageToUse) {
      if (options.base) {
        const base = await baseConfig.getBase();
        if (base?.image) {
          imageToUse = base.image;
          usingConfiguredBaseImage = true;
          console.log(chalk.blue(`Using base container image: ${base.image}`));
        } else {
          imageToUse = 'ubuntu:latest';
        }
      } else {
        imageToUse = 'ubuntu:latest';
      }
    }

    if (options.config) {
      config = await ConfigLoader.loadFromFile(options.config);
      // Override name if provided
      config.name = name;
      // Override network if passed explicitly
      if (options.network) {
        config.network = String(options.network);
      }
      // Override image if base is set and not explicitly provided in config
      if (!options.image && !config.image && options.base) {
        const base = await baseConfig.getBase();
        if (base?.image) {
          config.image = base.image;
          usingConfiguredBaseImage = true;
        }
      } else if (options.image) {
        config.image = options.image;
      }
    } else {
      config = ConfigLoader.createDefaultConfig(name, imageToUse);

      if (options.network) {
        config.network = String(options.network);
      }

      // Parse ports
      if (options.ports) {
        config.ports = parsePortsList([options.ports]);
      }

      // Parse environment variables
      if (options.env) {
        config.environment = options.env.split(',').map((e: string) => e.trim());
      }

      // Parse volumes
      if (options.volume) {
        config.volumes = options.volume.split(',').map((v: string) => {
          const trimmed = v.trim();
          const [source, target] = trimmed.split(':');
          return { source, target, type: 'bind' as const };
        });
      }

      // Persistence
      if (options.noPersist) {
        config.persistence = { enabled: false, path: '/dvm-data' };
      }
    }

    if (config.network && options.createNetwork) {
      await manager.docker.ensureNetwork(config.network);
    }

    console.log(chalk.blue(`Creating container ${name}...`));
    await manager.createContainer(config, true, {
      // When creating from the configured base image, we want a pure clone:
      // no in-container package installs, etc.
      skipProvisioning: usingConfiguredBaseImage,
    });
    console.log(chalk.green(`Container ${name} created and started successfully!`));
  }));

// Clone command
program
  .command('clone')
  .description('Clone an existing container into a new one (filesystem + dvm persistence volume)')
  .argument('<source>', 'Source container name')
  .argument('<name>', 'New container name')
  .option('--no-start', 'Do not start the cloned container')
  .option('--no-copy-persistence', 'Do not copy dvm persistence volume contents from the source container')
  .option('--reuse-named-volumes', 'Also reuse named volumes from the source (besides dvm persistence)')
  .action(safeAction(async (source, name, options) => {
    console.log(chalk.blue(`Cloning container ${source} -> ${name}...`));
    await manager.cloneContainer(source, name, {
      start: options.start,
      copyPersistenceVolume: Boolean(options.copyPersistence),
      reuseNamedVolumes: Boolean(options.reuseNamedVolumes),
    });
    console.log(chalk.green(`Container ${name} cloned successfully!`));
  }));

// Purge command
program
  .command('purge')
  .description('Remove all DVM-managed containers (excludes base container by default)')
  .argument('[scope]', 'Optional scope: "all" to include base container')
  .option('--all', 'Include the base container (same as "purge all")')
  .option('--dry-run', 'List containers that would be removed without removing them')
  .action(safeAction(async (scope, options) => {
    const base = await baseConfig.getBase();
    const baseName = base?.containerName;

    const includeBase = Boolean(options.all) || scope === 'all';
    const result = await manager.purgeContainers({
      includeBase,
      baseContainerName: baseName,
      dryRun: Boolean(options.dryRun),
    });

    if (result.removed.length === 0) {
      console.log(chalk.yellow('No DVM containers found to purge.'));
      return;
    }

    const verb = options.dryRun ? 'Would remove' : 'Removed';
    console.log(chalk.green(`${verb} ${result.removed.length} container(s):`));
    for (const name of result.removed) {
      console.log(`- ${name}`);
    }

    if (!includeBase && result.skippedBase) {
      console.log(chalk.gray('\n(Base container was detected and skipped. Use `dvm purge --all` to include it.)'));
    }
  }));

// Expose ports for an existing container (recreate required)
program
  .command('expose')
  .description('Expose/publish ports for an existing container (recreates the container)')
  .argument('<name>', 'Container name')
  .argument('[ports...]', 'Ports to expose (e.g., 3000 8080:3000)')
  .option('-p, --ports <ports>', 'Ports to expose (comma-separated, e.g., 3000,8080 or 3000:3000,8080:8080)')
  .option('--no-start', 'Do not start the container after recreating')
  .action(safeAction(async (name, portsArgs, options) => {
    const rawPorts: string[] = [];
    if (options.ports) {
      rawPorts.push(...String(options.ports).split(','));
    }
    if (Array.isArray(portsArgs) && portsArgs.length > 0) {
      rawPorts.push(...portsArgs);
    }

    if (rawPorts.length === 0) {
      throw new Error('Missing ports. Provide them as positional args or via --ports');
    }

    const ports = parsePortsList(rawPorts);

    console.log(chalk.blue(`Recreating ${name} with additional exposed ports...`));
    await manager.exposePorts(name, ports, { start: options.start });
    console.log(chalk.green(`Ports updated for ${name}!`));
  }));

// List command
program
  .command('list')
  .alias('ls')
  .description('List DVM containers (running and stopped)')
  // Back-compat: `--all` used to be required to show stopped containers.
  .option('-a, --all', 'Show all containers (including stopped) (default)', false)
  .option('--running-only', 'Only show running containers', false)
  .action(safeAction(async (options) => {
    const all = options.runningOnly ? false : true;
    await manager.listContainers(all);
  }));

type LifecycleCommandOptions = {
  all?: boolean;
};

type LifecycleManagerMethod = 'startContainer' | 'pauseContainer' | 'unpauseContainer' | 'stopContainer';

type LifecycleCommandConfig = {
  command: 'start' | 'pause' | 'unpause' | 'stop';
  description: string;
  allDescription: string;
  presentTenseAction: string;
  pastTenseAction: string;
  pastParticipleAction: string;
  managerMethod: LifecycleManagerMethod;
};

function registerLifecycleCommand(config: LifecycleCommandConfig): void {
  program
    .command(config.command)
    .description(config.description)
    .argument('[name]', 'Container name')
    .option('-a, --all', config.allDescription, false)
    .action(safeAction(async (name: string | undefined, options: LifecycleCommandOptions) => {
      if (options.all) {
        const names = await manager.listDvmContainerNames(true);
        if (names.length === 0) {
          console.log(chalk.yellow('No DVM containers found.'));
          return;
        }
        let failures = 0;
        for (const n of names) {
          try {
            console.log(chalk.blue(`${config.presentTenseAction} ${n}...`));
            await manager[config.managerMethod](n);
            console.log(chalk.green(`${config.pastTenseAction} ${n}`));
          } catch (err: any) {
            failures++;
            console.error(chalk.red(`Failed to ${config.command} ${n}: ${err?.message || err}`));
          }
        }
        if (failures > 0) process.exit(1);
        return;
      }

      if (!name) throw new Error('Missing container name (or pass --all)');
      console.log(chalk.blue(`${config.presentTenseAction} container ${name}...`));
      await manager[config.managerMethod](name);
      console.log(chalk.green(`Container ${name} ${config.pastParticipleAction} successfully!`));
    }));
}

// Start/pause/unpause/stop commands
registerLifecycleCommand({
  command: 'start',
  description: 'Start a container',
  allDescription: 'Start all DVM containers',
  presentTenseAction: 'Starting',
  pastTenseAction: 'Started',
  pastParticipleAction: 'started',
  managerMethod: 'startContainer',
});

registerLifecycleCommand({
  command: 'pause',
  description: 'Pause (freeze) all processes in a running container',
  allDescription: 'Pause all running DVM containers',
  presentTenseAction: 'Pausing',
  pastTenseAction: 'Paused',
  pastParticipleAction: 'paused',
  managerMethod: 'pauseContainer',
});

registerLifecycleCommand({
  command: 'unpause',
  description: 'Unpause (resume) a paused container',
  allDescription: 'Unpause all paused DVM containers',
  presentTenseAction: 'Unpausing',
  pastTenseAction: 'Unpaused',
  pastParticipleAction: 'unpaused',
  managerMethod: 'unpauseContainer',
});

registerLifecycleCommand({
  command: 'stop',
  description: 'Stop a container',
  allDescription: 'Stop all running DVM containers',
  presentTenseAction: 'Stopping',
  pastTenseAction: 'Stopped',
  pastParticipleAction: 'stopped',
  managerMethod: 'stopContainer',
});

// Rename command
program
  .command('rename')
  .description('Rename a container quickly (keeps existing mounts/volume); optionally migrate persistence volume name')
  .argument('<oldName>', 'Existing container name')
  .argument('<newName>', 'New container name')
  .option('--migrate-volume-name', 'Also migrate persistence volume to dvm-<new>-data (slower)', false)
  .option('--start', 'Start the renamed container even if the old one was stopped')
  .option('--no-start', 'Do not start the renamed container even if the old one was running')
  .action(safeAction(async (oldName, newName, options) => {
    const startMode =
      options.start === false ? 'never' : options.start === true ? 'always' : 'preserve';

    console.log(chalk.blue(`Renaming ${oldName} -> ${newName}...`));
    await manager.renameContainer(String(oldName), String(newName), {
      startMode,
      migrateVolumeName: Boolean(options.migrateVolumeName),
    });

    // If this was the configured base container, update config to the new name.
    const base = await baseConfig.getBase();
    if (base?.containerName === String(oldName)) {
      await baseConfig.setBase(String(newName), base.image);
    }

    console.log(chalk.green(`Renamed ${oldName} -> ${newName}`));
  }));

// Remove command
program
  .command('remove')
  .alias('rm')
  .description('Remove a container completely (including its dvm persistence volume)')
  .argument('<name>', 'Container name')
  .option('--keep-volume', 'Keep the persistence volume attached to this container')
  // Back-compat: this flag used to be required to remove the volume; now it is the default.
  .option('--clean', 'Remove the dvm persistence volume (deprecated; now default)')
  .action(safeAction(async (name, options) => {
    console.log(chalk.blue(`Removing container ${name}...`));
    const removeVolume = !options.keepVolume;
    await manager.removeContainer(name, removeVolume);
    console.log(chalk.green(`Container ${name} removed successfully!`));
  }));

// Info command
program
  .command('info')
  .description('Show container details')
  .argument('<name>', 'Container name')
  .action(safeAction(async (name) => {
    await manager.showInfo(name);
  }));

// Exec command
program
  .command('exec')
  .description('Execute a command in a container')
  .argument('<name>', 'Container name')
  .argument('<command...>', 'Command to execute')
  .action(safeAction(async (name, command) => {
    const output = await manager.docker.execCommand(name, command);
    console.log(output);
  }));

// Copy command
program
  .command('copy')
  .aliases(['cp', 'upload'])
  .description('Copy a local file or directory into a running container')
  .argument('<name>', 'Container name')
  .argument('<src>', 'Local source path (file or directory) on the host')
  .argument('<dest>', 'Destination path inside the container')
  .option('--clean', 'If dest exists and src is a directory, remove dest before copying', false)
  .action(safeAction(async (name, src, dest, options) => {
    const absSrc = path.resolve(String(src));
    const destPath = String(dest);

    // Ensure container is running.
    await manager.docker.execCommand(name, ['bash', '-lc', 'true']);

    // Ensure destination exists (treat dest as a directory destination).
    await manager.docker.execCommand(name, ['bash', '-lc', `mkdir -p ${JSON.stringify(destPath)}`]);

    if (options.clean) {
      await manager.docker.execCommand(name, ['bash', '-lc', `rm -rf ${JSON.stringify(destPath)}`]);
      await manager.docker.execCommand(name, ['bash', '-lc', `mkdir -p ${JSON.stringify(destPath)}`]);
    }

    await manager.docker.copyToContainer(name, absSrc, destPath);
    console.log(chalk.green(`Copied ${absSrc} -> ${name}:${destPath}`));
  }));

// Download command (inverse of copy)
program
  .command('download')
  .alias('dl')
  .description('Copy a file or directory out of a container onto the host')
  .argument('<name>', 'Container name')
  .argument('<src>', 'Source path inside the container')
  .argument('<dest>', 'Destination path on the host')
  .option('--clean', 'If dest exists, remove it before copying', false)
  .action(safeAction(async (name, src, dest, options) => {
    const absDest = path.resolve(String(dest));
    if (options.clean) {
      await fs.promises.rm(absDest, { recursive: true, force: true });
    }
    await manager.docker.copyFromContainer(String(name), String(src), absDest);
    console.log(chalk.green(`Downloaded ${name}:${src} -> ${absDest}`));
  }));

// Script command
program
  .command('script')
  .description('Run a local script file inside a running container')
  .argument('<name>', 'Container name')
  .argument('<scriptPath>', 'Local script path (on the host)')
  .argument('[scriptArgs...]', 'Arguments passed through to the script')
  .option('-w, --workdir <dir>', 'Working directory inside the container', '/')
  .option('-d, --dest <path>', 'Destination path inside the container (optional)')
  .option('--shell <shell>', 'Shell/interpreter to run the script with', 'bash')
  .option('--keep', 'Do not delete the copied script after running', false)
  .action(safeAction(async (name, scriptPath, scriptArgs, options) => {
    const output = await manager.runLocalScript(name, scriptPath, scriptArgs, {
      destPath: options.dest,
      workdir: options.workdir,
      shell: options.shell,
      keep: options.keep,
    });
    if (output) console.log(output);
  }));

// SSH command (interactive shell)
program
  .command('ssh')
  .description('Open an interactive shell in a container')
  .argument('<name>', 'Container name')
  .option('-c, --command <command>', 'Command to run (default: /bin/bash)', '/bin/bash')
  .action(safeAction(async (name, options) => {
    const command = options.command ? options.command.split(' ') : ['/bin/bash'];
    await manager.docker.execInteractive(name, command);
  }));

function registerEditorCommand(editorCommand: 'code' | 'cursor', editorName: 'VS Code' | 'Cursor'): void {
  program
    .command(editorCommand)
    .description(`Open ${editorName} attached to the container (fallback: interactive shell)`)
    .argument('<name>', 'Container name')
    .argument('[dir]', 'Starting directory inside the container (default: /)')
    .option('-w, --cwd <dir>', 'Starting directory inside the container (overrides [dir])')
    .option('--ssh', `Force interactive shell instead of launching ${editorName}`, false)
    .action(safeAction(async (name, dir, options) => {
      await openEditorOrShell({
        editorCommand,
        containerName: String(name),
        cwd: options.cwd || dir,
        forceShell: Boolean(options.ssh),
      });
    }));
}

// VS Code / Cursor helpers
registerEditorCommand('code', 'VS Code');
registerEditorCommand('cursor', 'Cursor');

// Logs command
program
  .command('logs')
  .description('View container logs')
  .argument('<name>', 'Container name')
  .option('-n, --tail <number>', 'Number of lines to show', '100')
  .action(safeAction(async (name, options) => {
    await manager.showLogs(name, parseInt(options.tail));
  }));

// Ports command
program
  .command('ports')
  .description('List ports for a container')
  .argument('<name>', 'Container name')
  .action(safeAction(async (name) => {
    const details = await manager.docker.getContainerDetails(name);
    if (!details) {
      throw new Error(`Container ${name} not found`);
    }

    if (details.ports.length === 0) {
      console.log(`No ports exposed for container ${name}`);
      return;
    }

    console.log(`\nPorts for ${name}:`);
    console.log('─'.repeat(80));
    for (const port of details.ports) {
      if (port.hostPort) {
        console.log(`  ${port.hostPort}:${port.containerPort}`);
      } else {
        console.log(`  ${port.containerPort} (not exposed)`);
      }
    }
  }));

// Volumes command
program
  .command('volumes')
  .description('List volumes or show volume details for a container')
  .argument('[name]', 'Container name (optional)')
  .action(safeAction(async (name) => {
    if (name) {
      await manager.showVolumeInfo(name);
    } else {
      await manager.listVolumes();
    }
  }));

// Network commands
const networkCommand = new Command('network')
  .description('Manage Docker networks and container attachments');

networkCommand
  .command('create')
  .description('Create a user-defined Docker network (bridge by default)')
  .argument('<name>', 'Network name')
  .option('--driver <driver>', 'Network driver (default: bridge)', 'bridge')
  .action(safeAction(async (name, options) => {
    await manager.docker.ensureNetwork(String(name), { driver: String(options.driver || 'bridge') });
    console.log(chalk.green(`Network ready: ${name}`));
  }));

networkCommand
  .command('ls')
  .description('List Docker networks')
  .action(safeAction(async () => {
    const nets = await manager.docker.listNetworks();
    if (!nets || nets.length === 0) {
      console.log('No networks found.');
      return;
    }

    console.log('\nNetworks:');
    console.log('─'.repeat(80));
    for (const n of nets) {
      const name = n?.Name || n?.Id || 'unknown';
      const driver = (n as any)?.Driver || 'unknown';
      console.log(`${name}  ${chalk.gray(`(${driver})`)}`);
    }
  }));

networkCommand
  .command('connect')
  .description('Connect one or more containers to a Docker network')
  .argument('<network>', 'Network name')
  .argument('<containers...>', 'Container name(s)')
  .option('--create', 'Create the network if missing', false)
  .action(safeAction(async (network, containers, options) => {
    const netName = String(network);
    if (options.create) {
      await manager.docker.ensureNetwork(netName);
    }

    for (const c of containers as string[]) {
      await manager.docker.connectNetwork(netName, String(c));
      console.log(chalk.green(`Connected ${c} -> ${netName}`));
    }
  }));

networkCommand
  .command('disconnect')
  .description('Disconnect one or more containers from a Docker network')
  .argument('<network>', 'Network name')
  .argument('<containers...>', 'Container name(s)')
  .option('-f, --force', 'Force disconnect', false)
  .action(safeAction(async (network, containers, options) => {
    const netName = String(network);
    for (const c of containers as string[]) {
      await manager.docker.disconnectNetwork(netName, String(c), Boolean(options.force));
      console.log(chalk.green(`Disconnected ${c} <- ${netName}`));
    }
  }));

// Default: show running container -> networks mapping (quick topology view)
networkCommand.action(safeAction(async () => {
  const containers = await manager.docker.listContainers(true);
  const running = containers.filter((c) => c.State === 'running');

  if (running.length === 0) {
    console.log('No running containers found.');
    return;
  }

  console.log('\nNetwork Topology:');
  console.log('─'.repeat(80));
  for (const c of running) {
    const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12);
    let networks: string[] = [];
    try {
      networks = await manager.docker.getContainerNetworkNames(name);
    } catch {
      networks = [];
    }
    const netText = networks.length ? networks.join(', ') : 'none';
    console.log(`${name}: ${chalk.cyan(netText)}`);
  }
}));

program.addCommand(networkCommand);

// GUI command
program
  .command('gui')
  .description('Install and setup GUI (XRDP) for remote desktop access')
  .argument('<name>', 'Container name')
  .action(safeAction(async (name) => {
    console.log(chalk.blue(`Setting up GUI for container ${name}...`));
    await manager.installGui(name);
    console.log(chalk.green(`GUI setup completed for container ${name}!`));
  }));

// Base command group
const baseCommand = new Command('base')
  .description('Manage base container for new containers');

baseCommand
  .command('set')
  .description('Set a container as the base for new containers')
  .argument('<name>', 'Container name to use as base')
  .action(safeAction(async (name) => {
    // Check if container exists
    const exists = await manager.docker.containerExists(name);
    if (!exists) {
      throw new Error(`Container ${name} not found`);
    }

    // Get the container's image
    const image = await manager.docker.getContainerImage(name);
    if (!image) {
      throw new Error(`Could not determine image for container ${name}`);
    }

    // Commit the container to create a new image based on it
    const baseImageName = `dvm-base-${name}`;
    console.log(chalk.blue(`Committing container ${name} to create base image...`));
    const committedImage = await manager.docker.commitContainer(name, baseImageName);
    
    // Store the base config
    await baseConfig.setBase(name, committedImage);
    
    console.log(chalk.green(`Base container set to ${name}`));
    console.log(chalk.green(`Base image: ${committedImage}`));
    console.log(chalk.yellow(`New containers will use this base image unless --image is specified`));
  }));

baseCommand
  .command('reset')
  .description('Reset base container to default (use original image)')
  .action(safeAction(async () => {
    await baseConfig.resetBase();
    console.log(chalk.green('Base container reset to default'));
    console.log(chalk.yellow('New containers will use the image specified with --image flag'));
  }));

baseCommand
  .command('show')
  .description('Show current base container')
  .action(safeAction(async () => {
    const base = await baseConfig.getBase();
    if (!base || (!base.containerName && !base.image)) {
      console.log(chalk.yellow('No base container set'));
      console.log(chalk.gray('New containers will use the image specified with --image flag'));
    } else {
      console.log(chalk.blue('\nCurrent base container:'));
      console.log('─'.repeat(80));
      if (base.containerName) {
        console.log(`Container: ${chalk.green(base.containerName)}`);
      }
      if (base.image) {
        console.log(`Image: ${chalk.green(base.image)}`);
      }
      console.log(chalk.yellow('\nNew containers will use this base image unless --image is specified'));
    }
  }));

program.addCommand(baseCommand);

// Export / import commands
program
  .command('export')
  .description('Export a container to an archive (image + dvm persistence volume)')
  .argument('<name>', 'Container name')
  .argument('<archive>', 'Output archive path (recommended: *.tar.gz)')
  .option('--no-volume', 'Do not include the dvm persistence volume in the archive')
  .action(safeAction(async (name, archive, options) => {
    console.log(chalk.blue(`Exporting ${name} -> ${archive} ...`));
    await manager.exportContainer(String(name), String(archive), { includeVolume: Boolean(options.volume) });
    console.log(chalk.green(`Exported ${name} -> ${archive}`));
  }));

program
  .command('import')
  .description('Import a container from an archive (created by `dvm export`)')
  .argument('<archive>', 'Archive path (*.tar.gz)')
  .argument('[name]', 'Container name override (optional)')
  .option('--no-start', 'Do not start the container after importing')
  .option('--preserve-host-ports', 'Try to reuse host ports from the archive (may be re-mapped if busy)', false)
  .option('-n, --network <network>', 'Attach the imported container to this network (optional)')
  .action(safeAction(async (archive, name, options) => {
    console.log(chalk.blue(`Importing ${archive} ...`));
    const newName = await manager.importContainer(String(archive), {
      name: name ? String(name) : undefined,
      start: Boolean(options.start),
      preserveHostPorts: Boolean(options.preserveHostPorts),
      network: options.network ? String(options.network) : undefined,
    });
    console.log(chalk.green(`Imported container: ${newName}`));
  }));

// Snapshot / restore commands
program
  .command('snapshot')
  .alias('snap')
  .description(`Create a local snapshot archive for a container (stored under ${path.join(dvmHomeDir(), 'snapshots')})`)
  .argument('<name>', 'Container name')
  .argument('[snapshot]', 'Snapshot name (optional; default: timestamp)')
  .option('--no-volume', 'Do not include the dvm persistence volume in the snapshot')
  .action(safeAction(async (name, snapshot, options) => {
    const { snapshotName, archivePath } = await manager.snapshotContainer(String(name), snapshot, {
      includeVolume: Boolean(options.volume),
    });
    console.log(chalk.green(`Snapshot created: ${snapshotName}`));
    console.log(chalk.gray(archivePath));
  }));

program
  .command('restore')
  .description('Restore a container from a local snapshot (replaces container + dvm persistence volume)')
  .argument('<name>', 'Container name')
  .argument('[snapshot]', 'Snapshot name (default: latest) or archive path (*.tar.gz)')
  .option('-f, --file <archive>', 'Explicit archive path (*.tar.gz)')
  .option('--no-start', 'Do not start the container after restoring')
  .option('--preserve-host-ports', 'Try to reuse host ports from the snapshot (may be re-mapped if busy)', false)
  .option('-n, --network <network>', 'Attach the restored container to this network (optional)')
  .action(safeAction(async (name, snapshot, options) => {
    const source = options.file ? String(options.file) : snapshot ? String(snapshot) : undefined;
    console.log(chalk.blue(`Restoring ${name}...`));
    await manager.restoreContainer(String(name), source, {
      start: Boolean(options.start),
      preserveHostPorts: Boolean(options.preserveHostPorts),
      network: options.network ? String(options.network) : undefined,
    });
    console.log(chalk.green(`Restored container: ${name}`));
  }));

program
  .command('snapshots')
  .alias('snaps')
  .description(`List local snapshots for a container (from ${path.join(dvmHomeDir(), 'snapshots')})`)
  .argument('<name>', 'Container name')
  .action(safeAction(async (name) => {
    const snaps = await manager.listSnapshots(String(name));
    if (snaps.length === 0) {
      console.log(chalk.yellow(`No snapshots found for ${name}.`));
      return;
    }

    console.log(`\nSnapshots for ${chalk.green(String(name))}:`);
    console.log('─'.repeat(80));
    for (const s of snaps) {
      const sizeMb = (s.sizeBytes / (1024 * 1024)).toFixed(1);
      const when = new Date(s.mtimeMs).toLocaleString();
      const tag = s.isLatestPointer ? chalk.cyan(' (latest)') : '';
      console.log(`${chalk.bold(s.name)}${tag}  ${chalk.gray(`${sizeMb} MB`)}  ${chalk.gray(when)}`);
      console.log(`  ${chalk.gray(s.archivePath)}`);
    }
  }));

// Repo workflows (offline "local PR" via bundle/patch export)
const repoCommand = new Command('repo').description(
  'Offline repo workflows: seed a container from a host repo, export patches/bundles back for review'
);

repoCommand
  .command('seed')
  .description('Seed a container repo from a host git repo using a git bundle (no host bind mount)')
  .argument('<name>', 'Container name')
  .option('--path <path>', 'Host repo path (default: current directory)')
  .option('--dest <path>', 'Destination path inside container', '/work/repo')
  .option('--bundle <path>', 'Bundle path inside container', '/tmp/dvm-repo.bundle')
  .option('--base-ref <ref>', 'Base ref to record (default: HEAD)', 'HEAD')
  .option('--no-create', 'Do not auto-create the container if missing')
  // Container create options (used only when auto-creating)
  .option('-i, --image <image>', 'Docker image to use (default: ubuntu:latest or base container if set)')
  .option('--no-base', 'Do not use configured base container image (default: use base if set)')
  .option('-p, --ports <ports>', 'Ports to expose (comma-separated, e.g., 3000,8080 or 3000:3000,8080:8080)')
  .option('-n, --network <network>', 'Docker network to attach (user-defined bridge recommended)')
  .option('--create-network', 'Create the network if missing', false)
  .option('--no-persist', 'Disable data persistence')
  .option('-e, --env <env>', 'Environment variables (KEY=value, comma-separated)')
  .option('-v, --volume <volume>', 'Volume mounts (source:target, comma-separated)')
  .option('-c, --config <file>', 'Configuration file (YAML or JSON)')
  .option('--branch <name>', 'Create and checkout this branch after cloning')
  .option('--force-branch', 'If --branch exists, reset it (git checkout -B)', false)
  .option('--clean', 'If dest exists, remove it before cloning', false)
  .action(safeAction(async (name, options) => {
    let tmpDir: string | null = null;
    let tmpBundle: string | null = null;
    try {
      const containerName = String(name);
      const hostRepoPath = path.resolve(String(options.path || process.cwd()));
      const dest = normalizeContainerPath(String(options.dest || '/work/repo'));
      const bundlePathInContainer = normalizeContainerPath(String(options.bundle || '/tmp/dvm-repo.bundle'));

      // Validate local git repo and get base SHA.
      await runLocal('git', ['-C', hostRepoPath, 'rev-parse', '--is-inside-work-tree']);
      const baseSha = (await runLocal('git', ['-C', hostRepoPath, 'rev-parse', String(options.baseRef || 'HEAD')])).trim();
      const baseBranchForHost = await hostCurrentBranchOrSha(hostRepoPath);
      const hostRemoteUrl = await hostBestRemoteUrl(hostRepoPath);

      // Create a temporary git bundle (single file, no build artifacts).
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `dvm-bundle-${safeSlug(containerName)}-`));
      tmpBundle = path.join(tmpDir, 'repo.bundle');
      await runLocal('git', ['-C', hostRepoPath, 'bundle', 'create', tmpBundle, '--all']);

      // Ensure container is running and has git.
      // NOTE: create-if-missing is default here (opt-out with --no-create).
      await ensureContainerExistsOrCreate(containerName, options, Boolean(options.create));
      await manager.ensureGit(containerName);

      // Copy bundle into container.
      await manager.docker.execCommand(containerName, [
        'sh',
        '-lc',
        `mkdir -p ${JSON.stringify(path.posix.dirname(bundlePathInContainer))}`,
      ]);
      await manager.docker.copyToContainer(containerName, tmpBundle, bundlePathInContainer);

      // Clone from bundle into dest.
      const branch = options.branch ? String(options.branch) : '';
      const branchCmd = branch
        ? `cd ${JSON.stringify(dest)} && git checkout ${options.forceBranch ? '-B' : '-b'} ${JSON.stringify(branch)}`
        : '';
      const remoteCmd = hostRemoteUrl
        ? `cd ${JSON.stringify(dest)} && git remote set-url origin ${JSON.stringify(hostRemoteUrl)}`
        : '';

      const cloneScript = [
        'set -euo pipefail',
        options.clean
          ? `rm -rf ${JSON.stringify(dest)}`
          : `if [ -e ${JSON.stringify(dest)} ]; then echo "Destination exists: ${dest}" >&2; exit 2; fi`,
        `mkdir -p ${JSON.stringify(path.posix.dirname(dest))}`,
        `git clone ${JSON.stringify(bundlePathInContainer)} ${JSON.stringify(dest)}`,
        // Record base SHA in git config (untracked; cannot accidentally be committed).
        `cd ${JSON.stringify(dest)} && git config dvm.baseSha ${JSON.stringify(baseSha)}`,
        // Preserve host remote so PR tooling can work directly inside the container repo.
        remoteCmd,
        // Back-compat cleanup: remove old tracked marker if present.
        `rm -f ${JSON.stringify(path.posix.join(dest, '.dvm-base-sha'))} || true`,
        branchCmd,
      ]
        .filter(Boolean)
        .join('\n');

      await manager.docker.execCommand(containerName, ['bash', '-lc', cloneScript]);

      console.log(chalk.green(`Seeded ${containerName}:${dest}`));
      console.log(chalk.gray(`Base SHA: ${baseSha}`));
      if (hostRemoteUrl) console.log(chalk.gray(`Origin: ${hostRemoteUrl}`));
      if (branch) console.log(chalk.gray(`Branch: ${branch}`));

      // Save per-host-repo defaults for `dvm repo sync/pull`.
      try {
        const { statePath, exportsRoot, state } = await loadRepoStateForHostPath(hostRepoPath);
        await fs.promises.mkdir(exportsRoot, { recursive: true });
        state.schemaVersion = 1;
        state.containerName = containerName;
        state.containerDest = dest;
        state.baseBranch = baseBranchForHost;
        await saveRepoState(statePath, state);
      } catch {
        // Best-effort only; do not fail seed on state write issues.
      }
    } finally {
      // Best-effort cleanup.
      try {
        if (tmpBundle) await fs.promises.rm(tmpBundle, { force: true });
      } catch {}
      try {
        if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }));

repoCommand
  .command('export')
  .description('Export changes from a container repo to the host (patches/bundle/diff)')
  .argument('<name>', 'Container name')
  .option('--repo <path>', 'Repo path inside container', '/work/repo')
  .option('--base <ref>', 'Base ref/SHA (default: read git config dvm.baseSha)')
  .option('--out <dir>', 'Output directory on host (default: ./dvm-exports)')
  .option('--format <format>', 'Export format: patches|bundle|diff', 'patches')
  .action(safeAction(async (name, options) => {
    const containerName = String(name);
    const repoPath = normalizeContainerPath(String(options.repo || '/work/repo'));
    const outRoot = path.resolve(String(options.out || path.join(process.cwd(), 'dvm-exports')));
    const format = String(options.format || 'patches').toLowerCase();
    if (format !== 'patches' && format !== 'bundle' && format !== 'diff') {
      throw new Error(`Unsupported format: ${format} (expected: patches|bundle|diff)`);
    }

    const { localOut } = await repoExportFromContainer({
      containerName,
      repoPathInContainer: repoPath,
      outRoot,
      format,
      base: options.base ? String(options.base) : undefined,
    });

    console.log(chalk.green(`Exported ${format} -> ${localOut}`));

    // Best-effort: if we're inside a host git repo, remember the last patches dir.
    if (format === 'patches') {
      try {
        const { statePath, state } = await loadRepoStateForHostPath(process.cwd());
        state.schemaVersion = 1;
        state.containerName = containerName;
        state.containerDest = repoPath;
        state.lastPatchesDir = localOut;
        await saveRepoState(statePath, state);
      } catch {
        // ignore
      }
    }
  }));

repoCommand
  .command('apply')
  .description('Apply exported patch series to a host quarantine branch (review in VS Code/Cursor)')
  .option('--path <path>', 'Host repo path (default: current directory)')
  .option('--patches <dir>', 'Directory containing *.patch files')
  .option('--branch <name>', 'Quarantine branch name', 'quarantine/dvm')
  .option('--from <ref>', 'Base ref/branch to base the quarantine branch on (default: current branch)')
  .option('--force', 'Reset existing quarantine branch (git switch -C)', false)
  .action(safeAction(async (options) => {
    const hostRepoPath = path.resolve(String(options.path || process.cwd()));
    const patchesDir = options.patches ? path.resolve(String(options.patches)) : '';
    const branch = String(options.branch || 'quarantine/dvm');
    const fromRef =
      options.from && String(options.from).trim() ? String(options.from).trim() : await hostCurrentBranchOrSha(hostRepoPath);
    const force = Boolean(options.force);

    if (!patchesDir) throw new Error('Missing --patches <dir>');

    const { patchesApplied } = await repoApplyPatchesToQuarantineBranch({
      hostRepoPath,
      patchesDir,
      branch,
      fromRef,
      force,
    });

    console.log(chalk.green(`Applied ${patchesApplied} patch(es) onto ${branch}`));
    console.log(chalk.gray(`Repo: ${hostRepoPath}`));
  }));

repoCommand
  .command('sync')
  .description('Export patches from a container repo and apply them to a host quarantine branch')
  .argument('<name>', 'Container name')
  .option('--path <path>', 'Host repo path (default: current directory)')
  .option('--repo <path>', 'Repo path inside container (default: remembered seed dest or /work/repo)')
  .option('--out <dir>', `Output directory on host (default: ${path.join(dvmHomeDir(), 'repo', '<repo-key>', 'exports')})`)
  .option('--branch <name>', 'Quarantine branch name (default: quarantine/<container>)')
  .option('--from <ref>', 'Base ref/branch (default: remembered base branch or current)')
  .option('--force', 'Reset existing quarantine branch (git switch -C)', false)
  .action(safeAction(async (name, options) => {
    const containerName = String(name);
    const hostRepoPath = path.resolve(String(options.path || process.cwd()));

    const { gitRoot, statePath, exportsRoot, state } = await loadRepoStateForHostPath(hostRepoPath);

    const repoPathInContainer = normalizeContainerPath(
      String(options.repo || state.containerDest || '/work/repo')
    );
    const outRoot = path.resolve(String(options.out || exportsRoot));
    const branch = String(options.branch || `quarantine/${containerName}`);
    const fromRef =
      options.from && String(options.from).trim()
        ? String(options.from).trim()
        : state.baseBranch
          ? String(state.baseBranch)
          : await hostCurrentBranchOrSha(gitRoot);
    const force = Boolean(options.force);

    const { localOut } = await repoExportFromContainer({
      containerName,
      repoPathInContainer,
      outRoot,
      format: 'patches',
    });
    console.log(chalk.green(`Exported patches -> ${localOut}`));

    const { patchesApplied } = await repoApplyPatchesToQuarantineBranch({
      hostRepoPath: gitRoot,
      patchesDir: localOut,
      branch,
      fromRef,
      force,
    });

    console.log(chalk.green(`Applied ${patchesApplied} patch(es) onto ${branch}`));
    console.log(chalk.gray(`Repo: ${gitRoot}`));

    // Persist defaults for next time.
    state.schemaVersion = 1;
    state.containerName = containerName;
    state.containerDest = repoPathInContainer;
    if (options.from || !state.baseBranch) state.baseBranch = fromRef;
    state.lastPatchesDir = localOut;
    await saveRepoState(statePath, state);
  }));

repoCommand
  .command('pull')
  .description('Pull container repo changes onto your working tree as unstaged changes (requires clean tree)')
  .argument('<name>', 'Container name')
  .option('--path <path>', 'Host repo path (default: current directory)')
  .option('--repo <path>', 'Repo path inside container (default: remembered seed dest or /work/repo)')
  .option('--out <dir>', `Output directory on host (default: ${path.join(dvmHomeDir(), 'repo', '<repo-key>', 'exports')})`)
  .option('--branch <name>', 'Quarantine branch name (default: quarantine/<container>)')
  .option('--from <ref>', 'Base ref/branch (default: remembered base branch or current)')
  .option('--force', 'Reset existing quarantine branch (git switch -C)', false)
  .action(safeAction(async (name, options) => {
    const containerName = String(name);
    const hostRepoPath = path.resolve(String(options.path || process.cwd()));

    const { gitRoot, statePath, exportsRoot, state } = await loadRepoStateForHostPath(hostRepoPath);

    // Refuse if working tree isn't clean (we're about to write files).
    const porcelain = (await runLocal('git', ['-C', gitRoot, 'status', '--porcelain'])).trim();
    if (porcelain) {
      throw new Error('Working tree not clean; commit/stash first (repo pull would overwrite local changes)');
    }

    const repoPathInContainer = normalizeContainerPath(
      String(options.repo || state.containerDest || '/work/repo')
    );
    const outRoot = path.resolve(String(options.out || exportsRoot));
    const branch = String(options.branch || `quarantine/${containerName}`);
    const fromRef =
      options.from && String(options.from).trim()
        ? String(options.from).trim()
        : state.baseBranch
          ? String(state.baseBranch)
          : await hostCurrentBranchOrSha(gitRoot);
    const force = Boolean(options.force);

    const { localOut } = await repoExportFromContainer({
      containerName,
      repoPathInContainer,
      outRoot,
      format: 'patches',
    });
    console.log(chalk.green(`Exported patches -> ${localOut}`));

    const { patchesApplied } = await repoApplyPatchesToQuarantineBranch({
      hostRepoPath: gitRoot,
      patchesDir: localOut,
      branch,
      fromRef,
      force,
    });
    console.log(chalk.green(`Applied ${patchesApplied} patch(es) onto ${branch}`));

    // Apply the quarantine branch's changes onto the current working tree as UNSTAGED changes.
    await applyGitDiffRangeToWorkingTree(gitRoot, `${fromRef}..${branch}`);

    console.log(chalk.green('Pulled changes onto working tree (unstaged). Review/stage/commit as desired.'));

    // Persist defaults for next time.
    state.schemaVersion = 1;
    state.containerName = containerName;
    state.containerDest = repoPathInContainer;
    if (options.from || !state.baseBranch) state.baseBranch = fromRef;
    state.lastPatchesDir = localOut;
    await saveRepoState(statePath, state);
  }));

program.addCommand(repoCommand);

// Persistent, non-interactive "interactive" sessions (tmux-powered)
//
// Motivation: some environments (CI/services) cannot allocate a real TTY, but still need
// to keep a long-lived interactive CLI running and feed it input/output over time.
const sessionCommand = new Command('session').description(
  'Run a persistent interactive CLI session (non-interactively) using tmux inside the container'
);

sessionCommand
  .command('up')
  .description(
    'Create/start a container, then start a persistent session (container name == session name)'
  )
  .argument('<name>', 'Container name (also used as session name)')
  .argument('<command...>', 'Command to run (use `--` before command args that start with --)')
  // Container create options (same intent as `dvm create`)
  .option('-i, --image <image>', 'Docker image to use (default: ubuntu:latest or base container if set)')
  .option('--no-base', 'Do not use configured base container image (default: use base if set)')
  .option(
    '-p, --ports <ports>',
    'Ports to expose (comma-separated, e.g., 3000,8080 or 3000:3000,8080:8080)'
  )
  .option('-n, --network <network>', 'Docker network to attach (user-defined bridge recommended)')
  .option('--create-network', 'Create the network if missing', false)
  .option('--no-persist', 'Disable data persistence')
  .option('-e, --env <env>', 'Environment variables (KEY=value, comma-separated)')
  .option('-v, --volume <volume>', 'Volume mounts (source:target, comma-separated)')
  .option('-c, --config <file>', 'Configuration file (YAML or JSON)')
  // Session start options (same as `dvm session start`)
  .option('-w, --cwd <dir>', 'Working directory inside the container', '/')
  .option('--history <lines>', 'tmux history limit (scrollback lines)', '100000')
  .option('--clear-log', 'Truncate the session log before starting', false)
  .option('--replace', 'If session exists, kill it and recreate', false)
  .option('--reuse', 'If session exists, do nothing (exit 0)', false)
  .action(safeAction(async (name, command, options) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(containerName);

    // Ensure container exists: create if missing, otherwise start.
    const exists = await manager.docker.containerExists(containerName);
    if (!exists) {
      let config: import('./docker/client').ContainerConfig;

      // Determine which image to use (same logic as `dvm create`)
      let imageToUse = options.image;
      let usingConfiguredBaseImage = false;
      if (!imageToUse) {
        if (options.base) {
          const base = await baseConfig.getBase();
          if (base?.image) {
            imageToUse = base.image;
            usingConfiguredBaseImage = true;
            console.log(chalk.blue(`Using base container image: ${base.image}`));
          } else {
            imageToUse = 'ubuntu:latest';
          }
        } else {
          imageToUse = 'ubuntu:latest';
        }
      }

      if (options.config) {
        config = await ConfigLoader.loadFromFile(options.config);
        // Override name if provided
        config.name = containerName;
        // Override network if passed explicitly
        if (options.network) {
          config.network = String(options.network);
        }
        // Override image if base is set and not explicitly provided in config
        if (!options.image && !(config as any).image && options.base) {
          const base = await baseConfig.getBase();
          if (base?.image) {
            config.image = base.image;
            usingConfiguredBaseImage = true;
          }
        } else if (options.image) {
          config.image = options.image;
        }
      } else {
        config = ConfigLoader.createDefaultConfig(containerName, imageToUse);

        if (options.network) {
          config.network = String(options.network);
        }

        // Parse ports
        if (options.ports) {
          config.ports = parsePortsList([options.ports]);
        }

        // Parse environment variables
        if (options.env) {
          config.environment = options.env.split(',').map((e: string) => e.trim());
        }

        // Parse volumes
        if (options.volume) {
          config.volumes = options.volume.split(',').map((v: string) => {
            const trimmed = v.trim();
            const [source, target] = trimmed.split(':');
            return { source, target, type: 'bind' as const };
          });
        }

        // Persistence
        if (options.noPersist) {
          config.persistence = { enabled: false, path: '/dvm-data' };
        }
      }

      if (config.network && options.createNetwork) {
        await manager.docker.ensureNetwork(config.network);
      }

      console.log(chalk.blue(`Creating container ${containerName}...`));
      await manager.createContainer(config, true, {
        // When creating from the configured base image, we want a pure clone:
        // no in-container package installs, etc.
        skipProvisioning: usingConfiguredBaseImage,
      });
      console.log(chalk.green(`Container ${containerName} created and started successfully!`));
    } else {
      await manager.startContainer(containerName);
    }

    // Start session (same behavior as `dvm session start`, but sessionName == containerName).
    const cwd = normalizeContainerPath(String(options.cwd || '/'));
    const history = Number(String(options.history || '100000'));
    if (!Number.isInteger(history) || history <= 0) {
      throw new Error(`Invalid --history: ${options.history} (expected a positive integer)`);
    }

    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const sessionExists = await tmuxSessionExists(containerName, sessionName);
    if (sessionExists) {
      if (options.reuse) {
        console.log(chalk.gray(`Session already exists: ${sessionName}`));
        return;
      }
      if (options.replace) {
        await manager.docker.execCommand(containerName, ['tmux', 'kill-session', '-t', sessionName]);
      } else {
        throw new Error(
          `Session already exists: ${sessionName}\n\nUse --reuse to keep it, or --replace to restart it.`
        );
      }
    }

    const clearLog = Boolean(options.clearLog);

    // We intentionally set up `tmux pipe-pane` inside the pane itself (using $TMUX_PANE),
    // so the logging hook is installed before the target command runs.
    const wrapper = [
      'set -euo pipefail',
      // Determine a persistent base dir when possible.
      'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
      `root="$base/dvm-sessions/${sessionName}"`,
      'mkdir -p "$root"',
      'log="$root/output.log"',
      clearLog ? ': > "$log"' : '',
      'touch "$log"',
      // Write a header (directly to log so it exists even if pipe-pane fails).
      `printf "\\n[dvm session %s] started %s\\n" ${JSON.stringify(
        sessionName
      )} "$(date -Is)" >> "$log"`,
      // Best-effort tmux tuning: large scrollback + keep pane on exit.
      `tmux set-option -t "$TMUX_PANE" history-limit ${JSON.stringify(String(history))} || true`,
      'tmux set-option -t "$TMUX_PANE" remain-on-exit on || true',
      // Pipe pane output to a persistent log file (without changing the program's TTY-ness).
      // Note: this command is executed by tmux via /bin/sh -c, so keep it shell-portable.
      `tmux pipe-pane -o -t "$TMUX_PANE" 'if [ -d /dvm-data ]; then b=/dvm-data; else b=/tmp; fi; mkdir -p "$b/dvm-sessions/${sessionName}"; exec cat >> "$b/dvm-sessions/${sessionName}/output.log"' || true`,
      `cd ${JSON.stringify(cwd)}`,
      // Run the target command.
      'exec "$@"',
    ]
      .filter(Boolean)
      .join('\n');

    await manager.docker.execCommand(containerName, [
      'tmux',
      'new-session',
      '-d',
      '-s',
      sessionName,
      'bash',
      '-lc',
      wrapper,
      'dvm-session',
      ...command,
    ]);

    console.log(chalk.green(`Session started: ${sessionName}`));
  }));

sessionCommand
  .command('start')
  .description('Start a persistent session running a command (tmux-backed)')
  .argument('<name>', 'Container name')
  .argument('<session>', 'Session name (safe token: letters/numbers/._-)')
  .argument('<command...>', 'Command to run (use `--` before command args that start with --)')
  .option('-w, --cwd <dir>', 'Working directory inside the container', '/')
  .option('--history <lines>', 'tmux history limit (scrollback lines)', '100000')
  .option('--clear-log', 'Truncate the session log before starting', false)
  .option('--replace', 'If session exists, kill it and recreate', false)
  .option('--reuse', 'If session exists, do nothing (exit 0)', false)
  .action(safeAction(async (name, session, command, options) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(session);
    const cwd = normalizeContainerPath(String(options.cwd || '/'));
    const history = Number(String(options.history || '100000'));
    if (!Number.isInteger(history) || history <= 0) {
      throw new Error(`Invalid --history: ${options.history} (expected a positive integer)`);
    }

    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const exists = await tmuxSessionExists(containerName, sessionName);
    if (exists) {
      if (options.reuse) {
        console.log(chalk.gray(`Session already exists: ${sessionName}`));
        return;
      }
      if (options.replace) {
        await manager.docker.execCommand(containerName, ['tmux', 'kill-session', '-t', sessionName]);
      } else {
        throw new Error(
          `Session already exists: ${sessionName}\n\nUse --reuse to keep it, or --replace to restart it.`
        );
      }
    }

    const clearLog = Boolean(options.clearLog);

    // We intentionally set up `tmux pipe-pane` inside the pane itself (using $TMUX_PANE),
    // so the logging hook is installed before the target command runs.
    const wrapper = [
      'set -euo pipefail',
      // Determine a persistent base dir when possible.
      'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
      `root="$base/dvm-sessions/${sessionName}"`,
      'mkdir -p "$root"',
      'log="$root/output.log"',
      clearLog ? ': > "$log"' : '',
      'touch "$log"',
      // Write a header (directly to log so it exists even if pipe-pane fails).
      `printf "\\n[dvm session %s] started %s\\n" ${JSON.stringify(
        sessionName
      )} "$(date -Is)" >> "$log"`,
      // Best-effort tmux tuning: large scrollback + keep pane on exit.
      `tmux set-option -t "$TMUX_PANE" history-limit ${JSON.stringify(String(history))} || true`,
      'tmux set-option -t "$TMUX_PANE" remain-on-exit on || true',
      // Pipe pane output to a persistent log file (without changing the program's TTY-ness).
      // Note: this command is executed by tmux via /bin/sh -c, so keep it shell-portable.
      `tmux pipe-pane -o -t "$TMUX_PANE" 'if [ -d /dvm-data ]; then b=/dvm-data; else b=/tmp; fi; mkdir -p "$b/dvm-sessions/${sessionName}"; exec cat >> "$b/dvm-sessions/${sessionName}/output.log"' || true`,
      `cd ${JSON.stringify(cwd)}`,
      // Run the target command.
      'exec "$@"',
    ]
      .filter(Boolean)
      .join('\n');

    await manager.docker.execCommand(containerName, [
      'tmux',
      'new-session',
      '-d',
      '-s',
      sessionName,
      'bash',
      '-lc',
      wrapper,
      'dvm-session',
      ...command,
    ]);

    console.log(chalk.green(`Session started: ${sessionName}`));
  }));

sessionCommand
  .command('type')
  .description('Type text/keys into a running session')
  .argument('<name>', 'Container name')
  .argument('<session>', 'Session name')
  .argument('[text...]', 'Text to type (space-joined)')
  .option('--enter', 'Send Enter after text/keys', false)
  .option('--key <key>', 'Send a tmux key name (repeatable), e.g. C-c, Up, Down, Enter, BTab (Shift+Tab)', (v, acc: string[]) => {
    acc.push(normalizeTmuxKeyName(String(v)));
    return acc;
  }, [] as string[])
  .action(safeAction(async (name, session, text, options) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(session);
    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const exists = await tmuxSessionExists(containerName, sessionName);
    if (!exists) {
      throw new Error(`Session not found: ${sessionName}`);
    }

    const joined = Array.isArray(text) && text.length > 0 ? text.map(String).join(' ') : '';
    const keys: string[] = Array.isArray(options.key) ? options.key.map(String) : [];
    const sendArgs: string[] = ['tmux', 'send-keys', '-t', sessionName];
    if (joined) sendArgs.push(joined);
    for (const k of keys) sendArgs.push(k);
    if (options.enter) sendArgs.push('C-m');

    if (sendArgs.length === 4) {
      throw new Error('Nothing to send. Provide [text...] and/or one or more --key, optionally --enter.');
    }

    await manager.docker.execCommand(containerName, sendArgs);
  }));

sessionCommand
  .command('send')
  .description('Send text/keys into a running session (always presses Enter at end)')
  .argument('<name>', 'Container name')
  .argument('<session>', 'Session name')
  .argument('[text...]', 'Text to type (space-joined)')
  .option('--key <key>', 'Send a tmux key name (repeatable), e.g. C-c, Up, Down, Enter, BTab (Shift+Tab)', (v, acc: string[]) => {
    acc.push(normalizeTmuxKeyName(String(v)));
    return acc;
  }, [] as string[])
  .action(safeAction(async (name, session, text, options) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(session);
    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const exists = await tmuxSessionExists(containerName, sessionName);
    if (!exists) {
      throw new Error(`Session not found: ${sessionName}`);
    }

    const joined = Array.isArray(text) && text.length > 0 ? text.map(String).join(' ') : '';
    const keys: string[] = Array.isArray(options.key) ? options.key.map(String) : [];
    const sendArgs: string[] = ['tmux', 'send-keys', '-t', sessionName];
    if (joined) sendArgs.push(joined);
    for (const k of keys) sendArgs.push(k);
    // Unlike `type`, `send` always ends with Enter.
    sendArgs.push('C-m');

    await manager.docker.execCommand(containerName, sendArgs);
  }));

sessionCommand
  .command('read')
  .description('Read session output from its persistent log')
  .argument('<name>', 'Container name')
  .argument('<session>', 'Session name')
  .option('--since <bytes>', 'Return output starting at this byte offset (for incremental reads)')
  .option('--max-bytes <bytes>', 'Cap returned output size in bytes (only with --since)', '200000')
  .option('--tail <lines>', 'Return the last N lines (ignored when --since is provided)', '200')
  .option('--json', 'Output structured JSON: { offsetBytes, text }', false)
  .action(safeAction(async (name, session, options) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(session);
    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const sinceRaw = options.since !== undefined ? String(options.since) : '';
    const since = sinceRaw ? Number(sinceRaw) : null;
    if (since !== null && (!Number.isInteger(since) || since < 0)) {
      throw new Error(`Invalid --since: ${sinceRaw} (expected a non-negative integer)`);
    }

    const maxBytesRaw = String(options.maxBytes || '200000');
    const maxBytes = Number(maxBytesRaw);
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(`Invalid --max-bytes: ${maxBytesRaw} (expected a positive integer)`);
    }

    const tailRaw = String(options.tail || '200');
    const tailLines = Number(tailRaw);
    if (!Number.isInteger(tailLines) || tailLines <= 0) {
      throw new Error(`Invalid --tail: ${tailRaw} (expected a positive integer)`);
    }

    const sizeScript = [
      'set -euo pipefail',
      'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
      `log="$base/dvm-sessions/${sessionName}/output.log"`,
      'if [ -f "$log" ]; then wc -c < "$log"; else echo 0; fi',
    ].join('\n');
    const sizeOut = await manager.docker.execCommand(containerName, ['bash', '-lc', sizeScript]);
    const fileSizeBytes = Number(sizeOut.trim().split('\n').pop() || '0') || 0;

    let textOut = '';
    let nextOffsetBytes = fileSizeBytes;
    if (since !== null) {
      // Incremental read by byte offset.
      const readScript = [
        'set -euo pipefail',
        'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
        `log="$base/dvm-sessions/${sessionName}/output.log"`,
        `since=${JSON.stringify(String(since))}`,
        `max=${JSON.stringify(String(maxBytes))}`,
        'if [ ! -f "$log" ]; then exit 0; fi',
        // tail -c +N is 1-indexed; since is 0-indexed byte offset.
        'start=$((since + 1))',
        // Shell-safe cap: tail then head.
        'tail -c +"$start" "$log" | head -c "$max" || true',
      ].join('\n');
      textOut = await manager.docker.execCommand(containerName, ['bash', '-lc', readScript]);

      // If we cap output size, don't skip unseen bytes: advance by bytes returned.
      // Note: log output is byte-based; use Buffer.byteLength for a UTF-8 safe byte count.
      const returnedBytes = Buffer.byteLength(textOut || '', 'utf8');
      if (since >= fileSizeBytes) {
        nextOffsetBytes = fileSizeBytes;
      } else {
        nextOffsetBytes = Math.min(fileSizeBytes, since + returnedBytes);
      }
    } else {
      // Tail by lines (human-friendly default).
      const readScript = [
        'set -euo pipefail',
        'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
        `log="$base/dvm-sessions/${sessionName}/output.log"`,
        `tail -n ${JSON.stringify(String(tailLines))} "$log" 2>/dev/null || true`,
      ].join('\n');
      textOut = await manager.docker.execCommand(containerName, ['bash', '-lc', readScript]);
    }

    if (options.json) {
      console.log(JSON.stringify({ offsetBytes: nextOffsetBytes, text: textOut }));
    } else {
      if (textOut) process.stdout.write(textOut);
    }
  }));

sessionCommand
  .command('stop')
  .description('Stop a session (kills its tmux session)')
  .argument('<name>', 'Container name')
  .argument('<session>', 'Session name')
  .action(safeAction(async (name, session) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(session);
    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const exists = await tmuxSessionExists(containerName, sessionName);
    if (!exists) {
      console.log(chalk.gray(`Session not found: ${sessionName}`));
      return;
    }

    await manager.docker.execCommand(containerName, ['tmux', 'kill-session', '-t', sessionName]);
    console.log(chalk.green(`Session stopped: ${sessionName}`));
  }));

sessionCommand
  .command('ls')
  .description('List tmux sessions inside the container')
  .argument('<name>', 'Container name')
  .action(safeAction(async (name) => {
    const containerName = String(name);
    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);

    const out = await manager.docker.execCommand(containerName, [
      'bash',
      '-lc',
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || true',
    ]);

    const sessions = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }

    for (const s of sessions) console.log(s);
  }));

sessionCommand
  .command('attach')
  .description('Attach to a session interactively (requires a real TTY)')
  .argument('<name>', 'Container name')
  .argument('<session>', 'Session name')
  .action(safeAction(async (name, session) => {
    const containerName = String(name);
    const sessionName = assertSafeSessionName(session);
    await manager.startContainer(containerName);
    await manager.ensureTmux(containerName);
    await manager.docker.execInteractive(containerName, ['tmux', 'attach', '-t', sessionName]);
  }));

program.addCommand(sessionCommand);

// Parse arguments
program.parse();
