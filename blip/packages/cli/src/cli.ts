#!/usr/bin/env node
import process from "node:process";
import { defaultToolProfile, compactSession, runBlipTask, SessionStore, type BlipRuntimeEvent } from "@blip/core";
import type { PermissionMode, ToolProfile } from "@blip/tools";
import "@mariozechner/pi-ai";

const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-5.3-codex";

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
  compact: boolean;
  help: boolean;
  reasoning?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
};

function helpText(): string {
  return `Blip CLI coding agent

Usage:
  blip [options] "task prompt"
  blip --jsonl "task prompt"
  blip --continue "next task"
  blip --compact [--session <id>]

Options:
  --jsonl                    Emit runtime events as JSONL on stdout
  --provider <provider>      Model provider (default: BLIP_PROVIDER or openai)
  --model <model>            Model id, or provider/model
  --reasoning <level>        off|minimal|low|medium|high|xhigh
  --workspace <path>         Workspace root (default: cwd)
  --permission <mode>        read-only|workspace-write|full-access
  --profile <profile>        local-trusted-write|read-only|no-shell-workspace-write
  --continue                 Continue latest session for this workspace
  --resume                   Resume latest session for this workspace
  --session <id>             Resume an exact session
  --fork <id>                Fork an existing session
  --list-sessions            List sessions for this workspace
  --compact                  Compact a session
  -h, --help                 Show help

Environment:
  BLIP_PROVIDER              Default provider
  BLIP_MODEL                 Default model id or provider/model
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    promptParts: [],
    jsonl: false,
    continueLatest: false,
    resumeLatest: false,
    listSessions: false,
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
    else if (arg === "--workspace") options.workspace = next();
    else if (arg === "--permission") options.permission = parsePermission(next());
    else if (arg === "--profile") options.profile = parseProfile(next());
    else if (arg === "--continue") options.continueLatest = true;
    else if (arg === "--resume") options.resumeLatest = true;
    else if (arg === "--session") options.sessionId = next();
    else if (arg === "--fork") options.forkSessionId = next();
    else if (arg === "--list-sessions") options.listSessions = true;
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
  if (value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  throw new Error("invalid reasoning level");
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

function resolveProviderModel(options: CliOptions): { provider: string; model: string } {
  let provider = options.provider || process.env.BLIP_PROVIDER || DEFAULT_PROVIDER;
  let model = options.model || process.env.BLIP_MODEL || DEFAULT_MODEL;
  if (model.includes("/")) {
    const [modelProvider, ...rest] = model.split("/");
    provider = modelProvider;
    model = rest.join("/");
  }
  return { provider, model };
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
    console.error(`Blip finished: ${event.status}${event.changedFiles.length ? `; changed ${event.changedFiles.join(", ")}` : ""}`);
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const workspaceRoot = options.workspace || process.cwd();
  if (options.listSessions) {
    await listSessions(workspaceRoot);
    return;
  }

  const { provider, model } = resolveProviderModel(options);
  const permissionMode = options.permission ?? "workspace-write";
  const toolProfile = options.profile ?? defaultToolProfile(permissionMode, true);
  if (permissionMode === "read-only" && toolProfile !== "read-only") {
    throw new Error("read-only permission requires read-only tool profile");
  }

  const emit = (event: BlipRuntimeEvent) => {
    if (options.jsonl) console.log(JSON.stringify(event));
    else renderHuman(event);
  };

  if (options.compact) {
    await compactSession({ workspaceRoot, sessionId: options.sessionId, trigger: "manual", onEvent: emit });
    return;
  }

  const prompt = await readStdinIfNeeded(options.promptParts);
  if (!prompt) throw new Error("missing prompt");

  const sessionModes = [options.continueLatest, options.resumeLatest, Boolean(options.sessionId), Boolean(options.forkSessionId)].filter(Boolean);
  if (sessionModes.length > 1) {
    throw new Error("--continue, --resume, --session, and --fork are mutually exclusive");
  }

  await runBlipTask(
    {
      prompt,
      workspaceRoot,
      provider,
      model,
      permissionMode,
      toolProfile,
      sessionId: options.sessionId,
      continueLatest: options.continueLatest,
      resumeLatest: options.resumeLatest,
      forkSessionId: options.forkSessionId,
      jsonl: options.jsonl,
      reasoning: options.reasoning,
    },
    emit,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
