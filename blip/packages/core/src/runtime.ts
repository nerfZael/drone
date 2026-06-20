import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { getModel, getModels, Type, type Model } from "@mariozechner/pi-ai";
import { createProfileTools, type FileOperationKind, type PermissionMode, type ToolProfile } from "@blip/tools";
import { createCompaction, DEFAULT_COMPACTION_SETTINGS, estimateModelContextTokens, shouldAutoCompact, type CompactionSettings } from "./compaction.js";
import { assembleSystemPrompt } from "./prompts.js";
import { SessionStore } from "./session-store.js";
import type { BlipContextUsage, BlipRuntimeEvent, BlipSessionState, BlipSessionTiming, RunBlipOptions, TranscriptEntry } from "./types.js";

type RuntimeSink = (event: BlipRuntimeEvent) => Promise<void> | void;

export const BLIP_MAX_AGENTS = 8;

type AgentContextMode = "clone" | "summary" | "none";
type AgentAuthority = "read_only" | "workspace_write" | "scratch";
type AgentOutputMode = "findings" | "review" | "patch_plan" | "answer";
type AgentAction = "run" | "collect" | "cancel";

type AgentRunResult = {
  index: number;
  agentId: string;
  task: string;
  context: AgentContextMode;
  authority: AgentAuthority;
  output: AgentOutputMode;
  sessionId: string;
  status: "completed" | "error" | "cancelled";
  message: string;
  error?: string;
  readFiles: string[];
  changedFiles: string[];
  coverage?: AgentCoverageSummary;
  timing?: BlipSessionTiming;
  scratch?: {
    changedFiles: string[];
    diff?: string;
    diffTruncated?: boolean;
  };
  toolFailures?: ToolFailure[];
};

type AgentRunItem = {
  agentId: string;
  task: string;
  context: AgentContextMode;
  authority: AgentAuthority;
  output: AgentOutputMode;
  status: "running" | "completed" | "error" | "cancelled";
  startedAt: string;
  coverage: AgentCoverageState;
  sessionId?: string;
  agent?: Agent;
  promise: Promise<AgentRunResult>;
  result?: AgentRunResult;
};

type AgentBatchRun = {
  runId: string;
  startedAt: string;
  agents: AgentRunItem[];
  deliveredAt?: string;
};

type ToolFailure = {
  callId: string;
  tool: string;
  error: string;
};

type ToolCallTiming = {
  callId: string;
  tool: string;
  startedAtMs: number;
  endedAtMs?: number;
  failed?: boolean;
};

type TurnTiming = {
  toolCallCount: number;
};

type AgentCoverageSummary = {
  tools: Record<string, number>;
  readFiles: string[];
  changedFiles: string[];
  searchQueries: string[];
  listedPaths: string[];
  bashCommands: string[];
  lastActivityAt?: string;
};

type AgentCoverageState = {
  tools: Map<string, number>;
  readFiles: Set<string>;
  changedFiles: Set<string>;
  searchQueries: Set<string>;
  listedPaths: Set<string>;
  bashCommands: Set<string>;
  lastActivityAt?: string;
  lastEmittedSignalCount: number;
};

type AgentCoverageObservation =
  | { kind: "tool_start"; tool: string; args: unknown }
  | { kind: "file_operation"; operation: FileOperationKind; filePath: string };

type AgentDeliveredResults = {
  runId: string;
  status: "completed" | "error" | "cancelled";
  agentCount: number;
  message: string;
  details: unknown;
};

type AgentContextUpdate = {
  digest?: string;
  deliveredResults: AgentDeliveredResults[];
};

type AgentContextUpdateProvider = () => AgentContextUpdate | undefined;

