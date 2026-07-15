import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  collectProviderApiKeyDiagnostics,
  describeSecretValue,
  AGENT_SUGGESTION_POLICY_DEFAULT,
  AGENT_SUGGESTION_ENABLED_BY_DEFAULT,
  AGENT_SUGGESTION_POLICY_MAX_CHARS,
  VOICE_APPROVAL_SETTINGS_DEFAULT,
  VOICE_REALTIME_SETTINGS_DEFAULT,
  resolveAgentSuggestionSettingsResponse,
  resolveEffectiveVoiceApprovalSettings,
  resolveEffectiveVoiceRealtimeSettings,
  resolveNameSuggestionLlmSettings,
  upsertStoredProviderApiKey,
  upsertStoredAgentSuggestionSettings,
  upsertStoredVoiceApprovalSettings,
  upsertStoredVoiceRealtimeSettings,
} from '../src/hub/hub-settings';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

async function withTempDroneDataDirAndEnv<T>(
  env: Partial<Record<'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'DRONE_HUB_CODEX_AUTH_FILE', string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-llm-settings-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  fs.mkdirSync(droneDataDir, { recursive: true });

  const previousDataDir = process.env.DRONE_DATA_DIR;
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousCodexAuthFile = process.env.DRONE_HUB_CODEX_AUTH_FILE;

  process.env.DRONE_DATA_DIR = droneDataDir;
  if (env.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
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
});

describe('assistant suggestion settings', () => {
  test('returns defaults before anything is stored', async () => {
    await withTempDroneDataDirAndEnv({}, async () => {
      const resolved = await resolveAgentSuggestionSettingsResponse();
      expect(resolved.agentSuggestion.policyMarkdown).toBe(AGENT_SUGGESTION_POLICY_DEFAULT);
      expect(resolved.agentSuggestion.policyMarkdownSource).toBe('default');
      expect(resolved.agentSuggestion.enabledByDefault).toBe(AGENT_SUGGESTION_ENABLED_BY_DEFAULT);
      expect(resolved.agentSuggestion.enabledByDefaultSource).toBe('default');
      expect(resolved.agentSuggestion.maxPolicyChars).toBe(AGENT_SUGGESTION_POLICY_MAX_CHARS);
      expect(resolved.agentSuggestion.updatedAt).toBeNull();
      expect(resolved.agentSuggestion.policyFingerprint).toHaveLength(12);
    });
  });

  test('persists custom assistant suggestion settings and returns the derived fingerprint', async () => {
    await withTempDroneDataDirAndEnv({}, async () => {
      await upsertStoredAgentSuggestionSettings({
        policyMarkdown: '# Assistant Suggestion Policy\n\nPrefer asking for review.',
        enabledByDefault: true,
      });
      const resolved = await resolveAgentSuggestionSettingsResponse();
      expect(resolved.agentSuggestion.policyMarkdown).toContain('Prefer asking for review.');
      expect(resolved.agentSuggestion.policyMarkdownSource).toBe('settings');
      expect(resolved.agentSuggestion.enabledByDefault).toBe(true);
      expect(resolved.agentSuggestion.enabledByDefaultSource).toBe('settings');
      expect(resolved.agentSuggestion.updatedAt).not.toBeNull();
      expect(resolved.agentSuggestion.policyFingerprint).toHaveLength(12);
    });
  });
});

describe('voice approval settings', () => {
  test('normalizes minimum digits down to the shortest configured code', async () => {
    await withTempDroneDataDirAndEnv({}, async () => {
      await upsertStoredVoiceApprovalSettings({
        ...VOICE_APPROVAL_SETTINGS_DEFAULT,
        unlockCode: '123',
        minDigits: 4,
        maxDigits: 4,
      });

      const settings = await resolveEffectiveVoiceApprovalSettings();
      expect(settings.unlockCode).toBe('123');
      expect(settings.minDigits).toBe(3);
      expect(settings.maxDigits).toBe(4);
    });
  });
});

