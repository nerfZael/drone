type HubStartOutput = {
  pid: number | undefined;
  apiUrl?: string;
  uiUrl?: string;
  containerMcpUrl?: string;
  logPath?: string;
  alreadyRunning?: boolean;
  restartReason?: string;
};

type HubStopOutput =
  | { kind: 'stopped'; pid: number }
  | { kind: 'recovered'; pids: number[] }
  | { kind: 'not-running' }
  | { kind: 'stale'; previousPid: number };

const LABELS: Record<string, string> = {
  apiUrl: 'API',
  uiUrl: 'UI',
  containerMcpUrl: 'Container MCP',
  logPath: 'Log',
  pid: 'PID',
  pids: 'PIDs',
  daemonPid: 'Daemon PID',
  id: 'ID',
  chatId: 'Chat ID',
  cwd: 'Working directory',
  hostPort: 'Host port',
  containerPort: 'Container port',
  containerName: 'Container',
  activeProfile: 'Active profile',
  droneDataDir: 'Drone data directory',
  dvmDataDir: 'DVM data directory',
};

function labelFor(key: string): string {
  const known = LABELS[key];
  if (known) return known;
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced ? `${spaced[0].toUpperCase()}${spaced.slice(1)}` : key;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function linesFor(value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}None`];
    return value.flatMap((item) => {
      if (item !== null && typeof item === 'object') {
        const nested = linesFor(item, indent + 2);
        const [first = '', ...rest] = nested;
        return [`${pad}- ${first.trimStart()}`, ...rest];
      }
      return [`${pad}- ${scalar(item)}`];
    });
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record).filter(([key]) => key !== 'ok');
    const result = record.ok === false ? [`${pad}Result: failed`] : [];
    if (entries.length === 0) return result.length > 0 ? result : [`${pad}Done.`];
    return [
      ...result,
      ...entries.flatMap(([key, item]) => {
        const label = labelFor(key);
        if (Array.isArray(item) || (item !== null && typeof item === 'object')) {
          return [`${pad}${label}:`, ...linesFor(item, indent + 2)];
        }
        const rendered = scalar(item);
        if (!rendered.includes('\n')) return [`${pad}${label}: ${rendered}`];
        return [`${pad}${label}:`, ...rendered.split('\n').map((line) => `${pad}  ${line}`)];
      }),
    ];
  }

  return [`${pad}${scalar(value)}`];
}

export function formatHumanOutput(value: unknown): string {
  return linesFor(value, 0).join('\n');
}

export function formatHubStartOutput(output: HubStartOutput): string {
  const pid = Number(output.pid);
  const pidText = Number.isInteger(pid) && pid > 0 ? ` (PID ${pid})` : '';
  const lines = [
    output.alreadyRunning
      ? `Drone Hub is already running${pidText}.`
      : `Drone Hub started${pidText}.`,
  ];
  if (output.apiUrl) lines.push(`API: ${output.apiUrl}`);
  if (output.uiUrl) lines.push(`UI: ${output.uiUrl}`);
  if (output.containerMcpUrl) lines.push(`Container MCP: ${output.containerMcpUrl}`);
  if (output.logPath) lines.push(`Log: ${output.logPath}`);
  if (output.restartReason) lines.push(`Restart recommended: ${output.restartReason}`);
  return lines.join('\n');
}

export function formatHubStopOutput(output: HubStopOutput): string {
  switch (output.kind) {
    case 'stopped':
      return `Drone Hub stopped (PID ${output.pid}).`;
    case 'recovered':
      return `Drone Hub stopped (recovered ${output.pids.length === 1 ? 'PID' : 'PIDs'} ${output.pids.join(', ')}).`;
    case 'stale':
      return `Drone Hub was not running; removed stale state for PID ${output.previousPid}.`;
    case 'not-running':
      return 'Drone Hub is not running.';
  }
}
