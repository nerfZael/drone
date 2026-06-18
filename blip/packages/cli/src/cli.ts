#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { defaultToolProfile, compactSession, runBlipTask, SessionStore, type BlipRuntimeEvent } from "@blip/core";
import type { PermissionMode, ToolProfile } from "@blip/tools";
import { getModels } from "@mariozechner/pi-ai";
import { getOAuthApiKey, refreshOpenAICodexToken, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";

const DEFAULT_PROVIDER = "openai-codex";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING: NonNullable<CliOptions["reasoning"]> = "high";
const DEFAULT_CLONES_ENABLED = true;
const OPENAI_CODEX_PROVIDER = "openai-codex";
const BLIP_CONFIG_FILE_ENV = "BLIP_CONFIG_FILE";
const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

type CliConfig = {
  provider?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  clonesEnabled?: boolean;
};

type ReasoningLevel = (typeof REASONING_LEVELS)[number];

type CliOptions = {
  promptParts: string[];
  jsonl: boolean;
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
  reasoning?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  clonesEnabled?: boolean;
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
  --provider <provider>      Model provider (default: BLIP_PROVIDER, saved config, or openai-codex)
  --model <model>            Model id, or provider/model (default: BLIP_MODEL, saved config, or gpt-5.5)
  --reasoning <level>        off|minimal|low|medium|high|xhigh (default: BLIP_REASONING, saved config, or high)
  --clones                   Enable clone tool support
  --no-clones                Disable clone tool support
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
  Commands: /model [id|provider/id], /clones on|off, /exit, /quit

Environment:
  BLIP_PROVIDER              Default provider
  BLIP_MODEL                 Default model id or provider/model
  BLIP_CONFIG_FILE           Override Blip CLI config file path
  BLIP_REASONING             Default reasoning level
  BLIP_CLONES                Default clone support: on|off
  BLIP_CODEX_AUTH_FILE       Override Codex auth file path
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    promptParts: [],
    jsonl: false,
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
    if (arg === "--jsonl") options.jsonl = true;
    else if (arg === "--provider") options.provider = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--reasoning") options.reasoning = parseReasoning(next());
    else if (arg === "--clones") options.clonesEnabled = true;
    else if (arg === "--no-clones") options.clonesEnabled = false;
    else if (arg === "--workspace") options.workspace = next();
    else if (arg === "--permission") options.permission = parsePermission(next());
    else if (arg === "--profile") options.profile = parseProfile(next());
    else if (arg === "--continue") options.continueLatest = true;
    else if (arg === "--resume") options.resumeLatest = true;
    else if (arg === "--session") options.sessionId = next();
    else if (arg === "--fork") options.forkSessionId = next();
    else if (arg === "--list-sessions") options.listSessions = true;
    else if (arg === "--list-models") options.listModels = true;
    else if (arg === "--compact") options.compact = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--") options.promptParts.push(...argv.slice(index + 1));
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.promptParts.push(arg);
  }

  return options;
}

function parsePermission(value: string): PermissionMode {
  if (value === "read-only" || value === "workspace-write" || value === "full-access") return value;
  throw new Error("invalid permission mode");
}

function parseProfile(value: string): ToolProfile {
  if (value === "local-trusted-write" || value === "read-only" || value === "no-shell-workspace-write") return value;
  throw new Error("invalid tool profile");
}

function parseReasoning(value: string): NonNullable<CliOptions["reasoning"]> {
  if (REASONING_LEVELS.includes(value as ReasoningLevel)) return value as ReasoningLevel;
  throw new Error("invalid reasoning level");
}

function parseBooleanSetting(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "enabled") return true;
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no" || normalized === "disabled") return false;
  throw new Error("invalid boolean setting");
}

async function readStdinIfNeeded(promptParts: string[]): Promise<string> {
  const prompt = promptParts.join(" ").trim();
  if (prompt) return prompt;
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("").trim();
}

function blipConfigFilePath(): string {
  const explicit = String(process.env[BLIP_CONFIG_FILE_ENV] ?? "").trim();
  if (explicit) return path.resolve(explicit);
  const configHome = String(process.env.XDG_CONFIG_HOME ?? "").trim() || path.join(os.homedir(), ".config");
  return path.join(configHome, "blip", "config.json");
}

