import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export type CommandJobStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

type CommandChunk = { cursor: number; stream: 'stdout' | 'stderr' | 'system'; text: string };

type CommandJob = {
  id: string;
  sourceDeviceId: string;
  workspaceId: string;
  command: string;
  child: ReturnType<typeof spawn>;
  status: CommandJobStatus;
  chunks: CommandChunk[];
  outputBytes: number;
  outputTruncated: boolean;
  startedAt: string;
  finishedAt: string | null;
  timeoutAt: string;
  exitCode: number | null;
  signal: string | null;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MAX_TIMEOUT_MS = 60 * 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_RESPONSE_BYTES = 32 * 1024;
const MAX_CHUNK_CHARACTERS = 4 * 1024;
const COMPLETED_RETENTION_MS = 10 * 60_000;
const MAX_ACTIVE_PER_DEVICE = 8;
const MAX_JOBS = 500;

function boundedTimeout(value: unknown, maximum = MAX_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1_000, Math.min(maximum, Math.floor(parsed)))
    : Math.min(DEFAULT_TIMEOUT_MS, maximum);
}

export class CommandJobStore {
  private readonly jobs = new Map<string, CommandJob>();

  start(input: {
    sourceDeviceId: string;
    workspaceId: string;
    rootPath: string;
    command: unknown;
    timeoutMs?: unknown;
    maximumTimeoutMs?: number;
  }) {
    this.cleanup();
    const command = String(input.command ?? '').trim();
    if (!command)
      throw Object.assign(new Error('command is required'), { code: 'INVALID_REQUEST' });
    if (command.length > 16_000)
      throw Object.assign(new Error('command is too long'), { code: 'INVALID_REQUEST' });
    const active = [...this.jobs.values()].filter(
      (job) => job.sourceDeviceId === input.sourceDeviceId && job.status === 'running',
    ).length;
    if (active >= MAX_ACTIVE_PER_DEVICE)
      throw Object.assign(new Error('too many commands are already running for this device'), {
        code: 'COMMAND_LIMIT_REACHED',
      });
    if (this.jobs.size >= MAX_JOBS)
      throw Object.assign(new Error('the command job store is full'), {
        code: 'COMMAND_LIMIT_REACHED',
      });

    const timeoutMs = boundedTimeout(input.timeoutMs, input.maximumTimeoutMs);
    const started = Date.now();
    const child = spawn('bash', ['-lc', command], {
      cwd: input.rootPath,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const job: CommandJob = {
      id: `command_${crypto.randomUUID()}`,
      sourceDeviceId: input.sourceDeviceId,
      workspaceId: input.workspaceId,
      command,
      child,
      status: 'running',
      chunks: [],
      outputBytes: 0,
      outputTruncated: false,
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      timeoutAt: new Date(started + timeoutMs).toISOString(),
      exitCode: null,
      signal: null,
      timeout: setTimeout(() => {
        if (job.status !== 'running') return;
        job.status = 'timed_out';
        this.append(job, 'system', `Command timed out after ${timeoutMs} ms.\n`);
        this.terminate(job);
      }, timeoutMs),
    };
    job.timeout.unref?.();
    this.jobs.set(job.id, job);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.append(job, 'stdout', String(chunk)));
    child.stderr.on('data', (chunk) => this.append(job, 'stderr', String(chunk)));
    child.on('error', (error) => {
      if (job.status === 'running') job.status = 'failed';
      this.append(job, 'system', `${error.message}\n`);
      this.finish(job, null, null);
    });
    child.on('close', (exitCode, signal) => {
      if (job.status === 'running') job.status = exitCode === 0 ? 'completed' : 'failed';
      this.finish(job, exitCode, signal);
    });
    return this.snapshot(job);
  }

  status(sourceDeviceId: string, workspaceId: string, jobId: unknown) {
    return this.snapshot(this.job(sourceDeviceId, workspaceId, jobId));
  }

  async output(input: {
    sourceDeviceId: string;
    workspaceId: string;
    jobId: unknown;
    cursor?: unknown;
    waitMs?: unknown;
  }) {
    const job = this.job(input.sourceDeviceId, input.workspaceId, input.jobId);
    const cursor = Math.max(0, Math.floor(Number(input.cursor) || 0));
    const waitMs = Math.max(0, Math.min(20_000, Math.floor(Number(input.waitMs) || 0)));
    const deadline = Date.now() + waitMs;
    while (job.status === 'running' && job.chunks.length <= cursor && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
    }
    const chunks: CommandChunk[] = [];
    let bytes = 0;
    for (const chunk of job.chunks.slice(cursor)) {
      const chunkBytes = Buffer.byteLength(chunk.text);
      if (chunks.length > 0 && bytes + chunkBytes > MAX_OUTPUT_RESPONSE_BYTES) break;
      chunks.push(chunk);
      bytes += chunkBytes;
    }
    return {
      ...this.snapshot(job),
      cursor: cursor + chunks.length,
      chunks,
    };
  }

  cancel(sourceDeviceId: string, workspaceId: string, jobId: unknown) {
    const job = this.job(sourceDeviceId, workspaceId, jobId);
    this.cancelJob(job, 'Command cancelled.\n');
    return this.snapshot(job);
  }

  cancelForDevice(sourceDeviceId: string): void {
    for (const job of this.jobs.values()) {
      if (job.sourceDeviceId === sourceDeviceId)
        this.cancelJob(job, 'Command cancelled because device access was revoked.\n');
    }
  }

  async cancelUnauthorized(
    allowed: (sourceDeviceId: string, workspaceId: string) => boolean | Promise<boolean>,
  ): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && !(await allowed(job.sourceDeviceId, job.workspaceId)))
        this.cancelJob(job, 'Command cancelled because workspace access was revoked.\n');
    }
  }

  close(): void {
    for (const job of this.jobs.values()) {
      if (job.status !== 'running') continue;
      this.cancelJob(job, 'Command cancelled because Drone Hub is shutting down.\n');
    }
    this.jobs.clear();
  }

  private job(sourceDeviceId: string, workspaceId: string, jobId: unknown): CommandJob {
    this.cleanup();
    const job = this.jobs.get(String(jobId ?? '').trim());
    if (!job || job.sourceDeviceId !== sourceDeviceId || job.workspaceId !== workspaceId)
      throw Object.assign(new Error('command job was not found'), {
        code: 'COMMAND_JOB_NOT_FOUND',
      });
    return job;
  }

  private snapshot(job: CommandJob) {
    return {
      jobId: job.id,
      workspaceId: job.workspaceId,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      timeoutAt: job.timeoutAt,
      exitCode: job.exitCode,
      signal: job.signal,
      outputTruncated: job.outputTruncated,
    };
  }

  private cancelJob(job: CommandJob, message: string): void {
    if (job.status !== 'running') return;
    job.status = 'cancelled';
    this.append(job, 'system', message);
    this.terminate(job);
  }

  private append(job: CommandJob, stream: CommandChunk['stream'], value: string): void {
    if (!value || job.outputTruncated) return;
    const remaining = MAX_OUTPUT_BYTES - job.outputBytes;
    if (remaining <= 0) {
      job.outputTruncated = true;
      job.chunks.push({
        cursor: job.chunks.length,
        stream: 'system',
        text: '[command output truncated]\n',
      });
      return;
    }
    const buffer = Buffer.from(value);
    const accepted = buffer.subarray(0, remaining);
    const decoded = accepted.toString('utf8');
    for (let offset = 0; offset < decoded.length; offset += MAX_CHUNK_CHARACTERS) {
      const text = decoded.slice(offset, offset + MAX_CHUNK_CHARACTERS);
      if (text) job.chunks.push({ cursor: job.chunks.length, stream, text });
    }
    job.outputBytes += accepted.length;
    if (buffer.length > remaining) {
      job.outputTruncated = true;
      job.chunks.push({
        cursor: job.chunks.length,
        stream: 'system',
        text: '[command output truncated]\n',
      });
    }
  }

  private finish(job: CommandJob, exitCode: number | null, signal: NodeJS.Signals | null): void {
    clearTimeout(job.timeout);
    job.exitCode = exitCode;
    job.signal = signal;
    job.finishedAt ??= new Date().toISOString();
  }

  private terminate(job: CommandJob): void {
    clearTimeout(job.timeout);
    const signal = (value: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && job.child.pid) process.kill(-job.child.pid, value);
        else job.child.kill(value);
      } catch {
        // The process may already have exited.
      }
    };
    signal('SIGTERM');
    const force = setTimeout(() => signal('SIGKILL'), 5_000);
    force.unref?.();
  }

  private cleanup(): void {
    const cutoff = Date.now() - COMPLETED_RETENTION_MS;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) this.jobs.delete(id);
    }
  }
}
