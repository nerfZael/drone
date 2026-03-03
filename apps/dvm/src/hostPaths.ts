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

export function dvmRootDir(): string {
  return preferredDvmRootDir();
}

export function dvmRootPath(...parts: string[]): string {
  return path.join(dvmRootDir(), ...parts);
}
