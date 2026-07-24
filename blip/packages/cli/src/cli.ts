#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { ReadStream as TtyReadStream, WriteStream as TtyWriteStream } from 'node:tty';
import type { BlipRuntimeEvent, BlipToolProvider } from '@blip/core';
import {
  defaultToolProfile,
  compactSession,
  collectProcessDiagnostics,
  runBlipTask,
  SessionStore,
} from '@blip/core/node';
import type { PermissionMode, ToolProfile } from '@blip/tools';
import { createMcpToolProvider } from '@blip/mcp';
import { getModels } from '@mariozechner/pi-ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  getOAuthApiKey,
  refreshOpenAICodexToken,
  type OAuthCredentials,
} from '@mariozechner/pi-ai/oauth';
import { assembleCliSystemPrompt } from './cli-prompt.js';

const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_REASONING: NonNullable<CliOptions['reasoning']> = 'high';
const OPENAI_CODEX_PROVIDER = 'openai-codex';
const BLIP_CONFIG_FILE_ENV = 'BLIP_CONFIG_FILE';
const CLI_VERSION = '0.1.0';
const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

type CliConfig = {
  provider?: string;
  model?: string;
  reasoning?: ReasoningLevel;
};

type ReasoningLevel = (typeof REASONING_LEVELS)[number];

