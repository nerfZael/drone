import { codexAccessTokenExpiresAt, codexAccountId, type LocalCodexAuth } from './codex-auth-format';

const CODEX_AUTH_BASE_URL = 'https://auth.openai.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_AUTH_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export type CodexDeviceAuthorization = {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  pollIntervalMs: number;
  expiresAt: number;
};

type DeviceTokenResponse = {
  authorization_code?: string;
  code_verifier?: string;
};

function responseError(body: any, fallback: string): Error {
  return new Error(String(body?.error_description ?? body?.error?.message ?? body?.error ?? fallback));
}

async function responseJson(response: Response): Promise<any> {
  return await response.json().catch(() => ({}));
}

function abortError(): Error {
  const error = new Error('Codex sign-in cancelled');
  error.name = 'AbortError';
  return error;
}

function verificationUrl(value: unknown): string {
  const fallback = `${CODEX_AUTH_BASE_URL}/codex/device`;
  try {
    const parsed = new URL(String(value ?? '').trim());
    return parsed.protocol === 'https:' && parsed.origin === CODEX_AUTH_BASE_URL
      ? parsed.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!signal) return;
    void Promise.resolve().then(() => {
      if (!signal.aborted) return;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    });
  });
}

export async function requestCodexDeviceAuthorization(
  signal?: AbortSignal,
): Promise<CodexDeviceAuthorization> {
  const response = await fetch(`${CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    signal,
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw responseError(
      body,
      response.status === 404
        ? 'Device-code sign-in is not enabled for this OpenAI account or workspace.'
        : `Could not start Codex sign-in (${response.status})`,
    );
  }
  const deviceAuthId = String(body?.device_auth_id ?? '').trim();
  const userCode = String(body?.user_code ?? body?.usercode ?? '').trim();
  const intervalSeconds = Number(body?.interval);
  const expiresInSeconds = Number(body?.expires_in);
  const openAiVerificationUrl = verificationUrl(
    body?.verification_uri_complete ?? body?.verification_uri ?? body?.verification_url,
  );
  if (!deviceAuthId || !userCode)
    throw new Error('OpenAI returned an incomplete Codex device authorization');
  return {
    verificationUrl: openAiVerificationUrl,
    userCode,
    deviceAuthId,
    pollIntervalMs:
      Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? intervalSeconds * 1_000
        : DEFAULT_POLL_INTERVAL_MS,
    expiresAt:
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Date.now() + expiresInSeconds * 1_000
        : Date.now() + DEVICE_AUTH_TIMEOUT_MS,
  };
}

async function pollForAuthorizationCode(
  authorization: CodexDeviceAuthorization,
  signal?: AbortSignal,
): Promise<{ authorizationCode: string; codeVerifier: string }> {
  while (Date.now() < authorization.expiresAt) {
    if (signal?.aborted) throw abortError();
    const response = await fetch(`${CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: authorization.deviceAuthId,
        user_code: authorization.userCode,
      }),
      signal,
    });
    if (response.ok) {
      const body = (await responseJson(response)) as DeviceTokenResponse;
      const authorizationCode = String(body.authorization_code ?? '').trim();
      const codeVerifier = String(body.code_verifier ?? '').trim();
      if (!authorizationCode || !codeVerifier)
        throw new Error('OpenAI returned an incomplete Codex authorization');
      return { authorizationCode, codeVerifier };
    }
    if (response.status !== 403 && response.status !== 404) {
      const body = await responseJson(response);
      throw responseError(body, `Codex sign-in failed (${response.status})`);
    }
    await wait(authorization.pollIntervalMs, signal);
  }
  throw new Error('Codex sign-in expired. Start a new sign-in and try again.');
}

async function exchangeAuthorizationCode(input: {
  authorizationCode: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<LocalCodexAuth> {
  const response = await fetch(`${CODEX_AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code: input.authorizationCode,
      code_verifier: input.codeVerifier,
      redirect_uri: `${CODEX_AUTH_BASE_URL}/deviceauth/callback`,
    }).toString(),
    signal: input.signal,
  });
  const body = await responseJson(response);
  if (!response.ok)
    throw responseError(body, `Could not finish Codex sign-in (${response.status})`);
  const accessToken = String(body?.access_token ?? '').trim();
  const refreshToken = String(body?.refresh_token ?? '').trim();
  const accountId = codexAccountId(accessToken);
  if (!accessToken || !refreshToken || !accountId)
    throw new Error('OpenAI returned incomplete Codex credentials');
  const expiresIn = Number(body?.expires_in);
  return {
    accessToken,
    refreshToken,
    accountId,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1_000
        : codexAccessTokenExpiresAt(accessToken),
  };
}

export async function completeCodexDeviceAuthorization(
  authorization: CodexDeviceAuthorization,
  signal?: AbortSignal,
): Promise<LocalCodexAuth> {
  const code = await pollForAuthorizationCode(authorization, signal);
  return await exchangeAuthorizationCode({ ...code, signal });
}
