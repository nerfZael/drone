import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { URL } from 'node:url';
import { promisify } from 'node:util';

import {
  parseBuiltinPromptJobTranscriptLines,
  type BuiltinPromptJobTranscript,
} from './hub/builtin-transcript-sessions';
import { preferredTerminalSessionLogsRoot } from './host/session-logs';
import { missingHostDependencyMessage } from './host/runtime';
import {
  DAEMON_JSON_MAX_BYTES,
  DaemonHttpError,
  handleDaemonWorkspaceRequest,
  readLimitedJson,
} from './daemon-workspace';
import { handleDaemonManagedStateRequest } from './daemon-managed-state';
import { DRONE_DAEMON_CAPABILITIES } from './daemon-capabilities';
import { selectNextPromptJobId } from './prompt-job-scheduling';
import {
  CodexPromptRunManager,
  codexPromptRunSummary,
  type CodexPromptEnqueueDisposition,
  type CodexPromptRun,
  type CodexPromptRunSummary,
  type CodexPromptSpec,
  type CodexPromptSteeringDiagnostic,
} from './codex-prompt-run-manager';
import { codexDaemonRestartRecoveryAction } from './codex-daemon-restart';

const execFileAsync = promisify(execFile);

type DroneState = {
  process?: {
    session: string;
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    logPath: string;
    startedAt: string;
  };
};

type PromptJobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

type PromptJobDiagnostics = {
  transcriptTerminalEventAt?: string;
  transcriptParsedAt?: string;
  transcriptTerminalEventLagMs?: number;
  wrapperStartedAt?: string;
  wrapperCommandExitedAt?: string;
  wrapperRuntimeMs?: number;
  wrapperExitAfterTranscriptTerminalMs?: number;
  jobRuntimeMs?: number;
  codexEnqueue?: {
    decidedAt: string;
    requestedDeliveryMode: 'queue' | 'asap';
    disposition: CodexPromptEnqueueDisposition;
    steering?: CodexPromptSteeringDiagnostic;
  };
};

type SessionProbeStatus = 'alive' | 'missing' | 'unknown';

type SessionProbe = {
  status: SessionProbeStatus;
  checkedAt: string;
  consecutiveMissing?: number;
  missingSince?: string;
  error?: string;
  stdoutBytes?: number;
};

type PromptJob = {
  id: string;
  kind: string;
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  state: PromptJobState;
  deliveryMode?: 'queue' | 'asap';
  session: string;
  stdoutPath: string;
  stderrPath: string;
  exitPath: string;
  wrapperPath?: string;
  wrapperStatePath?: string;
  heartbeatPath?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  exitStatusSource?: 'exit-file' | 'wrapper-state' | 'transcript-terminal' | 'missing-exit-file';
  stdout?: string;
  stderr?: string;
  wrapperLog?: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  wrapperBytes?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  wrapperTruncated?: boolean;
  transcript?: BuiltinPromptJobTranscript;
  diagnostics?: PromptJobDiagnostics;
  sessionProbe?: SessionProbe;
  terminalObservedAt?: string;
  terminalObservedStatus?: 'success' | 'failure';
  failureReason?: string;
  error?: string;
  codexAppServer?: CodexPromptSpec & {
    run?: CodexPromptRunSummary;
    /** Read compatibility for jobs persisted before prompt runs were introduced. */
    outputOwner?: boolean;
  };
};

type CodexPromptJob = PromptJob & { codexAppServer: CodexPromptSpec };

