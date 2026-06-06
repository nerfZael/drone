#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const appRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(appRoot, 'dist', 'assets');
const trackedExtensions = new Set(['.css', '.js']);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function getChunkName(fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  return baseName.replace(/-[a-zA-Z0-9_-]{8,}$/, '');
}

function collectAssets(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`missing build artifact directory: ${dir}`);
  }

  return fs
    .readdirSync(dir)
    .filter((fileName) => trackedExtensions.has(path.extname(fileName)))
    .map((fileName) => {
      const filePath = path.join(dir, fileName);
      const contents = fs.readFileSync(filePath);

      return {
        fileName,
        chunkName: getChunkName(fileName),
        extension: path.extname(fileName).slice(1),
        bytes: contents.byteLength,
        gzipBytes: zlib.gzipSync(contents).byteLength,
      };
    })
    .sort((a, b) => b.bytes - a.bytes || a.fileName.localeCompare(b.fileName));
}

function printTable(assets) {
  const rows = assets.map((asset) => [
    asset.extension.toUpperCase(),
    asset.chunkName,
    formatBytes(asset.bytes),
    formatBytes(asset.gzipBytes),
    `assets/${asset.fileName}`,
  ]);
  const headers = ['Type', 'Chunk', 'Raw', 'Gzip', 'File'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const formatRow = (row) => row.map((value, index) => value.padEnd(widths[index])).join('  ');

  console.log(formatRow(headers));
  console.log(formatRow(widths.map((width) => '-'.repeat(width))));
  rows.forEach((row) => console.log(formatRow(row)));
}

function printTotals(assets) {
  const totals = new Map();
  for (const asset of assets) {
    const current = totals.get(asset.extension) ?? { bytes: 0, gzipBytes: 0, count: 0 };
    current.bytes += asset.bytes;
    current.gzipBytes += asset.gzipBytes;
    current.count += 1;
    totals.set(asset.extension, current);
  }

  console.log('');
  for (const extension of ['js', 'css']) {
    const total = totals.get(extension) ?? { bytes: 0, gzipBytes: 0, count: 0 };
    console.log(
      `Total ${extension.toUpperCase()}: ${formatBytes(total.bytes)} raw, ${formatBytes(
        total.gzipBytes,
      )} gzip across ${total.count} file${total.count === 1 ? '' : 's'}`,
    );
  }

  const allBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const allGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  console.log(`Total JS/CSS: ${formatBytes(allBytes)} raw, ${formatBytes(allGzipBytes)} gzip`);
}

function main() {
  const assets = collectAssets(assetsDir);
  if (assets.length === 0) {
    throw new Error(`no JS or CSS assets found in: ${assetsDir}`);
  }

  console.log('Drone Hub build size');
  console.log(`Artifacts: ${path.relative(process.cwd(), assetsDir)}`);
  console.log('');
  printTable(assets);
  printTotals(assets);
}

main();
