import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { compactSession, createLocalCompaction, estimateEntriesTokens, estimateModelContextTokens, runBlipTask, SessionStore } from "../src/index";

process.env.BLIP_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "blip-core-data-"));

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
      fauxAssistantMessage(fauxToolCall("read_file", { path: "hello.txt" }, { id: "call_read" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("I read hello.txt."),
    ]);

    const events: string[] = [];
    const assistantMessages: string[] = [];
    const session = await runBlipTask(
      {
        prompt: "Read hello.txt",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
      },
      (event) => {
        events.push(event.type);
        if (event.type === "assistant_message") assistantMessages.push(event.text);
      },
    );

    expect(events).toContain("tool_call_started");
    expect(events).toContain("tool_call_completed");
    expect(assistantMessages).toEqual(["I read hello.txt."]);
    expect(assistantMessages.join("\n")).not.toContain("[tool:");
    expect(session.readFiles).toEqual(["hello.txt"]);
    const transcript = await readFile(session.transcriptPath, "utf8");
    expect(transcript).toContain("I read hello.txt.");
    faux.unregister();
  });

  test("executes parallel-safe tool batches concurrently", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");
    await writeFile(path.join(workspace, "beta.txt"), "beta\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage([fauxToolCall("read_file", { path: "alpha.txt" }, { id: "call_alpha" }), fauxToolCall("read_file", { path: "beta.txt" }, { id: "call_beta" })], { stopReason: "toolUse" }), fauxAssistantMessage("I read both files.")]);

    const toolEvents: Array<{ type: string; callId: string }> = [];
    let finishedEvent: any;
    const session = await runBlipTask(
      {
        prompt: "Read both files",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
      },
      (event) => {
        if (event.type === "tool_call_started" || event.type === "tool_call_completed") {
          toolEvents.push({ type: event.type, callId: event.callId });
        }
        if (event.type === "session_finished") finishedEvent = event;
      },
    );

    expect(toolEvents.slice(0, 2)).toEqual([
      { type: "tool_call_started", callId: "call_alpha" },
      { type: "tool_call_started", callId: "call_beta" },
    ]);
    expect(toolEvents.map((event) => event.type)).toEqual(["tool_call_started", "tool_call_started", "tool_call_completed", "tool_call_completed"]);
    expect(session.readFiles).toEqual(["alpha.txt", "beta.txt"]);
    expect(finishedEvent.timing).toEqual(
      expect.objectContaining({
        toolCallCount: 2,
        toolCallCompletedCount: 2,
        toolCallFailedCount: 0,
        toolTurnCount: 1,
        singleToolTurnCount: 0,
        parallelToolTurnCount: 1,
        maxToolsInTurn: 2,
      }),
    );
    expect(finishedEvent.timing.toolCallsByName.read_file).toEqual(
      expect.objectContaining({
        count: 2,
        completed: 2,
        failed: 0,
      }),
    );
    expect(finishedEvent.contextUsage).toEqual(
      expect.objectContaining({
        contextWindow: faux.getModel().contextWindow,
      }),
    );
    expect(finishedEvent.contextUsage.tokens).toBeGreaterThan(0);
    expect(finishedEvent.contextUsage.percent).toBeGreaterThan(0);
    faux.unregister();
  });

  test("executes bash tool batches concurrently", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.4 && echo alpha" }, { id: "call_alpha" }), fauxToolCall("bash", { command: "sleep 0.4 && echo beta" }, { id: "call_beta" })], { stopReason: "toolUse" }), fauxAssistantMessage("I ran both commands.")]);

    const toolEvents: Array<{ type: string; callId: string }> = [];
    const startedAt = Date.now();
    await runBlipTask(
      {
        prompt: "Run both commands",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "local-trusted-write",
      },
      (event) => {
        if (event.type === "tool_call_started" || event.type === "tool_call_completed") {
          toolEvents.push({ type: event.type, callId: event.callId });
        }
      },
    );
    const durationMs = Date.now() - startedAt;

    expect(durationMs).toBeLessThan(750);
    expect(toolEvents.filter((event) => event.type === "tool_call_completed")).toHaveLength(2);
    faux.unregister();
  });

  test("records non-zero bash exits as recovered tool failures", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("bash", { command: "echo nope >&2; exit 2" }, { id: "call_bash_fail" }), { stopReason: "toolUse" }), fauxAssistantMessage("Recovered after bash failed.")]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Run a failing command and recover",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "local-trusted-write",
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call_failed",
        callId: "call_bash_fail",
        tool: "bash",
        error: expect.stringContaining("bash exited with code 2"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_finished",
        status: "completed",
        toolFailures: [expect.objectContaining({ callId: "call_bash_fail", tool: "bash", error: expect.stringContaining("exitCode: 2") })],
        timing: expect.objectContaining({
          toolCallCompletedCount: 0,
          toolCallFailedCount: 1,
          toolCallsByName: expect.objectContaining({
            bash: expect.objectContaining({ count: 1, completed: 0, failed: 1 }),
          }),
        }),
      }),
    );
    faux.unregister();
  });

  test("executes independent mutation tool batches successfully", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage([fauxToolCall("write_file", { path: "alpha.txt", content: "alpha\n", mode: "create" }, { id: "call_alpha" }), fauxToolCall("write_file", { path: "beta.txt", content: "beta\n", mode: "create" }, { id: "call_beta" })], { stopReason: "toolUse" }), fauxAssistantMessage("I wrote both files.")]);

    const session = await runBlipTask({
      prompt: "Write both files",
      workspaceRoot: workspace,
      provider: "faux",
      model: faux.getModel().id,
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });

    expect(session.changedFiles).toEqual(["alpha.txt", "beta.txt"]);
    expect(await readFile(path.join(workspace, "alpha.txt"), "utf8")).toBe("alpha\n");
    expect(await readFile(path.join(workspace, "beta.txt"), "utf8")).toBe("beta\n");
    faux.unregister();
  });

  test("includes newly untracked git files created by bash in changed files", async () => {
    const workspace = await tempWorkspace();
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("bash", { command: "printf 'hello\\n' > created.txt" }, { id: "call_create" }), { stopReason: "toolUse" }), fauxAssistantMessage("I created the file.")]);

    const session = await runBlipTask({
      prompt: "Create an untracked file",
      workspaceRoot: workspace,
      provider: "faux",
      model: faux.getModel().id,
      permissionMode: "workspace-write",
      toolProfile: "local-trusted-write",
    });

    expect(session.changedFiles).toContain("created.txt");
    expect(await readFile(path.join(workspace, "created.txt"), "utf8")).toBe("hello\n");
    faux.unregister();
  });

  test("surfaces assistant error messages in runtime events", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "Codex auth token expired" })]);

    const events: Array<{ type: string; error?: string; status?: string }> = [];
    await runBlipTask(
      {
        prompt: "Say hi",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "session_error", error: "Codex auth token expired" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_finished",
        status: "error",
        error: "Codex auth token expired",
      }),
    );
    faux.unregister();
  });

  test("keeps recovered tool failures separate from final session status", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" }, { id: "call_missing" }), { stopReason: "toolUse" }), fauxAssistantMessage("Recovered after the missing file.")]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Read missing.txt and recover",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_failed", tool: "read_file" }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: "session_error" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_finished",
        status: "completed",
        toolFailures: [expect.objectContaining({ callId: "call_missing", tool: "read_file" })],
      }),
    );
    faux.unregister();
  });

  test("emits opt-in process diagnostics after session finish if process remains alive", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage("done")]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Say done",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        processExitDiagnosticsDelayMs: 5,
      },
      (event) => events.push(event),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "process_diagnostics",
        reason: expect.stringContaining("process still alive"),
        activeHandles: expect.any(Array),
        activeRequests: expect.any(Array),
      }),
    );
    faux.unregister();
  });

  test("runs blocking agents in parallel and returns structured final messages", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: true, agents: [{ task: "inspect alpha", authority: "read_only", context: "clone" }, { task: "inspect beta", authority: "read_only", context: "none" }] }, { id: "call_agents" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("alpha result"),
      fauxAssistantMessage("beta result"),
      fauxAssistantMessage("original saw agent results"),
    ]);

    const events: any[] = [];
    const session = await runBlipTask(
      {
        prompt: "Use agents",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_started", tool: "agent" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_completed", tool: "agent" }));
    const agentResult = events.find((event) => event.type === "tool_call_completed" && event.tool === "agent")?.result;
    expect(agentResult.agents).toHaveLength(2);
    expect(agentResult.agents.map((agent: any) => agent.result.message).sort()).toEqual(["alpha result", "beta result"]);
    const store = new SessionStore(workspace);
    const sessions = await store.list();
    const agents = sessions.filter((item) => item.parentSessionId === session.id);
    expect(agents).toHaveLength(2);
    const agentTranscripts = await Promise.all(agents.map((agent) => readFile(agent.transcriptPath, "utf8")));
    expect(agentTranscripts.join("\n")).toContain("You are Blip agent");
    expect(agentTranscripts.join("\n")).toContain("inspect alpha");
    expect(agentTranscripts.join("\n")).toContain("inspect beta");

    const transcript = await readFile(session.transcriptPath, "utf8");
    expect(transcript).toContain("alpha result");
    expect(transcript).toContain("beta result");
    expect(transcript).toContain("original saw agent results");
    faux.unregister();
  });

  test("emits runtime-generated agent coverage progress from child tool activity", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: true, agents: [{ task: "inspect alpha file", authority: "read_only", context: "none" }] }, { id: "call_agents" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("read_file", { path: "alpha.txt" }, { id: "call_child_read" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("alpha inspected"),
      fauxAssistantMessage("parent saw coverage"),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Use an agent to inspect alpha",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    const progress = events.find((event) => event.type === "tool_call_progress" && event.tool === "agent");
    expect(progress).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("read 1 file"),
        details: expect.objectContaining({
          coverage: expect.objectContaining({
            readFiles: ["alpha.txt"],
          }),
        }),
      }),
    );
    const completion = events.find((event) => event.type === "tool_call_completed" && event.tool === "agent");
    expect(completion.result.agents[0].coverage.readFiles).toEqual(["alpha.txt"]);
    expect(completion.result.agents[0].result.coverage.readFiles).toEqual(["alpha.txt"]);
    faux.unregister();
  });

  test("runs scratch agents without mutating the parent workspace", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "parent.txt"), "original\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: true, agents: [{ task: "try editing parent.txt", authority: "scratch", context: "none", output: "patch_plan" }] }, { id: "call_agents" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("bash", { command: "printf 'scratch\\n' > parent.txt" }, { id: "call_scratch_write" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("scratch edit ready"),
      fauxAssistantMessage("original saw scratch result"),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Use a scratch agent",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "local-trusted-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    expect(await readFile(path.join(workspace, "parent.txt"), "utf8")).toBe("original\n");
    const result = events.find((event) => event.type === "tool_call_completed" && event.tool === "agent")?.result;
    expect(result.agents[0].result.changedFiles).toEqual(["parent.txt"]);
    expect(result.agents[0].result.scratch.diff).toContain("scratch");
    faux.unregister();
  });

  test("starts non-blocking agents and collects results later", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "inspect later", authority: "read_only", context: "none" }] }, { id: "call_agents_start" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("agent", { action: "collect", wait: true }, { id: "call_agents_collect" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("background result"),
      fauxAssistantMessage("parent collected result"),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Start an agent and collect later",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => {
        events.push(event);
      },
    );

    const agentCompletions = events.filter((event) => event.type === "tool_call_completed" && event.tool === "agent");
    expect(agentCompletions[0].result.status).toBe("running");
    expect(agentCompletions[1].result.status).toBe("completed");
    expect(agentCompletions[1].result.agents[0].result.message).toBe("background result");
    faux.unregister();
  });

  test("preserves non-blocking agent coverage for later collect", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "inspect alpha later", authority: "read_only", context: "none" }] }, { id: "call_agents_start" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("agent", { action: "collect", wait: true }, { id: "call_agents_collect" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("read_file", { path: "alpha.txt" }, { id: "call_child_read" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("alpha inspected later"),
      fauxAssistantMessage("parent collected coverage"),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Start an agent and collect its coverage later",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    const agentCompletions = events.filter((event) => event.type === "tool_call_completed" && event.tool === "agent");
    expect(agentCompletions[0].result.status).toBe("running");
    expect(agentCompletions[1].result.status).toBe("completed");
    expect(agentCompletions[1].result.agents[0].coverage.readFiles).toEqual(["alpha.txt"]);
    expect(agentCompletions[1].result.agents[0].result.coverage.readFiles).toEqual(["alpha.txt"]);
    faux.unregister();
  });

  test("injects active agent status digest into parent model context", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    let childReadIssued = false;
    let parentCollectIssued = false;
    let parentWaitCount = 0;
    let sawDigest = false;

    const routeResponse = (context: any) => {
      const toolNames = new Set((context.tools ?? []).map((tool: any) => tool.name));
      const messagesText = (context.messages ?? [])
        .map((message: any) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      const isParent = toolNames.has("agent");

      if (!isParent) {
        if (!childReadIssued) {
          childReadIssued = true;
          return fauxAssistantMessage(fauxToolCall("read_file", { path: "alpha.txt" }, { id: "call_child_read" }), {
            stopReason: "toolUse",
          });
        }
        return fauxAssistantMessage("alpha inspected");
      }

      if (!parentCollectIssued) {
        if (messagesText.includes("Blip runtime agent status")) {
          sawDigest = true;
          parentCollectIssued = true;
          expect(messagesText).toContain("alpha.txt");
          expect(messagesText).toContain("agent collect");
          return fauxAssistantMessage(fauxToolCall("agent", { action: "collect", wait: true }, { id: "call_agents_collect" }), {
            stopReason: "toolUse",
          });
        }
        parentWaitCount += 1;
        return fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 0.15" }, { id: `call_parent_wait_${parentWaitCount}` }), {
          stopReason: "toolUse",
        });
      }

      return fauxAssistantMessage("parent collected status");
    };

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "inspect alpha later", authority: "read_only", context: "none" }] }, { id: "call_agents_start" }), {
        stopReason: "toolUse",
      }),
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
    ]);

    await runBlipTask({
      prompt: "Start an agent and use its injected status",
      workspaceRoot: workspace,
      provider: "faux",
      model: faux.getModel().id,
      permissionMode: "workspace-write",
      toolProfile: "local-trusted-write",
      agentsEnabled: true,
    });

    expect(sawDigest).toBe(true);
    expect(parentCollectIssued).toBe(true);
    faux.unregister();
  });

  test("auto-delivers completed non-blocking agent results into parent model context", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    let childReadIssued = false;
    let sawDeliveredResults = false;
    let parentWaitCount = 0;

    const routeResponse = (context: any) => {
      const toolNames = new Set((context.tools ?? []).map((tool: any) => tool.name));
      const messagesText = (context.messages ?? [])
        .map((message: any) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      const isParent = toolNames.has("agent");

      if (!isParent) {
        if (!childReadIssued) {
          childReadIssued = true;
          return fauxAssistantMessage(fauxToolCall("read_file", { path: "alpha.txt" }, { id: "call_child_read" }), {
            stopReason: "toolUse",
          });
        }
        return fauxAssistantMessage("alpha inspected by background agent");
      }

      if (messagesText.includes("Blip runtime delivered completed agent results")) {
        sawDeliveredResults = true;
        expect(messagesText).toContain("alpha inspected by background agent");
        expect(messagesText).toContain("Full details remain available with agent collect runId");
        return fauxAssistantMessage("parent used delivered results");
      }

      parentWaitCount += 1;
      return fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 0.1" }, { id: `call_parent_wait_${parentWaitCount}` }), {
        stopReason: "toolUse",
      });
    };

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "inspect alpha in background", authority: "read_only", context: "none" }] }, { id: "call_agents_start" }), {
        stopReason: "toolUse",
      }),
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Start an agent and use auto-delivered results",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "local-trusted-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    expect(sawDeliveredResults).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent_results_delivered",
        status: "completed",
        agentCount: 1,
        message: expect.stringContaining("alpha inspected by background agent"),
      }),
    );
    expect(events.filter((event) => event.type === "tool_call_completed" && event.tool === "agent")).toHaveLength(1);
    faux.unregister();
  });

  test("removes completed non-blocking agent runs from implicit collect lookup", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    let parentStep = 0;

    const routeResponse = (context: any) => {
      const toolNames = new Set((context.tools ?? []).map((tool: any) => tool.name));
      const messagesText = (context.messages ?? [])
        .map((message: any) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      const isParent = toolNames.has("agent");

      if (!isParent) {
        return fauxAssistantMessage(messagesText.includes("inspect first") ? "first background result" : "second background result");
      }

      parentStep += 1;
      if (parentStep === 1) {
        return fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "inspect first", authority: "read_only", context: "none" }] }, { id: "call_agents_start_1" }), {
          stopReason: "toolUse",
        });
      }
      if (parentStep === 2) {
        return fauxAssistantMessage(fauxToolCall("agent", { action: "collect", wait: true }, { id: "call_agents_collect_1" }), {
          stopReason: "toolUse",
        });
      }
      if (parentStep === 3) {
        return fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "inspect second", authority: "read_only", context: "none" }] }, { id: "call_agents_start_2" }), {
          stopReason: "toolUse",
        });
      }
      if (parentStep === 4) {
        return fauxAssistantMessage(fauxToolCall("agent", { action: "collect", wait: true }, { id: "call_agents_collect_2" }), {
          stopReason: "toolUse",
        });
      }
      return fauxAssistantMessage("parent collected both");
    };

    faux.setResponses([
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
      routeResponse,
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Start, collect, then start and collect another agent",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    const agentCompletions = events.filter((event) => event.type === "tool_call_completed" && event.tool === "agent");
    expect(agentCompletions.map((event) => event.result.status)).toEqual(["running", "completed", "running", "completed"]);
    expect(agentCompletions[1].result.agents[0].result.message).toBe("first background result");
    expect(agentCompletions[3].result.agents[0].result.message).toBe("second background result");
    faux.unregister();
  });

  test("reports agent run summaries as error when any agent fails", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: true, agents: [{ task: "fail in agent", authority: "read_only", context: "none" }] }, { id: "call_agents" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "nested agent failed" }),
      fauxAssistantMessage("parent saw agent error"),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Run a failing agent",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    const agentCompletion = events.find((event) => event.type === "tool_call_completed" && event.tool === "agent");
    expect(agentCompletion.result.status).toBe("error");
    expect(agentCompletion.result.agents[0].result.status).toBe("error");
    expect(agentCompletion.result.agents[0].result.error).toBe("nested agent failed");
    faux.unregister();
  });

  test("cancels queued non-blocking agents", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("agent", { action: "run", wait: false, agents: [{ task: "do cancellable work", authority: "read_only", context: "none" }] }, { id: "call_agents_start" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("agent", { action: "cancel" }, { id: "call_agents_cancel" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("parent saw cancellation"),
    ]);

    const events: any[] = [];
    await runBlipTask(
      {
        prompt: "Start an agent and cancel it",
        workspaceRoot: workspace,
        provider: "faux",
        model: faux.getModel().id,
        permissionMode: "workspace-write",
        toolProfile: "no-shell-workspace-write",
        agentsEnabled: true,
      },
      (event) => events.push(event),
    );

    const agentCompletions = events.filter((event) => event.type === "tool_call_completed" && event.tool === "agent");
    expect(agentCompletions[0].result.status).toBe("running");
    expect(agentCompletions[1].result.status).toBe("cancelled");
    expect(agentCompletions[1].result.agents[0].result.status).toBe("cancelled");
    expect(agentCompletions[1].result.agents[0].result.message).toContain("cancelled");
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
      {
        type: "message" as const,
        id: "u1",
        timestamp: new Date().toISOString(),
        message: user("old " + "x".repeat(10_000)),
      },
      { type: "message" as const, id: "a1", timestamp: new Date().toISOString(), message: first },
      {
        type: "message" as const,
        id: "u2",
        timestamp: new Date().toISOString(),
        message: user("middle"),
      },
      { type: "message" as const, id: "a2", timestamp: new Date().toISOString(), message: second },
      {
        type: "message" as const,
        id: "u3",
        timestamp: new Date().toISOString(),
        message: user("tail"),
      },
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
