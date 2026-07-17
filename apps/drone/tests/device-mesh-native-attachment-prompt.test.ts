import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDroneControlCapability } from '../src/hub/device-mesh/drone-control-capability';
import { MeshChatAttachmentStore } from '../src/hub/device-mesh/mesh-chat-attachment-store';

describe('device mesh native image prompts', () => {
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
      await capability.invoke(
        'chat.prompt',
        {
          droneId: 'drone-1',
          chatName: 'default',
          attachmentTransfer: {
            action: 'write',
            uploadId: prepared.uploadId,
            offset: 0,
            dataBase64: Buffer.from('image').toString('base64'),
          },
        },
        context,
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
      });
    } finally {
      globalThis.fetch = originalFetch;
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
