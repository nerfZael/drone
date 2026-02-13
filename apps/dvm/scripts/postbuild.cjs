#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

async function chmodExecutableBestEffort(targetPath) {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(targetPath, 0o755);
  } catch {
    // Best-effort only; not all filesystems honor POSIX modes.
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  await chmodExecutableBestEffort(path.join(root, 'dist', 'cli.js'));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
