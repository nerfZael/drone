#!/usr/bin/env node
const path = require('node:path');
const cp = require('node:child_process');

function fail(message) {
  throw new Error(message);
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

function runNoThrow(cmd, args, opts = {}) {
  cp.spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function ensureDockerAvailable() {
  const res = cp.spawnSync('docker', ['info'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status === 0) return true;

  const stdout = String(res.stdout || '').trim();
  const stderr = String(res.stderr || '').trim();
  const detail = [
    res.error ? `error: ${res.error.message}` : '',
    stdout ? `stdout: ${stdout}` : '',
    stderr ? `stderr: ${stderr}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  if (process.env.CI) {
    fail(`Docker smoke requires a working Docker daemon in CI. ${detail}`);
  }

  console.log(`Skipping dvm docker smoke: Docker is not usable in this environment. ${detail}`);
  return false;
}

function main() {
  if (process.platform !== 'linux') {
    console.log(`Skipping dvm docker smoke on ${process.platform}`);
    return;
  }

  const appRoot = path.resolve(__dirname, '..');
  const dvmCli = path.join(appRoot, 'dist', 'cli.js');
  const nodeCmd = process.execPath;

  if (!ensureDockerAvailable()) return;
  run(nodeCmd, [dvmCli, '--help'], { cwd: appRoot });

  const name = `dvm-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    run(nodeCmd, [dvmCli, 'create', name, '--image', 'alpine:3.19', '--no-persist'], { cwd: appRoot });
    const out = run(nodeCmd, [dvmCli, 'exec', name, '--', 'sh', '-lc', 'echo DVM_SMOKE_OK'], { cwd: appRoot });
    if (!out.stdout.includes('DVM_SMOKE_OK')) {
      fail(`did not find DVM_SMOKE_OK marker in dvm exec output:\n${out.stdout}`);
    }
    run(nodeCmd, [dvmCli, 'rm', name, '--keep-volume'], { cwd: appRoot });
  } finally {
    runNoThrow(nodeCmd, [dvmCli, 'rm', name, '--keep-volume'], { cwd: appRoot });
    runNoThrow('docker', ['rm', '-f', name], { cwd: appRoot });
    runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${name}-data`], { cwd: appRoot });
  }

  console.log('DVM docker smoke checks passed');
}

main();