describe('voice realtime settings', () => {
  test('persists the native provider and rejects unknown providers', async () => {
    await withTempDroneDataDirAndEnv({}, async () => {
      expect(await resolveEffectiveVoiceRealtimeSettings()).toMatchObject(VOICE_REALTIME_SETTINGS_DEFAULT);
      await upsertStoredVoiceRealtimeSettings({ enabled: true, provider: 'native' });
      expect(await resolveEffectiveVoiceRealtimeSettings()).toMatchObject({ enabled: true, provider: 'native', source: 'settings' });
      await expect(upsertStoredVoiceRealtimeSettings({ enabled: true, provider: 'typo' })).rejects.toThrow('Invalid voice realtime settings');
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
  let groqSettingsChangeNotifications = 0;
  let voiceStreamPairingPasswordChangeNotifications = 0;
  let voiceTranscriptionSettingsChangeNotifications = 0;

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
      onGroqApiKeySettingsChanged: () => {
        groqSettingsChangeNotifications += 1;
      },
      onVoiceStreamPairingPasswordSettingsChanged: () => {
        voiceStreamPairingPasswordChangeNotifications += 1;
      },
      onVoiceTranscriptionSettingsChanged: () => {
        voiceTranscriptionSettingsChangeNotifications += 1;
      },
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

  test('stores GROQ key for voice transcription settings', async () => {
    const notificationCountBefore = groqSettingsChangeNotifications;
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
    expect(groqSettingsChangeNotifications).toBe(notificationCountBefore + 2);
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

  test('stores Voice Stream pairing password settings', async () => {
    const notificationCountBefore = voiceStreamPairingPasswordChangeNotifications;
    const initial = await apiFetch('/api/settings/llm');
    expect(initial.r.status).toBe(200);
    expect(initial.data.voiceStreamPairingPassword.hasPassword).toBe(false);

    const saved = await apiFetch('/api/settings/voice-stream/pairing-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'pair-password' }),
    });
    expect(saved.r.status).toBe(200);
    expect(saved.data.hasPassword).toBe(true);
    expect(saved.data.source).toBe('settings');
    expect(saved.data.password).toBeUndefined();

    const revealed = await apiFetch('/api/settings/voice-stream/pairing-password?reveal=1');
    expect(revealed.r.status).toBe(200);
    expect(revealed.data.password).toBe('pair-password');

    const cleared = await apiFetch('/api/settings/voice-stream/pairing-password', { method: 'DELETE' });
    expect(cleared.r.status).toBe(200);
    expect(cleared.data.hasPassword).toBe(false);
    expect(cleared.data.source).toBeNull();
    expect(voiceStreamPairingPasswordChangeNotifications).toBe(notificationCountBefore + 2);
  });

  test('stores voice transcription finalization settings', async () => {
    const notificationCountBefore = voiceTranscriptionSettingsChangeNotifications;
    const initial = await apiFetch('/api/settings/voice-approval');
    expect(initial.r.status).toBe(200);
    expect(initial.data.voiceTranscription.finalMode).toBe('full-recording');
    expect(initial.data.voiceTranscription.source).toBe('default');

    const saved = await apiFetch('/api/settings/voice-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        voiceApproval: initial.data.voiceApproval,
        voiceTranscription: { finalMode: 'segments' },
      }),
    });
    expect(saved.r.status).toBe(200);
    expect(saved.data.voiceTranscription.finalMode).toBe('segments');
    expect(saved.data.voiceTranscription.source).toBe('settings');
    expect(voiceTranscriptionSettingsChangeNotifications).toBe(notificationCountBefore + 1);

    const reset = await apiFetch('/api/settings/voice-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voiceTranscription: { finalMode: 'full-recording' } }),
    });
    expect(reset.r.status).toBe(200);
    expect(reset.data.voiceTranscription.finalMode).toBe('full-recording');
    expect(reset.data.voiceTranscription.source).toBe('default');
    expect(voiceTranscriptionSettingsChangeNotifications).toBe(notificationCountBefore + 2);
  });

  test('normalizes voice approval digit bounds to configured codes', async () => {
    const initial = await apiFetch('/api/settings/voice-approval');
    expect(initial.r.status).toBe(200);

    const saved = await apiFetch('/api/settings/voice-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        voiceApproval: {
          ...initial.data.voiceApproval,
          unlockCode: '123',
          minDigits: 4,
          maxDigits: 4,
        },
      }),
    });

    expect(saved.r.status).toBe(200);
    expect(saved.data.voiceApproval.unlockCode).toBe('123');
    expect(saved.data.voiceApproval.minDigits).toBe(3);
    expect(saved.data.voiceApproval.maxDigits).toBe(4);
  });

  test('reads and updates agent auto-continue settings', async () => {
    const initial = await apiFetch('/api/settings/agent-message-auto-continue');
    expect(initial.r.status).toBe(200);
    expect(initial.data.agentMessageAutoContinue.prompt).toBe('continue');
    expect(initial.data.agentMessageAutoContinue.promptSource).toBe('default');
    expect(initial.data.agentMessageAutoContinue.enabledByDefault).toBe(false);
    expect(initial.data.agentMessageAutoContinue.enabledByDefaultSource).toBe('default');

    const updated = await apiFetch('/api/settings/agent-message-auto-continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'keep going please', enabledByDefault: true }),
    });
    expect(updated.r.status).toBe(200);
    expect(updated.data.agentMessageAutoContinue.prompt).toBe('keep going please');
    expect(updated.data.agentMessageAutoContinue.promptSource).toBe('settings');
    expect(updated.data.agentMessageAutoContinue.enabledByDefault).toBe(true);
    expect(updated.data.agentMessageAutoContinue.enabledByDefaultSource).toBe('settings');
    expect(updated.data.agentMessageAutoContinue.updatedAt).not.toBeNull();
  });

  test('reads and updates assistant suggestion settings', async () => {
    const initial = await apiFetch('/api/settings/agent-suggestion');
    expect(initial.r.status).toBe(200);
    expect(initial.data.agentSuggestion.policyMarkdown).toBe(AGENT_SUGGESTION_POLICY_DEFAULT);
    expect(initial.data.agentSuggestion.policyMarkdownSource).toBe('default');
    expect(initial.data.agentSuggestion.enabledByDefault).toBe(false);
    expect(initial.data.agentSuggestion.enabledByDefaultSource).toBe('default');
    expect(initial.data.agentSuggestion.maxPolicyChars).toBe(AGENT_SUGGESTION_POLICY_MAX_CHARS);
    expect(initial.data.agentSuggestion.policyFingerprint).toHaveLength(12);

    const updated = await apiFetch('/api/settings/agent-suggestion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        policyMarkdown: '# Assistant Suggestion Policy\n\nPrefer terse approvals.',
        enabledByDefault: true,
      }),
    });
    expect(updated.r.status).toBe(200);
    expect(updated.data.agentSuggestion.policyMarkdown).toContain('Prefer terse approvals.');
    expect(updated.data.agentSuggestion.policyMarkdownSource).toBe('settings');
    expect(updated.data.agentSuggestion.enabledByDefault).toBe(true);
    expect(updated.data.agentSuggestion.enabledByDefaultSource).toBe('settings');
    expect(updated.data.agentSuggestion.updatedAt).not.toBeNull();
    expect(updated.data.agentSuggestion.policyFingerprint).toHaveLength(12);
  });
});
