import { describe, expect, test } from 'bun:test';
import { boundLocalAssistantMessages } from '../src/local-assistant/local-assistant-storage';

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
      status: index < fileCount / 2 ? 'completed' : index === Math.floor(fileCount / 2) ? 'failed' : 'pending',
    })),
  };
}

describe('local assistant storage', () => {
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
