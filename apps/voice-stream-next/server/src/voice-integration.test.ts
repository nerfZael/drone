import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';
import { extensionToolName } from './assistant-extensions.js';
import { VoiceStreamNextDb } from './db.js';

const devHeaders = {
  'content-type': 'application/json',
  'x-voice-dev-user-email': 'voice-integration@example.local',
  'x-voice-dev-user-name': 'Voice Integration',
  'x-voice-dev-admin': '0',
};

function tempDataDir(): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
}

function samplePcmChunk(): ArrayBuffer {
  const samples = new Int16Array(4096);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? 1200 : -1200;
  }
  return samples.buffer;
}

async function waitForCondition(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('voice integration', () => {
  let dataDir = '';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let db: VoiceStreamNextDb;
  let baseUrl = '';

  beforeEach(async () => {
    dataDir = tempDataDir();
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'finalize this transcript';
    const built = await buildApp({ logger: false });
    app = built.app;
    db = built.db;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    app.server.closeAllConnections?.();
    await app.close();
    db.db.close();
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
  });

  test('accepts device status updates over HTTP', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'android', displayName: 'Status Phone' }),
    }).then((response) => response.json());

    const statusResponse = await fetch(`${baseUrl}/api/devices/${registered.device.id}/status`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({
        token: registered.token,
        mode: 'awake',
        status: 'Ready for commands',
        microphone: 'Built-in mic',
        protocolVersion: 1,
        appVersion: 'android-test',
      }),
    });
    expect(statusResponse.status).toBe(200);
    const statusBody = await statusResponse.json();
    expect(statusBody.ok).toBe(true);
    expect(statusBody.status.mode).toBe('awake');
    expect(statusBody.status.status).toBe('Ready for commands');

    const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: devHeaders }).then((response) => response.json());
    expect(dashboard.clientStatuses.some((entry: any) => entry.deviceId === registered.device.id && entry.status === 'Ready for commands')).toBe(true);
  });

  test('defers backend speech while a connected voice client is recording', async () => {
    const originalFetch = globalThis.fetch;
    let socket: WebSocket | null = null;
    process.env.GROQ_TTS_API_KEY = 'test-tts-key';
    (globalThis as any).fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url ? String(input.url) : String(input);
      if (url.includes('/openai/v1/audio/speech')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/wav' },
        });
      }
      return originalFetch(input, init);
    };

    try {
      const registered = await fetch(`${baseUrl}/api/devices`, {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ deviceType: 'desktop', displayName: 'Speech Desktop' }),
      }).then((response) => response.json());
      const controlUrl = new URL(`/api/devices/${registered.device.id}/control`, baseUrl);
      controlUrl.protocol = 'ws:';
      controlUrl.searchParams.set('token', registered.token);
      const controlSocket = new WebSocket(controlUrl);
      socket = controlSocket;
      const messages: any[] = [];
      controlSocket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        messages.push(JSON.parse(event.data));
      });
      await new Promise<void>((resolve, reject) => {
        controlSocket.addEventListener('open', () => resolve());
        controlSocket.addEventListener('error', () => reject(new Error('control websocket failed to open')));
      });
      controlSocket.send(JSON.stringify({
        type: 'client_status',
        mode: 'recording',
        status: 'Recording voice request',
        microphone: 'Desktop microphone',
        protocolVersion: 1,
        appVersion: 'test',
        reportedAt: new Date().toISOString(),
      }));

      const user = db.userByClerkId('dev_voice_integration_example_local');
      expect(user).toBeTruthy();
      await waitForCondition('recording status', () =>
        db.listClientStatuses(user!.id).some((entry) => entry.deviceId === registered.device.id && entry.mode === 'recording'),
      );

      const thread = await fetch(`${baseUrl}/api/assistant/threads`, {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ title: 'Deferred speech thread', source: 'voice', voiceEnabled: true }),
      }).then((response) => response.json());
      await fetch(`${baseUrl}/api/assistant/threads/${thread.thread.id}/prompt`, {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ prompt: '/speak Wait until recording stops.' }),
      }).then((response) => response.json());

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(messages.some((message) => message.type === 'speech_audio')).toBe(false);

      controlSocket.send(JSON.stringify({
        type: 'client_status',
        mode: 'paused',
        status: 'Voice request paused',
        microphone: 'Desktop microphone',
        protocolVersion: 1,
        appVersion: 'test',
        reportedAt: new Date().toISOString(),
      }));
      await waitForCondition('deferred speech audio', () => messages.some((message) => message.type === 'speech_audio'));
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GROQ_TTS_API_KEY;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close();
    }
  });

  test('ignores voice frames while a desktop stream is paused', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'desktop', displayName: 'Paused Desktop' }),
    }).then((response) => response.json());

    const session = await fetch(`${baseUrl}/api/voice/sessions`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceId: registered.device.id, mode: 'clipboard' }),
    }).then((response) => response.json());

    const wsUrl = new URL('/api/voice/stream', baseUrl);
    wsUrl.protocol = 'ws:';
    wsUrl.searchParams.set('deviceId', registered.device.id);
    wsUrl.searchParams.set('token', registered.token);
    wsUrl.searchParams.set('sessionId', session.session.id);
    wsUrl.searchParams.set('mode', 'clipboard');

    const socket = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('websocket failed to open')));
      });
      socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'test', mode: 'clipboard' }));
      socket.send(JSON.stringify({ type: 'pause', reason: 'test pause' }));
      socket.send(samplePcmChunk());

      const user = db.userByClerkId('dev_voice_integration_example_local');
      expect(user).toBeTruthy();
      await waitForCondition('paused status', () =>
        db.listClientStatuses(user!.id).some((entry) => entry.deviceId === registered.device.id && entry.mode === 'paused'),
      );

      socket.send(JSON.stringify({ type: 'resume', reason: 'test resume' }));
      socket.send(samplePcmChunk());
      socket.send(JSON.stringify({ type: 'end' }));

      await waitForCondition('voice stream disconnected log', () =>
        db.listLogs(user!.id, 20).some((entry) => entry.message === 'Voice stream disconnected'),
      );
      const disconnected = db.listLogs(user!.id, 20).find((entry) => entry.message === 'Voice stream disconnected');
      const details = JSON.parse(disconnected?.detailsJson || '{}');
      expect(details.frames).toBe(1);
      expect(details.wallDurationMs).toBeGreaterThanOrEqual(details.durationMs);
      expect(details.pausedMs).toBeGreaterThanOrEqual(0);
    } finally {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  });

  test('enables newly registered extension tool routes for assistant use', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'desktop', displayName: 'Extension Desktop' }),
    }).then((response) => response.json());
    const user = db.userByClerkId('dev_voice_integration_example_local');
    expect(user).toBeTruthy();
    const repairedToolName = extensionToolName('drone-hub', 'repair_me');
    db.upsertAssistantExtensionToolRoute(user!.id, {
      toolName: repairedToolName,
      enabled: false,
      targetKind: 'device',
      targetDeviceId: registered.device.id,
    });

    const wsUrl = new URL(`/api/devices/${registered.device.id}/extensions`, baseUrl);
    wsUrl.protocol = 'ws:';
    wsUrl.searchParams.set('token', registered.token);
    wsUrl.searchParams.set('clientVersion', '12');

    const socket = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('extension websocket failed to open')));
      });
      socket.send(JSON.stringify({
        type: 'extension_hello',
        manifests: [{
          id: 'drone-hub',
          name: 'Drone Hub',
          version: '0.1.0',
          tools: [{
            name: 'list_drones',
            label: 'List drones',
            description: 'List local Drone Hub drones.',
            approval: 'never',
            supportedTargets: ['device', 'any_device'],
            defaultTarget: 'device',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          }, {
            name: 'repair_me',
            label: 'Repair me',
            description: 'Exercise old disabled route repair.',
            approval: 'never',
            supportedTargets: ['device', 'any_device'],
            defaultTarget: 'device',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          }, {
            name: 'server_only',
            label: 'Server only',
            description: 'Exercise server-target route defaults.',
            approval: 'never',
            supportedTargets: ['server'],
            defaultTarget: 'server',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          }],
        }],
      }));

      const toolName = extensionToolName('drone-hub', 'list_drones');
      const serverToolName = extensionToolName('drone-hub', 'server_only');
      await waitForCondition('extension route', () => Boolean(db.assistantExtensionToolRoute(user!.id, toolName)));
      const route = db.assistantExtensionToolRoute(user!.id, toolName);
      const repairedRoute = db.assistantExtensionToolRoute(user!.id, repairedToolName);
      const serverRoute = db.assistantExtensionToolRoute(user!.id, serverToolName);

      expect(route?.enabled).toBe(true);
      expect(route?.targetKind).toBe('device');
      expect(route?.targetDeviceId).toBe(registered.device.id);
      expect(repairedRoute?.enabled).toBe(true);
      expect(repairedRoute?.targetDeviceId).toBe(registered.device.id);
      expect(serverRoute?.enabled).toBe(false);
      expect(serverRoute?.targetKind).toBe('server');
    } finally {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  });

  test('auto-finishes patch streams when a finish phrase is detected during recording', async () => {
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = "Please capture this note, that's it.";

    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'desktop', displayName: 'Sleep Desktop' }),
    }).then((response) => response.json());

    const session = await fetch(`${baseUrl}/api/voice/sessions`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceId: registered.device.id, mode: 'patch' }),
    }).then((response) => response.json());

    const wsUrl = new URL('/api/voice/stream', baseUrl);
    wsUrl.protocol = 'ws:';
    wsUrl.searchParams.set('deviceId', registered.device.id);
    wsUrl.searchParams.set('token', registered.token);
    wsUrl.searchParams.set('sessionId', session.session.id);
    wsUrl.searchParams.set('mode', 'patch');

    const socket = new WebSocket(wsUrl);
    const speechChunk = samplePcmChunk();
    const silenceChunk = new ArrayBuffer(4096 * 2);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('websocket failed to open')));
      });
      socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'test', mode: 'patch' }));
      for (let index = 0; index < 8; index += 1) {
        socket.send(speechChunk);
      }
      for (let index = 0; index < 12; index += 1) {
        socket.send(silenceChunk);
      }

      const user = db.userByClerkId('dev_voice_integration_example_local');
      expect(user).toBeTruthy();
      await waitForCondition('auto-finalized transcript', () =>
        db.listTranscripts(user!.id, 20, { voiceSessionId: session.session.id }).length === 1,
      );

      const transcripts = db.listTranscripts(user!.id, 20, { voiceSessionId: session.session.id });
      expect(transcripts[0]?.text).toContain('Please capture this note');
    } finally {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'finalize this transcript';
    }
  });

  test('finalizes patch voice streams into stored transcripts and assistant threads', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'desktop', displayName: 'Patch Desktop' }),
    }).then((response) => response.json());

    const session = await fetch(`${baseUrl}/api/voice/sessions`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceId: registered.device.id, mode: 'patch' }),
    }).then((response) => response.json());

    const wsUrl = new URL('/api/voice/stream', baseUrl);
    wsUrl.protocol = 'ws:';
    wsUrl.searchParams.set('deviceId', registered.device.id);
    wsUrl.searchParams.set('token', registered.token);
    wsUrl.searchParams.set('sessionId', session.session.id);
    wsUrl.searchParams.set('mode', 'patch');

    const socket = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('websocket failed to open')));
      });
      socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'test', mode: 'patch' }));
      socket.send(samplePcmChunk());
      socket.send(JSON.stringify({ type: 'end' }));

      const user = db.userByClerkId('dev_voice_integration_example_local');
      expect(user).toBeTruthy();
      await waitForCondition('stored transcript', () => db.listTranscripts(user!.id, 20, { voiceSessionId: session.session.id }).length === 1);

      const transcripts = db.listTranscripts(user!.id, 20, { voiceSessionId: session.session.id });
      expect(transcripts[0]?.text).toBe('finalize this transcript');
      expect(transcripts[0]?.assistantThreadId).toBeTruthy();

      const messages = db.listMessages(user!.id, transcripts[0]!.assistantThreadId);
      expect(messages.some((message) => message.role === 'user' && message.content === 'finalize this transcript')).toBe(true);
    } finally {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  });

  test('exposes transcript filters on the transcripts API', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'android', displayName: 'Filter Phone' }),
    }).then((response) => response.json());
    const user = db.userByClerkId('dev_voice_integration_example_local');
    const session = db.createVoiceSession(user!.id, registered.device.id, 'assistant');
    db.addTranscript(user!.id, session.id, 'Filtered transcript line');

    const filtered = await fetch(`${baseUrl}/api/transcripts?deviceId=${encodeURIComponent(registered.device.id)}`, {
      headers: devHeaders,
    }).then((response) => response.json());
    expect(filtered.transcripts).toHaveLength(1);
    expect(filtered.transcripts[0]?.assistantThreadId).toBe(session.assistantThreadId);
    expect(filtered.transcripts[0]?.sessionStartedAt).toBeTruthy();
  });
});