async function estimateContextUsage(input: { store: SessionStore; session: BlipSessionState; contextWindow?: number }): Promise<BlipContextUsage | undefined> {
  const contextWindow = input.contextWindow && Number.isFinite(input.contextWindow) ? Math.max(0, Math.floor(input.contextWindow)) : 0;
  if (contextWindow <= 0) return undefined;
  const tokens = Math.max(0, estimateModelContextTokens(await input.store.readTranscript(input.session)));
  return {
    tokens,
    contextWindow,
    percent: Math.max(0, (tokens / contextWindow) * 100),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(sessionId: string, turnId?: string): Pick<BlipRuntimeEvent, "version" | "sessionId" | "timestamp"> & { turnId?: string } {
  return {
    version: 1,
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

function messageText(message: AgentMessage): string {
  if (message.role === "user") {
    return typeof message.content === "string" ? message.content : message.content.map((item) => (item.type === "text" ? item.text : `[${item.type}]`)).join("\n");
  }
  if (message.role === "assistant") {
    return message.content
      .map((item) => (item.type === "text" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (message.role === "toolResult") {
    return message.content.map((item) => (item.type === "text" ? item.text : `[${item.type}]`)).join("\n");
  }
  return "";
}

function assistantFailureMessage(message: AgentMessage): string | undefined {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") return undefined;
  const stopReason = String((message as { stopReason?: unknown }).stopReason ?? "").trim();
  if (stopReason !== "error" && stopReason !== "aborted") return undefined;
  const errorMessage = String((message as { errorMessage?: unknown }).errorMessage ?? "").trim();
  if (errorMessage) return errorMessage;
  return stopReason === "aborted" ? "Assistant run was aborted" : "Assistant run failed without an error message";
}

function bashFailureMessage(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const result = details as { exitCode?: unknown; timedOut?: unknown };
  if (result.exitCode === 0 && result.timedOut !== true) return undefined;
  const exitCode = result.exitCode === null || typeof result.exitCode === "number" ? result.exitCode : undefined;
  if (exitCode === undefined && result.timedOut !== true) return undefined;
  if (result.timedOut === true) return `bash timed out${exitCode === undefined || exitCode === null ? "" : ` with exit code ${exitCode}`}`;
  if (exitCode === null) return "bash exited without an exit code";
  return `bash exited with code ${exitCode}`;
}

function toolResultFailureMessage(toolName: string, details: unknown, fallbackMessage: string): string | undefined {
  if (toolName === "bash") {
    const bashFailure = bashFailureMessage(details);
    if (bashFailure) return `${bashFailure}${fallbackMessage ? `\n\n${fallbackMessage}` : ""}`;
  }
  return undefined;
}

function summarizeProcessItems(items: unknown[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const type = item && typeof item === "object" && (item as { constructor?: { name?: string } }).constructor?.name ? String((item as { constructor: { name: string } }).constructor.name) : typeof item;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, count }));
}

export function collectProcessDiagnostics(): Pick<Extract<BlipRuntimeEvent, { type: "process_diagnostics" }>, "activeHandles" | "activeRequests"> {
  const processWithDiagnostics = process as typeof process & {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  return {
    activeHandles: summarizeProcessItems(processWithDiagnostics._getActiveHandles?.() ?? []),
    activeRequests: summarizeProcessItems(processWithDiagnostics._getActiveRequests?.() ?? []),
  };
}

class RuntimeTimingTracker {
  private readonly startedAtMs: number;
  private readonly startedAtIso: string;
  private readonly calls = new Map<string, ToolCallTiming>();
  private readonly turns: TurnTiming[] = [];
  private readonly toolCallsByName = new Map<string, { count: number; completed: number; failed: number; sumMs: number }>();
  private toolCallCompletedCount = 0;
  private toolCallFailedCount = 0;
  private toolCallSumMs = 0;
  private longestToolCall: BlipSessionTiming["longestToolCall"];

  constructor(startedAtMs: number) {
    this.startedAtMs = startedAtMs;
    this.startedAtIso = new Date(startedAtMs).toISOString();
  }

  recordTurnStart(): void {
    this.turns.push({ toolCallCount: 0 });
  }

  recordToolStart(callId: string, tool: string, atMs = Date.now()): void {
    if (this.turns.length === 0) this.recordTurnStart();
    this.turns[this.turns.length - 1]!.toolCallCount += 1;
    this.calls.set(callId, { callId, tool, startedAtMs: atMs });
    const byName = this.toolCallsByName.get(tool) ?? { count: 0, completed: 0, failed: 0, sumMs: 0 };
    byName.count += 1;
    this.toolCallsByName.set(tool, byName);
  }

  recordToolEnd(callId: string, tool: string, failed: boolean, atMs = Date.now()): void {
    const call = this.calls.get(callId) ?? { callId, tool, startedAtMs: atMs };
    call.tool = tool;
    call.endedAtMs = atMs;
    call.failed = failed;
    this.calls.set(callId, call);

    const durationMs = Math.max(0, (call.endedAtMs ?? atMs) - call.startedAtMs);
    this.toolCallSumMs += durationMs;
    if (failed) this.toolCallFailedCount += 1;
    else this.toolCallCompletedCount += 1;
    if (!this.longestToolCall || durationMs > this.longestToolCall.durationMs) {
      this.longestToolCall = { callId, tool, durationMs };
    }

    const byName = this.toolCallsByName.get(tool) ?? { count: 0, completed: 0, failed: 0, sumMs: 0 };
    if (failed) byName.failed += 1;
    else byName.completed += 1;
    byName.sumMs += durationMs;
    this.toolCallsByName.set(tool, byName);
  }

  finish(finishedAtMs = Date.now()): BlipSessionTiming {
    const durationMs = Math.max(0, finishedAtMs - this.startedAtMs);
    const intervals = Array.from(this.calls.values())
      .map((call) => ({
        start: call.startedAtMs,
        end: call.endedAtMs ?? finishedAtMs,
      }))
      .filter((interval) => interval.end >= interval.start)
      .sort((a, b) => a.start - b.start);
    let toolCallWallMs = 0;
    let active: { start: number; end: number } | undefined;
    for (const interval of intervals) {
      if (!active) {
        active = { ...interval };
      } else if (interval.start <= active.end) {
        active.end = Math.max(active.end, interval.end);
      } else {
        toolCallWallMs += active.end - active.start;
        active = { ...interval };
      }
    }
    if (active) toolCallWallMs += active.end - active.start;

    const toolTurns = this.turns.filter((turn) => turn.toolCallCount > 0);
    const toolCallsByName: BlipSessionTiming["toolCallsByName"] = {};
    for (const [tool, stats] of Array.from(this.toolCallsByName.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      toolCallsByName[tool] = stats;
    }

    return {
      startedAt: this.startedAtIso,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs,
      turnCount: this.turns.length,
      toolTurnCount: toolTurns.length,
      singleToolTurnCount: toolTurns.filter((turn) => turn.toolCallCount === 1).length,
      parallelToolTurnCount: toolTurns.filter((turn) => turn.toolCallCount > 1).length,
      maxToolsInTurn: toolTurns.reduce((max, turn) => Math.max(max, turn.toolCallCount), 0),
      toolCallCount: this.calls.size,
      toolCallCompletedCount: this.toolCallCompletedCount,
      toolCallFailedCount: this.toolCallFailedCount,
      toolCallSumMs: this.toolCallSumMs,
      toolCallWallMs,
      nonToolWallMs: Math.max(0, durationMs - toolCallWallMs),
      ...(this.longestToolCall ? { longestToolCall: this.longestToolCall } : {}),
      toolCallsByName,
    };
  }
}

function collectGitUntrackedFiles(workspaceRoot: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", workspaceRoot, "ls-files", "--others", "--exclude-standard", "-z"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.on("error", () => resolve(new Set()));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(new Set());
        return;
      }
      const files = Buffer.concat(chunks)
        .toString("utf8")
        .split("\0")
        .map((file) => file.trim())
        .filter(Boolean);
      resolve(new Set(files));
    });
  });
}

async function addNewGitUntrackedFiles(changedFiles: Set<string>, workspaceRoot: string, initialUntrackedFiles: Set<string>): Promise<void> {
  const finalUntrackedFiles = await collectGitUntrackedFiles(workspaceRoot);
  for (const filePath of finalUntrackedFiles) {
    if (!initialUntrackedFiles.has(filePath)) changedFiles.add(filePath);
  }
}

function resolveModel(provider: string, modelId: string): Model<any> {
  const model = getModel(provider as any, modelId as any);
  if (model) return model as Model<any>;
  if (provider === "faux") {
    return {
      id: modelId,
      name: modelId,
      provider: "faux",
      api: "faux",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    } satisfies Model<any>;
  }
  const available = getModels(provider as any)
    .map((item) => item.id)
    .slice(0, 10);
  throw new Error(`unknown model ${provider}/${modelId}${available.length ? `; examples: ${available.join(", ")}` : ""}`);
}

export function defaultToolProfile(permissionMode: PermissionMode, shellAvailable = true): ToolProfile {
  if (permissionMode === "read-only") return "read-only";
  return shellAvailable ? "local-trusted-write" : "no-shell-workspace-write";
}

function normalizeAgentContext(value: unknown): AgentContextMode {
  if (value === "clone" || value === "summary" || value === "none") return value;
  return "clone";
}

function normalizeAgentAuthority(value: unknown): AgentAuthority {
  if (value === "read_only" || value === "workspace_write" || value === "scratch") return value;
  return "read_only";
}

function normalizeAgentOutput(value: unknown): AgentOutputMode {
  if (value === "findings" || value === "review" || value === "patch_plan" || value === "answer") return value;
  return "findings";
}

function normalizeAgentAction(value: unknown): AgentAction {
  if (value === "collect" || value === "cancel") return value;
  return "run";
}

function createAgentCoverageState(): AgentCoverageState {
  return {
    tools: new Map(),
    readFiles: new Set(),
    changedFiles: new Set(),
    searchQueries: new Set(),
    listedPaths: new Set(),
    bashCommands: new Set(),
    lastEmittedSignalCount: 0,
  };
}

function trimOneLine(value: unknown, maxLength = 160): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function agentCoverageSignalCount(coverage: AgentCoverageState): number {
  return coverage.readFiles.size + coverage.changedFiles.size + coverage.searchQueries.size + coverage.listedPaths.size + coverage.bashCommands.size;
}

function summarizeAgentCoverage(coverage: AgentCoverageState): AgentCoverageSummary {
  const tools: AgentCoverageSummary["tools"] = {};
  for (const [tool, count] of Array.from(coverage.tools.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    tools[tool] = count;
  }
  return {
    tools,
    readFiles: Array.from(coverage.readFiles).sort(),
    changedFiles: Array.from(coverage.changedFiles).sort(),
    searchQueries: Array.from(coverage.searchQueries).sort(),
    listedPaths: Array.from(coverage.listedPaths).sort(),
    bashCommands: Array.from(coverage.bashCommands).sort(),
    ...(coverage.lastActivityAt ? { lastActivityAt: coverage.lastActivityAt } : {}),
  };
}

function recordAgentCoverage(coverage: AgentCoverageState, observation: AgentCoverageObservation): boolean {
  coverage.lastActivityAt = nowIso();
  if (observation.kind === "file_operation") {
    if (observation.operation === "read") coverage.readFiles.add(observation.filePath);
    else coverage.changedFiles.add(observation.filePath);
  } else {
    coverage.tools.set(observation.tool, (coverage.tools.get(observation.tool) ?? 0) + 1);
    const args = observation.args && typeof observation.args === "object" ? (observation.args as Record<string, unknown>) : {};
    if (observation.tool === "search_files") {
      const mode = trimOneLine(args.mode || "content", 24);
      const query = trimOneLine(args.query, 96);
      const searchPath = trimOneLine(args.path || ".", 80);
      if (query) coverage.searchQueries.add(`${mode} ${JSON.stringify(query)} in ${searchPath}`);
    } else if (observation.tool === "list_files") {
      coverage.listedPaths.add(trimOneLine(args.path || ".", 120) || ".");
    } else if (observation.tool === "bash") {
      const command = trimOneLine(args.command, 140);
      if (command) coverage.bashCommands.add(command);
    }
  }

  const signalCount = agentCoverageSignalCount(coverage);
  if (signalCount <= coverage.lastEmittedSignalCount) return false;
  if (coverage.lastEmittedSignalCount === 0 || signalCount - coverage.lastEmittedSignalCount >= 3) {
    coverage.lastEmittedSignalCount = signalCount;
    return true;
  }
  return false;
}

function agentCoverageText(input: { index: number; task: string; status: AgentRunItem["status"]; coverage: AgentCoverageSummary }): string {
  const parts: string[] = [];
  if (input.coverage.readFiles.length) parts.push(`read ${input.coverage.readFiles.length} file${input.coverage.readFiles.length === 1 ? "" : "s"}`);
  if (input.coverage.searchQueries.length) parts.push(`searched ${input.coverage.searchQueries.length} quer${input.coverage.searchQueries.length === 1 ? "y" : "ies"}`);
  if (input.coverage.listedPaths.length) parts.push(`listed ${input.coverage.listedPaths.length} path${input.coverage.listedPaths.length === 1 ? "" : "s"}`);
  if (input.coverage.bashCommands.length) parts.push(`ran ${input.coverage.bashCommands.length} command${input.coverage.bashCommands.length === 1 ? "" : "s"}`);
  if (input.coverage.changedFiles.length) parts.push(`changed ${input.coverage.changedFiles.length} file${input.coverage.changedFiles.length === 1 ? "" : "s"}`);
  const activity = parts.length ? parts.join(", ") : "started";
  const files = input.coverage.readFiles.slice(0, 3);
  const fileText = files.length ? ` Files: ${files.join(", ")}.` : "";
  return `Agent ${input.index + 1} ${input.status}: ${activity}.${fileText} Task: ${trimOneLine(input.task, 120)}`;
}

function agentCoverageBlock(coverage?: AgentCoverageSummary): string {
  if (!coverage) return "";
  const parts: string[] = [];
  if (coverage.readFiles.length) parts.push(`read ${coverage.readFiles.length} file${coverage.readFiles.length === 1 ? "" : "s"}`);
  if (coverage.searchQueries.length) parts.push(`searched ${coverage.searchQueries.length} quer${coverage.searchQueries.length === 1 ? "y" : "ies"}`);
  if (coverage.listedPaths.length) parts.push(`listed ${coverage.listedPaths.length} path${coverage.listedPaths.length === 1 ? "" : "s"}`);
  if (coverage.bashCommands.length) parts.push(`ran ${coverage.bashCommands.length} command${coverage.bashCommands.length === 1 ? "" : "s"}`);
  if (coverage.changedFiles.length) parts.push(`changed ${coverage.changedFiles.length} file${coverage.changedFiles.length === 1 ? "" : "s"}`);
  const lines = [
    `Coverage: ${parts.length ? parts.join(", ") : "no tool activity recorded"}`,
    coverage.readFiles.length ? `Files read: ${coverage.readFiles.join(", ")}` : "",
    coverage.searchQueries.length ? `Searches: ${coverage.searchQueries.join("; ")}` : "",
    coverage.listedPaths.length ? `Listed paths: ${coverage.listedPaths.join(", ")}` : "",
    coverage.bashCommands.length ? `Commands: ${coverage.bashCommands.join("; ")}` : "",
  ].filter(Boolean);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function compactAgentResultMessage(result: AgentRunResult, maxLength = 2400): string {
  const body = (result.message.trim() || result.error || "(no final message)").trim();
  return body.length > maxLength ? `${body.slice(0, maxLength - 3)}...` : body;
}

function deliveredAgentResultsText(run: AgentBatchRun): string {
  const summary = agentRunSummary(run);
  const lines = [
    `Blip runtime delivered completed agent results for run ${run.runId}.`,
    `Status: ${summary.status}`,
    "These results were delivered automatically so the parent can continue without spending a tool turn on agent collect.",
    `Full details remain available with agent collect runId ${run.runId} while this session is active.`,
    "",
  ];
  for (const [index, agent] of run.agents.entries()) {
    const result = agent.result;
    lines.push(`Agent ${index + 1} (${agent.status})`);
    lines.push(`Task: ${agent.task}`);
    lines.push(`Agent ID: ${agent.agentId}`);
    if (agent.sessionId) lines.push(`Session: ${agent.sessionId}`);
    lines.push(agentCoverageBlock(summarizeAgentCoverage(agent.coverage)).trim() || "Coverage: no tool activity recorded");
    if (result) {
      lines.push("Result:");
      lines.push(compactAgentResultMessage(result));
    } else {
      lines.push("Result: not available");
    }
    if (index < run.agents.length - 1) lines.push("", "---", "");
  }
  return lines.join("\n");
}

function scoreAgentDigestFile(filePath: string, task: string): number {
  const lower = filePath.toLowerCase();
  const taskTokens = new Set(
    task
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
  const fileTokens = lower.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  let score = 0;
  for (const token of fileTokens) {
    if (taskTokens.has(token)) score += 2;
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|cs|cpp|c|h)$/.test(lower)) score += 1;
  if (/schema|type|model|config|route|controller|service|component|view|test|spec/.test(lower)) score += 1;
  if (taskTokens.has("backend") || taskTokens.has("api") || taskTokens.has("server") || taskTokens.has("request") || taskTokens.has("payload")) {
    if (/\/(api|server|backend|routes?|controllers?|services?)\//.test(`/${lower}`)) score += 3;
  }
  if (taskTokens.has("ui") || taskTokens.has("web") || taskTokens.has("frontend") || taskTokens.has("component") || taskTokens.has("view")) {
    if (/\/(web|ui|frontend|components?|pages?|views?)\//.test(`/${lower}`)) score += 3;
  }
  if (taskTokens.has("shared") || taskTokens.has("schema") || taskTokens.has("type") || taskTokens.has("types")) {
    if (/\/(shared|common|types?|schemas?)\//.test(`/${lower}`)) score += 3;
  }
  return score;
}

function agentDigestFiles(agent: AgentRunItem, limit = 4): string[] {
  const readFiles = Array.from(agent.coverage.readFiles);
  return readFiles
    .map((filePath, index) => ({ filePath, index, score: scoreAgentDigestFile(filePath, agent.task) }))
    .sort((a, b) => b.score - a.score || b.index - a.index || a.filePath.localeCompare(b.filePath))
    .slice(0, limit)
    .map((item) => item.filePath);
}

function agentDigestLine(agent: AgentRunItem, index: number): string {
  const files = agentDigestFiles(agent);
  const coverageParts = [
    agent.coverage.readFiles.size ? `read ${agent.coverage.readFiles.size}` : "",
    agent.coverage.searchQueries.size ? `searched ${agent.coverage.searchQueries.size}` : "",
    agent.coverage.listedPaths.size ? `listed ${agent.coverage.listedPaths.size}` : "",
    agent.coverage.bashCommands.size ? `ran ${agent.coverage.bashCommands.size}` : "",
  ].filter(Boolean);
  const coverage = coverageParts.length ? coverageParts.join(", ") : "no coverage yet";
  const fileText = files.length ? `; key files: ${files.join(", ")}` : "";
  return `- Agent ${index + 1} ${agent.status}: ${trimOneLine(agent.task, 72)} (${coverage}${fileText})`;
}

function normalizeAgentSpecs(raw: unknown): Array<{ task: string; context: AgentContextMode; authority: AgentAuthority; output: AgentOutputMode }> {
  const rawAgents = (raw as { agents?: unknown })?.agents;
  if (!Array.isArray(rawAgents)) throw new Error("agent action run requires an agents array");
  const agents = rawAgents
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        task: String(record.task ?? "").trim(),
        context: normalizeAgentContext(record.context),
        authority: normalizeAgentAuthority(record.authority),
        output: normalizeAgentOutput(record.output),
      };
    })
    .filter((item) => item.task);
  if (agents.length === 0) throw new Error("agent action run requires at least one non-empty task");
  if (agents.length > BLIP_MAX_AGENTS) throw new Error(`agent accepts at most ${BLIP_MAX_AGENTS} agents`);
  return agents;
}

function agentInstruction(input: { task: string; index: number; total: number; context: AgentContextMode; authority: AgentAuthority; output: AgentOutputMode }): string {
  const authorityLine =
    input.authority === "read_only"
      ? "You have read-only authority. Inspect and report; do not attempt to modify files."
      : input.authority === "scratch"
        ? "You are working in an isolated scratch workspace. You may edit there, but your changes will be returned as a patch candidate and will not directly modify the parent workspace."
        : "You have workspace-write authority. Keep any edits strictly scoped to your assigned task.";
  return `You are Blip agent ${input.index + 1} of ${input.total}.

Your assigned task:
${input.task}

Context mode: ${input.context}
Authority: ${input.authority}
Expected output: ${input.output}

${authorityLine}

Work only on this agent task. Do not start more agents. Return a concise final message with the requested ${input.output}.`;
}

function agentResultsText(results: AgentRunResult[]): string {
  return results
    .map((result) => {
      const header = `Agent ${result.index + 1} (${result.status})`;
      const meta = [`Task: ${result.task}`, `Session: ${result.sessionId}`, `Context: ${result.context}`, `Authority: ${result.authority}`, `Output: ${result.output}`, `Files read: ${result.readFiles.length ? result.readFiles.join(", ") : "none"}`, `Changed files: ${result.changedFiles.length ? result.changedFiles.join(", ") : "none"}`].join("\n");
      const scratch = result.scratch?.diff ? `\nScratch diff${result.scratch.diffTruncated ? " (truncated)" : ""}:\n${result.scratch.diff}` : "";
      const coverage = agentCoverageBlock(result.coverage);
      const body = result.message.trim() || result.error || "(no final message)";
      return `${header}\n${meta}\n${coverage}Result:\n${body}${scratch}`;
    })
    .join("\n\n---\n\n");
}

function activeAgentResultsText(run: AgentBatchRun): string {
  return run.agents
    .map((agent, index) => {
      if (agent.result) return agentResultsText([agent.result]);
      const coverage = agentCoverageBlock(summarizeAgentCoverage(agent.coverage));
      return `Agent ${index + 1} (${agent.status})\nTask: ${agent.task}\nAgent ID: ${agent.agentId}\nContext: ${agent.context}\nAuthority: ${agent.authority}\n${coverage}`.trim();
    })
    .join("\n\n---\n\n");
}

const SCRATCH_SKIP_DIRS = new Set([".git", ".blip", ".turbo", ".next", ".vite", "node_modules", "dist", "build", "coverage"]);
const SCRATCH_DIFF_LIMIT = 80_000;
const NON_BLOCKING_AGENT_START_DELAY_MS = 10;

function shouldCopyScratchPath(source: string): boolean {
  const parts = source.split(path.sep);
  return !parts.some((part) => SCRATCH_SKIP_DIRS.has(part));
}

async function copyWorkspaceForScratch(workspaceRoot: string): Promise<{ baseRoot: string; workRoot: string; cleanupRoot: string }> {
  const cleanupRoot = await mkdtemp(path.join(os.tmpdir(), "blip-agent-scratch-"));
  const baseRoot = path.join(cleanupRoot, "base");
  const workRoot = path.join(cleanupRoot, "work");
  await cp(workspaceRoot, baseRoot, {
    recursive: true,
    filter: (source) => shouldCopyScratchPath(path.relative(workspaceRoot, source)),
  });
  await cp(baseRoot, workRoot, { recursive: true });
  return { baseRoot, workRoot, cleanupRoot };
}

async function walkSnapshotFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        if (!SCRATCH_SKIP_DIRS.has(entry.name)) await walk(absolute);
      } else if (entry.isFile()) {
        try {
          const data = await readFile(absolute);
          files.set(relative, createHash("sha256").update(data).digest("hex"));
        } catch {
          // Ignore files that disappear while an agent is running.
        }
      }
    }
  }
  try {
    await walk(root);
  } catch {
    // A scratch result can still be useful without changed-file metadata.
  }
  return files;
}

