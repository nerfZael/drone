import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DVM_STATE_ENTRY_NAMES = [
  'base.json',
  'snapshots',
];

let cachedDvmRootDir: string | null = null;

function repoRootDir(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function configuredDvmRootDir(): string {
  const explicit = process.env.DVM_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(repoRootDir(), 'data', 'dvm');
}

function xdgDvmRootDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'dvm');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dvm');
  }
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  const dataHome = xdgData || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'dvm');
}

function legacyHomeDvmRootDir(): string {
  const home = process.env.HOME?.trim() || os.homedir();
  return path.join(home, '.dvm');
}

function hasBaseConfig(rootDir: string): boolean {
  try {
    const st = fs.statSync(path.join(rootDir, 'base.json'));
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function hasEntries(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function removePathBestEffortSync(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function uniqueArchivePath(targetPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? stamp : `${stamp}-${attempt}`;
    const candidate = `${targetPath}.migrated-${suffix}`;
    if (!fs.existsSync(candidate)) return candidate;
    attempt += 1;
  }
}

function movePathSync(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch {
    // Fall back to copy/remove across devices.
  }
  fs.cpSync(sourcePath, targetPath, { recursive: true });
  removePathBestEffortSync(sourcePath);
}

function filesEqualSync(a: string, b: string): boolean {
  try {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    if (!statA.isFile() || !statB.isFile()) return false;
    if (statA.size !== statB.size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function mergePathIntoTarget(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) return;
  if (!fs.existsSync(targetPath)) {
    movePathSync(sourcePath, targetPath);
    return;
  }

  let sourceStat: fs.Stats;
  let targetStat: fs.Stats;
  try {
    sourceStat = fs.statSync(sourcePath);
    targetStat = fs.statSync(targetPath);
  } catch {
    return;
  }

  if (sourceStat.isDirectory() && targetStat.isDirectory()) {
    for (const name of fs.readdirSync(sourcePath)) {
      mergePathIntoTarget(path.join(sourcePath, name), path.join(targetPath, name));
    }
    if (!hasEntries(sourcePath)) removePathBestEffortSync(sourcePath);
    return;
  }

  if (sourceStat.isFile() && targetStat.isFile() && filesEqualSync(sourcePath, targetPath)) {
    removePathBestEffortSync(sourcePath);
    return;
  }

  movePathSync(sourcePath, uniqueArchivePath(targetPath));
}

export function legacyDvmRootDirs(): string[] {
  const current = path.resolve(configuredDvmRootDir());
  const candidates = [xdgDvmRootDir(), legacyHomeDvmRootDir()]
    .map((dir) => path.resolve(dir))
    .filter((dir) => dir !== current);
  return Array.from(new Set(candidates));
}

function migrateLegacyDvmRootIfNeeded(targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const sourceDir of legacyDvmRootDirs()) {
    if (!fs.existsSync(sourceDir) || path.resolve(sourceDir) === path.resolve(targetDir)) continue;
    for (const entryName of DVM_STATE_ENTRY_NAMES) {
      mergePathIntoTarget(path.join(sourceDir, entryName), path.join(targetDir, entryName));
    }
    if (!hasEntries(sourceDir)) removePathBestEffortSync(sourceDir);
  }
}

export function dvmRootDir(): string {
  if (cachedDvmRootDir) return cachedDvmRootDir;
  const rootDir = configuredDvmRootDir();
  migrateLegacyDvmRootIfNeeded(rootDir);
  cachedDvmRootDir = rootDir;
  return cachedDvmRootDir;
}

export function dvmRootPath(...parts: string[]): string {
  return path.join(dvmRootDir(), ...parts);
}

export function resetDvmRootDirForTests(): void {
  cachedDvmRootDir = null;
}
