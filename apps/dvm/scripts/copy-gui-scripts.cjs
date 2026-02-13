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
  const sourceDir = path.join(root, 'src', 'gui', 'scripts');
  const targetDir = path.join(root, 'dist', 'gui', 'scripts');

  await fs.mkdir(targetDir, { recursive: true });

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sh')).map((entry) => entry.name);

  for (const file of files) {
    const src = path.join(sourceDir, file);
    const dst = path.join(targetDir, file);
    await fs.copyFile(src, dst);
    await chmodExecutableBestEffort(dst);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