async function scratchChangedFiles(baseRoot: string, workRoot: string): Promise<string[]> {
  const [before, after] = await Promise.all([walkSnapshotFiles(baseRoot), walkSnapshotFiles(workRoot)]);
  const changed = new Set<string>();
  for (const [file, hash] of after) {
    if (before.get(file) !== hash) changed.add(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.add(file);
  }
  return Array.from(changed).sort();
}

function runBufferedCommand(command: string, args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > SCRATCH_DIFF_LIMIT * 2) stdout = stdout.slice(0, SCRATCH_DIFF_LIMIT * 2);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > SCRATCH_DIFF_LIMIT) stderr = stderr.slice(0, SCRATCH_DIFF_LIMIT);
    });
    child.on("error", (error) => resolve({ exitCode: null, stdout, stderr: String(error) }));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function scratchDiff(baseRoot: string, workRoot: string): Promise<{ diff?: string; truncated?: boolean }> {
  const result = await runBufferedCommand("git", ["diff", "--no-index", "--", baseRoot, workRoot], path.dirname(baseRoot));
  const raw = result.stdout || result.stderr;
  if (!raw.trim()) return {};
  const truncated = raw.length > SCRATCH_DIFF_LIMIT;
  return { diff: raw.slice(0, SCRATCH_DIFF_LIMIT), truncated };
}

