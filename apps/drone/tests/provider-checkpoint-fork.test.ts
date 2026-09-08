import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  forkOpenCodeCheckpoint,
  openCodeCheckpointForkScript,
} from '../src/hub/opencode-checkpoint-fork';
import { claudeCheckpointValidationScript } from '../src/hub/claude-checkpoint-fork';
import {
  parseBuiltinPromptJobTranscript,
  parseBuiltinPromptJobTranscriptLines,
  parseStructuredAgentJobTranscript,
} from '../src/hub/builtin-transcript-sessions';

const nodePath = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).stdout.trim();

describe('provider checkpoint metadata', () => {
  for (const agentId of ['claude', 'opencode'] as const) {
    test(`${agentId} keeps native IDs through daemon summaries, including truncated stdout`, async () => {
      const line = JSON.stringify(
        agentId === 'claude'
          ? {
              type: 'assistant',
              session_id: 'source',
              uuid: 'transcript-uuid',
              message: {
                id: 'api-id-not-the-checkpoint',
                content: [{ type: 'text', text: 'answer' }],
              },
            }
          : {
              type: 'text',
              sessionID: 'source',
              part: { id: 'part-not-the-checkpoint', messageID: 'transcript-uuid', text: 'answer' },
            },
      );
      for (const transcript of [
        parseBuiltinPromptJobTranscript(agentId, line),
        await parseBuiltinPromptJobTranscriptLines(agentId, [line]),
      ]) {
        const parsed = parseStructuredAgentJobTranscript(agentId, { transcript, stdout: '' });
        expect(parsed.providerCheckpoint).toEqual({
          agentId,
          sessionId: 'source',
          messageId: 'transcript-uuid',
        });
      }
    });
  }

  test('Claude ignores subagent replies and result UUIDs', () => {
    const transcript = parseBuiltinPromptJobTranscript(
      'claude',
      [
        {
          type: 'assistant',
          session_id: 'source',
          uuid: 'answer',
          message: { content: [{ type: 'text', text: 'main answer' }] },
        },
        {
          type: 'assistant',
          session_id: 'child',
          uuid: 'child-answer',
          parent_tool_use_id: 'tool',
          message: { content: [{ type: 'text', text: 'child answer' }] },
        },
        { type: 'result', session_id: 'source', uuid: 'result-uuid', result: 'main answer' },
      ]
        .map(JSON.stringify)
        .join('\n'),
    );
    expect(parseStructuredAgentJobTranscript('claude', { transcript }).providerCheckpoint).toEqual({
      agentId: 'claude',
      sessionId: 'source',
      messageId: 'answer',
    });
  });

  test('a later answer without a native ID cannot reuse an earlier checkpoint', () => {
    const transcript = parseBuiltinPromptJobTranscript(
      'opencode',
      [
        { type: 'text', sessionID: 'source', part: { messageID: 'old', text: 'first' } },
        { type: 'text', sessionID: 'source', part: { text: 'last' } },
      ]
        .map(JSON.stringify)
        .join('\n'),
    );
    expect(
      parseStructuredAgentJobTranscript('opencode', { transcript }).providerCheckpoint,
    ).toBeUndefined();
  });
});

