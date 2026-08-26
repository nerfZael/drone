import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const {
  detachedHubStartArgs,
  formatDetachedHubStartOutput,
  parseDetachedHubStartOutput,
}: {
  detachedHubStartArgs(
    cliPath: string,
    env?: Record<string, string>,
    platform?: string,
  ): string[];
  formatDetachedHubStartOutput(payload: any): string;
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
        DRONE_HUB_STATIC_UI_DIR: '/app/hub-ui',
      },
      'linux',
    );

    expect(args.slice(0, 3)).toEqual(['/app/cli.js', 'hub', 'start']);
    expect(args).toContain('--json');
    expect(args).toContain('--ui-mode');
    expect(args).toContain('static');
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

  test('formats the internal launcher handshake as concise terminal text', () => {
    expect(formatDetachedHubStartOutput({ ok: true, pid: 42 })).toBe(
      'Drone Hub started (PID 42).',
    );
    expect(
      formatDetachedHubStartOutput({
        ok: true,
        alreadyRunning: true,
        state: { pid: 353573 },
      }),
    ).toBe('Drone Hub is already running (PID 353573).');
  });

  test('rejects launcher output without a usable UI address', () => {
    expect(() => parseDetachedHubStartOutput(JSON.stringify({ ok: true, state: {} }))).toThrow(
      'no usable UI address',
    );
  });

  test('navigates as soon as complete launcher output arrives', () => {
    const mainSource = readFileSync(
      new URL('../desktop/hub-electron-main.cjs', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain('stdout += text;\n    loadHubUiFromOutput();');
    expect(mainSource).not.toContain('process.stdout.write(text);');
    expect(mainSource).toContain('formatDetachedHubStartOutput(payload)');
    expect(mainSource).toContain('if (!loadHubUiFromOutput())');
  });

  test('uses the shared chat loading visual and product-facing startup copy', () => {
    const mainSource = readFileSync(
      new URL('../desktop/hub-electron-main.cjs', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain('M22 3a19 19 0 0 1 16.45 9.5');
    expect(mainSource).toContain('Loading your workspace…');
    expect(mainSource).not.toContain('Preparing the local server');
  });

  test('keeps native synchronized window resizing on Linux', () => {
    const mainSource = readFileSync(
      new URL('../desktop/hub-electron-main.cjs', import.meta.url),
      'utf8',
    );
    const preloadSource = readFileSync(
      new URL('../desktop/hub-electron-preload.cjs', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain("process.platform === 'linux'");
    expect(mainSource).toContain("titleBarStyle: 'hidden'");
    expect(mainSource).toContain("color: '#171d27'");
    expect(preloadSource).toContain("if (process.platform === 'linux') return;");
  });

  test('uses Hub chrome colors for a reserved draggable title bar on other platforms', () => {
    const preloadSource = readFileSync(
      new URL('../desktop/hub-electron-preload.cjs', import.meta.url),
      'utf8',
    );

    expect(preloadSource).toContain("background: var(--app-header-bg, #171d27)");
    expect(preloadSource).toContain(
      'box-shadow: 0 1px 0 var(--app-header-border, #3b4557)',
    );
    expect(preloadSource).not.toContain(
      'border-bottom: 1px solid var(--app-header-border, #3b4557)',
    );
    expect(preloadSource).toContain('-webkit-app-region: drag');
    expect(preloadSource).toContain('height: calc(100vh - ${DESKTOP_TITLE_BAR_HEIGHT}px)');
    expect(preloadSource).toContain("[data-drone-app-shell='true']");
    expect(preloadSource).toContain('top: ${DESKTOP_TITLE_BAR_HEIGHT}px !important');
  });

  test('uses the packaged Drone Hub icon for the Electron window', () => {
    const mainSource = readFileSync(
      new URL('../desktop/hub-electron-main.cjs', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain("path.join(__dirname, 'drone-hub-icon.png')");
    expect(mainSource).toContain('...(appIconPath ? { icon: appIconPath } : {})');
  });
});