async function removeScratch(cleanupRoot: string): Promise<void> {
  await rm(cleanupRoot, { recursive: true, force: true });
}

async function resolveSession(store: SessionStore, options: RunBlipOptions): Promise<{ session: BlipSessionState; resumed: boolean }> {
  if (options.sessionId) {
    const session = await store.load(options.sessionId);
    session.modelProvider = options.provider;
    session.modelId = options.model;
    session.permissionMode = options.permissionMode;
    session.toolProfile = options.toolProfile;
    await store.save(session);
    return { session, resumed: true };
  }

  if (options.forkSessionId) {
    const source = await store.load(options.forkSessionId);
    const session = await store.fork(source, {
      provider: options.provider,
      model: options.model,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
    });
    return { session, resumed: false };
  }

  if (options.continueLatest || options.resumeLatest) {
    const latest = await store.latest();
    if (latest) {
      latest.modelProvider = options.provider;
      latest.modelId = options.model;
      latest.permissionMode = options.permissionMode;
      latest.toolProfile = options.toolProfile;
      await store.save(latest);
      return { session: latest, resumed: true };
    }
  }

  return {
    session: await store.create({
      provider: options.provider,
      model: options.model,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
    }),
    resumed: false,
  };
}

export async function compactSession(input: { workspaceRoot: string; sessionId?: string; trigger?: "manual" | "auto"; settings?: CompactionSettings; model?: Model<any>; reasoning?: RunBlipOptions["reasoning"]; getApiKey?: RunBlipOptions["getApiKey"]; onEvent?: RuntimeSink }): Promise<BlipSessionState> {
  const store = new SessionStore(input.workspaceRoot);
  const session = input.sessionId ? await store.load(input.sessionId) : await store.latest();
  if (!session) throw new Error("no session found to compact");
  const turnId = `t_${randomUUID().slice(0, 8)}`;
  const started: BlipRuntimeEvent = {
    ...eventBase(session.id, turnId),
    type: "compaction_started",
    reason: input.trigger ?? "manual",
  };
  await store.appendRuntimeEvent(session, started);
  await input.onEvent?.(started);
  const entries = await store.readTranscript(session);
  const model = input.model ?? resolveModel(session.modelProvider, session.modelId);
  const apiKey = await input.getApiKey?.(model.provider);
  const compaction = await createCompaction({
    session,
    entries,
    trigger: input.trigger ?? "manual",
    settings: input.settings,
    model,
    reasoning: input.reasoning,
    apiKey,
  });
  if (!compaction) {
    const skipped: BlipRuntimeEvent = {
      ...eventBase(session.id, turnId),
      type: "compaction_skipped",
      reason: "nothing to compact yet",
    };
    await store.appendRuntimeEvent(session, skipped);
    await input.onEvent?.(skipped);
    return session;
  }
  await store.appendEntry(session, compaction);
  session.compactedSummary = compaction.summary;
  await store.save(session);
  const completed: BlipRuntimeEvent = {
    ...eventBase(session.id, turnId),
    type: "compaction_completed",
    summaryId: compaction.id,
    tokensBefore: compaction.tokensBefore,
    tokensAfter: compaction.tokensAfterEstimate ?? 0,
  };
  await store.appendRuntimeEvent(session, completed);
  await input.onEvent?.(completed);
  return session;
}

