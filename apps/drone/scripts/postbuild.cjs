#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const DRONE_HUB_ELECTRON_ICON_FILE = 'drone-hub-icon.png';

function blipBundleArgs(root) {
  return [
    'build',
    path.resolve(root, '..', '..', 'blip', 'packages', 'cli', 'src', 'cli.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'blip.js')}`,
  ];
}

function mcpBridgeBundleArgs(root) {
  return [
    'build',
    path.join(root, 'src', 'mcp-http-stdio-bridge.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'mcp-http-stdio-bridge.js')}`,
  ];
}

function daemonBundleArgs(root) {
  return [
    'build',
    path.join(root, 'src', 'daemon.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'daemon.bundle.js')}`,
  ];
}

function workspaceBuildArgs(packageName) {
  return ['run', '--filter', packageName, 'build'];
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
  if (
    !content.includes('finishedStatus === "error"') ||
    !content.includes('Blip finished: ${') ||
    !content.includes('detail')
  ) {
    throw new Error(`stale Blip bundle: ${bundlePath} is missing detailed error rendering`);
  }
}

async function assertDaemonBundleIsSelfContained(root) {
  const bundlePath = path.join(root, 'dist', 'daemon.bundle.js');
  const content = await fs.readFile(bundlePath, 'utf8');
  if (content.includes('@drone/assistant-chat')) {
    throw new Error(`non-portable daemon bundle: ${bundlePath} retains a workspace dependency`);
  }
}

async function ensureBlipBundleDependenciesBuilt(root) {
  const repoRoot = path.resolve(root, '../..');
  runOrThrow('bun', workspaceBuildArgs('@mariozechner/pi-ai'), { cwd: repoRoot });
  runOrThrow('bun', workspaceBuildArgs('@mariozechner/pi-agent-core'), { cwd: repoRoot });
  runOrThrow('bun', workspaceBuildArgs('@blip/workspace'), { cwd: repoRoot });
  runOrThrow('bun', workspaceBuildArgs('@blip/tools'), { cwd: repoRoot });
  runOrThrow('bun', workspaceBuildArgs('@blip/core'), { cwd: repoRoot });
  runOrThrow('bun', workspaceBuildArgs('@blip/mcp'), { cwd: repoRoot });
}

async function copyDroneHubElectronMain(root) {
  for (const filename of [
    'hub-electron-main.cjs',
    'hub-electron-launch.cjs',
    'hub-electron-preload.cjs',
    'hub-electron-zoom.cjs',
  ]) {
    const source = path.join(root, 'desktop', filename);
    const target = path.join(root, 'dist', filename);
    await fs.copyFile(source, target);
    await chmodExecutableBestEffort(target);
  }
}

async function copyDroneHubElectronIcon(root) {
  const source = path.resolve(root, '..', 'drone-hub', 'pwa', 'icons', 'drone-app-icon-256.png');
  const target = path.join(root, 'dist', DRONE_HUB_ELECTRON_ICON_FILE);
  await fs.copyFile(source, target);
}

async function copyBuiltDroneHubUi(root) {
  const source = path.resolve(root, '..', 'drone-hub', 'dist');
  const target = path.join(root, 'dist', 'hub-ui');
  try {
    await fs.access(path.join(source, 'index.html'));
  } catch {
    console.warn(
      `Drone Hub UI bundle not found at ${source}; run \`bun run --filter drone-hub build\` before publishing the drone package.`,
    );
    return;
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true });
}

const CONTAINER_RUNTIME_FILES = ['daemon.bundle.js', 'blip.js', 'mcp-http-stdio-bridge.js'];

async function packageContainerRuntime(root) {
  const dist = path.join(root, 'dist');
  const target = path.join(dist, 'container-runtime');
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  for (const fileName of CONTAINER_RUNTIME_FILES) {
    await fs.copyFile(path.join(dist, fileName), path.join(target, fileName));
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  await removeFileBestEffort(path.join(root, 'dist', 'fleet.js'));
  await removeFileBestEffort(path.join(root, 'dist', 'tasks.js'));
  await removeFileBestEffort(path.join(root, 'dist', 'daemon.bundle.js'));
  await removeFileBestEffort(path.join(root, 'dist', 'blip.js'));
  await removeFileBestEffort(path.join(root, 'dist', 'mcp-http-stdio-bridge.js'));
  await ensureBlipBundleDependenciesBuilt(root);
  runOrThrow('bun', daemonBundleArgs(root), { cwd: root });
  runOrThrow('bun', blipBundleArgs(root), { cwd: root });
  runOrThrow('bun', mcpBridgeBundleArgs(root), { cwd: root });
  await assertDaemonBundleIsSelfContained(root);
  await assertBlipBundleHasErrorDetails(root);
  await packageContainerRuntime(root);
  await copyDroneHubElectronMain(root);
  await copyDroneHubElectronIcon(root);
  await copyBuiltDroneHubUi(root);
  await chmodExecutableBestEffort(path.join(root, 'dist', 'blip.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'mcp-http-stdio-bridge.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'cli.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'daemon.bundle.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'hub', 'mcp-server.js'));
}

module.exports = {
  blipBundleArgs,
  CONTAINER_RUNTIME_FILES,
  daemonBundleArgs,
  DRONE_HUB_ELECTRON_ICON_FILE,
  mcpBridgeBundleArgs,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
