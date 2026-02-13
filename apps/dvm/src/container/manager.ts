import Docker from 'dockerode';
import chalk from 'chalk';
import * as tar from 'tar';
import { DockerClient, ContainerConfig } from '../docker/client';
import { GuiInstaller } from '../gui/installer';
import { dvmRootPath } from '../hostPaths';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type DvmExportManifestV1 = {
  schemaVersion: 1;
  exportedAt: string;
  containerName: string;
  imageRef: string;
  networks?: string[];
  environment?: string[];
  ports?: Array<{ containerPort: number; hostPort?: number }>;
  persistence?: { enabled: boolean; volumeName?: string; path?: string };
  notes?: string[];
};

export class ContainerManager {
  public docker: DockerClient;
  private guiInstaller: GuiInstaller;

  constructor() {
    this.docker = new DockerClient();
    this.guiInstaller = new GuiInstaller(this.docker);
  }

  private isTruthyLabel(value: unknown): boolean {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  private isDvmManagedInfo(info: Docker.ContainerInfo): boolean {
    return this.isTruthyLabel(info.Labels?.[DockerClient.DVM_MANAGED_LABEL_KEY]);
  }

  private resolvePersistenceFromInspect(
    inspect: Docker.ContainerInspectInfo
  ): { volumeName: string | null; mountPath: string } {
    const labels = inspect?.Config?.Labels ?? {};
    const labeledVolume = String(labels[DockerClient.DVM_PERSISTENCE_VOLUME_LABEL_KEY] ?? '').trim();
    const labeledPath = String(labels[DockerClient.DVM_PERSISTENCE_PATH_LABEL_KEY] ?? '').trim();
    const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];

    const matchedMount = mounts.find((m) => {
      if (!m || m.Type !== 'volume') return false;
      if (labeledVolume && m.Name === labeledVolume) return true;
      if (labeledPath && m.Destination === labeledPath) return true;
      return false;
    });

    const volumeName = labeledVolume || (matchedMount?.Name ? String(matchedMount.Name).trim() : '');
    const mountPath = labeledPath || (matchedMount?.Destination ? String(matchedMount.Destination).trim() : '') || '/dvm-data';
    return { volumeName: volumeName || null, mountPath };
  }

  async createContainer(
    config: ContainerConfig,
    start = true,
    options?: {
      /**
       * If true, do not run any post-create provisioning inside the container
       * (no package installs, no GUI install/start).
       *
       * Intended for "clone from base image" flows where the image already
       * contains everything needed.
       */
      skipProvisioning?: boolean;
    }
  ): Promise<void> {
    // Check if container already exists
    const exists = await this.docker.containerExists(config.name);
    if (exists) {
      throw new Error(`Container ${config.name} already exists`);
    }

    // Ensure GUI ports are included:
    // - 3389: XRDP (RDP clients)
    // - 6080: noVNC (browser)
    const hasRdpPort = config.ports.some((p) => p.containerPort === 3389);
    if (!hasRdpPort) {
      config.ports.push({ containerPort: 3389 });
    }
    const hasNoVncPort = config.ports.some((p) => p.containerPort === 6080);
    if (!hasNoVncPort) {
      config.ports.push({ containerPort: 6080 });
    }

    // Resolve port conflicts
    const resolvedPorts = await this.resolvePorts(config.ports);

    // Create container
    const container = await this.docker.createContainer({
      ...config,
      ports: resolvedPorts,
    });

    if (start) {
      await this.docker.startContainer(config.name);

      const skipProvisioning = Boolean(options?.skipProvisioning);
      if (!skipProvisioning) {
        // Ensure baseline prerequisites exist for common setup scripts.
        // Many installers expect curl to be present (even on slim base images).
        try {
          await this.ensureCurl(config.name);
        } catch (error) {
          console.warn(`Warning: Failed to ensure curl is installed: ${error}`);
          // Don't fail container creation if this step fails
        }

        // For the default Ubuntu-based flow (when no configured base image is used),
        // ensure Node.js + Yarn are available globally.
        //
        // This makes the out-of-the-box `ubuntu:latest` experience usable for JS tooling.
        try {
          await this.ensureNodeAndYarnUbuntu(config.name, config.image);
        } catch (error) {
          console.warn(`Warning: Failed to ensure Node.js/Yarn is installed: ${error}`);
          // Don't fail container creation if this step fails
        }

        // Install GUI by default (this will also start the service if already installed)
        try {
          await this.guiInstaller.installGui(config.name);
        } catch (error) {
          console.warn(`Warning: Failed to install/start GUI: ${error}`);
          // Don't fail container creation if GUI installation fails
        }
      }
    }
  }

