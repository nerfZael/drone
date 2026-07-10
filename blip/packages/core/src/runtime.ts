import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { getModel, getModels, type Model } from "@mariozechner/pi-ai";
import {
  createProfileTools,
  type FileOperationKind,
  type PermissionMode,
  type ToolProfile,
} from "@blip/tools";
import { createBlipSession } from "./blip-session.js";
import type { BlipEventSink } from "./blip-session-types.js";
import {
  createCompaction,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
} from "./compaction.js";
import { assembleSystemPrompt } from "./prompts.js";
import type { SessionRepository } from "./session-repository.js";
import { SessionStore } from "./session-store.js";
import type { BlipRuntimeEvent, BlipSessionState, RunBlipOptions } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(
  sessionId: string,
  turnId?: string,
): Pick<BlipRuntimeEvent, "version" | "sessionId" | "timestamp"> & { turnId?: string } {
  return {
    version: 1,
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

function summarizeProcessItems(items: unknown[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const type =
      item && typeof item === "object"
        ? String((item as { constructor?: { name?: string } }).constructor?.name ?? "object")
        : typeof item;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, count }));
}

export function collectProcessDiagnostics(): Pick<
  Extract<BlipRuntimeEvent, { type: "process_diagnostics" }>,
  "activeHandles" | "activeRequests"
> {
  const diagnosticProcess = process as typeof process & {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  return {
    activeHandles: summarizeProcessItems(diagnosticProcess._getActiveHandles?.() ?? []),
    activeRequests: summarizeProcessItems(diagnosticProcess._getActiveRequests?.() ?? []),
  };
}

function collectGitUntrackedFiles(workspaceRoot: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      ["-C", workspaceRoot, "ls-files", "--others", "--exclude-standard", "-z"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.on("error", () => resolve(new Set()));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(new Set());
        return;
      }
      resolve(
        new Set(
          Buffer.concat(chunks)
            .toString("utf8")
            .split("\0")
            .map((file) => file.trim())
            .filter(Boolean),
        ),
      );
    });
  });
}

export function resolveBlipModel(provider: string, modelId: string): Model<any> {
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
  throw new Error(
    `unknown model ${provider}/${modelId}${
      available.length ? `; examples: ${available.join(", ")}` : ""
    }`,
  );
}

export function defaultToolProfile(
  permissionMode: PermissionMode,
  shellAvailable = true,
): ToolProfile {
  if (permissionMode === "read-only") return "read-only";
  return shellAvailable ? "local-trusted-write" : "no-shell-workspace-write";
}

export interface CompactStoredSessionOptions {
  sessionRepository: SessionRepository;
  session: BlipSessionState;
  trigger?: "manual" | "auto";
  settings?: CompactionSettings;
  model?: Model<any>;
  reasoning?: RunBlipOptions["reasoning"];
  getApiKey?: RunBlipOptions["getApiKey"];
  eventSink?: BlipEventSink;
}

/** Manually compacts a session through any repository implementation. */
export async function compactStoredSession(
  options: CompactStoredSessionOptions,
): Promise<BlipSessionState> {
  const { session, sessionRepository } = options;
  const turnId = `t_${randomUUID().slice(0, 8)}`;
  const emit = async (event: BlipRuntimeEvent) => {
    await sessionRepository.appendRuntimeEvent(session, event);
    await options.eventSink?.(event);
  };
  await emit({
    ...eventBase(session.id, turnId),
    type: "compaction_started",
    reason: options.trigger ?? "manual",
  });
  const entries = await sessionRepository.readTranscript(session);
  const model =
    options.model ?? resolveBlipModel(session.modelProvider, session.modelId);
  const compaction = await createCompaction({
    session,
    entries,
    trigger: options.trigger ?? "manual",
    settings: options.settings,
    model,
    reasoning: options.reasoning,
    apiKey: await options.getApiKey?.(model.provider),
  });
  if (!compaction) {
    await emit({
      ...eventBase(session.id, turnId),
      type: "compaction_skipped",
      reason: "nothing to compact yet",
    });
    return session;
  }
  await sessionRepository.appendEntry(session, compaction);
  session.compactedSummary = compaction.summary;
  await sessionRepository.save(session);
  await emit({
    ...eventBase(session.id, turnId),
    type: "compaction_completed",
    summaryId: compaction.id,
    tokensBefore: compaction.tokensBefore,
    tokensAfter: compaction.tokensAfterEstimate ?? 0,
  });
  return session;
}

