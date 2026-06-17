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
  FLEET_API_VERSION,
  type FleetPolicySnapshot,
  type FleetRequestIndex,
  type FleetRequestRecord,
  type FleetRequestState,
  type FleetRequestType,
} from './fleet/contracts';
import { parseBuiltinPromptJobTranscriptLines, type BuiltinPromptJobTranscript } from './hub/builtin-transcript-sessions';
import { preferredTerminalSessionLogsRoot } from './host/session-logs';
import { missingHostDependencyMessage } from './host/runtime';
import {
  findTaskById,
  filterTasksByTypeIds,
  firstTaskTypeId,
  normalizePendingTaskCreateRequest,
  normalizePendingTaskDeleteRequest,
  normalizeTaskStateSnapshot,
  searchTasks,
  taskSummaryForResponse,
  type PendingTaskCreateRequest,
  type PendingTaskDeleteRequest,
  type TaskStateSnapshot,
} from './task-state';

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
  session: string;
  stdoutPath: string;
  stderrPath: string;
  exitPath: string;
  wrapperPath?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  exitStatusSource?: 'exit-file' | 'missing-exit-file';
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
  failureReason?: string;
  error?: string;
};

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

function promptJobEventSummary(job: PromptJob) {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

async function buildPromptJobEventSnapshot(promptsDir: string): Promise<Map<string, string>> {
  const idx = await loadPromptIndex(promptsDir);
  const order = Array.isArray(idx.order) ? idx.order.map(String).filter(Boolean) : [];
  const next = new Map<string, string>();
  for (const id of order) {
    const job = await loadPromptJob(promptsDir, id);
    if (!job) continue;
    next.set(id, JSON.stringify(promptJobEventSummary(job)));
  }
  return next;
}

function writeSseEvent(res: http.ServerResponse, event: string, data: any): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function loadFleetRequestIndex(fleetDir: string): Promise<FleetRequestIndex> {
  const raw = await readJsonFile(path.join(fleetDir, 'requests.json'), { order: [], idempotency: {} as Record<string, string> });
  return {
    order: Array.isArray(raw?.order) ? raw.order.map(String).filter(Boolean) : [],
    idempotency:
      raw?.idempotency && typeof raw.idempotency === 'object' && !Array.isArray(raw.idempotency)
        ? (Object.fromEntries(Object.entries(raw.idempotency).map(([key, value]) => [String(key), String(value)])) as Record<string, string>)
        : {},
  };
}

async function saveFleetRequestIndex(fleetDir: string, idx: FleetRequestIndex): Promise<void> {
  await writeJsonFileAtomic(path.join(fleetDir, 'requests.json'), idx);
}

async function loadFleetRequest(fleetDir: string, idRaw: string): Promise<FleetRequestRecord | null> {
  const id = String(idRaw ?? '').trim();
  if (!id) return null;
  const p = path.join(fleetDir, 'requests', `${id}.json`);
  if (!(await fileExists(p))) return null;
  return await readJsonFile<FleetRequestRecord>(p, null as any);
}

async function saveFleetRequest(fleetDir: string, request: FleetRequestRecord): Promise<void> {
  await writeJsonFileAtomic(path.join(fleetDir, 'requests', `${request.id}.json`), request);
}

async function listFleetRequests(fleetDir: string, state?: FleetRequestState): Promise<FleetRequestRecord[]> {
  const idx = await loadFleetRequestIndex(fleetDir);
  const items: FleetRequestRecord[] = [];
  for (const id of idx.order) {
    const request = await loadFleetRequest(fleetDir, id);
    if (!request) continue;
    if (state && request.state !== state) continue;
    items.push(request);
  }
  return items;
}

async function loadFleetPolicySnapshot(fleetDir: string): Promise<FleetPolicySnapshot> {
  const fallback: FleetPolicySnapshot = {
    apiVersion: FLEET_API_VERSION,
    enabled: false,
    actor: { id: null, name: null },
    relationships: { children: [], assigned: [] },
    capabilities: [],
    readScopes: ['children'],
    sendScopes: ['children', 'assigned'],
    limits: {},
    updatedAt: nowIso(),
  };
  const raw = await readJsonFile(path.join(fleetDir, 'policy.json'), fallback);
  return {
    apiVersion: typeof raw?.apiVersion === 'string' && raw.apiVersion.trim() ? raw.apiVersion.trim() : fallback.apiVersion,
    enabled: raw?.enabled === true,
    actor: {
      id: typeof raw?.actor?.id === 'string' && raw.actor.id.trim() ? raw.actor.id.trim() : null,
      name: typeof raw?.actor?.name === 'string' && raw.actor.name.trim() ? raw.actor.name.trim() : null,
    },
    relationships: {
      children: Array.isArray(raw?.relationships?.children)
        ? raw.relationships.children
            .map((item: any) => ({
              id: String(item?.id ?? '').trim(),
              name: String(item?.name ?? '').trim(),
            }))
            .filter((item: { id: string; name: string }) => item.id)
        : [],
      assigned: Array.isArray(raw?.relationships?.assigned)
        ? raw.relationships.assigned
            .map((item: any) => ({
              id: String(item?.id ?? '').trim(),
              name: String(item?.name ?? '').trim(),
            }))
            .filter((item: { id: string; name: string }) => item.id)
        : [],
    },
    capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map(String).filter(Boolean) : [],
    readScopes: Array.isArray(raw?.readScopes) ? raw.readScopes.map(String).filter(Boolean) : fallback.readScopes,
    sendScopes: Array.isArray(raw?.sendScopes) ? raw.sendScopes.map(String).filter(Boolean) : fallback.sendScopes,
    limits:
      raw?.limits && typeof raw.limits === 'object' && !Array.isArray(raw.limits)
        ? (Object.fromEntries(
            Object.entries(raw.limits)
              .map(([key, value]) => [String(key), Number(value)])
              .filter(([, value]) => Number.isFinite(value)),
          ) as Record<string, number>)
        : {},
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : fallback.updatedAt,
  };
}

async function saveFleetPolicySnapshot(fleetDir: string, snapshot: FleetPolicySnapshot): Promise<void> {
  await writeJsonFileAtomic(path.join(fleetDir, 'policy.json'), snapshot);
}

async function loadTaskStateSnapshot(dataDir: string): Promise<TaskStateSnapshot> {
  return normalizeTaskStateSnapshot(await readJsonFile(path.join(dataDir, 'tasks.json'), null));
}

async function saveTaskStateSnapshot(dataDir: string, snapshot: TaskStateSnapshot): Promise<void> {
  await writeJsonFileAtomic(path.join(dataDir, 'tasks.json'), snapshot);
}

let TASK_STATE_MUTATION_TAIL: Promise<void> = Promise.resolve();

async function withTaskStateMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = TASK_STATE_MUTATION_TAIL.then(fn, fn);
  TASK_STATE_MUTATION_TAIL = run.then(
    () => undefined,
    () => undefined,
  );
  return await run;
}

