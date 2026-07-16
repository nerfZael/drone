import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

type NgrokProcessState = {
  version: 1;
  mode: 'process';
  pid: number;
  port: number;
  startedAt: string;
  logPath: string;
};

type NgrokAgentState = {
  version: 1;
  mode: 'agent';
  name: string;
  inspectorPort: number;
  port: number;
  startedAt: string;
  logPath: string;
};

type NgrokState = NgrokProcessState | NgrokAgentState;

export type NgrokDetection = {
  url: string | null;
  error: string | null;
};

function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return String(error?.code ?? '') === 'EPERM';
  }
}

function normalizePublicUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function addressMatchesPort(value: unknown, port: number): boolean {
  const address = String(value ?? '').trim();
  if (!address) return false;
  try {
    const url = new URL(address.includes('://') ? address : `http://${address}`);
    return Number(url.port) === port;
  } catch {
    return new RegExp(`(^|:)${port}($|/)`).test(address);
  }
}

export async function detectDeviceMeshNgrokUrl(port: number): Promise<NgrokDetection> {
  const inspect = async (inspectorPort: number) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_200);
      const response = await fetch(`http://127.0.0.1:${inspectorPort}/api/tunnels`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as any;
      const urls = (Array.isArray(body?.tunnels) ? body.tunnels : [])
        .filter((tunnel: any) => addressMatchesPort(tunnel?.config?.addr, port))
        .map((tunnel: any) => normalizePublicUrl(tunnel?.public_url))
        .filter((url: string | null): url is string => Boolean(url));
      return { inspectorPort, reached: true, urls, error: null };
    } catch (error: any) {
      return {
        inspectorPort,
        reached: false,
        urls: [] as string[],
        error: error?.message ?? String(error),
      };
    }
  };

  const results = await Promise.all([4040, 4041].map(inspect));
  for (const result of results) {
    const url =
      result.urls.find((candidate: string) => candidate.startsWith('https://')) ?? result.urls[0];
    if (url) return { url, error: null };
  }
  const inspectorReached = results.some((result) => result.reached);
  const errors = results
    .filter((result) => result.error)
    .map((result) => `${result.inspectorPort}: ${result.error}`);
  return {
    url: null,
    error: inspectorReached ? null : `ngrok inspector is not reachable (${errors.join('; ')})`,
  };
}

export class DeviceMeshNgrok {
  private readonly statePath: string;
  private readonly logPath: string;

  constructor(rootDir: string) {
    this.statePath = path.join(rootDir, 'ngrok.json');
    this.logPath = path.join(rootDir, 'ngrok.log');
  }

  async start(port: number): Promise<{
    ok: true;
    logPath: string;
    pid?: number;
    agentManaged: boolean;
    alreadyRunning: boolean;
  }> {
    const current = await this.readState();
    const detected = await detectDeviceMeshNgrokUrl(port);
    if (detected.url) {
      return {
        ok: true,
        logPath: current?.logPath ?? this.logPath,
        ...(current?.mode === 'process' ? { pid: current.pid } : {}),
        agentManaged: current?.mode === 'agent',
        alreadyRunning: true,
      };
    }
    await this.stopState(current);
    await this.removeState();

    const agent = await this.startWithRunningAgent(port);
    if (agent) {
      await this.writeState(agent);
      return {
        ok: true,
        logPath: agent.logPath,
        agentManaged: true,
        alreadyRunning: false,
      };
    }

    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    const log = await fs.open(this.logPath, 'a');
    try {
      const child = spawn('ngrok', ['http', String(port)], {
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: process.env,
      });
      const spawnError = await new Promise<Error | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 250);
        child.once('error', (error) => {
          clearTimeout(timer);
          resolve(error);
        });
      });
      if (spawnError) throw spawnError;
      if (!child.pid) throw new Error('ngrok did not report a process id');
      child.unref();
      const state: NgrokProcessState = {
        version: 1,
        mode: 'process',
        pid: child.pid,
        port,
        startedAt: new Date().toISOString(),
        logPath: this.logPath,
      };
      await this.writeState(state);
      return {
        ok: true,
        logPath: state.logPath,
        pid: state.pid,
        agentManaged: false,
        alreadyRunning: false,
      };
    } finally {
      await log.close().catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    const current = await this.readState();
    await this.stopState(current);
    await this.removeState();
  }

  private async readState(): Promise<NgrokState | null> {
    try {
      const state = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Record<string, any>;
      if (
        state.version !== 1 ||
        !Number.isInteger(state.port) ||
        Number(state.port) <= 0 ||
        typeof state.logPath !== 'string'
      )
        return null;
      if (
        state.mode === 'agent' &&
        typeof state.name === 'string' &&
        Number.isInteger(state.inspectorPort)
      )
        return state as NgrokAgentState;
      if (Number.isInteger(state.pid) && Number(state.pid) > 0) {
        return { ...state, mode: 'process' } as NgrokProcessState;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeState(state: NgrokState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.statePath);
  }

  private async removeState(): Promise<void> {
    await fs.unlink(this.statePath).catch((error: any) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  private async startWithRunningAgent(port: number): Promise<NgrokAgentState | null> {
    const errors: string[] = [];
    let reached = false;
    const name = `drone-device-mesh-${port}`;
    for (const inspectorPort of [4040, 4041]) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2_000);
        const response = await fetch(`http://127.0.0.1:${inspectorPort}/api/tunnels`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            proto: 'http',
            addr: `http://127.0.0.1:${port}`,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        reached = true;
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`);
        }
        return {
          version: 1,
          mode: 'agent',
          name,
          inspectorPort,
          port,
          startedAt: new Date().toISOString(),
          logPath: this.logPath,
        };
      } catch (error: any) {
        errors.push(`${inspectorPort}: ${error?.message ?? String(error)}`);
      }
    }
    if (reached)
      throw new Error(`the running ngrok agent rejected the mesh tunnel (${errors.join('; ')})`);
    return null;
  }

  private async stopState(state: NgrokState | null): Promise<void> {
    if (state?.mode === 'process' && isRunning(state.pid)) {
      await this.stopProcess(state.pid);
      return;
    }
    if (state?.mode === 'agent') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_200);
      let response: Response;
      try {
        response = await fetch(
          `http://127.0.0.1:${state.inspectorPort}/api/tunnels/${encodeURIComponent(state.name)}`,
          { method: 'DELETE', signal: controller.signal },
        );
      } catch {
        // A missing inspector means the agent and its tunnel are already gone. Treat stale
        // persisted agent state as stopped so start() can launch a replacement process.
        return;
      } finally {
        clearTimeout(timeout);
      }
      if (response.status !== 204 && response.status !== 404) {
        throw new Error(`ngrok agent returned HTTP ${response.status} while stopping the tunnel`);
      }
    }
  }

  private async stopProcess(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error: any) {
      if (error?.code !== 'ESRCH') throw error;
      return;
    }
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && isRunning(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!isRunning(pid)) return;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error: any) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}
