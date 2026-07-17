import { afterEach, describe, expect, test } from 'bun:test';
import {
  completeCodexDeviceAuthorization,
  requestCodexDeviceAuthorization,
} from '../src/local-assistant/codex-device-auth';

const originalFetch = globalThis.fetch;

function token(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Codex device authorization', () => {
  test('requests a code, polls until approved, and exchanges it for phone credentials', async () => {
    const accessToken = token({
      exp: 2_000_000_000,
      'https://api.openai.com/auth': { chatgpt_account_id: 'account_phone' },
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      new Response(
        JSON.stringify({
          device_auth_id: 'device_auth_1',
          user_code: 'ABCD-1234',
          interval: '0.001',
          expires_in: 600,
          verification_uri_complete: 'https://auth.openai.com/codex/device?user_code=ABCD-1234',
        }),
        { status: 200 },
      ),
      new Response('{}', { status: 404 }),
      new Response(
        JSON.stringify({ authorization_code: 'authorization_1', code_verifier: 'verifier_1' }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh_1',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    ];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    }) as typeof fetch;

    const authorization = await requestCodexDeviceAuthorization();
    expect(authorization).toMatchObject({
      verificationUrl: 'https://auth.openai.com/codex/device?user_code=ABCD-1234',
      userCode: 'ABCD-1234',
      deviceAuthId: 'device_auth_1',
      pollIntervalMs: 1,
    });
    expect(authorization.expiresAt).toBeGreaterThan(Date.now() + 590_000);

    const auth = await completeCodexDeviceAuthorization(authorization);
    expect(auth).toMatchObject({
      accessToken,
      refreshToken: 'refresh_1',
      accountId: 'account_phone',
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
      'https://auth.openai.com/api/accounts/deviceauth/token',
      'https://auth.openai.com/api/accounts/deviceauth/token',
      'https://auth.openai.com/oauth/token',
    ]);
    expect(String(requests[3]?.init?.body)).toContain(
      'redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback',
    );
  });

  test('explains when device-code authorization is unavailable', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    await expect(requestCodexDeviceAuthorization()).rejects.toThrow(
      'Device-code sign-in is not enabled',
    );
  });

  test('only opens device verification links on the OpenAI auth origin', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          device_auth_id: 'device_auth_1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://example.com/collect-code',
        }),
        { status: 200 },
      )) as typeof fetch;

    await expect(requestCodexDeviceAuthorization()).resolves.toMatchObject({
      verificationUrl: 'https://auth.openai.com/codex/device',
    });
  });

  test('stops polling when sign-in is cancelled', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(
      completeCodexDeviceAuthorization(
        {
          verificationUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
          deviceAuthId: 'device_auth_1',
          pollIntervalMs: 1,
          expiresAt: Date.now() + 60_000,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