async function loadPendingTaskCreates(dataDir: string): Promise<PendingTaskCreateRequest[]> {
  const raw = await readJsonFile(path.join(dataDir, 'task-create-queue.json'), []);
  return (Array.isArray(raw) ? raw : []).map(normalizePendingTaskCreateRequest).filter(Boolean) as PendingTaskCreateRequest[];
}

async function savePendingTaskCreates(dataDir: string, list: PendingTaskCreateRequest[]): Promise<void> {
  await writeJsonFileAtomic(path.join(dataDir, 'task-create-queue.json'), list);
}

async function loadPendingTaskDeletes(dataDir: string): Promise<PendingTaskDeleteRequest[]> {
  const raw = await readJsonFile(path.join(dataDir, 'task-delete-queue.json'), []);
  return (Array.isArray(raw) ? raw : []).map(normalizePendingTaskDeleteRequest).filter(Boolean) as PendingTaskDeleteRequest[];
}

async function savePendingTaskDeletes(dataDir: string, list: PendingTaskDeleteRequest[]): Promise<void> {
  await writeJsonFileAtomic(path.join(dataDir, 'task-delete-queue.json'), list);
}

function normalizeFleetRequestState(raw: unknown): FleetRequestState | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'queued' || value === 'running' || value === 'done' || value === 'failed') return value;
  return null;
}

function normalizeFleetRequestType(raw: unknown): FleetRequestType | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'create_child' || value === 'send_message' || value === 'read_messages' || value === 'stop_chat') return value;
  return null;
}

function promptSessionName(id: string): string {
  const cleaned = String(id).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 48);
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

