#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_TERMINATE_TOKEN = 'TERMINATE';
const BUILTIN_AGENT_IDS = ['cursor', 'codex', 'claude', 'opencode'] as const;
const DEFAULT_BUILTIN_AGENT_ID = 'cursor';
const DEFAULT_CURSOR_CLI = 'agent -f --approve-mcps --print';
const DEFAULT_CODEX_CLI = 'codex exec --skip-git-repo-check --color never';
const DEFAULT_CLAUDE_CLI = 'claude --print --dangerously-skip-permissions --output-format text';
const DEFAULT_OPENCODE_CLI = 'opencode run --format default';

type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number];

type CliOptions = {
  prompt?: string;
  file?: string;
  promptStdin?: boolean;
  timeout?: string;
  terminate?: string;
  agent?: string;
  cli?: string;
};

type PromptSource = 'prompt' | 'file' | 'stdin';

function toNonEmptyString(raw: unknown): string | undefined {
  const text = raw == null ? '' : String(raw).trim();
  return text ? text : undefined;
}

function firstNonEmptyEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = toNonEmptyString(process.env[name]);
    if (value) return value;
  }
  return undefined;
}

function normalizeBuiltinAgentId(raw: unknown): BuiltinAgentId | undefined {
  const text = toNonEmptyString(raw)?.toLowerCase();
  if (!text) return undefined;
  return BUILTIN_AGENT_IDS.includes(text as BuiltinAgentId) ? (text as BuiltinAgentId) : undefined;
}

function resolveBuiltinAgentId(raw: unknown): BuiltinAgentId {
  const direct = toNonEmptyString(raw);
  const env = firstNonEmptyEnv('LOOPED_AGENT');
  const candidate = direct ?? env;
  const normalized = normalizeBuiltinAgentId(candidate);
  if (candidate && !normalized) {
    throw new Error(`invalid --agent: expected one of ${BUILTIN_AGENT_IDS.join(', ')}`);
  }
  return normalized ?? DEFAULT_BUILTIN_AGENT_ID;
}

function resolveBuiltinAgentCommand(agent: BuiltinAgentId): string {
  if (agent === 'cursor') {
    return (
      firstNonEmptyEnv('LOOPED_CURSOR_CMD', 'DRONE_HUB_CURSOR_CMD', 'LOOPED_AGENT_CMD', 'DRONE_HUB_AGENT_CMD') ??
      DEFAULT_CURSOR_CLI
    );
  }
  if (agent === 'codex') {
    return firstNonEmptyEnv('LOOPED_CODEX_CMD', 'DRONE_HUB_CODEX_CMD') ?? DEFAULT_CODEX_CLI;
  }
  if (agent === 'claude') {
    return firstNonEmptyEnv('LOOPED_CLAUDE_CMD', 'DRONE_HUB_CLAUDE_CMD') ?? DEFAULT_CLAUDE_CLI;
  }
  return firstNonEmptyEnv('LOOPED_OPENCODE_CMD', 'DRONE_HUB_OPENCODE_CMD') ?? DEFAULT_OPENCODE_CLI;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;

  const trimmed = String(raw).trim();
  const directNumber = Number(trimmed);
  if (Number.isFinite(directNumber) && directNumber > 0) {
    return Math.floor(directNumber);
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(
      'invalid timeout: expected a positive number of milliseconds or duration like "100ms", "5s", "10m", "3.4h", "2d"'
    );
  }

  const value = Number(match[1]);
  const unit = String(match[2]).toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const factor = multipliers[unit];
  const computed = value * factor;
  if (!Number.isFinite(computed) || computed <= 0) {
    throw new Error('invalid timeout: duration must be greater than zero');
  }
  return Math.floor(computed);
}

async function readAllStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join('');
}

async function resolvePromptText(options: {
  prompt?: string;
  file?: string;
  promptStdin: boolean;
}): Promise<{ text: string; source: PromptSource }> {
  const hasPrompt = Boolean(options.prompt);
  const hasFile = Boolean(options.file);
  const hasStdin = Boolean(options.promptStdin);
  const providedCount = Number(hasPrompt) + Number(hasFile) + Number(hasStdin);

  if (providedCount === 0) {
    throw new Error('missing prompt (pass --prompt, --file, or --prompt-stdin)');
  }
  if (providedCount > 1) {
    throw new Error('pass exactly one prompt source: --prompt, --file, or --prompt-stdin');
  }

  const fromPrompt = options.prompt?.trim() ?? '';
  if (fromPrompt) return { text: fromPrompt, source: 'prompt' };

  if (options.file) {
    const filePath = path.resolve(options.file);
    const fromFile = (await fs.readFile(filePath, 'utf8')).trim();
    if (!fromFile) throw new Error('empty --file');
    return { text: fromFile, source: 'file' };
  }

  if (options.promptStdin) {
    const fromStdin = (await readAllStdin()).trim();
    if (!fromStdin) throw new Error('empty stdin prompt');
    return { text: fromStdin, source: 'stdin' };
  }

  throw new Error('unable to resolve prompt input');
}

