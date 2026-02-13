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
    return path.join(appData, 'drone');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'drone');
  }
  const xdg = String(process.env.XDG_DATA_HOME || '').trim();
  return path.join(xdg || path.join(os.homedir(), '.local', 'share'), 'drone');
}

function main() {
  const appRoot = path.resolve(__dirname, '..');
  const droneCli = path.join(appRoot, 'dist', 'cli.js');
  const daemonJs = path.join(appRoot, 'dist', 'daemon.js');
  const dronePathsModPath = path.join(appRoot, 'dist', 'host', 'paths.js');
  const registryModPath = path.join(appRoot, 'dist', 'host', 'registry.js');
  const hostDvmModPath = path.join(appRoot, 'dist', 'host', 'dvm.js');

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
  const hostDvm = require(hostDvmModPath);

  const droneRoot = dronePaths.droneRootDir();
  const preferred = expectedPreferredRoot();
  const legacy = path.join(os.homedir(), '.drone');
  assert(path.isAbsolute(droneRoot), `droneRootDir() should be absolute, got: ${droneRoot}`);
  assert(droneRoot === preferred || droneRoot === legacy, `unexpected droneRootDir(): ${droneRoot}`);
  assert(dronePaths.droneRootPath('registry.json').startsWith(droneRoot), 'droneRootPath() should be rooted in droneRootDir()');

  const registryPath = registry.registryPath();
  assert(path.isAbsolute(registryPath), `registryPath() should be absolute, got: ${registryPath}`);
  assert(registryPath.startsWith(droneRoot), `registryPath() should be under drone root, got: ${registryPath}`);

  const parsedPorts = hostDvm.parsePortsOutput('7777:7777\n3389:3389\nnot-a-port\n');
  assert(Array.isArray(parsedPorts) && parsedPorts.length === 2, 'parsePortsOutput() should parse two valid ports');
  const parsedLs = hostDvm.parseLsOutput('Name: alpha\nName: beta\nName: alpha\n');
  assert(Array.isArray(parsedLs) && parsedLs.length === 2, 'parseLsOutput() should deduplicate names');

  const prevDvmCliPath = process.env.DVM_CLI_PATH;
  process.env.DVM_CLI_PATH = '/tmp/override-dvm-cli.js';
  assert(hostDvm.resolveDvmCliPath() === '/tmp/override-dvm-cli.js', 'resolveDvmCliPath() env override failed');
  if (typeof prevDvmCliPath === 'string') process.env.DVM_CLI_PATH = prevDvmCliPath;
  else delete process.env.DVM_CLI_PATH;

  console.log('Drone smoke checks passed');
}

main();