type CliOptions = {
  promptParts: string[];
  jsonl: boolean;
  debug: boolean;
  provider?: string;
  model?: string;
  workspace?: string;
  permission?: PermissionMode;
  profile?: ToolProfile;
  continueLatest: boolean;
  resumeLatest: boolean;
  sessionId?: string;
  forkSessionId?: string;
  listSessions: boolean;
  listModels: boolean;
  compact: boolean;
  help: boolean;
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

function helpText(): string {
  return `Blip CLI coding agent

Usage:
  blip
  blip [options] "task prompt"
  blip --jsonl "task prompt"
  blip --continue "next task"
  blip --compact [--session <id>]

Options:
  --jsonl                    Emit runtime events as JSONL on stdout
  -d, -D, --debug            Show verbose runtime output, including every tool call
  --provider <provider>      Model provider (default: BLIP_PROVIDER, saved config, or openai-codex)
  --model <model>            Model id, or provider/model (default: BLIP_MODEL, saved config, or gpt-5.5)
  --reasoning <level>        off|minimal|low|medium|high|xhigh (default: BLIP_REASONING, saved config, or high)
  --workspace <path>         Workspace root (default: cwd)
  --permission <mode>        read-only|workspace-write|full-access
  --profile <profile>        local-trusted-write|read-only|no-shell-workspace-write
  --continue                 Continue latest session for this workspace
  --resume                   Resume latest session for this workspace
  --session <id>             Resume an exact session
  --fork <id>                Fork an existing session
  --list-sessions            List sessions for this workspace
  --list-models              List known models for the selected provider
  --compact                  Compact a session
  -h, --help                 Show help

Interactive:
  Run "blip" with no prompt to open an interactive session.
  Commands: /model [id|provider/id], /reasoning [level], /exit, /quit

Environment:
  BLIP_PROVIDER              Default provider
  BLIP_MODEL                 Default model id or provider/model
  BLIP_CONFIG_FILE           Override Blip CLI config file path
  BLIP_DATA_DIR              Override Blip session data directory
  BLIP_REASONING             Default reasoning level
  BLIP_CODEX_AUTH_FILE       Override Codex auth file path
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    promptParts: [],
    jsonl: false,
    debug: false,
    continueLatest: false,
    resumeLatest: false,
    listSessions: false,
    listModels: false,
    compact: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--jsonl') options.jsonl = true;
    else if (arg === '-d' || arg === '-D' || arg === '--debug') options.debug = true;
    else if (arg === '--provider') options.provider = next();
    else if (arg === '--model') options.model = next();
    else if (arg === '--reasoning') options.reasoning = parseReasoning(next());
    else if (arg === '--workspace') options.workspace = next();
    else if (arg === '--permission') options.permission = parsePermission(next());
    else if (arg === '--profile') options.profile = parseProfile(next());
    else if (arg === '--continue') options.continueLatest = true;
    else if (arg === '--resume') options.resumeLatest = true;
    else if (arg === '--session') options.sessionId = next();
    else if (arg === '--fork') options.forkSessionId = next();
    else if (arg === '--list-sessions') options.listSessions = true;
    else if (arg === '--list-models') options.listModels = true;
    else if (arg === '--compact') options.compact = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--') options.promptParts.push(...argv.slice(index + 1));
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else options.promptParts.push(arg);
  }

  return options;
}

function parsePermission(value: string): PermissionMode {
  if (value === 'read-only' || value === 'workspace-write' || value === 'full-access') return value;
  throw new Error('invalid permission mode');
}

function parseProfile(value: string): ToolProfile {
  if (
    value === 'local-trusted-write' ||
    value === 'read-only' ||
    value === 'no-shell-workspace-write'
  )
    return value;
  throw new Error('invalid tool profile');
}

function parseReasoning(value: string): NonNullable<CliOptions['reasoning']> {
  if (REASONING_LEVELS.includes(value as ReasoningLevel)) return value as ReasoningLevel;
  throw new Error('invalid reasoning level');
}

function ansi(code: string, text: string): string {
  if (!supportsAnsi()) return text;
  return `${code}${text}${ANSI.reset}`;
}

function supportsAnsi(): boolean {
  return !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function bold(text: string): string {
  return ansi(ANSI.bold, text);
}

function dim(text: string): string {
  return ansi(ANSI.dim, text);
}

function cyan(text: string): string {
  return ansi(ANSI.cyan, text);
}

function green(text: string): string {
  return ansi(ANSI.green, text);
}

function yellow(text: string): string {
  return ansi(ANSI.yellow, text);
}

function red(text: string): string {
  return ansi(ANSI.red, text);
}

function gray(text: string): string {
  return ansi(ANSI.gray, text);
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

async function readStdinIfNeeded(
  promptParts: string[],
): Promise<{ prompt: string; readFromStdin: boolean }> {
  const prompt = promptParts.join(' ').trim();
  if (prompt) return { prompt, readFromStdin: false };
  if (!shouldReadStdinForPrompt()) return { prompt: '', readFromStdin: false };
  process.stdin.setEncoding('utf8');
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return { prompt: chunks.join('').trim(), readFromStdin: true };
}

function shouldReadStdinForPrompt(): boolean {
  if (process.stdin.isTTY) return false;
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isFile() || stat.isSocket();
  } catch {
    return true;
  }
}

function blipConfigFilePath(): string {
  const explicit = String(process.env[BLIP_CONFIG_FILE_ENV] ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const configHome =
    String(process.env.XDG_CONFIG_HOME ?? '').trim() || path.join(os.homedir(), '.config');
  return path.join(configHome, 'blip', 'config.json');
}

function readCliConfig(): CliConfig {
  const raw = readJsonFile(blipConfigFilePath());
  if (!raw || typeof raw !== 'object') return {};
  const reasoning =
    typeof raw.reasoning === 'string' && REASONING_LEVELS.includes(raw.reasoning as ReasoningLevel)
      ? (raw.reasoning as ReasoningLevel)
      : undefined;
  return {
    ...(typeof raw.provider === 'string' && raw.provider.trim()
      ? { provider: raw.provider.trim() }
      : {}),
    ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

function saveDefaultModelSetup(provider: string, model: string, reasoning: ReasoningLevel): void {
  const current = readCliConfig();
  writeJsonFile(blipConfigFilePath(), { ...current, provider, model, reasoning });
}

function splitProviderModel(
  rawModel: string,
  fallbackProvider: string,
): { provider: string; model: string } {
  let provider = fallbackProvider;
  let model = rawModel;
  if (model.includes('/')) {
    const [modelProvider, ...rest] = model.split('/');
    provider = modelProvider;
    model = rest.join('/');
  }
  return { provider, model };
}

function resolveProviderModel(options: CliOptions): { provider: string; model: string } {
  const config = readCliConfig();
  const provider =
    options.provider || process.env.BLIP_PROVIDER || config.provider || DEFAULT_PROVIDER;
  const model = options.model || process.env.BLIP_MODEL || config.model || DEFAULT_MODEL;
  return splitProviderModel(model, provider);
}

function resolveReasoning(options: CliOptions): NonNullable<CliOptions['reasoning']> {
  const config = readCliConfig();
  return (
    options.reasoning ??
    parseReasoning(process.env.BLIP_REASONING || config.reasoning || DEFAULT_REASONING)
  );
}

function jwtExpiresAtMs(token: string): number | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    const exp = typeof json.exp === 'number' ? json.exp : NaN;
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function parseExpiresAtMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function shouldRefresh(expiresMs: number | undefined): boolean {
  if (!expiresMs) return false;
  return Date.now() >= expiresMs - 60_000;
}

function readJsonFile(filePath: string): any | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // A refreshed token can still be used for this run even if persisting it fails.
  }
}

function codexAuthFileCandidates(): string[] {
  const explicit = String(process.env.BLIP_CODEX_AUTH_FILE ?? '').trim();
  const candidates = [
    explicit,
    path.join(os.homedir(), '.codex', 'auth.json'),
    path.resolve(process.cwd(), 'auth.json'),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

async function resolvePiAiCodexAuth(filePath: string, raw: any): Promise<string | undefined> {
  const entry = raw?.[OPENAI_CODEX_PROVIDER];
  if (!entry || typeof entry !== 'object') return undefined;
  const result = await getOAuthApiKey(OPENAI_CODEX_PROVIDER, {
    [OPENAI_CODEX_PROVIDER]: entry as OAuthCredentials,
  });
  if (!result?.apiKey) return undefined;
  if (result.newCredentials !== entry) {
    raw[OPENAI_CODEX_PROVIDER] = { ...entry, ...result.newCredentials };
    writeJsonFile(filePath, raw);
  }
  return result.apiKey;
}

async function resolveCodexCliAuth(filePath: string, raw: any): Promise<string | undefined> {
  const tokens = raw?.tokens;
  if (!tokens || typeof tokens !== 'object') return undefined;
  let access = String(tokens.access_token ?? tokens.access ?? '').trim();
  const refresh = String(tokens.refresh_token ?? tokens.refresh ?? '').trim();
  const expires =
    parseExpiresAtMs(tokens.expires_at ?? tokens.expiresAt ?? tokens.expires) ??
    jwtExpiresAtMs(access);
  if (!access && !refresh) return undefined;
  if (refresh && shouldRefresh(expires)) {
    const refreshed = await refreshOpenAICodexToken(refresh);
    access = refreshed.access;
    raw.tokens = {
      ...tokens,
      access_token: refreshed.access,
      refresh_token: refreshed.refresh,
      account_id: refreshed.accountId ?? tokens.account_id,
      expires_at: new Date(refreshed.expires).toISOString(),
    };
    raw.last_refresh = new Date().toISOString();
    writeJsonFile(filePath, raw);
  }
  return access || undefined;
}

function createApiKeyResolver(): (provider: string) => Promise<string | undefined> {
  const cache = new Map<string, Promise<string | undefined>>();
  return async (provider: string) => {
    if (provider !== OPENAI_CODEX_PROVIDER) return undefined;
    const cached = cache.get(provider);
    if (cached) return cached;
    const task = (async () => {
      for (const filePath of codexAuthFileCandidates()) {
        const raw = readJsonFile(filePath);
        if (!raw || typeof raw !== 'object') continue;
        const fromCodexCli = await resolveCodexCliAuth(filePath, raw);
        if (fromCodexCli) return fromCodexCli;
        const fromPiAi = await resolvePiAiCodexAuth(filePath, raw);
        if (fromPiAi) return fromPiAi;
      }
      return undefined;
    })();
    cache.set(provider, task);
    return task;
  };
}

function formatDurationMs(ms: number): string {
  const safeMs = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  if (safeMs < 1000) return `${safeMs}ms`;
  if (safeMs < 60_000) return `${(safeMs / 1000).toFixed(safeMs < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.round((safeMs % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

function formatTimingSummary(
  event: Extract<BlipRuntimeEvent, { type: 'session_finished' }>,
): string | undefined {
  const timing = event.timing;
  if (!timing) return undefined;
  const parallel =
    timing.toolTurnCount > 0
      ? `, parallel ${timing.parallelToolTurnCount}/${timing.toolTurnCount}`
      : '';
  const context = event.contextUsage
    ? `, context ${formatContextPercent(event.contextUsage.percent)}`
    : '';
  return `timing total ${formatDurationMs(timing.durationMs)}, tools ${formatDurationMs(timing.toolCallWallMs)}, non-tool ${formatDurationMs(timing.nonToolWallMs)}, turns ${timing.turnCount}${parallel}${context}`;
}

function formatContextSummary(
  event: Extract<BlipRuntimeEvent, { type: 'session_finished' }>,
): string | undefined {
  if (!event.contextUsage) return undefined;
  return `Context: ${formatContextPercent(event.contextUsage.percent)}`;
}

function streamIsTty(stream: NodeJS.WritableStream): boolean {
  return Boolean((stream as NodeJS.WritableStream & { isTTY?: boolean }).isTTY);
}

function formatContextPercent(percent: number): string {
  const safePercent = Math.max(0, Number.isFinite(percent) ? percent : 0);
  return `${safePercent < 10 ? safePercent.toFixed(1) : Math.round(safePercent).toString()}%`;
}

class EphemeralStatusLine {
  private rendered = false;

  constructor(
    private readonly write: (text: string) => void,
    private readonly enabled: boolean,
  ) {}

  show(text: string): void {
    if (!this.enabled) return;
    this.write(`\r\x1b[2K${text}`);
    this.rendered = true;
  }

  clear(): void {
    if (!this.enabled || !this.rendered) return;
    this.write('\r\x1b[2K');
    this.rendered = false;
  }
}

function formatStatusTool(
  event: Extract<
    BlipRuntimeEvent,
    {
      type: 'tool_call_started' | 'tool_call_progress' | 'tool_call_completed' | 'tool_call_failed';
    }
  >,
): string {
  if (event.type === 'tool_call_progress')
    return `${gray('↳')} ${gray('tool')} ${event.tool} ${gray(event.message)}`;
  if (event.type === 'tool_call_completed') return `${gray('Thinking...')}`;
  if (event.type === 'tool_call_failed')
    return `${red('tool failed')} ${event.tool}; ${gray('Thinking...')}`;
  return `${gray('↳')} ${gray('tool')} ${event.tool}`;
}

function renderHuman(event: BlipRuntimeEvent): void {
  if (event.type === 'session_started') {
    console.error(
      `Blip session ${event.sessionId} ${event.resumed ? 'resumed' : 'started'} (${event.model}, ${event.toolProfile})`,
    );
  } else if (event.type === 'assistant_delta') {
    process.stdout.write(event.text);
  } else if (event.type === 'tool_call_started') {
    console.error(`\n[tool] ${event.tool}`);
  } else if (event.type === 'tool_call_failed') {
    console.error(`[tool failed] ${event.tool}: ${event.error}`);
  } else if (event.type === 'session_error') {
    console.error(`[error] ${event.error}`);
  } else if (event.type === 'session_finished') {
    process.stdout.write('\n');
    const detail = event.status === 'error' && event.error ? `: ${event.error}` : '';
    console.error(
      `Blip finished: ${event.status}${detail}${event.changedFiles.length ? `; changed ${event.changedFiles.join(', ')}` : ''}`,
    );
    const timing = formatTimingSummary(event);
    if (timing) console.error(timing);
  } else if (event.type === 'process_diagnostics') {
    console.error(
      `[process diagnostics] ${event.reason}; handles=${JSON.stringify(event.activeHandles)} requests=${JSON.stringify(event.activeRequests)}`,
    );
  } else if (event.type === 'compaction_completed') {
    console.error(`Compacted session: ${event.summaryId}`);
  } else if (event.type === 'compaction_skipped') {
    console.error(`Compaction skipped: ${event.reason}`);
  }
}

type HumanEventRenderer = ((event: BlipRuntimeEvent) => void) & { close?: () => void };

function createCompactHumanRenderer(input: {
  writeAssistant: (text: string) => void;
  writeStatus: (text: string) => void;
  statusEnabled: boolean;
  assistantPrefix?: string;
  statusPrefix?: string;
  onError?: (error: string) => void;
}): HumanEventRenderer {
  const status = new EphemeralStatusLine(input.writeStatus, input.statusEnabled);
  const activeTools = new Map<string, string>();
  let wroteAssistantText = false;
  let lastAssistantChar = '\n';
  let lastError = '';

  const ensureStatusOwnLine = () => {
    if (wroteAssistantText && lastAssistantChar !== '\n') {
      input.writeAssistant('\n');
      lastAssistantChar = '\n';
    }
  };

  const render = ((event: BlipRuntimeEvent) => {
    if (event.type === 'assistant_delta') {
      status.clear();
      if (!wroteAssistantText && input.assistantPrefix) input.writeAssistant(input.assistantPrefix);
      wroteAssistantText = true;
      input.writeAssistant(event.text);
      lastAssistantChar = event.text ? event.text[event.text.length - 1]! : lastAssistantChar;
      return;
    }

    if (
      event.type === 'tool_call_started' ||
      event.type === 'tool_call_progress' ||
      event.type === 'tool_call_completed' ||
      event.type === 'tool_call_failed'
    ) {
      if (input.statusEnabled) ensureStatusOwnLine();
      if (event.type === 'tool_call_started' || event.type === 'tool_call_progress') {
        activeTools.set(event.callId, event.tool);
        status.show(`${input.statusPrefix ?? ''}${formatStatusTool(event)}`);
      } else {
        activeTools.delete(event.callId);
        const latestActive = Array.from(activeTools.values()).at(-1);
        status.show(
          `${input.statusPrefix ?? ''}${latestActive ? `${gray('↳')} ${gray('tool')} ${latestActive}` : formatStatusTool(event)}`,
        );
      }
      return;
    }

    if (event.type === 'session_error') {
      status.clear();
      ensureStatusOwnLine();
      lastError = event.error;
      input.onError?.(event.error);
      return;
    }

    if (event.type === 'session_finished') {
      status.clear();
      if (wroteAssistantText && lastAssistantChar !== '\n') {
        input.writeAssistant('\n');
        lastAssistantChar = '\n';
      }
      if (event.status === 'error' && event.error && event.error !== lastError) {
        ensureStatusOwnLine();
        lastError = event.error;
        input.onError?.(event.error);
      }
      const contextSummary = formatContextSummary(event);
      if (contextSummary) input.writeStatus(`${input.statusPrefix ?? ''}${gray(contextSummary)}\n`);
      activeTools.clear();
      wroteAssistantText = false;
      return;
    }
  }) as HumanEventRenderer;

  render.close = () => status.clear();
  return render;
}

function processDiagnosticsEvent(sessionId: string, reason: string): BlipRuntimeEvent {
  return {
    version: 1,
    eventId: randomUUID(),
    type: 'process_diagnostics',
    sessionId,
    timestamp: new Date().toISOString(),
    reason,
    ...collectProcessDiagnostics(),
  };
}

async function emitFinalProcessDiagnostics(
  workspaceRoot: string,
  sessionId: string,
  emit: (event: BlipRuntimeEvent) => void,
): Promise<void> {
  const event = processDiagnosticsEvent(sessionId, 'process diagnostics before one-shot CLI exit');
  try {
    const store = new SessionStore(workspaceRoot);
    const session = await store.load(sessionId);
    await store.appendRuntimeEvent(session, event);
  } catch {
    // The stdout/stderr event is still the source of truth for wrappers such as Drone.
  }
  emit(event);
}

async function listSessions(workspaceRoot: string): Promise<void> {
  const store = new SessionStore(workspaceRoot);
  const sessions = await store.list();
  if (sessions.length === 0) {
    console.log('No Blip sessions found.');
    return;
  }
  for (const session of sessions) {
    console.log(
      `${session.id}\t${session.updatedAt}\t${session.modelProvider}/${session.modelId}\t${session.toolProfile}`,
    );
  }
}

function listModels(provider: string, currentModel: string): void {
  const models = getModels(provider as any).map((model) => ({
    id: model.id,
    label: model.name || model.id,
    reasoningLevels: model.reasoning
      ? REASONING_LEVELS.filter(
          (level) => level !== 'xhigh' || model.thinkingLevelMap?.xhigh !== undefined,
        )
      : ['off'],
    defaultReasoningLevel: model.reasoning ? DEFAULT_REASONING : 'off',
    ...(model.id === DEFAULT_MODEL && provider === DEFAULT_PROVIDER ? { default: true } : {}),
    ...(model.id === currentModel ? { current: true } : {}),
  }));
  console.log(JSON.stringify({ models }, null, 2));
}

type RunContext = {
  workspaceRoot: string;
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
  reasoning: ReasoningLevel;
  processExitDiagnosticsDelayMs: number;
  getApiKey: (provider: string) => Promise<string | undefined>;
  emit: (event: BlipRuntimeEvent) => void;
  toolProviders: BlipToolProvider[];
};

async function connectManagedMcp(): Promise<{
  toolProviders: BlipToolProvider[];
  close: () => Promise<void>;
}> {
  const url = String(process.env.DRONE_HUB_MCP_URL ?? '').trim();
  const token = String(process.env.DRONE_HUB_MCP_TOKEN ?? '').trim();
  if (!url && !token) return { toolProviders: [], close: async () => undefined };
  if (!url || !token) throw new Error('incomplete Drone Hub managed chat MCP configuration');
  const client = new Client({ name: 'Blip managed chat', version: CLI_VERSION });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return {
    toolProviders: [
      createMcpToolProvider({
        id: 'drone-hub',
        namePrefix: 'drone_hub',
        client,
        promptGuidance:
          'Use drone_hub__ tools for Drone Hub drones, chats, groups, repositories, and whiteboards.',
      }),
    ],
    close: async () => {
      await client.close();
    },
  };
}

type InteractiveReadline = {
  rl: ReturnType<typeof createInterface>;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  write: (text: string) => void;
  close: () => void;
};

type SelectChoice<T extends string> = {
  name: string;
  value: T;
  short?: string;
};

function resetInteractiveReadline(interactive: InteractiveReadline): void {
  interactive.rl = createInterface({
    input: interactive.input as NodeJS.ReadableStream,
    output: interactive.output as NodeJS.WritableStream,
    terminal: true,
  });
}

function renderSelectPrompt<T extends string>(
  output: NodeJS.WritableStream,
  message: string,
  choices: SelectChoice<T>[],
  selectedIndex: number,
  rendered: boolean,
): void {
  if (rendered && supportsAnsi()) output.write(`\x1b[${choices.length + 1}A\r\x1b[J`);
  output.write(`? ${message} ${gray('(Use arrow keys)')}\n`);
  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index];
    const prefix = index === selectedIndex ? '❯' : ' ';
    const label = index === selectedIndex ? green(choice.name) : choice.name;
    output.write(`${prefix} ${label}\n`);
  }
}

function clearSelectPrompt(output: NodeJS.WritableStream, lineCount: number): void {
  if (!supportsAnsi()) return;
  output.write(`\x1b[${lineCount}A\r\x1b[J`);
}

async function promptList<T extends string>(
  interactive: InteractiveReadline,
  message: string,
  choices: SelectChoice<T>[],
  defaultValue: T | undefined,
): Promise<T> {
  if (choices.length === 0) throw new Error('no choices available');
  interactive.rl.close();
  const input = interactive.input as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const output = interactive.output;
  const initialIndex = defaultValue
    ? choices.findIndex((choice) => choice.value === defaultValue)
    : -1;
  let selectedIndex = initialIndex >= 0 ? initialIndex : 0;
  let rendered = false;
  let pendingSequence = '';
  const wasRaw = Boolean(input.isRaw);

  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      input.off('data', onData);
      if (input.setRawMode) input.setRawMode(wasRaw);
      clearSelectPrompt(output, choices.length + 1);
      resetInteractiveReadline(interactive);
    };
    const finish = (value: T) => {
      cleanup();
      resolve(value);
    };
    const cancel = () => {
      cleanup();
      reject(new Error('selection cancelled'));
    };
    const move = (offset: number) => {
      selectedIndex = (selectedIndex + offset + choices.length) % choices.length;
      renderSelectPrompt(output, message, choices, selectedIndex, rendered);
      rendered = true;
    };
    const onData = (chunk: Buffer) => {
      const text = pendingSequence + chunk.toString('utf8');
      pendingSequence = '';
      for (let index = 0; index < text.length; index += 1) {
        const tail = text.slice(index);
        if (tail.startsWith('\x1b') && tail.length < 3) {
          pendingSequence = tail;
          return;
        } else if (tail.startsWith('\x1b[A') || tail.startsWith('\x1bOA')) {
          move(-1);
          index += 2;
        } else if (tail.startsWith('\x1b[B') || tail.startsWith('\x1bOB')) {
          move(1);
          index += 2;
        } else if (text[index] === 'k') {
          move(-1);
        } else if (text[index] === 'j') {
          move(1);
        } else if (text[index] === '\r' || text[index] === '\n') {
          finish(choices[selectedIndex]!.value);
          return;
        } else if (text[index] === '\x03' || text[index] === '\x1b') {
          cancel();
          return;
        }
      }
    };

    try {
      if (input.setRawMode) input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      renderSelectPrompt(output, message, choices, selectedIndex, rendered);
      rendered = true;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function formatModelLabel(provider: string, model: string): string {
  return provider === DEFAULT_PROVIDER ? model : `${provider}/${model}`;
}

function displayPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  if (resolved === home) return '~';
  if (resolved.startsWith(`${home}${path.sep}`))
    return `~${path.sep}${path.relative(home, resolved)}`;
  return resolved;
}

async function flushWritable(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      stream.write('', () => resolve());
    } catch {
      resolve();
    }
  });
}

async function exitOneShot(code: number): Promise<void> {
  process.exitCode = code;
  await Promise.all([flushWritable(process.stdout), flushWritable(process.stderr)]);
  process.exit(code);
}

function renderInteractiveHeader(context: RunContext, write: (text: string) => void): void {
  const model = `${formatModelLabel(context.provider, context.model)} ${context.reasoning}`;
  const directory = displayPath(context.workspaceRoot);
  const width = Math.max(42, visibleLength(directory) + 13, visibleLength(model) + 29);
  const line = (content = '') => {
    const padding = ' '.repeat(Math.max(0, width - visibleLength(content)));
    write(`${dim('│')}  ${content}${padding}  ${dim('│')}\n`);
  };

  write(`${dim(`╭${'─'.repeat(width + 4)}╮`)}\n`);
  line(`${bold('Blip')} ${gray(`(v${CLI_VERSION})`)}`);
  line();
  line(`${gray('model:')}     ${green(model)}  ${cyan('/model')} ${gray('to change')}`);
  line(`${gray('directory:')} ${cyan(directory)}`);
  write(`${dim(`╰${'─'.repeat(width + 4)}╯`)}\n\n`);
  write(
    `${gray('Tip:')} ${cyan('/model')} ${gray('model')}  ${cyan('/reasoning')} ${gray('reasoning')}  ${cyan('/exit')} ${gray('quit')}\n\n`,
  );
}

function inputLinePrefix(): string {
  return '› ';
}

type InteractiveRenderState = {
  sawError: boolean;
};

function createInteractiveRenderer(
  write: (text: string) => void,
  state: InteractiveRenderState,
): (event: BlipRuntimeEvent) => void {
  let wroteAssistantText = false;
  let lastEventWasTool = false;
  let lastError = '';

  return (event: BlipRuntimeEvent) => {
    if (event.type === 'assistant_delta') {
      if (!wroteAssistantText) {
        write(`\n${cyan('•')} `);
        wroteAssistantText = true;
      }
      write(event.text);
      lastEventWasTool = false;
      return;
    }

    if (event.type === 'tool_call_started') {
      write(`${wroteAssistantText ? '\n' : '\n'}${gray('↳')} ${gray('tool')} ${event.tool}\n`);
      lastEventWasTool = true;
      return;
    }

    if (event.type === 'tool_call_failed') {
      write(`${red('tool failed')} ${event.tool}: ${event.error}\n`);
      lastEventWasTool = true;
      return;
    }

    if (event.type === 'session_error') {
      state.sawError = true;
      lastError = event.error;
      write(
        `${wroteAssistantText || lastEventWasTool ? '\n' : ''}${red('Error:')} ${event.error}\n`,
      );
      return;
    }

    if (event.type === 'session_finished') {
      if (wroteAssistantText) write('\n');
      if (event.status === 'error' && event.error && event.error !== lastError) {
        state.sawError = true;
        lastError = event.error;
        write(`${red('Error:')} ${event.error}\n`);
      }
      if (event.changedFiles.length) write(`${gray('changed')} ${event.changedFiles.join(', ')}\n`);
      const timing = formatTimingSummary(event);
      if (timing) write(`${gray(timing)}\n`);
      write('\n');
      wroteAssistantText = false;
      lastEventWasTool = false;
      return;
    }

    if (event.type === 'process_diagnostics') {
      write(
        `${gray('process diagnostics')} ${event.reason}; handles=${JSON.stringify(event.activeHandles)} requests=${JSON.stringify(event.activeRequests)}\n`,
      );
      return;
    }

    if (event.type === 'compaction_completed') {
      write(`${gray('compacted')} ${event.summaryId}\n`);
    } else if (event.type === 'compaction_skipped') {
      write(`${gray('compaction skipped')} ${event.reason}\n`);
    }
  };
}

function createInteractiveReadline(): InteractiveReadline | null {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return {
      rl,
      input: process.stdin,
      output: process.stdout,
      write: (text) => process.stdout.write(text),
      close: () => rl.close(),
    };
  }

  if (process.platform === 'win32') return null;

  let inputFd: number | undefined;
  let outputFd: number | undefined;
  try {
    inputFd = openSync('/dev/tty', 'r');
    outputFd = openSync('/dev/tty', 'w');
    const input = new TtyReadStream(inputFd);
    const output = new TtyWriteStream(outputFd);
    const rl = createInterface({ input, output, terminal: true });
    return {
      rl,
      input,
      output,
      write: (text) => output.write(text),
      close() {
        rl.close();
        input.destroy();
        output.end();
      },
    };
  } catch {
    if (outputFd !== undefined) closeSync(outputFd);
    if (inputFd !== undefined) closeSync(inputFd);
    return null;
  }
}

