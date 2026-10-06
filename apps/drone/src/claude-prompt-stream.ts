import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export type ClaudePromptStream = {
  sessionKey: string;
  compatibilityKey: string;
  prompt: string;
  runId?: string;
  outputOwner?: boolean;
  /** The turn holding this job's message; its output and usage are the job's. */
  turnId?: string;
  /** Set on jobs the daemon creates for turns Claude started on its own. */
  wake?: { summaries: string[] };
  /** Set on a run's first job once its process is gone for good. */
  processEnded?: boolean;
};

/**
 * One agent turn inside a stream run. A run outlives its first turn while
 * Claude holds background tasks, which wake it into turns of its own.
 */
export type ClaudeStreamTurn = {
  /** The prompt job that owns the turn: its first message, or a wake id. */
  id: string;
  /** Byte range of the turn in the run's stdout; `end` is set by its result. */
  start: number;
  end?: number;
  ok?: boolean;
  /** Accepted user messages, in delivery order. Empty for an unsteered wake. */
  messageIds: string[];
  /** Present when Claude started the turn itself for a background task. */
  wake?: { summaries: string[] };
};

export type ClaudeBackgroundTask = {
  id: string;
  type: string;
  description: string;
  startedAt: string;
};

export type ClaudeStreamState = {
  messageIds: string[];
  responseMessageId: string;
  turns?: ClaudeStreamTurn[];
  backgroundTasks?: ClaudeBackgroundTask[];
  /** True while the run is idle but kept alive for its background tasks. */
  resident?: boolean;
};

export function claudeStreamTurnForJob(
  state: ClaudeStreamState | null,
  jobId: string,
): ClaudeStreamTurn | null {
  return state?.turns?.find((turn) => turn.id === jobId || turn.messageIds.includes(jobId)) ?? null;
}

/** The job whose message the turn answers; older states predate turns. */
export function claudeStreamOwnsOutput(state: ClaudeStreamState | null, jobId: string): boolean {
  if (!state) return true;
  const turn = claudeStreamTurnForJob(state, jobId);
  if (!turn) return state.responseMessageId === jobId;
  return (turn.messageIds.at(-1) ?? turn.id) === jobId;
}

export function claudeStreamPaths(stdoutPath: string) {
  const hash = crypto.createHash('sha256').update(stdoutPath).digest('hex').slice(0, 32);
  return {
    socketPath: path.join(os.tmpdir(), `drone-claude-${hash}.sock`),
    statePath: `${stdoutPath}.claude-stream.json`,
  };
}

export async function readClaudeStreamState(stdoutPath: string): Promise<ClaudeStreamState | null> {
  try {
    return JSON.parse(await fs.readFile(claudeStreamPaths(stdoutPath).statePath, 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** A durable receipt also resolves a lost HTTP reply, including after daemon restart. */
export async function steerClaudeStream(
  stdoutPath: string,
  id: string,
  prompt: string,
): Promise<boolean> {
  if ((await readClaudeStreamState(stdoutPath))?.messageIds.includes(id)) return true;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: claudeStreamPaths(stdoutPath).socketPath,
          path: '/',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            if (response.statusCode === 200) resolve(true);
            else if (response.statusCode === 409) resolve(false);
            else reject(new Error(`Claude stream delivery failed: ${response.statusCode}`));
          });
        },
      );
      request.on('error', reject);
      request.setTimeout(3_000, () =>
        request.destroy(new Error('Claude stream delivery timed out')),
      );
      request.end(JSON.stringify({ id, prompt }));
    });
  } catch (error: any) {
    if ((await readClaudeStreamState(stdoutPath))?.messageIds.includes(id)) return true;
    if (
      error?.code === 'ENOENT' ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'FailedToOpenSocket'
    )
      return false;
    // An ambiguous delivery must be retried with the same id, never relaunched.
    throw error;
  }
}

type RunnerConfig = {
  cmd: string;
  args: string[];
  id: string;
  prompt: string;
  socketPath: string;
  statePath: string;
  /** Test hook; production uses the runner default. */
  idleCloseGraceMs?: number;
};

