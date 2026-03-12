#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_TERMINATE_TOKEN = 'TERMINATE';
const BUILTIN_AGENT_IDS = ['cursor', 'codex', 'claude', 'opencode'] as const;
const CHAT_MODES = ['continue', 'fresh'] as const;
const DEFAULT_BUILTIN_AGENT_ID = 'cursor';
const DEFAULT_CHAT_MODE = 'continue';
const DEFAULT_CURSOR_CLI = 'agent -f --approve-mcps --print';
const DEFAULT_CURSOR_CONTINUE_CLI = 'agent --resume {session} -f --approve-mcps --print';
const DEFAULT_CODEX_CLI = 'codex exec --skip-git-repo-check --color never';
const DEFAULT_CLAUDE_CLI = 'claude --print --dangerously-skip-permissions --output-format text';
const DEFAULT_OPENCODE_CLI = 'opencode run --format default';

type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number];
type ChatMode = (typeof CHAT_MODES)[number];

type CliOptions = {
  prompt?: string;
  file?: string;
  promptStdin?: boolean;
  timeout?: string;
  terminate?: string;
  agent?: string;
  chatMode?: string;
  fresh?: boolean;
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

function normalizeChatMode(raw: unknown): ChatMode | undefined {
  const text = toNonEmptyString(raw)?.toLowerCase();
  if (!text) return undefined;
  return CHAT_MODES.includes(text as ChatMode) ? (text as ChatMode) : undefined;
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

function resolveChatMode(raw: unknown, fresh: boolean): ChatMode {
  if (fresh) return 'fresh';
  const direct = toNonEmptyString(raw);
  const env = firstNonEmptyEnv('LOOPED_CHAT_MODE');
  const candidate = direct ?? env;
  const normalized = normalizeChatMode(candidate);
  if (candidate && !normalized) {
    throw new Error(`invalid --chat-mode: expected one of ${CHAT_MODES.join(', ')}`);
  }
  return normalized ?? DEFAULT_CHAT_MODE;
}

function resolveBuiltinAgentCommand(agent: BuiltinAgentId): { command: string; source: 'default' | 'env' } {
  if (agent === 'cursor') {
    const env =
      firstNonEmptyEnv('LOOPED_CURSOR_CMD', 'DRONE_HUB_CURSOR_CMD', 'LOOPED_AGENT_CMD', 'DRONE_HUB_AGENT_CMD') ?? '';
    return { command: env || DEFAULT_CURSOR_CLI, source: env ? 'env' : 'default' };
  }
  if (agent === 'codex') {
    const env = firstNonEmptyEnv('LOOPED_CODEX_CMD', 'DRONE_HUB_CODEX_CMD') ?? '';
    return { command: env || DEFAULT_CODEX_CLI, source: env ? 'env' : 'default' };
  }
  if (agent === 'claude') {
    const env = firstNonEmptyEnv('LOOPED_CLAUDE_CMD', 'DRONE_HUB_CLAUDE_CMD') ?? '';
    return { command: env || DEFAULT_CLAUDE_CLI, source: env ? 'env' : 'default' };
  }
  const env = firstNonEmptyEnv('LOOPED_OPENCODE_CMD', 'DRONE_HUB_OPENCODE_CMD') ?? '';
  return { command: env || DEFAULT_OPENCODE_CLI, source: env ? 'env' : 'default' };
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
  builtinCliSource: 'default' | 'env' | 'explicit';
} {
  const explicitCli = toNonEmptyString(options.cli);
  const agent = resolveBuiltinAgentId(options.agent);
  const builtin = resolveBuiltinAgentCommand(agent);
  return {
    agent,
    cliCommand: explicitCli ?? builtin.command,
    explicitCli: Boolean(explicitCli),
    builtinCliSource: explicitCli ? 'explicit' : builtin.source,
  };
}

async function createCursorChatId(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('bash', ['-lc', 'agent create-chat'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const chatId = stdout.trim();
      if (code === 0 && chatId) {
        resolve(chatId);
        return;
      }
      reject(
        new Error(
          `failed to create cursor chat id${signal ? ` (signal ${signal})` : ''}${stderr.trim() ? `: ${stderr.trim()}` : ''}`
        )
      );
    });
  });
}

