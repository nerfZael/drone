import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { createChatPromptRouteHandler } from '../src/hub/routes/chat-prompt-routes';
import { normalizeChatImageAttachments } from '../src/hub/chat-attachments';

async function submit(options: { starting?: boolean; draft?: boolean; attachments?: unknown[] }) {
  const calls: Array<{ operation: string; input: any }> = [];
  const chat = { id: 'chat-id', draft: options.draft === true };
  const handler = createChatPromptRouteHandler({
    createRequestTimer: () => ({ mark() {}, setHeader() {} }),
    logSlowHubRequest() {},
    normalizeChatImageAttachments,
    normalizeChatName: (name: string) => name,
    normalizeSubmittedAtIso: () => '2026-09-05T20:00:00.000Z',
    isSafePromptId: () => true,
    resolveDroneOrPendingForReadRef: () => {
      throw new Error('Must not project fleet history');
    },
    resolveCanonicalDroneOrPendingForReadRef: async () =>
      options.starting
        ? { id: 'drone-id', kind: 'pending', pending: { name: 'Starting' } }
        : { id: 'drone-id', kind: 'real', drone: { name: 'Ready' } },
    readChatMetadataFromStore: () => ({ chat }),
    shouldAutoRenameChatOnPrompt: async ({ chatEntry }: any) => {
      expect(chatEntry).toBe(chat);
      return false;
    },
    isDraftChatEntry: (entry: any) => entry?.draft === true,
    createOrEnqueuePromptUnified: async (input: any) => {
      calls.push({ operation: 'active', input });
      return { kind: 'enqueued', id: input.id, pendingState: 'queued' };
    },
    pushPendingStartupPrompt: async (input: any) => {
      calls.push({ operation: 'starting', input });
      return 'queued';
    },
    pushPendingPrompt: async (input: any) => {
      calls.push({ operation: 'draft', input });
    },
  } as any);
  let response: any;
  const res = {
    statusCode: 0,
    setHeader() {},
    end(value: string) {
      response = JSON.parse(value);
    },
  };
  const req = Readable.from([
    Buffer.from(
      JSON.stringify({
        prompt: 'Hello',
        promptId: 'stable-request-id',
        attachments: options.attachments,
      }),
    ),
  ]);
  Object.assign(req, { headers: {} });
  await handler({
    req: req as any,
    res: res as any,
    method: 'POST',
    parts: ['api', 'drones', 'drone-id', 'chats', 'default', 'prompt'],
    url: new URL('http://hub.test/api/drones/drone-id/chats/default/prompt'),
  });
  expect(res.statusCode).toBe(202);
  expect(response).toMatchObject({ accepted: true, promptId: 'stable-request-id' });
  expect(response.draft).toBe(options.draft === true);
  if (options.draft) expect(response.executionStatus).toBe('held_in_draft');
  return calls;
}

describe('prompt acceptance without fleet history', () => {
  test('accepts an existing chat message using only lifecycle and chat metadata', async () => {
    expect(await submit({})).toMatchObject([
      { operation: 'active', input: { id: 'stable-request-id' } },
    ]);
  });
  test('preserves draft queuing when lifecycle records have no chat projection', async () => {
    expect(await submit({ draft: true })).toMatchObject([{ operation: 'draft' }]);
  });
  test('accepts attachments while starting with the same durable request id', async () => {
    const calls = await submit({
      starting: true,
      attachments: [{ name: 'note.txt', mime: 'text/plain', dataBase64: 'SGVsbG8=' }],
    });
    expect(calls).toMatchObject([
      {
        operation: 'starting',
        input: {
          attachments: [{ name: 'note.txt', dataBase64: 'SGVsbG8=' }],
          pending: { id: 'stable-request-id', prompt: 'Hello' },
        },
      },
    ]);
  });
});

describe('plain files uploaded ahead of the prompt', () => {
  test('the upload route keeps the file and the prompt route hands it on by path', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { configureChatAttachmentUploads } = await import('../src/hub/chat-attachments');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-upload-route-'));
    configureChatAttachmentUploads(dir);
    try {
      const handler = createChatPromptRouteHandler({ normalizeChatImageAttachments } as any);
      let uploaded: any;
      const req = Readable.from([Buffer.alloc(7 * 1024 * 1024, 1)]);
      Object.assign(req, { headers: {} });
      await handler({
        req: req as any,
        res: {
          statusCode: 0,
          setHeader() {},
          end(value: string) {
            uploaded = JSON.parse(value);
          },
        } as any,
        method: 'POST',
        parts: ['api', 'chat-attachment-uploads'],
        url: new URL('http://hub.test/api/chat-attachment-uploads?name=trace.zip&mime=application%2Fzip'),
      });
      expect(uploaded).toMatchObject({ ok: true, name: 'trace.zip', size: 7 * 1024 * 1024 });

      const calls = await submit({
        attachments: [{ name: 'trace.zip', mime: 'application/zip', uploadId: uploaded.uploadId }],
      });
      expect(calls).toMatchObject([
        {
          operation: 'active',
          input: {
            attachments: [
              { name: 'trace.zip', size: 7 * 1024 * 1024, sourcePath: path.join(dir, uploaded.uploadId) },
            ],
          },
        },
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