function authorityProfile(authority: AgentAuthority, parent: { permissionMode: PermissionMode; toolProfile: ToolProfile }): { permissionMode: PermissionMode; toolProfile: ToolProfile } {
  if (authority === "read_only") return { permissionMode: "read-only", toolProfile: "read-only" };
  if (authority === "scratch") {
    return {
      permissionMode: "workspace-write",
      toolProfile: parent.toolProfile === "local-trusted-write" ? "local-trusted-write" : "no-shell-workspace-write",
    };
  }
  return parent;
}

function recentTranscriptSummary(entries: TranscriptEntry[], maxChars = 12_000): string {
  const lines: string[] = [];
  for (let index = entries.length - 1; index >= 0 && lines.join("\n").length < maxChars; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message") {
      const text = messageText(entry.message).trim();
      if (text) lines.unshift(`${entry.message.role}: ${text}`);
    } else if (entry.type === "compaction") {
      lines.unshift(`compaction summary: ${entry.summary}`);
      break;
    }
  }
  return lines.join("\n\n").slice(-maxChars);
}

async function createAgentSession(input: { store: SessionStore; sourceSession: BlipSessionState; context: AgentContextMode; provider: string; modelId: string; permissionMode: PermissionMode; toolProfile: ToolProfile; instruction: string }): Promise<BlipSessionState> {
  if (input.context === "clone") {
    const session = await input.store.fork(input.sourceSession, {
      provider: input.provider,
      model: input.modelId,
      permissionMode: input.permissionMode,
      toolProfile: input.toolProfile,
    });
    await input.store.appendMessage(session, { role: "user", content: input.instruction, timestamp: Date.now() });
    return session;
  }

  const transcriptSeed: TranscriptEntry[] = [];
  if (input.context === "summary") {
    const transcript = await input.store.readTranscript(input.sourceSession);
    const summary = input.sourceSession.compactedSummary || recentTranscriptSummary(transcript) || "No parent-session summary is available.";
    transcriptSeed.push({
      type: "message",
      id: randomUUID(),
      timestamp: nowIso(),
      message: {
        role: "user",
        content: `Summary of parent Blip session:\n${summary}\n\nKnown parent read files: ${input.sourceSession.readFiles.join(", ") || "none"}\nKnown parent changed files: ${input.sourceSession.changedFiles.join(", ") || "none"}`,
        timestamp: Date.now(),
      },
    });
  }
  transcriptSeed.push({
    type: "message",
    id: randomUUID(),
    timestamp: nowIso(),
    message: { role: "user", content: input.instruction, timestamp: Date.now() },
  });
  return input.store.create({
    provider: input.provider,
    model: input.modelId,
    permissionMode: input.permissionMode,
    toolProfile: input.toolProfile,
    parentSessionId: input.sourceSession.id,
    transcriptSeed,
  });
}

