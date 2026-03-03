import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import { BaseConfigManager } from './config/base';
import { ConfigLoader } from './config/loader';
import { ContainerManager } from './container/manager';
import { ContainerConfig, PortMapping, VolumeMount } from './docker/client';

export type DvmRunResult = { code: number; stdout: string; stderr: string };

export type DvmCreateContainerOptions = {
  image?: string;
  useConfiguredBaseImage?: boolean;
  ports?: PortMapping[];
  network?: string;
  createNetwork?: boolean;
  persist?: boolean;
  environment?: string[];
  volumes?: VolumeMount[];
  configPath?: string;
  start?: boolean;
};

export type DvmCloneContainerOptions = {
  start?: boolean;
  reuseNamedVolumes?: boolean;
  copyPersistenceVolume?: boolean;
};

export type DvmRenameContainerOptions = {
  startMode?: 'preserve' | 'always' | 'never';
  migrateVolumeName?: boolean;
};

export type DvmSessionStartOptions = {
  cwd?: string;
  history?: number;
  clearLog?: boolean;
  replace?: boolean;
  reuse?: boolean;
};

export type DvmSessionTypeOptions = {
  text?: string;
  keys?: string[];
  enter?: boolean;
};

export type DvmSessionReadOptions = {
  since?: number;
  maxBytes?: number;
  tailLines?: number;
};

export type DvmCopyToContainerOptions = {
  clean?: boolean;
};

export type DvmRepoSeedOptions = {
  containerName: string;
  hostRepoPath: string;
  destinationPath?: string;
  bundlePathInContainer?: string;
  baseRef?: string;
  createIfMissing?: boolean;
  createOptions?: DvmCreateContainerOptions;
  branch?: string;
  forceBranch?: boolean;
  clean?: boolean;
};

export type DvmRepoExportFormat = 'patches' | 'bundle' | 'diff';

export type DvmRepoExportOptions = {
  containerName: string;
  repoPathInContainer?: string;
  outRoot: string;
  format?: DvmRepoExportFormat;
  base?: string;
};

export class DvmApi {
  private readonly manager: ContainerManager;
  private readonly baseConfig: BaseConfigManager;

  constructor(opts?: { manager?: ContainerManager; baseConfig?: BaseConfigManager }) {
    this.manager = opts?.manager ?? new ContainerManager();
    this.baseConfig = opts?.baseConfig ?? new BaseConfigManager();
  }

  private normalizeContainerPath(raw: string): string {
    const s = String(raw || '').trim();
    if (!s) return '/';
    return s.startsWith('/') ? s : `/${s}`;
  }

  private safeSlug(input: string): string {
    return (
      String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'repo'
    );
  }

