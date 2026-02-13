import Docker from 'dockerode';
import { ContainerInfo } from 'dockerode';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

export interface ContainerConfig {
  name: string;
  image: string;
  ports: PortMapping[];
  /**
   * Primary Docker network to attach at container creation time.
   * Equivalent to `docker run --network <name>`.
   */
  network?: string;
  environment?: string[];
  volumes?: VolumeMount[];
  persistence?: PersistenceConfig;
}

export interface PortMapping {
  containerPort: number;
  hostPort?: number;
}

export interface VolumeMount {
  source: string;
  target: string;
  type: 'bind' | 'volume';
}

export interface PersistenceConfig {
  enabled: boolean;
  path: string;
  volumeName?: string;
}

export interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: PortMapping[];
  createdAt: string;
  volumes: string[];
}

export class DockerClient {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Label applied to containers created/managed by dvm.
   * Used to safely distinguish dvm containers from unrelated Docker containers.
   */
  static readonly DVM_MANAGED_LABEL_KEY = 'me.drone.dvm.managed';
  static readonly DVM_NETWORK_LABEL_KEY = 'me.drone.dvm.network';
  static readonly DVM_PERSISTENCE_VOLUME_LABEL_KEY = 'me.drone.dvm.persistence.volume';
  static readonly DVM_PERSISTENCE_PATH_LABEL_KEY = 'me.drone.dvm.persistence.path';

  async listContainers(all = false): Promise<ContainerInfo[]> {
    return this.docker.listContainers({ all });
  }

  async getContainer(name: string): Promise<Docker.Container | null> {
    const containers = await this.listContainers(true);
    const containerInfo = containers.find(
      (c) => c.Names?.some((n: string) => n.replace(/^\//, '') === name) || c.Id.startsWith(name)
    );

    if (!containerInfo) {
      return null;
    }

    return this.docker.getContainer(containerInfo.Id);
  }

  async containerExists(name: string): Promise<boolean> {
    const container = await this.getContainer(name);
    return container !== null;
  }

  async getContainerDetails(name: string): Promise<ContainerDetails | null> {
    const container = await this.getContainer(name);
    if (!container) {
      return null;
    }

    const info = await container.inspect();
    const ports: PortMapping[] = [];

    if (info.NetworkSettings?.Ports) {
      for (const [containerPort, hostBindings] of Object.entries(info.NetworkSettings.Ports)) {
        const portNum = parseInt(containerPort.split('/')[0]);
        const bindings = hostBindings as Array<{ HostPort: string }> | null | undefined;
        const hostPort = bindings?.[0]?.HostPort ? parseInt(bindings[0].HostPort) : undefined;
        ports.push({ containerPort: portNum, hostPort });
      }
    }

    const volumes = info.Mounts?.map((m: { Name?: string; Source?: string }) => m.Name || m.Source).filter(Boolean) as string[] || [];

    return {
      id: info.Id,
      name: info.Name.replace(/^\//, ''),
      image: info.Config.Image || '',
      status: info.State?.Status || 'unknown',
      ports,
      createdAt: info.Created || '',
      volumes,
    };
  }

  async pullImage(image: string): Promise<void> {
    const stream = await this.docker.pull(image);
    
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        (output: any) => {
          // Progress output - can be used for progress indicators
          if (output.status && output.progress) {
            process.stdout.write(`\r${output.status} ${output.progress || ''}`);
          }
        }
      );
    });
  }

  async ensureImage(image: string): Promise<void> {
    try {
      // Try to inspect the image to see if it exists locally
      const img = this.docker.getImage(image);
      await img.inspect();
    } catch (err: any) {
      // Image doesn't exist locally, pull it
      if (err.statusCode === 404 || err.message?.includes('no such image')) {
        console.log(`Pulling image ${image}...`);
        await this.pullImage(image);
        console.log(`\nImage ${image} pulled successfully`);
      } else {
        throw err;
      }
    }
  }

