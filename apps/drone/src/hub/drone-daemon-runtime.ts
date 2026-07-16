import fs from 'node:fs';
import path from 'node:path';

export function resolveDroneDaemonJsPath(baseDir: string = __dirname): string {
  const candidates = [
    // Built hub: dist/hub -> dist/daemon.js
    path.resolve(baseDir, '..', 'daemon.js'),
    // Source/dev hub: src/hub -> dist/daemon.js
    path.resolve(baseDir, '..', '..', 'dist', 'daemon.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? path.resolve(baseDir, '..', 'daemon.js');
}

export function resolveDroneDaemonRuntimeDir(baseDir: string = __dirname): string {
  return path.dirname(resolveDroneDaemonJsPath(baseDir));
}

export async function assertDroneDaemonRuntimeReady(runtimeDir: string): Promise<void> {
  for (const fileName of ['daemon.js', 'blip.js']) {
    const filePath = path.join(runtimeDir, fileName);
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new Error(`Missing ${filePath}. Run: bun run --filter drone build`);
    }
  }
}