const PROMPT_SESSION_MISSING_CONFIRMATIONS = 3;
const PROMPT_SESSION_MISSING_GRACE_MS = 1_500;
const PROMPT_WRAPPER_HEARTBEAT_FRESH_MS = 6_000;
const PROMPT_TERMINAL_EXIT_GRACE_MS = 5_000;
const PROMPT_LATE_RECOVERY_POLL_MS = 5_000;
const CODEX_APP_SERVER_IDLE_MS = 15 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function bashQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTextSafeDetailed(
  p: string,
  opts?: { maxBytes?: number },
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  let handle: FileHandle | null = null;
  try {
    const maxBytes = Math.max(1, Math.floor(opts?.maxBytes ?? 2 * 1024 * 1024));
    handle = await fs.open(p, 'r');
    const stat = await handle.stat();
    const bytes = Number.isFinite(stat.size) && stat.size > 0 ? Math.floor(stat.size) : 0;
    const readBytes = Math.min(bytes, maxBytes);
    const buf = Buffer.alloc(readBytes);
    const read = readBytes > 0 ? await handle.read(buf, 0, readBytes, 0) : { bytesRead: 0 };
    const head = buf.subarray(0, read.bytesRead).toString('utf8');
    if (bytes <= maxBytes) {
      return { text: head, bytes, truncated: false };
    }
    const text = `${head}\n\n…(truncated)…`;
    return {
      text,
      bytes,
      truncated: true,
    };
  } catch {
    return { text: '', bytes: 0, truncated: false };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readTextSafe(p: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  return (await readTextSafeDetailed(p, { maxBytes })).text;
}

async function readIntSafe(p: string): Promise<number | null> {
  try {
    const raw = (await fs.readFile(p, 'utf8')).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fileSizeSafe(p: string): Promise<number> {
  try {
    const st = await fs.stat(p);
    return Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
  } catch {
    return 0;
  }
}

async function readTextTailSafe(p: string, maxBytes = 128 * 1024): Promise<string> {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(p, 'r');
    const stat = await handle.stat();
    const size = Number.isFinite(stat.size) && stat.size > 0 ? Math.floor(stat.size) : 0;
    if (size <= 0) return '';
    const readBytes = Math.min(size, Math.max(1, Math.floor(maxBytes)));
    const buffer = Buffer.alloc(readBytes);
    const { bytesRead } = await handle.read(buffer, 0, readBytes, size - readBytes);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function readJsonFile<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFileAtomic(p: string, obj: any): Promise<void> {
  const tmp = `${p}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

type PromptIndex = { order: string[] };

async function loadPromptIndex(promptsDir: string): Promise<PromptIndex> {
  return await readJsonFile(path.join(promptsDir, 'queue.json'), { order: [] });
}

async function savePromptIndex(promptsDir: string, idx: PromptIndex): Promise<void> {
  await writeJsonFileAtomic(path.join(promptsDir, 'queue.json'), idx);
}

function promptJobEventSummary(job: PromptJob, pendingApprovalCount = 0) {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
    ...(job.diagnostics ? { diagnostics: job.diagnostics } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(pendingApprovalCount > 0 ? { pendingApprovalCount } : {}),
  };
}

async function buildPromptJobEventSnapshot(promptsDir: string): Promise<Map<string, string>> {
  const idx = await loadPromptIndex(promptsDir);
  const order = Array.isArray(idx.order) ? idx.order.map(String).filter(Boolean) : [];
  const next = new Map<string, string>();
  const pendingApprovalCountByRunId = new Map<string, number>();
  for (const id of order) {
    const job = await loadPromptJob(promptsDir, id);
    if (!job) continue;
    const runId = job.state === 'running' ? String(job.codexAppServer?.runId ?? '').trim() : '';
    let pendingApprovalCount = 0;
    if (runId) {
      const cached = pendingApprovalCountByRunId.get(runId);
      if (cached !== undefined) {
        pendingApprovalCount = cached;
      } else {
        const run = await loadCodexPromptRun(promptsDir, runId);
        pendingApprovalCount = Array.isArray(run?.pendingApprovals)
          ? run.pendingApprovals.length
          : 0;
        pendingApprovalCountByRunId.set(runId, pendingApprovalCount);
      }
    }
    next.set(id, JSON.stringify(promptJobEventSummary(job, pendingApprovalCount)));
  }
  return next;
}

function writeSseEvent(res: http.ServerResponse, event: string, data: any): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function promptSessionName(id: string): string {
  const cleaned = String(id)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 48);
  return `drone-prompt-${cleaned || 'job'}`;
}

async function loadPromptJob(promptsDir: string, id: string): Promise<PromptJob | null> {
  const p = path.join(promptsDir, 'jobs', `${id}.json`);
  const exists = await fileExists(p);
  if (!exists) return null;
  return await readJsonFile<PromptJob>(p, null as any);
}

async function savePromptJob(promptsDir: string, job: PromptJob): Promise<void> {
  const p = path.join(promptsDir, 'jobs', `${job.id}.json`);
  await writeJsonFileAtomic(p, job);
}

async function loadCodexPromptRun(promptsDir: string, id: string): Promise<CodexPromptRun | null> {
  const runPath = path.join(promptsDir, 'runs', `${id}.json`);
  if (!(await fileExists(runPath))) return null;
  return await readJsonFile<CodexPromptRun>(runPath, null as any);
}

async function saveCodexPromptRun(promptsDir: string, run: CodexPromptRun): Promise<void> {
  await writeJsonFileAtomic(path.join(promptsDir, 'runs', `${run.id}.json`), run);
}

function codexRunAsPromptJob(run: CodexPromptRun): PromptJob {
  return {
    id: run.id,
    kind: 'codex',
    cmd: 'codex-app-server',
    args: [],
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    state: run.state,
    session: promptSessionName(run.id),
    stdoutPath: run.stdoutPath,
    stderrPath: run.stderrPath,
    exitPath: path.join(path.dirname(run.stdoutPath), `${run.id}.exit.txt`),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    exitCode:
      run.state === 'done' ? 0 : run.state === 'failed' || run.state === 'canceled' ? 1 : undefined,
    stdout: run.stdout,
    stderr: run.stderr,
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    transcript: run.transcript as BuiltinPromptJobTranscript | undefined,
  };
}

async function refreshCodexPromptRun(run: CodexPromptRun): Promise<CodexPromptRun> {
  const refreshed = await refreshPromptJobTranscript(codexRunAsPromptJob(run));
  return {
    ...run,
    stdout: refreshed.stdout,
    stderr: refreshed.stderr,
    stdoutBytes: refreshed.stdoutBytes,
    stderrBytes: refreshed.stderrBytes,
    stdoutTruncated: refreshed.stdoutTruncated,
    stderrTruncated: refreshed.stderrTruncated,
    transcript: refreshed.transcript,
  };
}

async function projectCodexPromptJob(promptsDir: string, job: CodexPromptJob): Promise<PromptJob> {
  const runId = String(job.codexAppServer.runId ?? '').trim();
  if (!runId) return job;
  const run = await loadCodexPromptRun(promptsDir, runId);
  if (!run) return job;
  return {
    ...job,
    stdoutPath: run.stdoutPath,
    stderrPath: run.stderrPath,
    startedAt: job.startedAt ?? run.startedAt,
    finishedAt: job.finishedAt ?? run.finishedAt,
    stdout: run.stdout,
    stderr: run.stderr,
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    transcript: run.transcript as BuiltinPromptJobTranscript | undefined,
    codexAppServer: {
      ...job.codexAppServer,
      threadId: run.threadId ?? job.codexAppServer.threadId,
      turnId: run.turnId ?? job.codexAppServer.turnId,
      run: codexPromptRunSummary(run),
      // Keep older hubs compatible while run-aware clients migrate away from this projection.
      outputOwner: run.responseMessageId === job.id,
    },
  };
}

async function startPromptJob(job: PromptJob): Promise<void> {
  // Run inside tmux so work continues even if this daemon process restarts.
  const quotedCmd = bashQuote(job.cmd);
  const quotedArgs = (job.args ?? []).map((a) => bashQuote(a)).join(' ');
  const quotedStdoutPath = bashQuote(job.stdoutPath);
  const quotedStderrPath = bashQuote(job.stderrPath);
  const quotedExitPath = bashQuote(job.exitPath);
  const wrapperPath =
    job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`);
  const wrapperStatePath =
    job.wrapperStatePath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper-state.json`);
  const heartbeatPath =
    job.heartbeatPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.heartbeat`);
  const quotedWrapperPath = bashQuote(wrapperPath);
  const quotedWrapperStatePath = bashQuote(wrapperStatePath);
  const quotedHeartbeatPath = bashQuote(heartbeatPath);
  const cd = job.cwd ? `cd ${bashQuote(job.cwd)}\n` : '';
  const envLines =
    job.env && Object.keys(job.env).length > 0
      ? Object.entries(job.env)
          .map(
            ([k, v]) =>
              `export ${String(k).replace(/[^A-Za-z0-9_]/g, '_')}=${bashQuote(String(v))}`,
          )
          .join('\n') + '\n'
      : '';
  const script = [
    'set +e',
    `stdout_path=${quotedStdoutPath}`,
    `stderr_path=${quotedStderrPath}`,
    `exit_path=${quotedExitPath}`,
    `wrapper_path=${quotedWrapperPath}`,
    `wrapper_state_path=${quotedWrapperStatePath}`,
    `heartbeat_path=${quotedHeartbeatPath}`,
    'wrote_exit=0',
    'heartbeat_pid=',
    'write_wrapper_state() {',
    '  phase="$1"',
    '  code="${2:-}"',
    '  state_tmp="$wrapper_state_path.tmp.$$"',
    '  if [ -n "$code" ]; then',
    '    printf \'{"phase":"%s","at":"%s","pid":%s,"exitCode":%s}\\n\' "$phase" "$(date -Is)" "$$" "$code" > "$state_tmp" 2>/dev/null || return 0',
    '  else',
    '    printf \'{"phase":"%s","at":"%s","pid":%s}\\n\' "$phase" "$(date -Is)" "$$" > "$state_tmp" 2>/dev/null || return 0',
    '  fi',
    '  mv -f "$state_tmp" "$wrapper_state_path" 2>/dev/null || true',
    '}',
    'write_heartbeat() {',
    '  heartbeat_tmp="$heartbeat_path.tmp.$$"',
    '  date -Is > "$heartbeat_tmp" 2>/dev/null && mv -f "$heartbeat_tmp" "$heartbeat_path" 2>/dev/null || true',
    '}',
    'heartbeat_loop() {',
    '  while :; do',
    '    write_heartbeat',
    '    sleep 2',
    '  done',
    '}',
    'stop_heartbeat() {',
    '  if [ -n "$heartbeat_pid" ]; then',
    '    kill "$heartbeat_pid" 2>/dev/null || true',
    '    wait "$heartbeat_pid" 2>/dev/null || true',
    '    heartbeat_pid=',
    '  fi',
    '}',
    'write_wrapper_state starting',
    'write_heartbeat',
    'heartbeat_loop &',
    'heartbeat_pid=$!',
    'printf \'%s\\n\' "prompt wrapper: started at $(date -Is) pid $$" > "$wrapper_path" 2>/dev/null || true',
    'write_wrapper_state running',
    'record_wrapper_exit() {',
    '  wrapper_code=$?',
    '  stop_heartbeat',
    '  if [ "$wrote_exit" != "1" ]; then',
    '    printf \'%s\\n\' "prompt wrapper: exited before command exit capture at $(date -Is) with wrapper code $wrapper_code" >> "$wrapper_path" 2>/dev/null || true',
    '    if [ ! -e "$exit_path" ]; then',
    '      printf %s "$wrapper_code" > "$exit_path" 2>/dev/null || true',
    '    fi',
    '    write_wrapper_state exited "$wrapper_code"',
    '  fi',
    '}',
    'trap record_wrapper_exit EXIT',
    "trap 'printf '\\''%s\\n'\\'' \"prompt wrapper: received SIGHUP at $(date -Is)\" >> \"$wrapper_path\" 2>/dev/null || true; exit 129' HUP",
    "trap 'printf '\\''%s\\n'\\'' \"prompt wrapper: received SIGINT at $(date -Is)\" >> \"$wrapper_path\" 2>/dev/null || true; exit 130' INT",
    "trap 'printf '\\''%s\\n'\\'' \"prompt wrapper: received SIGTERM at $(date -Is)\" >> \"$wrapper_path\" 2>/dev/null || true; exit 143' TERM",
    cd.trimEnd(),
    envLines.trimEnd(),
    // Run and capture exit code.
    `${quotedCmd} ${quotedArgs} > ${quotedStdoutPath} 2> ${quotedStderrPath}`,
    'code=$?',
    'stop_heartbeat',
    'printf \'%s\\n\' "prompt wrapper: command exited at $(date -Is) with code $code" >> "$wrapper_path" 2>/dev/null || true',
    `if [ "$code" -ne 0 ] && [ ! -s ${quotedStdoutPath} ] && [ ! -s ${quotedStderrPath} ]; then`,
    `  printf '%s\n' "prompt wrapper: command exited with code $code without writing stdout/stderr" >> ${quotedStderrPath}`,
    'fi',
    `printf %s \"$code\" > ${quotedExitPath}`,
    'write_wrapper_state finished "$code"',
    'wrote_exit=1',
    'exit 0',
  ]
    .filter(Boolean)
    .join('\n');

  // Avoid passing long `bash -lc "<script>"` payloads to tmux; very large prompts
  // can exceed command length limits before the job even starts.
  const scriptPath = path.join(path.dirname(job.stdoutPath), `${job.id}.run.sh`);
  await fs.writeFile(scriptPath, `${script}\n`, { encoding: 'utf8', mode: 0o700 });
  await startSession({ session: job.session, cmd: 'bash', args: [scriptPath] });
}

function promptJobSupportsTranscript(kindRaw: unknown): boolean {
  const kind = String(kindRaw ?? '').trim();
  return (
    kind === 'cursor' ||
    kind === 'codex' ||
    kind === 'claude' ||
    kind === 'opencode' ||
    kind === 'pi' ||
    kind === 'blip'
  );
}

async function parsePromptJobTranscriptFromFile(
  job: PromptJob,
  stdoutRead: { bytes: number; truncated: boolean },
  parsedAt: string,
): Promise<BuiltinPromptJobTranscript | null> {
  if (!promptJobSupportsTranscript(job.kind)) return null;
  if (stdoutRead.bytes <= 0) {
    return await parseBuiltinPromptJobTranscriptLines(job.kind, [], {
      stdoutBytes: stdoutRead.bytes,
      stdoutTruncated: stdoutRead.truncated,
      parsedAt,
    });
  }
  // Bound the stream to the file size we just observed. In Bun/Node a read
  // against a concurrently written file can otherwise wait for later writes,
  // which makes live transcript polling miss transient running states.
  const stream = createReadStream(job.stdoutPath, {
    encoding: 'utf8',
    start: 0,
    end: stdoutRead.bytes - 1,
  });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    return await parseBuiltinPromptJobTranscriptLines(job.kind, lines, {
      stdoutBytes: stdoutRead.bytes,
      stdoutTruncated: stdoutRead.truncated,
      parsedAt,
    });
  } catch {
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
}

function parseIsoLikeMs(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function parsePromptWrapperTimestamps(wrapperLog: string): {
  startedAt?: string;
  commandExitedAt?: string;
} {
  const raw = String(wrapperLog ?? '');
  const startedAt = raw.match(/prompt wrapper: started at ([^\n]+?) pid\b/)?.[1]?.trim();
  const commandExitedAt = raw
    .match(/prompt wrapper: command exited at ([^\n]+?) with code\b/)?.[1]
    ?.trim();
  return {
    ...(startedAt ? { startedAt } : {}),
    ...(commandExitedAt ? { commandExitedAt } : {}),
  };
}

function buildPromptJobDiagnostics(
  job: PromptJob,
  transcript: BuiltinPromptJobTranscript | null,
  wrapperLog: string,
): PromptJobDiagnostics | undefined {
  const diagnostics: PromptJobDiagnostics = {};
  const terminalEventAt =
    transcript && String((transcript as any).kind ?? '').trim() === 'blip'
      ? String((transcript as any).terminalEventAt ?? '').trim()
      : '';
  const parsedAt = String((transcript as any)?.parsedAt ?? '').trim();
  if (terminalEventAt) diagnostics.transcriptTerminalEventAt = terminalEventAt;
  if (parsedAt) diagnostics.transcriptParsedAt = parsedAt;

  const terminalMs = parseIsoLikeMs(terminalEventAt);
  const parsedMs = parseIsoLikeMs(parsedAt);
  if (terminalMs != null && parsedMs != null)
    diagnostics.transcriptTerminalEventLagMs = Math.max(0, Math.round(parsedMs - terminalMs));

  const wrapper = parsePromptWrapperTimestamps(wrapperLog);
  if (wrapper.startedAt) diagnostics.wrapperStartedAt = wrapper.startedAt;
  if (wrapper.commandExitedAt) diagnostics.wrapperCommandExitedAt = wrapper.commandExitedAt;
  const wrapperStartedMs = parseIsoLikeMs(wrapper.startedAt);
  const wrapperExitedMs = parseIsoLikeMs(wrapper.commandExitedAt);
  if (wrapperStartedMs != null && wrapperExitedMs != null) {
    diagnostics.wrapperRuntimeMs = Math.max(0, Math.round(wrapperExitedMs - wrapperStartedMs));
  }
  if (terminalMs != null && wrapperExitedMs != null) {
    diagnostics.wrapperExitAfterTranscriptTerminalMs = Math.max(
      0,
      Math.round(wrapperExitedMs - terminalMs),
    );
  }

  const jobStartedMs = parseIsoLikeMs(job.startedAt);
  const jobFinishedMs = parseIsoLikeMs(job.finishedAt);
  if (jobStartedMs != null && jobFinishedMs != null)
    diagnostics.jobRuntimeMs = Math.max(0, Math.round(jobFinishedMs - jobStartedMs));

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

type PromptWrapperState = {
  phase?: 'starting' | 'running' | 'finished' | 'exited';
  at?: string;
  pid?: number;
  exitCode?: number;
};

async function readPromptWrapperState(job: PromptJob): Promise<PromptWrapperState | null> {
  const statePath =
    job.wrapperStatePath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper-state.json`);
  const value = await readJsonFile<PromptWrapperState | null>(statePath, null);
  return value && typeof value === 'object' ? value : null;
}

async function promptHeartbeatAgeMs(job: PromptJob, nowMs = Date.now()): Promise<number | null> {
  const heartbeatPath =
    job.heartbeatPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.heartbeat`);
  try {
    const stat = await fs.stat(heartbeatPath);
    const age = nowMs - stat.mtimeMs;
    return Number.isFinite(age) ? Math.max(0, Math.round(age)) : null;
  } catch {
    return null;
  }
}

async function promptHeartbeatAt(job: PromptJob, nowMs = Date.now()): Promise<string | undefined> {
  const heartbeatPath =
    job.heartbeatPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.heartbeat`);
  try {
    const raw = String(await fs.readFile(heartbeatPath, 'utf8')).trim();
    const heartbeatMs = parseIsoLikeMs(raw);
    const startedMs = parseIsoLikeMs(job.startedAt);
    if (
      heartbeatMs != null &&
      heartbeatMs <= nowMs &&
      (startedMs == null || heartbeatMs >= startedMs)
    ) {
      return raw;
    }
  } catch {
    // Fall through to the file timestamp for older wrappers without content.
  }
  try {
    const stat = await fs.stat(heartbeatPath);
    const heartbeatMs = Number(stat.mtimeMs);
    const startedMs = parseIsoLikeMs(job.startedAt);
    if (
      Number.isFinite(heartbeatMs) &&
      heartbeatMs <= nowMs &&
      (startedMs == null || heartbeatMs >= startedMs)
    ) {
      return new Date(heartbeatMs).toISOString();
    }
  } catch {
    // A missing heartbeat leaves finalization on its existing detection-time fallback.
  }
  return undefined;
}

function transcriptTerminalStatusFromJsonl(
  kind: string,
  raw: string,
): 'success' | 'failure' | null {
  let terminal: 'success' | 'failure' | null = null;
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const type = String(event.type ?? '').trim();
    if (kind === 'codex') {
      if (type === 'response.failed' || type === 'error') terminal = 'failure';
      if (type === 'turn.completed' || type === 'response.completed') terminal = 'success';
      continue;
    }
    if (type === 'session_error' || type === 'response.failed') terminal = 'failure';
    if (type === 'session_finished') {
      const status = String(event.status ?? '')
        .trim()
        .toLowerCase();
      terminal = ['failed', 'error', 'canceled', 'cancelled'].includes(status)
        ? 'failure'
        : 'success';
    }
    if (type === 'response.completed') terminal = 'success';
  }
  return terminal;
}

async function promptTranscriptTerminalStatus(
  job: PromptJob,
): Promise<'success' | 'failure' | null> {
  const tail = await readTextTailSafe(job.stdoutPath);
  return transcriptTerminalStatusFromJsonl(job.kind, tail);
}

async function finalizePromptJob(
  job: PromptJob,
  opts?: { allowTerminalSuccess?: boolean; settleMs?: number; finishedAt?: string },
): Promise<PromptJob> {
  // Some CLIs (notably Codex JSON mode) may continue appending output briefly
  // after the tmux session has exited. Wait for output/exit artifacts to settle.
  let exitCode = await readIntSafe(job.exitPath);
  let exitCodeFromWrapperState = false;
  if (exitCode == null) {
    const wrapperState = await readPromptWrapperState(job);
    if (
      (wrapperState?.phase === 'finished' || wrapperState?.phase === 'exited') &&
      typeof wrapperState.exitCode === 'number' &&
      Number.isFinite(wrapperState.exitCode)
    ) {
      exitCode = Math.floor(wrapperState.exitCode);
      exitCodeFromWrapperState = true;
    }
  }
  let stdoutRead = await readTextSafeDetailed(job.stdoutPath);
  let stderrRead = await readTextSafeDetailed(job.stderrPath);
  let wrapperRead = await readTextSafeDetailed(
    job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`),
  );
  let stdout = stdoutRead.text;
  let stderr = stderrRead.text;
  let wrapperLog = wrapperRead.text;

  const startedLikeCodexTurn =
    /"type":"thread\.started"/.test(stdoutRead.text) &&
    /"type":"turn\.started"/.test(stdoutRead.text);
  const hasCodexTerminalEvent =
    job.kind === 'codex' && (await promptTranscriptTerminalStatus(job)) != null;
  const shouldWaitForCodexFlush =
    job.kind === 'codex' && startedLikeCodexTurn && !hasCodexTerminalEvent;

  if (exitCode == null || shouldWaitForCodexFlush) {
    const settleDeadline = Date.now() + Math.max(0, opts?.settleMs ?? 10_000);
    let stableReads = 0;
    let lastOutSize = await fileSizeSafe(job.stdoutPath);
    let lastErrSize = await fileSizeSafe(job.stderrPath);
    while (Date.now() < settleDeadline) {
      await sleep(150);
      const outSize = await fileSizeSafe(job.stdoutPath);
      const errSize = await fileSizeSafe(job.stderrPath);
      if (outSize === lastOutSize && errSize === lastErrSize) {
        stableReads += 1;
      } else {
        stableReads = 0;
        lastOutSize = outSize;
        lastErrSize = errSize;
      }

      exitCode = await readIntSafe(job.exitPath);
      if (exitCode != null) exitCodeFromWrapperState = false;
      if (exitCode == null) {
        const wrapperState = await readPromptWrapperState(job);
        if (
          (wrapperState?.phase === 'finished' || wrapperState?.phase === 'exited') &&
          typeof wrapperState.exitCode === 'number' &&
          Number.isFinite(wrapperState.exitCode)
        ) {
          exitCode = Math.floor(wrapperState.exitCode);
          exitCodeFromWrapperState = true;
        }
      }
      stdoutRead = await readTextSafeDetailed(job.stdoutPath);
      stderrRead = await readTextSafeDetailed(job.stderrPath);
      wrapperRead = await readTextSafeDetailed(
        job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`),
      );
      stdout = stdoutRead.text;
      stderr = stderrRead.text;
      wrapperLog = wrapperRead.text;
      const codexNowTerminal =
        job.kind === 'codex' && (await promptTranscriptTerminalStatus(job)) != null;
      if (shouldWaitForCodexFlush && codexNowTerminal && (exitCode != null || stableReads >= 2))
        break;
      if (exitCode != null && stableReads >= 2) break;
    }
  }

  const terminalStatus =
    exitCode == null && opts?.allowTerminalSuccess
      ? ((await promptTranscriptTerminalStatus(job)) ?? job.terminalObservedStatus ?? null)
      : null;
  const ok = exitCode === 0 || (exitCode == null && terminalStatus === 'success');
  const detectedFinishedAt = nowIso();
  const detectedFinishedMs = Date.parse(detectedFinishedAt);
  const requestedFinishedAt = String(opts?.finishedAt ?? '').trim();
  const requestedFinishedMs = parseIsoLikeMs(requestedFinishedAt);
  const startedMs = parseIsoLikeMs(job.startedAt);
  const finishedAt =
    requestedFinishedMs != null &&
    requestedFinishedMs <= detectedFinishedMs &&
    (startedMs == null || requestedFinishedMs >= startedMs)
      ? requestedFinishedAt
      : detectedFinishedAt;
  const transcript = await parsePromptJobTranscriptFromFile(job, stdoutRead, finishedAt);
  const diagnostics = buildPromptJobDiagnostics({ ...job, finishedAt }, transcript, wrapperLog);
  const exitStatusSource =
    exitCode != null
      ? exitCodeFromWrapperState
        ? 'wrapper-state'
        : 'exit-file'
      : terminalStatus === 'success'
        ? 'transcript-terminal'
        : 'missing-exit-file';
  const failureReason = ok
    ? undefined
    : exitCode == null
      ? 'prompt wrapper ended without writing an exit code; the tmux session may have been killed or the wrapper terminated before command exit capture'
      : undefined;
  return {
    ...job,
    updatedAt: finishedAt,
    finishedAt,
    exitCode: exitCode ?? undefined,
    exitStatusSource,
    stdout,
    stderr,
    wrapperLog,
    stdoutBytes: stdoutRead.bytes,
    stderrBytes: stderrRead.bytes,
    wrapperBytes: wrapperRead.bytes,
    stdoutTruncated: stdoutRead.truncated,
    stderrTruncated: stderrRead.truncated,
    wrapperTruncated: wrapperRead.truncated,
    ...(transcript ? { transcript } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    sessionProbe: undefined,
    terminalObservedAt: undefined,
    terminalObservedStatus: undefined,
    state: ok ? 'done' : 'failed',
    failureReason,
    error: ok
      ? undefined
      : failureReason || stderr.trim() || stdout.trim() || job.error || 'failed',
  };
}

async function refreshPromptJobTranscript(job: PromptJob): Promise<PromptJob> {
  if (!promptJobSupportsTranscript(job.kind)) return job;
  const stdoutRead = await readTextSafeDetailed(job.stdoutPath);
  const stderrRead = await readTextSafeDetailed(job.stderrPath);
  const wrapperRead = await readTextSafeDetailed(
    job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`),
  );
  const nextTranscript = await parsePromptJobTranscriptFromFile(job, stdoutRead, nowIso());
  if (!nextTranscript) return job;
  const diagnostics = buildPromptJobDiagnostics(job, nextTranscript, wrapperRead.text);
  return {
    ...job,
    stdout: stdoutRead.text,
    stderr: stderrRead.text,
    wrapperLog: wrapperRead.text,
    stdoutBytes: stdoutRead.bytes,
    stderrBytes: stderrRead.bytes,
    wrapperBytes: wrapperRead.bytes,
    stdoutTruncated: stdoutRead.truncated,
    stderrTruncated: stderrRead.truncated,
    wrapperTruncated: wrapperRead.truncated,
    transcript: nextTranscript,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function promptJobHasParsedTranscript(job: PromptJob): boolean {
  const transcript = job.transcript;
  if (!transcript || typeof transcript !== 'object') return false;
  if (String((transcript as any).kind ?? '').trim() !== String(job.kind ?? '').trim()) return false;
  return Object.prototype.hasOwnProperty.call(transcript, 'message');
}

async function cancelPromptJob(job: PromptJob): Promise<PromptJob> {
  if (job.state === 'done' || job.state === 'failed' || job.state === 'canceled') return job;

  const finishedAt = nowIso();
  if (job.state === 'queued') {
    return {
      ...job,
      state: 'canceled',
      updatedAt: finishedAt,
      finishedAt,
      error: 'stopped by user',
    };
  }

  if ((await probeSession(job.session)).status === 'missing') {
    return await finalizePromptJob(job);
  }

  try {
    await tmux(['send-keys', '-t', `${job.session}:0.0`, 'C-c']);
  } catch {
    // ignore and fall back to killing the session below
  }

  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if ((await probeSession(job.session)).status === 'missing') break;
    await sleep(100);
  }

  if ((await probeSession(job.session)).status !== 'missing') {
    try {
      await killSession(job.session);
    } catch {
      // ignore
    }
  }

  const exitCode = await readIntSafe(job.exitPath);
  const stdout = await readTextSafe(job.stdoutPath);
  const stderr = await readTextSafe(job.stderrPath);
  return {
    ...job,
    updatedAt: finishedAt,
    finishedAt,
    exitCode: exitCode ?? undefined,
    stdout,
    stderr,
    state: 'canceled',
    error: 'stopped by user',
  };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function json(res: http.ServerResponse, status: number, obj: any) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  return await readLimitedJson(req, DAEMON_JSON_MAX_BYTES);
}

function wrapTmuxError(error: any): Error {
  if (String(error?.code ?? '') === 'ENOENT') {
    return new Error(missingHostDependencyMessage('tmux', 'host runtime sessions'));
  }
  return error instanceof Error ? error : new Error(error?.message ?? String(error));
}

async function tmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('tmux', args, { encoding: 'utf8' });
    return { stdout, stderr };
  } catch (error: any) {
    throw wrapTmuxError(error);
  }
}

function tmuxErrorText(error: any): string {
  return [error?.message, error?.stderr, error?.stdout]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' | ')
    .slice(0, 2_000);
}

function tmuxErrorMeansSessionMissing(error: any): boolean {
  const text = tmuxErrorText(error).toLowerCase();
  return (
    text.includes("can't find session") ||
    text.includes('no such session') ||
    text.includes('no server running')
  );
}

async function probeSession(session: string): Promise<{
  status: SessionProbeStatus;
  error?: string;
}> {
  try {
    await tmux(['has-session', '-t', session]);
    try {
      const pane = await tmux(['display-message', '-p', '-t', `${session}:0.0`, '#{pane_dead}']);
      if (String(pane.stdout ?? '').trim() === '1') {
        // A dead pane can keep the session name reserved (for example when
        // remain-on-exit was enabled externally), so preserve the previous
        // best-effort cleanup without treating unrelated tmux errors as death.
        try {
          await killSession(session);
        } catch {
          // ignore cleanup failure; the dead pane is still strong evidence
        }
        return { status: 'missing' };
      }
    } catch {
      // If pane status cannot be read, fall back to "session exists".
    }
    return { status: 'alive' };
  } catch (error: any) {
    const detail = tmuxErrorText(error) || 'tmux session probe failed';
    return tmuxErrorMeansSessionMissing(error)
      ? { status: 'missing', error: detail }
      : { status: 'unknown', error: detail };
  }
}

async function sessionExists(session: string): Promise<boolean> {
  // Preserve the boolean API's historical semantics for non-prompt process
  // endpoints. Prompt lifecycle decisions use probeSession directly so an
  // unknown probe can never be mistaken for a confirmed missing session.
  return (await probeSession(session)).status === 'alive';
}

async function cleanupPromptSession(job: PromptJob): Promise<void> {
  try {
    await killSession(job.session);
  } catch {
    // The session normally disappears on its own. Cleanup is best-effort for
    // terminal-event inference and dead panes that tmux keeps around.
  }
}

function promptJobStartedAgeMs(job: PromptJob, nowMs: number): number | null {
  const startedMs = parseIsoLikeMs(job.startedAt);
  if (startedMs == null) return null;
  return Math.max(0, nowMs - startedMs);
}

function sameSessionProbe(
  left: SessionProbe | undefined,
  right: SessionProbe | undefined,
): boolean {
  if (!left || !right) return left === right;
  const { checkedAt: _leftCheckedAt, ...leftStable } = left;
  const { checkedAt: _rightCheckedAt, ...rightStable } = right;
  return JSON.stringify(leftStable) === JSON.stringify(rightStable);
}

async function advanceRunningPromptJob(job: PromptJob): Promise<PromptJob> {
  const exitCode = await readIntSafe(job.exitPath);
  const wrapperState = await readPromptWrapperState(job);
  const wrapperFinished =
    (wrapperState?.phase === 'finished' || wrapperState?.phase === 'exited') &&
    typeof wrapperState.exitCode === 'number' &&
    Number.isFinite(wrapperState.exitCode);
  if (exitCode != null || wrapperFinished) {
    return await finalizePromptJob(job, { allowTerminalSuccess: true, settleMs: 2_000 });
  }

  const now = nowIso();
  const nowMs = Date.parse(now);
  const terminalStatus = await promptTranscriptTerminalStatus(job);
  const terminalObservedStatus = terminalStatus ?? job.terminalObservedStatus;
  const terminalObservedAt = terminalStatus
    ? terminalStatus === job.terminalObservedStatus
      ? (job.terminalObservedAt ?? now)
      : now
    : job.terminalObservedAt;
  const terminalObservedMs = parseIsoLikeMs(terminalObservedAt);
  if (
    terminalObservedStatus &&
    terminalObservedMs != null &&
    nowMs - terminalObservedMs >= PROMPT_TERMINAL_EXIT_GRACE_MS
  ) {
    const next = await finalizePromptJob(
      { ...job, terminalObservedAt, terminalObservedStatus },
      { allowTerminalSuccess: true, settleMs: 500 },
    );
    await cleanupPromptSession(job);
    return next;
  }

  const probe = await probeSession(job.session);
  if (probe.status === 'alive') {
    if (
      !job.sessionProbe &&
      terminalObservedAt === job.terminalObservedAt &&
      terminalObservedStatus === job.terminalObservedStatus
    )
      return job;
    return {
      ...job,
      updatedAt: now,
      sessionProbe: undefined,
      terminalObservedAt,
      terminalObservedStatus,
    };
  }

  const stdoutBytes = await fileSizeSafe(job.stdoutPath);
  const heartbeatAgeMs = await promptHeartbeatAgeMs(job, nowMs);
  const heartbeatFresh =
    heartbeatAgeMs != null && heartbeatAgeMs <= PROMPT_WRAPPER_HEARTBEAT_FRESH_MS;
  const outputAdvanced =
    typeof job.sessionProbe?.stdoutBytes === 'number' && stdoutBytes > job.sessionProbe.stdoutBytes;

  if (probe.status === 'unknown') {
    const nextProbe: SessionProbe = {
      status: 'unknown',
      checkedAt: now,
      ...(probe.error ? { error: probe.error } : {}),
      stdoutBytes,
    };
    if (job.sessionProbe?.status !== 'unknown' || job.sessionProbe?.error !== probe.error) {
      // eslint-disable-next-line no-console
      console.warn(`prompt session probe unknown for ${job.id}: ${probe.error ?? 'unknown error'}`);
    }
    if (
      sameSessionProbe(job.sessionProbe, nextProbe) &&
      terminalObservedAt === job.terminalObservedAt &&
      terminalObservedStatus === job.terminalObservedStatus
    ) {
      return job;
    }
    return {
      ...job,
      updatedAt: now,
      sessionProbe: nextProbe,
      terminalObservedAt,
      terminalObservedStatus,
    };
  }

  const priorMissing = job.sessionProbe?.status === 'missing' ? job.sessionProbe : undefined;
  const missingSince =
    heartbeatFresh || outputAdvanced ? undefined : (priorMissing?.missingSince ?? now);
  const consecutiveMissing =
    heartbeatFresh || outputAdvanced ? 0 : (priorMissing?.consecutiveMissing ?? 0) + 1;
  const nextProbe: SessionProbe = {
    status: 'missing',
    checkedAt: now,
    consecutiveMissing,
    ...(missingSince ? { missingSince } : {}),
    ...(probe.error ? { error: probe.error } : {}),
    stdoutBytes,
  };
  const missingSinceMs = parseIsoLikeMs(missingSince) ?? nowMs;
  const startedAgeMs = promptJobStartedAgeMs(job, nowMs);
  const startupGraceElapsed =
    startedAgeMs == null || startedAgeMs >= PROMPT_WRAPPER_HEARTBEAT_FRESH_MS;
  const confirmedMissing =
    !heartbeatFresh &&
    !outputAdvanced &&
    startupGraceElapsed &&
    consecutiveMissing >= PROMPT_SESSION_MISSING_CONFIRMATIONS &&
    nowMs - missingSinceMs >= PROMPT_SESSION_MISSING_GRACE_MS;

  if (confirmedMissing) {
    // eslint-disable-next-line no-console
    console.warn(
      `prompt session confirmed missing for ${job.id} after ${consecutiveMissing} probes` +
        (probe.error ? `: ${probe.error}` : ''),
    );
    // The heartbeat is written while the wrapper is actually alive. If the machine was off
    // between its last heartbeat and this recovery probe, using detection time would count that
    // downtime as agent runtime.
    const lastHeartbeatAt = await promptHeartbeatAt(job, nowMs);
    const next = await finalizePromptJob(
      { ...job, sessionProbe: nextProbe, terminalObservedAt, terminalObservedStatus },
      {
        allowTerminalSuccess: true,
        settleMs: 2_000,
        ...(lastHeartbeatAt ? { finishedAt: lastHeartbeatAt } : {}),
      },
    );
    await cleanupPromptSession(job);
    return next;
  }

  if (
    sameSessionProbe(job.sessionProbe, nextProbe) &&
    terminalObservedAt === job.terminalObservedAt &&
    terminalObservedStatus === job.terminalObservedStatus
  ) {
    return job;
  }
  return {
    ...job,
    updatedAt: now,
    sessionProbe: nextProbe,
    terminalObservedAt,
    terminalObservedStatus,
  };
}

async function recoverLatePromptCompletion(job: PromptJob): Promise<PromptJob> {
  if (job.state !== 'failed' || job.exitStatusSource !== 'missing-exit-file') return job;
  const exitCode = await readIntSafe(job.exitPath);
  const wrapperState = await readPromptWrapperState(job);
  const wrapperFinished =
    (wrapperState?.phase === 'finished' || wrapperState?.phase === 'exited') &&
    typeof wrapperState.exitCode === 'number' &&
    Number.isFinite(wrapperState.exitCode);
  const terminalStatus = await promptTranscriptTerminalStatus(job);
  if (exitCode == null && !wrapperFinished && terminalStatus !== 'success') return job;
  const next = await finalizePromptJob(job, { allowTerminalSuccess: true, settleMs: 500 });
  if (next.state === 'done') {
    // eslint-disable-next-line no-console
    console.warn(`recovered late prompt completion for ${job.id}`);
  }
  return next;
}

async function startSession(opts: {
  session: string;
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}): Promise<void> {
  const args: string[] = ['new-session', '-d', '-s', opts.session];
  if (opts.cwd) args.push('-c', opts.cwd);

  const cmdArgs: string[] = [];
  if (opts.env && Object.keys(opts.env).length > 0) {
    cmdArgs.push('env');
    for (const [k, v] of Object.entries(opts.env)) cmdArgs.push(`${k}=${v}`);
  }
  cmdArgs.push(opts.cmd, ...(opts.args ?? []));

  await tmux([...args, ...cmdArgs]);
  try {
    // Avoid "dead pane still has a session" states for daemon-managed jobs/processes.
    await tmux(['set-window-option', '-t', `${opts.session}:0`, 'remain-on-exit', 'off']);
  } catch {
    // ignore (best-effort; older tmux variants may differ)
  }
}

async function killSession(session: string): Promise<void> {
  await tmux(['kill-session', '-t', session]);
}

async function sendText(session: string, text: string, enter: boolean): Promise<void> {
  await tmux(['send-keys', '-t', `${session}:0.0`, text]);
  if (enter) {
    // Some TUIs (notably the Cursor Agent TUI) can miss a "submit" when the Enter key
    // is sent immediately after typing. A tiny delay makes submission reliable.
    await sleep(60);
    // Prefer explicit carriage return (C-m) over "Enter" to avoid apps that treat
    // line-feed/newline differently from submit.
    await tmux(['send-keys', '-t', `${session}:0.0`, 'C-m']);
  }
}

function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase();
  if (k === 'ctrl+c' || k === 'c-c') return 'C-c';
  if (k === 'ctrl+d' || k === 'c-d') return 'C-d';
  if (k === 'esc' || k === 'escape') return 'Escape';
  if (k === 'shift+tab' || k === 'backtab' || k === 'btab') return 'BTab';
  if (k === 'enter' || k === 'return') return 'C-m';
  if (k === 'tab') return 'Tab';
  if (k === 'up') return 'Up';
  if (k === 'down') return 'Down';
  if (k === 'left') return 'Left';
  if (k === 'right') return 'Right';
  return key;
}