function readCliConfig(): CliConfig {
  const raw = readJsonFile(blipConfigFilePath());
  if (!raw || typeof raw !== "object") return {};
  const reasoning = typeof raw.reasoning === "string" && REASONING_LEVELS.includes(raw.reasoning as ReasoningLevel)
    ? (raw.reasoning as ReasoningLevel)
    : undefined;
  return {
    ...(typeof raw.provider === "string" && raw.provider.trim() ? { provider: raw.provider.trim() } : {}),
    ...(typeof raw.model === "string" && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(typeof raw.clonesEnabled === "boolean" ? { clonesEnabled: raw.clonesEnabled } : {}),
  };
}

function saveDefaultModelSetup(provider: string, model: string, reasoning: ReasoningLevel): void {
  const current = readCliConfig();
  writeJsonFile(blipConfigFilePath(), { ...current, provider, model, reasoning });
}

function saveClonesEnabled(clonesEnabled: boolean): void {
  const current = readCliConfig();
  writeJsonFile(blipConfigFilePath(), { ...current, clonesEnabled });
}

function splitProviderModel(rawModel: string, fallbackProvider: string): { provider: string; model: string } {
  let provider = fallbackProvider;
  let model = rawModel;
  if (model.includes("/")) {
    const [modelProvider, ...rest] = model.split("/");
    provider = modelProvider;
    model = rest.join("/");
  }
  return { provider, model };
}

function resolveProviderModel(options: CliOptions): { provider: string; model: string } {
  const config = readCliConfig();
  const provider = options.provider || process.env.BLIP_PROVIDER || config.provider || DEFAULT_PROVIDER;
  const model = options.model || process.env.BLIP_MODEL || config.model || DEFAULT_MODEL;
  return splitProviderModel(model, provider);
}

function resolveReasoning(options: CliOptions): NonNullable<CliOptions["reasoning"]> {
  const config = readCliConfig();
  return options.reasoning ?? parseReasoning(process.env.BLIP_REASONING || config.reasoning || DEFAULT_REASONING);
}

function resolveClonesEnabled(options: CliOptions): boolean {
  const config = readCliConfig();
  const env = String(process.env.BLIP_CLONES ?? "").trim();
  return options.clonesEnabled ?? (env ? parseBooleanSetting(env) : config.clonesEnabled ?? DEFAULT_CLONES_ENABLED);
}

function jwtExpiresAtMs(token: string): number | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    const exp = typeof json.exp === "number" ? json.exp : NaN;
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function parseExpiresAtMs(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }
  if (typeof raw !== "string") return undefined;
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
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // A refreshed token can still be used for this run even if persisting it fails.
  }
}