  async cloneContainer(
    sourceName: string,
    newName: string,
    options?: {
      /** Start the new container. Defaults to true. */
      start?: boolean;
      /**
       * If true, also reuse named volumes from the source container (besides the dvm persistence volume).
       * Default: false (bind mounts are preserved; named volumes are not copied or reused).
       */
      reuseNamedVolumes?: boolean;
    }
  ): Promise<void> {
    const start = options?.start !== false;

    // Validate source exists and destination does not.
    const sourceExists = await this.docker.containerExists(sourceName);
    if (!sourceExists) {
      throw new Error(`Source container ${sourceName} not found`);
    }
    const destExists = await this.docker.containerExists(newName);
    if (destExists) {
      throw new Error(`Container ${newName} already exists`);
    }

    const sourceContainer = await this.docker.getContainer(sourceName);
    if (!sourceContainer) {
      throw new Error(`Source container ${sourceName} not found`);
    }

    const inspect = await sourceContainer.inspect();
    const details = await this.docker.getContainerDetails(sourceName);
    if (!details) {
      throw new Error(`Could not inspect source container ${sourceName}`);
    }

    // Preserve network attachments (best-effort). If multiple networks exist,
    // we will create the container on the first one, and then connect the rest.
    const sourceNetworks = await this.docker.getContainerNetworkNames(sourceName);

    // Commit the container to an image (filesystem state).
    const now = Date.now().toString(36);
    const safeSource = sourceName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
    const safeDest = newName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'clone';
    const repo = `dvm-clone-${safeSource}`;
    const tag = `${safeDest}-${now}`;
    const committedImage = await this.docker.commitContainer(sourceName, repo, tag);

    // Preserve bind mounts. For named volumes: by default we do NOT reuse/copy them
    // (committing does not include volume data), but we can optionally reuse them.
    const volumes: ContainerConfig['volumes'] = [];
    const reuseNamedVolumes = Boolean(options?.reuseNamedVolumes);

    const sourcePersistence = this.resolvePersistenceFromInspect(inspect);
    const sourcePersistenceVolumeName = sourcePersistence.volumeName;
    const persistencePath = sourcePersistence.mountPath;

    for (const m of inspect.Mounts || []) {
      if (!m || !m.Type) continue;
      if (m.Type === 'bind' && m.Source && m.Destination) {
        volumes.push({ source: m.Source, target: m.Destination, type: 'bind' });
      } else if (reuseNamedVolumes && m.Type === 'volume' && m.Name && m.Destination) {
        // Skip the dvm persistence volume: the clone should get its own new persistence volume.
        if (sourcePersistenceVolumeName && m.Name === sourcePersistenceVolumeName) continue;
        volumes.push({ source: m.Name, target: m.Destination, type: 'volume' });
      }
    }

    const config: ContainerConfig = {
      name: newName,
      image: committedImage,
      network: sourceNetworks[0],
      ports: details.ports ?? [],
      environment: inspect.Config?.Env,
      volumes: volumes.length > 0 ? volumes : undefined,
      // Always create a fresh persistence volume for the clone.
      persistence: { enabled: true, path: persistencePath },
    };

    // Create a "pure" clone: no in-container installs/provisioning.
    await this.createContainer(config, start, { skipProvisioning: true });

    // Connect to any additional networks (after start). Best-effort.
    for (const net of sourceNetworks.slice(1)) {
      try {
        await this.docker.connectNetwork(net, newName);
      } catch {
        // ignore if connect fails
      }
    }
  }

  async purgeContainers(options?: {
    /** If true, include the configured base container (if any). Default: false. */
    includeBase?: boolean;
    /** The configured base container name (if any). */
    baseContainerName?: string;
    /** If true, only print what would be removed. Default: false. */
    dryRun?: boolean;
  }): Promise<{ removed: string[]; skippedBase: boolean }> {
    const includeBase = Boolean(options?.includeBase);
    const dryRun = Boolean(options?.dryRun);
    const baseName = options?.baseContainerName;

    const containers = await this.docker.listContainers(true);
    const removed: string[] = [];
    let skippedBase = false;

    // Helper: container name from dockerode ContainerInfo.Names
    const getName = (c: Docker.ContainerInfo): string | null => {
      const n = c.Names?.[0];
      return n ? n.replace(/^\//, '') : null;
    };

    const isExplicitBase = (name: string) => Boolean(baseName && name === baseName);

    for (const c of containers) {
      const name = getName(c);
      if (!name) continue;

      if (!includeBase && isExplicitBase(name)) {
        skippedBase = true;
        continue;
      }

      const eligible = isExplicitBase(name) || this.isDvmManagedInfo(c);
      if (!eligible) continue;

      if (dryRun) {
        removed.push(name);
        continue;
      }

      let persistenceVolumeName: string | null = null;
      try {
        const container = await this.docker.getContainer(name);
        if (container) {
          const inspect = await container.inspect();
          persistenceVolumeName = this.resolvePersistenceFromInspect(inspect).volumeName;
        }
      } catch {
        // ignore
      }

      try {
        await this.docker.removeContainer(name, true);
      } catch (error) {
        console.warn(`Warning: Failed to remove container ${name}: ${error}`);
      }

      if (persistenceVolumeName) {
        try {
          await this.docker.removeVolume(persistenceVolumeName, true);
        } catch {
          // ignore if it doesn't exist
        }
      }

      removed.push(name);
    }

    return { removed, skippedBase };
  }

  async exposePorts(
    containerName: string,
    portsToExpose: ContainerConfig['ports'],
    options?: {
      /** Start container after recreating. Default: true. */
      start?: boolean;
    }
  ): Promise<void> {
    const start = options?.start !== false;

    const exists = await this.docker.containerExists(containerName);
    if (!exists) {
      throw new Error(`Container ${containerName} not found`);
    }

    const container = await this.docker.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const inspect = await container.inspect();
    const details = await this.docker.getContainerDetails(containerName);
    if (!details) {
      throw new Error(`Could not inspect container ${containerName}`);
    }

    // Preserve network attachments (best-effort). If multiple networks exist,
    // we will create the container on the first one, and then connect the rest.
    const existingNetworks = await this.docker.getContainerNetworkNames(containerName);

    // Commit current filesystem state.
    const now = Date.now().toString(36);
    const safeName = containerName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'container';
    const repo = `dvm-expose-${safeName}`;
    const tag = `ports-${now}`;
    const committedImage = await this.docker.commitContainer(containerName, repo, tag);

    // Merge existing port mappings with requested ones (requested wins).
    const byContainerPort = new Map<number, { containerPort: number; hostPort?: number }>();
    for (const p of details.ports ?? []) byContainerPort.set(p.containerPort, { ...p });
    for (const p of portsToExpose ?? []) byContainerPort.set(p.containerPort, { ...p });
    const mergedPorts = Array.from(byContainerPort.values());

    // Preserve mounts (bind + named volumes), keeping dvm persistence as persistence.
    const volumes: ContainerConfig['volumes'] = [];
    const persistence = this.resolvePersistenceFromInspect(inspect);
    const persistenceVolumeName = persistence.volumeName;
    const persistencePath = persistence.mountPath;

    for (const m of inspect.Mounts || []) {
      if (!m || !m.Type) continue;
      if (m.Type === 'bind' && m.Source && m.Destination) {
        volumes.push({ source: m.Source, target: m.Destination, type: 'bind' });
      } else if (m.Type === 'volume' && m.Name && m.Destination) {
        if (persistenceVolumeName && m.Name === persistenceVolumeName) continue;
        volumes.push({ source: m.Name, target: m.Destination, type: 'volume' });
      }
    }

    // Stop/remove old container (volume data remains by default).
    try {
      await this.docker.stopContainer(containerName);
    } catch {
      // ignore
    }
    await this.docker.removeContainer(containerName, true);

    // Recreate with same name, new ports, same mounts/env, and no provisioning.
    const config: ContainerConfig = {
      name: containerName,
      image: committedImage,
      network: existingNetworks[0],
      ports: mergedPorts,
      environment: inspect.Config?.Env,
      volumes: volumes.length ? volumes : undefined,
      persistence: {
        enabled: Boolean(persistenceVolumeName),
        path: persistencePath,
        ...(persistenceVolumeName ? { volumeName: persistenceVolumeName } : {}),
      },
    };

    await this.createContainer(config, start, { skipProvisioning: true });

    // Re-connect to additional networks (after start). Best-effort.
    for (const net of existingNetworks.slice(1)) {
      try {
        await this.docker.connectNetwork(net, containerName);
      } catch {
        // ignore
      }
    }
  }

  async startContainer(name: string): Promise<void> {
    await this.docker.startContainer(name);
  }

  async pauseContainer(name: string): Promise<void> {
    await this.docker.pauseContainer(name);
  }

  async unpauseContainer(name: string): Promise<void> {
    await this.docker.unpauseContainer(name);
  }

  async stopContainer(name: string): Promise<void> {
    await this.docker.stopContainer(name);
  }

  /**
   * Remove a container. By default this also removes the dvm persistence volume
   * referenced by the container's metadata so removal is "complete".
   */
  async removeContainer(name: string, clean = true): Promise<void> {
    const container = await this.docker.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }
    const inspect = await container.inspect();
    const persistence = this.resolvePersistenceFromInspect(inspect);

    // Stop container first if running
    try {
      await this.docker.stopContainer(name);
    } catch (error) {
      // Ignore if already stopped
    }

    // Remove container
    await this.docker.removeContainer(name, true);

    // Remove volume if clean flag is set
    if (clean && persistence.volumeName) {
      const volumeName = persistence.volumeName;
      try {
        await this.docker.removeVolume(volumeName, true);
      } catch (error) {
        // Volume might not exist or already removed
        console.warn(`Warning: Could not remove volume ${volumeName}: ${error}`);
      }
    }
  }