async function startPromptJob(job: PromptJob): Promise<void> {
  // Run inside tmux so work continues even if this daemon process restarts.
  const quotedCmd = bashQuote(job.cmd);
  const quotedArgs = (job.args ?? []).map((a) => bashQuote(a)).join(' ');
  const quotedStdoutPath = bashQuote(job.stdoutPath);
  const quotedStderrPath = bashQuote(job.stderrPath);
  const quotedExitPath = bashQuote(job.exitPath);
  const wrapperPath = job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`);
  const quotedWrapperPath = bashQuote(wrapperPath);
  const cd = job.cwd ? `cd ${bashQuote(job.cwd)}\n` : '';
  const envLines =
    job.env && Object.keys(job.env).length > 0
      ? Object.entries(job.env)
          .map(([k, v]) => `export ${String(k).replace(/[^A-Za-z0-9_]/g, '_')}=${bashQuote(String(v))}`)
          .join('\n') + '\n'
      : '';
  const script = [
    'set +e',
    `stdout_path=${quotedStdoutPath}`,
    `stderr_path=${quotedStderrPath}`,
    `exit_path=${quotedExitPath}`,
    `wrapper_path=${quotedWrapperPath}`,
    'wrote_exit=0',
    'printf \'%s\\n\' "prompt wrapper: started at $(date -Is) pid $$" > "$wrapper_path" 2>/dev/null || true',
    'record_wrapper_exit() {',
    '  wrapper_code=$?',
    '  if [ "$wrote_exit" != "1" ]; then',
    '    printf \'%s\\n\' "prompt wrapper: exited before command exit capture at $(date -Is) with wrapper code $wrapper_code" >> "$wrapper_path" 2>/dev/null || true',
    '    if [ ! -e "$exit_path" ]; then',
    '      printf %s "$wrapper_code" > "$exit_path" 2>/dev/null || true',
    '    fi',
    '  fi',
    '}',
    'trap record_wrapper_exit EXIT',
    'trap \'printf \'\\\'\'%s\\n\'\\\'\' "prompt wrapper: received SIGHUP at $(date -Is)" >> "$wrapper_path" 2>/dev/null || true; exit 129\' HUP',
    'trap \'printf \'\\\'\'%s\\n\'\\\'\' "prompt wrapper: received SIGINT at $(date -Is)" >> "$wrapper_path" 2>/dev/null || true; exit 130\' INT',
    'trap \'printf \'\\\'\'%s\\n\'\\\'\' "prompt wrapper: received SIGTERM at $(date -Is)" >> "$wrapper_path" 2>/dev/null || true; exit 143\' TERM',
    cd.trimEnd(),
    envLines.trimEnd(),
    // Run and capture exit code.
    `${quotedCmd} ${quotedArgs} > ${quotedStdoutPath} 2> ${quotedStderrPath}`,
    'code=$?',
    'printf \'%s\\n\' "prompt wrapper: command exited at $(date -Is) with code $code" >> "$wrapper_path" 2>/dev/null || true',
    `if [ "$code" -ne 0 ] && [ ! -s ${quotedStdoutPath} ] && [ ! -s ${quotedStderrPath} ]; then`,
    `  printf '%s\n' "prompt wrapper: command exited with code $code without writing stdout/stderr" >> ${quotedStderrPath}`,
    'fi',
    `printf %s \"$code\" > ${quotedExitPath}`,
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
  return kind === 'codex' || kind === 'pi' || kind === 'blip';
}

async function parsePromptJobTranscriptFromFile(
  job: PromptJob,
  stdoutRead: { bytes: number; truncated: boolean },
  parsedAt: string,
): Promise<BuiltinPromptJobTranscript | null> {
  if (!promptJobSupportsTranscript(job.kind)) return null;
  const stream = createReadStream(job.stdoutPath, { encoding: 'utf8' });
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

async function finalizePromptJob(job: PromptJob): Promise<PromptJob> {
  // Some CLIs (notably Codex JSON mode) may continue appending output briefly
  // after the tmux session has exited. Wait for output/exit artifacts to settle.
  let exitCode = await readIntSafe(job.exitPath);
  let stdoutRead = await readTextSafeDetailed(job.stdoutPath);
  let stderrRead = await readTextSafeDetailed(job.stderrPath);
  let wrapperRead = await readTextSafeDetailed(job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`));
  let stdout = stdoutRead.text;
  let stderr = stderrRead.text;
  let wrapperLog = wrapperRead.text;

  const startedLikeCodexTurn =
    /"type":"thread\.started"/.test(stdoutRead.text) &&
    /"type":"turn\.started"/.test(stdoutRead.text);
  const hasCodexTerminalEvent =
    /"type":"turn\.completed"/.test(stdoutRead.text) ||
    /"type":"response\.completed"/.test(stdoutRead.text) ||
    /"type":"response\.failed"/.test(stdoutRead.text) ||
    /"type":"error"/.test(stdoutRead.text);
  const shouldWaitForCodexFlush =
    job.kind === 'codex' &&
    startedLikeCodexTurn &&
    !hasCodexTerminalEvent;

  if (exitCode == null || shouldWaitForCodexFlush) {
    const settleDeadline = Date.now() + 10_000;
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
      stdoutRead = await readTextSafeDetailed(job.stdoutPath);
      stderrRead = await readTextSafeDetailed(job.stderrPath);
      wrapperRead = await readTextSafeDetailed(job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`));
      stdout = stdoutRead.text;
      stderr = stderrRead.text;
      wrapperLog = wrapperRead.text;
      const codexNowTerminal =
        /"type":"turn\.completed"/.test(stdoutRead.text) ||
        /"type":"response\.completed"/.test(stdoutRead.text) ||
        /"type":"response\.failed"/.test(stdoutRead.text) ||
        /"type":"error"/.test(stdoutRead.text);
      if (shouldWaitForCodexFlush && codexNowTerminal && (exitCode != null || stableReads >= 2)) break;
      if (exitCode != null && stableReads >= 2) break;
    }
  }

  const ok = exitCode === 0;
  const finishedAt = nowIso();
  const transcript = await parsePromptJobTranscriptFromFile(job, stdoutRead, finishedAt);
  const exitStatusSource = exitCode == null ? 'missing-exit-file' : 'exit-file';
  const failureReason =
    ok
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
    state: ok ? 'done' : 'failed',
    failureReason,
    error: ok ? undefined : (failureReason || stderr.trim() || stdout.trim() || job.error || 'failed'),
  };
}