async function runAgentSession(input: { store: SessionStore; sourceSession: BlipSessionState; workspaceRoot: string; provider: string; modelId: string; model: Model<any>; permissionMode: PermissionMode; toolProfile: ToolProfile; reasoning?: RunBlipOptions["reasoning"]; getApiKey?: RunBlipOptions["getApiKey"]; task: string; context: AgentContextMode; authority: AgentAuthority; output: AgentOutputMode; index: number; total: number; agentId: string; onAgent?: (agent: Agent, session: BlipSessionState) => void; onCoverage?: (observation: AgentCoverageObservation) => void }): Promise<AgentRunResult> {
  const resolvedAuthority = authorityProfile(input.authority, {
    permissionMode: input.permissionMode,
    toolProfile: input.toolProfile,
  });
  const scratch = input.authority === "scratch" ? await copyWorkspaceForScratch(input.workspaceRoot) : undefined;
  const workspaceRoot = scratch?.workRoot ?? input.workspaceRoot;
  const instruction = agentInstruction({
    task: input.task,
    index: input.index,
    total: input.total,
    context: input.context,
    authority: input.authority,
    output: input.output,
  });
  const session = await createAgentSession({
    store: input.store,
    sourceSession: input.sourceSession,
    context: input.context,
    provider: input.provider,
    modelId: input.modelId,
    permissionMode: resolvedAuthority.permissionMode,
    toolProfile: resolvedAuthority.toolProfile,
    instruction,
  });
  const startedAt = Date.now();
  const timing = new RuntimeTimingTracker(startedAt);
  const turnId = `t_${randomUUID().slice(0, 8)}`;
  await input.store.appendRuntimeEvent(session, {
    ...eventBase(session.id, turnId),
    type: "session_started",
    workspaceRoot,
    model: `${input.provider}/${input.modelId}`,
    permissionMode: resolvedAuthority.permissionMode,
    toolProfile: resolvedAuthority.toolProfile,
    resumed: true,
  });

  const readFiles = new Set(session.readFiles);
  const changedFiles = new Set(session.changedFiles);
  const initialUntrackedFiles = await collectGitUntrackedFiles(workspaceRoot);
  const tools = createProfileTools({
    workspaceRoot,
    permissionMode: resolvedAuthority.permissionMode,
    profile: resolvedAuthority.toolProfile,
    onFileOperation(kind: FileOperationKind, filePath: string) {
      if (kind === "read") readFiles.add(filePath);
      else changedFiles.add(filePath);
      input.onCoverage?.({ kind: "file_operation", operation: kind, filePath });
    },
  });
  const messages = await input.store.readModelMessages(session);
  const systemPrompt = await assembleSystemPrompt({
    workspaceRoot,
    toolProfile: resolvedAuthority.toolProfile,
    agentsEnabled: false,
  });
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: input.model,
      thinkingLevel: input.reasoning ?? "medium",
      tools,
      messages,
    },
    sessionId: session.id,
    toolExecution: "parallel",
    getApiKey: input.getApiKey,
  });
  input.onAgent?.(agent, session);

  let failed = false;
  let failureMessage = "";
  let cancelled = false;
  const toolFailures: ToolFailure[] = [];
  let lastAssistantMessage = "";
  agent.subscribe(async (event: AgentEvent) => {
    if (event.type === "turn_start") {
      timing.recordTurnStart();
    } else if (event.type === "message_end") {
      await input.store.appendMessage(session, event.message);
      if (event.message.role === "assistant") {
        lastAssistantMessage = messageText(event.message);
        const assistantError = assistantFailureMessage(event.message);
        if (assistantError) {
          failed = true;
          failureMessage ||= assistantError;
          if (String(assistantError).toLowerCase().includes("abort")) cancelled = true;
        }
      }
    } else if (event.type === "tool_execution_start") {
      timing.recordToolStart(event.toolCallId, event.toolName);
      input.onCoverage?.({ kind: "tool_start", tool: event.toolName, args: event.args });
    } else if (event.type === "tool_execution_end") {
      const toolResultMessage = messageText({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content,
        details: event.result.details,
        isError: event.isError,
        timestamp: Date.now(),
      });
      const toolFailureMessage = event.isError ? toolResultMessage : toolResultFailureMessage(event.toolName, event.result.details, toolResultMessage);
      timing.recordToolEnd(event.toolCallId, event.toolName, Boolean(toolFailureMessage));
      if (toolFailureMessage) toolFailures.push({ callId: event.toolCallId, tool: event.toolName, error: toolFailureMessage });
    } else if (event.type === "agent_end") {
      for (const message of event.messages) {
        const assistantError = assistantFailureMessage(message);
        if (assistantError) {
          failed = true;
          failureMessage ||= assistantError;
          if (String(assistantError).toLowerCase().includes("abort")) cancelled = true;
        }
      }
    }
  });

  try {
    await agent.continue();
  } catch (error) {
    failed = true;
    failureMessage ||= error instanceof Error ? error.message : String(error);
    if (String(failureMessage).toLowerCase().includes("abort")) cancelled = true;
  } finally {
    await addNewGitUntrackedFiles(changedFiles, workspaceRoot, initialUntrackedFiles);
    session.readFiles = Array.from(readFiles).sort();
    session.changedFiles = Array.from(changedFiles).sort();
    await input.store.save(session);
    const finishedAt = Date.now();
    const contextUsage = await estimateContextUsage({ store: input.store, session, contextWindow: input.model.contextWindow });
    await input.store.appendRuntimeEvent(session, {
      ...eventBase(session.id, turnId),
      type: "session_finished",
      status: cancelled ? "cancelled" : failed ? "error" : "completed",
      changedFiles: session.changedFiles,
      durationMs: finishedAt - startedAt,
      timing: timing.finish(finishedAt),
      ...(contextUsage ? { contextUsage } : {}),
      ...(failureMessage ? { error: failureMessage } : {}),
      ...(toolFailures.length > 0 ? { toolFailures } : {}),
    });
  }

  let scratchResult: AgentRunResult["scratch"];
  if (scratch) {
    try {
      const [scratchFiles, diff] = await Promise.all([scratchChangedFiles(scratch.baseRoot, scratch.workRoot), scratchDiff(scratch.baseRoot, scratch.workRoot)]);
      scratchResult = {
        changedFiles: scratchFiles,
        ...(diff.diff ? { diff: diff.diff, diffTruncated: diff.truncated === true } : {}),
      };
    } finally {
      await removeScratch(scratch.cleanupRoot);
    }
  }
  const resultTiming = timing.finish();
  return {
    index: input.index,
    agentId: input.agentId,
    task: input.task,
    context: input.context,
    authority: input.authority,
    output: input.output,
    sessionId: session.id,
    status: cancelled ? "cancelled" : failed ? "error" : "completed",
    message: lastAssistantMessage || failureMessage,
    readFiles: session.readFiles,
    changedFiles: input.authority === "scratch" ? (scratchResult?.changedFiles ?? []) : session.changedFiles,
    timing: resultTiming,
    ...(scratchResult ? { scratch: scratchResult } : {}),
    ...(failureMessage ? { error: failureMessage } : {}),
    ...(toolFailures.length > 0 ? { toolFailures } : {}),
  };
}

function agentRunSummary(run: AgentBatchRun): {
  runId: string;
  status: "running" | "completed" | "cancelled" | "error";
  startedAt: string;
  agents: Array<{
    agentId: string;
    task: string;
    context: AgentContextMode;
    authority: AgentAuthority;
    output: AgentOutputMode;
    status: AgentRunItem["status"];
    sessionId?: string;
    coverage: AgentCoverageSummary;
    result?: AgentRunResult;
  }>;
} {
  const agents = run.agents.map((agent) => ({
    agentId: agent.agentId,
    task: agent.task,
    context: agent.context,
    authority: agent.authority,
    output: agent.output,
    status: agent.status,
    coverage: summarizeAgentCoverage(agent.coverage),
    ...(agent.sessionId ? { sessionId: agent.sessionId } : {}),
    ...(agent.result ? { result: agent.result } : {}),
  }));
  const allDone = agents.every((agent) => agent.status !== "running");
  const allCancelled = agents.length > 0 && agents.every((agent) => agent.status === "cancelled");
  const anyError = agents.some((agent) => agent.status === "error");
  return {
    runId: run.runId,
    status: allCancelled ? "cancelled" : anyError ? "error" : allDone ? "completed" : "running",
    startedAt: run.startedAt,
    agents,
  };
}

