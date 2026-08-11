import { describe, expect, test } from 'bun:test';
import {
  boundLocalAssistantMessages,
  parseLocalAssistantThreads,
} from '../src/local-assistant/local-assistant-storage';

function transferDetails(fileCount: number, pathLength: number) {
  return {
    type: 'workspace_transfer',
    phase: 'failed',
    source: { targetId: 'source', targetLabel: 'Source', path: 'folder' },
    destination: {
      targetId: 'destination',
      targetLabel: 'Destination',
      path: 'copied-folder',
    },
    fileCount,
    completedFiles: Math.floor(fileCount / 2),
    totalBytes: fileCount * 100,
    transferredBytes: Math.floor(fileCount / 2) * 100,
    retries: 1,
    failure: { error: 'connection failed', resumable: true },
    files: Array.from({ length: fileCount }, (_, index) => ({
      sourcePath: `folder/${String(index)}-${'x'.repeat(pathLength)}.txt`,
      destinationPath: `copied/${String(index)}-${'y'.repeat(pathLength)}.txt`,
      size: 100,
      transferredBytes: index < fileCount / 2 ? 100 : 0,
      retries: 0,
      status:
        index < fileCount / 2
          ? 'completed'
          : index === Math.floor(fileCount / 2)
            ? 'failed'
            : 'pending',
    })),
  };
}

describe('local assistant storage', () => {
  test('keeps legacy threads compatible with the native chat store', () => {
    const threads = parseLocalAssistantThreads(
      JSON.stringify([
        {
          id: 'legacy-thread',
          title: 'Existing conversation',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          model: 'gpt-5',
          thinkingLevel: 'medium',
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: 'Do not lose this',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ]),
    );

    expect(threads).toHaveLength(1);
    expect(threads?.[0]).toMatchObject({
      id: 'legacy-thread',
      title: 'Existing conversation',
      agentPermissionMode: 'execute',
      approvalPolicy: 'ask',
      autoApprove: false,
      messages: [{ id: 'message-1', content: 'Do not lose this' }],
    });
  });

  test('prefers an explicit approval policy over a stale legacy auto-approve flag', () => {
    const threads = parseLocalAssistantThreads(
      JSON.stringify([
        {
          id: 'policy-thread',
          title: 'Policy',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          model: 'gpt-5',
          thinkingLevel: 'medium',
          approvalPolicy: 'ask',
          autoApprove: true,
          messages: [],
        },
      ]),
    );

    expect(threads?.[0]).toMatchObject({
      approvalPolicy: 'ask',
      autoApprove: false,
    });
  });

  test('preserves a blocked queue interruption across app restarts', () => {
    const threads = parseLocalAssistantThreads(
      JSON.stringify([
        {
          id: 'interrupted-thread',
          title: 'Interrupted',
          model: 'gpt-5',
          thinkingLevel: 'medium',
          messages: [],
          queuedPrompts: [],
          queueInterruption: {
            state: 'blocked',
            at: '2026-08-11T09:00:00.000Z',
          },
          interruptedPromptId: 'mobile_message_interrupted',
        },
      ]),
    );

    expect(threads?.[0]).toMatchObject({
      queueInterruption: {
        state: 'blocked',
        at: '2026-08-11T09:00:00.000Z',
      },
      interruptedPromptId: 'mobile_message_interrupted',
    });
  });

  test('preserves transfer progress beyond the generic tool detail limit', () => {
    const details = transferDetails(100, 20);
    const messages = boundLocalAssistantMessages([
      {
        id: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        role: 'user',
        content: 'Transfer files',
      },
      {
        id: 'tool',
        createdAt: '2026-01-01T00:00:01.000Z',
        role: 'toolResult',
        toolCallId: 'call_transfer',
        toolName: 'transfer_files',
        isError: true,
        content: [{ type: 'text', text: 'Transfer failed' }],
        details,
      },
    ]);

    expect(messages[1].details).toMatchObject({
      type: 'workspace_transfer',
      fileCount: 100,
    });
    expect((messages[1].details as any).files).toHaveLength(100);
  });

  test('keeps prompt images in memory but stores only bounded attachment metadata', () => {
    const imageMessage = {
      id: 'image-message',
      createdAt: '2026-07-18T00:00:00.000Z',
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this' },
        { type: 'image', data: 'a'.repeat(1_000_000), mimeType: 'image/png' },
      ],
    };

    expect((boundLocalAssistantMessages([imageMessage])[0]?.content as any[])[1]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
    });

    const stored = parseLocalAssistantThreads(
      JSON.stringify([
        {
          id: 'thread-with-image',
          title: 'Image thread',
          model: 'gpt-test',
          thinkingLevel: 'low',
          messages: [imageMessage],
          queuedPrompts: [],
        },
      ]),
    );
    expect(stored?.[0]?.messages[0]?.content).toEqual([{ type: 'text', text: 'Inspect this' }]);
    expect(stored?.[0]?.messages[0]?.details).toMatchObject({
      attachments: [{ mime: 'image/png' }],
    });
  });

  test('does not count in-memory image data against the transcript text limit', () => {
    const messages = boundLocalAssistantMessages([
      {
        id: 'image-message',
        createdAt: '2026-07-18T00:00:00.000Z',
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this' },
          { type: 'image', data: 'a'.repeat(1_000_000), mimeType: 'image/png' },
        ],
      },
      {
        id: 'assistant-message',
        createdAt: '2026-07-18T00:00:01.000Z',
        role: 'assistant',
        content: 'The image looks good.',
      },
    ]);

    expect(messages.map((message) => message.id)).toEqual(['image-message', 'assistant-message']);
  });

  test('keeps an actionable bounded manifest for exceptionally large paths', () => {
    const details = transferDetails(500, 2_000);
    const messages = boundLocalAssistantMessages([
      {
        id: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        role: 'user',
        content: 'Transfer files',
      },
      {
        id: 'tool',
        createdAt: '2026-01-01T00:00:01.000Z',
        role: 'toolResult',
        toolCallId: 'call_transfer',
        toolName: 'transfer_files',
        isError: true,
        content: [{ type: 'text', text: 'Transfer failed' }],
        details,
      },
    ]);

    expect(messages[1].details).toMatchObject({
      type: 'workspace_transfer',
      fileCount: 500,
      filesTruncated: 439,
    });
    expect((messages[1].details as any).files.some((file: any) => file.status === 'failed')).toBe(
      true,
    );
  });
});