async function runPrompt(
  prompt: string,
  context: RunContext,
  options: CliOptions,
  processExitDiagnosticsDelayMs = context.processExitDiagnosticsDelayMs,
): Promise<string> {
  const session = await runBlipTask(
    {
      prompt,
      workspaceRoot: context.workspaceRoot,
      provider: context.provider,
      model: context.model,
      permissionMode: context.permissionMode,
      toolProfile: context.toolProfile,
      sessionId: options.sessionId,
      continueLatest: options.continueLatest,
      resumeLatest: options.resumeLatest,
      forkSessionId: options.forkSessionId,
      jsonl: options.jsonl,
      reasoning: context.reasoning,
      processExitDiagnosticsDelayMs,
      getApiKey: context.getApiKey,
      promptProvider: () =>
        assembleCliSystemPrompt({
          workspaceRoot: context.workspaceRoot,
          toolProfile: context.toolProfile,
        }),
      toolProviders: context.toolProviders,
    },
    context.emit,
  );
  return session.id;
}

async function runInteractive(context: RunContext, options: CliOptions): Promise<void> {
  const interactive = createInteractiveReadline();
  if (!interactive) throw new Error('missing prompt');
  const { write } = interactive;
  let sessionId = options.sessionId;
  let continueLatest = options.continueLatest;
  let resumeLatest = options.resumeLatest;
  let forkSessionId = options.forkSessionId;

  renderInteractiveHeader(context, write);
  try {
    while (true) {
      let raw: string;
      try {
        raw = await interactive.rl.question(inputLinePrefix());
      } catch {
        break;
      }
      const prompt = raw.trim();
      if (!prompt) {
        continue;
      }
      if (prompt === '/exit' || prompt === '/quit') {
        break;
      }
      if (prompt === '/model' || prompt.startsWith('/model ')) {
        await chooseInteractiveModel(prompt.slice('/model'.length).trim(), context, interactive);
        continue;
      }
      if (prompt === '/reasoning' || prompt.startsWith('/reasoning ')) {
        const changed = await chooseInteractiveReasoning(
          prompt.slice('/reasoning'.length).trim(),
          context,
          interactive,
        );
        if (changed) {
          saveDefaultModelSetup(context.provider, context.model, context.reasoning);
          write(`${green('Default reasoning set')} ${context.reasoning}\n\n`);
        }
        continue;
      }
      const renderState: InteractiveRenderState = { sawError: false };
      const turnRenderer: HumanEventRenderer = options.debug
        ? (createInteractiveRenderer(write, renderState) as HumanEventRenderer)
        : createCompactHumanRenderer({
            writeAssistant: write,
            writeStatus: write,
            statusEnabled: supportsAnsi() && streamIsTty(interactive.output),
            assistantPrefix: `\n${cyan('•')}  `,
            statusPrefix: '  ',
            onError: (error) => {
              renderState.sawError = true;
              write(`  ${red('Error:')} ${error}\n`);
            },
          });
      try {
        context.emit = turnRenderer;
        sessionId = await runPrompt(
          prompt,
          context,
          {
            ...options,
            sessionId,
            continueLatest,
            resumeLatest,
            forkSessionId,
          },
          0,
        );
        continueLatest = false;
        resumeLatest = false;
        forkSessionId = undefined;
      } catch (error) {
        turnRenderer.close?.();
        if (!renderState.sawError) {
          write(`${red('Error:')} ${error instanceof Error ? error.message : String(error)}\n\n`);
        }
        continue;
      }
      turnRenderer.close?.();
    }
  } finally {
    interactive.close();
  }
}

