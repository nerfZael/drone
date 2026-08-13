import fs from 'node:fs/promises';
import path from 'node:path';

import { ChangeRequestError } from './change-request-error';
import {
  runChangeRequestGit,
  safeChangeRequestRefSegment,
  type RunHostCommand,
} from './change-request-git';

export type ChangeRequestObjectStoreDependencies = {
  runHostCommand: RunHostCommand;
  storagePath: (...segments: string[]) => string;
};

/**
 * Durable Git object storage for one change request. It deliberately does not
 * depend on the lifetime or location of a source drone checkout.
 */
export class ChangeRequestObjectStore {
  constructor(private readonly deps: ChangeRequestObjectStoreDependencies) {}

  pathForRequest(requestId: string): string {
    return this.deps.storagePath(
      'change-request-objects',
      `${safeChangeRequestRefSegment(requestId)}.git`,
    );
  }

  async importRevision(input: {
    requestId: string;
    sourceRepoRoot: string;
    sourceRef: string;
    snapshotRef: string;
  }): Promise<string> {
    const storePath = this.pathForRequest(input.requestId);
    await this.ensureInitialized(storePath, input.sourceRepoRoot);
    const result = await this.deps.runHostCommand(
      'git',
      [
        '-C',
        storePath,
        'fetch',
        '--no-tags',
        '--force',
        input.sourceRepoRoot,
        `+${input.sourceRef}:${input.sourceRef}`,
        `+${input.snapshotRef}:${input.snapshotRef}`,
        '+refs/heads/*:refs/heads/*',
        '+refs/remotes/origin/*:refs/remotes/origin/*',
      ],
      { timeoutMs: 120_000 },
    );
    if (result.code !== 0) {
      throw new ChangeRequestError(
        result.stderr || result.stdout || 'Unable to store the change request revision.',
        500,
        'revision_store_failed',
      );
    }
    return storePath;
  }

  async refreshTargets(storePath: string, sourceRepoRoot: string): Promise<void> {
    await this.configureOrigin(storePath, sourceRepoRoot);
    const remote = await this.deps.runHostCommand('git', [
      '-C',
      storePath,
      'remote',
      'get-url',
      'origin',
    ]);
    if (remote.code === 0 && remote.stdout.trim()) {
      await runChangeRequestGit(
        this.deps.runHostCommand,
        storePath,
        ['fetch', 'origin', '--prune'],
        120_000,
      );
      return;
    }
    await runChangeRequestGit(
      this.deps.runHostCommand,
      storePath,
      [
        'fetch',
        '--no-tags',
        '--force',
        sourceRepoRoot,
        '+refs/heads/*:refs/heads/*',
        '+refs/remotes/origin/*:refs/remotes/origin/*',
      ],
      120_000,
    );
  }

  async deleteRevisionRefsBestEffort(requestId: string, refs: readonly string[]): Promise<void> {
    const storePath = this.pathForRequest(requestId);
    for (const ref of refs) {
      await this.deps
        .runHostCommand('git', ['-C', storePath, 'update-ref', '-d', ref])
        .catch(() => null);
    }
  }

  private async ensureInitialized(storePath: string, sourceRepoRoot: string): Promise<void> {
    let initialized = false;
    try {
      const bare = await this.deps.runHostCommand('git', [
        '-C',
        storePath,
        'rev-parse',
        '--is-bare-repository',
      ]);
      initialized = bare.code === 0 && bare.stdout.trim() === 'true';
    } catch {
      // Initialize below.
    }
    if (!initialized) {
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      const result = await this.deps.runHostCommand('git', ['init', '--bare', storePath]);
      if (result.code !== 0) {
        throw new ChangeRequestError(
          result.stderr || result.stdout || 'Unable to initialize change request storage.',
          500,
          'revision_store_failed',
        );
      }
    }
    await this.configureOrigin(storePath, sourceRepoRoot);
    await this.configureIdentity(storePath, sourceRepoRoot);
  }

  private async configureOrigin(storePath: string, sourceRepoRoot: string): Promise<void> {
    const origin = await this.deps.runHostCommand('git', [
      '-C',
      sourceRepoRoot,
      'remote',
      'get-url',
      'origin',
    ]);
    if (origin.code === 0 && origin.stdout.trim()) {
      const current = await this.deps.runHostCommand('git', [
        '-C',
        storePath,
        'remote',
        'get-url',
        'origin',
      ]);
      const command =
        current.code === 0
          ? ['-C', storePath, 'remote', 'set-url', 'origin', origin.stdout.trim()]
          : ['-C', storePath, 'remote', 'add', 'origin', origin.stdout.trim()];
      const configured = await this.deps.runHostCommand('git', command);
      if (configured.code !== 0) {
        throw new ChangeRequestError(
          configured.stderr || configured.stdout || 'Unable to configure change request storage.',
          500,
          'revision_store_failed',
        );
      }
    }
  }

  private async configureIdentity(storePath: string, sourceRepoRoot: string): Promise<void> {
    for (const key of ['user.name', 'user.email']) {
      const value = await this.deps.runHostCommand('git', [
        '-C',
        sourceRepoRoot,
        'config',
        '--get',
        key,
      ]);
      if (value.code !== 0 || !value.stdout.trim()) continue;
      const configured = await this.deps.runHostCommand('git', [
        '-C',
        storePath,
        'config',
        key,
        value.stdout.trim(),
      ]);
      if (configured.code !== 0) {
        throw new ChangeRequestError(
          configured.stderr || configured.stdout || 'Unable to configure change request storage.',
          500,
          'revision_store_failed',
        );
      }
    }
  }
}