type ConversationConfig = {
  requestedMode: ChatMode;
  effectiveMode: ChatMode;
  warning?: string;
  sessionKind: 'none' | 'cursor' | 'codex';
  sessionId?: string;
};

async function prepareConversationConfig(options: {
  agent: BuiltinAgentId;
  explicitCli: boolean;
  builtinCliSource: 'default' | 'env' | 'explicit';
  chatMode: ChatMode;
}): Promise<ConversationConfig> {
  if (options.chatMode === 'fresh') {
    return { requestedMode: options.chatMode, effectiveMode: 'fresh', sessionKind: 'none' };
  }
  if (options.explicitCli) {
    return {
      requestedMode: options.chatMode,
      effectiveMode: 'fresh',
      warning: 'chat-mode=continue is only supported for builtin agent presets; falling back to fresh',
      sessionKind: 'none',
    };
  }
  if (options.builtinCliSource !== 'default') {
    return {
      requestedMode: options.chatMode,
      effectiveMode: 'fresh',
      warning: `chat-mode=continue requires the default ${options.agent} preset command; custom command override detected, falling back to fresh`,
      sessionKind: 'none',
    };
  }
  if (options.agent === 'cursor') {
    return {
      requestedMode: options.chatMode,
      effectiveMode: 'continue',
      sessionKind: 'cursor',
      sessionId: await createCursorChatId(),
    };
  }
  if (options.agent === 'codex') {
    return {
      requestedMode: options.chatMode,
      effectiveMode: 'continue',
      sessionKind: 'codex',
    };
  }
  return {
    requestedMode: options.chatMode,
    effectiveMode: 'fresh',
    warning: `chat-mode=continue is not implemented for agent=${options.agent}; falling back to fresh`,
    sessionKind: 'none',
  };
}

function buildIterationCommandLine(options: {
  cliCommand: string;
  promptText: string;
  agent: BuiltinAgentId;
  conversation: ConversationConfig;
}): string {
  if (options.conversation.effectiveMode === 'continue' && options.conversation.sessionKind === 'cursor' && options.conversation.sessionId) {
    return buildCommandLine(
      DEFAULT_CURSOR_CONTINUE_CLI.replace('{session}', shellQuote(options.conversation.sessionId)),
      options.promptText
    );
  }
  if (options.agent === 'codex' && options.conversation.sessionKind === 'codex') {
    const base = options.conversation.sessionId
      ? `codex exec resume --skip-git-repo-check --json ${shellQuote(options.conversation.sessionId)}`
      : 'codex exec --skip-git-repo-check --color never --json';
    return buildCommandLine(base, options.promptText);
  }
  return buildCommandLine(options.cliCommand, options.promptText);
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
  sessionId?: string;
};