  // By default, include stopped containers (so users can see conflicts like "already exists").
  async listContainers(all = true): Promise<void> {
    const containers = await this.docker.listContainers(all);

    const getName = (c: Docker.ContainerInfo): string | null => {
      const n = c.Names?.[0];
      return n ? n.replace(/^\//, '') : null;
    };

    const dvmContainers: Docker.ContainerInfo[] = [];
    for (const c of containers) {
      const name = getName(c);
      if (!name) continue;
      if (this.isDvmManagedInfo(c)) dvmContainers.push(c);
    }

    if (dvmContainers.length === 0) {
      console.log('No DVM containers found.');
      return;
    }

    console.log('\nDVM Containers:');
    console.log('─'.repeat(80));
    for (const container of dvmContainers) {
      const name = container.Names?.[0]?.replace(/^\//, '') || container.Id.substring(0, 12);
      const image = container.Image || 'unknown';
      const status = container.Status || 'unknown';
      const ports =
        container.Ports
          ? Array.from(
              new Set(
                container.Ports.map((p: { PublicPort?: number; PrivatePort?: number }) => {
                  const pub = typeof p.PublicPort === 'number' ? String(p.PublicPort) : '';
                  const priv = typeof p.PrivatePort === 'number' ? String(p.PrivatePort) : '';
                  return `${pub}:${priv}`;
                }).filter((s: string) => s !== ':')
              )
            ).join(', ') || 'none'
          : 'none';

      console.log(`Name: ${name}`);
      console.log(`  Image: ${image}`);
      if (container.State) console.log(`  State: ${container.State}`);
      console.log(`  Status: ${status}`);
      console.log(`  Ports: ${ports}`);
      console.log('');
    }
  }

  async showInfo(name: string): Promise<void> {
    const details = await this.docker.getContainerDetails(name);
    if (!details) {
      throw new Error(`Container ${name} not found`);
    }

    console.log(`\nContainer: ${details.name}`);
    console.log('─'.repeat(80));
    console.log(`ID: ${details.id}`);
    console.log(`Image: ${details.image}`);
    console.log(`Status: ${details.status}`);
    console.log(`Created: ${new Date(details.createdAt).toLocaleString()}`);

    if (details.ports.length > 0) {
      console.log('\nPorts:');
      for (const port of details.ports) {
        if (port.hostPort) {
          console.log(`  ${port.hostPort}:${port.containerPort}`);
        } else {
          console.log(`  ${port.containerPort} (not exposed)`);
        }
      }
    }

    if (details.volumes.length > 0) {
      console.log('\nVolumes:');
      for (const volume of details.volumes) {
        console.log(`  ${volume}`);
      }
    }
  }

  async execCommand(name: string, command: string[]): Promise<string> {
    return this.docker.execCommand(name, command);
  }

  async runLocalScript(
    containerName: string,
    localScriptPath: string,
    scriptArgs: string[] = [],
    options?: {
      /** Destination path inside container. Defaults to /tmp/dvm-script-<basename>-<timestamp>.sh */
      destPath?: string;
      /** Working directory inside container. Defaults to / */
      workdir?: string;
      /** Interpreter used to run the script (e.g. bash, sh). Defaults to bash */
      shell?: string;
      /** If true, leave the script file behind. Defaults to false */
      keep?: boolean;
    }
  ): Promise<string> {
    const container = await this.docker.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(`Container ${containerName} is not running. Start it first with 'dvm start ${containerName}'`);
    }

    const scriptContent = await fs.promises.readFile(localScriptPath, 'utf-8');
    const base = path.basename(localScriptPath).replace(/[^a-zA-Z0-9._-]/g, '_') || 'script.sh';
    const destPath =
      options?.destPath || `/tmp/dvm-script-${base}-${Date.now().toString(36)}.sh`;
    const workdir = options?.workdir || '/';
    const shell = options?.shell || 'bash';
    const keep = Boolean(options?.keep);

    const heredoc = `DVM_SCRIPT_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

    // Use bash -lc for consistent PATH + to allow "cd" and robust quoting.
    // We pass the script args via bash -c argv so "$@" is safe (no manual shell escaping).
    const writeAndRun = [
      'set -euo pipefail',
      `cd ${JSON.stringify(workdir)}`,
      `cat > ${JSON.stringify(destPath)} << '${heredoc}'`,
      scriptContent,
      heredoc,
      `chmod +x ${JSON.stringify(destPath)}`,
      // Run the script with the chosen shell, but keep args positional-safe via "$@"
      `exec ${JSON.stringify(shell)} ${JSON.stringify(destPath)} "$@"`,
    ].join('\n');

    try {
      const output = await this.docker.execCommand(containerName, ['bash', '-lc', writeAndRun, destPath, ...scriptArgs]);
      return output;
    } finally {
      if (!keep) {
        try {
          await this.docker.execCommand(containerName, ['bash', '-lc', `rm -f ${JSON.stringify(destPath)} || true`]);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  async showLogs(name: string, tail = 100): Promise<void> {
    const logs = await this.docker.getLogs(name, tail);
    console.log(logs);
  }

  private snapshotsRootDir(): string {
    return dvmRootPath('snapshots');
  }

  private safeToken(input: string, fallback: string): string {
    const s = String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || fallback;
  }

  async listDvmContainerNames(all = true): Promise<string[]> {
    const containers = await this.docker.listContainers(all);

    const getName = (c: Docker.ContainerInfo): string | null => {
      const n = c.Names?.[0];
      return n ? n.replace(/^\//, '') : null;
    };

    const out: string[] = [];
    for (const c of containers) {
      const name = getName(c);
      if (!name) continue;
      if (this.isDvmManagedInfo(c)) out.push(name);
    }
    return out.sort();
  }

  private async createTarGz(archivePath: string, cwd: string, files: string[]): Promise<void> {
    try {
      await tar.create(
        {
          cwd,
          file: archivePath,
          gzip: true,
          portable: true,
          noMtime: true,
        },
        files
      );
    } catch (error: any) {
      throw new Error(`Failed to create archive ${archivePath}: ${error?.message || String(error)}`);
    }
  }

  private async extractTarGz(archivePath: string, cwd: string): Promise<void> {
    try {
      await tar.extract({
        file: archivePath,
        cwd,
        gzip: true,
        strict: true,
      });
    } catch (error: any) {
      throw new Error(`Failed to extract archive ${archivePath}: ${error?.message || String(error)}`);
    }
  }

  async exportContainer(
    containerName: string,
    outArchivePath: string,
    options?: {
      includeVolume?: boolean;
    }
  ): Promise<void> {
    const includeVolume = options?.includeVolume !== false;

    const container = await this.docker.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const inspect = await container.inspect();
    const details = await this.docker.getContainerDetails(containerName);
    if (!details) {
      throw new Error(`Could not inspect container ${containerName}`);
    }

    const safe = containerName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'container';
    const now = Date.now().toString(36);
    const imageRepo = `dvm-export-${safe}`;
    const imageTag = `share-${now}`;

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dvm-export-'));
    try {
      const imageRef = await this.docker.commitContainer(containerName, imageRepo, imageTag);
      const imageTar = path.join(tmpDir, 'image.tar');
      await this.docker.saveImageToTar(imageRef, imageTar);

      const persistence = this.resolvePersistenceFromInspect(inspect);
      const volumeName = persistence.volumeName;
      const hasVolume = volumeName ? await this.docker.volumeExists(volumeName) : false;
      const volumeTarGz = path.join(tmpDir, 'volume.tar.gz');

      let volumeIncluded = false;
      if (includeVolume && hasVolume && volumeName) {
        await this.docker.exportVolumeToTarGz(volumeName, volumeTarGz);
        volumeIncluded = true;
      }

      const manifest: DvmExportManifestV1 = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        containerName,
        imageRef,
        networks: await this.docker.getContainerNetworkNames(containerName).catch(() => []),
        environment: inspect.Config?.Env,
        ports: details.ports ?? [],
        persistence: {
          enabled: Boolean(volumeName),
          volumeName: hasVolume && volumeName ? volumeName : undefined,
          path: persistence.mountPath,
        },
        notes: [
          'This archive contains a committed image (docker save) plus the DVM persistence volume (if present).',
          'Bind mounts and external named volumes (non-dvm) are not included.',
          'Host port mappings may not be available on import; DVM may auto-allocate ports.',
        ],
      };

      await fs.promises.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      const absOut = path.resolve(outArchivePath);
      await fs.promises.mkdir(path.dirname(absOut), { recursive: true });

      const files = ['manifest.json', 'image.tar'];
      if (volumeIncluded) files.push('volume.tar.gz');

      await this.createTarGz(absOut, tmpDir, files);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async importContainer(
    archivePath: string,
    options?: {
      name?: string;
      start?: boolean;
      preserveHostPorts?: boolean;
      network?: string;
    }
  ): Promise<string> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dvm-import-'));
    try {
      const absArchive = path.resolve(archivePath);
      await this.extractTarGz(absArchive, tmpDir);

      const manifestRaw = await fs.promises.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8');
      const manifest = JSON.parse(manifestRaw) as DvmExportManifestV1;
      if (manifest.schemaVersion !== 1) {
        throw new Error(`Unsupported export schema version: ${String((manifest as any).schemaVersion)}`);
      }

      const loadedImage = await this.docker.loadImageFromTar(path.join(tmpDir, 'image.tar'));
      if (!loadedImage) {
        throw new Error('Failed to determine loaded image reference from docker load output');
      }

      const desiredName = String(options?.name || manifest.containerName || '').trim();
      if (!desiredName) {
        throw new Error('Missing container name (pass --name or ensure archive has containerName)');
      }

      const exists = await this.docker.containerExists(desiredName);
      if (exists) {
        throw new Error(`Container ${desiredName} already exists`);
      }

      const startRequested = options?.start !== false;
      const volumeTarPath = path.join(tmpDir, 'volume.tar.gz');
      const hasVolumeTar = await fs.promises
        .stat(volumeTarPath)
        .then(() => true)
        .catch(() => false);

      // If we're restoring volume data, create container stopped first, restore, then start.
      const initialStart = startRequested && !hasVolumeTar;

      const ports = (manifest.ports || []).map((p) => ({
        containerPort: p.containerPort,
        hostPort: options?.preserveHostPorts ? p.hostPort : undefined,
      }));

      // Best-effort network selection:
      // - explicit --network wins
      // - otherwise use manifest network only if it exists locally
      let network: string | undefined = options?.network;
      if (!network) {
        const manifestNetwork = manifest.networks?.[0];
        if (manifestNetwork) {
          const ok = await this.docker.networkExists(manifestNetwork).catch(() => false);
          if (ok) network = manifestNetwork;
        }
      }

      const persistenceEnabled = manifest.persistence?.enabled !== false;
      const persistencePath = manifest.persistence?.path || '/dvm-data';
      const shouldReuseManifestVolumeName = !options?.name && manifest.persistence?.volumeName;
      const persistenceVolumeName =
        persistenceEnabled
          ? String(
              shouldReuseManifestVolumeName
                ? manifest.persistence?.volumeName
                : `dvm-${desiredName}-data`
            ).trim()
          : '';

      const config: ContainerConfig = {
        name: desiredName,
        image: loadedImage,
        network,
        ports,
        environment: manifest.environment,
        persistence: {
          enabled: persistenceEnabled,
          path: persistencePath,
          ...(persistenceEnabled ? { volumeName: persistenceVolumeName } : {}),
        },
      };

      await this.createContainer(config, initialStart, { skipProvisioning: true });

      if (hasVolumeTar && persistenceEnabled && persistenceVolumeName) {
        await this.docker.importVolumeFromTarGz(persistenceVolumeName, volumeTarPath);
      }

      if (startRequested && !initialStart) {
        await this.docker.startContainer(desiredName);
      }

      return desiredName;
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async snapshotContainer(
    containerName: string,
    snapshotName?: string,
    options?: { includeVolume?: boolean }
  ): Promise<{ snapshotName: string; archivePath: string }> {
    const includeVolume = options?.includeVolume !== false;
    const safeContainer = this.safeToken(containerName, 'container');
    const snap =
      snapshotName && String(snapshotName).trim()
        ? this.safeToken(snapshotName, 'snapshot')
        : `snap-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    const root = this.snapshotsRootDir();
    const dir = path.join(root, safeContainer);
    await fs.promises.mkdir(dir, { recursive: true });

    const archivePath = path.join(dir, `${snap}.tar.gz`);
    await this.exportContainer(containerName, archivePath, { includeVolume });

    // Keep a simple "latest" pointer (copy for portability).
    const latest = path.join(dir, 'latest.tar.gz');
    await fs.promises.copyFile(archivePath, latest);

    return { snapshotName: snap, archivePath };
  }

  async listSnapshots(containerName: string): Promise<
    Array<{
      name: string;
      archivePath: string;
      sizeBytes: number;
      mtimeMs: number;
      isLatestPointer: boolean;
    }>
  > {
    const safeContainer = this.safeToken(containerName, 'container');
    const dir = path.join(this.snapshotsRootDir(), safeContainer);

    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(dir);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }

    const tgz = entries.filter((f) => f.endsWith('.tar.gz'));
    const out: Array<{
      name: string;
      archivePath: string;
      sizeBytes: number;
      mtimeMs: number;
      isLatestPointer: boolean;
    }> = [];

    for (const file of tgz) {
      const full = path.join(dir, file);
      try {
        const st = await fs.promises.stat(full);
        out.push({
          name: file.replace(/\.tar\.gz$/, ''),
          archivePath: full,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          isLatestPointer: file === 'latest.tar.gz',
        });
      } catch {
        // ignore races where a file is deleted while listing
      }
    }

    // Newest first
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  }

