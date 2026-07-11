import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { getHubSettingsRepository } from './hub-settings-repository';
import { buildHubStateProjection } from './hub-state-projection';
import { droneRootPath } from './paths';
import { loadRegistry, type DroneRegistry } from './registry';
import { hubSqlitePath, readRegistryJsonFromSqlitePath } from './sqlite-registry-store';

type DatabaseConstructor = typeof import('better-sqlite3');
type DatabaseInstance = import('better-sqlite3').Database;

export type RegistryBackupKind = 'hourly' | 'daily' | 'manual' | 'suspect';
export type RegistryBackupSettingsSource = 'settings' | 'default';
export type RegistryBackupSettings = {
  enabled: boolean;
  hourlyEnabled: boolean;
  dailyEnabled: boolean;
  hourlyRetentionHours: number;
  dailyRetentionDays: number;
};
export type EffectiveRegistryBackupSettings = RegistryBackupSettings & {
  source: RegistryBackupSettingsSource;
  updatedAt: string | null;
};
export type RegistryBackupCounts = {
  drones: number;
  pending: number;
  archived: number;
  total: number;
};
export type RegistryBackupManifest = {
  backupVersion: 1;
  source: 'drone-hub';
  id: string;
  kind: RegistryBackupKind;
  createdAt: string;
  bucket: string;
  scheduledKind?: 'hourly' | 'daily' | 'manual';
  scheduledBucket?: string;
  suspect: boolean;
  reason: string | null;
  paths: {
    sqlite: string | null;
    registryJson: string;
    manifest: string;
  };
  counts: RegistryBackupCounts;
  sha256: {
    sqlite: string | null;
    registryJson: string;
  };
  validation: {
    sqliteReadable: boolean;
    registryJsonReadable: boolean;
  };
};
export type RegistryBackupStatusResponse = {
  ok: true;
  backupSettings: EffectiveRegistryBackupSettings;
  backupDir: string;
  sqlitePath: string;
  next: {
    hourlyDue: boolean;
    dailyDue: boolean;
    nextCheckAt: string | null;
  };
  last: RegistryBackupManifest | null;
  recent: RegistryBackupManifest[];
};

const requireForBackups = createRequire(__filename);

const DEFAULT_REGISTRY_BACKUP_SETTINGS: RegistryBackupSettings = {
  enabled: true,
  hourlyEnabled: true,
  dailyEnabled: true,
  hourlyRetentionHours: 72,
  dailyRetentionDays: 60,
};
const MIN_HOURLY_RETENTION_HOURS = 1;
const MAX_HOURLY_RETENTION_HOURS = 24 * 30;
const MIN_DAILY_RETENTION_DAYS = 1;
const MAX_DAILY_RETENTION_DAYS = 365;
const SUSPICIOUS_EMPTY_MIN_PREVIOUS = 10;
const BACKUP_SCHEDULER_CHECK_MS = 5 * 60 * 1000;
const REGISTRY_BACKUP_SETTING_KEY = 'registry-backups';

let backupSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let backupSchedulerNextCheckAt: string | null = null;
let backupInFlight: Promise<unknown> | null = null;
let backupOperationInFlight: Promise<unknown> | null = null;

function loadDatabaseConstructor(): DatabaseConstructor | null {
  try {
    return requireForBackups('better-sqlite3') as DatabaseConstructor;
  } catch {
    return null;
  }
}

function countRecordEntries(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.keys(value).length;
}

function registryCounts(reg: Pick<DroneRegistry, 'drones' | 'pending' | 'archived'> | null | undefined): RegistryBackupCounts {
  const drones = countRecordEntries(reg?.drones);
  const pending = countRecordEntries(reg?.pending);
  const archived = countRecordEntries(reg?.archived);
  return { drones, pending, archived, total: drones + pending + archived };
}

function backupsRootDir(): string {
  return droneRootPath('backups');
}