function createAgentTool(input: { store: SessionStore; session: BlipSessionState; workspaceRoot: string; provider: string; modelId: string; model: Model<any>; permissionMode: PermissionMode; toolProfile: ToolProfile; reasoning?: RunBlipOptions["reasoning"]; getApiKey?: RunBlipOptions["getApiKey"]; onWorkspaceWriteAgentFinished?: (result: AgentRunResult) => void; registerContextUpdateProvider?: (provider: AgentContextUpdateProvider) => void }): AgentTool<any, any> {
  const runs = new Map<string, AgentBatchRun>();

  async function settleRun(run: AgentBatchRun): Promise<void> {
    await Promise.allSettled(run.agents.map((agent) => agent.promise));
  }

  function startRun(params: any, opts?: { deferStart?: boolean; onUpdate?: AgentToolUpdateCallback<unknown> }): AgentBatchRun {
    const specs = normalizeAgentSpecs(params);
    const runId = `ar_${randomUUID().slice(0, 8)}`;
    const run: AgentBatchRun = {
      runId,
      startedAt: nowIso(),
      agents: [],
    };
    for (const [index, spec] of specs.entries()) {
      const agentId = `a_${randomUUID().slice(0, 8)}`;
      const item: AgentRunItem = {
        agentId,
        task: spec.task,
        context: spec.context,
        authority: spec.authority,
        output: spec.output,
        status: "running",
        startedAt: nowIso(),
        coverage: createAgentCoverageState(),
        promise: Promise.resolve(undefined as never),
      };
      const emitCoverageUpdate = () => {
        const coverage = summarizeAgentCoverage(item.coverage);
        opts?.onUpdate?.({
          content: [{ type: "text", text: agentCoverageText({ index, task: spec.task, status: item.status, coverage }) }],
          details: {
            runId,
            agentId,
            index,
            task: spec.task,
            status: item.status,
            coverage,
          },
        });
      };
      const started = new Promise<AgentRunResult>((resolve, reject) => {
        const launch = () => {
          if (item.status === "cancelled") {
            resolve({
              index,
              agentId,
              task: spec.task,
              context: spec.context,
              authority: spec.authority,
              output: spec.output,
              sessionId: "",
              status: "cancelled",
              message: "Agent run was cancelled before it started.",
              readFiles: [],
              changedFiles: [],
              coverage: summarizeAgentCoverage(item.coverage),
            });
            return;
          }
          runAgentSession({
            store: input.store,
            sourceSession: input.session,
            workspaceRoot: input.workspaceRoot,
            provider: input.provider,
            modelId: input.modelId,
            model: input.model,
            permissionMode: input.permissionMode,
            toolProfile: input.toolProfile,
            reasoning: input.reasoning,
            getApiKey: input.getApiKey,
            task: spec.task,
            context: spec.context,
            authority: spec.authority,
            output: spec.output,
            index,
            total: specs.length,
            agentId,
            onAgent(agent, session) {
              item.agent = agent;
              item.sessionId = session.id;
            },
            onCoverage(observation) {
              if (recordAgentCoverage(item.coverage, observation)) emitCoverageUpdate();
            },
          }).then(resolve, reject);
        };
        if (opts?.deferStart) setTimeout(launch, NON_BLOCKING_AGENT_START_DELAY_MS);
        else setImmediate(launch);
      });
      item.promise = started
        .then((result) => {
          const resultWithCoverage = { ...result, coverage: summarizeAgentCoverage(item.coverage) };
          item.result = resultWithCoverage;
          item.status = result.status;
          if (resultWithCoverage.authority === "workspace_write") input.onWorkspaceWriteAgentFinished?.(resultWithCoverage);
          return resultWithCoverage;
        })
        .catch((error) => {
          const wasCancelled = item.status === "cancelled";
          const result: AgentRunResult = {
            index,
            agentId,
            task: spec.task,
            context: spec.context,
            authority: spec.authority,
            output: spec.output,
            sessionId: item.sessionId ?? "",
            status: wasCancelled ? "cancelled" : "error",
            message: "",
            ...(wasCancelled ? {} : { error: error instanceof Error ? error.message : String(error) }),
            readFiles: [],
            changedFiles: [],
            coverage: summarizeAgentCoverage(item.coverage),
          };
          item.result = result;
          item.status = result.status;
          return result;
        });
      run.agents.push(item);
    }
    runs.set(runId, run);
    return run;
  }

  input.registerContextUpdateProvider?.(() => {
    const activeRuns = Array.from(runs.values());
    if (activeRuns.length === 0) return undefined;

    const deliveredResults: AgentDeliveredResults[] = [];
    for (const run of activeRuns) {
      const summary = agentRunSummary(run);
      if (summary.status === "running" || run.deliveredAt) continue;
      const message = deliveredAgentResultsText(run);
      run.deliveredAt = nowIso();
      deliveredResults.push({
        runId: run.runId,
        status: summary.status,
        agentCount: run.agents.length,
        message,
        details: summary,
      });
    }

    const lines = [
      "Blip runtime agent status:",
      "Use this to avoid duplicate discovery. If a relevant agent is completed, collect before continuing broad overlapping reads/searches.",
    ];
    for (const run of activeRuns.filter((run) => !run.deliveredAt || agentRunSummary(run).status === "running").slice(0, 3)) {
      const summary = agentRunSummary(run);
      const collectHint = summary.status === "completed" || summary.status === "error" || summary.status === "cancelled" ? "final results available" : "partial coverage available";
      lines.push(`Run ${run.runId}: ${summary.status}; ${collectHint} via agent collect.`);
      for (const [index, agent] of run.agents.slice(0, 4).entries()) {
        lines.push(agentDigestLine(agent, index));
      }
    }
    const digest = lines.length > 2 ? lines.join("\n") : undefined;
    if (!digest && deliveredResults.length === 0) return undefined;
    return { digest, deliveredResults };
  });

  return {
    name: "agent",
    label: "Agent",
    description: `Run up to ${BLIP_MAX_AGENTS} parallel agents with explicit context and authority. Supports run, collect, and cancel actions.`,
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("run"), Type.Literal("collect"), Type.Literal("cancel")], { description: "Action to perform. Defaults to run." })),
      wait: Type.Optional(Type.Boolean({ description: "For run/collect, wait until all agents finish. Defaults to true for run and false for collect." })),
      runId: Type.Optional(Type.String({ description: "Agent run id for collect/cancel." })),
      agents: Type.Optional(
        Type.Array(
          Type.Object({
            task: Type.String({ description: "Focused task for this agent." }),
            context: Type.Optional(Type.Union([Type.Literal("clone"), Type.Literal("summary"), Type.Literal("none")], { description: "Context mode. Defaults to clone." })),
            authority: Type.Optional(Type.Union([Type.Literal("read_only"), Type.Literal("workspace_write"), Type.Literal("scratch")], { description: "Agent authority. Defaults to read_only." })),
            output: Type.Optional(Type.Union([Type.Literal("findings"), Type.Literal("review"), Type.Literal("patch_plan"), Type.Literal("answer")], { description: "Expected output shape. Defaults to findings." })),
          }),
          { minItems: 1, maxItems: BLIP_MAX_AGENTS, description: "Agents to start for action run." },
        ),
      ),
    }),
    async execute(_toolCallId, params: any, _signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<unknown>) {
      const action = normalizeAgentAction(params?.action);
      if (action === "run") {
        const wait = params?.wait !== false;
        const run = startRun(params, { deferStart: !wait, onUpdate: wait ? onUpdate : undefined });
        if (wait) await settleRun(run);
        const summary = agentRunSummary(run);
        if (summary.status !== "running") runs.delete(run.runId);
        return {
          content: [{ type: "text", text: wait ? agentResultsText(run.agents.map((agent) => agent.result).filter(Boolean) as AgentRunResult[]) : `Started agent run ${run.runId}. Call agent action collect with this runId to inspect current coverage or get final results before repeating work in those lanes.` }],
          details: summary,
        };
      }
      let runId = String(params?.runId ?? "").trim();
      if (!runId) {
        const implicitRuns = Array.from(runs.entries()).filter(([, run]) => !run.deliveredAt || agentRunSummary(run).status === "running");
        if (implicitRuns.length === 1) runId = implicitRuns[0]![0];
      }
      if (!runId) throw new Error(`agent action ${action} requires runId when there is not exactly one active run`);
      const run = runs.get(runId);
      if (!run) throw new Error(`unknown agent run ${runId}`);
      if (action === "cancel") {
        for (const item of run.agents) {
          if (item.status === "running") {
            item.status = "cancelled";
            item.agent?.abort();
          }
        }
        await Promise.allSettled(run.agents.map((item) => item.promise));
        const summary = agentRunSummary(run);
        if (summary.status !== "running") runs.delete(runId);
        return {
          content: [{ type: "text", text: `Cancelled agent run ${runId}.\n\n${activeAgentResultsText(run)}` }],
          details: summary,
        };
      }
      const wait = params?.wait === true;
      if (wait) await settleRun(run);
      const summary = agentRunSummary(run);
      if (summary.status !== "running") runs.delete(runId);
      return {
        content: [{ type: "text", text: activeAgentResultsText(run) }],
        details: summary,
      };
    },
  } as AgentTool<any, any>;
}