// Self-contained because this runs under the durable tmux wrapper, independently
// of the daemon. Keep all dependencies inside the function for serialization.
function runClaudeStream(config: RunnerConfig) {
  const fs = require('node:fs') as typeof import('node:fs');
  const http = require('node:http') as typeof import('node:http');
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const readline = require('node:readline') as typeof import('node:readline');
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  // Claude ends a turn with background tasks still running and wakes itself
  // when they report. A task that ends without waking Claude must not keep
  // the run alive forever, so an idle run without tasks closes after a grace.
  const IDLE_CLOSE_GRACE_MS = config.idleCloseGraceMs ?? 15_000;
  const MAX_CLOSED_TURNS = 100;
  const child = spawn(config.cmd, config.args, {
    env: { ...process.env, DRONE_CLAUDE_STREAM: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  type Turn = ClaudeStreamTurn;
  const accepted = new Set<string>();
  const unacknowledged = new Set<string>();
  const turns: Turn[] = [];
  const tasks = new Map<string, ClaudeBackgroundTask>();
  // Task reports since the last turn ended; a wake turn shows them.
  let notifications: string[] = [];
  // Reports from a turn whose tasks all ended in it, for a wake right after it.
  let endedTurnNotifications: string[] = [];
  let openTurn: Turn | null = null;
  // A task that ends mid-turn is usually handled in that turn, but Claude may
  // also wake for it right after the result.
  let tasksEndedInTurn = false;
  let responseMessageId = config.id;
  let written = 0;
  let wakeCount = 0;
  let accepting = true;
  let fatal = false;
  let lastTurnOk = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    // Long-lived runs wake many times; the daemon settles each turn's job long
    // before it falls out of this window.
    let closed = turns.filter((turn) => turn.end !== undefined).length;
    for (let index = 0; closed > MAX_CLOSED_TURNS && index < turns.length; ) {
      if (turns[index]!.end === undefined) index += 1;
      else {
        turns.splice(index, 1);
        closed -= 1;
      }
    }
    fs.writeFileSync(
      `${config.statePath}.tmp`,
      JSON.stringify({
        messageIds: [...accepted],
        responseMessageId,
        turns,
        backgroundTasks: [...tasks.values()],
        resident: accepting && !openTurn && tasks.size > 0,
      }),
      { mode: 0o600 },
    );
    fs.renameSync(`${config.statePath}.tmp`, config.statePath);
  };
  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const stopAccepting = () => {
    clearIdleTimer();
    if (!accepting) return;
    accepting = false;
    server.close();
    child.stdin.end();
    persist();
  };
  // Close once nothing can produce another turn. Tasks keep the run resident.
  const settle = (afterTasksEnded: boolean) => {
    if (!accepting || openTurn || unacknowledged.size > 0) return;
    if (tasks.size > 0) {
      clearIdleTimer();
      return;
    }
    if (!afterTasksEnded) {
      stopAccepting();
      return;
    }
    clearIdleTimer();
    idleTimer = setTimeout(stopAccepting, IDLE_CLOSE_GRACE_MS);
  };
  const openTurnAt = (turn: Turn) => {
    clearIdleTimer();
    openTurn = turn;
    turns.push(turn);
    endedTurnNotifications = [];
  };
  const fail = (error: Error) => {
    fatal = true;
    console.error(error.message);
    stopAccepting();
    child.kill('SIGTERM');
  };
  const deliver = (id: string, prompt: string): boolean => {
    if (accepted.has(id)) return true;
    if (!accepting) return false;
    const uuid = crypto.randomUUID();
    accepted.add(id);
    unacknowledged.add(uuid);
    responseMessageId = id;
    if (openTurn) openTurn.messageIds.push(id);
    else openTurnAt({ id, start: written, messageIds: [id] });
    // Persist acceptance before writing stdin. Once accepted, a broken pipe is
    // a failed run, never permission to replay a potentially executed action.
    persist();
    child.stdin.write(
      JSON.stringify({
        type: 'user',
        uuid,
        session_id: '',
        parent_tool_use_id: null,
        message: { role: 'user', content: prompt },
      }) + '\n',
    );
    return true;
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      try {
        const input = JSON.parse(body);
        if (
          typeof input.id !== 'string' ||
          !input.id ||
          typeof input.prompt !== 'string' ||
          !input.prompt.trim()
        ) {
          response.writeHead(400).end();
          return;
        }
        response.writeHead(deliver(input.id, input.prompt) ? 200 : 409).end();
      } catch (error: any) {
        response.writeHead(500).end();
        fail(error);
      }
    });
  });
  server.on('error', fail);
  process.once('SIGTERM', () => fail(new Error('Claude stream canceled')));
  process.once('SIGINT', () => fail(new Error('Claude stream canceled')));
  process.once('SIGHUP', () => fail(new Error('Claude stream canceled')));
  child.stdin.on('error', fail);
  child.on('error', fail);
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line: string) => {
    let event: any = null;
    try {
      event = JSON.parse(line);
    } catch {
      /* non-JSON output still belongs to the transcript */
    }
    const topLevel = event && !event.parent_tool_use_id;
    // A turn nobody asked for is Claude waking itself for a background task.
    // Before the first delivery, an init can only be start-up noise. A run that
    // is already closing still records the turn rather than losing it.
    if (
      topLevel &&
      event.type === 'system' &&
      event.subtype === 'init' &&
      !openTurn &&
      !fatal &&
      turns.length > 0
    ) {
      wakeCount += 1;
      // Monitor events wake Claude without a report; name the only live task.
      const onlyTask = tasks.size === 1 ? [...tasks.values()][0] : undefined;
      const summaries =
        notifications.length > 0
          ? notifications
          : endedTurnNotifications.length > 0
            ? endedTurnNotifications
            : onlyTask?.description
              ? [`"${onlyTask.description}" reported`]
              : [];
      openTurnAt({
        id: `${config.id}-wake-${wakeCount}`,
        start: written,
        messageIds: [],
        wake: { summaries },
      });
      notifications = [];
      persist();
    }
    process.stdout.write(line + '\n');
    written += Buffer.byteLength(line, 'utf8') + 1;
    if (!topLevel) return;
    if (event.type === 'user' && event.uuid) unacknowledged.delete(event.uuid);
    if (event.type === 'system' && event.subtype === 'task_notification') {
      const summary = String(event.summary ?? '').trim();
      if (summary && openTurn?.wake) {
        openTurn.wake.summaries.push(summary);
        persist();
      } else if (summary) notifications.push(summary);
    }
    if (event.type === 'system' && event.subtype === 'background_tasks_changed') {
      const previous = new Map(tasks);
      tasks.clear();
      for (const task of Array.isArray(event.tasks) ? event.tasks : []) {
        const id = String(task?.task_id ?? '').trim();
        if (!id) continue;
        tasks.set(id, {
          id,
          type: String(task?.task_type ?? ''),
          description: String(task?.description ?? ''),
          startedAt: previous.get(id)?.startedAt ?? new Date().toISOString(),
        });
      }
      if (openTurn && tasks.size < previous.size) tasksEndedInTurn = true;
      persist();
      settle(previous.size > 0);
    }
    if (event.type === 'result') {
      // A result can precede consumption of a follow-up. Only close the turn
      // after the result covering all replayed user inputs; messages may be
      // coalesced.
      if (openTurn && unacknowledged.size === 0) {
        lastTurnOk = !event.is_error && event.subtype === 'success';
        openTurn.end = written;
        openTurn.ok = lastTurnOk;
        openTurn = null;
        // Reports that arrived during the turn were usually handled by it.
        endedTurnNotifications = tasksEndedInTurn && tasks.size === 0 ? notifications : [];
        notifications = [];
        persist();
        settle(tasksEndedInTurn);
        tasksEndedInTurn = false;
      }
    }
  });
  child.on('close', (code) => {
    clearIdleTimer();
    // Background tasks die with Claude.
    tasks.clear();
    accepting = false;
    server.close();
    try {
      fs.unlinkSync(config.socketPath);
    } catch {
      /* already removed */
    }
    persist();
    process.exitCode =
      fatal || openTurn || unacknowledged.size > 0 || !lastTurnOk ? 1 : (code ?? 1);
  });
  server.listen(config.socketPath, () => {
    fs.chmodSync(config.socketPath, 0o600);
    try {
      deliver(config.id, config.prompt);
    } catch (error: any) {
      fail(error);
    }
  });
}

export function claudeStreamRunnerScript(config: RunnerConfig): string {
  return `(${runClaudeStream.toString()})(${JSON.stringify(config)});`;
}