  async restoreContainer(
    containerName: string,
    snapshotOrArchive?: string,
    options?: {
      start?: boolean;
      preserveHostPorts?: boolean;
      network?: string;
    }
  ): Promise<void> {
    const safeContainer = this.safeToken(containerName, 'container');
    const root = this.snapshotsRootDir();

    let archivePath: string;
    if (snapshotOrArchive && (snapshotOrArchive.includes('/') || snapshotOrArchive.endsWith('.tar.gz'))) {
      archivePath = path.resolve(snapshotOrArchive);
    } else {
      const snap = snapshotOrArchive ? this.safeToken(snapshotOrArchive, 'latest') : 'latest';
      archivePath = path.join(root, safeContainer, snap === 'latest' ? 'latest.tar.gz' : `${snap}.tar.gz`);
    }

    // Ensure archive exists early.
    await fs.promises.stat(archivePath).catch(() => {
      throw new Error(`Snapshot archive not found: ${archivePath}`);
    });

    const exists = await this.docker.containerExists(containerName);
    let existingPersistenceVolumeName: string | null = null;
    if (exists) {
      try {
        const container = await this.docker.getContainer(containerName);
        if (container) {
          const inspect = await container.inspect();
          existingPersistenceVolumeName = this.resolvePersistenceFromInspect(inspect).volumeName;
        }
      } catch {
        // ignore
      }
      try {
        await this.docker.stopContainer(containerName);
      } catch {
        // ignore if already stopped
      }
      try {
        await this.docker.removeContainer(containerName, true);
      } catch {
        // ignore
      }
    }

    // Ensure the prior persistence volume (if discoverable from the existing container)
    // is replaced by the snapshot contents.
    if (existingPersistenceVolumeName) {
      try {
        await this.docker.removeVolume(existingPersistenceVolumeName, true);
      } catch {
        // ignore if missing
      }
    }

    // `restoreContainer()` imports with an explicit `name`, so import target volume
    // is deterministic (`dvm-<name>-data`) regardless of archive metadata.
    // Remove it even when the container does not currently exist so stale data
    // cannot leak into the restored volume.
    const importTargetVolumeName = `dvm-${containerName}-data`;
    if (importTargetVolumeName !== existingPersistenceVolumeName) {
      try {
        await this.docker.removeVolume(importTargetVolumeName, true);
      } catch {
        // ignore if missing
      }
    }

    await this.importContainer(archivePath, {
      name: containerName,
      start: options?.start !== false,
      preserveHostPorts: Boolean(options?.preserveHostPorts),
      network: options?.network,
    });
  }