export async function runBlipTask(options: RunBlipOptions, onEvent?: RuntimeSink): Promise<BlipSessionState> {
  const startedAt = Date.now();
  const timing = new RuntimeTimingTracker(startedAt);
  const store = new SessionStore(options.workspaceRoot);
  const { session, resumed } = await resolveSession(store, options);
  const model = resolveModel(options.provider, options.model);
  const turnId = `t_${randomUUID().slice(0, 8)}`;

  const transcript = await store.readTranscript(session);
  if (
    shouldAutoCompact({
      entries: transcript,
      contextWindow: model.contextWindow,
      settings: DEFAULT_COMPACTION_SETTINGS,
    })
  ) {
    const compacted = await compactSession({
      workspaceRoot: options.workspaceRoot,
      sessionId: session.id,
      trigger: "auto",
      settings: DEFAULT_COMPACTION_SETTINGS,
      model,
      reasoning: options.reasoning,
      getApiKey: options.getApiKey,
      onEvent,
    });
    Object.assign(session, compacted);
  }

  const readFiles = new Set(session.readFiles);
  const changedFiles = new Set(session.changedFiles);
  const initialUntrackedFiles = await collectGitUntrackedFiles(options.workspaceRoot);
  let agentContextUpdateProvider: AgentContextUpdateProvider | undefined;
  const tools = createProfileTools({
    workspaceRoot: options.workspaceRoot,
    permissionMode: options.permissionMode,
    profile: options.toolProfile,
    onFileOperation(kind: FileOperationKind, filePath: string) {
      if (kind === "read") readFiles.add(filePath);
      else changedFiles.add(filePath);
    },
  });
  if (options.agentsEnabled) {
    tools.push(
      createAgentTool({
        store,
        session,
        workspaceRoot: options.workspaceRoot,
        provider: options.provider,
        modelId: options.model,
        model,
        permissionMode: options.permissionMode,
        toolProfile: options.toolProfile,
        reasoning: options.reasoning,
        getApiKey: options.getApiKey,
        onWorkspaceWriteAgentFinished(result) {
          for (const filePath of result.readFiles) readFiles.add(filePath);
          for (const filePath of result.changedFiles) changedFiles.add(filePath);
        },
        registerContextUpdateProvider(provider) {
          agentContextUpdateProvider = provider;
        },
      }),
    );
  }

  const messages = await store.readModelMessages(session);
  const systemPrompt = await assembleSystemPrompt({
    workspaceRoot: options.workspaceRoot,
    toolProfile: options.toolProfile,
    agentsEnabled: options.agentsEnabled === true,
    maxAgents: BLIP_MAX_AGENTS,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: options.reasoning ?? "medium",
      tools,
      messages,
    },
    sessionId: session.id,
    toolExecution: "parallel",
    getApiKey: options.getApiKey,
    transformContext: async (messages) => {
      const update = agentContextUpdateProvider?.();
      if (!update) return messages;
      for (const delivered of update.deliveredResults) {
        await emit({
          ...eventBase(session.id, turnId),
          type: "agent_results_delivered",
          runId: delivered.runId,
          status: delivered.status,
          agentCount: delivered.agentCount,
          message: delivered.message,
          details: delivered.details,
        });
      }
      const contextBlocks = [...update.deliveredResults.map((result) => result.message), update.digest].filter(Boolean);
      if (contextBlocks.length === 0) return messages;
      return [
        ...messages,
        {
          role: "user",
          content: contextBlocks.join("\n\n"),
          timestamp: Date.now(),
        },
      ];
    },
  });

  async function emit(event: BlipRuntimeEvent): Promise<void> {
    await store.appendRuntimeEvent(session, event);
    await onEvent?.(event);
  }

  await emit({
    ...eventBase(session.id, turnId),
    type: "session_started",
    workspaceRoot: options.workspaceRoot,
    model: `${options.provider}/${options.model}`,
    permissionMode: options.permissionMode,
    toolProfile: options.toolProfile,
    resumed,
  });

  let currentTurnStarted = false;
  let failed = false;
  let failureMessage = "";
  let emittedFailureMessage = "";
  const toolFailures: ToolFailure[] = [];
  async function recordFailure(error: string, recoverable = false): Promise<void> {
    const message = String(error ?? "").trim() || "Blip failed without an error message";
    failed = true;
    failureMessage = message;
    if (message === emittedFailureMessage) return;
    emittedFailureMessage = message;
    await emit({
      ...eventBase(session.id, turnId),
      type: "session_error",
      error: message,
      recoverable,
    });
  }

  agent.subscribe(async (event: AgentEvent) => {
    if (event.type === "turn_start") {
      timing.recordTurnStart();
      await emit({
        ...eventBase(session.id, turnId),
        type: "turn_started",
        ...(currentTurnStarted ? {} : { prompt: options.prompt }),
      });
      currentTurnStarted = true;
    } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      await emit({
        ...eventBase(session.id, turnId),
        type: "assistant_delta",
        text: event.assistantMessageEvent.delta,
      });
    } else if (event.type === "message_end") {
      await store.appendMessage(session, event.message);
      if (event.message.role === "assistant") {
        const text = messageText(event.message);
        if (text.trim()) {
          await emit({
            ...eventBase(session.id, turnId),
            type: "assistant_message",
            messageId: randomUUID(),
            text,
          });
        }
        const assistantError = assistantFailureMessage(event.message);
        if (assistantError) await recordFailure(assistantError);
      }
    } else if (event.type === "tool_execution_start") {
      timing.recordToolStart(event.toolCallId, event.toolName);
      await emit({
        ...eventBase(session.id, turnId),
        type: "tool_call_started",
        callId: event.toolCallId,
        tool: event.toolName,
        args: event.args,
      });
    } else if (event.type === "tool_execution_update") {
      const progressMessage = messageText({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.partialResult?.content ?? [],
        details: event.partialResult?.details,
        isError: false,
        timestamp: Date.now(),
      }).trim();
      await emit({
        ...eventBase(session.id, turnId),
        type: "tool_call_progress",
        callId: event.toolCallId,
        tool: event.toolName,
        message: progressMessage || "tool progress",
        details: event.partialResult?.details ?? event.partialResult,
      });
    } else if (event.type === "tool_execution_end") {
      const toolResultMessage = messageText({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content,
        details: event.result.details,
        isError: event.isError,
        timestamp: Date.now(),
      });
      const toolFailureMessage = event.isError ? toolResultMessage : toolResultFailureMessage(event.toolName, event.result.details, toolResultMessage);
      if (toolFailureMessage) {
        timing.recordToolEnd(event.toolCallId, event.toolName, true);
        toolFailures.push({ callId: event.toolCallId, tool: event.toolName, error: toolFailureMessage });
        await emit({
          ...eventBase(session.id, turnId),
          type: "tool_call_failed",
          callId: event.toolCallId,
          tool: event.toolName,
          error: toolFailureMessage,
        });
      } else {
        timing.recordToolEnd(event.toolCallId, event.toolName, false);
        await emit({
          ...eventBase(session.id, turnId),
          type: "tool_call_completed",
          callId: event.toolCallId,
          tool: event.toolName,
          result: event.result.details,
        });
      }
    } else if (event.type === "agent_end") {
      for (const message of event.messages) {
        const assistantError = assistantFailureMessage(message);
        if (assistantError) await recordFailure(assistantError);
      }
    }
  });

  try {
    await agent.prompt(options.prompt);
  } catch (error) {
    await recordFailure(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await addNewGitUntrackedFiles(changedFiles, options.workspaceRoot, initialUntrackedFiles);
    session.readFiles = Array.from(readFiles).sort();
    session.changedFiles = Array.from(changedFiles).sort();
    await store.save(session);
    const finishedAt = Date.now();
    const contextUsage = await estimateContextUsage({ store, session, contextWindow: model.contextWindow });
    const finishedEvent: BlipRuntimeEvent = {
      ...eventBase(session.id, turnId),
      type: "session_finished",
      status: failed ? "error" : "completed",
      changedFiles: session.changedFiles,
      durationMs: finishedAt - startedAt,
      timing: timing.finish(finishedAt),
      ...(contextUsage ? { contextUsage } : {}),
      ...(failureMessage ? { error: failureMessage } : {}),
      ...(toolFailures.length > 0 ? { toolFailures } : {}),
    };
    await emit(finishedEvent);
    const diagnosticsDelayMs = typeof options.processExitDiagnosticsDelayMs === "number" && Number.isFinite(options.processExitDiagnosticsDelayMs) ? Math.max(0, Math.floor(options.processExitDiagnosticsDelayMs)) : 0;
    if (diagnosticsDelayMs > 0) {
      const timer = setTimeout(() => {
        const diagnostics = collectProcessDiagnostics();
        void emit({
          ...eventBase(session.id, turnId),
          type: "process_diagnostics",
          reason: `process still alive ${diagnosticsDelayMs}ms after session_finished`,
          ...diagnostics,
        }).catch(() => {
          // Diagnostics must never turn a completed run into an unhandled rejection.
        });
      }, diagnosticsDelayMs);
      timer.unref?.();
    }
  }

  return session;
}
