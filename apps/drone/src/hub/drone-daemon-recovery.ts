export type DroneDaemonRecoveryTarget<TClient = unknown> = {
  droneId: string;
  runtime: 'container' | 'host';
  client: TClient;
  containerName: string;
  containerPort: number;
  hostPort: number;
  hostPid?: number;
  token: string;
  readyTimeoutMs: number;
};

export type DroneDaemonRecoveryDependencies<TClient = unknown> = {
  probe(client: TClient): Promise<void>;
  shouldRecoverProbeError(error: unknown): boolean;
  confirmUnavailable(target: DroneDaemonRecoveryTarget<TClient>): Promise<boolean>;
  ensureContainer(input: { containerName: string; containerPort: number }): Promise<void>;
  launchHost(input: {
    droneId: string;
    hostPort: number;
    token: string;
  }): Promise<number>;
  persistHostPid(input: { droneId: string; pid: number }): Promise<void>;
  waitUntilReady(client: TClient, timeoutMs: number): Promise<void>;
};

export type DroneDaemonRecoveryResult = {
  recovered: boolean;
};

export class DroneDaemonRecovery<TClient = unknown> {
  readonly #tasks = new Map<string, Promise<DroneDaemonRecoveryResult>>();

  constructor(private readonly deps: DroneDaemonRecoveryDependencies<TClient>) {}

  async ensure(target: DroneDaemonRecoveryTarget<TClient>): Promise<DroneDaemonRecoveryResult> {
    try {
      await this.deps.probe(target.client);
      return { recovered: false };
    } catch (error) {
      if (!this.deps.shouldRecoverProbeError(error)) throw error;
      // Recover below. The queued prompt remains durable while recovery runs.
    }

    const existing = this.#tasks.get(target.droneId);
    if (existing) return await existing;

    const task = this.#recover(target).finally(() => {
      if (this.#tasks.get(target.droneId) === task) this.#tasks.delete(target.droneId);
    });
    this.#tasks.set(target.droneId, task);
    return await task;
  }

  async #recover(
    target: DroneDaemonRecoveryTarget<TClient>,
  ): Promise<DroneDaemonRecoveryResult> {
    // The first probe can fail transiently when the host is busy. Confirm the
    // daemon is still unreachable inside the per-drone single flight before
    // replacing it; restarting an otherwise healthy daemon interrupts every
    // in-flight App Server turn it owns.
    let confirmedProbeError: unknown;
    try {
      await this.deps.probe(target.client);
      return { recovered: false };
    } catch (error) {
      if (!this.deps.shouldRecoverProbeError(error)) throw error;
      confirmedProbeError = error;
    }

    // An HTTP timeout only proves that the daemon did not answer quickly. It
    // does not prove that the owning process is gone, especially while several
    // App Server turns are producing events. Never destroy those in-memory
    // sessions unless the runtime independently confirms that the daemon is
    // absent or dead.
    if (!(await this.deps.confirmUnavailable(target))) throw confirmedProbeError;

    if (target.runtime === 'host') {
      const pid = await this.deps.launchHost({
        droneId: target.droneId,
        hostPort: target.hostPort,
        token: target.token,
      });
      await this.deps.waitUntilReady(target.client, target.readyTimeoutMs);
      await this.deps.persistHostPid({ droneId: target.droneId, pid });
    } else {
      await this.deps.ensureContainer({
        containerName: target.containerName,
        containerPort: target.containerPort,
      });
      await this.deps.waitUntilReady(target.client, target.readyTimeoutMs);
    }

    return { recovered: true };
  }
}
