import { describe, expect, test } from 'bun:test';
import { formatHubStartOutput, formatHubStopOutput, formatHumanOutput } from '../src/cli-output';

describe('CLI text output', () => {
  test('formats a newly started Hub as concise text', () => {
    expect(
      formatHubStartOutput({
        pid: 58896,
        apiUrl: 'http://127.0.0.1:8787',
        uiUrl: 'http://127.0.0.1:5174',
        containerMcpUrl: 'http://host.docker.internal:8788/mcp',
        logPath: '/tmp/hub.log',
      }),
    ).toBe(
      [
        'Drone Hub started (PID 58896).',
        'API: http://127.0.0.1:8787',
        'UI: http://127.0.0.1:5174',
        'Container MCP: http://host.docker.internal:8788/mcp',
        'Log: /tmp/hub.log',
      ].join('\n'),
    );
  });

  test('formats Hub stop outcomes as sentences', () => {
    expect(formatHubStopOutput({ kind: 'stopped', pid: 3327657 })).toBe(
      'Drone Hub stopped (PID 3327657).',
    );
    expect(formatHubStopOutput({ kind: 'not-running' })).toBe('Drone Hub is not running.');
    expect(formatHubStopOutput({ kind: 'recovered', pids: [12, 13] })).toContain('PIDs 12, 13');
  });

  test('formats structured command results without JSON syntax', () => {
    const text = formatHumanOutput({
      ok: true,
      activeProfile: 'default',
      entries: [{ name: 'alpha', running: true }],
      tags: [],
    });

    expect(text).toBe(
      [
        'Active profile: default',
        'Entries:',
        '  - Name: alpha',
        '    Running: yes',
        'Tags:',
        '  None',
      ].join('\n'),
    );
    expect(text).not.toContain('{');
    expect(text).not.toContain('"');
    expect(formatHumanOutput({ ok: false })).toBe('Result: failed');
  });
});
