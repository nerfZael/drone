import { describe, expect, test } from "bun:test";
import { createMcpToolProvider, type McpToolClient } from "../src/index";

describe("MCP tool provider", () => {
  test("qualifies tools and preserves structured results and correlation", async () => {
    const calls: any[] = [];
    const client: McpToolClient = {
      async listTools() {
        return {
          tools: [{ name: "list_drones", description: "List drones", inputSchema: { type: "object", properties: {} } }],
        };
      },
      async callTool(input) {
        calls.push(input);
        return {
          content: [{ type: "text", text: "one drone" }],
          structuredContent: { ok: true, drones: [{ id: "one" }] },
        };
      },
    };
    const provider = createMcpToolProvider({ id: "drone-hub", client });
    const tools = await provider.load({
      session: { id: "session-one" } as any,
      repository: {} as any,
      model: {} as any,
      workspaceRoot: "/workspace",
      permissionMode: "workspace-write",
      toolProfile: "no-shell-workspace-write",
    });
    const result = await tools[0]!.execute("call", {} as never);

    expect(tools[0]!.name).toBe("drone-hub__list_drones");
    expect(calls).toEqual([{ name: "list_drones", arguments: { _blip: { sessionId: "session-one" } } }]);
    expect(result.details).toEqual({ ok: true, drones: [{ id: "one" }] });
  });

  test("turns MCP error results into tool failures", async () => {
    const provider = createMcpToolProvider({
      id: "test",
      client: {
        async listTools() {
          return { tools: [{ name: "fail", inputSchema: { type: "object" } }] };
        },
        async callTool() {
          return { isError: true, content: [{ type: "text", text: "denied" }] };
        },
      },
    });
    const [tool] = await provider.load({ session: { id: "s" } as any } as any);
    await expect(tool!.execute("call", {} as never)).rejects.toThrow("denied");
  });
});
