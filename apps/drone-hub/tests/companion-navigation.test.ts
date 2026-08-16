import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Companion navigation', () => {
  test('switches repositories before opening a drone chat', () => {
    const source = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('openDroneChat: (args) => {');
    const end = source.indexOf('highlightDrones: (args) => {', start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain('setActiveRepoPath(repoPath);');
    expect(handler.indexOf('setActiveRepoPath(repoPath);')).toBeLessThan(
      handler.indexOf('selectDroneChat(droneId, chatName);'),
    );
    expect(handler).toContain(
      'return { ok: true, droneId, droneName, repoPath: repoPath || null, chatName };',
    );
  });
});