async function chooseInteractiveModel(
  rawSelection: string,
  context: RunContext,
  interactive: InteractiveReadline,
): Promise<void> {
  let selection = rawSelection.trim();
  const models = getModels(context.provider as any);
  if (!selection) {
    if (models.length === 0) {
      console.error(
        `${yellow('No known models')} for ${context.provider}. Use /model provider/model to set one directly.`,
      );
      return;
    }
    try {
      selection = await promptList(
        interactive,
        'model',
        models.map((model) => ({
          name: `${model.id}${model.name && model.name !== model.id ? ` ${gray(model.name)}` : ''}`,
          value: model.id,
          short: model.id,
        })),
        models.some((model) => model.id === context.model) ? context.model : models[0]?.id,
      );
    } catch {
      return;
    }
    if (!selection) return;
  }

  let next: { provider: string; model: string };
  if (/^\d+$/.test(selection) && models.length > 0) {
    const index = Number(selection) - 1;
    if (index < 0 || index >= models.length) {
      console.error(`${red('Unknown model number:')} ${selection}`);
      return;
    }
    next = { provider: context.provider, model: models[index].id };
  } else {
    next = splitProviderModel(selection, context.provider);
  }

  const knownModels = getModels(next.provider as any);
  if (knownModels.length > 0 && !knownModels.some((model) => model.id === next.model)) {
    console.error(`${red('Unknown model for')} ${next.provider}: ${next.model}`);
    return;
  }

  context.provider = next.provider;
  context.model = next.model;
  await chooseInteractiveReasoning('', context, interactive);
  saveDefaultModelSetup(next.provider, next.model, context.reasoning);
  console.error(
    `${green('Default model set')} ${formatModelLabel(next.provider, next.model)} ${gray(`with ${context.reasoning} reasoning`)}`,
  );
}

