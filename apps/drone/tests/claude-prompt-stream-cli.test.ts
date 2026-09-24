import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  claudeStreamPaths,
  claudeStreamRunnerScript,
  steerClaudeStream,
} from '../src/claude-prompt-stream';

// Opt-in protocol smoke test against the installed CLI. All model requests go
// to a local fake Anthropic endpoint; no account credentials or paid calls.
const cliTest = process.env.DRONE_TEST_CLAUDE_CLI === '1' ? test : test.skip;
cliTest(
  'installed Claude consumes ASAP input before its next tool-loop model request',
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cli-stream-'));
    const stdoutPath = path.join(directory, 'stdout');
    const firstRequest = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const requests: any[] = [];
    const server = http.createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || '{}');
      if (request.url?.includes('count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":10}');
        return;
      }
      if (!request.url?.includes('/messages')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      requests.push(body);
      const first = requests.length === 1;
      if (first) {
        firstRequest.resolve();
        await releaseFirst.promise;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (event: any) =>
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      emit({
        type: 'message_start',
        message: {
          id: `msg_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      emit({
        type: 'content_block_start',
        index: 0,
        content_block: first
          ? { type: 'tool_use', id: 'tool_1', name: 'Bash', input: {} }
          : { type: 'text', text: '' },
      });
      emit({
        type: 'content_block_delta',
        index: 0,
        delta: first
          ? {
              type: 'input_json_delta',
              partial_json: JSON.stringify({ command: "printf 'stream-tool-ok'" }),
            }
          : { type: 'text_delta', text: 'ASAP received' },
      });
      emit({ type: 'content_block_stop', index: 0 });
      emit({
        type: 'message_delta',
        delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 10 },
      });
      emit({ type: 'message_stop' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const child = spawn(
      'node',
      [
        '-e',
        claudeStreamRunnerScript({
          cmd: 'claude',
          args: [
            '--bare',
            '--print',
            '--input-format',
            'stream-json',
            '--output-format',
            'stream-json',
            '--verbose',
            '--replay-user-messages',
            '--no-session-persistence',
            '--setting-sources',
            '',
            '--strict-mcp-config',
            '--mcp-config',
            '{"mcpServers":{}}',
            '--tools',
            'Bash',
            '--dangerously-skip-permissions',
            '--system-prompt',
            'Follow the user request.',
            '--model',
            'claude-sonnet-4-6',
          ],
          id: 'initial',
          prompt: 'Run the test command.',
          ...claudeStreamPaths(stdoutPath),
        }),
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CLAUDE_CONFIG_DIR: path.join(directory, 'config'),
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_API_KEY: 'fake-test-key',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          IS_SANDBOX: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CLI timed out: ${stderr}\n${output}`)),
        20_000,
      );
      timer.unref();
      void exited.then(() => clearTimeout(timer));
    });
    try {
      await Promise.race([
        firstRequest.promise,
        timeout,
        exited.then((code) => {
          throw new Error(`CLI exited ${code}: ${stderr}\n${output}`);
        }),
      ]);
      expect(
        await steerClaudeStream(stdoutPath, 'follow-up', 'ASAP correction: report success.'),
      ).toBe(true);
      releaseFirst.resolve();
      const code = await Promise.race([exited, timeout]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(requests[1].messages)).toContain('ASAP correction: report success.');
      expect(output).toContain('ASAP received');
    } finally {
      releaseFirst.resolve();
      child.kill();
      await exited;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
