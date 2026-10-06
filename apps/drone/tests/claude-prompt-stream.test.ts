import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  claudeStreamOwnsOutput,
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
  options: { idleCloseGraceMs?: number } = {},
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
        idleCloseGraceMs: options.idleCloseGraceMs,
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

// Mirrors what headless Claude emits: a task list on every change, then a
// notification and a self-started turn when a background task reports.
const FAKE_BACKGROUND_CLAUDE = `
  const lines = require('node:readline').createInterface({ input: process.stdin });
  const emit = (event) => console.log(JSON.stringify(event));
  const tasks = (list) => emit({ type: 'system', subtype: 'background_tasks_changed', tasks: list });
  const task = { task_id: 't1', task_type: 'local_bash', description: 'npm run dev' };
  lines.on('line', (line) => {
    const event = JSON.parse(line);
    emit({ type: 'system', subtype: 'init' });
    emit(event);
    const content = event.message.content;
    if (content === 'initial') tasks([task]);
    if (content === 'wake me') {
      setTimeout(() => {
        tasks([]);
        emit({ type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'Background command "npm run dev" completed' });
        emit({ type: 'system', subtype: 'init' });
        emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'woke up' }] } });
        emit({ type: 'result', subtype: 'success', result: 'woke up' });
      }, 50);
    }
    if (content === 'quiet end') setTimeout(() => tasks([]), 50);
    emit({ type: 'result', subtype: 'success', result: 'reply to ' + content });
  });
`;

test('background tasks keep the run alive and a self-started turn is recorded', async () => {
  await withRunner(FAKE_BACKGROUND_CLAUDE, async ({ stdoutPath, output, exited }) => {
    await waitUntil(async () => Boolean((await readClaudeStreamState(stdoutPath))?.resident));
    const resident = await readClaudeStreamState(stdoutPath);
    expect(resident?.backgroundTasks?.map((task) => task.description)).toEqual(['npm run dev']);
    expect(resident?.turns?.map((turn) => [turn.id, turn.ok])).toEqual([['initial', true]]);

    // A message sent to the idle run opens its own turn instead of a new process.
    expect(await steerClaudeStream(stdoutPath, 'second', 'wake me')).toBe(true);
    expect(await exited).toBe(0);

    const state = await readClaudeStreamState(stdoutPath);
    expect(state?.resident).toBe(false);
    expect(state?.backgroundTasks).toEqual([]);
    expect(state?.turns?.map((turn) => [turn.id, turn.messageIds, turn.wake?.summaries])).toEqual([
      ['initial', ['initial'], undefined],
      ['second', ['second'], undefined],
      ['initial-wake-1', [], ['Background command "npm run dev" completed']],
    ]);
    const bytes = Buffer.from(output(), 'utf8');
    const slice = (index: number) => {
      const turn = state!.turns![index]!;
      return bytes.subarray(turn.start, turn.end).toString('utf8');
    };
    expect(slice(0)).toContain('reply to initial');
    expect(slice(0)).not.toContain('reply to wake me');
    expect(slice(1)).toContain('reply to wake me');
    expect(slice(1)).not.toContain('woke up');
    expect(slice(2)).toContain('woke up');
    expect(slice(2).startsWith('{"type":"system","subtype":"init"}')).toBe(true);
    expect(claudeStreamOwnsOutput(state, 'second')).toBe(true);
    expect(claudeStreamOwnsOutput(state, 'initial-wake-1')).toBe(true);
  });
});

test('a run whose tasks end without waking Claude closes after the grace period', async () => {
  await withRunner(
    FAKE_BACKGROUND_CLAUDE,
    async ({ stdoutPath, exited }) => {
      await waitUntil(async () => Boolean((await readClaudeStreamState(stdoutPath))?.resident));
      expect(await steerClaudeStream(stdoutPath, 'second', 'quiet end')).toBe(true);
      expect(await exited).toBe(0);
      const state = await readClaudeStreamState(stdoutPath);
      expect(state?.turns?.map((turn) => turn.id)).toEqual(['initial', 'second']);
      expect(await steerClaudeStream(stdoutPath, 'late', 'too late')).toBe(false);
    },
    { idleCloseGraceMs: 100 },
  );
});

// Mid-turn reports and Monitor-style wake-ups, as observed from headless Claude.
const FAKE_MID_TURN_CLAUDE = `
  const lines = require('node:readline').createInterface({ input: process.stdin });
  const emit = (event) => console.log(JSON.stringify(event));
  const tasks = (list) => emit({ type: 'system', subtype: 'background_tasks_changed', tasks: list });
  const dev = { task_id: 'dev', task_type: 'local_bash', description: 'npm run dev' };
  const quick = { task_id: 'quick', task_type: 'local_bash', description: 'npm test' };
  const notify = (summary) => emit({ type: 'system', subtype: 'task_notification', summary });
  lines.on('line', (line) => {
    const event = JSON.parse(line);
    const content = event.message.content;
    emit({ type: 'system', subtype: 'init' });
    emit(event);
    if (content === 'initial') {
      // A quick task reports while the turn runs, and the turn handles it.
      tasks([dev, quick]);
      notify('npm test completed');
      tasks([dev]);
      emit({ type: 'result', subtype: 'success', result: 'handled npm test' });
      // Later a watch event wakes Claude with no report of its own.
      setTimeout(() => {
        emit({ type: 'system', subtype: 'init' });
        emit({ type: 'result', subtype: 'success', result: 'saw dev output' });
        tasks([]);
      }, 50);
      return;
    }
    // A task ends during the turn, but Claude only wakes for it afterwards.
    tasks([quick]);
    notify('npm test completed');
    tasks([]);
    emit({ type: 'result', subtype: 'success', result: 'reply' });
    setTimeout(() => {
      emit({ type: 'system', subtype: 'init' });
      emit({ type: 'result', subtype: 'success', result: 'late wake' });
    }, 50);
  });
`;

test('a report handled mid-turn does not label a later wake-up, which names its task instead', async () => {
  await withRunner(
    FAKE_MID_TURN_CLAUDE,
    async ({ stdoutPath, exited }) => {
      await waitUntil(async () => ((await readClaudeStreamState(stdoutPath))?.turns?.length ?? 0) >= 2);
      const state = await readClaudeStreamState(stdoutPath);
      expect(state?.turns?.map((turn) => [turn.id, turn.wake?.summaries])).toEqual([
        ['initial', undefined],
        ['initial-wake-1', ['"npm run dev" reported']],
      ]);
      expect(await exited).toBe(0);
    },
    { idleCloseGraceMs: 100 },
  );
});

test('a wake-up right after a turn whose task ended in it is still recorded', async () => {
  const fake = FAKE_MID_TURN_CLAUDE.replace("content === 'initial'", "content === 'never'");
  await withRunner(fake, async ({ stdoutPath, exited }) => {
    expect(await exited).toBe(0);
    const state = await readClaudeStreamState(stdoutPath);
    expect(state?.turns?.map((turn) => [turn.id, turn.ok, turn.wake?.summaries])).toEqual([
      ['initial', true, undefined],
      ['initial-wake-1', true, ['npm test completed']],
    ]);
  });
});
