import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import {
  getHubSettingRecordSync,
  getHubSettingsRepository,
} from '../host/hub-settings-repository';
import { droneRootPath } from '../host/paths';
import { readRegistryJsonFromSqlite } from '../host/sqlite-registry-store';

export type DesktopVoiceModelInstallState = 'missing' | 'installed' | 'installing' | 'error';

export type DesktopVoiceModelCatalogEntry = {
  id: string;
  label: string;
  language: string;
  size: string;
  bundled: boolean;
  url: string;
  archiveName: string;
  extractedDirName: string;
  sourceUrl: string;
};

export type DesktopVoiceModelStatus = {
  ok: true;
  state: DesktopVoiceModelInstallState;
  installed: boolean;
  modelDir: string | null;
  message: string;
  error: string | null;
  installing: boolean;
  installingModelId: string | null;
  selectedModelId: string;
  effectiveModelId: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  catalog: DesktopVoiceModelCatalogEntry[];
};

const DESKTOP_VOICE_MODEL_CATALOG: DesktopVoiceModelCatalogEntry[] = [
  {
    id: 'vosk-model-small-en-us-0.15',
    label: 'Vosk small English',
    language: 'English',
    size: '40 MB',
    bundled: true,
    url: 'bundled',
    archiveName: 'bundled',
    extractedDirName: 'vosk-model-en-us',
    sourceUrl: 'https://alphacephei.com/vosk/models',
  },
  {
    id: 'vosk-model-en-us-0.22-lgraph',
    label: 'Vosk English lgraph',
    language: 'English',
    size: '128 MB',
    bundled: false,
    url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip',
    archiveName: 'vosk-model-en-us-0.22-lgraph.zip',
    extractedDirName: 'vosk-model-en-us-0.22-lgraph',
    sourceUrl: 'https://alphacephei.com/vosk/models',
  },
];

const DEFAULT_MODEL_ID = DESKTOP_VOICE_MODEL_CATALOG[0].id;
const DESKTOP_VOICE_MODEL_SETTING_KEY = 'desktop-voice.model';

let installJob: {
  modelId: string;
  startedAt: string;
  updatedAt: string;
  error: string | null;
  promise: Promise<void>;
} | null = null;

function catalogEntry(modelId: string): DesktopVoiceModelCatalogEntry | null {
  return DESKTOP_VOICE_MODEL_CATALOG.find((entry) => entry.id === modelId) ?? null;
}

function modelsRoot(): string {
  return droneRootPath('models', 'desktop-voice');
}

function installedModelDir(entry: DesktopVoiceModelCatalogEntry): string {
  return path.join(modelsRoot(), entry.extractedDirName);
}

function hasRequiredVoskModelFiles(modelDir: string): boolean {
  return fsSync.existsSync(path.join(modelDir, 'am', 'final.mdl')) &&
    fsSync.existsSync(path.join(modelDir, 'graph', 'HCLr.fst')) &&
    fsSync.existsSync(path.join(modelDir, 'graph', 'Gr.fst')) &&
    fsSync.existsSync(path.join(modelDir, 'conf', 'model.conf'));
}

function envModelDir(): string | null {
  const raw = String(process.env.DRONE_DESKTOP_VOICE_VOSK_MODEL_DIR ?? '').trim();
  if (!raw) return null;
  return path.resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME || ''));
}