describe('OpenCode checkpoint forks', () => {
  test('omits the cutoff to keep the final answer of an idle session', async () => {
    const api = openCodeHarness(false);
    expect(await forkOpenCodeCheckpoint(api.request, 'source', 'answer')).toBe('fork');
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({});
  });

  test('uses the next user message to exclude running work, keeping earlier tools/reasoning', async () => {
    const api = openCodeHarness(true);
    expect(await forkOpenCodeCheckpoint(api.request, 'source', 'answer')).toBe('fork');
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({
      messageID: 'new-user',
    });
    expect(api.calls.some((call) => call.path.includes('abort'))).toBe(false);
  });

  test('does not invoke the permissive API when the checkpoint is missing', async () => {
    const api = openCodeHarness(false);
    await expect(forkOpenCodeCheckpoint(api.request, 'source', 'missing')).rejects.toThrow(
      'no longer available',
    );
    expect(api.calls).toHaveLength(1);
  });

  for (const failure of ['tail-race', 'parts-changed', 'answer-excluded'] as const) {
    test(`rejects ${failure} before a prompt can be sent, cleaning up only the new fork`, async () => {
      const api = openCodeHarness(false, failure);
      await expect(forkOpenCodeCheckpoint(api.request, 'source', 'answer')).rejects.toThrow(
        'No prompt was sent',
      );
      expect(api.calls.filter((call) => call.method === 'DELETE')).toEqual([
        { path: '/session/fork', method: 'DELETE', body: undefined },
      ]);
    });
  }

  test('the portable helper fails safely if the provider binary is unavailable', () => {
    const result = spawnSync(nodePath, ['-e', openCodeCheckpointForkScript('source', 'answer')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '/nonexistent-checkpoint-test-bin' },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ENOENT');
  });

  test('the portable Node helper starts an authenticated server, verifies the fork, and stops it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-checkpoint-'));
    const binary = path.join(directory, 'opencode');
    const exitMarker = path.join(directory, 'stopped');
    fs.copyFileSync(
      path.join(import.meta.dir, 'fixtures', 'opencode-checkpoint-server.cjs'),
      binary,
    );
    fs.chmodSync(binary, 0o755);
    try {
      const result = spawnSync(nodePath, ['-e', openCodeCheckpointForkScript('source', 'answer')], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          CHECKPOINT_TEST_EXIT_MARKER: exitMarker,
        },
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('fork');
      expect(fs.readFileSync(exitMarker, 'utf8')).toBe('stopped');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Claude checkpoint validation in the provider environment', () => {
  test('accepts an inclusive assistant UUID in a running transcript without modifying it', () => {
    withClaudeTranscript((config, file, sessionId, messageId) => {
      const before = fs.readFileSync(file, 'utf8');
      const result = spawnSync(
        nodePath,
        ['-e', claudeCheckpointValidationScript(sessionId, messageId)],
        {
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_CONFIG_DIR: config },
        },
      );
      expect(result.status).toBe(0);
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
      expect(fs.readdirSync(path.dirname(file))).toHaveLength(1);
    });
  });

  test('rejects missing UUIDs, API message IDs, and user-message checkpoints', () => {
    withClaudeTranscript((config, file, sessionId) => {
      for (const messageId of [
        '33333333-3333-4333-8333-333333333333',
        'msg_api',
        '44444444-4444-4444-8444-444444444444',
      ]) {
        const result = spawnSync(
          nodePath,
          ['-e', claudeCheckpointValidationScript(sessionId, messageId)],
          {
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: config },
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('checkpoint');
      }
      expect(fs.readdirSync(path.dirname(file))).toHaveLength(1);
    });
  });
});

function openCodeHarness(
  running: boolean,
  failure?: 'tail-race' | 'parts-changed' | 'answer-excluded',
) {
  const original: any[] = [
    { info: { id: 'user', sessionID: 'source', role: 'user' }, parts: [] },
    {
      info: { id: 'answer', sessionID: 'source', role: 'assistant', parentID: 'user' },
      parts: [
        {
          id: 'p1',
          sessionID: 'source',
          messageID: 'answer',
          type: 'reasoning',
          text: 'stored reasoning',
        },
        {
          id: 'p2',
          sessionID: 'source',
          messageID: 'answer',
          type: 'tool',
          state: { status: 'completed', output: 'result' },
        },
        { id: 'p3', sessionID: 'source', messageID: 'answer', type: 'text', text: 'answer' },
      ],
    },
  ];
  const tail = { info: { id: 'new-user', sessionID: 'source', role: 'user' }, parts: [] };
  const calls: Array<{ path: string; method: string; body?: any }> = [];
  return {
    calls,
    request: async (endpoint: string, method = 'GET', body?: unknown) => {
      calls.push({ path: endpoint, method, body });
      if (method === 'DELETE') return true;
      if (method === 'POST') return { id: 'fork' };
      if (endpoint === '/session/source/message')
        return structuredClone(running ? [...original, tail] : original);
      const cloned = original.map((message) => ({
        info: {
          ...message.info,
          id: `fork-${message.info.id}`,
          sessionID: 'fork',
          ...(message.info.parentID ? { parentID: `fork-${message.info.parentID}` } : {}),
        },
        parts: message.parts.map((part: any) => ({
          ...part,
          id: `fork-${part.id}`,
          sessionID: 'fork',
          messageID: `fork-${part.messageID}`,
        })),
      }));
      if (failure === 'tail-race') cloned.push(tail);
      if (failure === 'parts-changed') cloned[1].parts[2].text = 'incorrect answer';
      if (failure === 'answer-excluded') cloned.pop();
      return cloned;
    },
  };
}

function withClaudeTranscript(
  run: (config: string, file: string, sessionId: string, messageId: string) => void,
) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-checkpoint-'));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const messageId = '22222222-2222-4222-8222-222222222222';
  const project = path.join(config, 'projects', '-work-project');
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, `${sessionId}.jsonl`);
  fs.writeFileSync(
    file,
    [
      JSON.stringify({
        uuid: messageId,
        type: 'assistant',
        sessionId,
        message: { id: 'msg_api', content: [{ type: 'text', text: 'answer' }] },
      }),
      JSON.stringify({
        uuid: '44444444-4444-4444-8444-444444444444',
        type: 'user',
        sessionId,
        message: { content: 'new user prompt' },
      }),
      '{"type":"assistant","unfinished":',
    ].join('\n'),
  );
  try {
    run(config, file, sessionId, messageId);
  } finally {
    fs.rmSync(config, { recursive: true, force: true });
  }
}
