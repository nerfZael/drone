import { Readable } from 'node:stream';
import type http from 'node:http';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDroneControlCapability } from '../src/hub/device-mesh/drone-control-capability';
import { MeshChatAttachmentStore } from '../src/hub/device-mesh/mesh-chat-attachment-store';
import { submitNativeChatPrompt } from '../src/hub/device-mesh/native-chat-prompt';

describe('device mesh native attachment prompts', () => {
  test('submits a committed mesh upload by id without putting image bytes in the prompt request', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-native-prompt-'));
    const store = new MeshChatAttachmentStore(root);
    const originalFetch = globalThis.fetch;
    let promptBody: any = null;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/drones/drone-1/chats/default'))
        return Response.json({ ok: true, agent: { kind: 'native' } });
      if (url.endsWith('/api/drones/drone-1/chats/default/native'))
        return Response.json({ ok: true, nativeChatId: 'native-1' });
      if (url.endsWith('/api/assistant/threads/native-1/prompt')) {
        promptBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response('{"type":"queued","prompt":{"id":"queued-1"}}\n');
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability(
        { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
        store,
        { transfers: { attachmentUrl: () => 'https://peer/upload' } } as any,
      );
      const context = { sourceDevice: { id: 'phone-1' } } as never;
      const prepared: any = await capability.invoke(
        'chat.prompt',
        {
          droneId: 'drone-1',
          chatName: 'default',
          attachmentTransfer: {
            action: 'prepare',
            name: 'photo.png',
            mime: 'image/png',
            size: 5,
          },
        },
        context,
      );
      await store.writeHttp(
        prepared.uploadId,
        prepared.uploadToken,
        0,
        Readable.from([Buffer.from('image')]) as http.IncomingMessage,
      );
      await capability.invoke(
        'chat.prompt',
        {
          droneId: 'drone-1',
          chatName: 'default',
          attachmentTransfer: { action: 'commit', uploadId: prepared.uploadId },
        },
        context,
      );
      await expect(
        capability.invoke(
          'chat.prompt',
          {
            droneId: 'drone-1',
            chatName: 'default',
            prompt: '',
            attachmentIds: [prepared.uploadId],
            deliveryMode: 'asap',
            promptId: 'mobile-voice-session.2',
          },
          context,
        ),
      ).resolves.toMatchObject({ accepted: true, nativeChatId: 'native-1' });
      expect(promptBody).toEqual({
        prompt: '',
        attachments: [
          {
            disposition: 'prompt',
            name: 'photo.png',
            mime: 'image/png',
            dataBase64: Buffer.from('image').toString('base64'),
          },
        ],
        deliveryMode: 'asap',
        promptId: 'mobile-voice-session.2',
      });
    } finally {
      globalThis.fetch = originalFetch;
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('submits non-image attachments as native chat artifacts', async () => {
    const originalFetch = globalThis.fetch;
    let promptBody: any = null;
    globalThis.fetch = (async (_input, init) => {
      promptBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response('{"type":"accepted"}\n');
    }) as typeof fetch;
    try {
      await submitNativeChatPrompt(
        { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
        'native-1',
        'Review this file',
        [
          {
            name: 'status.ts',
            mime: 'text/plain',
            dataBase64: Buffer.from('export const ready = true;').toString('base64'),
          },
        ],
        'asap',
        'Europe/Zagreb',
        'mobile-voice-session.3',
      );
      expect(promptBody.attachments).toEqual([
        {
          disposition: 'artifact',
          name: 'status.ts',
          mime: 'text/plain',
          dataBase64: Buffer.from('export const ready = true;').toString('base64'),
        },
      ]);
      expect(promptBody).toMatchObject({
        deliveryMode: 'asap',
        userTimeZone: 'Europe/Zagreb',
        promptId: 'mobile-voice-session.3',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