  async renameContainer(
    oldName: string,
    newName: string,
    options?: {
      startMode?: 'preserve' | 'always' | 'never';
      migrateVolumeName?: boolean;
    }
  ): Promise<void> {
    const startMode = options?.startMode || 'preserve';
    const migrateVolumeName = Boolean(options?.migrateVolumeName);

    const sourceExists = await this.docker.containerExists(oldName);
    if (!sourceExists) throw new Error(`Container ${oldName} not found`);
    const destExists = await this.docker.containerExists(newName);
    if (destExists) throw new Error(`Container ${newName} already exists`);

    const source = await this.docker.getContainer(oldName);
    if (!source) throw new Error(`Container ${oldName} not found`);
    const inspect = await source.inspect();
    const wasRunning = Boolean(inspect.State?.Running);
    if (migrateVolumeName) {
      await this.renameContainerWithVolumeMigration(oldName, newName, startMode, wasRunning, inspect);
      return;
    }

    if (startMode === 'never' && wasRunning) {
      try {
        await this.docker.stopContainer(oldName);
      } catch {
        // ignore
      }
    }

    await this.docker.renameContainer(oldName, newName);

    if (startMode === 'always') {
      await this.docker.startContainer(newName);
      return;
    }
    if (startMode === 'never') {
      try {
        await this.docker.stopContainer(newName);
      } catch {
        // ignore
      }
    }
  }

