import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DroneRegistry } from '../host/registry';
import { loadRegistry, updateRegistry } from '../host/registry';
import { bashQuote } from './hub-format';

const MCP_MANIFEST = '.drone-managed-mcp.json';
const CODEX_MANAGED_START = '# drone-hub-managed-mcp-start';
const CODEX_MANAGED_END = '# drone-hub-managed-mcp-end';

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

export type McpProjectionTarget = {
  agent: McpAgentId;
  configPath: string;
};

type ManifestShape = {
  managedNames: string[];
};

async function loadDvmHelpers(): Promise<{
  dvmCopyToContainer: (container: string, srcPath: string, destPath: string, opts?: { clean?: boolean; timeoutMs?: number }) => Promise<void>;
  dvmExec: (container: string, cmd: string, args?: string[], opts?: { timeoutMs?: number }) => Promise<{ stdout?: string; stderr?: string }>;
}> {
  const mod = await import('../host/dvm');
  return {
    dvmCopyToContainer: mod.dvmCopyToContainer,
    dvmExec: mod.dvmExec,
  };
}

function normalizeOptionalString(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text || undefined;
}

function normalizeRequiredString(raw: unknown, label: string): string {
  const text = normalizeOptionalString(raw);
  if (!text) throw new Error(`missing ${label}`);
  return text;
}

export function normalizeMcpServerName(raw: unknown): string {
  const text = normalizeRequiredString(raw, 'name');
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error('invalid MCP server name (use letters, numbers, underscore, or hyphen)');
  }
  return text;
}

function normalizeTransport(raw: unknown, fallback?: McpTransport): McpTransport {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'stdio' || value === 'http') return value;
  return fallback ?? 'stdio';
}

function normalizeAgents(raw: unknown, fallback?: McpAgentId[]): McpAgentId[] {
  const values = Array.isArray(raw) ? raw : fallback ?? ['codex', 'cursor', 'claude', 'opencode'];
  const out: McpAgentId[] = [];
  for (const value of values) {
    const agent = String(value ?? '').trim().toLowerCase();
    if (agent === 'codex' || agent === 'cursor' || agent === 'claude' || agent === 'opencode') {
      if (!out.includes(agent)) out.push(agent);
    }
  }
  return out.length > 0 ? out : ['codex', 'cursor', 'claude', 'opencode'];
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map((value) => String(value ?? '').trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function normalizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key ?? '').trim();
    if (!k) continue;
    const v = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!v) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeStoredMcpServer(raw: unknown, fallbackId?: string): McpServerRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as any;
  const id = normalizeOptionalString(record.id) || normalizeOptionalString(fallbackId) || crypto.randomUUID();
  const name = normalizeOptionalString(record.name);
  if (!name) return null;
  const transport = normalizeTransport(record.transport);
  return {
    id,
    name: normalizeMcpServerName(name),
    ...(normalizeOptionalString(record.description) ? { description: normalizeOptionalString(record.description) } : {}),
    enabled: record.enabled !== false,
    transport,
    ...(normalizeOptionalString(record.command) ? { command: normalizeOptionalString(record.command) } : {}),
    ...(normalizeStringArray(record.args) ? { args: normalizeStringArray(record.args) } : {}),
    ...(normalizeOptionalString(record.url) ? { url: normalizeOptionalString(record.url) } : {}),
    ...(normalizeStringMap(record.env) ? { env: normalizeStringMap(record.env) } : {}),
    ...(normalizeStringMap(record.headers) ? { headers: normalizeStringMap(record.headers) } : {}),
    agents: normalizeAgents(record.agents),
    createdAt: normalizeOptionalString(record.createdAt) || new Date().toISOString(),
    updatedAt: normalizeOptionalString(record.updatedAt) || normalizeOptionalString(record.createdAt) || new Date().toISOString(),
  };
}

