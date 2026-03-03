import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function preferredDvmRootDir(): string {
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

function legacyDvmRootDir(): string {
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

export function dvmRootDir(): string {
  const preferred = preferredDvmRootDir();
  const legacy = legacyDvmRootDir();
  if (hasBaseConfig(preferred)) return preferred;
  if (hasBaseConfig(legacy)) return legacy;
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(legacy)) return legacy;
  return preferred;
}

export function dvmRootPath(...parts: string[]): string {
  return path.join(dvmRootDir(), ...parts);
}
