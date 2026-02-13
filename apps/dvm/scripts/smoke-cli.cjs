#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(cmd, args, opts = {}) {
  const res = cp.spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  if (res.status !== 0) {
    fail(
      [
        `Command failed: ${cmd} ${args.join(' ')}`,
        `exit: ${String(res.status)}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
        stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    );
  }
  return { stdout, stderr };
}

function expectedPreferredRoot() {
  if (process.platform === 'win32') {
    const appData = String(process.env.APPDATA || '').trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'dvm');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dvm');
  }
  const xdg = String(process.env.XDG_DATA_HOME || '').trim();
  return path.join(xdg || path.join(os.homedir(), '.local', 'share'), 'dvm');
}

function main() {
  const appRoot = path.resolve(__dirname, '..');
  const dvmCli = path.join(appRoot, 'dist', 'cli.js');
  const dvmGuiScript = path.join(appRoot, 'dist', 'gui', 'scripts', 'install-gui.sh');
  const dvmPathsModPath = path.join(appRoot, 'dist', 'hostPaths.js');
  const configLoaderModPath = path.join(appRoot, 'dist', 'config', 'loader.js');

  assert(fs.existsSync(dvmCli), `missing build artifact: ${dvmCli}`);
  assert(fs.existsSync(dvmGuiScript), `missing build artifact: ${dvmGuiScript}`);
  assert(fs.statSync(dvmGuiScript).size > 0, `empty build artifact: ${dvmGuiScript}`);

  const helpCommands = [
    ['--help'],
    ['create', '--help'],
    ['repo', '--help'],
    ['session', '--help'],
    ['network', '--help'],
    ['snapshot', '--help'],
  ];
  for (const args of helpCommands) {
    run(process.execPath, [dvmCli, ...args], { cwd: appRoot });
  }

  const dvmPaths = require(dvmPathsModPath);
  const configLoader = require(configLoaderModPath);

  const dvmRoot = dvmPaths.dvmRootDir();
  const dvmPreferred = expectedPreferredRoot();
  const dvmLegacy = path.join(os.homedir(), '.dvm');
  assert(path.isAbsolute(dvmRoot), `dvmRootDir() should be absolute, got: ${dvmRoot}`);
  assert(dvmRoot === dvmPreferred || dvmRoot === dvmLegacy, `unexpected dvmRootDir(): ${dvmRoot}`);
  assert(dvmPaths.dvmRootPath('repo').startsWith(dvmRoot), 'dvmRootPath() should be rooted in dvmRootDir()');

  const normalized = configLoader.ConfigLoader.normalizeConfig({
    name: 'smoke',
    image: 'alpine:3.19',
    ports: ['8080:80', 3000],
    volumes: ['/tmp:/work'],
    persistence: { enabled: true, path: '/dvm-data' },
  });
  assert(normalized.name === 'smoke', 'ConfigLoader.normalizeConfig() should preserve name');
  assert(Array.isArray(normalized.ports) && normalized.ports.length === 2, 'normalizeConfig() should normalize ports');
  assert(Array.isArray(normalized.volumes) && normalized.volumes.length === 1, 'normalizeConfig() should normalize volumes');

  console.log('DVM smoke checks passed');
}

main();
