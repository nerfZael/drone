#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { extname, join, relative } = require('node:path');
const { gzipSync } = require('node:zlib');

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

function getChunkName(filePath) {
  const fileName = filePath.split('/').pop() ?? filePath;
  const extension = extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  return baseName.replace(/-[a-zA-Z0-9_-]{8}$/, '');
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
    const filePath = relative(appRoot, path);
    assets.push({
      chunk: getChunkName(filePath),
      path: filePath,
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
    .sort((a, b) => b.rawBytes - a.rawBytes || a.path.localeCompare(b.path))
    .map((asset, index) => ({
      mark: index < largestCount ? '*' : '',
      type: asset.type,
      chunk: asset.chunk,
      raw: formatBytes(asset.rawBytes),
      gzip: formatBytes(asset.gzipBytes),
      path: asset.path,
    }));

  const columns = {
    mark: Math.max(1, ...rows.map((row) => row.mark.length)),
    type: Math.max(4, ...rows.map((row) => row.type.length)),
    chunk: Math.max(5, ...rows.map((row) => row.chunk.length)),
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
      pad('Chunk', columns.chunk),
      pad('Raw', columns.raw, 'right'),
      pad('Gzip', columns.gzip, 'right'),
      'File',
    ].join('  '),
  );
  console.log(
    [
      '-'.repeat(columns.mark),
      '-'.repeat(columns.type),
      '-'.repeat(columns.chunk),
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
        pad(row.chunk, columns.chunk),
        pad(row.raw, columns.raw, 'right'),
        pad(row.gzip, columns.gzip, 'right'),
        row.path,
      ].join('  '),
    );
  }
}

function printTotals(assets) {
  const totalsByType = new Map();
  for (const asset of assets) {
    const current = totalsByType.get(asset.type) ?? { count: 0, rawBytes: 0, gzipBytes: 0 };
    current.count += 1;
    current.rawBytes += asset.rawBytes;
    current.gzipBytes += asset.gzipBytes;
    totalsByType.set(asset.type, current);
  }

  console.log('');
  for (const type of ['JS', 'CSS']) {
    const total = totalsByType.get(type) ?? { count: 0, rawBytes: 0, gzipBytes: 0 };
    console.log(
      `Total ${type}: ${formatBytes(total.rawBytes)} raw, ${formatBytes(
        total.gzipBytes,
      )} gzip across ${total.count} file${total.count === 1 ? '' : 's'}`,
    );
  }

  const total = assets.reduce(
    (sum, asset) => ({
      rawBytes: sum.rawBytes + asset.rawBytes,
      gzipBytes: sum.gzipBytes + asset.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );

  console.log(`Total JS/CSS: ${formatBytes(total.rawBytes)} raw, ${formatBytes(total.gzipBytes)} gzip`);
}

runBuild();

const assets = collectAssets(distDir);

if (assets.length === 0) {
  console.error(`No JS or CSS assets found in ${distDir}`);
  process.exit(1);
}

printTable(assets);
printTotals(assets);