async function refreshPromptJobTranscript(job: PromptJob): Promise<PromptJob> {
  if (!promptJobSupportsTranscript(job.kind)) return job;
  const stdoutRead = await readTextSafeDetailed(job.stdoutPath);
  const stderrRead = await readTextSafeDetailed(job.stderrPath);
  const wrapperRead = await readTextSafeDetailed(job.wrapperPath ?? path.join(path.dirname(job.stdoutPath), `${job.id}.wrapper.log`));
  const nextTranscript = await parsePromptJobTranscriptFromFile(job, stdoutRead, nowIso());
  if (!nextTranscript) return job;
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

  if (!(await sessionExists(job.session))) {
    return await finalizePromptJob(job);
  }

  try {
    await tmux(['send-keys', '-t', `${job.session}:0.0`, 'C-c']);
  } catch {
    // ignore and fall back to killing the session below
  }

  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (!(await sessionExists(job.session))) break;
    await sleep(100);
  }

  if (await sessionExists(job.session)) {
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
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
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

async function sessionExists(session: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', session]);
    try {
      const pane = await tmux(['display-message', '-p', '-t', `${session}:0.0`, '#{pane_dead}']);
      if (String(pane.stdout ?? '').trim() === '1') {
        // A dead pane can keep the session object around (e.g. remain-on-exit),
        // which would otherwise make prompt jobs look "running" forever.
        try {
          await killSession(session);
        } catch {
          // ignore (best-effort cleanup)
        }
        return false;
      }
    } catch {
      // If pane status cannot be read, fall back to "session exists".
    }
    return true;
  } catch {
    return false;
  }
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
    const child = spawn('tmux', ['load-buffer', '-b', bufferName, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err) => reject(wrapTmuxError(err)));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error((stderr || `tmux load-buffer failed with code ${String(code ?? 1)}`).trim()));
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
      const { stdout } = await tmux(['capture-pane', '-p', '-t', target, '-S', String(Math.floor(cursorY)), '-E', String(Math.floor(cursorY))]);
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