function normalizeIncomingMcpServer(input: any, existing?: McpServerRecord): McpServerRecord {
  const transport = normalizeTransport(input?.transport, existing?.transport);
  const record: McpServerRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    name: normalizeMcpServerName(input?.name ?? existing?.name),
    ...(normalizeOptionalString(input?.description ?? existing?.description)
      ? { description: normalizeOptionalString(input?.description ?? existing?.description) }
      : {}),
    enabled:
      input && Object.prototype.hasOwnProperty.call(input, 'enabled')
        ? input.enabled !== false
        : existing?.enabled ?? true,
    transport,
    ...(normalizeOptionalString(input?.command ?? existing?.command) ? { command: normalizeOptionalString(input?.command ?? existing?.command) } : {}),
    ...(input && Object.prototype.hasOwnProperty.call(input, 'args')
      ? normalizeStringArray(input.args)
        ? { args: normalizeStringArray(input.args) }
        : {}
      : existing?.args
        ? { args: existing.args }
        : {}),
    ...(normalizeOptionalString(input?.url ?? existing?.url) ? { url: normalizeOptionalString(input?.url ?? existing?.url) } : {}),
    ...(input && Object.prototype.hasOwnProperty.call(input, 'env')
      ? normalizeStringMap(input.env)
        ? { env: normalizeStringMap(input.env) }
        : {}
      : existing?.env
        ? { env: existing.env }
        : {}),
    ...(input && Object.prototype.hasOwnProperty.call(input, 'headers')
      ? normalizeStringMap(input.headers)
        ? { headers: normalizeStringMap(input.headers) }
        : {}
      : existing?.headers
        ? { headers: existing.headers }
        : {}),
    agents: normalizeAgents(input?.agents, existing?.agents),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (transport === 'stdio' && !record.command) throw new Error('missing command for stdio MCP server');
  if (transport === 'http' && !record.url) throw new Error('missing url for HTTP MCP server');
  if (transport === 'stdio') {
    delete record.url;
    delete record.headers;
  } else {
    delete record.command;
    delete record.args;
    delete record.env;
  }
  return record;
}

function assertMcpNameAvailable(servers: McpServerRecord[], name: string, selfId?: string): void {
  const conflict = servers.find((server) => server.name === name && server.id !== selfId);
  if (conflict) throw new Error(`MCP server name already exists: ${name}`);
}

export function listMcpServersFromRegistry(reg: DroneRegistry | Record<string, unknown>): McpServerRecord[] {
  const rawServers = (reg as any)?.mcpServers;
  if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) return [];
  const out: McpServerRecord[] = [];
  const seenNames = new Set<string>();
  for (const [id, value] of Object.entries(rawServers)) {
    const server = normalizeStoredMcpServer(value, id);
    if (!server) continue;
    if (seenNames.has(server.name)) continue;
    seenNames.add(server.name);
    out.push(server);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
  const reg = await loadRegistry();
  return listMcpServersFromRegistry(reg);
}

export async function getMcpServerById(idRaw: string): Promise<McpServerRecord | null> {
  const id = String(idRaw ?? '').trim();
  if (!id) return null;
  const reg = await loadRegistry();
  return listMcpServersFromRegistry(reg).find((server) => server.id === id) ?? null;
}

export async function createMcpServer(input: any): Promise<McpServerRecord> {
  const current = await listMcpServers();
  const record = normalizeIncomingMcpServer(input);
  assertMcpNameAvailable(current, record.name);
  await updateRegistry((reg: any) => {
    reg.mcpServers = reg.mcpServers ?? {};
    reg.mcpServers[record.id] = record;
  });
  return record;
}

export async function updateMcpServerRecord(idRaw: string, input: any): Promise<McpServerRecord> {
  const id = String(idRaw ?? '').trim();
  if (!id) throw new Error('missing MCP server id');
  const current = await listMcpServers();
  const existing = current.find((server) => server.id === id);
  if (!existing) throw new Error(`unknown MCP server: ${id}`);
  const record = normalizeIncomingMcpServer(input, existing);
  assertMcpNameAvailable(current, record.name, id);
  await updateRegistry((reg: any) => {
    reg.mcpServers = reg.mcpServers ?? {};
    reg.mcpServers[id] = record;
  });
  return record;
}

export async function deleteMcpServerRecord(idRaw: string): Promise<boolean> {
  const id = String(idRaw ?? '').trim();
  if (!id) return false;
  return await updateRegistry((reg: any) => {
    if (!reg?.mcpServers?.[id]) return false;
    delete reg.mcpServers[id];
    if (Object.keys(reg.mcpServers).length === 0) delete reg.mcpServers;
    return true;
  });
}

function activeServersForAgent(servers: McpServerRecord[], agent: McpAgentId): McpServerRecord[] {
  return servers.filter((server) => server.enabled && server.agents.includes(agent));
}

function manifestPath(configPath: string): string {
  return path.join(path.dirname(configPath), MCP_MANIFEST);
}

function manifestPathPosix(configPath: string): string {
  return path.posix.join(path.posix.dirname(configPath), MCP_MANIFEST);
}

async function readJsonFile(filePath: string): Promise<any> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function readManifestFromHost(configPath: string): Promise<ManifestShape> {
  const parsed = await readJsonFile(manifestPath(configPath));
  const managedNames = Array.isArray(parsed?.managedNames) ? parsed.managedNames.map((value: unknown) => String(value ?? '').trim()).filter(Boolean) : [];
  return { managedNames };
}