function previewPrompt(text: string, maxLen = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 3)}...`;
}

function buildCommandLine(cliCommand: string, promptText: string): string {
  const cli = cliCommand.trim();
  if (!cli) throw new Error('invalid --cli: command must be non-empty');
  const promptArg = shellQuote(promptText);
  if (cli.includes('{prompt}')) {
    return cli.split('{prompt}').join(promptArg);
  }
  return `${cli} ${promptArg}`;
}

function resolveCommandConfig(options: { agent?: string; cli?: string }): {
  agent: BuiltinAgentId;
  cliCommand: string;
  explicitCli: boolean;
} {
  const explicitCli = toNonEmptyString(options.cli);
  const agent = resolveBuiltinAgentId(options.agent);
  return {
    agent,
    cliCommand: explicitCli ?? resolveBuiltinAgentCommand(agent),
    explicitCli: Boolean(explicitCli),
  };
}

function createTerminateMatcher(token: string): (chunk: string) => boolean {
  if (!token) return () => false;
  const keep = Math.max(0, token.length - 1);
  let tail = '';
  return (chunk: string) => {
    const haystack = `${tail}${chunk}`;
    const found = haystack.includes(token);
    tail = haystack.slice(Math.max(0, haystack.length - keep));
    return found;
  };
}

type RunIterationResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  terminateMatched: boolean;
  durationMs: number;
};

async function runIteration(options: {
  commandLine: string;
  timeoutMs: number;
  terminateToken: string;
}): Promise<RunIterationResult> {
  return await new Promise<RunIterationResult>((resolve, reject) => {
    const startedAt = Date.now();
    let timedOut = false;
    let terminateMatched = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let hardKillTimer: NodeJS.Timeout | undefined;

    const matcher = createTerminateMatcher(options.terminateToken);
    const child = spawn('bash', ['-lc', options.commandLine], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const onChunk = (rawChunk: Buffer, stream: NodeJS.WriteStream) => {
      const chunk = rawChunk.toString('utf8');
      stream.write(chunk);
      if (!terminateMatched && matcher(chunk)) {
        terminateMatched = true;
      }
    };

    child.stdout.on('data', (chunk) => onChunk(chunk as Buffer, process.stdout));
    child.stderr.on('data', (chunk) => onChunk(chunk as Buffer, process.stderr));

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(
        `[looped] iteration timed out after ${options.timeoutMs}ms; stopping child process\n`
      );
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      hardKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 5_000);
    }, options.timeoutMs);

    child.once('error', (error) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      resolve({
        exitCode: typeof code === 'number' ? code : null,
        signal: signal ?? null,
        timedOut,
        terminateMatched,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

const program = new Command();

program
  .name('looped')
  .description('Minimal harness wrapper for repeatedly running an agentic CLI prompt')
  .option('-p, --prompt <text>', 'Prompt text to run')
  .option('-f, --file <path>', 'Read prompt text from file')
  .option('--prompt-stdin', 'Read prompt text from stdin', false)
  .option(
    '-t, --timeout <duration>',
    'Timeout per iteration (ms or duration string: 100ms, 5s, 10m, 3.4h, 2d)'
  )
  .option('--terminate <token>', 'Stop looping when this token appears in CLI output', DEFAULT_TERMINATE_TOKEN)
  .option(
    '--agent <id>',
    `Builtin agent preset (${BUILTIN_AGENT_IDS.join(', ')}). Used when --cli is not provided`,
    DEFAULT_BUILTIN_AGENT_ID
  )
  .option(
    '--cli <command>',
    'Explicit CLI command override. Use {prompt} placeholder or prompt is appended as final argument'
  )
  .action(async (options: CliOptions) => {
    const prompt = await resolvePromptText({
      prompt: toNonEmptyString(options.prompt),
      file: toNonEmptyString(options.file),
      promptStdin: Boolean(options.promptStdin),
    });

    const timeoutRaw = toNonEmptyString(options.timeout);
    const timeoutMs = parseTimeoutMs(timeoutRaw, DEFAULT_TIMEOUT_MS);
    const terminateToken = toNonEmptyString(options.terminate) ?? DEFAULT_TERMINATE_TOKEN;
    const commandConfig = resolveCommandConfig({ agent: options.agent, cli: options.cli });

    const commandLine = buildCommandLine(commandConfig.cliCommand, prompt.text);
    process.stderr.write(
      `[looped] starting loop: timeout=${timeoutMs}ms terminate=${JSON.stringify(terminateToken)} promptSource=${prompt.source}\n`
    );
    process.stderr.write(
      `[looped] agent=${commandConfig.agent} explicitCli=${commandConfig.explicitCli ? 'yes' : 'no'} command=${JSON.stringify(commandConfig.cliCommand)}\n`
    );
    process.stderr.write(`[looped] prompt: ${previewPrompt(prompt.text)}\n`);

    let iteration = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      iteration += 1;
      process.stderr.write(`\n[looped] iteration ${iteration} begin\n`);
      const result = await runIteration({
        commandLine,
        timeoutMs,
        terminateToken,
      });
      process.stderr.write(
        `[looped] iteration ${iteration} finished: exitCode=${String(result.exitCode)} signal=${String(result.signal)} durationMs=${result.durationMs}\n`
      );

      if (result.terminateMatched) {
        process.stderr.write(
          `[looped] terminate token "${terminateToken}" detected; exiting cleanly after iteration ${iteration}\n`
        );
        return;
      }

      if (result.timedOut) {
        throw new Error(`iteration ${iteration} timed out after ${timeoutMs}ms`);
      }

      if (result.exitCode !== 0) {
        throw new Error(
          `iteration ${iteration} failed with exit code ${String(result.exitCode)}${result.signal ? ` (signal ${result.signal})` : ''}`
        );
      }
    }
  });

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((error: any) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