  async createContainer(config: ContainerConfig): Promise<Docker.Container> {
    // Ensure image exists locally before creating container
    await this.ensureImage(config.image);

    const portBindings: { [key: string]: Array<{ HostPort: string }> } = {};
    const exposedPorts: { [key: string]: {} } = {};

    for (const port of config.ports) {
      const key = `${port.containerPort}/tcp`;
      exposedPorts[key] = {};
      if (port.hostPort) {
        portBindings[key] = [{ HostPort: port.hostPort.toString() }];
      }
    }

    const mounts: Docker.MountSettings[] = [];

    const persistenceEnabled = config.persistence?.enabled !== false;
    const persistenceVolumeName = persistenceEnabled
      ? String(config.persistence?.volumeName || '').trim() || `dvm-${config.name}-data`
      : '';
    const persistencePath = persistenceEnabled ? (config.persistence?.path || '/dvm-data') : '';

    // Add persistence volume if enabled (default)
    if (persistenceEnabled) {
      mounts.push({
        Type: 'volume' as Docker.MountType,
        Source: persistenceVolumeName,
        Target: persistencePath || '/dvm-data',
      });
    }

    // Add additional volume mounts
    if (config.volumes) {
      for (const volume of config.volumes) {
        mounts.push({
          Type: volume.type as Docker.MountType,
          Source: volume.source,
          Target: volume.target,
        });
      }
    }

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: config.image,
      name: config.name,
      Labels: {
        [DockerClient.DVM_MANAGED_LABEL_KEY]: 'true',
        [DockerClient.DVM_PERSISTENCE_VOLUME_LABEL_KEY]: persistenceVolumeName,
        [DockerClient.DVM_PERSISTENCE_PATH_LABEL_KEY]: persistencePath,
      },
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        NetworkMode: config.network,
        Mounts: mounts.length > 0 ? (mounts as Docker.MountConfig) : undefined,
      },
      Env: config.environment,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      OpenStdin: true,
    };

    const container = await this.docker.createContainer(containerConfig);
    return container;
  }

  async listNetworks(): Promise<Docker.NetworkInspectInfo[]> {
    return this.docker.listNetworks();
  }

  async networkExists(name: string): Promise<boolean> {
    const networks = await this.listNetworks();
    return networks.some((n) => n?.Name === name || n?.Id === name);
  }

  async createNetwork(name: string, options?: { driver?: string }): Promise<void> {
    const driver = options?.driver || 'bridge';
    await this.docker.createNetwork({
      Name: name,
      Driver: driver,
      CheckDuplicate: true,
      Labels: {
        [DockerClient.DVM_NETWORK_LABEL_KEY]: 'true',
      },
    });
  }

  async ensureNetwork(name: string, options?: { driver?: string }): Promise<void> {
    const exists = await this.networkExists(name);
    if (exists) return;
    await this.createNetwork(name, options);
  }

  async connectNetwork(networkName: string, containerName: string): Promise<void> {
    // Docker API allows either container ID or name here.
    const network = this.docker.getNetwork(networkName);
    await network.connect({ Container: containerName });
  }

  async disconnectNetwork(networkName: string, containerName: string, force = false): Promise<void> {
    const network = this.docker.getNetwork(networkName);
    await network.disconnect({ Container: containerName, Force: force });
  }

  async getContainerNetworkNames(containerName: string): Promise<string[]> {
    const container = await this.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const info = await container.inspect();
    const networks = info.NetworkSettings?.Networks || {};
    return Object.keys(networks);
  }

  async startContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    const info = await container.inspect();
    if (info.State?.Running) {
      return; // Already running
    }

    await container.start();
  }

  async pauseContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(`Container ${name} is not running. Start it first with 'dvm start ${name}'`);
    }

    if (info.State?.Paused) {
      return; // Already paused
    }

    await container.pause();
  }

  async unpauseContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(`Container ${name} is not running. Start it first with 'dvm start ${name}'`);
    }

    if (!info.State?.Paused) {
      return; // Already unpaused
    }

    await container.unpause();
  }

  async stopContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    await container.stop();
  }

  async removeContainer(name: string, force = false): Promise<void> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    await container.remove({ force });
  }

  async renameContainer(oldName: string, newName: string): Promise<void> {
    const container = await this.getContainer(oldName);
    if (!container) {
      throw new Error(`Container ${oldName} not found`);
    }
    await container.rename({ name: newName });
  }

  async execCommand(name: string, command: string[]): Promise<string> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      // IMPORTANT:
      // If Tty is false, Docker multiplexes stdout/stderr with an 8-byte header per frame.
      // We must demux it, otherwise command output will contain non-printable bytes that
      // can break downstream logic (e.g. embedding a detected path into another command).
      Tty: false,
    });

    return new Promise((resolve, reject) => {
      let stdoutText = '';
      let stderrText = '';
      exec.start({ hijack: true, stdin: false }, (err: Error | null, stream?: NodeJS.ReadWriteStream) => {
        if (err) {
          reject(err);
          return;
        }

        if (!stream) {
          reject(new Error('No stream available'));
          return;
        }

        const stdout = new PassThrough();
        const stderr = new PassThrough();

        stdout.on('data', (chunk: Buffer) => {
          stdoutText += chunk.toString();
        });
        stderr.on('data', (chunk: Buffer) => {
          stderrText += chunk.toString();
        });

        // Demultiplex the docker stream into stdout/stderr.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.docker.modem as any).demuxStream(stream, stdout, stderr);

        stream.on('end', async () => {
          try {
            const info = await exec.inspect();
            const code = info.ExitCode;
            if (typeof code === 'number' && code !== 0) {
              const cmd = command.map((c) => JSON.stringify(c)).join(' ');
              const combined = `${stdoutText}${stderrText}`.trim();
              const suffix = combined ? `\n\n${combined}` : '';
              reject(new Error(`Command failed (exit ${code}): ${cmd}${suffix}`));
              return;
            }
            // Keep legacy behavior: return combined output (stdout + stderr).
            resolve(`${stdoutText}${stderrText}`);
          } catch (inspectErr: any) {
            reject(inspectErr);
          }
        });

        stream.on('error', (err: Error) => {
          reject(err);
        });
      });
    });
  }

  async execInteractive(name: string, command: string[] = ['/bin/bash']): Promise<void> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    // Check if container is running
    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(`Container ${name} is not running. Start it first with 'dvm start ${name}'`);
    }

    // Use spawn to run docker exec -it for proper TTY handling
    const proc = spawn('docker', ['exec', '-it', name, ...command], {
      stdio: 'inherit',
    });

    return new Promise((resolve, reject) => {
      proc.once('error', (err: Error) => reject(err));
      proc.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          resolve();
        } else {
          const reason = signal ? `signal ${signal}` : `code ${code}`;
          reject(new Error(`Process exited with ${reason}`));
        }
      });
    });
  }

  async getLogs(name: string, tail = 100): Promise<string> {
    const container = await this.getContainer(name);
    if (!container) {
      throw new Error(`Container ${name} not found`);
    }

    const buffer = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
      follow: false,
    });

    return buffer.toString();
  }

  async listVolumes(): Promise<Docker.VolumeInspectInfo[]> {
    const volumes = await this.docker.listVolumes();
    return volumes.Volumes || [];
  }

  async removeVolume(name: string, force = false): Promise<void> {
    const volume = this.docker.getVolume(name);
    await volume.remove({ force });
  }

  async checkPortAvailable(port: number): Promise<boolean> {
    const containers = await this.listContainers(true);
    for (const container of containers) {
      if (container.Ports) {
        for (const portInfo of container.Ports) {
          if (portInfo.PublicPort === port) {
            return false;
          }
        }
      }
    }
    return true;
  }

  async findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      if (await this.checkPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`Could not find available port starting from ${startPort}`);
  }

  async commitContainer(containerName: string, imageName: string, tag = 'latest'): Promise<string> {
    const container = await this.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const fullImageName = tag ? `${imageName}:${tag}` : imageName;
    
    return new Promise((resolve, reject) => {
      container.commit(
        {
          repo: imageName,
          tag: tag,
        },
        (err: Error | null, result: { Id: string }) => {
          if (err) {
            reject(err);
          } else {
            resolve(fullImageName);
          }
        }
      );
    });
  }

  async getContainerImage(containerName: string): Promise<string | null> {
    const details = await this.getContainerDetails(containerName);
    return details?.image || null;
  }

  /**
   * Copy a local file or directory into a container using `docker cp`.
   *
   * If `localPath` is a directory, this copies its *contents* into `containerPath`
   * (equivalent to `docker cp localPath/. container:containerPath`).
   */
  async copyToContainer(containerName: string, localPath: string, containerPath: string): Promise<void> {
    const container = await this.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(localPath);
    } catch (err: any) {
      throw new Error(`Local path not found: ${localPath}`);
    }

    const source = stat.isDirectory() ? path.join(localPath, '.') : localPath;
    const dest = `${containerName}:${containerPath}`;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', ['cp', source, dest], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const suffix = stderr.trim() ? `\n\n${stderr.trim()}` : '';
          reject(new Error(`docker cp failed (exit ${code}): ${JSON.stringify(source)} -> ${JSON.stringify(dest)}${suffix}`));
        }
      });
    });
  }

  /**
   * Copy a file or directory out of a container using `docker cp`.
   *
   * This does not require the container to be running.
   */
  async copyFromContainer(containerName: string, containerPath: string, localPath: string): Promise<void> {
    const container = await this.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    const absDest = path.resolve(localPath);
    const parent = path.dirname(absDest);
    await fs.promises.mkdir(parent, { recursive: true });

    const source = `${containerName}:${containerPath}`;
    const dest = absDest;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', ['cp', source, dest], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => reject(err));
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const suffix = stderr.trim() ? `\n\n${stderr.trim()}` : '';
          reject(new Error(`docker cp failed (exit ${code}): ${JSON.stringify(source)} -> ${JSON.stringify(dest)}${suffix}`));
        }
      });
    });
  }

  private async runDocker(args: string[], options?: { stdio?: 'inherit' | 'pipe' }): Promise<{ stdout: string; stderr: string }> {
    const stdio = options?.stdio || 'pipe';
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', args, { stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'] });

      if (stdio === 'inherit') {
        proc.on('error', (err) => reject(err));
        proc.on('exit', (code) => {
          if (code === 0 || code === null) resolve({ stdout: '', stderr: '' });
          else reject(new Error(`docker ${args.join(' ')} failed (exit ${code})`));
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
      proc.stderr?.on('data', (chunk) => (stderr += chunk.toString()));

      proc.on('error', (err) => reject(err));
      proc.on('exit', (code) => {
        if (code === 0 || code === null) resolve({ stdout, stderr });
        else {
          const suffix = `${stdout}${stderr}`.trim();
          reject(new Error(`docker ${args.map((a) => JSON.stringify(a)).join(' ')} failed (exit ${code})${suffix ? `\n\n${suffix}` : ''}`));
        }
      });
    });
  }

  async saveImageToTar(imageRef: string, outTarPath: string): Promise<void> {
    const abs = path.resolve(outTarPath);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await this.runDocker(['save', imageRef, '-o', abs]);
  }

  /**
   * Load an image tarball produced by `docker save`.
   * Returns the best-effort loaded image reference (repo:tag) or image ID.
   */
  async loadImageFromTar(tarPath: string): Promise<string> {
    const abs = path.resolve(tarPath);
    const { stdout } = await this.runDocker(['load', '-i', abs]);
    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Common output formats:
    // - "Loaded image: repo:tag"
    // - "Loaded image ID: sha256:..."
    for (const l of lines) {
      const m = l.match(/^Loaded image:\s+(.+)$/i);
      if (m?.[1]) return m[1].trim();
    }
    for (const l of lines) {
      const m = l.match(/^Loaded image ID:\s+(.+)$/i);
      if (m?.[1]) return m[1].trim();
    }

    // Fallback: return last non-empty line.
    return lines[lines.length - 1] || '';
  }

  async volumeExists(volumeName: string): Promise<boolean> {
    const vols = await this.listVolumes();
    return vols.some((v) => v?.Name === volumeName);
  }

  async exportVolumeToTarGz(volumeName: string, outTarGzPath: string): Promise<void> {
    const abs = path.resolve(outTarGzPath);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });

    // Use a tiny container to read the volume and produce a tarball.
    await this.runDocker([
      'run',
      '--rm',
      '-v',
      `${volumeName}:/data`,
      '-v',
      `${path.dirname(abs)}:/out`,
      'alpine:3.19',
      'sh',
      '-lc',
      `tar -C /data -czf /out/${JSON.stringify(path.basename(abs))} .`,
    ]);
  }

  async importVolumeFromTarGz(volumeName: string, inTarGzPath: string): Promise<void> {
    const abs = path.resolve(inTarGzPath);
    const dir = path.dirname(abs);
    const base = path.basename(abs);

    await this.runDocker([
      'run',
      '--rm',
      '-v',
      `${volumeName}:/data`,
      '-v',
      `${dir}:/in`,
      'alpine:3.19',
      'sh',
      '-lc',
      // Extract into /data (fresh volume normally). Don't fail on empty archives.
      `tar -xzf /in/${JSON.stringify(base)} -C /data`,
    ]);
  }
}
