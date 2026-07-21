import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

import type { AgentRunFileChangeEntry } from '@blip/protocol';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseMigration,
} from '../host/hub-database';
import { droneRootPath } from '../host/paths';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const PATCH_FILE_MAX_BYTES = 512 * 1024;
const ARTIFACT_PATCH_MAX_BYTES = 24 * 1024 * 1024;
const ARTIFACT_STORE_MAX_BYTES = 1024 * 1024 * 1024;
const ARTIFACT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ARTIFACT_WRITE_CONCURRENCY = 6;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

export type AgentRunDiffArtifactOwner = {
  droneId: string;
  chatName?: string;
  promptId?: string;
  threadId?: string;
  turnId?: string;
};

type ArtifactFileManifest = {
  path: string;
  originalPath?: string;
  fileName?: string;
  patchBytes: number;
  compressedBytes: number;
  truncated?: boolean;
  unavailableReason?: 'empty' | 'artifact-limit';
};

type ArtifactManifest = {
  version: 1;
  id: string;
  createdAt: string;
  owner: AgentRunDiffArtifactOwner;
  targetId: string;
  label: string;
  files: ArtifactFileManifest[];
};

type ArtifactRow = {
  id: string;
  created_at: string;
  owner_json: string;
  manifest_json: string;
  storage_dir: string;
  compressed_bytes: number;
};

const AGENT_RUN_DIFF_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'agent run diff artifacts',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE agent_run_diff_artifacts (
          id TEXT NOT NULL PRIMARY KEY,
          created_at TEXT NOT NULL,
          owner_json TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          storage_dir TEXT NOT NULL,
          compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes >= 0)
        );

        CREATE INDEX idx_agent_run_diff_artifacts_created
          ON agent_run_diff_artifacts (created_at, id);
      `);
    },
  },
];

class AgentRunDiffArtifactError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AgentRunDiffArtifactError';
  }
}

class AgentRunDiffArtifactRepository {
  constructor(readonly database: HubDatabase) {
    database.read((connection) =>
      applyHubDatabaseMigrations(connection, AGENT_RUN_DIFF_MIGRATIONS, 'agent-run-diff-artifacts'),
    );
  }

  read(id: string): ArtifactRow | null {
    return this.database.read(
      (connection) =>
        (connection
          .prepare(
            `
          SELECT id, created_at, owner_json, manifest_json, storage_dir, compressed_bytes
          FROM agent_run_diff_artifacts
          WHERE id = ?
        `,
          )
          .get(id) as ArtifactRow | undefined) ?? null,
    );
  }

  listOldest(): ArtifactRow[] {
    return this.database.read(
      (connection) =>
        connection
          .prepare(
            `
          SELECT id, created_at, owner_json, manifest_json, storage_dir, compressed_bytes
          FROM agent_run_diff_artifacts
          ORDER BY created_at ASC, id ASC
        `,
          )
          .all() as ArtifactRow[],
    );
  }

  async insert(row: ArtifactRow): Promise<void> {
    await this.database.writeTransaction('insert agent run diff artifact', (connection) => {
      connection
        .prepare(
          `
          INSERT INTO agent_run_diff_artifacts (
            id, created_at, owner_json, manifest_json, storage_dir, compressed_bytes
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          row.id,
          row.created_at,
          row.owner_json,
          row.manifest_json,
          row.storage_dir,
          row.compressed_bytes,
        );
    });
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.database.writeTransaction('remove agent run diff artifacts', (connection) => {
      const statement = connection.prepare('DELETE FROM agent_run_diff_artifacts WHERE id = ?');
      for (const id of ids) statement.run(id);
    });
  }
}

let cachedRepository: { path: string; value: AgentRunDiffArtifactRepository } | null = null;
let lastCleanupAt = 0;

function artifactRoot(): string {
  return droneRootPath('agent-run-diffs');
}

function repository(): AgentRunDiffArtifactRepository {
  const database = getHubDatabase();
  if (!database) throw new Error('Hub database is unavailable');
  if (cachedRepository?.path === database.path) return cachedRepository.value;
  const value = new AgentRunDiffArtifactRepository(database);
  cachedRepository = { path: database.path, value };
  return value;
}

