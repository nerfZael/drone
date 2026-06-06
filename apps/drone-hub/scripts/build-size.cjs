#!/usr/bin/env node

const { gzipSync } = require('node:zlib');
const { readdirSync, readFileSync } = require('node:fs');
const { extname, join, relative } = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = join(__dirname, '..');
const distDir = join(appRoot, 'dist');
const assetExtensions = new Set(['.js', '.css']);
const largestCount = 8;

function runBuild() {
  console.log('Building Drone Hub production bundle...');

  const result = spawnSync('bun', ['run', 'build'], {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  if (result.error) {
    console.error(`Failed to run production build: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    printBuildOutput(result);
    process.exit(result.status ?? 1);
  }
}

function printBuildOutput(result) {
  if (result.stdout) {
    console.error(result.stdout.trimEnd());
  }

  if (result.stderr) {
    console.error(result.stderr.trimEnd());
  }
}

function collectAssets(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const assets = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      assets.push(...collectAssets(path));
      continue;
    }

    const extension = extname(entry.name);
    if (!assetExtensions.has(extension)) {
      continue;
    }

    const buffer = readFileSync(path);
    assets.push({
      path: relative(appRoot, path),
      type: extension.slice(1).toUpperCase(),
      rawBytes: buffer.length,
      gzipBytes: gzipSync(buffer).length,
    });
  }

  return assets;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function pad(value, width, align = 'left') {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }

  const padding = ' '.repeat(width - text.length);
  return align === 'right' ? `${padding}${text}` : `${text}${padding}`;
}

function printTable(assets) {
  const rows = [...assets]
    .sort((a, b) => b.rawBytes - a.rawBytes)
    .map((asset, index) => ({
      mark: index < largestCount ? '*' : '',
      type: asset.type,
      raw: formatBytes(asset.rawBytes),
      gzip: formatBytes(asset.gzipBytes),
      path: asset.path,
    }));

  const columns = {
    mark: Math.max(1, ...rows.map((row) => row.mark.length)),
    type: Math.max(4, ...rows.map((row) => row.type.length)),
    raw: Math.max(3, ...rows.map((row) => row.raw.length)),
    gzip: Math.max(4, ...rows.map((row) => row.gzip.length)),
  };

  console.log('\nDrone Hub bundle size');
  console.log(`Dist: ${relative(process.cwd(), distDir) || 'dist'}`);
  console.log(
    `Largest chunks by raw size are marked with "*" (top ${Math.min(largestCount, rows.length)}).\n`,
  );
  console.log(
    [
      pad('', columns.mark),
      pad('Type', columns.type),
      pad('Raw', columns.raw, 'right'),
      pad('Gzip', columns.gzip, 'right'),
      'File',
    ].join('  '),
  );
  console.log(
    [
      '-'.repeat(columns.mark),
      '-'.repeat(columns.type),
      '-'.repeat(columns.raw),
      '-'.repeat(columns.gzip),
      '----',
    ].join('  '),
  );

  for (const row of rows) {
    console.log(
      [
        pad(row.mark, columns.mark),
        pad(row.type, columns.type),
        pad(row.raw, columns.raw, 'right'),
        pad(row.gzip, columns.gzip, 'right'),
        row.path,
      ].join('  '),
    );
  }

  const totals = assets.reduce(
    (sum, asset) => ({
      rawBytes: sum.rawBytes + asset.rawBytes,
      gzipBytes: sum.gzipBytes + asset.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );

  console.log(
    `\nTotal JS/CSS: ${formatBytes(totals.rawBytes)} raw, ${formatBytes(totals.gzipBytes)} gzip`,
  );
}

runBuild();

const assets = collectAssets(distDir);

if (assets.length === 0) {
  console.error(`No JS or CSS assets found in ${distDir}`);
  process.exit(1);
}

printTable(assets);
