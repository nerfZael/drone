import { describe, expect, test } from 'bun:test';

const {
  detachedHubStartArgs,
  parseDetachedHubStartOutput,
}: {
  detachedHubStartArgs(
    cliPath: string,
    env?: Record<string, string>,
    platform?: string,
  ): string[];
  parseDetachedHubStartOutput(raw: string): { payload: any; uiUrl: string };
} = require('../desktop/hub-electron-launch.cjs');

describe('Drone Hub Electron background launch', () => {
  test('starts the Hub as a detached daemon instead of a window-owned process', () => {
    const args = detachedHubStartArgs(
      '/app/cli.js',
      {
        DRONE_HUB_APP_PORT: '0',
        DRONE_HUB_APP_API_PORT: '8787',
        DRONE_HUB_APP_HOST: '127.0.0.1',
        DRONE_HUB_APP_NO_VOICE_STREAM: '1',
        DRONE_HUB_STATIC_UI_DIR: '/app/hub-ui',
      },
      'linux',
    );

    expect(args.slice(0, 3)).toEqual(['/app/cli.js', 'hub', 'start']);
    expect(args).toContain('--ui-mode');
    expect(args).toContain('static');
    expect(args).toContain('--no-voice-stream');
    expect(args).toContain('/app/hub-ui');
    expect(args).not.toContain('run');
    expect(args).not.toContain('--ready-json');
  });

  test('reads the UI URL returned for a newly started daemon', () => {
    const result = parseDetachedHubStartOutput(`log line\n${JSON.stringify({
      ok: true,
      pid: 42,
      uiUrl: 'http://127.0.0.1:5174',
    })}\n`);

    expect(result.uiUrl).toBe('http://127.0.0.1:5174');
  });

  test('reuses the UI port of an already running daemon', () => {
    const result = parseDetachedHubStartOutput(
      JSON.stringify({ ok: true, alreadyRunning: true, state: { uiPort: 6123 } }),
    );

    expect(result.uiUrl).toBe('http://127.0.0.1:6123');
  });

  test('rejects launcher output without a usable UI address', () => {
    expect(() => parseDetachedHubStartOutput(JSON.stringify({ ok: true, state: {} }))).toThrow(
      'no usable UI address',
    );
  });
});
