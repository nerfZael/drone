import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import { createProfileTools } from "@blip/tools";
import {
  createBlipSession,
  SessionStore,
  type BlipRuntimeEvent,
} from "../src/index";

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "blip-embedded-"));
}

function userText(message: AgentMessage | undefined): string {
  if (message?.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("\n");
}

describe("Embedded Blip session", () => {
  test("stays alive across prompts, preserves images, and can delete its session", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: "faux-embedded-session",
      provider: "faux-embedded-session",
      tokensPerSecond: 0,
    });
    const observed: Array<{ systemPrompt: string; lastUser: AgentMessage | undefined }> = [];
    faux.setResponses([
      (context) => {
        observed.push({
          systemPrompt: context.systemPrompt,
          lastUser: context.messages.filter((message) => message.role === "user").at(-1),
        });
        return fauxAssistantMessage("first response");
      },
      (context) => {
        observed.push({
          systemPrompt: context.systemPrompt,
          lastUser: context.messages.filter((message) => message.role === "user").at(-1),
        });
        return fauxAssistantMessage("second response");
      },
      fauxAssistantMessage("embedded summary"),
    ]);
    const events: BlipRuntimeEvent[] = [];
    const repository = new SessionStore(workspace);
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
      sessionRepository: repository,
      promptProvider: () => "Injected host prompt",
      eventSink: (event) => events.push(event),
    });

    const firstId = (await session.prompt("first prompt")).id;
    const secondState = await session.prompt({
      text: "second prompt",
      images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    });

    expect(secondState.id).toBe(firstId);
    expect(events.filter((event) => event.type === "session_started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "session_finished")).toHaveLength(2);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
    expect(events.filter((event) => event.type === "transcript_changed" && event.role === "assistant")).toHaveLength(2);
    expect(observed.map((item) => item.systemPrompt)).toEqual([
      "Injected host prompt",
      "Injected host prompt",
    ]);
    const imagePrompt = observed[1]?.lastUser;
    expect(Array.isArray(imagePrompt?.content) ? imagePrompt.content : []).toContainEqual({
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
    });
    const messages = await repository.readMessages(secondState);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(2);
    await session.compact({
      auto: true,
      reserveTokens: 10,
      keepRecentTokens: 1,
      keepRecentTurns: 1,
    });
    expect(events.some((event) => event.type === "compaction_completed")).toBe(true);
    await session.delete();
    expect(await repository.exists(secondState.id)).toBe(false);
    faux.unregister();
  });

  test("processes steering before queued follow-up prompts", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: "faux-embedded-queue",
      provider: "faux-embedded-queue",
      tokensPerSecond: 0,
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFirst = () => {};
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const latestUserPrompts: string[] = [];
    const captureLatestUser = (context: { messages: AgentMessage[] }) => {
      latestUserPrompts.push(
        userText(context.messages.filter((message) => message.role === "user").at(-1)),
      );
    };
    faux.setResponses([
      async (context) => {
        captureLatestUser(context);
        signalStarted();
        await firstReleased;
        return fauxAssistantMessage("initial response");
      },
      (context) => {
        captureLatestUser(context);
        return fauxAssistantMessage("steered response");
      },
      (context) => {
        captureLatestUser(context);
        return fauxAssistantMessage("queued response");
      },
    ]);
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
      sessionRepository: new SessionStore(workspace),
      eventSink: (event) => events.push(event),
    });

    const running = session.prompt("initial prompt");
    await started;
    session.steer("urgent steering");
    const queued = session.enqueue("queued follow-up");
    releaseFirst();
    await Promise.all([running, queued]);

    expect(latestUserPrompts).toEqual([
      "initial prompt",
      "urgent steering",
      "queued follow-up",
    ]);
    expect(events.filter((event) => event.type === "turn_started")).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "turn_started" && event.prompt !== undefined),
    ).toHaveLength(1);
    session.close();
    faux.unregister();
  });

  test("loads tools and blocks validated calls through host preflight", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "secret.txt"), "secret\n");
    const faux = registerFauxProvider({
      api: "faux-embedded-policy",
      provider: "faux-embedded-policy",
      tokensPerSecond: 0,
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "secret.txt" }, { id: "call_blocked" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The read was blocked."),
    ]);
    const preflightCalls: Array<{ tool: string; callId: string; args: unknown }> = [];
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: "read-only",
      toolProfile: "read-only",
      sessionRepository: new SessionStore(workspace),
      toolProviders: [
        {
          id: "workspace",
          load: () =>
            createProfileTools({
              workspaceRoot: workspace,
              permissionMode: "read-only",
              profile: "read-only",
            }),
        },
      ],
      permissionPreflight(request) {
        preflightCalls.push({ tool: request.tool, callId: request.callId, args: request.args });
        return { status: "deny", reason: "Denied by host policy" };
      },
      eventSink: (event) => events.push(event),
    });

    await session.prompt("Read the secret");

    expect(preflightCalls).toEqual([
      { tool: "read_file", callId: "call_blocked", args: { path: "secret.txt" } },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call_failed",
        callId: "call_blocked",
        tool: "read_file",
        error: "Denied by host policy",
      }),
    );
    session.close();
    faux.unregister();
  });

  test("finishes an aborted prompt with cancelled status", async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: "faux-embedded-cancel",
      provider: "faux-embedded-cancel",
      tokensPerSecond: 0,
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    faux.setResponses([
      async () => {
        signalStarted();
        await released;
        return fauxAssistantMessage("response that should be aborted");
      },
    ]);
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
      sessionRepository: new SessionStore(workspace),
      eventSink: (event) => events.push(event),
    });

    const running = session.prompt("cancel this");
    await started;
    session.abort();
    release();
    await running;

    expect(events).toContainEqual(
      expect.objectContaining({ type: "session_finished", status: "cancelled" }),
    );
    session.close();
    faux.unregister();
  });
});
