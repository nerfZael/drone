import { describe, expect, test } from 'bun:test';
import {
  parseHubRunnerLaunchOptions,
  parseHubRunnerProcessesFromPsOutput,
  parseHubUiServerProcessesFromPsOutput,
  selectHubRunnerPidsToStop,
  selectHubRunnerToRecover,
} from '../src/hub/orphan-hub-runners';

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

  test('recovers one unambiguous runner and parses its connection settings', () => {
    const process = {
      pid: 2920616,
      uiPort: 5174,
      args: 'node cli.js hub run --port 5174 --api-port=8787 --host 127.0.0.1 --container-mcp-host 172.17.0.1 --container-mcp-port 8788',
    };

    expect(selectHubRunnerToRecover([process], 0)).toEqual(process);
    expect(parseHubRunnerLaunchOptions(process.args)).toEqual({
      uiPort: 5174,
      apiPort: 8787,
      apiHost: '127.0.0.1',
      containerMcpHost: '172.17.0.1',
      containerMcpPort: 8788,
      containerMcpUrl: null,
    });
  });

  test('does not guess when multiple runners are available for an automatic port', () => {
    expect(
      selectHubRunnerToRecover(
        [
          { pid: 1, uiPort: 5174, args: 'first' },
          { pid: 2, uiPort: 5175, args: 'second' },
        ],
        0,
      ),
    ).toBeNull();
  });

  test('parses hub-owned vite ui server processes for the current repo', () => {
    const repoRoot = '/home/zael/dev/me/drone';
    const parsed = parseHubUiServerProcessesFromPsOutput(
      [
        `2920632 node ${repoRoot}/node_modules/.bin/vite --port 5174 --strictPort`,
        `2920633 node ${repoRoot}/node_modules/vite/bin/vite.js --port 5176 --strictPort`,
        '12345 node /some/other/drone/node_modules/.bin/vite --port 5174 --strictPort',
        `67890 node ${repoRoot}/node_modules/.bin/vite --port 5174`,
      ].join('\n'),
      { repoRoot }
    );

    expect(parsed).toEqual([
      {
        pid: 2920632,
        uiPort: 5174,
        args: `node ${repoRoot}/node_modules/.bin/vite --port 5174 --strictPort`,
      },
      {
        pid: 2920633,
        uiPort: 5176,
        args: `node ${repoRoot}/node_modules/vite/bin/vite.js --port 5176 --strictPort`,
      },
    ]);
  });
});
