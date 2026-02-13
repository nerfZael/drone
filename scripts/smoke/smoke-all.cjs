#!/usr/bin/env node
const path = require('node:path');
const cp = require('node:child_process');

function run(cmd, args, opts = {}) {
  const res = cp.spawnSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(
      `Command failed: ${cmd} ${args.join(' ')} (exit ${String(res.status)})`
    );
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const scripts = [
    path.join(repoRoot, 'apps', 'dvm', 'scripts', 'smoke-cli.cjs'),
    path.join(repoRoot, 'apps', 'drone', 'scripts', 'smoke-cli.cjs'),
    path.join(repoRoot, 'apps', 'drone-hub', 'scripts', 'smoke-cli.cjs'),
  ];

  for (const scriptPath of scripts) {
    process.stdout.write(`Running smoke: ${path.relative(repoRoot, scriptPath)}\n`);
    run(process.execPath, [scriptPath], { cwd: repoRoot });
  }

  console.log('All app smoke checks passed');
}

main();
