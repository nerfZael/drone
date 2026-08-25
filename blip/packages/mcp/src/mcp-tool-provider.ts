import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { BlipSessionContext, BlipToolProvider } from "@blip/core";

export interface McpToolDescription {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolClient {
  listTools(): Promise<{ tools: McpToolDescription[] }>;
  callTool(input: { name: string; arguments?: Record<string, unknown> }): Promise<any>;
}

export interface McpToolProviderOptions {
  id: string;
  client: McpToolClient;
  namePrefix?: string;
  promptGuidance?: string;
  correlation?: (context: BlipSessionContext) => Record<string, unknown>;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function resultText(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter((item: any) => item?.type === "text")
    .map((item: any) => String(item.text ?? ""))
    .filter(Boolean)
    .join("\n");
}

function agentResult(result: any): AgentToolResult<unknown> {
  const content = (Array.isArray(result?.content) ? result.content : []).flatMap((item: any) => {
    if (item?.type === "text") return [{ type: "text" as const, text: String(item.text ?? "") }];
    if (item?.type === "image" && item.data && item.mimeType) {
      return [{ type: "image" as const, data: String(item.data), mimeType: String(item.mimeType) }];
    }
    return [];
  });
  if (result?.isError) throw new Error(resultText(result) || "MCP tool failed");
  return {
    content: content.length > 0 ? content : [{ type: "text", text: JSON.stringify(result?.structuredContent ?? result ?? null) }],
    details: result?.structuredContent ?? result?._meta ?? result,
  };
}

export class McpToolProvider implements BlipToolProvider {
  readonly id: string;

  constructor(private readonly options: McpToolProviderOptions) {
    this.id = options.id;
  }

  async load(context: BlipSessionContext): Promise<AgentTool<any>[]> {
    const catalog = await this.options.client.listTools();
    const prefix = safeName(this.options.namePrefix ?? this.options.id);
    return catalog.tools.map((tool) => ({
      name: `${prefix}__${safeName(tool.name)}`,
      label: tool.title ?? tool.name,
      description: tool.description ?? `MCP tool ${tool.name}`,
      parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as any,
      execute: async (_callId: string, rawArgs: unknown) => {
        const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
          ? rawArgs as Record<string, unknown>
          : {};
        const correlation = this.options.correlation?.(context) ?? {};
        const result = await this.options.client.callTool({
          name: tool.name,
          arguments: {
            ...args,
            _blip: { sessionId: context.session.id, toolCallId: _callId, ...correlation },
          },
        });
        return agentResult(result);
      },
    }));
  }

  promptSections(): string[] {
    return this.options.promptGuidance?.trim() ? [this.options.promptGuidance.trim()] : [];
  }
}

export function createMcpToolProvider(options: McpToolProviderOptions): BlipToolProvider {
  return new McpToolProvider(options);
}
