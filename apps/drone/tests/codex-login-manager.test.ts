import { describe, expect, test } from 'bun:test';

import {
  codexAuthJsonFromOAuthCredentials,
  createCodexLoginManager,
} from '../src/hub/codex-login-manager';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('Codex login manager', () => {
  test('creates a Codex CLI-compatible auth file without exposing credentials in status', async () => {
    expect(
      JSON.parse(
        codexAuthJsonFromOAuthCredentials(
          {
            access: 'access-secret',
            refresh: 'refresh-secret',
            expires: 123,
            accountId: 'account-1',
            idToken: 'id-secret',
          },
          '2026-07-17T10:00:00.000Z',
        ),
      ),
    ).toEqual({
      auth_mode: 'chatgpt',
      tokens: {
        id_token: 'id-secret',
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        account_id: 'account-1',
      },
      last_refresh: '2026-07-17T10:00:00.000Z',
    });

    expect(() =>
      codexAuthJsonFromOAuthCredentials({
        access: 'access-secret',
        refresh: '',
        expires: 123,
        accountId: 'account-1',
      }),
    ).toThrow('incomplete Codex credentials');
  });

  test('moves from browser authorization to an installed connection', async () => {
    const credentials = deferred<{
      access: string;
      refresh: string;
      expires: number;
      accountId: string;
      idToken: string;
    }>();
    const installed: string[] = [];
    const manager = createCodexLoginManager({
      now: () => new Date('2026-07-17T10:00:00.000Z'),
      installAuthJson: async (authJson) => {
        installed.push(authJson);
      },
      login: async (options) => {
        options.onAuth({ url: 'https://auth.openai.com/authorize?state=safe' });
        void options.onManualCodeInput().catch(() => {});
        return await credentials.promise;
      },
    });

    const waiting = await manager.start();
    expect(waiting).toEqual({
      ok: true,
      status: 'waiting',
      authorizationUrl: 'https://auth.openai.com/authorize?state=safe',
      startedAt: '2026-07-17T10:00:00.000Z',
      completedAt: null,
      error: null,
    });
    expect(JSON.stringify(waiting)).not.toContain('secret');

    credentials.resolve({
      access: 'access-secret',
      refresh: 'refresh-secret',
      expires: 123,
      accountId: 'account-1',
      idToken: 'id-secret',
    });
    await credentials.promise;
    await Bun.sleep(0);

    expect(installed).toHaveLength(1);
    expect(manager.status().status).toBe('connected');
    expect(JSON.stringify(manager.status())).not.toContain('secret');
  });

  test('cancellation prevents a stale login from installing credentials', async () => {
    const credentials = deferred<{
      access: string;
      refresh: string;
      expires: number;
      accountId: string;
    }>();
    const installed: string[] = [];
    const manager = createCodexLoginManager({
      installAuthJson: async (authJson) => {
        installed.push(authJson);
      },
      login: async (options) => {
        options.onAuth({ url: 'https://auth.openai.com/authorize' });
        void options.onManualCodeInput().catch(() => {});
        return await credentials.promise;
      },
    });

    await manager.start();
    expect(manager.cancel().status).toBe('idle');
    credentials.resolve({
      access: 'access-secret',
      refresh: 'refresh-secret',
      expires: 123,
      accountId: 'account-1',
    });
    await credentials.promise;
    await Bun.sleep(0);

    expect(installed).toEqual([]);
    expect(manager.status().status).toBe('idle');
  });

  test('cancels cleanly before the authorization URL is ready', async () => {
    const authorizationReady = deferred<void>();
    const manager = createCodexLoginManager({
      installAuthJson: async () => {},
      login: async (options) => {
        void options.onManualCodeInput().catch(() => {});
        await authorizationReady.promise;
        options.onAuth({ url: 'https://auth.openai.com/authorize' });
        return {
          access: 'access-secret',
          refresh: 'refresh-secret',
          expires: 123,
          accountId: 'account-1',
        };
      },
    });

    const starting = manager.start();
    await Bun.sleep(0);
    expect(manager.status().status).toBe('starting');
    expect(manager.cancel().status).toBe('idle');
    expect((await starting).status).toBe('idle');

    authorizationReady.resolve();
    await authorizationReady.promise;
    await Bun.sleep(0);
    expect(manager.status().status).toBe('idle');
  });

  test('moves a stalled login to an error after the timeout', async () => {
    const manager = createCodexLoginManager({
      loginTimeoutMs: 1,
      installAuthJson: async () => {},
      login: async (options) => {
        await options.onManualCodeInput();
        throw new Error('unreachable');
      },
    });

    await expect(manager.start()).rejects.toThrow('timed out');
    expect(manager.status()).toMatchObject({
      status: 'error',
      authorizationUrl: null,
      error: 'Codex sign-in timed out. Start a new sign-in and try again.',
    });
  });

  test('does not cancel after credential installation has started', async () => {
    const installFinished = deferred<void>();
    const manager = createCodexLoginManager({
      installAuthJson: async () => {
        await installFinished.promise;
      },
      login: async (options) => {
        options.onAuth({ url: 'https://auth.openai.com/authorize' });
        void options.onManualCodeInput().catch(() => {});
        return {
          access: 'access-secret',
          refresh: 'refresh-secret',
          expires: 123,
          accountId: 'account-1',
        };
      },
    });

    await manager.start();
    await Bun.sleep(0);
    expect(manager.status().status).toBe('finishing');
    expect(manager.cancel().status).toBe('finishing');
    expect((await manager.start()).status).toBe('finishing');

    installFinished.resolve();
    await installFinished.promise;
    await Bun.sleep(0);
    expect(manager.status().status).toBe('connected');
  });
});
