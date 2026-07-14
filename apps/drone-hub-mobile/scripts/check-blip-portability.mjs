import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outputDir = path.join(os.tmpdir(), 'drone-hub-mobile-blip-portability');
const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
rmSync(outputDir, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules/expo/bin/cli'),
    'export',
    '--platform',
    'android',
    '--output-dir',
    outputDir,
    '--clear',
  ],
  { cwd: appRoot, encoding: 'utf8', stdio: 'inherit' },
);
rmSync(outputDir, { recursive: true, force: true });
if (result.status !== 0) process.exit(result.status ?? 1);
