import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isLocalAutoUpdates,
  LocalCheckoutError,
  localCheckoutStateFromRegistry,
  normalizedGitSha,
  type LocalCheckoutSession,
  type LocalCheckoutState,
  type RunResult,
} from './local-checkout-model';
import {
  LocalCheckoutSnapshotService,
  type LocalCheckoutSnapshotDependencies,
} from './local-checkout-snapshot-service';

export {
  LocalCheckoutError,
  type LocalAutoUpdates,
  type LocalCheckoutSession,
  type LocalCheckoutState,
  type LocalSnapshotKind,
} from './local-checkout-model';

type LocalCheckoutServiceDependencies = LocalCheckoutSnapshotDependencies & {
  loadRegistry: () => Promise<any>;
  updateRegistry: <T>(mutator: (registry: any) => T | Promise<T>) => Promise<T>;
  findDroneIdByRef: (registry: any, ref: string) => { kind: string; id: string } | null;
  droneRuntime: (drone: any) => 'host' | 'container';
  gitTopLevel: (repoPath: string) => Promise<string>;
  gitIsClean: (repoRoot: string) => Promise<boolean>;
  runHostCommand: (
    command: string,
    args: string[],
    opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ) => Promise<RunResult>;
  nowIso: () => string;
};

function commandDetails(result: RunResult): string {
  return `${String(result.stderr ?? '')}\n${String(result.stdout ?? '')}`.trim();
}

