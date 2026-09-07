import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const { createDesktopDiagnostics, normalizeRendererDiagnostic, observeWindowDiagnostics } = require('../desktop/hub-electron-diagnostics.cjs');

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'desktop-diagnostics-'));
  dirs.push(dir);
  const logPath = path.join(dir, 'desktop.jsonl');
  const logger = createDesktopDiagnostics({ logPath, ...options });
  const entries = () => readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { dir, logPath, logger, entries };
}

test('persists the file action before an error, with matching build and session context', () => {
  const { logger, entries, logPath, dir } = fixture();
  logger.setUiBuild({ buildId: 'test-build' });
  logger.renderer({ type: 'breadcrumb', action: 'chat-file-link', path: '/repo/file.ts', line: 42 });
  const hubLog = path.join(dir, 'hub.log');
  logger.setHubLogPath(hubLog);
  logger.renderer({ type: 'error', kind: 'react-render-error', id: 'ui-123', stack: 'Error\n at file.ts:42', componentStack: '\n at FilePanel' });
  const [action, failure] = entries();
  expect(action.kind).toBe('renderer-action');
  expect(failure.breadcrumbs[0].path).toBe('/repo/file.ts');
  expect(failure.details.componentStack).toContain('FilePanel');
  expect(failure.uiBuild.buildId).toBe('test-build');
  expect(failure.sessionId).toBe(action.sessionId);
  expect(readFileSync(hubLog, 'utf8')).toContain('ui-123');
  expect(statSync(logPath).mode & 0o777).toBe(0o600);
});

test('drops arbitrary data, strips URL credentials, and bounds stack size', () => {
  const record = normalizeRendererDiagnostic({ type: 'error', message: 'Bearer secret-token',
    url: 'http://user:password@localhost:1234/app?token=secret#private', stack: 'x'.repeat(50000),
    body: 'private chat', apiToken: 'secret', contents: 'file text' });
  expect(record.url).toBe('http://localhost:1234/app');
  expect(record.message).toBe('Bearer [redacted]');
  expect(record.stack.length).toBe(12000);
  expect(record.body).toBeUndefined();
  expect(record.apiToken).toBeUndefined();
  expect(record.contents).toBeUndefined();
  expect(normalizeRendererDiagnostic({ type: 'unknown' })).toBeNull();
});

test('rotates a bounded log and keeps writing when the Hub log is unavailable', () => {
  const { logger, logPath, entries } = fixture({ maxBytes: 1 });
  logger.setHubLogPath('/missing-parent/diagnostic-test/hub.log');
  for (let i = 0; i < 5; i++) expect(logger.write('test', { i })).toBe(true);
  expect(entries()[0].details.i).toBe(4);
  expect(JSON.parse(readFileSync(`${logPath}.1`, 'utf8')).details.i).toBe(3);
  expect(JSON.parse(readFileSync(`${logPath}.2`, 'utf8')).details.i).toBe(2);
});

test('action storms cannot exhaust the error budget and logs recover after rate limiting', () => {
  let now = 1_000;
  const { logger, entries } = fixture({ now: () => now });
  for (let i = 0; i < 150; i++) logger.renderer({ type: 'breadcrumb', action: `open-${i}` });
  expect(logger.renderer({ type: 'error', message: 'first failure' })).toBe(true);
  expect(entries().at(-1).breadcrumbs).toHaveLength(30);
  for (let i = 0; i < 100; i++) logger.renderer({ type: 'error', message: 'loop' });
  expect(entries().filter((e: any) => e.kind === 'renderer-error')).toHaveLength(60);
  now += 60_001;
  expect(logger.renderer({ type: 'error', message: 'later failure' })).toBe(true);
  expect(entries().at(-2).kind).toBe('diagnostics-suppressed');
});

test('disk failures never throw into the application', () => {
  const { dir } = fixture();
  const file = path.join(dir, 'not-a-directory');
  writeFileSync(file, '');
  const logger = createDesktopDiagnostics({ logPath: path.join(file, 'log') });
  expect(logger.write('fatal', {})).toBe(false);
});

test('records native crashes, preload failures, console errors, and window hangs', () => {
  const { logger, entries } = fixture();
  const contents = Object.assign(new EventEmitter(), { getURL: () => 'http://localhost/app?token=secret' });
  const window = Object.assign(new EventEmitter(), { webContents: contents });
  observeWindowDiagnostics(window, logger);
  contents.emit('console-message', { level: 'error', message: 'console failure', sourceId: 'http://localhost/app.js', lineNumber: 10 });
  contents.emit('preload-error', {}, '/app/preload.cjs', new Error('preload failed'));
  contents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
  contents.emit('did-fail-load', {}, -3, 'aborted', 'http://localhost', true);
  window.emit('unresponsive');
  expect(entries().map((e: any) => e.kind)).toEqual(['renderer-error', 'preload-error', 'render-process-gone', 'window-unresponsive']);
  expect(entries()[2].details.reason).toBe('oom');
  expect(entries()[2].details.url).toBe('http://localhost/app');
});
