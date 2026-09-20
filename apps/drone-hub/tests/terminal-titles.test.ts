import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  forgetTerminalProgramTitle,
  normalizeTerminalProgramTitle,
  setTerminalProgramTitle,
} from '../src/droneHub/terminal/terminal-titles';

describe('terminal program titles', () => {
  test('turns whatever a program sends into a one-line label', () => {
    expect(normalizeTerminalProgramTitle('  root@box:  /work/repo \n')).toBe('root@box: /work/repo');
    expect(normalizeTerminalProgramTitle('a\u0007b\u001bc')).toBe('a b c');
    expect(normalizeTerminalProgramTitle('x'.repeat(500))).toHaveLength(120);
    expect(normalizeTerminalProgramTitle('   ')).toBe('');
  });

  test('accepts, clears and forgets titles without throwing', () => {
    setTerminalProgramTitle('k', 'vim notes.md');
    setTerminalProgramTitle('k', '');
    forgetTerminalProgramTitle('k');
    forgetTerminalProgramTitle('never-set');
  });

  test('is fed by the terminal and dropped when a session is closed', () => {
    const cache = readFileSync(new URL('../src/droneHub/terminal/terminal-view-cache.ts', import.meta.url), 'utf8');
    const dock = readFileSync(new URL('../src/droneHub/terminal/DroneTerminalDock.tsx', import.meta.url), 'utf8');
    expect(cache).toContain('terminal.onTitleChange((title) => setTerminalProgramTitle(key, title));');
    expect(dock.match(/forgetTerminalProgramTitle\(closingKey\)/g)).toHaveLength(2);
  });
});
