import { expect, test } from 'bun:test';

import {
  CodexPromptRunManager,
  type CodexPromptRun,
} from '../src/codex-prompt-run-manager';

test('restart recovery preserves a canceled outcome from the durable transcript', async () => {
  const message: any = {
    id: 'message-1',
    state: 'running',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    codexAppServer: { runId: 'run-1', sessionKey: 'session-1' },
  };
  const run: CodexPromptRun = {
    id: 'run-1',
    sessionKey: 'session-1',
    state: 'running',
    messageIds: [message.id],
    responseMessageId: message.id,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    stdoutPath: '/tmp/run-1.stdout',
    stderrPath: '/tmp/run-1.stderr',
    transcript: {
      kind: 'codex',
      message: null,
      threadId: 'thread-1',
      terminalEvent: 'turn.completed',
      terminalStatus: 'canceled',
    },
  };
  let savedRun: CodexPromptRun | null = null;
  let savedMessage: any = null;
  const manager = new CodexPromptRunManager<any>({
    loadMessage: async () => message,
    saveMessage: async (next) => {
      savedMessage = next;
    },
    createRun: async () => run,
    loadRun: async () => run,
    saveRun: async (next) => {
      savedRun = next;
    },
    appendRunEvents: async (current) => current,
    appendRunStderr: async () => {},
    mutate: async (operation) => await operation(),
    now: () => '2026-09-03T00:01:00.000Z',
  });

  await manager.failInterrupted(message, 'daemon restarted');

  expect(savedRun).toMatchObject({ state: 'canceled', pendingApprovals: [] });
  expect(savedMessage).toMatchObject({ state: 'canceled', exitCode: 1 });
});
