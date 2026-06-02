import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '../..');
const requireFromApp = createRequire(path.join(appDir, 'package.json'));
const vendorDir = path.join(appDir, '.desktop-vendor');
const vendorNodeModules = path.join(vendorDir, 'node_modules');
const appManifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const copied = new Set();

function packageRoot(packageName, fromDir = appDir) {
  const packageJson = requireFromApp.resolve(`${packageName}/package.json`, { paths: [fromDir, repoRoot] });
  return path.dirname(packageJson);
}

function copyRuntimePackage(packageName, fromDir = appDir) {
  const source = packageRoot(packageName, fromDir);
  const manifestPath = path.join(source, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const key = `${manifest.name}@${manifest.version || source}`;
  if (copied.has(key)) return;
  copied.add(key);

  const target = path.join(vendorNodeModules, ...manifest.name.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (entry) => !entry.includes(`${path.sep}.git${path.sep}`) && !entry.endsWith(`${path.sep}.git`),
  });

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  for (const dependencyName of Object.keys(dependencies)) {
    copyRuntimePackage(dependencyName, source);
  }
}

function runPackager() {
  const modelPath = path.resolve(repoRoot, 'apps/voice-stream/android/app/src/main/assets/model-en-us');
  const electronPackagerBin = path.join(packageRoot('@electron/packager'), 'bin', 'electron-packager.js');
  const args = [
    '.',
    'Drone',
    '--out',
    'release/desktop',
    '--overwrite',
    `--extra-resource=${modelPath}`,
    `--extra-resource=${vendorNodeModules}`,
    '--icon=assets/app-icon.png',
    '--protocol=voicestream',
    '--protocol-name=Drone',
    "--ignore=^/(android|docs|gradle|release|server|web|dist|\\.desktop-vendor)(/|$)",
    "--ignore=^/(build.gradle.kts|settings.gradle.kts|gradle.properties|gradlew|gradlew.bat)$",
  ];
  const result = spawnSync('node', [electronPackagerBin, ...args], {
    cwd: appDir,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function latestPackagedDir() {
  const releaseRoot = path.join(appDir, 'release', 'desktop');
  const packagedDir = fs
    .readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('Drone-'))
    .map((entry) => path.join(releaseRoot, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!packagedDir) {
    throw new Error(`No packaged desktop app was found in ${releaseRoot}`);
  }
  return packagedDir;
}

function writeLinuxDesktopInstaller() {
  if (process.platform !== 'linux') return;
  const packagedDir = latestPackagedDir();
  const installerPath = path.join(packagedDir, 'install-linux-desktop-entry.sh');
  const script = [
    '#!/usr/bin/env sh',
    'set -eu',
    'APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'DATA_HOME=${XDG_DATA_HOME:-"$HOME/.local/share"}',
    'APPLICATIONS_DIR="$DATA_HOME/applications"',
    'ICON_DIR_256="$DATA_HOME/icons/hicolor/256x256/apps"',
    'ICON_DIR_512="$DATA_HOME/icons/hicolor/512x512/apps"',
    'ICON_DIR_1024="$DATA_HOME/icons/hicolor/1024x1024/apps"',
    'DESKTOP_FILE="$APPLICATIONS_DIR/drone.desktop"',
    'mkdir -p "$APPLICATIONS_DIR" "$ICON_DIR_256" "$ICON_DIR_512" "$ICON_DIR_1024"',
    'cp "$APP_DIR/resources/app/assets/app-icon-256.png" "$ICON_DIR_256/drone.png"',
    'cp "$APP_DIR/resources/app/assets/app-icon-512.png" "$ICON_DIR_512/drone.png"',
    'cp "$APP_DIR/resources/app/assets/app-icon.png" "$ICON_DIR_1024/drone.png"',
    'rm -f "$APPLICATIONS_DIR/VoiceStream.desktop"',
    'rm -f "$APPLICATIONS_DIR/voicestream.desktop"',
    'cat > "$DESKTOP_FILE" <<EOF',
    '[Desktop Entry]',
    'Name=Drone',
    'Comment=Drone desktop voice client',
    'Exec="$APP_DIR/Drone" %U',
    'Icon=$ICON_DIR_512/drone.png',
    'Terminal=false',
    'Type=Application',
    'Categories=Utility;',
    'StartupWMClass=Drone',
    'MimeType=x-scheme-handler/voicestream;',
    'EOF',
    'chmod +x "$DESKTOP_FILE"',
    'command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true',
    'command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true',
    'echo "Installed Drone launcher at $DESKTOP_FILE"',
    '',
  ].join('\n');
  fs.writeFileSync(installerPath, script);
  fs.chmodSync(installerPath, 0o755);
}

function voiceStreamDataDir() {
  const configured = process.env.VOICE_STREAM_NEXT_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(appDir, 'server', 'data');
}

function jsonString(value) {
  return JSON.stringify(String(value ?? ''));
}

function publishDesktopDownload() {
  const packagedDir = latestPackagedDir();

  const outputDir = path.join(voiceStreamDataDir(), 'desktop');
  const variant = `${process.platform}-${process.arch}`;
  const variantFileName = `voice-stream-next-desktop-${variant}.tar.gz`;
  const latestFileName = 'voice-stream-next-desktop-latest.tar.gz';
  const variantFile = path.join(outputDir, variantFileName);
  const latestFile = path.join(outputDir, latestFileName);

  fs.mkdirSync(outputDir, { recursive: true });
  const result = spawnSync('tar', ['-czf', variantFile, '-C', path.dirname(packagedDir), path.basename(packagedDir)], {
    cwd: appDir,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to archive desktop app ${packagedDir}`);
  }
  fs.copyFileSync(variantFile, latestFile);

  const metadata = `{
  "app": "voice-stream-next",
  "platform": "desktop",
  "variant": ${jsonString(variant)},
  "versionName": ${jsonString(appManifest.version)},
  "fileName": ${jsonString(latestFileName)},
  "variantFileName": ${jsonString(variantFileName)},
  "size": ${fs.statSync(latestFile).size},
  "builtAt": ${jsonString(new Date().toISOString())}
}
`;
  fs.writeFileSync(path.join(outputDir, 'latest.json'), metadata);
  console.log(`Published Drone desktop archive to ${latestFile}`);
}

fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorNodeModules, { recursive: true });

try {
  copyRuntimePackage('vosk');
  runPackager();
  writeLinuxDesktopInstaller();
  publishDesktopDownload();
} finally {
  fs.rmSync(vendorDir, { recursive: true, force: true });
}