function validArtifactId(raw: unknown): string {
  const id = String(raw ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new AgentRunDiffArtifactError('Invalid changed-files artifact id.', 400);
  }
  return id;
}

function parseManifest(raw: string): ArtifactManifest {
  const manifest = JSON.parse(raw) as ArtifactManifest;
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) {
    throw new AgentRunDiffArtifactError('The changed-files artifact is invalid.', 500);
  }
  return manifest;
}

function truncatePatch(raw: string): { patch: string; bytes: number; truncated: boolean } {
  const source = Buffer.from(raw, 'utf8');
  if (source.length <= PATCH_FILE_MAX_BYTES) {
    return { patch: raw, bytes: source.length, truncated: false };
  }
  const bounded = source.subarray(0, PATCH_FILE_MAX_BYTES).toString('utf8');
  const lastNewline = bounded.lastIndexOf('\n');
  const patch = `${lastNewline > 0 ? bounded.slice(0, lastNewline + 1) : bounded}\n… diff truncated …\n`;
  return { patch, bytes: Buffer.byteLength(patch), truncated: true };
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  run: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      await run(values[index]!, index);
    }
  });
  await Promise.all(workers);
}

export async function persistAgentRunDiffArtifact(input: {
  owner: AgentRunDiffArtifactOwner;
  targetId: string;
  label: string;
  entries: AgentRunFileChangeEntry[];
  readPatch: (entry: AgentRunFileChangeEntry) => Promise<string>;
}): Promise<string | null> {
  if (input.entries.length === 0) return null;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const root = artifactRoot();
  const storageDir = id;
  const finalDirectory = path.join(root, storageDir);
  const temporaryDirectory = path.join(root, `.${id}.${crypto.randomUUID()}.tmp`);
  const files: ArtifactFileManifest[] = new Array(input.entries.length);
  let artifactPatchBytes = 0;
  let compressedBytes = 0;

  await fs.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  try {
    await mapWithConcurrency(input.entries, ARTIFACT_WRITE_CONCURRENCY, async (entry, index) => {
      const rawPatch = await input.readPatch(entry);
      const bounded = truncatePatch(rawPatch);
      const base = {
        path: entry.path,
        ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
        patchBytes: bounded.bytes,
        compressedBytes: 0,
        ...(bounded.truncated ? { truncated: true } : {}),
      };
      if (!bounded.patch.trim()) {
        files[index] = { ...base, unavailableReason: 'empty' };
        return;
      }
      if (artifactPatchBytes + bounded.bytes > ARTIFACT_PATCH_MAX_BYTES) {
        files[index] = { ...base, unavailableReason: 'artifact-limit' };
        return;
      }
      artifactPatchBytes += bounded.bytes;
      const fileName = `${String(index).padStart(4, '0')}.patch.gz`;
      const compressed = await gzipAsync(Buffer.from(bounded.patch, 'utf8'), { level: 6 });
      compressedBytes += compressed.length;
      await fs.writeFile(path.join(temporaryDirectory, fileName), compressed, { mode: 0o600 });
      files[index] = { ...base, fileName, compressedBytes: compressed.length };
    });

    const manifest: ArtifactManifest = {
      version: 1,
      id,
      createdAt,
      owner: input.owner,
      targetId: input.targetId,
      label: input.label,
      files,
    };
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.writeFile(path.join(temporaryDirectory, 'manifest.json'), manifestJson, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporaryDirectory, finalDirectory);
    try {
      await repository().insert({
        id,
        created_at: createdAt,
        owner_json: JSON.stringify(input.owner),
        manifest_json: JSON.stringify(manifest),
        storage_dir: storageDir,
        compressed_bytes: compressedBytes + Buffer.byteLength(manifestJson),
      });
    } catch (error) {
      await fs.rm(finalDirectory, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  void cleanupAgentRunDiffArtifacts().catch(() => undefined);
  return id;
}

export async function readAgentRunFileDiff(input: { artifactId: string; path: string }): Promise<{
  artifactId: string;
  path: string;
  patch: string;
  truncated: boolean;
  createdAt: string;
  owner: AgentRunDiffArtifactOwner;
}> {
  const artifactId = validArtifactId(input.artifactId);
  const filePath = String(input.path ?? '').trim();
  if (!filePath) throw new AgentRunDiffArtifactError('A changed file path is required.', 400);
  if (Buffer.byteLength(filePath, 'utf8') > 16 * 1024) {
    throw new AgentRunDiffArtifactError('The changed file path is too long.', 400);
  }
  const row = repository().read(artifactId);
  if (!row) throw new AgentRunDiffArtifactError('This historical diff has expired.', 404);
  const manifest = parseManifest(row.manifest_json);
  const file = manifest.files.find((candidate) => candidate.path === filePath);
  if (!file) throw new AgentRunDiffArtifactError('The file is not part of this agent run.', 404);
  if (!file.fileName) {
    const message =
      file.unavailableReason === 'artifact-limit'
        ? 'This diff exceeded the run artifact size limit.'
        : 'No textual diff is available for this file.';
    throw new AgentRunDiffArtifactError(message, 413);
  }
  try {
    const compressed = await fs.readFile(path.join(artifactRoot(), row.storage_dir, file.fileName));
    const patch = (await gunzipAsync(compressed)).toString('utf8');
    return {
      artifactId,
      path: file.path,
      patch,
      truncated: file.truncated === true,
      createdAt: manifest.createdAt,
      owner: manifest.owner,
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new AgentRunDiffArtifactError('This historical diff has expired.', 404);
    }
    throw error;
  }
}

export async function cleanupAgentRunDiffArtifacts(input?: {
  nowMs?: number;
  force?: boolean;
}): Promise<{ removed: number }> {
  const nowMs = Number.isFinite(input?.nowMs) ? Number(input?.nowMs) : Date.now();
  if (!input?.force && nowMs - lastCleanupAt < CLEANUP_INTERVAL_MS) return { removed: 0 };
  lastCleanupAt = nowMs;
  const records = repository().listOldest();
  let retainedBytes = records.reduce(
    (sum, record) => sum + Math.max(0, Number(record.compressed_bytes) || 0),
    0,
  );
  const remove: ArtifactRow[] = [];
  for (const record of records) {
    const expired = nowMs - Date.parse(record.created_at) > ARTIFACT_RETENTION_MS;
    const overBudget = retainedBytes > ARTIFACT_STORE_MAX_BYTES;
    if (!expired && !overBudget) continue;
    remove.push(record);
    retainedBytes -= Math.max(0, Number(record.compressed_bytes) || 0);
  }
  for (const record of remove) {
    await fs.rm(path.join(artifactRoot(), record.storage_dir), { recursive: true, force: true });
  }
  await repository().remove(remove.map((record) => record.id));
  const removedIds = new Set(remove.map((record) => record.id));
  const retainedDirectories = new Set(
    records
      .filter((record) => !removedIds.has(record.id))
      .map((record) => record.storage_dir),
  );
  await cleanupOrphanedArtifactDirectories(retainedDirectories, nowMs);
  return { removed: remove.length };
}

async function cleanupOrphanedArtifactDirectories(
  retainedDirectories: Set<string>,
  nowMs: number,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(artifactRoot(), { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || retainedDirectories.has(entry.name)) return;
      const isArtifactDirectory = /^[0-9a-f-]{36}$/i.test(entry.name);
      const isTemporaryDirectory = /^\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/i.test(entry.name);
      if (!isArtifactDirectory && !isTemporaryDirectory) return;
      const directory = path.join(artifactRoot(), entry.name);
      const stat = await fs.stat(directory).catch(() => null);
      if (!stat || nowMs - stat.mtimeMs <= ORPHAN_GRACE_MS) return;
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
}

export function agentRunDiffArtifactStatus(error: unknown): number {
  return error instanceof AgentRunDiffArtifactError ? error.statusCode : 500;
}

export function resetAgentRunDiffArtifactsForTests(): void {
  cachedRepository = null;
  lastCleanupAt = 0;
}
