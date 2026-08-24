export type McpAgentId = 'codex' | 'cursor' | 'claude' | 'opencode';
export type McpTransport = 'stdio' | 'http';

export type McpServerRecord = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  agents: McpAgentId[];
  createdAt: string;
  updatedAt: string;
};

export type McpServerToolSummary = {
  name: string;
  title?: string;
  description?: string;
};

export type McpServerDraft = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  envJson: string;
  headersJson: string;
  agents: McpAgentId[];
};

export type McpServerDraftScalarKey = Exclude<keyof McpServerDraft, 'id' | 'agents'>;

export const MCP_AGENT_OPTIONS: Array<{ id: McpAgentId; label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'opencode', label: 'OpenCode' },
];

function stringifyJson(value: unknown): string {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) return '';
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(value: string, label: string): Record<string, string> | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  const out: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    const k = String(key ?? '').trim();
    const v = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createEmptyMcpServerDraft(): McpServerDraft {
  return {
    id: null,
    name: '',
    description: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    argsText: '',
    url: '',
    envJson: '',
    headersJson: '',
    agents: ['codex', 'cursor', 'claude', 'opencode'],
  };
}

export function draftFromMcpServer(server: McpServerRecord): McpServerDraft {
  return {
    id: server.id,
    name: server.name,
    description: server.description ?? '',
    enabled: server.enabled !== false,
    transport: server.transport,
    command: server.command ?? '',
    argsText: Array.isArray(server.args) ? server.args.join('\n') : '',
    url: server.url ?? '',
    envJson: stringifyJson(server.env),
    headersJson: stringifyJson(server.headers),
    agents: Array.isArray(server.agents) && server.agents.length > 0 ? server.agents : ['codex', 'cursor', 'claude', 'opencode'],
  };
}

export function sanitizeMcpDraftForComparison(draft: McpServerDraft): string {
  return JSON.stringify(draft);
}

export function sortMcpServers(servers: McpServerRecord[]): McpServerRecord[] {
  return [...servers].sort((a, b) => a.name.localeCompare(b.name));
}

export function payloadFromMcpDraft(draft: McpServerDraft): Record<string, unknown> {
  const env = parseJsonObject(draft.envJson, 'Environment');
  const headers = parseJsonObject(draft.headersJson, 'Headers');
  const args = draft.argsText
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    enabled: draft.enabled,
    transport: draft.transport,
    command: draft.transport === 'stdio' ? draft.command.trim() : undefined,
    args: draft.transport === 'stdio' && args.length > 0 ? args : undefined,
    url: draft.transport === 'http' ? draft.url.trim() : undefined,
    env,
    headers: draft.transport === 'http' ? headers : undefined,
    agents: draft.agents,
  };
}
