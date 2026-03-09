#!/usr/bin/env node
const fs = require('node:fs');
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

function expectedPreferredRoot(appRoot) {
  const explicit = String(process.env.DRONE_DATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  const repoRoot = path.resolve(appRoot, '..', '..');
  return path.join(repoRoot, 'data', 'drone');
}

function main() {
  const appRoot = path.resolve(__dirname, '..');
  const droneCli = path.join(appRoot, 'dist', 'cli.js');
  const daemonJs = path.join(appRoot, 'dist', 'daemon.js');
  const dronePathsModPath = path.join(appRoot, 'dist', 'host', 'paths.js');
  const registryModPath = path.join(appRoot, 'dist', 'host', 'registry.js');

  assert(fs.existsSync(droneCli), `missing build artifact: ${droneCli}`);
  assert(fs.existsSync(daemonJs), `missing build artifact: ${daemonJs}`);

  const helpCommands = [
    ['--help'],
    ['create', '--help'],
    ['hub', '--help'],
    ['agent', '--help'],
    ['proc-start', '--help'],
    ['repo', '--help'],
  ];
  for (const args of helpCommands) {
    run(process.execPath, [droneCli, ...args], { cwd: appRoot });
  }

  const dronePaths = require(dronePathsModPath);
  const registry = require(registryModPath);

  const droneRoot = dronePaths.droneRootDir();
  const preferred = expectedPreferredRoot(appRoot);
  assert(path.isAbsolute(droneRoot), `droneRootDir() should be absolute, got: ${droneRoot}`);
  assert(droneRoot === preferred, `unexpected droneRootDir(): ${droneRoot}`);
  assert(dronePaths.droneRootPath('registry.json').startsWith(droneRoot), 'droneRootPath() should be rooted in droneRootDir()');

  const registryPath = registry.registryPath();
  assert(path.isAbsolute(registryPath), `registryPath() should be absolute, got: ${registryPath}`);
  assert(registryPath.startsWith(droneRoot), `registryPath() should be under drone root, got: ${registryPath}`);

  console.log('Drone smoke checks passed');
}

main();
