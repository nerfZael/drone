import path from 'node:path';

export type HubRunnerProcess = {
  pid: number;
  uiPort: number | null;
  args: string;
};

function parseUiPortFromArgs(args: string): number | null {
  const match = String(args ?? '').match(/(?:^|\s)--port(?:=|\s+)(\d+)(?=\s|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isFinite(port) || port <= 0) return null;
  return Math.floor(port);
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
      uiPort: parseUiPortFromArgs(args),
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
