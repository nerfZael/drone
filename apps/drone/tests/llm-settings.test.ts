import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  collectProviderApiKeyDiagnostics,
  describeSecretValue,
  resolveNameSuggestionLlmSettings,
  upsertStoredLlmProvider,
  upsertNamingProvider,
  resolveNamingProvider,
  upsertStoredProviderApiKey,
} from '../src/hub/hub-settings';
import { getSocketListenSupport } from './socket-listen-support';
import { getHubSettingsRepository } from '../src/host/hub-settings-repository';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

async function withTempDroneDataDirAndEnv<T>(
  env: Partial<
    Record<
      'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY' | 'DRONE_HUB_CODEX_AUTH_FILE',
      string | undefined
    >
  >,
  fn: () => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-llm-settings-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  fs.mkdirSync(droneDataDir, { recursive: true });

  const previousDataDir = process.env.DRONE_DATA_DIR;
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  const previousCodexAuthFile = process.env.DRONE_HUB_CODEX_AUTH_FILE;

  process.env.DRONE_DATA_DIR = droneDataDir;
  if (env.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  if (env.OPENROUTER_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  if (env.DRONE_HUB_CODEX_AUTH_FILE === undefined) delete process.env.DRONE_HUB_CODEX_AUTH_FILE;
  else process.env.DRONE_HUB_CODEX_AUTH_FILE = env.DRONE_HUB_CODEX_AUTH_FILE;
  resetDroneRootDirForTests();

  try {
    return await fn();
  } finally {
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    if (previousOpenAi == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
    if (previousGemini == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousOpenRouter == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
    if (previousCodexAuthFile == null) delete process.env.DRONE_HUB_CODEX_AUTH_FILE;
    else process.env.DRONE_HUB_CODEX_AUTH_FILE = previousCodexAuthFile;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson(payload)}.signature`;
}

describe('LLM settings diagnostics', () => {
  test('describes missing and blank secrets without exposing the raw value', () => {
    expect(describeSecretValue(undefined)).toEqual({
      present: false,
      hasValue: false,
      rawLength: null,
      trimmedLength: null,
      fingerprint: null,
    });

    expect(describeSecretValue('   ')).toEqual({
      present: true,
      hasValue: false,
      rawLength: 3,
      trimmedLength: 0,
      fingerprint: null,
    });
  });

  test('reports environment-backed provider keys', async () => {
    await withTempDroneDataDirAndEnv({ OPENAI_API_KEY: '  env-openai-key  ' }, async () => {
      const diagnostics = await collectProviderApiKeyDiagnostics('openai');
      expect(diagnostics.envVar).toBe('OPENAI_API_KEY');
      expect(diagnostics.env.present).toBe(true);
      expect(diagnostics.env.hasValue).toBe(true);
      expect(diagnostics.env.trimmedLength).toBe('env-openai-key'.length);
      expect(diagnostics.env.fingerprint).not.toBeNull();
      expect(diagnostics.stored.hasValue).toBe(false);
      expect(diagnostics.effective.source).toBe('environment');
      expect(diagnostics.effective.hasValue).toBe(true);
      expect(diagnostics.effective.fingerprint).toBe(diagnostics.env.fingerprint);
    });
  });

  test('reports environment-backed OpenRouter keys', async () => {
    await withTempDroneDataDirAndEnv({ OPENROUTER_API_KEY: '  env-openrouter-key  ' }, async () => {
      const diagnostics = await collectProviderApiKeyDiagnostics('openrouter');
      expect(diagnostics.envVar).toBe('OPENROUTER_API_KEY');
      expect(diagnostics.env.present).toBe(true);
      expect(diagnostics.env.hasValue).toBe(true);
      expect(diagnostics.env.trimmedLength).toBe('env-openrouter-key'.length);
      expect(diagnostics.env.fingerprint).not.toBeNull();
      expect(diagnostics.stored.hasValue).toBe(false);
      expect(diagnostics.effective.source).toBe('environment');
      expect(diagnostics.effective.hasValue).toBe(true);
      expect(diagnostics.effective.fingerprint).toBe(diagnostics.env.fingerprint);
    });
  });

  test('reports when a stored key overrides the environment', async () => {
    await withTempDroneDataDirAndEnv({ OPENAI_API_KEY: 'env-openai-key' }, async () => {
      await upsertStoredProviderApiKey('openai', 'stored-openai-key');
      const diagnostics = await collectProviderApiKeyDiagnostics('openai');
      expect(diagnostics.stored.hasValue).toBe(true);
      expect(diagnostics.stored.updatedAt).not.toBeNull();
      expect(diagnostics.stored.fingerprint).not.toBeNull();
      expect(diagnostics.env.fingerprint).not.toBeNull();
      expect(diagnostics.env.fingerprint).not.toBe(diagnostics.stored.fingerprint);
      expect(diagnostics.effective.source).toBe('settings');
      expect(diagnostics.effective.hasValue).toBe(true);
      expect(diagnostics.effective.fingerprint).toBe(diagnostics.stored.fingerprint);
    });
  });

  test('reports Codex CLI OAuth as provider auth', async () => {
    await withTempDroneDataDirAndEnv({}, async () => {
      const authPath = path.join(process.env.DRONE_DATA_DIR!, 'codex-auth.json');
      process.env.DRONE_HUB_CODEX_AUTH_FILE = authPath;
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            refresh_token: 'refresh-token',
            account_id: 'acct-123',
          },
          last_refresh: '2026-05-07T00:00:00.000Z',
        }),
        'utf8',
      );

      const diagnostics = await collectProviderApiKeyDiagnostics('codex');
      expect(diagnostics.envVar).toBe('DRONE_HUB_CODEX_AUTH_FILE');
      expect(diagnostics.effective.source).toBe('codex-cli');
      expect(diagnostics.effective.hasValue).toBe(true);
      expect(diagnostics.effective.fingerprint).not.toBeNull();
    });
  });

  test('prefers a Codex connection over an OpenAI API key for name suggestions', async () => {
    await withTempDroneDataDirAndEnv({ OPENAI_API_KEY: 'openai-key' }, async () => {
      const authPath = path.join(process.env.DRONE_DATA_DIR!, 'codex-auth.json');
      process.env.DRONE_HUB_CODEX_AUTH_FILE = authPath;
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            refresh_token: 'refresh-token',
            account_id: 'acct-123',
          },
        }),
        'utf8',
      );

      const resolved = await resolveNameSuggestionLlmSettings();
      expect(resolved.provider).toBe('codex');
      expect(resolved.source).toBe('codex-cli');
    });
  });

  test('falls back to the OpenAI API key when Codex is unavailable', async () => {
    await withTempDroneDataDirAndEnv({ OPENAI_API_KEY: 'openai-key' }, async () => {
      process.env.DRONE_HUB_CODEX_AUTH_FILE = path.join(
        process.env.DRONE_DATA_DIR!,
        'missing-codex-auth.json',
      );
      const resolved = await resolveNameSuggestionLlmSettings();
      expect(resolved.provider).toBe('openai');
      expect(resolved.apiKey).toBe('openai-key');
      expect(resolved.source).toBe('environment');
    });
  });

  test('uses the independent naming provider and keeps it when the agent provider changes', async () => {
    await withTempDroneDataDirAndEnv({ OPENROUTER_API_KEY: 'openrouter-key' }, async () => {
      await upsertNamingProvider('openrouter');
      await upsertStoredLlmProvider('gemini');

      const resolved = await resolveNameSuggestionLlmSettings();
      expect(resolved.provider).toBe('openrouter');
      expect(resolved.apiKey).toBe('openrouter-key');
      expect(resolved.source).toBe('environment');
      await upsertNamingProvider('openai');
      expect((await resolveNameSuggestionLlmSettings()).apiKey).toBeNull();
      expect(await resolveNamingProvider()).toBe('openai');
    });
  });

  test('migrates the old naming provider before changing the built-in default', async () => {
    await withTempDroneDataDirAndEnv({ OPENROUTER_API_KEY: 'openrouter-key' }, async () => {
      await (await getHubSettingsRepository()).put('llm.provider', { provider: 'openrouter' });
      await upsertStoredLlmProvider('gemini');
      expect(await resolveNamingProvider()).toBe('openrouter');
      expect((await resolveNameSuggestionLlmSettings()).provider).toBe('openrouter');
    });
  });
});

describeSocketSuite('LLM settings api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-llm-settings-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  const apiFetch = async (p: string, init?: RequestInit) => {
    const r = await fetch(`${baseUrl}${p}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    return { r, data };
  };

  beforeAll(async () => {
    fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
    fs.mkdirSync(droneDataDir, { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.DRONE_DATA_DIR = droneDataDir;
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({
      port: 0,
      apiToken: token,
    });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('keeps provider keys masked unless reveal is requested', async () => {
    await upsertStoredProviderApiKey('openai', 'stored-openai-key');

    const hidden = await apiFetch('/api/settings/openai');
    expect(hidden.r.status).toBe(200);
    expect(hidden.data.hasKey).toBe(true);
    expect(hidden.data.source).toBe('settings');
    expect(hidden.data.keyHint).toBe('stor...-key');
    expect(hidden.data.apiKey).toBeUndefined();

    const revealed = await apiFetch('/api/settings/openai?reveal=1');
    expect(revealed.r.status).toBe(200);
    expect(revealed.data.hasKey).toBe(true);
    expect(revealed.data.source).toBe('settings');
    expect(revealed.data.apiKey).toBe('stored-openai-key');
  });

  test('saves independent provider settings and rejects invalid naming providers', async () => {
    const save = (url: string, provider: string) => apiFetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider }),
    });
    expect((await save('/api/settings/naming-provider', 'gemini')).r.status).toBe(200);
    const saved = await save('/api/settings/llm', 'openrouter');
    expect(saved.data.provider.selected).toBe('openrouter');
    expect(saved.data.namingProvider).toBe('gemini');
    expect((await save('/api/settings/naming-provider', 'invalid')).r.status).toBe(400);
    expect((await apiFetch('/api/settings/llm')).data.namingProvider).toBe('gemini');
    const catalog = await apiFetch('/api/settings/openrouter/models');
    expect(catalog.r.status).toBe(200);
    expect(catalog.data).toMatchObject({ count: 0, updatedAt: null });
  });

  test('stores OpenRouter key for Hub agent settings', async () => {
    const initial = await apiFetch('/api/settings/llm');
    expect(initial.r.status).toBe(200);
    expect(initial.data.openrouter.hasKey).toBe(false);

    const saved = await apiFetch('/api/settings/openrouter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'stored-openrouter-key' }),
    });
    expect(saved.r.status).toBe(200);
    expect(saved.data.hasKey).toBe(true);
    expect(saved.data.source).toBe('settings');
    expect(saved.data.apiKey).toBeUndefined();

    const hidden = await apiFetch('/api/settings/openrouter');
    expect(hidden.r.status).toBe(200);
    expect(hidden.data.hasKey).toBe(true);
    expect(hidden.data.keyHint).toBe('stor...-key');
    expect(hidden.data.apiKey).toBeUndefined();

    const revealed = await apiFetch('/api/settings/openrouter?reveal=1');
    expect(revealed.r.status).toBe(200);
    expect(revealed.data.apiKey).toBe('stored-openrouter-key');

    const cleared = await apiFetch('/api/settings/openrouter', { method: 'DELETE' });
    expect(cleared.r.status).toBe(200);
    expect(cleared.data.hasKey).toBe(false);
    expect(cleared.data.source).toBeNull();
  });

  test('stores GROQ key for voice transcription settings', async () => {
    const initial = await apiFetch('/api/settings/llm');
    expect(initial.r.status).toBe(200);
    expect(initial.data.groq.hasKey).toBe(false);

    const saved = await apiFetch('/api/settings/groq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'stored-groq-key' }),
    });
    expect(saved.r.status).toBe(200);
    expect(saved.data.hasKey).toBe(true);
    expect(saved.data.source).toBe('settings');
    expect(saved.data.apiKey).toBeUndefined();

    const hidden = await apiFetch('/api/settings/groq');
    expect(hidden.r.status).toBe(200);
    expect(hidden.data.hasKey).toBe(true);
    expect(hidden.data.keyHint).toBe('stor...-key');
    expect(hidden.data.apiKey).toBeUndefined();

    const revealed = await apiFetch('/api/settings/groq?reveal=1');
    expect(revealed.r.status).toBe(200);
    expect(revealed.data.apiKey).toBe('stored-groq-key');

    const cleared = await apiFetch('/api/settings/groq', { method: 'DELETE' });
    expect(cleared.r.status).toBe(200);
    expect(cleared.data.hasKey).toBe(false);
    expect(cleared.data.source).toBeNull();
  });

  test('stores Exa key for assistant web tools', async () => {
    const initial = await apiFetch('/api/settings/exa');
    expect(initial.r.status).toBe(200);
    expect(initial.data.hasKey).toBe(false);

    const saved = await apiFetch('/api/settings/exa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'stored-exa-key' }),
    });
    expect(saved.r.status).toBe(200);
    expect(saved.data.hasKey).toBe(true);
    expect(saved.data.source).toBe('settings');
    expect(saved.data.apiKey).toBeUndefined();

    const revealed = await apiFetch('/api/settings/exa?reveal=1');
    expect(revealed.r.status).toBe(200);
    expect(revealed.data.apiKey).toBe('stored-exa-key');

    const cleared = await apiFetch('/api/settings/exa', { method: 'DELETE' });
    expect(cleared.r.status).toBe(200);
    expect(cleared.data.hasKey).toBe(false);
    expect(cleared.data.source).toBeNull();
  });


});
