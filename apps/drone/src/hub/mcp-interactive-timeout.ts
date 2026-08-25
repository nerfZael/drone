/**
 * Interactive MCP tools can intentionally wait while a person considers a response.
 * Keep this finite so abandoned calls eventually clean themselves up, but well beyond
 * the SDK and agent-client defaults used for ordinary tool calls.
 */
export const INTERACTIVE_MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const INTERACTIVE_MCP_TOOL_TIMEOUT_SECONDS = INTERACTIVE_MCP_TOOL_TIMEOUT_MS / 1_000;

export function isInteractiveMcpTool(name: string): boolean {
  return name === 'ask_questions';
}