export class LocalCheckoutService {
  private readonly deps: LocalCheckoutServiceDependencies;
  private readonly snapshots: LocalCheckoutSnapshotService;
  private generation = 0;
  private operation: { kind: string; droneId: string | null; generation: number } | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: LocalCheckoutServiceDependencies) {
    this.deps = deps;
    this.snapshots = new LocalCheckoutSnapshotService(deps);
  }

  async getView(): Promise<any> {
    const state = await this.readState();
    let host: any = null;
    if (state.session) {
      const currentHead = await this.hostCommit(state.session.repoRoot).catch(() => null);
      const clean = await this.deps.gitIsClean(state.session.repoRoot).catch(() => false);
      host = {
        currentHead,
        clean,
        interrupted: currentHead !== state.session.snapshotSha,
      };
    }
    return {
      ok: true,
      ...state,
      operation: this.operation
        ? {
            kind: this.operation.kind,
            droneId: this.operation.droneId,
          }
        : null,
      host,
    };
  }

  useLocally(droneRef: string): Promise<any> {
    return this.runLatest('use', droneRef, async (generation) => {
      const currentState = await this.readState();
      const current = currentState.session;
      if (current) await this.assertActiveHost(current);

      const target = await this.resolveDrone(droneRef);
      const targetRepoRoot = await this.deps.gitTopLevel(String(target.drone.repoPath ?? '').trim());
      const sameRepo = Boolean(current && current.repoRoot === targetRepoRoot);
      if (!sameRepo && !(await this.deps.gitIsClean(targetRepoRoot))) {
        throw new LocalCheckoutError(
          'target_repo_dirty',
          `The local repository for "${target.name}" has changes. Commit or remove them before using this drone locally.`,
        );
      }
      await this.assertNoGitOperation(targetRepoRoot);

      const returnPoint = sameRepo && current
        ? {
            ref: current.returnRef,
            sha: current.returnSha,
            detached: current.returnDetached,
            activatedAt: current.activatedAt,
          }
        : {
            ...(await this.hostReturnPoint(targetRepoRoot)),
            activatedAt: this.deps.nowIso(),
          };
      const rollbackSwitch = async (error: unknown, context: string): Promise<never> => {
        const actions: Array<() => Promise<void>> = [];
        if (sameRepo && current) {
          actions.push(() => this.checkoutSnapshot(current.repoRoot, current.snapshotSha));
        } else {
          actions.push(() => this.restoreHostPoint(targetRepoRoot, returnPoint));
        }
        if (current && !sameRepo) {
          actions.push(() => this.checkoutSnapshot(current.repoRoot, current.snapshotSha));
        }
        return await this.rollbackAfterFailure(error, context, actions);
      };
      const includeDirty = currentState.autoUpdates === 'all';
      const snapshot = await this.snapshots.captureAndImport({
        droneId: target.id,
        drone: target.drone,
        repoRoot: targetRepoRoot,
        includeDirty,
      });
      this.assertGeneration(generation);

      if (current && !sameRepo) {
        await this.restoreReturnPoint(current);
      }

      try {
        await this.checkoutSnapshot(targetRepoRoot, snapshot.snapshotSha);
      } catch (error) {
        await rollbackSwitch(error, 'switching local drones');
      }

      const now = this.deps.nowIso();
      const session: LocalCheckoutSession = {
        droneId: target.id,
        droneName: target.name,
        repoRoot: targetRepoRoot,
        returnRef: returnPoint.ref,
        returnSha: returnPoint.sha,
        returnDetached: returnPoint.detached,
        snapshotSha: snapshot.snapshotSha,
        snapshotKind: snapshot.kind,
        sourceHeadSha: snapshot.headSha,
        sourceTreeSha: snapshot.treeSha,
        sourceDirtyFileCount: snapshot.dirtyFileCount,
        activatedAt: returnPoint.activatedAt,
        updatedAt: now,
      };
      try {
        await this.writeState({ ...currentState, session, updatedAt: now });
      } catch (error) {
        await rollbackSwitch(error, 'saving the local drone switch');
      }
      return { ...(await this.getView()), changed: true };
    });
  }

  update(options?: { includeDirty?: boolean }): Promise<any> {
    return this.runLatest('update', null, async (generation) => {
      const state = await this.readState();
      const session = state.session;
      if (!session) throw new LocalCheckoutError('local_checkout_inactive', 'No drone is currently being used locally.');
      await this.assertActiveHost(session);

      const resolved = await this.resolveDrone(session.droneId);
      await this.assertDroneRepoRoot(resolved.drone, session.repoRoot);
      const includeDirty = options?.includeDirty ?? state.autoUpdates === 'all';
      const snapshot = await this.snapshots.captureAndImport({
        droneId: resolved.id,
        drone: resolved.drone,
        repoRoot: session.repoRoot,
        includeDirty,
      });
      this.assertGeneration(generation);

      const changed = snapshot.snapshotSha !== session.snapshotSha;
      if (changed) await this.checkoutSnapshot(session.repoRoot, snapshot.snapshotSha);

      const metadataChanged =
        changed ||
        snapshot.kind !== session.snapshotKind ||
        snapshot.headSha !== session.sourceHeadSha ||
        snapshot.treeSha !== session.sourceTreeSha ||
        snapshot.dirtyFileCount !== session.sourceDirtyFileCount;
      if (metadataChanged) {
        const now = this.deps.nowIso();
        try {
          await this.writeState({
            ...state,
            session: {
              ...session,
              snapshotSha: snapshot.snapshotSha,
              snapshotKind: snapshot.kind,
              sourceHeadSha: snapshot.headSha,
              sourceTreeSha: snapshot.treeSha,
              sourceDirtyFileCount: snapshot.dirtyFileCount,
              updatedAt: now,
            },
            updatedAt: now,
          });
        } catch (error) {
          if (changed) {
            await this.rollbackAfterFailure(error, 'saving the local checkout update', [
              () => this.checkoutSnapshot(session.repoRoot, session.snapshotSha),
            ]);
          }
          throw error;
        }
      }
      return { ...(await this.getView()), changed };
    });
  }

  setAutoUpdates(value: unknown): Promise<any> {
    if (!isLocalAutoUpdates(value)) {
      return Promise.reject(
        new LocalCheckoutError(
          'invalid_auto_updates',
          'Auto-updates must be Off, Commits only, or All changes.',
          400,
        ),
      );
    }
    const autoUpdates = value;
    return this.runLatest('settings', null, async () => {
      const state = await this.readState();
      if (!state.session && autoUpdates !== 'off') {
        throw new LocalCheckoutError(
          'local_checkout_inactive',
          'Use a drone locally before enabling Auto-updates.',
        );
      }
      if (state.autoUpdates !== autoUpdates) {
        const now = this.deps.nowIso();
        await this.writeState({ ...state, autoUpdates, updatedAt: now });
      }
      return await this.getView();
    });
  }

  returnToOriginal(): Promise<any> {
    return this.runLatest('return', null, async (generation) => {
      const state = await this.readState();
      const session = state.session;
      if (!session) return { ...(await this.getView()), changed: false };
      await this.assertNoGitOperation(session.repoRoot);
      if (!(await this.deps.gitIsClean(session.repoRoot))) {
        throw new LocalCheckoutError(
          'local_checkout_dirty',
          'The local checkout has changes. Commit, send, or discard them before returning.',
        );
      }
      const currentHead = await this.hostCommit(session.repoRoot);
      if (currentHead !== session.snapshotSha) {
        const ancestry = await this.git(session.repoRoot, [
          'merge-base',
          '--is-ancestor',
          session.snapshotSha,
          currentHead,
        ]);
        if (ancestry.code === 0) {
          throw new LocalCheckoutError(
            'local_checkout_has_commits',
            'The local checkout has commits that are not in the drone. Move or send them before returning.',
          );
        }
        if (ancestry.code !== 1) {
          throw new LocalCheckoutError(
            'local_git_check_failed',
            `Could not verify whether the local checkout has commits.\n\n${commandDetails(ancestry)}`,
          );
        }
      }
      this.assertGeneration(generation);
      await this.restoreReturnPoint(session);
      const now = this.deps.nowIso();
      try {
        await this.writeState({ autoUpdates: 'off', session: null, updatedAt: now });
      } catch (error) {
        await this.rollbackAfterFailure(error, 'saving Return', [
          () => this.checkoutSnapshot(session.repoRoot, session.snapshotSha),
        ]);
      }
      return { ...(await this.getView()), changed: true };
    });
  }

  prepareApply(expectedDroneId: string): Promise<any> {
    const selectedDroneId = String(expectedDroneId ?? '').trim();
    if (!selectedDroneId) {
      return Promise.reject(
        new LocalCheckoutError(
          'missing_drone_id',
          'Apply requires the selected drone ID.',
          400,
        ),
      );
    }
    return this.runLatest('apply', selectedDroneId, async (generation) => {
      const state = await this.readState();
      const session = state.session;
      if (!session) throw new LocalCheckoutError('local_checkout_inactive', 'No drone is currently being used locally.');
      if (session.droneId !== selectedDroneId) {
        throw new LocalCheckoutError(
          'local_checkout_changed',
          `"${session.droneName}" replaced the drone that was selected for Apply.`,
        );
      }
      await this.assertActiveHost(session);
      const resolved = await this.resolveDrone(session.droneId);
      await this.assertDroneRepoRoot(resolved.drone, session.repoRoot);
      const current = await this.snapshots.capture({
        droneId: resolved.id,
        drone: resolved.drone,
        includeDirty: session.snapshotKind === 'working-tree',
      });
      if (current.snapshotSha !== session.snapshotSha || current.treeSha !== session.sourceTreeSha) {
        throw new LocalCheckoutError(
          'local_snapshot_stale',
          'The drone changed after this local snapshot was created. Update locally before applying.',
        );
      }
      this.assertGeneration(generation);

      let expectedHeadSha = current.headSha;
      if (session.snapshotKind === 'working-tree') {
        expectedHeadSha = await this.snapshots.promoteWorkingSnapshot({
          snapshot: current,
          expectedTreeSha: session.sourceTreeSha,
        });
      }
      await this.restoreReturnPoint(session);
      const now = this.deps.nowIso();
      try {
        await this.writeState({ autoUpdates: 'off', session: null, updatedAt: now });
      } catch (error) {
        await this.rollbackAfterFailure(error, 'saving Apply preparation', [
          () => this.checkoutSnapshot(session.repoRoot, session.snapshotSha),
        ]);
      }
      return {
        ...(await this.getView()),
        changed: true,
        droneId: session.droneId,
        expectedHeadSha,
      };
    });
  }

  private runLatest<T>(
    kind: string,
    droneId: string | null,
    action: (generation: number) => Promise<T>,
  ): Promise<T> {
    const generation = ++this.generation;
    this.operation = { kind, droneId, generation };
    const run = this.queue.then(async () => {
      this.assertGeneration(generation);
      return await action(generation);
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run.then(
      (value) => {
        if (this.operation?.generation === generation) this.operation = null;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        return {
          ...value,
          operation: this.operation
            ? {
                kind: this.operation.kind,
                droneId: this.operation.droneId,
              }
            : null,
        };
      },
      (error) => {
        if (this.operation?.generation === generation) this.operation = null;
        throw error;
      },
    ) as Promise<T>;
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new LocalCheckoutError('local_operation_cancelled', 'A newer local checkout action replaced this operation.');
    }
  }

  private async readState(): Promise<LocalCheckoutState> {
    return localCheckoutStateFromRegistry(await this.deps.loadRegistry());
  }

  private async writeState(state: LocalCheckoutState): Promise<void> {
    await this.deps.updateRegistry((registry) => {
      registry.settings ??= {};
      registry.settings.localCheckout = {
        autoUpdates: state.autoUpdates,
        session: state.session,
        updatedAt: state.updatedAt,
      };
    });
  }

  private async resolveDrone(ref: string): Promise<{ id: string; name: string; drone: any }> {
    const registry = await this.deps.loadRegistry();
    const found = this.deps.findDroneIdByRef(registry, String(ref ?? '').trim());
    if (!found || found.kind !== 'real') {
      throw new LocalCheckoutError('drone_not_found', `Drone "${ref}" was not found.`, 404);
    }
    const drone = registry?.drones?.[found.id];
    if (!drone) throw new LocalCheckoutError('drone_not_found', `Drone "${ref}" was not found.`, 404);
    if (this.deps.droneRuntime(drone) !== 'container') {
      throw new LocalCheckoutError('unsupported_runtime', 'Host-runtime drones already use the local repository.');
    }
    if (!String(drone.repoPath ?? '').trim()) {
      throw new LocalCheckoutError('missing_repo', 'The drone has no repository attached.');
    }
    return {
      id: String(drone.id ?? found.id).trim() || found.id,
      name: String(drone.name ?? ref).trim() || ref,
      drone,
    };
  }

  private async hostReturnPoint(repoRoot: string): Promise<{ ref: string; sha: string; detached: boolean }> {
    const sha = await this.hostCommit(repoRoot);
    const branch = await this.git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const ref = String(branch.stdout ?? '').trim();
    return {
      ref: ref || sha,
      sha,
      detached: !ref,
    };
  }

  private async assertDroneRepoRoot(drone: any, expectedRepoRoot: string): Promise<void> {
    const currentRepoRoot = await this.deps.gitTopLevel(String(drone?.repoPath ?? '').trim());
    if (currentRepoRoot !== expectedRepoRoot) {
      throw new LocalCheckoutError(
        'local_repo_changed',
        'The drone repository changed while it was in local use. Return before continuing.',
      );
    }
  }

  private async hostCommit(repoRoot: string): Promise<string> {
    const result = await this.git(repoRoot, ['rev-parse', 'HEAD']);
    const sha = normalizedGitSha(result.stdout);
    if (!sha) throw new LocalCheckoutError('invalid_host_head', `Could not resolve HEAD in ${repoRoot}.`);
    return sha;
  }

  private async assertActiveHost(session: LocalCheckoutSession): Promise<void> {
    await this.assertNoGitOperation(session.repoRoot);
    const currentHead = await this.hostCommit(session.repoRoot);
    if (currentHead !== session.snapshotSha) {
      throw new LocalCheckoutError(
        'local_checkout_interrupted',
        'The local repository was switched outside DroneHub. Return it to the active drone snapshot or end local mode before continuing.',
      );
    }
    if (!(await this.deps.gitIsClean(session.repoRoot))) {
      throw new LocalCheckoutError(
        'local_checkout_dirty',
        'The local checkout has changes. Commit, send, or discard them before continuing.',
      );
    }
  }

  private async assertNoGitOperation(repoRoot: string): Promise<void> {
    const paths = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];
    for (const name of paths) {
      const result = await this.git(repoRoot, ['rev-parse', '--git-path', name]);
      const target = String(result.stdout ?? '').trim();
      if (!target) continue;
      const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(repoRoot, target);
      try {
        await fs.stat(resolvedTarget);
        throw new LocalCheckoutError(
          'git_operation_in_progress',
          `A Git operation is already in progress in ${repoRoot}. Finish or abort it before continuing.`,
        );
      } catch (error) {
        if (error instanceof LocalCheckoutError) throw error;
      }
    }
  }

  private async checkoutSnapshot(repoRoot: string, snapshotSha: string): Promise<void> {
    const result = await this.git(repoRoot, [
      'checkout',
      '--quiet',
      '--detach',
      '--no-overwrite-ignore',
      snapshotSha,
    ]);
    if (result.code !== 0) {
      throw new LocalCheckoutError(
        'local_checkout_failed',
        `Could not switch the local repository to the drone snapshot.\n\n${commandDetails(result)}`,
      );
    }
  }

  private async restoreReturnPoint(session: LocalCheckoutSession): Promise<void> {
    await this.restoreHostPoint(session.repoRoot, {
      ref: session.returnRef,
      sha: session.returnSha,
      detached: session.returnDetached,
    });
  }

  private async restoreHostPoint(
    repoRoot: string,
    point: { ref: string; sha: string; detached: boolean },
  ): Promise<void> {
    const args = point.detached
      ? ['checkout', '--quiet', '--detach', '--no-overwrite-ignore', point.sha]
      : ['checkout', '--quiet', '--no-overwrite-ignore', point.ref];
    const result = await this.git(repoRoot, args);
    if (result.code !== 0) {
      throw new LocalCheckoutError(
        'local_return_failed',
        `Could not return to ${point.ref}.\n\n${commandDetails(result)}`,
      );
    }
  }

  private async rollbackAfterFailure(
    error: unknown,
    context: string,
    actions: Array<() => Promise<void>>,
  ): Promise<never> {
    const rollbackErrors: string[] = [];
    for (const action of actions) {
      try {
        await action();
      } catch (rollbackError) {
        rollbackErrors.push(
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        );
      }
    }
    if (rollbackErrors.length > 0) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      throw new LocalCheckoutError(
        'local_rollback_failed',
        [
          `DroneHub could not finish ${context} and could not fully restore the previous checkout.`,
          originalMessage,
          ...rollbackErrors,
        ].filter(Boolean).join('\n\n'),
        500,
      );
    }
    throw error;
  }

  private async git(repoRoot: string, args: string[]): Promise<RunResult> {
    return await this.deps.runHostCommand('git', ['-C', repoRoot, ...args]);
  }
}