async function readSessionLogChunk(logPath: string, sinceRaw: number, maxRaw: number): Promise<{ chunk: string; nextOffset: number }> {
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
  const promptOutDir = path.join(promptsDir, 'out');
  await ensureDir(promptJobsDir);
  await ensureDir(promptOutDir);
  const fleetDir = path.join(dataDir, 'fleet');
  const fleetRequestsDir = path.join(fleetDir, 'requests');
  await ensureDir(fleetRequestsDir);

  let promptPumpBusy = false;
  async function pumpPrompts() {
    if (promptPumpBusy) return;
    promptPumpBusy = true;
    try {
      const idx = await loadPromptIndex(promptsDir);
      const order = Array.isArray(idx.order) ? idx.order.map(String).filter(Boolean) : [];
      // First, finalize any running jobs whose session ended.
      for (const id of order) {
        const job = await loadPromptJob(promptsDir, id);
        if (!job) continue;
        if (job.state !== 'running') continue;
        const alive = await sessionExists(job.session);
        if (alive) continue;
        const next = await finalizePromptJob(job);
        await savePromptJob(promptsDir, next);
      }

      // Start next queued if none running.
      const anyRunning = await (async () => {
        for (const id of order) {
          const job = await loadPromptJob(promptsDir, id);
          if (job && job.state === 'running') return true;
        }
        return false;
      })();
      if (anyRunning) return;

      let startId: string | null = null;
      for (const id of order) {
        const job = await loadPromptJob(promptsDir, id);
        if (job && job.state === 'queued') {
          startId = id;
          break;
        }
      }
      if (!startId) return;
      const job = await loadPromptJob(promptsDir, startId);
      if (!job) return;
      const startedAt = nowIso();
      const running: PromptJob = { ...job, state: 'running', startedAt, updatedAt: startedAt };
      await savePromptJob(promptsDir, running);
      await startPromptJob(running);
    } finally {
      promptPumpBusy = false;
    }
  }

  // Resume any queued/running prompts on daemon restart.
  setInterval(() => {
    void pumpPrompts();
  }, 400);
  void pumpPrompts();

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
        json(res, 200, { ok: true, name: 'drone-daemon', time: new Date().toISOString() });
        return;
      }

      if (method === 'GET' && pathname === '/v1/fleet/capabilities') {
        const snapshot = await loadFleetPolicySnapshot(fleetDir);
        json(res, 200, { ok: true, ...snapshot });
        return;
      }

      if (method === 'GET' && pathname === '/v1/fleet/help') {
        const snapshot = await loadFleetPolicySnapshot(fleetDir);
        json(res, 200, {
          ok: true,
          ...snapshot,
          commands: [
            'fleet create --name <child> [--group <group>] [--clone-parent] [--idempotency-key <key>]',
            'fleet send --to <drone> --chat <chat> --message "<text>"',
            'fleet stop --to <drone> --chat <chat>',
            'fleet read --from <drone> --chat <chat> --limit 20 [--cursor <cursor>]',
            'fleet status',
            'fleet assigned',
            'fleet request status --id <requestId>',
            'fleet capabilities',
          ],
        });
        return;
      }

      if (method === 'GET' && pathname === '/v1/tasks') {
        const snapshot = await loadTaskStateSnapshot(dataDir);
        if (!snapshot.enabled) {
          json(res, 409, { error: 'task CLI is not enabled for this drone' });
          return;
        }
        const typeIds = u.searchParams.getAll('type').map((item) => String(item ?? '').trim()).filter(Boolean);
        json(res, 200, taskSummaryForResponse(snapshot, filterTasksByTypeIds(snapshot, typeIds)));
        return;
      }

      if (method === 'GET' && pathname === '/v1/tasks/search') {
        const snapshot = await loadTaskStateSnapshot(dataDir);
        if (!snapshot.enabled) {
          json(res, 409, { error: 'task CLI is not enabled for this drone' });
          return;
        }
        const query = String(u.searchParams.get('q') ?? '').trim();
        if (!query) {
          json(res, 400, { error: 'missing search query' });
          return;
        }
        const typeIds = u.searchParams.getAll('type').map((item) => String(item ?? '').trim()).filter(Boolean);
        json(res, 200, {
          ...taskSummaryForResponse(snapshot, []),
          query,
          tasks: searchTasks(snapshot, query, typeIds),
        });
        return;
      }

      if (method === 'POST' && pathname === '/v1/tasks') {
        const body = await readJson(req);
        const result = await withTaskStateMutationLock(async () => {
          const snapshot = await loadTaskStateSnapshot(dataDir);
          if (!snapshot.enabled) {
            return { status: 409, body: { error: 'task CLI is not enabled for this drone' } };
          }
          const title = String(body?.title ?? '').trim();
          const description = String(body?.description ?? '');
          const requestedTypeId = String(body?.typeId ?? '').trim();
          const defaultTypeId = firstTaskTypeId(snapshot);
          const taskTypeId = requestedTypeId || defaultTypeId || '';
          if (!title) {
            return { status: 400, body: { error: 'missing task title' } };
          }
          if (!taskTypeId) {
            return { status: 400, body: { error: 'missing task type' } };
          }
          if (!snapshot.taskTypes.some((item) => item.id === taskTypeId && item.active !== false)) {
            return { status: 400, body: { error: `unknown task type: ${taskTypeId}` } };
          }
          const pending = await loadPendingTaskCreates(dataDir);
          const request: PendingTaskCreateRequest = {
            id: crypto.randomUUID(),
            title,
            description,
            typeId: taskTypeId,
            createdAt: nowIso(),
          };
          pending.push(request);
          await savePendingTaskCreates(dataDir, pending.slice(-500));
          return { status: 202, body: { ok: true, queued: true, request } };
        });
        json(res, result.status, result.body);
        return;
      }

      if (method === 'GET' && pathname === '/v1/tasks/pending-creates') {
        const snapshot = await loadTaskStateSnapshot(dataDir);
        if (!snapshot.enabled) {
          json(res, 409, { error: 'task CLI is not enabled for this drone' });
          return;
        }
        json(res, 200, {
          ok: true,
          actor: snapshot.actor,
          playbook: snapshot.playbook,
          repoPath: snapshot.repoPath,
          requests: await loadPendingTaskCreates(dataDir),
        });
        return;
      }

      if (method === 'GET' && pathname === '/v1/tasks/pending-deletes') {
        const snapshot = await loadTaskStateSnapshot(dataDir);
        if (!snapshot.enabled) {
          json(res, 409, { error: 'task CLI is not enabled for this drone' });
          return;
        }
        json(res, 200, {
          ok: true,
          actor: snapshot.actor,
          playbook: snapshot.playbook,
          repoPath: snapshot.repoPath,
          requests: await loadPendingTaskDeletes(dataDir),
        });
        return;
      }

      if (method === 'DELETE' && /^\/v1\/tasks\/[^/]+$/.test(pathname)) {
        const taskId = decodeURIComponent(pathname.slice('/v1/tasks/'.length));
        const result = await withTaskStateMutationLock(async () => {
          const snapshot = await loadTaskStateSnapshot(dataDir);
          if (!snapshot.enabled) {
            return { status: 409, body: { error: 'task CLI is not enabled for this drone' } };
          }
          const task = findTaskById(snapshot, taskId);
          if (!task) {
            return { status: 404, body: { error: `task not found: ${taskId}` } };
          }
          const pending = await loadPendingTaskDeletes(dataDir);
          const existing = pending.find((item) => item.taskId === task.id) ?? null;
          if (existing) {
            return { status: 202, body: { ok: true, queued: true, duplicate: true, request: existing } };
          }
          const request: PendingTaskDeleteRequest = {
            id: crypto.randomUUID(),
            taskId: task.id,
            createdAt: nowIso(),
          };
          pending.push(request);
          await savePendingTaskDeletes(dataDir, pending.slice(-500));
          return { status: 202, body: { ok: true, queued: true, request } };
        });
        json(res, result.status, result.body);
        return;
      }

      if (method === 'GET' && /^\/v1\/tasks\/[^/]+$/.test(pathname)) {
        const snapshot = await loadTaskStateSnapshot(dataDir);
        if (!snapshot.enabled) {
          json(res, 409, { error: 'task CLI is not enabled for this drone' });
          return;
        }
        const taskId = decodeURIComponent(pathname.slice('/v1/tasks/'.length));
        const task = findTaskById(snapshot, taskId);
        if (!task) {
          json(res, 404, { error: `task not found: ${taskId}` });
          return;
        }
        json(res, 200, {
          ...taskSummaryForResponse(snapshot, []),
          task,
        });
        return;
      }

      if (method === 'POST' && pathname.startsWith('/v1/tasks/pending-creates/') && pathname.endsWith('/ack')) {
        const match = pathname.match(/^\/v1\/tasks\/pending-creates\/([^/]+)\/ack$/);
        const requestId = match ? decodeURIComponent(match[1] ?? '').trim() : '';
        if (!requestId) {
          json(res, 400, { error: 'missing request id' });
          return;
        }
        const removed = await withTaskStateMutationLock(async () => {
          const pending = await loadPendingTaskCreates(dataDir);
          const nextPending = pending.filter((item) => item.id !== requestId);
          await savePendingTaskCreates(dataDir, nextPending);
          return pending.length !== nextPending.length;
        });
        json(res, 200, { ok: true, removed });
        return;
      }

      if (method === 'POST' && pathname.startsWith('/v1/tasks/pending-deletes/') && pathname.endsWith('/ack')) {
        const match = pathname.match(/^\/v1\/tasks\/pending-deletes\/([^/]+)\/ack$/);
        const requestId = match ? decodeURIComponent(match[1] ?? '').trim() : '';
        if (!requestId) {
          json(res, 400, { error: 'missing request id' });
          return;
        }
        const removed = await withTaskStateMutationLock(async () => {
          const pending = await loadPendingTaskDeletes(dataDir);
          const nextPending = pending.filter((item) => item.id !== requestId);
          await savePendingTaskDeletes(dataDir, nextPending);
          return pending.length !== nextPending.length;
        });
        json(res, 200, { ok: true, removed });
        return;
      }

      if (method === 'POST' && pathname === '/v1/tasks/state') {
        const body = await readJson(req);
        const snapshot = normalizeTaskStateSnapshot(body);
        await withTaskStateMutationLock(async () => {
          await saveTaskStateSnapshot(dataDir, snapshot);
          const pendingCreates = await loadPendingTaskCreates(dataDir);
          const knownTypeIds = new Set(snapshot.taskTypes.filter((item) => item.active !== false).map((item) => item.id));
          const filteredCreates = pendingCreates.filter((item) => knownTypeIds.size === 0 || knownTypeIds.has(item.typeId));
          if (filteredCreates.length !== pendingCreates.length) {
            await savePendingTaskCreates(dataDir, filteredCreates);
          }
          const pendingDeletes = await loadPendingTaskDeletes(dataDir);
          const knownTaskIds = new Set(snapshot.tasks.map((item) => item.id));
          const filteredDeletes = pendingDeletes.filter((item) => knownTaskIds.has(item.taskId));
          if (filteredDeletes.length !== pendingDeletes.length) {
            await savePendingTaskDeletes(dataDir, filteredDeletes);
          }
        });
        json(res, 200, { ok: true, snapshot });
        return;
      }

      if (method === 'POST' && pathname === '/v1/fleet/policy') {
        const body = await readJson(req);
        const nextSnapshot: FleetPolicySnapshot = {
          apiVersion: typeof body?.apiVersion === 'string' && body.apiVersion.trim() ? body.apiVersion.trim() : FLEET_API_VERSION,
          enabled: body?.enabled === true,
          actor: {
            id: typeof body?.actor?.id === 'string' && body.actor.id.trim() ? body.actor.id.trim() : null,
            name: typeof body?.actor?.name === 'string' && body.actor.name.trim() ? body.actor.name.trim() : null,
          },
          relationships: {
            children: Array.isArray(body?.relationships?.children)
              ? body.relationships.children
                  .map((item: any) => ({
                    id: String(item?.id ?? '').trim(),
                    name: String(item?.name ?? '').trim(),
                  }))
                  .filter((item: { id: string; name: string }) => item.id)
              : [],
            assigned: Array.isArray(body?.relationships?.assigned)
              ? body.relationships.assigned
                  .map((item: any) => ({
                    id: String(item?.id ?? '').trim(),
                    name: String(item?.name ?? '').trim(),
                  }))
                  .filter((item: { id: string; name: string }) => item.id)
              : [],
          },
          capabilities: Array.isArray(body?.capabilities) ? body.capabilities.map(String).filter(Boolean) : [],
          readScopes: Array.isArray(body?.readScopes) ? body.readScopes.map(String).filter(Boolean) : ['children'],
          sendScopes: Array.isArray(body?.sendScopes) ? body.sendScopes.map(String).filter(Boolean) : ['children', 'assigned'],
          limits:
            body?.limits && typeof body.limits === 'object' && !Array.isArray(body.limits)
              ? (Object.fromEntries(
                  Object.entries(body.limits)
                    .map(([key, value]) => [String(key), Number(value)])
                    .filter(([, value]) => Number.isFinite(value)),
                ) as Record<string, number>)
              : {},
          updatedAt: nowIso(),
        };
        await saveFleetPolicySnapshot(fleetDir, nextSnapshot);
        json(res, 200, { ok: true, snapshot: nextSnapshot });
        return;
      }

      if (method === 'POST' && pathname === '/v1/fleet/requests') {
        const body = await readJson(req);
        const type = normalizeFleetRequestType(body?.type);
        if (!type) {
          json(res, 400, { error: 'invalid type (expected create_child|send_message|read_messages|stop_chat)' });
          return;
        }
        const payload =
          body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
            ? (body.payload as Record<string, unknown>)
            : null;
        if (!payload) {
          json(res, 400, { error: 'missing payload' });
          return;
        }

        const idempotencyKeyRaw = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        const idx = await loadFleetRequestIndex(fleetDir);
        if (idempotencyKeyRaw) {
          const existingId = idx.idempotency[idempotencyKeyRaw];
          if (existingId) {
            const existing = await loadFleetRequest(fleetDir, existingId);
            if (existing) {
              json(res, 200, { ok: true, request: existing, note: 'already exists' });
              return;
            }
          }
        }

        const id = `fleet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = nowIso();
        const request: FleetRequestRecord = {
          id,
          ...(idempotencyKeyRaw ? { idempotencyKey: idempotencyKeyRaw } : {}),
          type,
          payload,
          state: 'queued',
          createdAt,
          updatedAt: createdAt,
        };
        await saveFleetRequest(fleetDir, request);
        const order = Array.isArray(idx.order) ? idx.order.map(String).filter(Boolean) : [];
        order.push(id);
        idx.order = order.slice(-500);
        if (idempotencyKeyRaw) idx.idempotency[idempotencyKeyRaw] = id;
        await saveFleetRequestIndex(fleetDir, idx);
        json(res, 202, { ok: true, request });
        return;
      }

      if (method === 'GET' && pathname === '/v1/fleet/requests') {
        const stateRaw = u.searchParams.get('state');
        const state = normalizeFleetRequestState(stateRaw);
        if (stateRaw != null && state == null) {
          json(res, 400, { error: 'invalid state (expected queued|running|done|failed)' });
          return;
        }
        const requests = await listFleetRequests(fleetDir, state ?? undefined);
        json(res, 200, { ok: true, requests });
        return;
      }

      const fleetRequestMatch = pathname.match(/^\/v1\/fleet\/requests\/([^/]+)$/);
      if (method === 'GET' && fleetRequestMatch) {
        const id = decodeURIComponent(fleetRequestMatch[1] ?? '');
        const request = await loadFleetRequest(fleetDir, id);
        if (!request) {
          json(res, 404, { error: 'not found' });
          return;
        }
        json(res, 200, { ok: true, request });
        return;
      }

      const fleetClaimMatch = pathname.match(/^\/v1\/fleet\/requests\/([^/]+)\/claim$/);
      if (method === 'POST' && fleetClaimMatch) {
        const id = decodeURIComponent(fleetClaimMatch[1] ?? '');
        const request = await loadFleetRequest(fleetDir, id);
        if (!request) {
          json(res, 404, { error: 'not found' });
          return;
        }
        if (request.state === 'done' || request.state === 'failed') {
          json(res, 200, { ok: true, request, note: 'already terminal' });
          return;
        }
        const next: FleetRequestRecord = { ...request, state: 'running', updatedAt: nowIso() };
        await saveFleetRequest(fleetDir, next);
        json(res, 200, { ok: true, request: next });
        return;
      }

      const fleetResolveMatch = pathname.match(/^\/v1\/fleet\/requests\/([^/]+)\/resolve$/);
      if (method === 'POST' && fleetResolveMatch) {
        const id = decodeURIComponent(fleetResolveMatch[1] ?? '');
        const request = await loadFleetRequest(fleetDir, id);
        if (!request) {
          json(res, 404, { error: 'not found' });
          return;
        }
        const body = await readJson(req);
        const state = normalizeFleetRequestState(body?.state);
        if (state !== 'done' && state !== 'failed') {
          json(res, 400, { error: 'invalid state (expected done|failed)' });
          return;
        }
        const next: FleetRequestRecord = {
          ...request,
          state,
          updatedAt: nowIso(),
          result: state === 'done' ? body?.result : undefined,
          error: state === 'failed' ? (typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : 'failed') : undefined,
        };
        await saveFleetRequest(fleetDir, next);
        json(res, 200, { ok: true, request: next });
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
        const args = Array.isArray(body?.args) ? body.args.filter((x: any) => typeof x === 'string') : [];
        const cwd = typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
        const kind = String(body?.kind ?? 'shell').trim() || 'shell';
        const env =
          body?.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (Object.fromEntries(Object.entries(body.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>)
            : undefined;

        const existing = await loadPromptJob(promptsDir, id);
        if (existing) {
          json(res, 200, { ok: true, id, state: existing.state, note: 'already exists' });
          return;
        }

        const session = promptSessionName(id);
        const stdoutPath = path.join(promptOutDir, `${id}.stdout.txt`);
        const stderrPath = path.join(promptOutDir, `${id}.stderr.txt`);
        const exitPath = path.join(promptOutDir, `${id}.exit.txt`);
        const wrapperPath = path.join(promptOutDir, `${id}.wrapper.log`);

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
          session,
          stdoutPath,
          stderrPath,
          exitPath,
          wrapperPath,
        };
        await savePromptJob(promptsDir, job);
        const idx = await loadPromptIndex(promptsDir);
        const order = Array.isArray(idx.order) ? idx.order.map(String) : [];
        if (!order.includes(id)) order.push(id);
        idx.order = order.slice(-400);
        await savePromptIndex(promptsDir, idx);
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
        const job = await loadPromptJob(promptsDir, id);
        if (!job) {
          json(res, 404, { error: 'not found' });
          return;
        }
        // Best-effort finalize if it ended since last pump.
        if (job.state === 'running') {
          const alive = await sessionExists(job.session);
          if (!alive) {
            const next = await finalizePromptJob(job);
            await savePromptJob(promptsDir, next);
            json(res, 200, { ok: true, job: next });
            return;
          }
        }
        if ((job.state === 'done' || job.state === 'failed') && !promptJobHasParsedTranscript(job)) {
          const next = await refreshPromptJobTranscript(job);
          if (next !== job) {
            await savePromptJob(promptsDir, next);
            json(res, 200, { ok: true, job: next });
            return;
          }
        }
        json(res, 200, { ok: true, job });
        return;
      }

      const promptCancelMatch = pathname.match(/^\/v1\/prompts\/([^/]+)\/cancel$/);
      if (method === 'POST' && promptCancelMatch) {
        const id = decodeURIComponent(promptCancelMatch[1] ?? '');
        const job = await loadPromptJob(promptsDir, id);
        if (!job) {
          json(res, 404, { error: 'not found' });
          return;
        }
        const next = await cancelPromptJob(job);
        await savePromptJob(promptsDir, next);
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
        const args = Array.isArray(body?.args) ? body.args.filter((x: any) => typeof x === 'string') : [];
        const cwd = typeof body?.cwd === 'string' ? body.cwd : undefined;
        const session = typeof body?.session === 'string' && body.session ? body.session : 'drone-main';
        const env =
          body?.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (Object.fromEntries(Object.entries(body.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>)
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

        const logPath = terminal ? await sessionLogPathFor(session) : path.join(logsDir, `${session}.log`);
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.writeFile(logPath, '', 'utf8');

        await startSession({ session, cmd, args, cwd, env });
        await pipePaneToFile(session, logPath);

        const processInfo = { session, cmd, args, cwd, env, logPath, startedAt: new Date().toISOString() };
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
        const target = typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
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
        const target = typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
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
        const keys = Array.isArray(body?.keys) ? body.keys.filter((x: any) => typeof x === 'string') : [];
        if (keys.length === 0) {
          json(res, 400, { error: 'missing keys' });
          return;
        }
        const state = await readState();
        const target = typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
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
        const view = String(u.searchParams.get('view') ?? 'log').trim().toLowerCase();
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
          json(res, 200, { ok: true, session, view, chunk: text, nextOffset, logPath, tailLines: tail });
          return;
        }
        const out = await readSessionLogChunk(logPath, since, max);
        json(res, 200, { ok: true, session, chunk: out.chunk, nextOffset: out.nextOffset, logPath });
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
        const initial = await readSessionLogChunk(logPath, hasSince ? since : Number.MAX_SAFE_INTEGER, 1);
        let offset = initial.nextOffset;

        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, session, since: offset })}\n\n`);

        let closed = false;
        req.on('close', () => {
          closed = true;
        });

        while (!closed) {
          try {
            const out = await readSessionLogChunk(logPath, offset, 128 * 1024);
            if (out.chunk) {
              offset = out.nextOffset;
              res.write(`event: output\ndata: ${JSON.stringify({ chunk: out.chunk, nextOffset: offset })}\n\n`);
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
            json(res, 200, { ok: true, chunk, nextOffset: offset + bytesRead, logPath: proc.logPath });
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
                res.write(`event: output\ndata: ${JSON.stringify({ chunk, nextOffset: offset })}\n\n`);
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
      json(res, 500, { error: err?.message ?? String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
  // eslint-disable-next-line no-console
  console.log(`drone-daemon listening on http://${host}:${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
