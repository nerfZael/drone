import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  ChangeRequestPatch,
  ChangeRequestRepository,
} from '../../src/hub/change-requests/change-request-repository';
import type { ChangeRequestRecord } from '../../src/hub/change-requests/change-request-types';
import type { RunResult } from '../../src/host/dvm';

export class MemoryChangeRequestRepository implements ChangeRequestRepository {
  private sequence = 0;
  private readonly records = new Map<string, ChangeRequestRecord>();
  failNextUpdateMessage: string | null = null;
  private failNextMirrorUpdateMessage: string | null = null;

  failNextMirrorUpdate(message: string): void {
    this.failNextMirrorUpdateMessage = message;
  }

  async insert(input: Omit<ChangeRequestRecord, 'number'>): Promise<ChangeRequestRecord> {
    const record = { ...input, number: ++this.sequence };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  get(id: string): ChangeRequestRecord | null {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  list(): ChangeRequestRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async update(id: string, patch: ChangeRequestPatch): Promise<ChangeRequestRecord> {
    const failure =
      this.failNextUpdateMessage ?? (patch.githubMirror ? this.failNextMirrorUpdateMessage : null);
    if (failure) {
      if (this.failNextUpdateMessage) this.failNextUpdateMessage = null;
      else this.failNextMirrorUpdateMessage = null;
      throw new Error(failure);
    }
    const current = this.records.get(id);
    if (!current) throw new Error(`unknown change request: ${id}`);
    const updated = { ...current, ...patch };
    this.records.set(id, updated);
    return structuredClone(updated);
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand('git', ['-C', cwd, ...args]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

export async function snapshotCommit(
  repoRoot: string,
  baseSha: string,
  fileName: string,
  contents: string,
): Promise<string> {
  await git(repoRoot, ['reset', '--hard', baseSha]);
  await fs.writeFile(path.join(repoRoot, fileName), contents);
  await git(repoRoot, ['add', fileName]);
  const tree = await git(repoRoot, ['write-tree']);
  const commit = await git(repoRoot, [
    'commit-tree',
    tree,
    '-p',
    baseSha,
    '-m',
    `snapshot ${fileName}`,
  ]);
  await git(repoRoot, ['reset', '--hard', baseSha]);
  return commit;
}