function backupKindDir(kind: RegistryBackupKind): string {
  return path.join(backupsRootDir(), kind === 'suspect' ? 'suspect' : kind);
}

function relativeToDroneRoot(p: string | null): string | null {
  if (!p) return null;
  const root = droneRootPath();
  const rel = path.relative(root, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

function sha256File(p: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(p));
  return hash.digest('hex');
}

function parsePositiveInteger(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

function parseBooleanSetting(raw: unknown): boolean | null {
  if (raw === true) return true;
  if (raw === false) return false;
  return null;
}

function normalizeBackupSettings(raw: unknown): EffectiveRegistryBackupSettings {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const enabled = parseBooleanSetting(value.enabled);
  const hourlyEnabled = parseBooleanSetting(value.hourlyEnabled);
  const dailyEnabled = parseBooleanSetting(value.dailyEnabled);
  const hourlyRetentionHours = parsePositiveInteger(value.hourlyRetentionHours, MIN_HOURLY_RETENTION_HOURS, MAX_HOURLY_RETENTION_HOURS);
  const dailyRetentionDays = parsePositiveInteger(value.dailyRetentionDays, MIN_DAILY_RETENTION_DAYS, MAX_DAILY_RETENTION_DAYS);
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt.trim() : null;
  const hasStored =
    enabled != null ||
    hourlyEnabled != null ||
    dailyEnabled != null ||
    hourlyRetentionHours != null ||
    dailyRetentionDays != null ||
    updatedAt != null;
  return {
    enabled: enabled ?? DEFAULT_REGISTRY_BACKUP_SETTINGS.enabled,
    hourlyEnabled: hourlyEnabled ?? DEFAULT_REGISTRY_BACKUP_SETTINGS.hourlyEnabled,
    dailyEnabled: dailyEnabled ?? DEFAULT_REGISTRY_BACKUP_SETTINGS.dailyEnabled,
    hourlyRetentionHours: hourlyRetentionHours ?? DEFAULT_REGISTRY_BACKUP_SETTINGS.hourlyRetentionHours,
    dailyRetentionDays: dailyRetentionDays ?? DEFAULT_REGISTRY_BACKUP_SETTINGS.dailyRetentionDays,
    source: hasStored ? 'settings' : 'default',
    updatedAt,
  };
}

export async function resolveRegistryBackupSettings(): Promise<EffectiveRegistryBackupSettings> {
  const repository = await getHubSettingsRepository();
  let canonical = repository.get<RegistryBackupSettings | null>(REGISTRY_BACKUP_SETTING_KEY);
  if (!canonical) {
    const reg = await loadRegistry();
    const legacyRaw = (reg.settings as any)?.backups;
    if (legacyRaw !== undefined) {
      const legacy = normalizeBackupSettings(legacyRaw);
      canonical = await repository.backfillIfAbsent(
        REGISTRY_BACKUP_SETTING_KEY,
        {
          enabled: legacy.enabled,
          hourlyEnabled: legacy.hourlyEnabled,
          dailyEnabled: legacy.dailyEnabled,
          hourlyRetentionHours: legacy.hourlyRetentionHours,
          dailyRetentionDays: legacy.dailyRetentionDays,
        },
        legacy.updatedAt,
      );
    } else {
      canonical = repository.get<RegistryBackupSettings | null>(REGISTRY_BACKUP_SETTING_KEY);
    }
  }
  return normalizeBackupSettings(
    canonical?.value == null
      ? undefined
      : { ...canonical.value, updatedAt: canonical.updatedAt },
  );
}

export async function upsertStoredRegistryBackupSettings(opts: Partial<RegistryBackupSettings>): Promise<void> {
  const enabled = opts.enabled == null ? null : parseBooleanSetting(opts.enabled);
  const hourlyEnabled = opts.hourlyEnabled == null ? null : parseBooleanSetting(opts.hourlyEnabled);
  const dailyEnabled = opts.dailyEnabled == null ? null : parseBooleanSetting(opts.dailyEnabled);
  const hourlyRetentionHours =
    opts.hourlyRetentionHours == null
      ? null
      : parsePositiveInteger(opts.hourlyRetentionHours, MIN_HOURLY_RETENTION_HOURS, MAX_HOURLY_RETENTION_HOURS);
  const dailyRetentionDays =
    opts.dailyRetentionDays == null ? null : parsePositiveInteger(opts.dailyRetentionDays, MIN_DAILY_RETENTION_DAYS, MAX_DAILY_RETENTION_DAYS);
  if (opts.enabled != null && enabled == null) throw new Error('enabled must be a boolean');
  if (opts.hourlyEnabled != null && hourlyEnabled == null) throw new Error('hourlyEnabled must be a boolean');
  if (opts.dailyEnabled != null && dailyEnabled == null) throw new Error('dailyEnabled must be a boolean');
  if (opts.hourlyRetentionHours != null && hourlyRetentionHours == null) {
    throw new Error(`hourlyRetentionHours must be between ${MIN_HOURLY_RETENTION_HOURS} and ${MAX_HOURLY_RETENTION_HOURS}`);
  }
  if (opts.dailyRetentionDays != null && dailyRetentionDays == null) {
    throw new Error(`dailyRetentionDays must be between ${MIN_DAILY_RETENTION_DAYS} and ${MAX_DAILY_RETENTION_DAYS}`);
  }

  await resolveRegistryBackupSettings();
  await (await getHubSettingsRepository()).update<RegistryBackupSettings>(
    REGISTRY_BACKUP_SETTING_KEY,
    (current) => {
      const prev = normalizeBackupSettings(current?.value);
      return {
        enabled: enabled ?? prev.enabled,
        hourlyEnabled: hourlyEnabled ?? prev.hourlyEnabled,
        dailyEnabled: dailyEnabled ?? prev.dailyEnabled,
        hourlyRetentionHours: hourlyRetentionHours ?? prev.hourlyRetentionHours,
        dailyRetentionDays: dailyRetentionDays ?? prev.dailyRetentionDays,
      };
    },
  );
}

function hourlyBucket(at = new Date()): string {
  const bucketStartMs = Math.floor(at.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
  return new Date(bucketStartMs).toISOString().replace(/[:.]/g, '-');
}

function dailyBucket(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

function backupBucket(kind: RegistryBackupKind, at = new Date()): string {
  if (kind === 'daily') return dailyBucket(at);
  if (kind === 'manual' || kind === 'suspect') return at.toISOString().replace(/[:.]/g, '-');
  return hourlyBucket(at);
}

function backupPrefix(kind: RegistryBackupKind, bucket: string): string {
  if (kind === 'suspect') return `suspect-${bucket}`;
  return kind === 'daily' ? bucket : bucket;
}

async function appendBackupLog(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): Promise<void> {
  const payload = { at: new Date().toISOString(), ...(meta ?? {}) };
  const line = `[DroneHub] ${message} ${JSON.stringify(payload)}`;
  try {
    await fsp.mkdir(path.dirname(droneRootPath('hub.log')), { recursive: true });
    await fsp.appendFile(droneRootPath('hub.log'), `${line}\n`, 'utf8');
  } catch {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}

async function readManifestFile(p: string): Promise<RegistryBackupManifest | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(p, 'utf8')) as RegistryBackupManifest;
    if (parsed?.backupVersion !== 1 || parsed?.source !== 'drone-hub') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function listBackupManifestPaths(): Promise<string[]> {
  const dirs = ['hourly', 'daily', 'manual', 'suspect'].map((name) => path.join(backupsRootDir(), name));
  const out: string[] = [];
  for (const dir of dirs) {
    try {
      const entries = await fsp.readdir(dir);
      for (const entry of entries) {
        if (/^manifest-.*\.json$/.test(entry)) out.push(path.join(dir, entry));
      }
    } catch {
      // ignore missing dirs
    }
  }
  return out;
}

export async function listRegistryBackupManifests(limit = 20): Promise<RegistryBackupManifest[]> {
  const manifests = (await Promise.all((await listBackupManifestPaths()).map((p) => readManifestFile(p)))).filter(
    (item): item is RegistryBackupManifest => Boolean(item),
  );
  return manifests
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Math.floor(limit)));
}

async function latestHealthyManifest(): Promise<RegistryBackupManifest | null> {
  const manifests = await listRegistryBackupManifests(200);
  return manifests.find((item) => !item.suspect && item.counts.total >= SUSPICIOUS_EMPTY_MIN_PREVIOUS) ?? null;
}

async function manifestForBucket(kind: RegistryBackupKind, bucket: string): Promise<RegistryBackupManifest | null> {
  const prefix = backupPrefix(kind, bucket);
  return await readManifestFile(path.join(backupKindDir(kind), `manifest-${prefix}.json`));
}

async function scheduledBucketHandled(kind: 'hourly' | 'daily', bucket: string): Promise<boolean> {
  if (await manifestForBucket(kind, bucket)) return true;
  const suspect = await readManifestFile(path.join(backupKindDir('suspect'), `manifest-${kind}-${bucket}.json`));
  return Boolean(suspect);
}

async function sqliteBackup(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (!fs.existsSync(sourcePath)) return false;
  const Database = loadDatabaseConstructor();
  if (!Database) return false;
  let db: DatabaseInstance | null = null;
  try {
    db = new Database(sourcePath, { readonly: true, fileMustExist: true });
    await db.backup(destinationPath);
    return true;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function validateSqliteBackup(p: string | null): Promise<boolean> {
  if (!p) return false;
  try {
    const raw = readRegistryJsonFromSqlitePath(p);
    if (typeof raw !== 'string') return false;
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  } finally {
    await removeSqliteSidecarsBestEffort(p);
  }
}

async function removeSqliteSidecarsBestEffort(p: string): Promise<void> {
  await Promise.all([fsp.rm(`${p}-shm`, { force: true }).catch(() => {}), fsp.rm(`${p}-wal`, { force: true }).catch(() => {})]);
}

async function createRegistryBackupFiles(
  kind: RegistryBackupKind,
  reg: DroneRegistry,
  opts?: {
    reason?: string | null;
    bucket?: string;
    prefix?: string;
    scheduledKind?: 'hourly' | 'daily' | 'manual';
    scheduledBucket?: string;
  },
): Promise<RegistryBackupManifest> {
  const createdAt = new Date();
  const bucket = opts?.bucket ?? backupBucket(kind, createdAt);
  const prefix = opts?.prefix ?? backupPrefix(kind, bucket);
  const dir = backupKindDir(kind);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });

  const registryJsonPath = path.join(dir, `registry-${prefix}.json`);
  const sqlitePath = path.join(dir, `hub-${prefix}.sqlite`);
  const manifestPath = path.join(dir, `manifest-${prefix}.json`);
  const sqliteCreated = await sqliteBackup(hubSqlitePath(), sqlitePath);
  await fsp.writeFile(registryJsonPath, JSON.stringify(reg, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    await Promise.all([
      fsp.chmod(registryJsonPath, 0o600).catch(() => {}),
      sqliteCreated ? fsp.chmod(sqlitePath, 0o600).catch(() => {}) : Promise.resolve(),
    ]);
  }

  const manifest: RegistryBackupManifest = {
    backupVersion: 1,
    source: 'drone-hub',
    id: crypto.randomUUID(),
    kind,
    createdAt: createdAt.toISOString(),
    bucket,
    ...(opts?.scheduledKind ? { scheduledKind: opts.scheduledKind } : {}),
    ...(opts?.scheduledBucket ? { scheduledBucket: opts.scheduledBucket } : {}),
    suspect: kind === 'suspect',
    reason: opts?.reason ?? null,
    paths: {
      sqlite: sqliteCreated ? relativeToDroneRoot(sqlitePath) : null,
      registryJson: relativeToDroneRoot(registryJsonPath) ?? registryJsonPath,
      manifest: relativeToDroneRoot(manifestPath) ?? manifestPath,
    },
    counts: registryCounts(reg),
    sha256: {
      sqlite: sqliteCreated ? sha256File(sqlitePath) : null,
      registryJson: sha256File(registryJsonPath),
    },
    validation: {
      sqliteReadable: await validateSqliteBackup(sqliteCreated ? sqlitePath : null),
      registryJsonReadable: true,
    },
  };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  if (process.platform !== 'win32') await fsp.chmod(manifestPath, 0o600).catch(() => {});
  await appendBackupLog(kind === 'suspect' ? 'warn' : 'info', kind === 'suspect' ? 'registry backup quarantined suspicious state' : 'registry backup created', {
    kind,
    bucket,
    counts: manifest.counts,
    sqliteCreated,
    manifestPath: manifest.paths.manifest,
    reason: manifest.reason,
  });
  return manifest;
}

async function pruneKind(kind: 'hourly' | 'daily', maxAgeMs: number): Promise<void> {
  const dir = backupKindDir(kind);
  const cutoff = Date.now() - maxAgeMs;
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry);
    try {
      const stat = await fsp.stat(p);
      if (stat.mtimeMs >= cutoff) continue;
      await fsp.rm(p, { force: true });
      await appendBackupLog('info', 'registry backup pruned', { kind, path: relativeToDroneRoot(p) });
    } catch {
      // ignore individual prune failures
    }
  }
}

export async function pruneRegistryBackups(settings?: EffectiveRegistryBackupSettings): Promise<void> {
  const effective = settings ?? (await resolveRegistryBackupSettings());
  await pruneKind('hourly', effective.hourlyRetentionHours * 60 * 60 * 1000);
  await pruneKind('daily', effective.dailyRetentionDays * 24 * 60 * 60 * 1000);
}

async function runSerializedBackupOperation<T>(fn: () => Promise<T>): Promise<T> {
  while (backupOperationInFlight) {
    try {
      await backupOperationInFlight;
    } catch {
      // The next queued backup should still get a chance to run even if the
      // previous operation failed.
    }
  }
  const operation = fn();
  backupOperationInFlight = operation;
  try {
    return await operation;
  } finally {
    if (backupOperationInFlight === operation) backupOperationInFlight = null;
  }
}

async function createRegistryBackupUnlocked(kind: 'hourly' | 'daily' | 'manual', opts?: { force?: boolean }): Promise<RegistryBackupManifest | null> {
  const settings = await resolveRegistryBackupSettings();
  if (!opts?.force) {
    if (!settings.enabled) return null;
    if (kind === 'hourly' && !settings.hourlyEnabled) return null;
    if (kind === 'daily' && !settings.dailyEnabled) return null;
  }
  const bucket = backupBucket(kind);
  if (!opts?.force && kind !== 'manual' && (await manifestForBucket(kind, bucket))) return null;

  // Export a compatibility snapshot assembled from canonical owners. Bun may
  // not be able to load Node's native SQLite binding, so retain the raw legacy
  // snapshot only as that runtime's migration fallback.
  const reg = await buildHubStateProjection().catch((error) => {
    if ((globalThis as any).Bun) return loadRegistry();
    throw error;
  });
  const counts = registryCounts(reg);
  const latestHealthy = await latestHealthyManifest();
  if (counts.total === 0 && latestHealthy && latestHealthy.counts.total >= SUSPICIOUS_EMPTY_MIN_PREVIOUS) {
    const suspectPrefix = `${kind}-${bucket}`;
    const existingSuspect = await readManifestFile(path.join(backupKindDir('suspect'), `manifest-${suspectPrefix}.json`));
    if (existingSuspect) return existingSuspect;
    await appendBackupLog('warn', 'registry backup skipped suspicious state', {
      kind,
      counts,
      previousCounts: latestHealthy.counts,
      previousCreatedAt: latestHealthy.createdAt,
    });
    const suspect = await createRegistryBackupFiles('suspect', reg, {
      bucket: `${kind}:${bucket}`,
      prefix: suspectPrefix,
      scheduledKind: kind,
      scheduledBucket: bucket,
      reason: `empty registry while previous healthy backup had ${latestHealthy.counts.total} fleet entries`,
    });
    await pruneRegistryBackups(settings);
    return suspect;
  }

  const manifest = await createRegistryBackupFiles(kind, reg);
  await pruneRegistryBackups(settings);
  return manifest;
}

export async function createRegistryBackup(kind: 'hourly' | 'daily' | 'manual', opts?: { force?: boolean }): Promise<RegistryBackupManifest | null> {
  return await runSerializedBackupOperation(() => createRegistryBackupUnlocked(kind, opts));
}

export async function runDueRegistryBackups(): Promise<void> {
  if (backupInFlight) {
    await backupInFlight;
    return;
  }
  backupInFlight = (async () => {
    const settings = await resolveRegistryBackupSettings();
    if (!settings.enabled) return;
    if (settings.hourlyEnabled) await createRegistryBackup('hourly');
    if (settings.dailyEnabled) await createRegistryBackup('daily');
  })();
  try {
    await backupInFlight;
  } finally {
    backupInFlight = null;
  }
}

export function startRegistryBackupScheduler(): void {
  if (backupSchedulerTimer) return;
  const scheduleNext = () => {
    backupSchedulerNextCheckAt = new Date(Date.now() + BACKUP_SCHEDULER_CHECK_MS).toISOString();
  };
  void runDueRegistryBackups().catch((error: any) => {
    void appendBackupLog('error', 'registry backup scheduler failed', { error: error?.message ?? String(error) });
  });
  scheduleNext();
  backupSchedulerTimer = setInterval(() => {
    scheduleNext();
    void runDueRegistryBackups().catch((error: any) => {
      void appendBackupLog('error', 'registry backup scheduler failed', { error: error?.message ?? String(error) });
    });
  }, BACKUP_SCHEDULER_CHECK_MS);
  try {
    (backupSchedulerTimer as any).unref?.();
  } catch {
    // ignore
  }
}

export async function resolveRegistryBackupStatusResponse(): Promise<RegistryBackupStatusResponse> {
  const settings = await resolveRegistryBackupSettings();
  const [recent, hourlyExisting, dailyExisting] = await Promise.all([
    listRegistryBackupManifests(12),
    scheduledBucketHandled('hourly', backupBucket('hourly')),
    scheduledBucketHandled('daily', backupBucket('daily')),
  ]);
  return {
    ok: true,
    backupSettings: settings,
    backupDir: backupsRootDir(),
    sqlitePath: hubSqlitePath(),
    next: {
      hourlyDue: settings.enabled && settings.hourlyEnabled && !hourlyExisting,
      dailyDue: settings.enabled && settings.dailyEnabled && !dailyExisting,
      nextCheckAt: backupSchedulerNextCheckAt,
    },
    last: recent[0] ?? null,
    recent,
  };
}

export const REGISTRY_BACKUP_SETTING_LIMITS = {
  minHourlyRetentionHours: MIN_HOURLY_RETENTION_HOURS,
  maxHourlyRetentionHours: MAX_HOURLY_RETENTION_HOURS,
  minDailyRetentionDays: MIN_DAILY_RETENTION_DAYS,
  maxDailyRetentionDays: MAX_DAILY_RETENTION_DAYS,
  defaultSettings: DEFAULT_REGISTRY_BACKUP_SETTINGS,
};