/** File-backed CLI compatibility entry point. */
export async function compactSession(input: {
  workspaceRoot: string;
  sessionId?: string;
  trigger?: "manual" | "auto";
  settings?: CompactionSettings;
  model?: Model<any>;
  reasoning?: RunBlipOptions["reasoning"];
  getApiKey?: RunBlipOptions["getApiKey"];
  onEvent?: BlipEventSink;
}): Promise<BlipSessionState> {
  const repository = new SessionStore(input.workspaceRoot);
  const session = input.sessionId
    ? await repository.load(input.sessionId)
    : await repository.latest();
  if (!session) throw new Error("no session found to compact");
  return compactStoredSession({
    sessionRepository: repository,
    session,
    trigger: input.trigger,
    settings: input.settings,
    model: input.model,
    reasoning: input.reasoning,
    getApiKey: input.getApiKey,
    eventSink: input.onEvent,
  });
}

/**
 * Runs one CLI-style prompt using the embeddable session runtime.
 * Existing callers keep their file store, local tools, prompt, and event behavior.
 */
export async function runBlipTask(
  options: RunBlipOptions,
  onEvent?: BlipEventSink,
): Promise<BlipSessionState> {
  const repository = new SessionStore(options.workspaceRoot);
  const model = resolveBlipModel(options.provider, options.model);
  let initialUntrackedFiles = new Set<string>();
  const handle = await createBlipSession({
    workspaceRoot: options.workspaceRoot,
    model,
    permissionMode: options.permissionMode,
    toolProfile: options.toolProfile,
    sessionRepository: repository,
    sessionId: options.sessionId,
    forkSessionId: options.forkSessionId,
    continueLatest: options.continueLatest,
    resumeLatest: options.resumeLatest,
    reasoning: options.reasoning,
    getApiKey: options.getApiKey,
    eventSink: onEvent,
    compactionSettings: DEFAULT_COMPACTION_SETTINGS,
    processExitDiagnosticsDelayMs: options.processExitDiagnosticsDelayMs,
    promptProvider: () =>
      assembleSystemPrompt({
        workspaceRoot: options.workspaceRoot,
        toolProfile: options.toolProfile,
      }),
    toolProviders: [
      {
        id: "local-workspace",
        load(context) {
          const readFiles = new Set(context.session.readFiles);
          const changedFiles = new Set(context.session.changedFiles);
          return createProfileTools({
            workspaceRoot: options.workspaceRoot,
            permissionMode: options.permissionMode,
            profile: options.toolProfile,
            onFileOperation(kind: FileOperationKind, filePath: string) {
              if (kind === "read") readFiles.add(filePath);
              else changedFiles.add(filePath);
              context.session.readFiles = Array.from(readFiles).sort();
              context.session.changedFiles = Array.from(changedFiles).sort();
            },
          });
        },
      },
    ],
    beforePrompt: async () => {
      initialUntrackedFiles = await collectGitUntrackedFiles(options.workspaceRoot);
    },
    afterPrompt: async ({ session }) => {
      const finalUntrackedFiles = await collectGitUntrackedFiles(options.workspaceRoot);
      const changedFiles = new Set(session.changedFiles);
      for (const file of finalUntrackedFiles) {
        if (!initialUntrackedFiles.has(file)) changedFiles.add(file);
      }
      session.changedFiles = Array.from(changedFiles).sort();
    },
  });
  try {
    return await handle.prompt(options.prompt);
  } finally {
    handle.close();
  }
}
