import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  claudeStreamPaths,
  claudeStreamRunnerScript,
  readClaudeStreamState,
  steerClaudeStream,
} from '../src/claude-prompt-stream';

async function waitUntil(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Claude stream');
    await Bun.sleep(10);
  }
}

async function withRunner(
  fakeScript: string,
  run: (h: {
    stdoutPath: string;
    output: () => string;
    exited: Promise<number | null>;
  }) => Promise<void>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-stream-test-'));
  const stdoutPath = path.join(directory, 'stdout');
  const child = spawn(
    'node',
    [
      '-e',
      claudeStreamRunnerScript({
        cmd: 'node',
        args: ['-e', fakeScript],
        id: 'initial',
        prompt: 'initial',
        ...claudeStreamPaths(stdoutPath),
      }),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let error = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    error += chunk;
  });
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
  try {
    await waitUntil(
      async () => Boolean(await readClaudeStreamState(stdoutPath)) || child.exitCode !== null,
    );
    if (child.exitCode !== null) throw new Error(error);
    await run({ stdoutPath, output: () => output, exited });
  } finally {
    child.kill();
    await exited;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('an intermediate result does not close stdin before a pending follow-up is consumed', async () => {
  await withRunner(
    `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    const emit = (event) => console.log(JSON.stringify(event));
    lines.on('line', (line) => {
      const event = JSON.parse(line);
      if (event.message.content === 'initial') { emit(event); return; }
      emit({ type: 'result', subtype: 'success', result: 'initial finished' });
      setTimeout(() => {
        emit(event);
        emit({ type: 'result', subtype: 'success', result: 'follow-up finished' });
      }, 100);
    });
  `,
    async ({ stdoutPath, output, exited }) => {
      expect(await steerClaudeStream(stdoutPath, 'follow-up', 'correction')).toBe(true);
      expect(await steerClaudeStream(stdoutPath, 'follow-up', 'correction')).toBe(true);
      expect(await exited).toBe(0);
      expect(output()).toContain('follow-up finished');
      expect(output().match(/"content":"correction"/g)).toHaveLength(1);
      // A retry after process exit uses the durable receipt, not another process.
      expect(await steerClaudeStream(stdoutPath, 'follow-up', 'correction')).toBe(true);
      expect(await steerClaudeStream(stdoutPath, 'too-late', 'next turn')).toBe(false);
    },
  );
});

test('a result from a subagent cannot finish the parent stream', async () => {
  await withRunner(
    `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', (line) => {
      const event = JSON.parse(line);
      console.log(line);
      console.log(JSON.stringify({ type: 'result', subtype: 'success', parent_tool_use_id: 'child', result: 'subagent' }));
      if (event.message.content === 'correction') console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'parent' }));
    });
  `,
    async ({ stdoutPath, output, exited }) => {
      await waitUntil(() => output().includes('subagent'));
      expect(await steerClaudeStream(stdoutPath, 'follow-up', 'correction')).toBe(true);
      expect(await exited).toBe(0);
      expect(output()).toContain('parent');
    },
  );
});

test('an exit before acknowledging an accepted prompt fails the run', async () => {
  await withRunner(
    `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', () => {
      console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'old response' }));
      setTimeout(() => process.exit(0), 50);
    });
  `,
    async ({ exited }) => {
      expect(await exited).toBe(1);
    },
  );
});
