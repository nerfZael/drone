export type DroneDaemonRecoveryTarget<TClient = unknown> = {
  droneId: string;
  runtime: 'container' | 'host';
  client: TClient;
  containerName: string;
  containerPort: number;
  hostPort: number;
  token: string;
  readyTimeoutMs: number;
};

export type DroneDaemonRecoveryDependencies<TClient = unknown> = {
  probe(client: TClient): Promise<void>;
  shouldRecoverProbeError(error: unknown): boolean;
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