function codexAuthFileCandidates(): string[] {
  const explicit = String(process.env.BLIP_CODEX_AUTH_FILE ?? "").trim();
  const candidates = [
    explicit,
    path.join(os.homedir(), ".codex", "auth.json"),
    path.resolve(process.cwd(), "auth.json"),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

async function resolvePiAiCodexAuth(filePath: string, raw: any): Promise<string | undefined> {
  const entry = raw?.[OPENAI_CODEX_PROVIDER];
  if (!entry || typeof entry !== "object") return undefined;
  const result = await getOAuthApiKey(OPENAI_CODEX_PROVIDER, { [OPENAI_CODEX_PROVIDER]: entry as OAuthCredentials });
  if (!result?.apiKey) return undefined;
  if (result.newCredentials !== entry) {
    raw[OPENAI_CODEX_PROVIDER] = { ...entry, ...result.newCredentials };
    writeJsonFile(filePath, raw);
  }
  return result.apiKey;
}

async function resolveCodexCliAuth(filePath: string, raw: any): Promise<string | undefined> {
  const tokens = raw?.tokens;
  if (!tokens || typeof tokens !== "object") return undefined;
  let access = String(tokens.access_token ?? tokens.access ?? "").trim();
  const refresh = String(tokens.refresh_token ?? tokens.refresh ?? "").trim();
  const expires =
    parseExpiresAtMs(tokens.expires_at ?? tokens.expiresAt ?? tokens.expires) ?? jwtExpiresAtMs(access);
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
        if (!raw || typeof raw !== "object") continue;
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

function renderHuman(event: BlipRuntimeEvent): void {
  if (event.type === "session_started") {
    console.error(`Blip session ${event.sessionId} ${event.resumed ? "resumed" : "started"} (${event.model}, ${event.toolProfile})`);
  } else if (event.type === "assistant_delta") {
    process.stdout.write(event.text);
  } else if (event.type === "tool_call_started") {
    console.error(`\n[tool] ${event.tool}`);
  } else if (event.type === "tool_call_failed") {
    console.error(`[tool failed] ${event.tool}: ${event.error}`);
  } else if (event.type === "session_error") {
    console.error(`[error] ${event.error}`);
  } else if (event.type === "session_finished") {
    process.stdout.write("\n");
    const detail = event.status === "error" && event.error ? `: ${event.error}` : "";
    console.error(`Blip finished: ${event.status}${detail}${event.changedFiles.length ? `; changed ${event.changedFiles.join(", ")}` : ""}`);
  } else if (event.type === "compaction_completed") {
    console.error(`Compacted session: ${event.summaryId}`);
  } else if (event.type === "compaction_skipped") {
    console.error(`Compaction skipped: ${event.reason}`);
  }
}

async function listSessions(workspaceRoot: string): Promise<void> {
  const store = new SessionStore(workspaceRoot);
  const sessions = await store.list();
  if (sessions.length === 0) {
    console.log("No Blip sessions found.");
    return;
  }
  for (const session of sessions) {
    console.log(`${session.id}\t${session.updatedAt}\t${session.modelProvider}/${session.modelId}\t${session.toolProfile}`);
  }
}

function listModels(provider: string, currentModel: string): void {
  const models = getModels(provider as any).map((model) => ({
    id: model.id,
    label: model.name || model.id,
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
  clonesEnabled: boolean;
  getApiKey: (provider: string) => Promise<string | undefined>;
  emit: (event: BlipRuntimeEvent) => void;
};

function formatModelLabel(provider: string, model: string): string {
  return provider === DEFAULT_PROVIDER ? model : `${provider}/${model}`;
}

async function runPrompt(prompt: string, context: RunContext, options: CliOptions): Promise<string> {
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
      clonesEnabled: context.clonesEnabled,
      getApiKey: context.getApiKey,
    },
    context.emit,
  );
  return session.id;
}

async function runInteractive(context: RunContext, options: CliOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let sessionId = options.sessionId;
  let continueLatest = options.continueLatest;
  let resumeLatest = options.resumeLatest;
  let forkSessionId = options.forkSessionId;

  console.error(
    `Blip interactive (${context.provider}/${context.model}, reasoning ${context.reasoning}, clones ${
      context.clonesEnabled ? "on" : "off"
    }). Type /exit to quit.`,
  );
  try {
    while (true) {
      let raw: string;
      try {
        raw = await rl.question("blip> ");
      } catch {
        break;
      }
      const prompt = raw.trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;
      if (prompt === "/model" || prompt.startsWith("/model ")) {
        await chooseInteractiveModel(prompt.slice("/model".length).trim(), context, rl);
        continue;
      }
      if (prompt === "/clones" || prompt.startsWith("/clones ")) {
        chooseInteractiveClones(prompt.slice("/clones".length).trim(), context);
        continue;
      }

      try {
        sessionId = await runPrompt(prompt, context, {
          ...options,
          sessionId,
          continueLatest,
          resumeLatest,
          forkSessionId,
        });
        continueLatest = false;
        resumeLatest = false;
        forkSessionId = undefined;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    rl.close();
  }
}

async function chooseInteractiveModel(
  rawSelection: string,
  context: RunContext,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  let selection = rawSelection.trim();
  const models = getModels(context.provider as any);
  if (!selection) {
    if (models.length === 0) {
      console.error(`No known models for ${context.provider}. Use /model provider/model to set one directly.`);
      return;
    }
    console.error(`Current model: ${formatModelLabel(context.provider, context.model)}`);
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const active = model.id === context.model ? " (current)" : "";
      console.error(`${index + 1}. ${model.id} - ${model.name || model.id}${active}`);
    }
    try {
      selection = (await rl.question("model> ")).trim();
    } catch {
      return;
    }
    if (!selection) return;
  }

  let next: { provider: string; model: string };
  if (/^\d+$/.test(selection) && models.length > 0) {
    const index = Number(selection) - 1;
    if (index < 0 || index >= models.length) {
      console.error(`Unknown model number: ${selection}`);
      return;
    }
    next = { provider: context.provider, model: models[index].id };
  } else {
    next = splitProviderModel(selection, context.provider);
  }

  const knownModels = getModels(next.provider as any);
  if (knownModels.length > 0 && !knownModels.some((model) => model.id === next.model)) {
    console.error(`Unknown model for ${next.provider}: ${next.model}`);
    return;
  }

  context.provider = next.provider;
  context.model = next.model;
  await chooseInteractiveReasoningForModel(context, rl);
  saveDefaultModelSetup(next.provider, next.model, context.reasoning);
  console.error(`Default model set to ${formatModelLabel(next.provider, next.model)} with ${context.reasoning} reasoning`);
}

function chooseInteractiveClones(rawSelection: string, context: RunContext): void {
  const selection = rawSelection.trim();
  if (!selection) {
    console.error(`Blip clones are ${context.clonesEnabled ? "on" : "off"}. Use /clones on or /clones off.`);
    return;
  }
  let clonesEnabled: boolean;
  try {
    clonesEnabled = parseBooleanSetting(selection);
  } catch {
    console.error(`Unknown clones setting: ${selection}`);
    return;
  }
  context.clonesEnabled = clonesEnabled;
  saveClonesEnabled(clonesEnabled);
  console.error(`Blip clones ${clonesEnabled ? "enabled" : "disabled"}`);
}

async function chooseInteractiveReasoningForModel(
  context: RunContext,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  console.error(`Reasoning levels: ${REASONING_LEVELS.join(", ")}`);
  while (true) {
    let selection = "";
    try {
      selection = (await rl.question(`reasoning [${context.reasoning}]> `)).trim();
    } catch {
      return;
    }
    if (!selection) return;

    try {
      context.reasoning = parseReasoning(selection);
      return;
    } catch {
      console.error(`Unknown reasoning level: ${selection}`);
    }
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
  const clonesEnabled = resolveClonesEnabled(options);
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
  const permissionMode = options.permission ?? "workspace-write";
  const toolProfile = options.profile ?? defaultToolProfile(permissionMode, true);
  if (permissionMode === "read-only" && toolProfile !== "read-only") {
    throw new Error("read-only permission requires read-only tool profile");
  }

  const emit = (event: BlipRuntimeEvent) => {
    if (options.jsonl) console.log(JSON.stringify(event));
    else renderHuman(event);
  };
  let finishedStatus: "completed" | "cancelled" | "error" | undefined;
  let finishedError = "";
  const emitAndTrack = (event: BlipRuntimeEvent) => {
    if (event.type === "session_finished") {
      finishedStatus = event.status;
      finishedError = event.error ?? "";
    }
    emit(event);
  };

  if (options.compact) {
    await compactSession({ workspaceRoot, sessionId: options.sessionId, trigger: "manual", reasoning, getApiKey, onEvent: emit });
    return;
  }

  const prompt = await readStdinIfNeeded(options.promptParts);
  const sessionModes = [options.continueLatest, options.resumeLatest, Boolean(options.sessionId), Boolean(options.forkSessionId)].filter(Boolean);
  if (sessionModes.length > 1) {
    throw new Error("--continue, --resume, --session, and --fork are mutually exclusive");
  }

  const context: RunContext = {
    workspaceRoot,
    provider,
    model,
    permissionMode,
    toolProfile,
    reasoning,
    clonesEnabled,
    getApiKey,
    emit: emitAndTrack,
  };

  if (!prompt) {
    if (process.stdin.isTTY && !options.jsonl) {
      await runInteractive(context, options);
      return;
    }
    throw new Error("missing prompt");
  }

  await runPrompt(prompt, context, options);
  if (finishedStatus === "error") {
    if (options.jsonl && finishedError) console.error(finishedError);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
