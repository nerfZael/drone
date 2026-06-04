import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '../..');
const args = process.argv.slice(2);
const mode = optionValue('--mode') || args.find((arg) => arg === 'debug' || arg === 'release') || 'debug';
const target = optionValue('--target') || 'both';

if (!['debug', 'release'].includes(mode)) {
  throw new Error(`Expected --mode debug or --mode release, got ${JSON.stringify(mode)}`);
}
if (!['android', 'desktop', 'both'].includes(target)) {
  throw new Error(`Expected --target android, desktop, or both, got ${JSON.stringify(target)}`);
}

const buildEnv = {
  ...process.env,
  ...readEnvFile(path.join(repoRoot, `.env.${mode}`)),
  VOICE_STREAM_NEXT_BUILD_MODE: mode,
};
normalizeBuildEnv(buildEnv);

run('bun', ['scripts/bump-version.mjs'], buildEnv);

if (target === 'desktop' || target === 'both') {
  run('bun', ['scripts/pack-desktop.mjs', `--${mode}`], buildEnv);
}
if (target === 'android' || target === 'both') {
  run('./gradlew', [mode === 'release' ? ':android:app:assembleRelease' : ':android:app:assembleDebug'], buildEnv);
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || '';
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || '';
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed) env[parsed.key] = parsed.value;
  }
  return env;
}

function normalizeBuildEnv(env) {
  const dataDir = env.VOICE_STREAM_NEXT_DATA_DIR?.trim();
  if (dataDir && !path.isAbsolute(dataDir)) {
    env.VOICE_STREAM_NEXT_DATA_DIR = path.resolve(repoRoot, dataDir);
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
  if (!match) return null;
  return { key: match[1], value: parseEnvValue(match[2] ?? '') };
}

function parseEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '').trim();
}

function run(command, commandArgs, env) {
  const result = spawnSync(command, commandArgs, {
    cwd: appDir,
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