  private async renameContainerWithVolumeMigration(
    oldName: string,
    newName: string,
    startMode: 'preserve' | 'always' | 'never',
    wasRunning: boolean,
    inspect: Docker.ContainerInspectInfo
  ): Promise<void> {
    const details = await this.docker.getContainerDetails(oldName);
    if (!details) throw new Error(`Could not inspect container ${oldName}`);

    const shouldStart = startMode === 'always' ? true : startMode === 'never' ? false : wasRunning;

    if (wasRunning) {
      try {
        await this.docker.stopContainer(oldName);
      } catch {
        // ignore
      }
    }

    const networks = await this.docker.getContainerNetworkNames(oldName).catch(() => []);
    const oldPersistence = this.resolvePersistenceFromInspect(inspect);
    const oldPersistenceVolumeName = oldPersistence.volumeName;
    const persistencePath = oldPersistence.mountPath;

    const volumes: ContainerConfig['volumes'] = [];
    for (const m of inspect.Mounts || []) {
      if (!m || !m.Type) continue;
      if (m.Type === 'bind' && m.Source && m.Destination) {
        volumes.push({ source: m.Source, target: m.Destination, type: 'bind' });
      } else if (m.Type === 'volume' && m.Name && m.Destination) {
        if (oldPersistenceVolumeName && m.Name === oldPersistenceVolumeName) continue;
        volumes.push({ source: m.Name, target: m.Destination, type: 'volume' });
      }
    }

    const now = Date.now().toString(36);
    const safeOld = this.safeToken(oldName, 'old');
    const safeNew = this.safeToken(newName, 'new');
    const repo = `dvm-rename-${safeOld}`;
    const tag = `${safeNew}-${now}`;
    const committedImage = await this.docker.commitContainer(oldName, repo, tag);

    const newPersistenceVolumeName = `dvm-${newName}-data`;

    await this.createContainer(
      {
        name: newName,
        image: committedImage,
        network: networks[0],
        ports: details.ports ?? [],
        environment: inspect.Config?.Env,
        volumes: volumes.length ? volumes : undefined,
        persistence: { enabled: true, path: persistencePath, volumeName: newPersistenceVolumeName },
      },
      false,
      { skipProvisioning: true }
    );

    if (oldPersistenceVolumeName) {
      const oldVolExists = await this.docker.volumeExists(oldPersistenceVolumeName);
      if (oldVolExists) {
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dvm-rename-vol-'));
        try {
          const tarGz = path.join(tmpDir, 'volume.tar.gz');
          await this.docker.exportVolumeToTarGz(oldPersistenceVolumeName, tarGz);
          await this.docker.importVolumeFromTarGz(newPersistenceVolumeName, tarGz);
        } finally {
          await fs.promises.rm(tmpDir, { recursive: true, force: true });
        }
      }
    }

    if (shouldStart) {
      await this.docker.startContainer(newName);
    }

    for (const net of networks.slice(1)) {
      try {
        await this.docker.connectNetwork(net, newName);
      } catch {
        // ignore
      }
    }

    try {
      await this.docker.removeContainer(oldName, true);
    } catch {
      // ignore
    }

    if (oldPersistenceVolumeName && oldPersistenceVolumeName !== newPersistenceVolumeName) {
      try {
        await this.docker.removeVolume(oldPersistenceVolumeName, true);
      } catch {
        // ignore
      }
    }
  }

