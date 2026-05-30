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
  });

  test('creates normal and voice threads, renames, and deletes through the API', async () => {
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

    const normal = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Normal API thread' }),
    }).then((response) => response.json());
    expect(normal.thread.source).toBe('web');
    expect(normal.thread.voiceEnabled).toBe(false);
    expect(normal.thread.provider).toBe('codex');
    expect(normal.thread.model).toBe('gpt-5.3-codex-spark');

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
      url: `/api/assistant/threads/${normal.thread.id}`,
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Renamed API thread' }),
    }).then((response) => response.json());
    expect(renamed.thread.title).toBe('Renamed API thread');

    const deleted = await built.app.inject({
      method: 'DELETE',
      url: `/api/assistant/threads/${normal.thread.id}`,
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(deleted.deleted).toBe(true);
    expect(deleted.snapshot.threads.some((thread: any) => thread.id === normal.thread.id)).toBe(false);
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

  test('uses manually voice-enabled web threads for device recordings', async () => {
    const user = db.upsertUser({
      clerkUserId: 'clerk_voice_enabled_web_thread',
      displayName: 'Voice Enabled Web Thread',
      email: 'voice-enabled-web-thread@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    const thread = db.createThread(user.id, { title: 'Manual voice thread', source: 'web', voiceEnabled: true });

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