async function sendKeys(session: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await tmux(['send-keys', '-t', `${session}:0.0`, normalizeKey(key)]);
  }
}

async function tmuxLoadBufferFromStdin(bufferName: string, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tmux', ['load-buffer', '-b', bufferName, '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err) => reject(wrapTmuxError(err)));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error((stderr || `tmux load-buffer failed with code ${String(code ?? 1)}`).trim()),
      );
    });
    try {
      child.stdin.end(text, 'utf8');
    } catch (e: any) {
      reject(new Error(e?.message ?? String(e)));
    }
  });
}

async function pasteRawText(session: string, text: string): Promise<void> {
  const payload = String(text ?? '');
  if (!payload) return;
  const bufferName = `drone-terminal-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  await tmuxLoadBufferFromStdin(bufferName, payload);
  await tmux(['paste-buffer', '-d', '-b', bufferName, '-t', `${session}:0.0`]);
}

async function pipePaneToFile(session: string, filePath: string): Promise<void> {
  await tmux(['pipe-pane', '-o', '-t', `${session}:0.0`, `cat >> ${filePath}`]);
}

async function capturePromptLine(session: string): Promise<string> {
  try {
    const target = `${session}:0.0`;
    const cur = await tmux(['display-message', '-p', '-t', target, '#{cursor_y}']);
    const cursorY = Number(String(cur.stdout ?? '').trim());
    if (Number.isFinite(cursorY) && cursorY >= 0) {
      const { stdout } = await tmux([
        'capture-pane',
        '-p',
        '-t',
        target,
        '-S',
        String(Math.floor(cursorY)),
        '-E',
        String(Math.floor(cursorY)),
      ]);
      const line = String(stdout ?? '').replace(/\r?\n$/, '');
      if (line) return line;
    }
    // Fallback for older tmux versions/edge states.
    const { stdout } = await tmux(['capture-pane', '-p', '-t', target, '-S', '-1', '-E', '-1']);
    return String(stdout ?? '').replace(/\r?\n$/, '');
  } catch {
    return '';
  }
}

async function captureScreenText(session: string, tailLinesRaw: number): Promise<string> {
  try {
    const target = `${session}:0.0`;
    const tailLines = Math.max(20, Math.min(5000, Math.floor(tailLinesRaw || 200)));
    const { stdout } = await tmux(['capture-pane', '-p', '-t', target, '-S', String(-tailLines)]);
    return String(stdout ?? '');
  } catch {
    try {
      const { stdout } = await tmux(['capture-pane', '-p', '-t', `${session}:0.0`]);
      return String(stdout ?? '');
    } catch {
      return '';
    }
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isSafeSessionName(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 64) return false;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

let cachedDvmSessionsRoot: string | null = null;
let cachedDvmSessionsRootKey: string | null = null;
let configuredDataDir = '';
async function resolveDvmSessionsRoot(): Promise<string> {
  const cacheKey = configuredDataDir;
  if (cachedDvmSessionsRoot && cachedDvmSessionsRootKey === cacheKey) return cachedDvmSessionsRoot;
  const preferred = preferredTerminalSessionLogsRoot(configuredDataDir);
  const dvm = '/dvm-data/dvm-sessions';
  const tmp = '/tmp/dvm-sessions';
  if (preferred === dvm) {
    cachedDvmSessionsRoot = dvm;
    cachedDvmSessionsRootKey = cacheKey;
    return dvm;
  }
  if (await fileExists(preferred)) {
    cachedDvmSessionsRoot = preferred;
    cachedDvmSessionsRootKey = cacheKey;
    return preferred;
  }
  if (await fileExists(tmp)) {
    cachedDvmSessionsRoot = tmp;
    cachedDvmSessionsRootKey = cacheKey;
    return tmp;
  }
  if (await fileExists(dvm)) {
    cachedDvmSessionsRoot = dvm;
    cachedDvmSessionsRootKey = cacheKey;
    return dvm;
  }
  cachedDvmSessionsRoot = preferred;
  cachedDvmSessionsRootKey = cacheKey;
  return preferred;
}

async function sessionLogPathFor(session: string): Promise<string> {
  const root = await resolveDvmSessionsRoot();
  return path.join(root, session, 'output.log');
}

async function readSessionLogChunk(
  logPath: string,
  sinceRaw: number,
  maxRaw: number,
): Promise<{ chunk: string; nextOffset: number }> {
  const max = Math.max(1, Math.min(1024 * 1024, Math.floor(maxRaw || 65536)));
  let fileSize = 0;
  try {
    const st = await fs.stat(logPath);
    fileSize = Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
  } catch {
    fileSize = 0;
  }

  const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : 0;
  const offset = Math.min(since, fileSize);
  if (fileSize <= 0 || offset >= fileSize) {
    return { chunk: '', nextOffset: offset };
  }

  try {
    const fh = await fs.open(logPath, 'r');
    try {
      const buf = Buffer.alloc(max);
      const { bytesRead } = await fh.read(buf, 0, max, offset);
      const chunk = buf.subarray(0, bytesRead).toString('utf8');
      return { chunk, nextOffset: offset + bytesRead };
    } finally {
      await fh.close();
    }
  } catch {
    return { chunk: '', nextOffset: offset };
  }
}

async function main() {
  const host = parseArg(process.argv, '--host') ?? '0.0.0.0';
  const portRaw = parseArg(process.argv, '--port') ?? '7777';
  const dataDir = parseArg(process.argv, '--data-dir') ?? '/dvm-data/drone';
  configuredDataDir = dataDir;
  const token = parseArg(process.argv, '--token');
  const tokenFile = parseArg(process.argv, '--token-file') ?? path.join(dataDir, 'token');

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid --port: ${portRaw}`);

  let resolvedToken = token;
  if (!resolvedToken) resolvedToken = (await fs.readFile(tokenFile, 'utf8')).trim();
  if (!resolvedToken) throw new Error('missing token (use --token or --token-file)');

  const statePath = path.join(dataDir, 'state.json');
  const logsDir = path.join(dataDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });

  const promptsDir = path.join(dataDir, 'prompts');
  const promptJobsDir = path.join(promptsDir, 'jobs');
  const promptRunsDir = path.join(promptsDir, 'runs');
  const promptOutDir = path.join(promptsDir, 'out');
  await ensureDir(promptJobsDir);
  await ensureDir(promptRunsDir);
  await ensureDir(promptOutDir);
  let promptMutationTail: Promise<void> = Promise.resolve();
  let promptPumpInFlight: Promise<void> | null = null;
  const promptLateRecoveryLastChecked = new Map<string, number>();
  const codexRestartResumesInFlight = new Set<string>();

  async function withPromptMutationLock<T>(run: () => Promise<T>): Promise<T> {
    const result = promptMutationTail.then(run, run);
    promptMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
  }

  const codexPromptRuns = new CodexPromptRunManager<CodexPromptJob>({
    loadMessage: async (id) => {
      const job = await loadPromptJob(promptsDir, id);
      return job?.codexAppServer ? (job as CodexPromptJob) : null;
    },
    saveMessage: (job) => savePromptJob(promptsDir, job),
    createRun: async (job, startedAt) => {
      const stdoutPath = path.join(promptOutDir, `run-${job.id}.stdout.txt`);
      const stderrPath = path.join(promptOutDir, `run-${job.id}.stderr.txt`);
      await fs.writeFile(stdoutPath, '', 'utf8');
      await fs.writeFile(stderrPath, '', 'utf8');
      return {
        id: job.id,
        sessionKey: job.codexAppServer.sessionKey,
        state: 'running',
        messageIds: [job.id],
        responseMessageId: job.id,
        createdAt: job.createdAt,
        updatedAt: startedAt,
        startedAt,
        stdoutPath,
        stderrPath,
      };
    },
    loadRun: (id) => loadCodexPromptRun(promptsDir, id),
    saveRun: (run) => saveCodexPromptRun(promptsDir, run),
    appendRunEvents: async (run, events) => {
      if (events.length === 0) return run;
      const text = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
      await fs.appendFile(run.stdoutPath, text, 'utf8');
      const refreshed = await refreshCodexPromptRun({ ...run, updatedAt: nowIso() });
      await saveCodexPromptRun(promptsDir, refreshed);
      const responseMessage = await loadPromptJob(promptsDir, refreshed.responseMessageId);
      if (responseMessage?.codexAppServer) {
        await savePromptJob(promptsDir, {
          ...responseMessage,
          updatedAt: refreshed.updatedAt,
        });
      }
      return refreshed;
    },
    appendRunStderr: async (run, text) => {
      await fs.appendFile(run.stderrPath, text, 'utf8');
    },
    mutate: withPromptMutationLock,
    now: nowIso,
  });
  let daemonShuttingDown = false;

  async function pumpPromptsUnlocked(): Promise<void> {
    const idx = await loadPromptIndex(promptsDir);
    const order = Array.isArray(idx.order) ? idx.order.map(String).filter(Boolean) : [];
    const orderSet = new Set(order);
    for (const id of promptLateRecoveryLastChecked.keys()) {
      if (!orderSet.has(id)) promptLateRecoveryLastChecked.delete(id);
    }
    // First, reconcile running jobs from durable wrapper artifacts and a
    // corroborated tmux probe. Also revisit provisional missing-exit failures
    // so a late exit/terminal event can repair the persisted result.
    for (const id of order) {
      const job = await loadPromptJob(promptsDir, id);
      if (!job) continue;
      if (job.codexAppServer && (job.state === 'queued' || job.state === 'running')) {
        const owned = codexPromptRuns.ownsMessage(job as CodexPromptJob);
        const action = codexDaemonRestartRecoveryAction({
          state: job.state,
          owned: owned || codexRestartResumesInFlight.has(job.id),
          createdAt: job.createdAt,
        });
        if (action === 'resume-queued') {
          // Queued work has not started and is safe to resume. Schedule outside
          // the prompt mutation lock because enqueue persists its own run state.
          codexRestartResumesInFlight.add(job.id);
          setImmediate(() => {
            void codexPromptRuns
              .enqueue(job as CodexPromptJob)
              .catch((error) => {
                // startRun normally persists its own failure; keep an explicit
                // daemon diagnostic for failures before a run can be created.
                // eslint-disable-next-line no-console
                console.error(
                  `Codex queued prompt resume failed for ${job.id}: ${String(error?.message ?? error)}`,
                );
              })
              .finally(() => codexRestartResumesInFlight.delete(job.id));
          });
        } else if (action === 'fail-running') {
          await codexPromptRuns.failInterrupted(
            job as CodexPromptJob,
            'Codex App Server session was interrupted by a daemon restart',
            true,
          );
        }
        continue;
      }
      if (job.state === 'running') {
        const next = await advanceRunningPromptJob(job);
        if (next !== job) await savePromptJob(promptsDir, next);
        continue;
      }
      if (job.state === 'failed' && job.exitStatusSource === 'missing-exit-file') {
        const checkedAt = promptLateRecoveryLastChecked.get(id) ?? 0;
        if (Date.now() - checkedAt < PROMPT_LATE_RECOVERY_POLL_MS) continue;
        promptLateRecoveryLastChecked.set(id, Date.now());
        const next = await recoverLatePromptCompletion(job);
        if (next !== job) {
          promptLateRecoveryLastChecked.delete(id);
          await savePromptJob(promptsDir, next);
        }
      }
    }

    // Start next queued if none running.
    const anyRunning = await (async () => {
      for (const id of order) {
        const job = await loadPromptJob(promptsDir, id);
        if (job && job.state === 'running' && !job.codexAppServer) return true;
      }
      return false;
    })();
    if (anyRunning) return;

    const candidates = (await Promise.all(order.map((id) => loadPromptJob(promptsDir, id)))).filter(
      (job): job is PromptJob => Boolean(job) && !job?.codexAppServer,
    );
    const startId = selectNextPromptJobId(candidates);
    if (!startId) return;
    const job = await loadPromptJob(promptsDir, startId);
    if (!job) return;
    const startedAt = nowIso();
    const running: PromptJob = { ...job, state: 'running', startedAt, updatedAt: startedAt };
    await savePromptJob(promptsDir, running);
    await startPromptJob(running);
  }

  function pumpPrompts(): Promise<void> {
    if (promptPumpInFlight) return promptPumpInFlight;
    const current = withPromptMutationLock(pumpPromptsUnlocked);
    promptPumpInFlight = current;
    const clearCurrent = () => {
      if (promptPumpInFlight === current) promptPumpInFlight = null;
    };
    void current.then(clearCurrent, clearCurrent);
    return current;
  }

  // Resume any queued/running prompts on daemon restart.
  setInterval(() => {
    void pumpPrompts().catch((error) => {
      // eslint-disable-next-line no-console
      console.error(`prompt pump failed: ${String(error?.message ?? error)}`);
    });
  }, 400);
  void pumpPrompts().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`initial prompt pump failed: ${String(error?.message ?? error)}`);
  });
  const codexIdleSweep = setInterval(() => {
    codexPromptRuns.sweepIdle(CODEX_APP_SERVER_IDLE_MS);
  }, 60_000);
  (codexIdleSweep as any).unref?.();

  async function readState(): Promise<DroneState> {
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      return JSON.parse(raw) as DroneState;
    } catch {
      return {};
    }
  }
  async function writeState(s: DroneState): Promise<void> {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(s, null, 2), 'utf8');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = u.pathname;
      const method = (req.method ?? 'GET').toUpperCase();

      const auth = String(req.headers.authorization ?? '');
      if (auth !== `Bearer ${resolvedToken}`) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }

      if (method === 'GET' && pathname === '/v1/health') {
        json(res, 200, {
          ok: true,
          name: 'drone-daemon',
          time: new Date().toISOString(),
          capabilities: DRONE_DAEMON_CAPABILITIES,
        });
        return;
      }

      if (await handleDaemonManagedStateRequest({ req, res, method, pathname, dataDir })) return;
      if (await handleDaemonWorkspaceRequest({ req, res, method, pathname, url: u })) return;

      if (method === 'POST' && pathname === '/v1/codex/enqueue') {
        const body = await readJson(req);
        const id = String(body?.id ?? '').trim();
        const sessionKey = String(body?.sessionKey ?? '').trim();
        const launchScript = String(body?.launchScript ?? '').trim();
        const prompt = String(body?.prompt ?? '');
        if (!id || !sessionKey || !launchScript || !prompt.trim()) {
          json(res, 400, { error: 'id, sessionKey, launchScript, and prompt are required' });
          return;
        }
        const deliveryMode = body?.deliveryMode === 'asap' ? 'asap' : 'queue';
        const createdAt = nowIso();
        const session = promptSessionName(id);
        const spec: CodexPromptSpec = {
          sessionKey,
          launchScript,
          prompt,
          ...(Array.isArray(body?.imagePaths)
            ? {
                imagePaths: body.imagePaths
                  .filter(
                    (value: unknown): value is string =>
                      typeof value === 'string' && value.trim().startsWith('/'),
                  )
                  .map((value: string) => value.trim())
                  .slice(0, 8),
              }
            : {}),
          ...(typeof body?.existingThreadId === 'string' && body.existingThreadId.trim()
            ? { existingThreadId: body.existingThreadId.trim() }
            : {}),
          ...(typeof body?.forkThreadId === 'string' && body.forkThreadId.trim()
            ? { forkThreadId: body.forkThreadId.trim() }
            : {}),
          ...(body?.approvalPolicy === 'untrusted' ||
          body?.approvalPolicy === 'on-request' ||
          body?.approvalPolicy === 'never'
            ? { approvalPolicy: body.approvalPolicy }
            : {}),
          ...(body?.approvalsReviewer === 'user' || body?.approvalsReviewer === 'auto_review'
            ? { approvalsReviewer: body.approvalsReviewer }
            : {}),
          ...(body?.sandbox === 'read-only' ||
          body?.sandbox === 'workspace-write' ||
          body?.sandbox === 'danger-full-access'
            ? { sandbox: body.sandbox }
            : {}),
          ...(typeof body?.model === 'string' && body.model.trim()
            ? { model: body.model.trim() }
            : {}),
          ...(typeof body?.effort === 'string' && body.effort.trim()
            ? { effort: body.effort.trim() }
            : {}),
        };
        const job: CodexPromptJob = {
          id,
          kind: 'codex',
          cmd: 'codex-app-server',
          args: [],
          createdAt,
          updatedAt: createdAt,
          state: 'queued',
          deliveryMode,
          session,
          stdoutPath: path.join(promptOutDir, `${id}.stdout.txt`),
          stderrPath: path.join(promptOutDir, `${id}.stderr.txt`),
          exitPath: path.join(promptOutDir, `${id}.exit.txt`),
          codexAppServer: spec,
        };
        const existing = await withPromptMutationLock(async () => {
          const current = await loadPromptJob(promptsDir, id);
          if (current) return current;
          await savePromptJob(promptsDir, job);
          const idx = await loadPromptIndex(promptsDir);
          const order = Array.isArray(idx.order) ? idx.order.map(String) : [];
          if (!order.includes(id)) order.push(id);
          idx.order = order.slice(-400);
          await savePromptIndex(promptsDir, idx);
          return null;
        });
        if (existing) {
          json(res, 200, { ok: true, id, state: existing.state, note: 'already exists' });
          return;
        }
        const enqueueResult = await codexPromptRuns.enqueue(job);
        const decidedAt = nowIso();
        await withPromptMutationLock(async () => {
          const latest = await loadPromptJob(promptsDir, id);
          if (!latest) return;
          await savePromptJob(promptsDir, {
            ...latest,
            diagnostics: {
              ...latest.diagnostics,
              codexEnqueue: {
                decidedAt,
                requestedDeliveryMode: deliveryMode,
                disposition: enqueueResult.disposition,
                ...(enqueueResult.steering ? { steering: enqueueResult.steering } : {}),
              },
            },
          });
        });
        const current = await loadPromptJob(promptsDir, id);
        const projected = current?.codexAppServer
          ? await projectCodexPromptJob(promptsDir, current as CodexPromptJob)
          : current;
        json(res, 202, {
          ok: true,
          id,
          state: projected?.state ?? job.state,
          disposition: enqueueResult.disposition,
          ...(enqueueResult.steering ? { steering: enqueueResult.steering } : {}),
          ...(projected?.codexAppServer?.threadId
            ? { threadId: projected.codexAppServer.threadId }
            : {}),
          ...(projected?.codexAppServer?.turnId ? { turnId: projected.codexAppServer.turnId } : {}),
          ...(projected?.codexAppServer?.run?.id ? { runId: projected.codexAppServer.run.id } : {}),
        });
        return;
      }

      if (method === 'POST' && pathname === '/v1/prompts/enqueue') {
        const body = await readJson(req);
        const id = String(body?.id ?? '').trim();
        if (!id) {
          json(res, 400, { error: 'missing id' });
          return;
        }
        const cmd = String(body?.cmd ?? '').trim();
        if (!cmd) {
          json(res, 400, { error: 'missing cmd' });
          return;
        }
        const args = Array.isArray(body?.args)
          ? body.args.filter((x: any) => typeof x === 'string')
          : [];
        const cwd = typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
        const kind = String(body?.kind ?? 'shell').trim() || 'shell';
        const deliveryMode = body?.deliveryMode === 'asap' ? 'asap' : 'queue';
        const env =
          body?.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (Object.fromEntries(
                Object.entries(body.env).filter(([, v]) => typeof v === 'string'),
              ) as Record<string, string>)
            : undefined;

        const session = promptSessionName(id);
        const stdoutPath = path.join(promptOutDir, `${id}.stdout.txt`);
        const stderrPath = path.join(promptOutDir, `${id}.stderr.txt`);
        const exitPath = path.join(promptOutDir, `${id}.exit.txt`);
        const wrapperPath = path.join(promptOutDir, `${id}.wrapper.log`);
        const wrapperStatePath = path.join(promptOutDir, `${id}.wrapper-state.json`);
        const heartbeatPath = path.join(promptOutDir, `${id}.heartbeat`);

        const createdAt = nowIso();
        const job: PromptJob = {
          id,
          kind,
          cmd,
          args,
          cwd,
          env,
          createdAt,
          updatedAt: createdAt,
          state: 'queued',
          deliveryMode,
          session,
          stdoutPath,
          stderrPath,
          exitPath,
          wrapperPath,
          wrapperStatePath,
          heartbeatPath,
        };
        const existing = await withPromptMutationLock(async () => {
          const current = await loadPromptJob(promptsDir, id);
          if (current) return current;
          await savePromptJob(promptsDir, job);
          const idx = await loadPromptIndex(promptsDir);
          const order = Array.isArray(idx.order) ? idx.order.map(String) : [];
          if (!order.includes(id)) order.push(id);
          idx.order = order.slice(-400);
          await savePromptIndex(promptsDir, idx);
          return null;
        });
        if (existing) {
          json(res, 200, { ok: true, id, state: existing.state, note: 'already exists' });
          return;
        }
        void pumpPrompts();
        json(res, 202, { ok: true, id, state: 'queued' });
        return;
      }

      if (method === 'GET' && pathname === '/v1/prompts/events') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache, no-transform');
        res.setHeader('connection', 'keep-alive');
        writeSseEvent(res, 'ready', { ok: true, at: nowIso() });

        let closed = false;
        let lastById = new Map<string, string>();
        let initialized = false;
        const emitChanges = async (snapshot = false) => {
          await pumpPrompts();
          const nextById = await buildPromptJobEventSnapshot(promptsDir);
          if (snapshot || !initialized) {
            lastById = nextById;
            initialized = true;
            const jobs = Array.from(nextById.values()).flatMap((raw) => {
              try {
                return [JSON.parse(raw)];
              } catch {
                return [];
              }
            });
            writeSseEvent(res, 'snapshot', { ok: true, jobs, at: nowIso() });
            return;
          }

          for (const [id, serialized] of nextById.entries()) {
            if (lastById.get(id) === serialized) continue;
            try {
              writeSseEvent(res, 'job', { ok: true, job: JSON.parse(serialized), at: nowIso() });
            } catch {
              // ignore malformed local state
            }
          }
          lastById = nextById;
        };

        const keepAlive = setInterval(() => {
          if (res.destroyed || res.writableEnded) return;
          res.write(': keepalive\n\n');
        }, 25_000);
        (keepAlive as any).unref?.();

        req.on('close', () => {
          closed = true;
          clearInterval(keepAlive);
        });
        res.on('close', () => {
          closed = true;
          clearInterval(keepAlive);
        });

        try {
          await emitChanges(true);
          while (!closed) {
            await sleep(250);
            if (closed) break;
            await emitChanges();
          }
        } catch (e: any) {
          writeSseEvent(res, 'stream-error', { ok: false, error: e?.message ?? String(e) });
          closed = true;
          clearInterval(keepAlive);
          if (!res.destroyed && !res.writableEnded) res.end();
        }
        return;
      }

      const promptMatch = pathname.match(/^\/v1\/prompts\/([^/]+)$/);
      if (method === 'GET' && promptMatch) {
        const id = decodeURIComponent(promptMatch[1] ?? '');
        const job = await withPromptMutationLock(async () => {
          const current = await loadPromptJob(promptsDir, id);
          if (!current) return null;
          if (current.codexAppServer?.runId) {
            const run = await loadCodexPromptRun(promptsDir, current.codexAppServer.runId);
            if (run) {
              const refreshed = await refreshCodexPromptRun(run);
              await saveCodexPromptRun(promptsDir, refreshed);
            }
            return await projectCodexPromptJob(promptsDir, current as CodexPromptJob);
          }
          // Best-effort reconcile from wrapper artifacts and corroborated
          // session liveness if it changed since the last pump.
          if (current.state === 'running') {
            if (current.codexAppServer) {
              const next = await refreshPromptJobTranscript(current);
              if (next !== current) await savePromptJob(promptsDir, next);
              return next;
            }
            let next = await advanceRunningPromptJob(current);
            if (next.state === 'running') next = await refreshPromptJobTranscript(next);
            if (next !== current) await savePromptJob(promptsDir, next);
            return next;
          }
          if (current.state === 'failed' && current.exitStatusSource === 'missing-exit-file') {
            const next = await recoverLatePromptCompletion(current);
            if (next !== current) {
              promptLateRecoveryLastChecked.delete(id);
              await savePromptJob(promptsDir, next);
              return next;
            }
          }
          if (
            (current.state === 'done' || current.state === 'failed') &&
            !promptJobHasParsedTranscript(current)
          ) {
            const next = await refreshPromptJobTranscript(current);
            if (next !== current) {
              await savePromptJob(promptsDir, next);
              return next;
            }
          }
          return current;
        });
        if (!job) {
          json(res, 404, { error: 'not found' });
          return;
        }
        json(res, 200, { ok: true, job });
        return;
      }

      const promptCancelMatch = pathname.match(/^\/v1\/prompts\/([^/]+)\/cancel$/);
      const promptApprovalMatch = pathname.match(
        /^\/v1\/prompts\/([^/]+)\/approvals\/([^/]+)\/(accept|acceptForSession|decline|cancel)$/,
      );
      if (method === 'POST' && promptApprovalMatch) {
        const promptId = decodeURIComponent(promptApprovalMatch[1] ?? '');
        const approvalId = decodeURIComponent(promptApprovalMatch[2] ?? '');
        const decision = promptApprovalMatch[3] as
          | 'accept'
          | 'acceptForSession'
          | 'decline'
          | 'cancel';
        const current = await loadPromptJob(promptsDir, promptId);
        if (!current?.codexAppServer) {
          json(res, 404, { error: 'Codex prompt not found' });
          return;
        }
        try {
          const approval = await codexPromptRuns.resolveApproval(
            current as CodexPromptJob,
            approvalId,
            decision,
          );
          const latest = (await loadPromptJob(promptsDir, promptId)) ?? current;
          const projected = latest.codexAppServer
            ? await projectCodexPromptJob(promptsDir, latest as CodexPromptJob)
            : latest;
          json(res, 200, { ok: true, approval, decision, job: projected });
        } catch (error: any) {
          const message = String(error?.message ?? error);
          json(res, /unknown Codex approval|no longer active/i.test(message) ? 404 : 409, {
            error: message,
          });
        }
        return;
      }

      if (method === 'POST' && promptCancelMatch) {
        const id = decodeURIComponent(promptCancelMatch[1] ?? '');
        const current = await withPromptMutationLock(() => loadPromptJob(promptsDir, id));
        if (current?.codexAppServer) {
          const next = await codexPromptRuns.cancel(current as CodexPromptJob);
          const projected = await projectCodexPromptJob(promptsDir, next);
          json(res, 200, { ok: true, job: projected });
          return;
        }
        const next = await withPromptMutationLock(async () => {
          const latest = await loadPromptJob(promptsDir, id);
          if (!latest) return null;
          const canceled = await cancelPromptJob(latest);
          await savePromptJob(promptsDir, canceled);
          return canceled;
        });
        if (!next) {
          json(res, 404, { error: 'not found' });
          return;
        }
        void pumpPrompts();
        json(res, 200, { ok: true, job: next });
        return;
      }

      if (method === 'GET' && pathname === '/v1/status') {
        const state = await readState();
        const proc = state.process;
        if (!proc) {
          json(res, 200, { ok: true, process: null });
          return;
        }
        const running = await sessionExists(proc.session);
        json(res, 200, { ok: true, process: { ...proc, running } });
        return;
      }

      if (method === 'POST' && pathname === '/v1/process/start') {
        const body = await readJson(req);
        const cmd = String(body?.cmd ?? '');
        if (!cmd) {
          json(res, 400, { error: 'missing cmd' });
          return;
        }
        const args = Array.isArray(body?.args)
          ? body.args.filter((x: any) => typeof x === 'string')
          : [];
        const cwd = typeof body?.cwd === 'string' ? body.cwd : undefined;
        const session =
          typeof body?.session === 'string' && body.session ? body.session : 'drone-main';
        const env =
          body?.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (Object.fromEntries(
                Object.entries(body.env).filter(([, v]) => typeof v === 'string'),
              ) as Record<string, string>)
            : undefined;
        const force = body?.force === true;
        const terminal = body?.terminal === true;

        const state = await readState();
        if (!terminal && state.process && !force) {
          json(res, 409, { error: 'process already exists', process: state.process });
          return;
        }

        const exists = await sessionExists(session);
        if (exists) {
          if (!force) {
            json(res, 409, { error: 'tmux session already exists', session });
            return;
          }
          await killSession(session);
        }

        const logPath = terminal
          ? await sessionLogPathFor(session)
          : path.join(logsDir, `${session}.log`);
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.writeFile(logPath, '', 'utf8');

        await startSession({ session, cmd, args, cwd, env });
        await pipePaneToFile(session, logPath);

        const processInfo = {
          session,
          cmd,
          args,
          cwd,
          env,
          logPath,
          startedAt: new Date().toISOString(),
        };
        if (!terminal) {
          const next: DroneState = {
            process: processInfo,
          };
          await writeState(next);
        }

        json(res, 200, { ok: true, process: processInfo });
        return;
      }

      if (method === 'POST' && pathname === '/v1/process/stop') {
        const body = await readJson(req);
        const state = await readState();
        const target =
          typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
        if (!target) {
          json(res, 400, { error: 'no process to stop' });
          return;
        }
        if (await sessionExists(target)) await killSession(target);
        if (state.process?.session === target) {
          await writeState({});
        }
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/input') {
        const body = await readJson(req);
        const text = String(body?.text ?? '');
        if (!text) {
          json(res, 400, { error: 'missing text' });
          return;
        }
        const enter = body?.enter !== false;
        const state = await readState();
        const target =
          typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
        if (!target) {
          json(res, 400, { error: 'no active process' });
          return;
        }
        await sendText(target, text, enter);
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/keys') {
        const body = await readJson(req);
        const keys = Array.isArray(body?.keys)
          ? body.keys.filter((x: any) => typeof x === 'string')
          : [];
        if (keys.length === 0) {
          json(res, 400, { error: 'missing keys' });
          return;
        }
        const state = await readState();
        const target =
          typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
        if (!target) {
          json(res, 400, { error: 'no active process' });
          return;
        }
        await sendKeys(target, keys);
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/terminal/input') {
        const body = await readJson(req);
        const session = String(body?.session ?? '').trim();
        const data = typeof body?.data === 'string' ? body.data : '';
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        if (!data) {
          json(res, 400, { error: 'missing data' });
          return;
        }
        if (Buffer.byteLength(data, 'utf8') > 128 * 1024) {
          json(res, 413, { error: 'input too large' });
          return;
        }
        const exists = await sessionExists(session);
        if (!exists) {
          json(res, 404, { error: `session not found: ${session}` });
          return;
        }
        await pasteRawText(session, data);
        json(res, 202, { ok: true, session, bytes: Buffer.byteLength(data, 'utf8') });
        return;
      }

      if (method === 'GET' && pathname === '/v1/terminal/output') {
        const session = String(u.searchParams.get('session') ?? '').trim();
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        const view = String(u.searchParams.get('view') ?? 'log')
          .trim()
          .toLowerCase();
        const since = Number(u.searchParams.get('since') ?? '0');
        const max = Number(u.searchParams.get('max') ?? '65536');
        const tail = Number(u.searchParams.get('tail') ?? '200');
        const logPath = await sessionLogPathFor(session);
        if (view === 'screen') {
          const exists = await sessionExists(session);
          if (!exists) {
            json(res, 404, { error: `session not found: ${session}` });
            return;
          }
          let nextOffset = 0;
          try {
            const st = await fs.stat(logPath);
            nextOffset = Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
          } catch {
            nextOffset = 0;
          }
          const text = await captureScreenText(session, tail);
          json(res, 200, {
            ok: true,
            session,
            view,
            chunk: text,
            nextOffset,
            logPath,
            tailLines: tail,
          });
          return;
        }
        const out = await readSessionLogChunk(logPath, since, max);
        json(res, 200, {
          ok: true,
          session,
          chunk: out.chunk,
          nextOffset: out.nextOffset,
          logPath,
        });
        return;
      }

      if (method === 'GET' && pathname === '/v1/terminal/prompt') {
        const session = String(u.searchParams.get('session') ?? '').trim();
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        const exists = await sessionExists(session);
        if (!exists) {
          json(res, 404, { error: `session not found: ${session}` });
          return;
        }
        const text = await capturePromptLine(session);
        json(res, 200, { ok: true, session, text });
        return;
      }

      if (method === 'GET' && pathname === '/v1/terminal/output/stream') {
        const session = String(u.searchParams.get('session') ?? '').trim();
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        const hasSince = u.searchParams.has('since');
        const since = Number(u.searchParams.get('since') ?? '0');
        const logPath = await sessionLogPathFor(session);
        const initial = await readSessionLogChunk(
          logPath,
          hasSince ? since : Number.MAX_SAFE_INTEGER,
          1,
        );
        let offset = initial.nextOffset;

        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write(
          `event: ready\ndata: ${JSON.stringify({ ok: true, session, since: offset })}\n\n`,
        );

        let closed = false;
        req.on('close', () => {
          closed = true;
        });

        while (!closed) {
          try {
            const out = await readSessionLogChunk(logPath, offset, 128 * 1024);
            if (out.chunk) {
              offset = out.nextOffset;
              res.write(
                `event: output\ndata: ${JSON.stringify({ chunk: out.chunk, nextOffset: offset })}\n\n`,
              );
            } else {
              offset = out.nextOffset;
            }
          } catch {
            // ignore transient read errors
          }
          await sleep(25);
        }
        return;
      }

      if (method === 'GET' && pathname === '/v1/output') {
        const state = await readState();
        const proc = state.process;
        if (!proc) {
          json(res, 200, { ok: true, chunk: '', nextOffset: 0, logPath: null });
          return;
        }
        const since = Number(u.searchParams.get('since') ?? '0');
        const max = Math.min(Number(u.searchParams.get('max') ?? '65536'), 1024 * 1024);
        const offset = Number.isFinite(since) && since >= 0 ? since : 0;

        try {
          const fh = await fs.open(proc.logPath, 'r');
          try {
            const buf = Buffer.alloc(max);
            const { bytesRead } = await fh.read(buf, 0, max, offset);
            const chunk = buf.subarray(0, bytesRead).toString('utf8');
            json(res, 200, {
              ok: true,
              chunk,
              nextOffset: offset + bytesRead,
              logPath: proc.logPath,
            });
          } finally {
            await fh.close();
          }
        } catch {
          json(res, 200, { ok: true, chunk: '', nextOffset: offset, logPath: proc.logPath });
        }
        return;
      }

      if (method === 'GET' && pathname === '/v1/output/stream') {
        const state = await readState();
        const proc = state.process;
        if (!proc) {
          res.statusCode = 404;
          res.end('no process');
          return;
        }
        let offset = Number(u.searchParams.get('since') ?? '0');
        if (!Number.isFinite(offset) || offset < 0) offset = 0;

        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, since: offset })}\n\n`);

        let closed = false;
        req.on('close', () => {
          closed = true;
        });

        while (!closed) {
          try {
            const fh = await fs.open(proc.logPath, 'r');
            try {
              const buf = Buffer.alloc(64 * 1024);
              const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
              if (bytesRead > 0) {
                const chunk = buf.subarray(0, bytesRead).toString('utf8');
                offset += bytesRead;
                res.write(
                  `event: output\ndata: ${JSON.stringify({ chunk, nextOffset: offset })}\n\n`,
                );
              }
            } finally {
              await fh.close();
            }
          } catch {
            // ignore transient read errors
          }
          await sleep(300);
        }
        return;
      }

      json(res, 404, { error: 'not found' });
    } catch (err: any) {
      const fileErrorCode = String(err?.code ?? '');
      const inferredStatus =
        fileErrorCode === 'ENOENT' || fileErrorCode === 'ENOTDIR'
          ? 404
          : fileErrorCode === 'EEXIST' || fileErrorCode === 'ENOTEMPTY'
            ? 409
            : 500;
      const status = err instanceof DaemonHttpError ? err.statusCode : inferredStatus;
      json(res, status, { error: err?.message ?? String(err) });
    }
  });

  const shutdown = () => {
    if (daemonShuttingDown) return;
    daemonShuttingDown = true;
    clearInterval(codexIdleSweep);
    codexPromptRuns.stop();
    server.close(() => process.exit(0));
    const forceExit = setTimeout(() => process.exit(0), 1_000);
    (forceExit as any).unref?.();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
  // eslint-disable-next-line no-console
  console.log(`drone-daemon listening on http://${host}:${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