async function writeManifestToHost(configPath: string, manifest: ManifestShape): Promise<void> {
  await fs.writeFile(manifestPath(configPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function readTextFromHost(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function stripManagedTomlBlock(raw: string): string {
  const lines = String(raw ?? '').split(/\r?\n/);
  const out: string[] = [];
  let managed = false;
  for (const line of lines) {
    if (line.trim() === CODEX_MANAGED_START) {
      managed = true;
      continue;
    }
    if (line.trim() === CODEX_MANAGED_END) {
      managed = false;
      continue;
    }
    if (!managed) out.push(line);
  }
  return out.join('\n').replace(/\s+$/g, '');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`);
  return `{ ${entries.join(', ')} }`;
}

function envPlaceholderName(value: string): string | null {
  const match = String(value ?? '').trim().match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return match?.[1] ?? null;
}

function splitHeaderValues(headers: Record<string, string> | undefined): {
  staticHeaders: Record<string, string>;
  envHeaders: Record<string, string>;
} {
  const staticHeaders: Record<string, string> = {};
  const envHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const envName = envPlaceholderName(value);
    if (envName) envHeaders[key] = envName;
    else staticHeaders[key] = value;
  }
  return { staticHeaders, envHeaders };
}

function renderCodexMcpBlock(servers: McpServerRecord[]): string {
  if (servers.length === 0) return '';
  const lines = [CODEX_MANAGED_START, '# Managed by Drone Hub. Edit MCP servers in Drone Hub settings.'];
  for (const server of servers) {
    lines.push('', `[mcp_servers.${server.name}]`);
    if (server.transport === 'http') {
      lines.push(`url = ${tomlString(server.url ?? '')}`);
      const { staticHeaders, envHeaders } = splitHeaderValues(server.headers);
      if (Object.keys(staticHeaders).length > 0) lines.push(`http_headers = ${tomlInlineTable(staticHeaders)}`);
      if (Object.keys(envHeaders).length > 0) lines.push(`env_http_headers = ${tomlInlineTable(envHeaders)}`);
    } else {
      lines.push(`command = ${tomlString(server.command ?? '')}`);
      if (server.args && server.args.length > 0) lines.push(`args = ${tomlStringArray(server.args)}`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      lines.push(`env = ${tomlInlineTable(server.env)}`);
    }
  }
  lines.push(CODEX_MANAGED_END);
  return lines.join('\n');
}

function renderJsonMcpServer(agent: McpAgentId, server: McpServerRecord): any {
  if (agent === 'opencode') {
    if (server.transport === 'http') {
      return {
        type: 'remote',
        url: server.url ?? '',
        enabled: true,
        ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
      };
    }
    return {
      type: 'local',
      command: [server.command ?? '', ...(server.args ?? [])],
      enabled: true,
      ...(server.env && Object.keys(server.env).length > 0 ? { environment: server.env } : {}),
    };
  }
  if (server.transport === 'http') {
    return {
      ...(agent === 'claude' ? { type: 'http' } : {}),
      url: server.url ?? '',
      ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
    };
  }
  return {
    ...(agent === 'claude' ? { type: 'stdio' } : {}),
    command: server.command ?? '',
    ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
    ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
  };
}

function jsonRootKey(agent: McpAgentId): 'mcpServers' | 'mcp' {
  return agent === 'opencode' ? 'mcp' : 'mcpServers';
}

function mergeJsonMcpConfig(agent: McpAgentId, existing: any, manifest: ManifestShape, servers: McpServerRecord[]): any {
  const config = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  if (agent === 'opencode' && !config.$schema) config.$schema = 'https://opencode.ai/config.json';
  const rootKey = jsonRootKey(agent);
  const root = config[rootKey] && typeof config[rootKey] === 'object' && !Array.isArray(config[rootKey]) ? { ...config[rootKey] } : {};
  for (const name of manifest.managedNames) delete root[name];
  for (const server of servers) root[server.name] = renderJsonMcpServer(agent, server);
  config[rootKey] = root;
  return config;
}

async function writeCodexTargetToHost(target: McpProjectionTarget, servers: McpServerRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(target.configPath), { recursive: true });
  const existing = await readTextFromHost(target.configPath);
  const base = stripManagedTomlBlock(existing);
  const block = renderCodexMcpBlock(servers);
  const next = `${[base, block].filter(Boolean).join('\n\n')}\n`;
  await fs.writeFile(target.configPath, next, 'utf8');
  await writeManifestToHost(target.configPath, { managedNames: servers.map((server) => server.name).sort() });
}

async function writeJsonTargetToHost(target: McpProjectionTarget, servers: McpServerRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(target.configPath), { recursive: true });
  const existing = await readJsonFile(target.configPath);
  const manifest = await readManifestFromHost(target.configPath);
  const next = mergeJsonMcpConfig(target.agent, existing, manifest, servers);
  await fs.writeFile(target.configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await writeManifestToHost(target.configPath, { managedNames: servers.map((server) => server.name).sort() });
}

async function writeTargetToHost(target: McpProjectionTarget, servers: McpServerRecord[]): Promise<void> {
  if (target.agent === 'codex') {
    await writeCodexTargetToHost(target, servers);
    return;
  }
  await writeJsonTargetToHost(target, servers);
}

export async function syncMcpServersToHostTargets(opts: { targets: McpProjectionTarget[]; servers?: McpServerRecord[] }): Promise<void> {
  const servers = Array.isArray(opts.servers) ? opts.servers : await listMcpServers();
  for (const target of opts.targets) {
    const configPath = String(target.configPath ?? '').trim();
    if (!configPath) continue;
    await writeTargetToHost(target, activeServersForAgent(servers, target.agent));
  }
}

async function readTextFromContainer(containerName: string, filePath: string): Promise<string> {
  const { dvmExec } = await loadDvmHelpers();
  const read = await dvmExec(containerName, 'bash', ['-lc', `cat ${bashQuote(filePath)} 2>/dev/null || true`]);
  return String(read.stdout ?? '');
}

async function readJsonFromContainer(containerName: string, filePath: string): Promise<any> {
  const raw = await readTextFromContainer(containerName, filePath);
  return raw.trim() ? JSON.parse(raw) : {};
}

async function readManifestFromContainer(containerName: string, configPath: string): Promise<ManifestShape> {
  const parsed = await readJsonFromContainer(containerName, manifestPathPosix(configPath));
  const managedNames = Array.isArray(parsed?.managedNames) ? parsed.managedNames.map((value: unknown) => String(value ?? '').trim()).filter(Boolean) : [];
  return { managedNames };
}

async function copyTextToContainer(containerName: string, destPath: string, content: string): Promise<void> {
  const { dvmCopyToContainer, dvmExec } = await loadDvmHelpers();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mcp-sync-'));
  try {
    const localPath = path.join(tempRoot, path.basename(destPath));
    await fs.writeFile(localPath, content, 'utf8');
    await dvmExec(containerName, 'bash', ['-lc', `mkdir -p ${bashQuote(path.posix.dirname(destPath))}`]);
    await dvmCopyToContainer(containerName, localPath, destPath, { clean: false });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeCodexTargetToContainer(containerName: string, target: McpProjectionTarget, servers: McpServerRecord[]): Promise<void> {
  const existing = await readTextFromContainer(containerName, target.configPath);
  const base = stripManagedTomlBlock(existing);
  const block = renderCodexMcpBlock(servers);
  const next = `${[base, block].filter(Boolean).join('\n\n')}\n`;
  await copyTextToContainer(containerName, target.configPath, next);
  await copyTextToContainer(containerName, manifestPathPosix(target.configPath), `${JSON.stringify({ managedNames: servers.map((server) => server.name).sort() }, null, 2)}\n`);
}

async function writeJsonTargetToContainer(containerName: string, target: McpProjectionTarget, servers: McpServerRecord[]): Promise<void> {
  const existing = await readJsonFromContainer(containerName, target.configPath);
  const manifest = await readManifestFromContainer(containerName, target.configPath);
  const next = mergeJsonMcpConfig(target.agent, existing, manifest, servers);
  await copyTextToContainer(containerName, target.configPath, `${JSON.stringify(next, null, 2)}\n`);
  await copyTextToContainer(containerName, manifestPathPosix(target.configPath), `${JSON.stringify({ managedNames: servers.map((server) => server.name).sort() }, null, 2)}\n`);
}

async function writeTargetToContainer(containerName: string, target: McpProjectionTarget, servers: McpServerRecord[]): Promise<void> {
  if (target.agent === 'codex') {
    await writeCodexTargetToContainer(containerName, target, servers);
    return;
  }
  await writeJsonTargetToContainer(containerName, target, servers);
}

export async function syncMcpServersToContainerTargets(opts: {
  containerName: string;
  targets: McpProjectionTarget[];
  servers?: McpServerRecord[];
}): Promise<void> {
  const containerName = String(opts.containerName ?? '').trim();
  if (!containerName) throw new Error('missing container name');
  const servers = Array.isArray(opts.servers) ? opts.servers : await listMcpServers();
  for (const target of opts.targets) {
    const configPath = String(target.configPath ?? '').trim();
    if (!configPath) continue;
    await writeTargetToContainer(containerName, target, activeServersForAgent(servers, target.agent));
  }
}