  private async ensureCurl(containerName: string): Promise<void> {
    // Keep this POSIX-ish so it works across more images.
    const install = [
      'set -e',
      'if command -v curl >/dev/null 2>&1; then exit 0; fi',
      // Debian/Ubuntu
      'if command -v apt-get >/dev/null 2>&1; then',
      '  export DEBIAN_FRONTEND=noninteractive',
      '  apt-get update -y',
      '  apt-get install -y --no-install-recommends curl ca-certificates',
      '  exit 0',
      'fi',
      // Alpine
      'if command -v apk >/dev/null 2>&1; then',
      '  apk add --no-cache curl ca-certificates',
      '  exit 0',
      'fi',
      // Fedora/RHEL
      'if command -v dnf >/dev/null 2>&1; then',
      '  dnf install -y curl ca-certificates',
      '  exit 0',
      'fi',
      'if command -v yum >/dev/null 2>&1; then',
      '  yum install -y curl ca-certificates',
      '  exit 0',
      'fi',
      'echo "Could not install curl: unsupported base image (no apt-get/apk/dnf/yum found)" >&2',
      'exit 1',
    ].join('\n');

    // Use `sh -c` (not login shell) to avoid relying on /etc/profile correctness.
    await this.docker.execCommand(containerName, ['sh', '-c', install]);
  }

  /**
   * Ensure `git` is available inside the container.
   *
   * Used by repo workflows (bundle clone, format-patch export, etc).
   */
  async ensureGit(containerName: string): Promise<void> {
    // Keep this POSIX-ish so it works across more images.
    const install = [
      'set -e',
      'if command -v git >/dev/null 2>&1; then exit 0; fi',
      // Debian/Ubuntu
      'if command -v apt-get >/dev/null 2>&1; then',
      '  export DEBIAN_FRONTEND=noninteractive',
      '  apt-get update -y',
      '  apt-get install -y --no-install-recommends git ca-certificates',
      '  exit 0',
      'fi',
      // Alpine
      'if command -v apk >/dev/null 2>&1; then',
      '  apk add --no-cache git ca-certificates',
      '  exit 0',
      'fi',
      // Fedora/RHEL
      'if command -v dnf >/dev/null 2>&1; then',
      '  dnf install -y git ca-certificates',
      '  exit 0',
      'fi',
      'if command -v yum >/dev/null 2>&1; then',
      '  yum install -y git ca-certificates',
      '  exit 0',
      'fi',
      'echo "Could not install git: unsupported base image (no apt-get/apk/dnf/yum found)" >&2',
      'exit 1',
    ].join('\n');

    // Use `sh -c` (not login shell) to avoid relying on /etc/profile correctness.
    await this.docker.execCommand(containerName, ['sh', '-c', install]);
  }

  /**
   * Ensure `tmux` is available inside the container.
   *
   * Used by `dvm session ...` to run persistent, non-interactive "interactive"
   * CLI sessions that can be driven via `tmux send-keys` and read via logs/capture.
   */
  async ensureTmux(containerName: string): Promise<void> {
    const install = [
      'set -e',
      'if command -v tmux >/dev/null 2>&1; then exit 0; fi',
      // Debian/Ubuntu
      'if command -v apt-get >/dev/null 2>&1; then',
      '  export DEBIAN_FRONTEND=noninteractive',
      '  # apt is often locked briefly on fresh boots (unattended upgrades / apt-daily).',
      '  # Retry with a small backoff rather than failing immediately.',
      '  i=0',
      '  while [ "$i" -lt 60 ]; do',
      '    i=$((i+1))',
      '    out="$( (apt-get -o DPkg::Lock::Timeout=60 update 2>&1 && apt-get -o DPkg::Lock::Timeout=60 install -y --no-install-recommends tmux ca-certificates 2>&1) || true )"',
      '    if command -v tmux >/dev/null 2>&1; then exit 0; fi',
      '    echo "$out" | grep -qiE "Could not get lock|Unable to acquire.*lock|is held by process|dpkg frontend lock" || { echo "$out" >&2; exit 1; }',
      '    sleep 2',
      '  done',
      '  echo "Timed out waiting for apt lock to install tmux" >&2',
      '  exit 1',
      'fi',
      // Alpine
      'if command -v apk >/dev/null 2>&1; then',
      '  apk add --no-cache tmux ca-certificates',
      '  exit 0',
      'fi',
      // Fedora/RHEL
      'if command -v dnf >/dev/null 2>&1; then',
      '  dnf install -y tmux ca-certificates',
      '  exit 0',
      'fi',
      'if command -v yum >/dev/null 2>&1; then',
      '  yum install -y tmux ca-certificates',
      '  exit 0',
      'fi',
      'echo "Could not install tmux: unsupported base image (no apt-get/apk/dnf/yum found)" >&2',
      'exit 1',
    ].join('\n');

    // Use `sh -c` (not login shell) to avoid /etc/profile bashisms (e.g. `source`).
    await this.docker.execCommand(containerName, ['sh', '-c', install]);
  }

