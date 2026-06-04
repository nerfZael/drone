import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(appDir, 'package.json');
const androidBuildPath = path.join(appDir, 'android', 'app', 'build.gradle.kts');
const dryRun = process.argv.includes('--dry-run');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = String(packageJson.version ?? '').trim();
const nextVersion = nextPatchVersion(currentVersion);

let androidBuild = fs.readFileSync(androidBuildPath, 'utf8');
const codeMatch = androidBuild.match(/val androidVersionCode = (\d+)/);
if (!codeMatch) {
  throw new Error(`Could not find androidVersionCode in ${androidBuildPath}`);
}
const currentCode = Number(codeMatch[1]);
if (!Number.isInteger(currentCode) || currentCode <= 0) {
  throw new Error(`Invalid androidVersionCode in ${androidBuildPath}`);
}
const nextCode = currentCode + 1;

androidBuild = androidBuild
  .replace(/val androidVersionCode = \d+/, `val androidVersionCode = ${nextCode}`)
  .replace(/val androidVersionName = "[^"]+"/, `val androidVersionName = "${nextVersion}"`);

packageJson.version = nextVersion;

if (!dryRun) {
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(androidBuildPath, androidBuild);
}

console.log(`Voice Stream Next version ${currentVersion} -> ${nextVersion}; Android versionCode ${currentCode} -> ${nextCode}${dryRun ? ' (dry run)' : ''}`);

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected package version to be major.minor.patch, got ${JSON.stringify(version)}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