  private async runLocal(cmd: string, args: string[], options?: { cwd?: string }): Promise<string> {
    const cwd = options?.cwd;
    return await new Promise((resolve, reject) => {
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

  private async hostBestRemoteUrl(hostRepoPath: string): Promise<string | null> {
    const candidates = ['origin', 'upstream'];
    for (const remote of candidates) {
      const out = (await this.runLocal('git', ['-C', hostRepoPath, 'remote', 'get-url', remote]).catch(() => '')).trim();
      if (out) return out;
    }
    const first = (await this.runLocal('git', ['-C', hostRepoPath, 'remote']).catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0];
    if (!first) return null;
    const out = (await this.runLocal('git', ['-C', hostRepoPath, 'remote', 'get-url', first]).catch(() => '')).trim();
    return out || null;
  }

  private assertSafeSessionName(raw: string): string {
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

  private normalizeTmuxKeyName(raw: string): string {
    const s = String(raw ?? '').trim();
    if (!s) return s;

    const lower = s.toLowerCase();
    if (lower === 'shift+tab' || lower === 'shift-tab' || lower === 'shift_tab') return 'BTab';
    if (lower === 'shift tab' || lower === 'shift\tab') return 'BTab';
    if (lower === 'btab' || lower === 'b tab') return 'BTab';
    if (lower === 'backtab' || lower === 'back-tab' || lower === 'back_tab') return 'BTab';
    if (lower === 's-tab' || lower === 's_tab' || lower === 'stab') return 'BTab';

    const direct: Record<string, string> = {
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

  private async tmuxSessionExists(containerName: string, sessionName: string): Promise<boolean> {
    const script = `tmux has-session -t ${JSON.stringify(sessionName)} 2>/dev/null && echo yes || echo no`;
    const out = await this.manager.docker.execCommand(containerName, ['bash', '-lc', script]);
    return out.trim().split('\n').pop() === 'yes';
  }

  private async buildContainerConfig(
    containerName: string,
    options: DvmCreateContainerOptions = {}
  ): Promise<{ config: ContainerConfig; usingConfiguredBaseImage: boolean }> {
    let config: ContainerConfig;

    const useConfiguredBaseImage = options.useConfiguredBaseImage !== false;
    let imageToUse = options.image;
    let usingConfiguredBaseImage = false;
    if (!imageToUse) {
      if (useConfiguredBaseImage) {
        const base = await this.baseConfig.getBase();
        if (base?.image) {
          imageToUse = base.image;
          usingConfiguredBaseImage = true;
        } else {
          imageToUse = 'ubuntu:latest';
        }
      } else {
        imageToUse = 'ubuntu:latest';
      }
    }

    if (options.configPath) {
      config = await ConfigLoader.loadFromFile(options.configPath);
      config.name = containerName;

      if (options.network) {
        config.network = String(options.network);
      }

      if (!options.image && !config.image && useConfiguredBaseImage) {
        const base = await this.baseConfig.getBase();
        if (base?.image) {
          config.image = base.image;
          usingConfiguredBaseImage = true;
        }
      } else if (options.image) {
        config.image = options.image;
      }

      if (options.ports) config.ports = options.ports;
      if (options.environment) config.environment = options.environment;
      if (options.volumes) config.volumes = options.volumes;
      if (options.persist === false) {
        config.persistence = { enabled: false, path: '/dvm-data' };
      }
    } else {
      config = ConfigLoader.createDefaultConfig(containerName, imageToUse);
      if (options.network) config.network = String(options.network);
      if (options.ports) config.ports = options.ports;
      if (options.environment) config.environment = options.environment;
      if (options.volumes) config.volumes = options.volumes;
      if (options.persist === false) {
        config.persistence = { enabled: false, path: '/dvm-data' };
      }
    }

    if (config.network && options.createNetwork) {
      await this.manager.docker.ensureNetwork(config.network);
    }

    return { config, usingConfiguredBaseImage };
  }

  async createContainer(containerName: string, options: DvmCreateContainerOptions = {}): Promise<void> {
    const { config, usingConfiguredBaseImage } = await this.buildContainerConfig(containerName, options);
    await this.manager.createContainer(config, options.start !== false, {
      skipProvisioning: usingConfiguredBaseImage,
    });
  }

  async cloneContainer(sourceName: string, containerName: string, options: DvmCloneContainerOptions = {}): Promise<void> {
    await this.manager.cloneContainer(sourceName, containerName, {
      start: options.start,
      copyPersistenceVolume: options.copyPersistenceVolume,
      reuseNamedVolumes: options.reuseNamedVolumes,
    });
  }

  async listContainerNames(options?: { all?: boolean }): Promise<string[]> {
    return await this.manager.listDvmContainerNames(options?.all !== false);
  }

  async getContainerPorts(containerName: string): Promise<Array<{ hostPort: number; containerPort: number }>> {
    const details = await this.manager.docker.getContainerDetails(containerName);
    if (!details) {
      throw new Error(`Container ${containerName} not found`);
    }
    return (details.ports ?? [])
      .filter((p) => typeof p.hostPort === 'number' && Number.isFinite(p.hostPort))
      .map((p) => ({ hostPort: Number(p.hostPort), containerPort: Number(p.containerPort) }))
      .filter((p) => Number.isFinite(p.hostPort) && Number.isFinite(p.containerPort));
  }

  async exec(containerName: string, cmd: string, args: string[] = [], options?: { timeoutMs?: number }): Promise<DvmRunResult> {
    try {
      return await this.manager.docker.execCommandDetailed(containerName, [cmd, ...args], { timeoutMs: options?.timeoutMs });
    } catch (error: any) {
      return { code: 1, stdout: '', stderr: error?.message ?? String(error) };
    }
  }

  async removeContainer(containerName: string, options?: { keepVolume?: boolean }): Promise<void> {
    await this.manager.removeContainer(containerName, !options?.keepVolume);
  }

  async stopContainer(containerName: string): Promise<void> {
    await this.manager.stopContainer(containerName);
  }

  async startContainer(containerName: string): Promise<void> {
    await this.manager.startContainer(containerName);
  }

  async renameContainer(oldName: string, newName: string, options?: DvmRenameContainerOptions): Promise<void> {
    await this.manager.renameContainer(oldName, newName, {
      startMode: options?.startMode ?? 'preserve',
      migrateVolumeName: Boolean(options?.migrateVolumeName),
    });

    const base = await this.baseConfig.getBase();
    if (base?.containerName === String(oldName)) {
      await this.baseConfig.setBase(String(newName), base.image);
    }
  }

  async sessionStart(
    containerName: string,
    session: string,
    cmd: string,
    args: string[] = [],
    options: DvmSessionStartOptions = {}
  ): Promise<void> {
    const sessionName = this.assertSafeSessionName(session);
    const cwd = this.normalizeContainerPath(String(options.cwd || '/'));
    const history = Number(String(options.history ?? '100000'));
    if (!Number.isInteger(history) || history <= 0) {
      throw new Error(`Invalid history: ${options.history} (expected a positive integer)`);
    }

    await this.manager.startContainer(containerName);
    await this.manager.ensureTmux(containerName);

    const exists = await this.tmuxSessionExists(containerName, sessionName);
    if (exists) {
      if (options.reuse) return;
      if (options.replace) {
        await this.manager.docker.execCommand(containerName, ['tmux', 'kill-session', '-t', sessionName]);
      } else {
        throw new Error(`Session already exists: ${sessionName}\n\nUse reuse=true to keep it, or replace=true to restart it.`);
      }
    }

    const clearLog = Boolean(options.clearLog);
    const wrapper = [
      'set -euo pipefail',
      'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
      `root="$base/dvm-sessions/${sessionName}"`,
      'mkdir -p "$root"',
      'log="$root/output.log"',
      clearLog ? ': > "$log"' : '',
      'touch "$log"',
      `printf "\\n[dvm session %s] started %s\\n" ${JSON.stringify(
        sessionName
      )} "$(date -Is)" >> "$log"`,
      `tmux set-option -t "$TMUX_PANE" history-limit ${JSON.stringify(String(history))} || true`,
      'tmux set-option -t "$TMUX_PANE" remain-on-exit on || true',
      `tmux pipe-pane -o -t "$TMUX_PANE" 'if [ -d /dvm-data ]; then b=/dvm-data; else b=/tmp; fi; mkdir -p "$b/dvm-sessions/${sessionName}"; exec cat >> "$b/dvm-sessions/${sessionName}/output.log"' || true`,
      `cd ${JSON.stringify(cwd)}`,
      'exec "$@"',
    ]
      .filter(Boolean)
      .join('\n');

    await this.manager.docker.execCommand(containerName, [
      'tmux',
      'new-session',
      '-d',
      '-s',
      sessionName,
      'bash',
      '-lc',
      wrapper,
      'dvm-session',
      cmd,
      ...args,
    ]);
  }

  async sessionSend(containerName: string, session: string, text: string, options?: { keys?: string[] }): Promise<void> {
    await this.sessionType(containerName, session, { text, keys: options?.keys, enter: true });
  }

  async sessionType(containerName: string, session: string, options: DvmSessionTypeOptions): Promise<void> {
    const sessionName = this.assertSafeSessionName(session);
    await this.manager.startContainer(containerName);
    await this.manager.ensureTmux(containerName);

    const exists = await this.tmuxSessionExists(containerName, sessionName);
    if (!exists) {
      throw new Error(`Session not found: ${sessionName}`);
    }

    const text = typeof options?.text === 'string' ? options.text : '';
    const keys = Array.isArray(options?.keys)
      ? options.keys.map((k) => this.normalizeTmuxKeyName(String(k))).filter(Boolean)
      : [];
    const sendArgs: string[] = ['tmux', 'send-keys', '-t', sessionName];
    if (text) sendArgs.push(text);
    for (const k of keys) sendArgs.push(k);
    if (options?.enter) sendArgs.push('C-m');

    if (sendArgs.length === 4) {
      throw new Error('Nothing to send. Provide text and/or keys.');
    }

    await this.manager.docker.execCommand(containerName, sendArgs);
  }

  async sessionRead(
    containerName: string,
    session: string,
    options: DvmSessionReadOptions = {}
  ): Promise<{ offsetBytes: number; text: string }> {
    const sessionName = this.assertSafeSessionName(session);
    await this.manager.startContainer(containerName);
    await this.manager.ensureTmux(containerName);

    const since = options.since != null ? Number(options.since) : null;
    if (since !== null && (!Number.isInteger(since) || since < 0)) {
      throw new Error(`Invalid since: ${options.since} (expected a non-negative integer)`);
    }

    const maxBytes = Number(options.maxBytes ?? 200000);
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(`Invalid maxBytes: ${options.maxBytes} (expected a positive integer)`);
    }

    const tailLines = Number(options.tailLines ?? 200);
    if (!Number.isInteger(tailLines) || tailLines <= 0) {
      throw new Error(`Invalid tailLines: ${options.tailLines} (expected a positive integer)`);
    }

    const sizeScript = [
      'set -euo pipefail',
      'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
      `log="$base/dvm-sessions/${sessionName}/output.log"`,
      'if [ -f "$log" ]; then wc -c < "$log"; else echo 0; fi',
    ].join('\n');
    const sizeOut = await this.manager.docker.execCommand(containerName, ['bash', '-lc', sizeScript]);
    const fileSizeBytes = Number(sizeOut.trim().split('\n').pop() || '0') || 0;

    let textOut = '';
    let nextOffsetBytes = fileSizeBytes;
    if (since !== null) {
      const readScript = [
        'set -euo pipefail',
        'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
        `log="$base/dvm-sessions/${sessionName}/output.log"`,
        `since=${JSON.stringify(String(since))}`,
        `max=${JSON.stringify(String(maxBytes))}`,
        'if [ ! -f "$log" ]; then exit 0; fi',
        'start=$((since + 1))',
        'tail -c +"$start" "$log" | head -c "$max" || true',
      ].join('\n');
      textOut = await this.manager.docker.execCommand(containerName, ['bash', '-lc', readScript]);

      const returnedBytes = Buffer.byteLength(textOut || '', 'utf8');
      if (since >= fileSizeBytes) {
        nextOffsetBytes = fileSizeBytes;
      } else {
        nextOffsetBytes = Math.min(fileSizeBytes, since + returnedBytes);
      }
    } else {
      const readScript = [
        'set -euo pipefail',
        'if [ -d /dvm-data ]; then base=/dvm-data; else base=/tmp; fi',
        `log="$base/dvm-sessions/${sessionName}/output.log"`,
        `tail -n ${JSON.stringify(String(tailLines))} "$log" 2>/dev/null || true`,
      ].join('\n');
      textOut = await this.manager.docker.execCommand(containerName, ['bash', '-lc', readScript]);
    }

    return { offsetBytes: nextOffsetBytes, text: textOut };
  }

  async runScript(containerName: string, scriptPath: string, args: string[] = []): Promise<void> {
    await this.manager.runLocalScript(containerName, scriptPath, args, {});
  }

  async copyToContainer(
    containerName: string,
    srcPath: string,
    destPath: string,
    options: DvmCopyToContainerOptions = {}
  ): Promise<void> {
    const absSrc = path.resolve(String(srcPath));
    const target = String(destPath);

    await this.manager.docker.execCommand(containerName, ['bash', '-lc', 'true']);
    await this.manager.docker.execCommand(containerName, ['bash', '-lc', `mkdir -p ${JSON.stringify(target)}`]);

    if (options.clean) {
      await this.manager.docker.execCommand(containerName, ['bash', '-lc', `rm -rf ${JSON.stringify(target)}`]);
      await this.manager.docker.execCommand(containerName, ['bash', '-lc', `mkdir -p ${JSON.stringify(target)}`]);
    }

    await this.manager.docker.copyToContainer(containerName, absSrc, target);
  }

  private async ensureContainerExistsOrCreate(
    containerName: string,
    createIfMissing: boolean,
    options?: DvmCreateContainerOptions
  ): Promise<void> {
    const exists = await this.manager.docker.containerExists(containerName);
    if (exists) {
      await this.manager.startContainer(containerName);
      return;
    }

    if (!createIfMissing) {
      throw new Error(`Container ${containerName} not found (create it first, or set createIfMissing=true)`);
    }

    await this.createContainer(containerName, options);
  }

  async repoSeed(options: DvmRepoSeedOptions): Promise<{ baseSha: string; destinationPath: string }> {
    let tmpDir: string | null = null;
    let tmpBundle: string | null = null;
    try {
      const containerName = String(options.containerName);
      const hostRepoPath = path.resolve(String(options.hostRepoPath || process.cwd()));
      const dest = this.normalizeContainerPath(String(options.destinationPath || '/work/repo'));
      const bundlePathInContainer = this.normalizeContainerPath(String(options.bundlePathInContainer || '/tmp/dvm-repo.bundle'));

      await this.runLocal('git', ['-C', hostRepoPath, 'rev-parse', '--is-inside-work-tree']);
      const baseSha = (await this.runLocal('git', ['-C', hostRepoPath, 'rev-parse', String(options.baseRef || 'HEAD')])).trim();
      const hostRemoteUrl = await this.hostBestRemoteUrl(hostRepoPath);

      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `dvm-bundle-${this.safeSlug(containerName)}-`));
      tmpBundle = path.join(tmpDir, 'repo.bundle');
      await this.runLocal('git', ['-C', hostRepoPath, 'bundle', 'create', tmpBundle, '--all']);

      await this.ensureContainerExistsOrCreate(containerName, options.createIfMissing !== false, options.createOptions);
      await this.manager.ensureGit(containerName);

      await this.manager.docker.execCommand(containerName, [
        'sh',
        '-lc',
        `mkdir -p ${JSON.stringify(path.posix.dirname(bundlePathInContainer))}`,
      ]);
      await this.manager.docker.copyToContainer(containerName, tmpBundle, bundlePathInContainer);

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
        `cd ${JSON.stringify(dest)} && git config dvm.baseSha ${JSON.stringify(baseSha)}`,
        remoteCmd,
        branchCmd,
      ]
        .filter(Boolean)
        .join('\n');

      await this.manager.docker.execCommand(containerName, ['bash', '-lc', cloneScript]);
      return { baseSha, destinationPath: dest };
    } finally {
      try {
        if (tmpBundle) await fs.promises.rm(tmpBundle, { force: true });
      } catch {
        // ignore
      }
      try {
        if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  async repoExport(options: DvmRepoExportOptions): Promise<{ exportedPath: string; base: string }> {
    const format = options.format ?? 'patches';
    if (format !== 'patches' && format !== 'bundle' && format !== 'diff') {
      throw new Error(`Unsupported format: ${format} (expected: patches|bundle|diff)`);
    }

    const { localOut, base } = await this.repoExportFromContainer({
      containerName: String(options.containerName),
      repoPathInContainer: this.normalizeContainerPath(String(options.repoPathInContainer || '/work/repo')),
      outRoot: path.resolve(String(options.outRoot)),
      format,
      base: options.base ? String(options.base) : undefined,
    });

    return { exportedPath: localOut, base };
  }

  private async repoExportFromContainer(options: {
    containerName: string;
    repoPathInContainer: string;
    outRoot: string;
    format: DvmRepoExportFormat;
    base?: string;
  }): Promise<{ localOut: string; base: string }> {
    const containerName = options.containerName;
    const repoPath = this.normalizeContainerPath(options.repoPathInContainer);
    const outRoot = path.resolve(options.outRoot);
    const format = options.format;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    await fs.promises.mkdir(outRoot, { recursive: true });

    await this.manager.startContainer(containerName);
    await this.manager.ensureGit(containerName);

    let base = options.base ? String(options.base) : '';
    if (!base) {
      const readBase = await this.manager.docker.execCommand(containerName, [
        'bash',
        '-lc',
        [`cd ${JSON.stringify(repoPath)}`, `git config --get dvm.baseSha 2>/dev/null || true`].join('\n'),
      ]);
      base =
        readBase
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)[0] || '';
    }
    if (!base) {
      throw new Error(`Missing base and could not read git config dvm.baseSha from ${repoPath}`);
    }

    const containerTmp = `/tmp/dvm-repo-export-${this.safeSlug(containerName)}-${Date.now().toString(36)}`;
    const localOut = path.join(outRoot, `${format}-${this.safeSlug(containerName)}-${stamp}`);

    if (format === 'patches') {
      const patchDir = `${containerTmp}/patches`;
      const script = [
        'set -euo pipefail',
        `rm -rf ${JSON.stringify(containerTmp)}`,
        `mkdir -p ${JSON.stringify(patchDir)}`,
        `cd ${JSON.stringify(repoPath)}`,
        `git format-patch -o ${JSON.stringify(patchDir)} ${JSON.stringify(`${base}..HEAD`)}`,
      ].join('\n');
      await this.manager.docker.execCommand(containerName, ['bash', '-lc', script]);
      await this.manager.docker.copyFromContainer(containerName, patchDir, localOut);
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
      await this.manager.docker.execCommand(containerName, ['bash', '-lc', script]);
      await this.manager.docker.copyFromContainer(containerName, bundleFile, localOut);
      return { localOut, base };
    }

    const diffFile = `${containerTmp}/changes.diff`;
    const script = [
      'set -euo pipefail',
      `rm -rf ${JSON.stringify(containerTmp)}`,
      `mkdir -p ${JSON.stringify(containerTmp)}`,
      `cd ${JSON.stringify(repoPath)}`,
      `git diff ${JSON.stringify(`${base}..HEAD`)} > ${JSON.stringify(diffFile)}`,
    ].join('\n');
    await this.manager.docker.execCommand(containerName, ['bash', '-lc', script]);
    await this.manager.docker.copyFromContainer(containerName, diffFile, localOut);
    return { localOut, base };
  }

  async setBaseImage(containerName: string): Promise<{ baseImage: string }> {
    const name = String(containerName ?? '').trim();
    if (!name) throw new Error('missing container name');

    const exists = await this.manager.docker.containerExists(name);
    if (!exists) {
      throw new Error(`Container ${name} not found`);
    }

    const image = await this.manager.docker.getContainerImage(name);
    if (!image) {
      throw new Error(`Could not determine image for container ${name}`);
    }

    const baseImageName = `dvm-base-${name}`;
    const committedImage = await this.manager.docker.commitContainer(name, baseImageName);
    await this.baseConfig.setBase(name, committedImage);
    return { baseImage: committedImage };
  }
}

export function createDvmApi(): DvmApi {
  return new DvmApi();
}