function bundledSmallModelCandidates(): string[] {
  return [
    path.resolve(__dirname, '..', 'assets', 'vosk-model-en-us'),
    path.resolve(__dirname, '..', '..', '..', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us'),
    path.resolve(process.cwd(), 'apps', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us'),
  ];
}

function bundledSmallModelDir(): string | null {
  return bundledSmallModelCandidates().find((candidate) => hasRequiredVoskModelFiles(candidate)) ?? null;
}

function modelDirForEntry(entry: DesktopVoiceModelCatalogEntry): string | null {
  if (entry.bundled) return bundledSmallModelDir();
  const modelDir = installedModelDir(entry);
  return hasRequiredVoskModelFiles(modelDir) ? modelDir : null;
}

function readLegacySelectedModelIdSync(): { modelId: string; updatedAt: string | null } | null {
  try {
    const raw = readRegistryJsonFromSqlite() ?? fsSync.readFileSync(droneRootPath('registry.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const modelId = String(parsed?.settings?.desktopVoice?.modelId ?? '').trim();
    const updatedAtRaw = parsed?.settings?.desktopVoice?.updatedAt;
    return catalogEntry(modelId)
      ? {
          modelId,
          updatedAt:
            typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw.trim() : null,
        }
      : null;
  } catch {
    return null;
  }
}

function readSelectedModelIdSync(): string {
  const canonical = getHubSettingRecordSync<{ modelId?: unknown }>(DESKTOP_VOICE_MODEL_SETTING_KEY);
  const modelId = String(canonical?.value?.modelId ?? '').trim();
  if (catalogEntry(modelId)) return modelId;
  return readLegacySelectedModelIdSync()?.modelId ?? DEFAULT_MODEL_ID;
}

async function ensureSelectedModelSetting(): Promise<void> {
  const repository = await getHubSettingsRepository();
  if (repository.get(DESKTOP_VOICE_MODEL_SETTING_KEY)) return;
  const legacy = readLegacySelectedModelIdSync();
  if (!legacy) return;
  await repository.backfillIfAbsent(
    DESKTOP_VOICE_MODEL_SETTING_KEY,
    { modelId: legacy.modelId },
    legacy.updatedAt,
  );
}

async function persistSelectedModelId(modelId: string): Promise<void> {
  if (!catalogEntry(modelId)) throw new Error(`Unknown desktop voice model: ${modelId}`);
  await (await getHubSettingsRepository()).put(DESKTOP_VOICE_MODEL_SETTING_KEY, { modelId });
}

export function managedDesktopVoiceModelDirSync(): string | null {
  const explicit = envModelDir();
  if (explicit && hasRequiredVoskModelFiles(explicit)) return explicit;
  const selected = catalogEntry(readSelectedModelIdSync()) ?? DESKTOP_VOICE_MODEL_CATALOG[0];
  const selectedDir = modelDirForEntry(selected);
  if (selectedDir) return selectedDir;
  return modelDirForEntry(DESKTOP_VOICE_MODEL_CATALOG[0]);
}

function statusMessage(state: DesktopVoiceModelInstallState, selected: DesktopVoiceModelCatalogEntry, modelDir: string | null, error: string | null): string {
  if (state === 'installing') return `Installing ${selected.label}.`;
  if (state === 'error') return error ?? 'Desktop voice trigger model install failed.';
  if (modelDir) return `Using ${selected.label} at ${modelDir}`;
  return `${selected.label} is not installed.`;
}

export function desktopVoiceModelStatus(): DesktopVoiceModelStatus {
  const selected = catalogEntry(readSelectedModelIdSync()) ?? DESKTOP_VOICE_MODEL_CATALOG[0];
  const modelDir = managedDesktopVoiceModelDirSync();
  const effectiveEntry = DESKTOP_VOICE_MODEL_CATALOG.find((entry) => modelDirForEntry(entry) === modelDir) ?? null;
  const installing = Boolean(installJob);
  const state: DesktopVoiceModelInstallState = installing ? 'installing' : modelDir ? 'installed' : installJob?.error ? 'error' : 'missing';
  const error = installJob?.error ?? null;
  const messageEntry = installJob ? catalogEntry(installJob.modelId) ?? selected : selected;
  return {
    ok: true,
    state,
    installed: Boolean(modelDir),
    modelDir,
    message: statusMessage(state, messageEntry, modelDir, error),
    error,
    installing,
    installingModelId: installJob?.modelId ?? null,
    selectedModelId: selected.id,
    effectiveModelId: effectiveEntry?.id ?? null,
    startedAt: installJob?.startedAt ?? null,
    updatedAt: installJob?.updatedAt ?? null,
    catalog: DESKTOP_VOICE_MODEL_CATALOG,
  };
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited ${code ?? signal ?? 'unknown'}`));
    });
  });
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const file = fsSync.createWriteStream(targetPath);
  await new Promise<void>((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
    const reader = response.body!.getReader();
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) {
          file.end();
          return;
        }
        if (!file.write(Buffer.from(value))) file.once('drain', pump);
        else pump();
      }).catch(reject);
    };
    pump();
  });
}

async function installDownloadedModel(entry: DesktopVoiceModelCatalogEntry): Promise<void> {
  const root = modelsRoot();
  const targetDir = installedModelDir(entry);
  const tmpDir = path.join(root, `.install-${entry.id}-${Date.now()}`);
  const archivePath = path.join(tmpDir, entry.archiveName);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await downloadFile(entry.url, archivePath);
    await runCommand('unzip', ['-q', archivePath], tmpDir);
    const extractedDir = path.join(tmpDir, entry.extractedDirName);
    if (!hasRequiredVoskModelFiles(extractedDir)) {
      throw new Error('Downloaded archive did not contain a usable Vosk model.');
    }
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.rename(extractedDir, targetDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function startDesktopVoiceModelInstall(modelId = DEFAULT_MODEL_ID): Promise<DesktopVoiceModelStatus> {
  await ensureSelectedModelSetting();
  const entry = catalogEntry(modelId);
  if (!entry) throw new Error(`Unknown desktop voice model: ${modelId}`);
  if (installJob) return desktopVoiceModelStatus();
  if (modelDirForEntry(entry)) {
    await persistSelectedModelId(entry.id);
    return desktopVoiceModelStatus();
  }
  if (entry.bundled) return desktopVoiceModelStatus();
  const startedAt = new Date().toISOString();
  const job = {
    modelId: entry.id,
    startedAt,
    updatedAt: startedAt,
    error: null as string | null,
    promise: Promise.resolve(),
  };
  job.promise = installDownloadedModel(entry)
    .then(() => persistSelectedModelId(entry.id))
    .catch((error: any) => {
      job.error = error?.message ?? String(error);
      job.updatedAt = new Date().toISOString();
      throw error;
    })
    .finally(() => {
      if (installJob === job) installJob = null;
    });
  installJob = job;
  void job.promise.catch(() => {});
  return desktopVoiceModelStatus();
}

export async function removeDesktopVoiceModel(modelId?: string): Promise<DesktopVoiceModelStatus> {
  await ensureSelectedModelSetting();
  if (installJob) throw new Error('Desktop voice model install is still running.');
  const entry = catalogEntry(String(modelId ?? '').trim()) ?? DESKTOP_VOICE_MODEL_CATALOG[1];
  if (!entry.bundled) await fs.rm(installedModelDir(entry), { recursive: true, force: true });
  if (readSelectedModelIdSync() === entry.id) await persistSelectedModelId(DEFAULT_MODEL_ID);
  return desktopVoiceModelStatus();
}
