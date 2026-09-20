import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  forgetTerminalSessionNaming,
  normalizeTerminalProgramTitle,
  setTerminalProcess,
  setTerminalProgramTitle,
  terminalSessionLabel,
  useTerminalSessionNaming,
} from '../src/droneHub/terminal/terminal-titles';

describe('terminal session naming', () => {
  test('turns whatever a program sends into a one-line label', () => {
    expect(normalizeTerminalProgramTitle('  root@box:  /work/repo \n')).toBe('root@box: /work/repo');
    expect(normalizeTerminalProgramTitle('a\u0007b\u001bc')).toBe('a b c');
    expect(normalizeTerminalProgramTitle('x'.repeat(500))).toHaveLength(120);
    expect(normalizeTerminalProgramTitle('   ')).toBe('');
  });

  test('names a shell by its name and a program by its own title', () => {
    expect(terminalSessionLabel(undefined, 'Terminal 2')).toBe('Terminal 2');
    // An older daemon reports no process, so the program title is all there is.
    expect(terminalSessionLabel({ programTitle: 'vim notes.md' }, 'Terminal')).toBe('vim notes.md');
    expect(terminalSessionLabel({ process: 'bash', programTitle: 'root@box: /work' }, 'Terminal')).toBe('bash');
    expect(terminalSessionLabel({ process: 'node' }, 'Terminal')).toBe('node');
    expect(terminalSessionLabel({ process: 'node', programTitle: '✳ Co-editor feature' }, 'Terminal')).toBe(
      '✳ Co-editor feature',
    );
  });
});

describe('terminal session naming store', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  // Read the store the way the dock does: through its hook, then the label rule.
  const label = (key: string) => {
    let result = '';
    function Probe() {
      result = terminalSessionLabel(useTerminalSessionNaming().get(key), 'Terminal');
      return null;
    }
    renderToStaticMarkup(React.createElement(Probe));
    return result;
  };

  test('keeps a title the new program just set, and drops one left by the program before', () => {
    const key = 'store-test';
    setTerminalProcess(key, '-bash', 0);
    expect(label(key)).toBe('bash');
    // The prompt's title is old by the time another program takes over.
    setTerminalProgramTitle(key, 'root@box: /work', 1_000);
    setTerminalProcess(key, 'node', 10_000);
    expect(label(key)).toBe('node');
    // The program's own title reaches the terminal before the daemon notices the program.
    setTerminalProcess(key, 'bash', 20_000);
    setTerminalProgramTitle(key, '✳ Co-editor feature', 30_000);
    setTerminalProcess(key, 'claude', 30_800);
    expect(label(key)).toBe('✳ Co-editor feature');
    forgetTerminalSessionNaming(key);
    expect(label(key)).toBe('Terminal');
  });

  test('is fed by the terminal and dropped when a session is closed', () => {
    const cache = source('../src/droneHub/terminal/terminal-view-cache.ts');
    const dock = source('../src/droneHub/terminal/DroneTerminalDock.tsx');
    expect(cache).toContain('terminal.onTitleChange((title) => setTerminalProgramTitle(key, title));');
    expect(cache).toContain('process: (command) => setTerminalProcess(key, command),');
    expect(dock.match(/forgetTerminalSessionNaming\(closingKey\)/g)).toHaveLength(2);
  });
});
