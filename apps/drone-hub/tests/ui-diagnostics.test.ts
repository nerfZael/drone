import { afterEach, expect, test } from 'bun:test';
import { recordUiAction, reportUiError } from '../src/ui-diagnostics';

const originalWindow = globalThis.window;
const originalLocation = globalThis.location;
afterEach(() => { globalThis.window = originalWindow; globalThis.location = originalLocation; });
function capture() {
  const reports: Record<string, any>[] = [];
  globalThis.window = { droneHubDesktop: { reportDiagnostic: (record: any) => reports.push(record) } } as any;
  globalThis.location = { origin: 'http://localhost', pathname: '/app', search: '?token=secret' } as any;
  return reports;
}

test('correlates file clicks and error stacks without URL query strings', () => {
  const reports = capture();
  recordUiAction({ action: 'chat-file-link', droneId: 'drone', path: '/repo/file.ts', line: 3 });
  const error = new Error('render failed');
  const id = reportUiError('react-render-error', error, { componentStack: '\n at FilePanel' });
  expect(reports[0].path).toBe('/repo/file.ts');
  expect(reports[1].id).toBe(id);
  expect(reports[1].stack).toContain('render failed');
  expect(reports[1].componentStack).toContain('FilePanel');
  expect(reports[1].sessionId).toBe(reports[0].sessionId);
  expect(reports[1].url).toBe('http://localhost/app');
});

test('deduplicates errors but preserves the later React component stack and reference', () => {
  const reports = capture();
  const error = new Error('failed');
  const id = reportUiError('uncaught-error', error);
  expect(reportUiError('unhandled-rejection', error)).toBe(id);
  expect(reports).toHaveLength(1);
  expect(reportUiError('react-render-error', error, { componentStack: 'FilePanel' })).toBe(id);
  expect(reports).toHaveLength(2);
});

test('a broken bridge or unprintable rejection cannot break recovery', () => {
  capture();
  globalThis.window = { droneHubDesktop: { reportDiagnostic() { throw new Error('IPC unavailable'); } } } as any;
  expect(() => recordUiAction({ action: 'file-open' })).not.toThrow();
  expect(() => reportUiError('error', { toString() { throw new Error('bad string'); } })).not.toThrow();
});
