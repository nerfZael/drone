import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

export async function execFileStdout(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr ?? '').trim() || error.message));
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

export async function commandForPid(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      const command = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
      const normalized = command.replace(/\0/g, ' ').trim();
      if (normalized) return normalized;
    } catch {
      // Fall through to the portable process lookup.
    }
  }
  try {
    if (process.platform === 'win32') {
      const command = await execFileStdout('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ]);
      return command.trim() || null;
    }
    const command = await execFileStdout('ps', ['-p', String(pid), '-o', 'args=']);
    return command.trim() || null;
  } catch {
    return null;
  }
}

export function isNgrokHttpCommand(command: string, port: number | null): boolean {
  const normalized = command.trim();
  if (!/(?:^|[\\/\s"])(?:ngrok|ngrok\.exe)(?:["\s]|$)/i.test(normalized)) return false;
  if (!/(?:^|\s)http(?:\s|$)/i.test(normalized)) return false;
  return port == null || new RegExp(`(?:^|[:\\s])${port}(?:[/\\s]|$)`).test(normalized);
}
