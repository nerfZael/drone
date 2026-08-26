import path from 'node:path';

export type HubRunnerProcess = {
  pid: number;
  uiPort: number | null;
  args: string;
};

export type HubUiServerProcess = {
  pid: number;
  uiPort: number | null;
  args: string;
};

export type HubRunnerLaunchOptions = {
  uiPort: number | null;
  apiPort: number | null;
  apiHost: string | null;
  containerMcpHost: string | null;
  containerMcpPort: number | null;
  containerMcpUrl: string | null;
};

function parsePositiveIntegerOption(args: string, option: string): number | null {
  const escapedOption = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(args ?? '').match(new RegExp(`(?:^|\\s)${escapedOption}(?:=|\\s+)(\\d+)(?=\\s|$)`));
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isFinite(port) || port <= 0) return null;
  return Math.floor(port);
}

function parseStringOption(args: string, option: string): string | null {
  const escapedOption = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(args ?? '').match(new RegExp(`(?:^|\\s)${escapedOption}(?:=|\\s+)([^\\s]+)(?=\\s|$)`));
  const value = String(match?.[1] ?? '').trim();
  return value || null;
}

export function parseHubRunnerLaunchOptions(args: string): HubRunnerLaunchOptions {
  return {
    uiPort: parsePositiveIntegerOption(args, '--port'),
    apiPort: parsePositiveIntegerOption(args, '--api-port'),
    apiHost: parseStringOption(args, '--host'),
    containerMcpHost: parseStringOption(args, '--container-mcp-host'),
    containerMcpPort: parsePositiveIntegerOption(args, '--container-mcp-port'),
    containerMcpUrl: parseStringOption(args, '--container-mcp-url'),
  };
}

export function parseHubRunnerProcessesFromPsOutput(
  psOutputRaw: string,
  opts: { cliPath: string; selfPid?: number }
): HubRunnerProcess[] {
  const cliPath = String(opts.cliPath ?? '').trim();
  const cliParts = cliPath ? cliPath.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/').split('/').filter(Boolean) : [];
  const cliSuffix = cliParts.length > 0 ? cliParts.join('/') : '';
  const relativeCliSuffix = cliParts.length >= 4 ? cliParts.slice(-4).join('/') : cliSuffix;
  const selfPid = Number(opts.selfPid ?? 0);
  if (!cliPath) return [];

  const out: HubRunnerProcess[] = [];
  const lines = String(psOutputRaw ?? '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine ?? '').trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = String(match[2] ?? '').trim();
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (selfPid > 0 && pid === selfPid) continue;
    const normalizedArgs = args.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/');
    const hasCliPath =
      normalizedArgs.includes(cliPath) ||
      (cliSuffix ? normalizedArgs.includes(cliSuffix) : false) ||
      (relativeCliSuffix ? normalizedArgs.includes(relativeCliSuffix) : false);
    if (!hasCliPath) continue;
    if (!/\bhub\s+run\b/.test(args)) continue;
    out.push({
      pid: Math.floor(pid),
      uiPort: parseHubRunnerLaunchOptions(args).uiPort,
      args,
    });
  }
  return out;
}

export function parseHubUiServerProcessesFromPsOutput(
  psOutputRaw: string,
  opts: { repoRoot: string; selfPid?: number }
): HubUiServerProcess[] {
  const repoRoot = String(opts.repoRoot ?? '').trim().replace(/^[A-Za-z]:/, '').replace(/\\/g, '/').replace(/\/+$/, '');
  const selfPid = Number(opts.selfPid ?? 0);
  if (!repoRoot) return [];

  const viteBin = `${repoRoot}/node_modules/.bin/vite`;
  const viteNodeCli = `${repoRoot}/node_modules/vite/bin/vite.js`;
  const out: HubUiServerProcess[] = [];
  const lines = String(psOutputRaw ?? '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine ?? '').trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = String(match[2] ?? '').trim();
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (selfPid > 0 && pid === selfPid) continue;

    const normalizedArgs = args.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/');
    const hasRepoVite =
      normalizedArgs.includes(viteBin) ||
      normalizedArgs.includes(viteNodeCli);
    if (!hasRepoVite) continue;
    if (!/\bvite\b/.test(normalizedArgs)) continue;
    if (!/(?:^|\s)--strictPort(?=\s|$)/.test(args)) continue;
    out.push({
      pid: Math.floor(pid),
      uiPort: parsePositiveIntegerOption(args, '--port'),
      args,
    });
  }
  return out;
}

export function selectHubRunnerPidsToStop(
  processes: HubRunnerProcess[],
  preferredUiPort: number | null | undefined
): number[] {
  const preferredPort = Number(preferredUiPort);
  if (Number.isFinite(preferredPort) && preferredPort > 0) {
    const matches = processes.filter((proc) => proc.uiPort === Math.floor(preferredPort)).map((proc) => proc.pid);
    if (matches.length > 0) return matches;
  }
  if (processes.length === 1) return [processes[0].pid];
  return [];
}

export function selectHubRunnerToRecover(
  processes: HubRunnerProcess[],
  preferredUiPort: number | null | undefined,
): HubRunnerProcess | null {
  const preferredPort = Number(preferredUiPort);
  if (Number.isFinite(preferredPort) && preferredPort > 0) {
    const matches = processes.filter((proc) => proc.uiPort === Math.floor(preferredPort));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }
  return processes.length === 1 ? processes[0] : null;
}
