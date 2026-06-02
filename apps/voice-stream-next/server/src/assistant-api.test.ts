import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';
import type { VoiceStreamNextDb } from './db.js';

const devHeaders = {
  'content-type': 'application/json',
  'x-voice-dev-user-email': 'assistant-api@example.local',
  'x-voice-dev-user-name': 'Assistant API',
  'x-voice-dev-admin': '0',
};
const devAuthHeaders = {
  'x-voice-dev-user-email': 'assistant-api@example.local',
  'x-voice-dev-user-name': 'Assistant API',
  'x-voice-dev-admin': '0',
};

function tempDataDir(): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
}

describe('assistant API parity', () => {
  let dataDir = '';
  let built: Awaited<ReturnType<typeof buildApp>>;
  let db: VoiceStreamNextDb;

  beforeEach(async () => {
    dataDir = tempDataDir();
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    built = await buildApp({ logger: false });
    db = built.db;
  });

  afterEach(async () => {
    built.app.server.closeAllConnections?.();
    await built.app.close();
    db.db.close();
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    delete process.env.VOICE_STREAM_NEXT_SECRETS_KEY;
  });

  test('creates voice-enabled threads, renames, and deletes through the API', async () => {
    const settings = await built.app.inject({
      method: 'PATCH',
      url: '/api/assistant/settings',
      headers: devHeaders,
      payload: JSON.stringify({
        defaultProvider: 'codex',
        defaultModel: 'gpt-5.3-codex-spark',
        defaultThinkingLevel: 'off',
      }),
    }).then((response) => response.json());
    expect(settings.settings.defaultProvider).toBe('codex');
    expect(settings.settings.defaultModel).toBe('gpt-5.3-codex-spark');

    const first = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'API thread' }),
    }).then((response) => response.json());
    expect(first.thread.source).toBe('voice');
    expect(first.thread.voiceEnabled).toBe(true);
    expect(first.thread.provider).toBe('codex');
    expect(first.thread.model).toBe('gpt-5.3-codex-spark');

    const voice = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Voice API thread', source: 'voice', voiceEnabled: true }),
    }).then((response) => response.json());
    expect(voice.thread.source).toBe('voice');
    expect(voice.thread.voiceEnabled).toBe(true);

    const renamed = await built.app.inject({
      method: 'PATCH',
      url: `/api/assistant/threads/${first.thread.id}`,
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Renamed API thread' }),
    }).then((response) => response.json());
    expect(renamed.thread.title).toBe('Renamed API thread');

    const deleted = await built.app.inject({
      method: 'DELETE',
      url: `/api/assistant/threads/${first.thread.id}`,
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(deleted.deleted).toBe(true);
    expect(deleted.snapshot.threads.some((thread: any) => thread.id === first.thread.id)).toBe(false);
  });

  test('reveals assistant API keys only through the copy endpoint', async () => {
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const saved = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/keys/openai',
      headers: devHeaders,
      payload: JSON.stringify({ apiKey: 'sk-openai-copy-test' }),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().key.keyHint).toContain('test');

    const listed = await built.app.inject({
      method: 'GET',
      url: '/api/assistant/keys',
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(JSON.stringify(listed)).not.toContain('sk-openai-copy-test');
    expect(listed.keys.openai.hasKey).toBe(true);

    const revealed = await built.app.inject({
      method: 'GET',
      url: '/api/assistant/keys/openai/reveal',
      headers: devAuthHeaders,
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().apiKey).toBe('sk-openai-copy-test');
  });

  test('lets paired Android devices read the shared current voice thread files', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_android_files',
      displayName: 'Android Files',
      email: 'android-files@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const thread = db.latestVoiceThread(user.id, registered.device.id);
    db.upsertArtifact(user.id, thread.id, { path: 'notes/status.md', content: '# Status\n\nReady' });

    const summary = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${registered.device.id}/assistant/thread`,
      headers: {
        'x-voice-device-token': registered.token,
        'x-voice-client-version': '12',
      },
    }).then((response) => response.json());
    expect(summary.ok).toBe(true);
    expect(summary.thread.id).toBe(thread.id);
    expect(summary.artifactsCount).toBe(1);

    const files = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${registered.device.id}/assistant/thread/artifacts`,
      headers: {
        'x-voice-device-token': registered.token,
        'x-voice-client-version': '12',
      },
    }).then((response) => response.json());
    expect(files.ok).toBe(true);
    expect(files.thread.id).toBe(thread.id);
    expect(files.artifacts).toHaveLength(1);
    expect(files.artifacts[0].path).toBe('notes/status.md');
    expect(files.artifacts[0].content).toContain('Ready');
  });

  test('reuses the latest voice thread across different devices', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_shared_voice_thread',
      displayName: 'Shared Voice Thread',
      email: 'shared-voice-thread@example.local',
      admin: false,
    });
    const phone = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const desktop = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });

    const phoneSession = db.createVoiceSession(user.id, phone.device.id, 'assistant');
    const desktopSession = db.createVoiceSession(user.id, desktop.device.id, 'assistant');

    expect(desktopSession.assistantThreadId).toBe(phoneSession.assistantThreadId);

    db.upsertArtifact(user.id, phoneSession.assistantThreadId, { path: 'notes/shared.md', content: 'Shared across devices' });
    const desktopFiles = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${desktop.device.id}/assistant/thread/artifacts`,
      headers: {
        'x-voice-device-token': desktop.token,
        'x-voice-client-version': '12',
      },
    }).then((response) => response.json());

    expect(desktopFiles.ok).toBe(true);
    expect(desktopFiles.thread.id).toBe(phoneSession.assistantThreadId);
    expect(desktopFiles.artifacts).toHaveLength(1);
    expect(desktopFiles.artifacts[0].content).toContain('Shared across devices');
  });

  test('seeds Sebastian and isolates voice sessions by assistant profile', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_assistant_profiles',
      displayName: 'Assistant Profiles',
      email: 'assistant-profiles@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const profiles = db.listAssistantProfiles(user.id);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.name).toBe('Sebastian');
    expect(profiles[0]?.wakePhrase).toBe('hey sebastian');
    expect(profiles[0]?.wakePhraseAliases).toEqual(['hay sebastian', 'hey sebastien', 'hay sebastien']);
    expect(profiles[0]?.systemPrompt).toContain('You are Sebastian, an AI assistant.');
    expect(profiles[0]?.systemPrompt).toContain('use the speak tool');

    const jenny = db.createAssistantProfile(user.id, { name: 'Jenny', wakePhrase: 'hey jenny', wakePhraseAliases: ['hello jenny'], ttsVoice: 'jenny' });
    expect(jenny.name).toBe('Jenny');
    expect(jenny.wakePhraseAliases).toEqual(['hello jenny']);
    const updatedJenny = db.updateAssistantProfile(user.id, jenny.id, { systemPrompt: 'You are Jenny.', enabledTools: ['speak'] });
    expect(updatedJenny?.systemPrompt).toBe('You are Jenny.');
    expect(updatedJenny?.enabledTools).toEqual(['speak']);
    expect(db.createThread(user.id, { title: 'Jenny tools', assistantProfileId: jenny.id }).enabledTools).toEqual(['speak']);
    expect(() => db.createAssistantProfile(user.id, { name: 'Duplicate', wakePhrase: 'hello jenny', ttsVoice: 'austin' })).toThrow('wake phrase is already used by another assistant profile');
    const alex = db.createAssistantProfile(user.id, { name: 'Alex', wakePhrase: 'hey alex', ttsVoice: 'austin', baseProfileId: jenny.id });
    expect(() => db.updateAssistantProfile(user.id, jenny.id, { baseProfileId: alex.id })).toThrow('assistant profile inheritance cannot contain a cycle');
    const disabled = db.createAssistantProfile(user.id, { name: 'Mia', wakePhrase: 'hey mia', ttsVoice: 'mia', enabled: false });
    expect(() => db.createVoiceSession(user.id, registered.device.id, 'assistant', { assistantProfileId: disabled.id })).toThrow('unknown or disabled assistant profile');
    const manualThread = db.createThread(user.id, { title: 'Manual profile switch' });
    expect(manualThread.assistantProfileId).toBe(profiles[0]!.id);
    expect(db.updateThread(user.id, manualThread.id, { assistantProfileId: jenny.id })?.assistantProfileId).toBe(jenny.id);
    expect(() => db.updateThread(user.id, manualThread.id, { assistantProfileId: disabled.id })).toThrow('unknown or disabled assistant profile');
    db.addMessage(user.id, manualThread.id, { role: 'user', content: 'hello' });
    expect(() => db.updateThread(user.id, manualThread.id, { assistantProfileId: profiles[0]!.id })).toThrow('assistant profile cannot be changed after thread messages exist');

    const sebastianSession = db.createVoiceSession(user.id, registered.device.id, 'assistant', { assistantProfileId: profiles[0]!.id });
    const jennySession = db.createVoiceSession(user.id, registered.device.id, 'assistant', { assistantProfileId: jenny.id });
    expect(sebastianSession.assistantProfileId).toBe(profiles[0]!.id);
    expect(jennySession.assistantProfileId).toBe(jenny.id);
    expect(jennySession.assistantThreadId).not.toBe(sebastianSession.assistantThreadId);
    db.upsertArtifact(user.id, sebastianSession.assistantThreadId, { path: 'notes/profile.md', content: 'Sebastian notes' });
    db.upsertArtifact(user.id, jennySession.assistantThreadId, { path: 'notes/profile.md', content: 'Jenny notes' });
    const jennyFiles = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${registered.device.id}/assistant/thread/artifacts?assistantProfileId=${jenny.id}`,
      headers: {
        'x-voice-device-token': registered.token,
        'x-voice-client-version': '12',
      },
    }).then((response) => response.json());
    expect(jennyFiles.thread.id).toBe(jennySession.assistantThreadId);
    expect(jennyFiles.artifacts[0].content).toBe('Jenny notes');
    db.updateAssistantProfile(user.id, profiles[0]!.id, { enabled: false });
    const defaultSession = db.createVoiceSession(user.id, registered.device.id, 'assistant');
    expect(defaultSession.assistantProfileId).toBe(jenny.id);
    db.updateAssistantProfile(user.id, alex.id, { enabled: false });
    expect(() => db.updateAssistantProfile(user.id, jenny.id, { enabled: false })).toThrow('at least one assistant profile must remain enabled');
  });

  test('backfills missing Sebastian aliases without overriding explicit alias edits', () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_assistant_profile_alias_backfill',
      displayName: 'Assistant Profile Alias Backfill',
      email: 'assistant-profile-alias-backfill@example.local',
      admin: false,
    });
    const existing = db.listAssistantProfiles(user.id)[0]!;
    db.db
      .query(
        `
        UPDATE assistant_profiles
        SET wake_phrase_aliases_json = NULL
        WHERE user_id = $userId AND id = $profileId
      `,
      )
      .run({ $userId: user.id, $profileId: existing.id });

    const seeded = db.listAssistantProfiles(user.id)[0]!;
    expect(seeded.wakePhraseAliases).toEqual(['hay sebastian', 'hey sebastien', 'hay sebastien']);
    expect(seeded.systemPrompt).toContain('You are Sebastian, an AI assistant.');

    db.updateAssistantProfile(user.id, seeded.id, { wakePhraseAliases: [] });
    expect(db.listAssistantProfiles(user.id)[0]?.wakePhraseAliases).toEqual([]);
    db.updateAssistantProfile(user.id, seeded.id, { systemPrompt: '' });
    expect(db.listAssistantProfiles(user.id)[0]?.systemPrompt).toBe('');
  });

  test('repairs all-disabled assistant profiles and normalizes unsupported voices', () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_assistant_profile_repair',
      displayName: 'Assistant Profile Repair',
      email: 'assistant-profile-repair@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    const existing = db.listAssistantProfiles(user.id)[0]!;
    db.db
      .query(
        `
        UPDATE assistant_profiles
        SET enabled = 0
        WHERE user_id = $userId
      `,
      )
      .run({ $userId: user.id });

    const repaired = db.listAssistantProfiles(user.id)[0]!;
    expect(repaired.id).toBe(existing.id);
    expect(repaired.enabled).toBe(true);
    expect(db.createVoiceSession(user.id, registered.device.id, 'assistant').assistantProfileId).toBe(existing.id);

    const profile = db.createAssistantProfile(user.id, { name: 'Jenny', wakePhrase: 'hey jenny', ttsVoice: 'invalid voice' });
    expect(profile.ttsVoice).toBe('austin');
    const updated = db.updateAssistantProfile(user.id, profile.id, { ttsVoice: 'diana' });
    expect(updated?.ttsVoice).toBe('diana');
    const unchanged = db.updateAssistantProfile(user.id, profile.id, { ttsVoice: 'not-supported' });
    expect(unchanged?.ttsVoice).toBe('diana');
  });

  test('uses manually created threads for device recordings', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_voice_enabled_web_thread',
      displayName: 'Voice Enabled Web Thread',
      email: 'voice-enabled-web-thread@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    const thread = db.createThread(user.id, { title: 'Manual thread' });

    expect(db.latestVoiceThreadOrNull(user.id)?.id).toBe(thread.id);

    const session = db.createVoiceSession(user.id, registered.device.id, 'assistant');
    expect(session.assistantThreadId).toBe(thread.id);
  });

  test('does not create a voice thread when Android reads files before any voice session', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_android_empty_files',
      displayName: 'Android Empty Files',
      email: 'android-empty-files@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    expect(db.listThreads(user.id)).toHaveLength(0);

    const summary = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${registered.device.id}/assistant/thread`,
      headers: {
        'x-voice-device-token': registered.token,
        'x-voice-client-version': '12',
      },
    });
    expect(summary.statusCode).toBe(200);
    const summaryBody = summary.json();
    expect(summaryBody.thread).toBeNull();
    expect(summaryBody.artifactsCount).toBe(0);
    expect(db.listThreads(user.id)).toHaveLength(0);

    const files = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${registered.device.id}/assistant/thread/artifacts`,
      headers: {
        'x-voice-device-token': registered.token,
        'x-voice-client-version': '12',
      },
    });
    expect(files.statusCode).toBe(200);
    const filesBody = files.json();
    expect(filesBody.thread).toBeNull();
    expect(filesBody.artifacts).toEqual([]);
    expect(db.listThreads(user.id)).toHaveLength(0);
  });

  test('rejects Android assistant file reads with an invalid device token', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_android_bad_token',
      displayName: 'Android Bad Token',
      email: 'android-bad-token@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });

    const response = await built.app.inject({
      method: 'GET',
      url: `/api/devices/${registered.device.id}/assistant/thread/artifacts`,
      headers: {
        'x-voice-device-token': 'wrong-token',
        'x-voice-client-version': '12',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().ok).toBe(false);
    expect(db.listThreads(user.id)).toHaveLength(0);
  });

  test('queues and cancels prompts through assistant routes', async () => {
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Queued API thread' }),
    }).then((response) => response.json());
    db.createRun(created.thread.userId, created.thread.id, {
      prompt: 'already running',
      provider: 'openai',
      model: 'gpt-5.2',
      thinkingLevel: 'off',
    });

    const queued = await built.app.inject({
      method: 'POST',
      url: `/api/assistant/threads/${created.thread.id}/prompt`,
      headers: devHeaders,
      payload: JSON.stringify({ prompt: 'run this next', provider: 'openai' }),
    }).then((response) => response.json());
    const queuedPrompt = queued.snapshot.threads.find((thread: any) => thread.id === created.thread.id).queuedPrompts[0];
    expect(queued.events.some((event: any) => event.type === 'queued')).toBe(true);
    expect(queuedPrompt.prompt).toBe('run this next');

    const cancelled = await built.app.inject({
      method: 'DELETE',
      url: `/api/assistant/threads/${created.thread.id}/queued/${queuedPrompt.id}`,
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(cancelled.queuedPrompt.status).toBe('cancelled');
    expect(cancelled.snapshot.threads.find((thread: any) => thread.id === created.thread.id).queuedPrompts).toHaveLength(0);
  });

  test('connects and disconnects Codex OAuth credentials through assistant routes', async () => {
    const originalFetch = globalThis.fetch;
    const accessPayload = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_test_123' },
    })).toString('base64url');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        access_token: `header.${accessPayload}.sig`,
        refresh_token: 'refresh-test-token',
        expires_in: 3600,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      const started = await built.app.inject({
        method: 'POST',
        url: '/api/assistant/codex/connect',
        headers: devHeaders,
        payload: '{}',
      }).then((response) => response.json());
      expect(started.authorizationUrl).toContain('auth.openai.com/oauth/authorize');
      expect(started.state).toBeTruthy();

      const completed = await built.app.inject({
        method: 'POST',
        url: '/api/assistant/codex/complete',
        headers: devHeaders,
        payload: JSON.stringify({
          state: started.state,
          codeOrUrl: `http://localhost:1455/auth/callback?code=test-code&state=${started.state}`,
        }),
      }).then((response) => response.json());
      expect(completed.codexConnection.connected).toBe(true);
      expect(completed.codexConnection.accountId).toBe('acct_test_123');
      expect(completed.snapshot.assistantSettings.defaultProvider).toBe('codex');

      const codexThread = await built.app.inject({
        method: 'POST',
        url: '/api/assistant/threads',
        headers: devHeaders,
        payload: JSON.stringify({ title: 'Codex default thread' }),
      }).then((response) => response.json());
      expect(codexThread.thread.provider).toBe('codex');

      const disconnected = await built.app.inject({
        method: 'DELETE',
        url: '/api/assistant/codex/connection',
        headers: devAuthHeaders,
      }).then((response) => response.json());
      expect(disconnected.codexConnection.connected).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns and stores spoken replies for voice thread prompts', async () => {
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Speak API thread', source: 'voice', voiceEnabled: true }),
    }).then((response) => response.json());

    const prompted = await built.app.inject({
      method: 'POST',
      url: `/api/assistant/threads/${created.thread.id}/prompt`,
      headers: devHeaders,
      payload: JSON.stringify({ prompt: '/speak Hello from assistant.' }),
    }).then((response) => response.json());

    const spokenMessage = prompted.events.find((event: any) => event.type === 'message' && event.message?.spokenText);
    expect(spokenMessage.message.spokenText).toBe('Hello from assistant.');
    expect(db.listMessages(created.thread.userId, created.thread.id).some((message) => message.spokenText === 'Hello from assistant.')).toBe(true);
  });

  test('stores speech playback target and does not expose direct assistant speech endpoint', async () => {
    const updated = await built.app.inject({
      method: 'PATCH',
      url: '/api/settings/speech-playback',
      headers: devHeaders,
      payload: JSON.stringify({ target: 'desktop' }),
    }).then((response) => response.json());
    expect(updated.settings.speechPlaybackTarget).toBe('desktop');
    expect(updated.speechPlayback.preferredTarget).toBe('desktop');

    const dashboard = await built.app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(dashboard.settings.speechPlaybackTarget).toBe('desktop');

    const removed = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/speech',
      headers: devHeaders,
      payload: JSON.stringify({ text: 'not a public TTS endpoint' }),
    });
    expect(removed.statusCode).toBe(404);
  });
});
