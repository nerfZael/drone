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
  /** Claude's task type, or `wakeup`/`cron` for a wake-up Claude scheduled. */
  type: string;
  description: string;
  startedAt: string;
  /** When a scheduled wake-up should fire. */
  dueAt?: string;
  /** A cron schedule that fires until deleted. */
  recurring?: boolean;
};

export type ClaudeStreamState = {
  messageIds: string[];
  responseMessageId: string;
  turns?: ClaudeStreamTurn[];
  backgroundTasks?: ClaudeBackgroundTask[];
  /** True while the run is idle but kept alive for its background tasks or wake-ups. */
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
  /** Test hooks; production uses the runner defaults. */
  idleCloseGraceMs?: number;
  scheduleLateMs?: number;
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
  // ScheduleWakeup and CronCreate keep their timers inside Claude and report
  // nothing, so the run tracks them from the tool calls. A wake-up that has
  // not fired this long after it was due is dropped.
  const SCHEDULE_LATE_MS = config.scheduleLateMs ?? 5 * 60_000;
  // ScheduleWakeup fires at its reported time; a one-shot cron job up to 90 s early.
  const scheduleEarlyMs = (schedule: ClaudeBackgroundTask) =>
    schedule.type === 'cron' ? 95_000 : 5_000;
  // Claude ends recurring jobs after 7 days.
  const RECURRING_MAX_MS = 7 * 24 * 60 * 60_000 + 60 * 60_000;
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
  const schedules = new Map<string, ClaudeBackgroundTask>();
  const scheduleCalls = new Map<string, { name: string; input: any }>();
  let scheduleSweepTimer: ReturnType<typeof setTimeout> | null = null;
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
        backgroundTasks: [...tasks.values(), ...schedules.values()],
        resident: accepting && !openTurn && tasks.size + schedules.size > 0,
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
  // Close once nothing can produce another turn. Tasks and wake-ups keep the
  // run resident.
  const settle = (afterTasksEnded: boolean) => {
    if (!accepting || openTurn || unacknowledged.size > 0) return;
    if (tasks.size > 0 || schedules.size > 0) {
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
  const scheduleDeadline = (schedule: ClaudeBackgroundTask) =>
    schedule.dueAt
      ? Date.parse(schedule.dueAt) + SCHEDULE_LATE_MS
      : schedule.recurring
        ? Date.parse(schedule.startedAt) + RECURRING_MAX_MS
        : Infinity;
  const armScheduleSweep = () => {
    if (scheduleSweepTimer) clearTimeout(scheduleSweepTimer);
    scheduleSweepTimer = null;
    const deadline = Math.min(...[...schedules.values()].map(scheduleDeadline));
    if (!Number.isFinite(deadline)) return;
    scheduleSweepTimer = setTimeout(sweepSchedules, Math.max(0, deadline - Date.now()));
  };
  // Drop wake-ups that never fired, so they cannot keep the run alive forever.
  const sweepSchedules = () => {
    scheduleSweepTimer = null;
    if (openTurn) {
      scheduleSweepTimer = setTimeout(sweepSchedules, 30_000);
      return;
    }
    let dropped = false;
    for (const [id, schedule] of schedules) {
      if (scheduleDeadline(schedule) <= Date.now()) dropped = schedules.delete(id) || dropped;
    }
    armScheduleSweep();
    if (!dropped) return;
    persist();
    settle(true);
  };
  const toolResultText = (content: unknown): string =>
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
        : '';
  // A one-shot cron pins minute, hour, day and month, in Claude's local time.
  const pinnedCronDue = (expression: string): string | undefined => {
    const fields = expression.trim().split(/\s+/);
    const [minute, hour, day, month] = fields.slice(0, 4).map(Number);
    if (fields.length !== 5 || ![minute, hour, day, month].every(Number.isInteger))
      return undefined;
    const now = new Date();
    let due = new Date(now.getFullYear(), month! - 1, day, hour, minute);
    if (due.getTime() < now.getTime() - SCHEDULE_LATE_MS)
      due = new Date(now.getFullYear() + 1, month! - 1, day, hour, minute);
    return due.toISOString();
  };
  const applySchedule = (name: string, input: any, result: string) => {
    const now = Date.now();
    if (name === 'ScheduleWakeup') {
      // Claude keeps one pending wake-up; a new one replaces it.
      if (input?.stop === true) schedules.delete('wakeup');
      else {
        const reported = Number(/\(in (\d+)s\)/.exec(result)?.[1]);
        const seconds = Number.isFinite(reported)
          ? reported
          : Math.min(3600, Math.max(60, Number(input?.delaySeconds) || 60));
        schedules.set('wakeup', {
          id: 'wakeup',
          type: 'wakeup',
          description: String(input?.reason || input?.prompt || '').trim(),
          startedAt: new Date(now).toISOString(),
          dueAt: new Date(now + seconds * 1000).toISOString(),
        });
      }
    } else if (name === 'CronCreate') {
      const jobId = /\btask ([0-9a-z]+)/i.exec(result)?.[1];
      if (!jobId) return;
      const recurring = input?.recurring !== false;
      const dueAt = recurring ? undefined : pinnedCronDue(String(input?.cron ?? ''));
      schedules.set(`cron:${jobId}`, {
        id: `cron:${jobId}`,
        type: 'cron',
        description: String(input?.prompt ?? '')
          .trim()
          .slice(0, 300),
        startedAt: new Date(now).toISOString(),
        ...(dueAt ? { dueAt } : {}),
        ...(recurring ? { recurring } : {}),
      });
    } else if (name === 'CronDelete') {
      schedules.delete(`cron:${String(input?.id ?? '').trim()}`);
    }
    armScheduleSweep();
    persist();
  };
  /** The one-shot wake-up that is due now, removed now that it has fired. */
  const takeDueSchedule = (): ClaudeBackgroundTask | undefined => {
    const due = [...schedules.values()]
      .filter(
        (schedule) =>
          !schedule.recurring &&
          schedule.dueAt &&
          Date.parse(schedule.dueAt) - scheduleEarlyMs(schedule) <= Date.now(),
      )
      .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0];
    if (due) {
      schedules.delete(due.id);
      armScheduleSweep();
    }
    return due;
  };
  const scheduleSummary = (schedule: ClaudeBackgroundTask) => {
    const label = schedule.type === 'wakeup' ? 'Scheduled wake-up' : 'Scheduled task';
    return schedule.description ? `${label}: ${schedule.description}` : label;
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
      // A wake-up Claude scheduled fires with no report of its own.
      const dueSchedule = notifications.length > 0 ? undefined : takeDueSchedule();
      // Monitor events wake Claude without a report; name the only live task.
      const onlyTask = tasks.size === 1 ? [...tasks.values()][0] : undefined;
      const recurringSchedule = [...schedules.values()].find((schedule) => schedule.recurring);
      const summaries =
        notifications.length > 0
          ? notifications
          : dueSchedule
            ? [scheduleSummary(dueSchedule)]
            : endedTurnNotifications.length > 0
              ? endedTurnNotifications
              : onlyTask?.description
                ? [`"${onlyTask.description}" reported`]
                : recurringSchedule
                  ? [scheduleSummary(recurringSchedule)]
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
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const part of content) {
      if (
        event.type === 'assistant' &&
        part?.type === 'tool_use' &&
        ['ScheduleWakeup', 'CronCreate', 'CronDelete'].includes(part.name)
      )
        scheduleCalls.set(String(part.id), { name: part.name, input: part.input });
      const call =
        event.type === 'user' && part?.type === 'tool_result'
          ? scheduleCalls.get(String(part.tool_use_id))
          : undefined;
      if (!call) continue;
      scheduleCalls.delete(String(part.tool_use_id));
      if (!part.is_error) applySchedule(call.name, call.input, toolResultText(part.content));
    }
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
    if (scheduleSweepTimer) clearTimeout(scheduleSweepTimer);
    // Background tasks and scheduled wake-ups die with Claude.
    tasks.clear();
    schedules.clear();
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
