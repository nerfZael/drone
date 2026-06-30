#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

function fleetBundleArgs(root) {
  return [
    'build',
    path.join(root, 'src', 'fleet.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'fleet.js')}`,
  ];
}

function tasksBundleArgs(root) {
  return [
    'build',
    path.join(root, 'src', 'tasks.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'tasks.js')}`,
  ];
}

function blipBundleArgs(root) {
  return [
    'build',
    path.resolve(root, '..', '..', 'blip', 'packages', 'cli', 'src', 'cli.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'blip.js')}`,
  ];
}

function runOrThrow(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`failed running ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(`command failed: ${cmd} ${args.join(' ')}${details ? `\n${details}` : ''}`);
  }
}

async function chmodExecutableBestEffort(targetPath) {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(targetPath, 0o755);
  } catch {
    // Best-effort only; not all filesystems honor POSIX modes.
  }
}

async function removeFileBestEffort(targetPath) {
  try {
    await fs.rm(targetPath, { force: true });
  } catch {
    // Best-effort only; the subsequent build will fail if the path cannot be overwritten.
  }
}

async function assertBlipBundleHasErrorDetails(root) {
  const bundlePath = path.join(root, 'dist', 'blip.js');
  const content = await fs.readFile(bundlePath, 'utf8');
  if (!content.includes('finishedStatus === "error"') || !content.includes('Blip finished: ${') || !content.includes('detail')) {
    throw new Error(`stale Blip bundle: ${bundlePath} is missing detailed error rendering`);
  }
}

async function copyDesktopVoiceVoskModel(root) {
  const source = path.resolve(root, '..', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us');
  const target = path.join(root, 'dist', 'assets', 'vosk-model-en-us');
  try {
    await fs.access(path.join(source, 'am', 'final.mdl'));
  } catch {
    return;
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  await removeFileBestEffort(path.join(root, 'dist', 'fleet.js'));
  runOrThrow('bun', fleetBundleArgs(root), { cwd: root });
  await removeFileBestEffort(path.join(root, 'dist', 'tasks.js'));
  runOrThrow('bun', tasksBundleArgs(root), { cwd: root });
  await removeFileBestEffort(path.join(root, 'dist', 'blip.js'));
  runOrThrow('bun', blipBundleArgs(root), { cwd: root });
  await assertBlipBundleHasErrorDetails(root);
  await copyDesktopVoiceVoskModel(root);
  await chmodExecutableBestEffort(path.join(root, 'dist', 'blip.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'cli.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'daemon.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'hub', 'mcp-server.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'fleet.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'tasks.js'));
}

module.exports = {
  blipBundleArgs,
  fleetBundleArgs,
  tasksBundleArgs,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
