import { describe, expect, test } from 'bun:test';
import { parseHubRunnerProcessesFromPsOutput, selectHubRunnerPidsToStop } from '../src/hub/orphan-hub-runners';

describe('orphan hub runner recovery helpers', () => {
  test('parses hub runner processes for the current cli path', () => {
    const cliPath = '/home/zael/dev/me/drone/apps/drone/dist/cli.js';
    const parsed = parseHubRunnerProcessesFromPsOutput(
      [
        `2920616 /usr/bin/node ${cliPath} hub run --port 5174 --api-port 0 --host 127.0.0.1`,
        '2920632 node /home/zael/dev/me/drone/node_modules/.bin/vite --port 5174 --strictPort',
        '12345 /usr/bin/node /some/other/drone/dist/cli.js hub run --port 5174 --api-port 0 --host 127.0.0.1',
      ].join('\n'),
      { cliPath }
    );

    expect(parsed).toEqual([
      {
        pid: 2920616,
        uiPort: 5174,
        args: `/usr/bin/node ${cliPath} hub run --port 5174 --api-port 0 --host 127.0.0.1`,
      },
    ]);
  });

  test('matches hub runners launched with a relative cli path', () => {
    const cliPath = '/home/zael/dev/me/drone/apps/drone/dist/cli.js';
    const parsed = parseHubRunnerProcessesFromPsOutput(
      '2915061 node apps/drone/dist/cli.js hub run --port 5176 --api-port 0 --host 127.0.0.1',
      { cliPath }
    );

    expect(parsed).toEqual([
      {
        pid: 2915061,
        uiPort: 5176,
        args: 'node apps/drone/dist/cli.js hub run --port 5176 --api-port 0 --host 127.0.0.1',
      },
    ]);
  });

  test('prefers the requested ui port when multiple orphan hub runners exist', () => {
    const selected = selectHubRunnerPidsToStop(
      [
        { pid: 2920616, uiPort: 5174, args: 'node cli.js hub run --port 5174' },
        { pid: 2915061, uiPort: 5176, args: 'node cli.js hub run --port 5176' },
      ],
      5174
    );

    expect(selected).toEqual([2920616]);
  });

  test('falls back to the only orphan hub runner when port is unknown', () => {
    const selected = selectHubRunnerPidsToStop(
      [{ pid: 2920616, uiPort: null, args: 'node cli.js hub run' }],
      5174
    );

    expect(selected).toEqual([2920616]);
  });
});
