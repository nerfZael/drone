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
const buildMode = parseBuildMode(process.argv.slice(2));
loadEnvFile(path.join(repoRoot, `.env.${buildMode}`));
const copied = new Set();

function parseBuildMode(args) {
  for (const arg of args) {
    if (arg === '--debug' || arg === '--mode=debug') return 'debug';
    if (arg === '--release' || arg === '--mode=release') return 'release';
  }
  return 'release';
}

function packagedOutDir() {
  return buildMode === 'debug' ? 'release/desktop-debug' : 'release/desktop';
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] == null) process.env[parsed.key] = normalizeEnvValue(parsed.key, parsed.value);
  }
}

function normalizeEnvValue(key, value) {
  if (key === 'VOICE_STREAM_NEXT_DATA_DIR' && value && !path.isAbsolute(value)) {
    return path.resolve(repoRoot, value);
  }
  return value;
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

function packageRoot(packageName, fromDir = appDir) {
  const paths = [fromDir, repoRoot];
  try {
    const packageJson = requireFromApp.resolve(`${packageName}/package.json`, { paths });
    const packageDir = packageRootFrom(packageJson, packageName);
    if (packageDir) return packageDir;
  } catch {
    // Some packages do not export package.json. Fall back to the resolved entrypoint.
  }
  const entrypoint = requireFromApp.resolve(packageName, { paths });
  const packageDir = packageRootFrom(entrypoint, packageName);
  if (packageDir) return packageDir;
  throw new Error(`Could not find package root for ${packageName}`);
}

function packageRootFrom(resolvedPath, packageName) {
  let current = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);
  while (current && current !== path.dirname(current)) {
    const manifestPath = path.join(current, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName) return current;
    }
    current = path.dirname(current);
  }
  return '';
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
  const modelPath = path.resolve(repoRoot, 'apps/voice-stream-next/android/app/src/main/assets/model-en-us');
  const desktopBuildConfigPath = writeDesktopBuildConfig();
  const electronPackagerBin = path.join(packageRoot('@electron/packager'), 'bin', 'electron-packager.js');
  const args = [
    '.',
    'Drone',
    '--out',
    packagedOutDir(),
    '--overwrite',
    `--extra-resource=${modelPath}`,
    `--extra-resource=${vendorNodeModules}`,
    `--extra-resource=${desktopBuildConfigPath}`,
    '--icon=assets/app-icon.png',
    '--protocol=voicestream',
    '--protocol-name=Drone',
    "--ignore=^/(android|docs|gradle|release|server|web|dist|\\.desktop-vendor)(/|$)",
    "--ignore=^/(build.gradle.kts|settings.gradle.kts|gradle.properties|gradlew|gradlew.bat)$",
  ];
  const result = spawnSync('node', [electronPackagerBin, ...args], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: buildMode === 'release' ? 'production' : 'development',
      VOICE_STREAM_NEXT_DESKTOP_BUILD_MODE: buildMode,
    },
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

function ensureDroneMcpServerBuild() {
  const mcpServerPath = path.join(repoRoot, 'apps', 'drone', 'dist', 'hub', 'mcp-server.js');
  if (fs.existsSync(mcpServerPath)) return;
  const result = spawnSync('bun', ['run', '--filter', 'drone', 'build'], {
    cwd: repoRoot,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
  if (!fs.existsSync(mcpServerPath)) {
    throw new Error(`Drone Hub MCP server build did not produce ${mcpServerPath}`);
  }
}

function writeDesktopBuildConfig() {
  const outputDir = path.join(appDir, 'build');
  const outputFile = path.join(outputDir, 'voice-stream-next-desktop-build-config.json');
  const serverUrl =
    process.env.VOICE_STREAM_NEXT_DESKTOP_SERVER_URL?.trim() ||
    process.env.VOICE_STREAM_NEXT_SERVER_URL?.trim() ||
    (buildMode === 'release' ? 'https://voice-stream-next-production.up.railway.app' : 'http://127.0.0.1:3299');
  const webUrl = process.env.VOICE_STREAM_NEXT_WEB_URL?.trim() || serverUrl;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify({
    app: 'voice-stream-next',
    platform: 'desktop',
    buildMode,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    webUrl: webUrl.replace(/\/+$/, ''),
    builtAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return outputFile;
}

function latestPackagedDir() {
  const releaseRoot = path.join(appDir, packagedOutDir());
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
  const platformVariant = `${process.platform}-${process.arch}`;
  const variant = buildMode === 'debug' ? `debug-${platformVariant}` : platformVariant;
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
  "buildMode": ${jsonString(buildMode)},
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
  ensureDroneMcpServerBuild();
  copyRuntimePackage('@modelcontextprotocol/sdk');
  copyRuntimePackage('drone');
  copyRuntimePackage('vosk');
  runPackager();
  writeLinuxDesktopInstaller();
  publishDesktopDownload();
} finally {
  fs.rmSync(vendorDir, { recursive: true, force: true });
}
