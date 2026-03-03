import os from 'node:os';
import path from 'node:path';

function preferredDroneRootDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'drone');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'drone');
  }
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  const dataHome = xdgData || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'drone');
}

export function droneRootDir(): string {
  return preferredDroneRootDir();
}

export function droneRootPath(...parts: string[]): string {
  return path.join(droneRootDir(), ...parts);
}