async function runIteration(options: {
  commandLine: string;
  timeoutMs: number;
  terminateToken: string;
  outputMode?: 'default' | 'codex-jsonl';
}): Promise<RunIterationResult> {
  return await new Promise<RunIterationResult>((resolve, reject) => {
    const startedAt = Date.now();
    let timedOut = false;
    let terminateMatched = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let hardKillTimer: NodeJS.Timeout | undefined;
    let codexStdoutTail = '';
    let codexSessionId: string | undefined;

    const matcher = createTerminateMatcher(options.terminateToken);
    const child = spawn('bash', ['-lc', options.commandLine], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const writeAndMatch = (stream: NodeJS.WriteStream, text: string) => {
      stream.write(text);
      if (!terminateMatched && matcher(text)) {
        terminateMatched = true;
      }
    };

    const onCodexStdoutLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const obj = JSON.parse(trimmed) as any;
        if (typeof obj?.thread_id === 'string' && obj.thread_id.trim()) {
          codexSessionId = String(obj.thread_id).trim();
        }
        if (obj?.type === 'thread.started' && typeof obj?.thread_id === 'string' && obj.thread_id.trim()) {
          codexSessionId = String(obj.thread_id).trim();
          return;
        }
        if (obj?.type === 'item.completed' && obj?.item?.type === 'agent_message' && typeof obj?.item?.text === 'string') {
          const text = String(obj.item.text);
          writeAndMatch(process.stdout, text.endsWith('\n') ? text : `${text}\n`);
          return;
        }
        if (obj?.type === 'error' && typeof obj?.message === 'string') {
          writeAndMatch(process.stderr, `${String(obj.message)}\n`);
        }
        return;
      } catch {
        writeAndMatch(process.stdout, `${line}\n`);
      }
    };

    const onChunk = (rawChunk: Buffer, stream: NodeJS.WriteStream) => {
      const chunk = rawChunk.toString('utf8');
      if (options.outputMode === 'codex-jsonl' && stream === process.stdout) {
        const combined = `${codexStdoutTail}${chunk}`;
        const lines = combined.split('\n');
        codexStdoutTail = lines.pop() ?? '';
        for (const line of lines) onCodexStdoutLine(line);
        return;
      }
      writeAndMatch(stream, chunk);
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
      if (options.outputMode === 'codex-jsonl' && codexStdoutTail) {
        onCodexStdoutLine(codexStdoutTail);
        codexStdoutTail = '';
      }
      resolve({
        exitCode: typeof code === 'number' ? code : null,
        signal: signal ?? null,
        timedOut,
        terminateMatched,
        durationMs: Date.now() - startedAt,
        ...(codexSessionId ? { sessionId: codexSessionId } : {}),
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
    '--chat-mode <mode>',
    `Conversation reuse mode (${CHAT_MODES.join(', ')}). "continue" is supported for the builtin cursor and codex presets and is the default`,
    DEFAULT_CHAT_MODE
  )
  .option('-n, --fresh', 'Shortcut for --chat-mode fresh', false)
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
    const chatMode = resolveChatMode(options.chatMode, Boolean(options.fresh));
    const conversation = await prepareConversationConfig({
      agent: commandConfig.agent,
      explicitCli: commandConfig.explicitCli,
      builtinCliSource: commandConfig.builtinCliSource,
      chatMode,
    });

    process.stderr.write(
      `[looped] starting loop: timeout=${timeoutMs}ms terminate=${JSON.stringify(terminateToken)} promptSource=${prompt.source}\n`
    );
    process.stderr.write(
      `[looped] agent=${commandConfig.agent} explicitCli=${commandConfig.explicitCli ? 'yes' : 'no'} command=${JSON.stringify(commandConfig.cliCommand)}\n`
    );
    process.stderr.write(
      `[looped] chatMode=${conversation.effectiveMode} requestedChatMode=${conversation.requestedMode}${conversation.sessionId ? ' session=yes' : ' session=no'}\n`
    );
    if (conversation.warning) {
      process.stderr.write(`[looped] warning: ${conversation.warning}\n`);
    }
    process.stderr.write(`[looped] prompt: ${previewPrompt(prompt.text)}\n`);

    let iteration = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      iteration += 1;
      process.stderr.write(`\n[looped] iteration ${iteration} begin\n`);
      const commandLine = buildIterationCommandLine({
        cliCommand: commandConfig.cliCommand,
        promptText: prompt.text,
        agent: commandConfig.agent,
        conversation,
      });
      const result = await runIteration({
        commandLine,
        timeoutMs,
        terminateToken,
        outputMode: conversation.sessionKind === 'codex' ? 'codex-jsonl' : 'default',
      });
      if (conversation.sessionKind === 'codex' && result.sessionId) {
        conversation.sessionId = result.sessionId;
      }
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