async function chooseInteractiveReasoning(
  rawSelection: string,
  context: RunContext,
  interactive: InteractiveReadline,
): Promise<boolean> {
  const selection = rawSelection.trim();
  if (selection) {
    try {
      context.reasoning = parseReasoning(selection);
      return true;
    } catch {
      console.error(`${red('Unknown reasoning level:')} ${selection}`);
      return false;
    }
  }

  try {
    context.reasoning = await promptList(
      interactive,
      'reasoning',
      REASONING_LEVELS.map((level) => ({
        name: `${level}${level === context.reasoning ? ` ${green('(current)')}` : ''}`,
        value: level,
        short: level,
      })),
      context.reasoning,
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const { provider, model } = resolveProviderModel(options);
  const reasoning = resolveReasoning(options);
  if (options.listModels) {
    listModels(provider, model);
    return;
  }

  const workspaceRoot = options.workspace || process.cwd();
  if (options.listSessions) {
    await listSessions(workspaceRoot);
    return;
  }

  const getApiKey = createApiKeyResolver();
  const permissionMode = options.permission ?? 'workspace-write';
  const toolProfile = options.profile ?? defaultToolProfile(permissionMode, true);
  if (permissionMode === 'read-only' && toolProfile !== 'read-only') {
    throw new Error('read-only permission requires read-only tool profile');
  }

  const humanRenderer: HumanEventRenderer = options.debug
    ? (renderHuman as HumanEventRenderer)
    : createCompactHumanRenderer({
        writeAssistant: (text) => process.stdout.write(text),
        writeStatus: (text) => process.stderr.write(text),
        statusEnabled: supportsAnsi() && streamIsTty(process.stdout) && streamIsTty(process.stderr),
        onError: (error) => console.error(`${red('Error:')} ${error}`),
      });
  const emit = (event: BlipRuntimeEvent) => {
    if (options.jsonl) console.log(JSON.stringify(event));
    else humanRenderer(event);
  };
  let finishedStatus: 'completed' | 'cancelled' | 'error' | undefined;
  let finishedError = '';
  const emitAndTrack = (event: BlipRuntimeEvent) => {
    if (event.type === 'session_finished') {
      finishedStatus = event.status;
      finishedError = event.error ?? '';
    }
    emit(event);
  };

  if (options.compact) {
    const compactEmit = options.jsonl ? emit : (event: BlipRuntimeEvent) => renderHuman(event);
    await compactSession({
      workspaceRoot,
      sessionId: options.sessionId,
      trigger: 'manual',
      reasoning,
      getApiKey,
      onEvent: compactEmit,
    });
    humanRenderer.close?.();
    return;
  }

  const { prompt, readFromStdin } = await readStdinIfNeeded(options.promptParts);
  const sessionModes = [
    options.continueLatest,
    options.resumeLatest,
    Boolean(options.sessionId),
    Boolean(options.forkSessionId),
  ].filter(Boolean);
  if (sessionModes.length > 1) {
    throw new Error('--continue, --resume, --session, and --fork are mutually exclusive');
  }

  const managedMcp = await connectManagedMcp();
  const context: RunContext = {
    workspaceRoot,
    provider,
    model,
    permissionMode,
    toolProfile,
    reasoning,
    processExitDiagnosticsDelayMs: 0,
    getApiKey,
    emit: emitAndTrack,
    toolProviders: managedMcp.toolProviders,
  };

  if (!prompt) {
    if (!options.jsonl && !readFromStdin) {
      try {
        await runInteractive(context, options);
      } finally {
        await managedMcp.close();
      }
      return;
    }
    await managedMcp.close();
    throw new Error('missing prompt');
  }

  let sessionId: string;
  try {
    sessionId = await runPrompt(prompt, context, options);
  } finally {
    await managedMcp.close();
  }
  await emitFinalProcessDiagnostics(workspaceRoot, sessionId, emit);
  humanRenderer.close?.();
  if (finishedStatus === 'error') {
    if (options.jsonl && finishedError) console.error(finishedError);
    await exitOneShot(1);
  }
  await exitOneShot(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
