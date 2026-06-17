import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { compactSession, createLocalCompaction, estimateEntriesTokens, estimateModelContextTokens, runBlipTask, SessionStore } from "../src/index";

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "blip-core-"));
}

function user(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function assistant(content: string): AgentMessage {
  return fauxAssistantMessage(content);
}

describe("Blip runtime", () => {
  test("runs a faux tool loop and persists a session", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "hello.txt"), "hello blip\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "hello.txt" }, { id: "call_read" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("I read hello.txt."),
    ]);

    const events: string[] = [];
    const session = await runBlipTask(
      {
        prompt: "Read hello.txt",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
      },
      (event) => events.push(event.type),
    );

    expect(events).toContain("tool_call_started");
    expect(events).toContain("tool_call_completed");
    expect(session.readFiles).toEqual(["hello.txt"]);
    const transcript = await readFile(session.transcriptPath, "utf8");
    expect(transcript).toContain("I read hello.txt.");
    faux.unregister();
  });

  test("reconstructs model context as compaction summary plus retained tail", async () => {
    const workspace = await tempWorkspace();
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: "faux",
      model: "faux-1",
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });
    await store.appendMessage(session, user("old request"));
    await store.appendMessage(session, assistant("old response"));
    await store.appendMessage(session, user("recent request"));
    await store.appendMessage(session, assistant("recent response"));

    const compaction = createLocalCompaction({
      session,
      entries: await store.readTranscript(session),
      trigger: "manual",
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });
    expect(compaction).toBeDefined();
    await store.appendEntry(session, compaction!);
    session.compactedSummary = compaction!.summary;
    await store.save(session);

    const messages = await store.readModelMessages(session);
    expect(messages.map((message) => (message.role === "user" ? message.content : ""))).not.toContain("old request");
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.role === "user" ? messages[0].content : "").toContain("Summary of earlier conversation:");
    expect(messages.map((message) => (message.role === "user" ? message.content : ""))).toContain("recent request");
  });

  test("falls back to raw messages when a compaction boundary is missing", async () => {
    const workspace = await tempWorkspace();
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: "faux",
      model: "faux-1",
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });
    await store.appendMessage(session, user("old request"));
    await store.appendMessage(session, assistant("old response"));
    await store.appendEntry(session, {
      type: "compaction",
      id: "cmp_bad",
      createdAt: new Date().toISOString(),
      trigger: "manual",
      tokensBefore: 100,
      tokensAfterEstimate: 10,
      firstKeptEntryId: "missing",
      summary: "bad boundary",
      details: { readFiles: [], modifiedFiles: [] },
    });
    await store.appendMessage(session, user("recent request"));

    const messages = await store.readModelMessages(session);
    expect(messages.map((message) => (message.role === "user" ? message.content : ""))).toContain("old request");
    expect(messages[0]?.role === "user" ? messages[0].content : "").not.toContain("Summary of earlier conversation:");
  });

  test("estimates context from latest assistant usage plus trailing messages", () => {
    const first = assistant("first") as AgentMessage & { role: "assistant" };
    first.usage = { ...first.usage, totalTokens: 1_000 };
    const second = assistant("second") as AgentMessage & { role: "assistant" };
    second.usage = { ...second.usage, totalTokens: 2_000 };
    const entries = [
      { type: "message" as const, id: "u1", timestamp: new Date().toISOString(), message: user("old " + "x".repeat(10_000)) },
      { type: "message" as const, id: "a1", timestamp: new Date().toISOString(), message: first },
      { type: "message" as const, id: "u2", timestamp: new Date().toISOString(), message: user("middle") },
      { type: "message" as const, id: "a2", timestamp: new Date().toISOString(), message: second },
      { type: "message" as const, id: "u3", timestamp: new Date().toISOString(), message: user("tail") },
    ];

    const rawEstimate = estimateEntriesTokens(entries);
    expect(rawEstimate).toBeGreaterThan(2_000);
    expect(rawEstimate).toBeLessThan(2_100);

    const compactedEstimate = estimateModelContextTokens([
      ...entries,
      {
        type: "compaction" as const,
        id: "cmp",
        createdAt: new Date().toISOString(),
        trigger: "manual" as const,
        tokensBefore: 2_000,
        tokensAfterEstimate: 10,
        firstKeptEntryId: "u3",
        summary: "short summary",
        details: { readFiles: [], modifiedFiles: [] },
      },
    ]);
    expect(compactedEstimate).toBeLessThan(100);
  });

  test("manual compaction uses model summary and stores retained boundary", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage("## Goal\n- Model summary")]);
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: "faux",
      model: faux.getModel().id,
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });
    await store.appendMessage(session, user("old request"));
    await store.appendMessage(session, assistant("old response"));
    await store.appendMessage(session, user("recent request"));
    await store.appendMessage(session, assistant("recent response"));

    await compactSession({
      workspaceRoot: workspace,
      sessionId: session.id,
      trigger: "manual",
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });

    const transcript = await store.readTranscript(session);
    const compaction = transcript.find((entry) => entry.type === "compaction");
    expect(compaction?.type === "compaction" ? compaction.summary : "").toContain("Model summary");
    const messages = await store.readModelMessages(await store.load(session.id));
    expect(messages.map((message) => (message.role === "user" ? message.content : ""))).not.toContain("old request");
    expect(messages.map((message) => (message.role === "user" ? message.content : ""))).toContain("recent request");
    faux.unregister();
  });

  test("repeated compaction updates the summary and advances the retained tail", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage("## Goal\n- First summary"), fauxAssistantMessage("## Goal\n- Updated summary")]);
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: "faux",
      model: faux.getModel().id,
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });
    await store.appendMessage(session, user("turn one"));
    await store.appendMessage(session, assistant("turn one done"));
    await store.appendMessage(session, user("turn two"));
    await store.appendMessage(session, assistant("turn two done"));

    await compactSession({
      workspaceRoot: workspace,
      sessionId: session.id,
      trigger: "manual",
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });
    await store.appendMessage(await store.load(session.id), user("turn three"));
    await compactSession({
      workspaceRoot: workspace,
      sessionId: session.id,
      trigger: "manual",
      settings: { auto: true, reserveTokens: 10, keepRecentTokens: 1, keepRecentTurns: 1 },
    });

    const loaded = await store.load(session.id);
    const messages = await store.readModelMessages(loaded);
    const userTexts = messages.map((message) => (message.role === "user" ? message.content : ""));
    expect(userTexts[0]).toContain("Updated summary");
    expect(userTexts).not.toContain("turn one");
    expect(userTexts).not.toContain("turn two");
    expect(userTexts).toContain("turn three");
    const compactions = (await store.readTranscript(loaded)).filter((entry) => entry.type === "compaction");
    expect(compactions).toHaveLength(2);
    faux.unregister();
  });

  test("auto compacts before a run when context exceeds the model window", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage("## Goal\n- Auto summary"), fauxAssistantMessage("continued")]);
    const store = new SessionStore(workspace);
    const session = await store.create({
      provider: "faux",
      model: faux.getModel().id,
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });
    await store.appendMessage(session, user("old " + "x".repeat(600_000)));
    await store.appendMessage(session, assistant("old response"));
    await store.appendMessage(session, user("middle request"));
    await store.appendMessage(session, assistant("middle response"));
    await store.appendMessage(session, user("recent request"));

    const events: string[] = [];
    await runBlipTask(
      {
        prompt: "continue",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        sessionId: session.id,
      },
      (event) => events.push(event.type),
    );

    expect(events).toContain("compaction_completed");
    const transcript = await store.readTranscript(session);
    expect(transcript.some((entry) => entry.type === "compaction")).toBe(true);

    events.length = 0;
    faux.setResponses([fauxAssistantMessage("continued again")]);
    await runBlipTask(
      {
        prompt: "continue again",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        sessionId: session.id,
      },
      (event) => events.push(event.type),
    );
    expect(events).not.toContain("compaction_started");
    faux.unregister();
  });
});
