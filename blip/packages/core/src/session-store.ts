import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { PermissionMode, ToolProfile } from "@blip/tools";
import type { BlipRuntimeEvent, BlipSessionState, TranscriptEntry } from "./types.js";

const BLIP_DATA_DIR_ENV = "BLIP_DATA_DIR";

function nowIso(): string {
  return new Date().toISOString();
}

function sessionIdFromTime(): string {
  return `s_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function workspaceHash(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 16);
}

function defaultDataRoot(): string {
  const explicit = String(process.env[BLIP_DATA_DIR_ENV] ?? "").trim();
  if (explicit) return path.resolve(explicit);

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "blip");
  }
  if (process.platform === "win32") {
    const localAppData = String(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? "").trim();
    return path.join(localAppData || path.join(os.homedir(), "AppData", "Local"), "blip");
  }

  const xdgDataHome = String(process.env.XDG_DATA_HOME ?? "").trim();
  return path.join(xdgDataHome || path.join(os.homedir(), ".local", "share"), "blip");
}

export class SessionStore {
  readonly workspaceRoot: string;
  readonly rootDir: string;
  readonly workspaceDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.rootDir = path.join(defaultDataRoot(), "sessions");
    this.workspaceDir = path.join(this.rootDir, workspaceHash(this.workspaceRoot));
  }

  async ensure(): Promise<void> {
    await mkdir(this.workspaceDir, { recursive: true });
  }

  sessionDir(sessionId: string): string {
    return path.join(this.workspaceDir, sessionId);
  }

  metadataPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "session.json");
  }

  transcriptPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "transcript.jsonl");
  }

  async create(input: {
    provider: string;
    model: string;
    permissionMode: PermissionMode;
    toolProfile: ToolProfile;
    parentSessionId?: string;
    forkedFromEntryId?: string;
    transcriptSeed?: TranscriptEntry[];
  }): Promise<BlipSessionState> {
    await this.ensure();
    const id = sessionIdFromTime();
    const createdAt = nowIso();
    const session: BlipSessionState = {
      id,
      workspaceRoot: this.workspaceRoot,
      modelProvider: input.provider,
      modelId: input.model,
      permissionMode: input.permissionMode,
      toolProfile: input.toolProfile,
      loadedSkills: [],
      transcriptPath: this.transcriptPath(id),
      changedFiles: [],
      readFiles: [],
      createdAt,
      updatedAt: createdAt,
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.forkedFromEntryId ? { forkedFromEntryId: input.forkedFromEntryId } : {}),
    };
    await mkdir(this.sessionDir(id), { recursive: true });
    await this.save(session);
    if (input.transcriptSeed?.length) {
      await writeFile(session.transcriptPath, input.transcriptSeed.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    } else {
      await writeFile(session.transcriptPath, "");
    }
    return session;
  }

  async save(session: BlipSessionState): Promise<void> {
    const next = { ...session, updatedAt: nowIso() };
    await mkdir(this.sessionDir(session.id), { recursive: true });
    await writeFile(this.metadataPath(session.id), `${JSON.stringify(next, null, 2)}\n`);
    Object.assign(session, next);
  }

  async load(sessionId: string): Promise<BlipSessionState> {
    return JSON.parse(await readFile(this.metadataPath(sessionId), "utf8")) as BlipSessionState;
  }

  async list(): Promise<BlipSessionState[]> {
    await this.ensure();
    const entries = await readdir(this.workspaceDir, { withFileTypes: true });
    const sessions: BlipSessionState[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        sessions.push(await this.load(entry.name));
      } catch {
        // Ignore corrupt session metadata in v1 listing.
      }
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessions;
  }

  async latest(): Promise<BlipSessionState | undefined> {
    return (await this.list())[0];
  }

  async appendEntry(session: BlipSessionState, entry: TranscriptEntry): Promise<void> {
    await writeFile(session.transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
  }

  async appendMessage(session: BlipSessionState, message: AgentMessage): Promise<void> {
    await this.appendEntry(session, { type: "message", id: randomUUID(), timestamp: nowIso(), message });
  }

  async appendRuntimeEvent(session: BlipSessionState, event: BlipRuntimeEvent): Promise<void> {
    await this.appendEntry(session, { type: "runtime_event", id: randomUUID(), timestamp: nowIso(), event });
  }

  async readTranscript(session: BlipSessionState): Promise<TranscriptEntry[]> {
    try {
      const raw = await readFile(session.transcriptPath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TranscriptEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async readMessages(session: BlipSessionState): Promise<AgentMessage[]> {
    return (await this.readTranscript(session))
      .filter((entry): entry is Extract<TranscriptEntry, { type: "message" }> => entry.type === "message")
      .map((entry) => entry.message);
  }

  async readModelMessages(session: BlipSessionState): Promise<AgentMessage[]> {
    const transcript = await this.readTranscript(session);
    let compactionIndex = -1;
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (transcript[index].type === "compaction") {
        compactionIndex = index;
        break;
      }
    }
    if (compactionIndex < 0) {
      return transcript
        .filter((entry): entry is Extract<TranscriptEntry, { type: "message" }> => entry.type === "message")
        .map((entry) => entry.message);
    }

    const compaction = transcript[compactionIndex] as Extract<TranscriptEntry, { type: "compaction" }>;
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Summary of earlier conversation:\n${compaction.summary}`,
        timestamp: Date.parse(compaction.createdAt) || Date.now(),
      },
    ];

    let foundFirstKept = false;
    for (let index = 0; index < compactionIndex; index += 1) {
      const entry = transcript[index];
      if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept && entry.type === "message") messages.push(entry.message);
    }
    if (!foundFirstKept) {
      return transcript
        .filter((entry): entry is Extract<TranscriptEntry, { type: "message" }> => entry.type === "message")
        .map((entry) => entry.message);
    }
    for (let index = compactionIndex + 1; index < transcript.length; index += 1) {
      const entry = transcript[index];
      if (entry.type === "message") messages.push(entry.message);
    }
    return messages;
  }

  async fork(source: BlipSessionState, input: { provider: string; model: string; permissionMode: PermissionMode; toolProfile: ToolProfile }): Promise<BlipSessionState> {
    const transcript = await this.readTranscript(source);
    return this.create({
      ...input,
      parentSessionId: source.id,
      transcriptSeed: transcript,
    });
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      await stat(this.metadataPath(sessionId));
      return true;
    } catch {
      return false;
    }
  }
}
