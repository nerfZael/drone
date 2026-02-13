#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function main() {
  const appRoot = path.resolve(__dirname, '..');
  const distDir = path.join(appRoot, 'dist');
  const indexHtmlPath = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');

  assert(fs.existsSync(indexHtmlPath), `missing build artifact: ${indexHtmlPath}`);
  assert(fs.existsSync(assetsDir), `missing build artifact directory: ${assetsDir}`);

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  assert(/<!doctype html>/i.test(indexHtml), 'dist/index.html should contain a doctype');
  assert(indexHtml.includes('assets/'), 'dist/index.html should reference built assets');

  const assets = fs.readdirSync(assetsDir);
  assert(assets.some((f) => f.endsWith('.js')), 'dist/assets should include a JS bundle');
  assert(assets.some((f) => f.endsWith('.css')), 'dist/assets should include a CSS bundle');

  console.log('Drone Hub smoke checks passed');
}

main();