  private async ensureNodeAndYarnUbuntu(containerName: string, image?: string): Promise<void> {
    const img = String(image || '').toLowerCase();
    const isUbuntu = img === 'ubuntu' || img.startsWith('ubuntu:') || img.startsWith('ubuntu@');
    if (!isUbuntu) return;

    const install = [
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      // If both exist, assume good enough and skip work.
      'if command -v node >/dev/null 2>&1 && command -v yarn >/dev/null 2>&1; then exit 0; fi',
      // Ensure prerequisites for NodeSource setup script.
      'apt-get update -y',
      'apt-get install -y --no-install-recommends ca-certificates curl gnupg',
      // Install latest "current" Node.js via NodeSource.
      // This intentionally tracks upstream latest stable at provision time.
      'curl -fsSL https://deb.nodesource.com/setup_current.x | bash -',
      'apt-get install -y --no-install-recommends nodejs',
      // Ensure Yarn is available globally.
      //
      // Note: Some Node packages (including NodeSource's `nodejs`) may not include
      // the `corepack` binary. Install it if missing, then activate Yarn.
      'if ! command -v corepack >/dev/null 2>&1; then',
      '  npm install -g corepack',
      'fi',
      'corepack enable || true',
      // Prefer Yarn v4+ (Berry). Fall back to other tags if needed.
      'corepack prepare yarn@4 --activate || corepack prepare yarn@latest --activate || corepack prepare yarn@stable --activate || true',
      'if ! command -v yarn >/dev/null 2>&1; then',
      '  npm install -g yarn',
      'fi',
    ].join('\n');

    await this.docker.execCommand(containerName, ['bash', '-lc', install]);
  }

  async listVolumes(): Promise<void> {
    const volumes = await this.docker.listVolumes();
    const dvmVolumes = volumes.filter((v: Docker.VolumeInspectInfo) => v.Name.startsWith('dvm-'));

    if (dvmVolumes.length === 0) {
      console.log('No dvm volumes found.');
      return;
    }

    console.log('\nDVM Volumes:');
    console.log('─'.repeat(80));
    for (const volume of dvmVolumes) {
      console.log(`Name: ${volume.Name}`);
      console.log(`  Driver: ${volume.Driver}`);
      console.log(`  Mountpoint: ${volume.Mountpoint}`);
      console.log('');
    }
  }

  async showVolumeInfo(name: string): Promise<void> {
    const container = await this.docker.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }
    const inspect = await container.inspect();
    const persistence = this.resolvePersistenceFromInspect(inspect);

    const volumeName = persistence.volumeName;
    if (!volumeName) {
      console.log(`No persistence volume configured for container ${name}`);
      return;
    }
    const volumes = await this.docker.listVolumes();
    const volume = volumes.find((v) => v.Name === volumeName);

    if (!volume) {
      console.log(`No volume found for container ${name}`);
      return;
    }

    console.log(`\nVolume: ${volume.Name}`);
    console.log('─'.repeat(80));
    console.log(`Driver: ${volume.Driver || 'unknown'}`);
    console.log(`Mount Point: ${volume.Mountpoint || 'unknown'}`);
  }

  private async resolvePorts(ports: ContainerConfig['ports']): Promise<ContainerConfig['ports']> {
    const resolved: ContainerConfig['ports'] = [];

    for (const port of ports) {
      if (port.hostPort) {
        // Check if port is available
        const available = await this.docker.checkPortAvailable(port.hostPort);
        if (!available) {
          // Try to find an available port nearby
          const newPort = await this.docker.findAvailablePort(port.hostPort);
          console.warn(`Port ${port.hostPort} is in use, using ${newPort} instead`);
          resolved.push({ ...port, hostPort: newPort });
        } else {
          resolved.push(port);
        }
      } else {
        // Auto-allocate port
        // Prefer well-known ports first when possible.
        const startPort =
          port.containerPort === 3389 ? 3389 :
          port.containerPort === 6080 ? 6080 :
          3000;
        const allocatedPort = await this.docker.findAvailablePort(startPort);
        resolved.push({ ...port, hostPort: allocatedPort });
      }
    }

    return resolved;
  }

  async installGui(containerName: string): Promise<void> {
    // Check if container is running
    const container = await this.docker.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(`Container ${containerName} is not running. Start it first with 'dvm start ${containerName}'`);
    }

    // Install GUI (will check if already installed)
    await this.guiInstaller.installGui(containerName);

    // Ensure GUI ports are exposed
    const details = await this.docker.getContainerDetails(containerName);
    if (!details) {
      throw new Error(`Container ${containerName} not found`);
    }

    const rdpPort = details.ports.find((p) => p.containerPort === 3389);
    const noVncPort = details.ports.find((p) => p.containerPort === 6080);

    const rdpReady = Boolean(rdpPort?.hostPort);
    const webReady = Boolean(noVncPort?.hostPort);

    if (!rdpReady || !webReady) {
      console.log('\n⚠️  Warning: One or more GUI ports are not exposed.');
      if (!webReady) {
        console.log(`\nBrowser URL (after exposing port 6080):`);
        console.log(`   ${chalk.cyan(`http://localhost:6080/vnc.html`)}`);
      }
      if (!rdpReady) {
        console.log(`\nRDP URL (after exposing port 3389):`);
        console.log(`   ${chalk.cyan(`rdp://localhost:3389`)}`);
      }

      console.log('\nTo expose the ports, recreate the container with:');
      console.log(`   ${chalk.cyan(`dvm expose ${containerName} --ports 3389,6080`)}`);
      console.log('\nOr inspect current mappings with:');
      console.log(`   ${chalk.gray(`dvm ports ${containerName}`)}`);
      return;
    }

    console.log('\n✅ GUI is ready!');

    console.log(`\n${chalk.bold('Browser (noVNC):')}`);
    console.log(`   ${chalk.cyan(`http://localhost:${noVncPort!.hostPort}/vnc.html`)}`);
    console.log(`   ${chalk.gray('(Open this in your browser)')}`);

    console.log(`\n${chalk.bold('RDP (XRDP):')}`);
    console.log(`   ${chalk.cyan(`rdp://localhost:${rdpPort!.hostPort}`)}`);
    console.log(`   Host: ${chalk.green('localhost')}`);
    console.log(`   Port: ${chalk.green(rdpPort!.hostPort!.toString())}`);
    console.log(`   Username: ${chalk.yellow('root')} (or your container user)`);
    console.log(`\n${chalk.yellow('Important (RDP only):')} Set a password for the user first:`);
    console.log(`   ${chalk.cyan(`dvm exec ${containerName} passwd`)}`);
  }
}
