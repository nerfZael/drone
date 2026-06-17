import type { AgentToolResult } from "@mariozechner/pi-agent-core";

export function textResult<TDetails>(text: string, details: TDetails, terminate?: boolean): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
    ...(terminate === undefined ? {} : { terminate }),
  };
}
