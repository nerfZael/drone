import { dvmExec, dvmSessionStart, dvmStart, type RunResult } from './dvm';
import { buildContainerDroneDaemonLaunchScript, DRONE_DAEMON_SESSION_NAME } from './runtime';

function bashQuote(raw: string): string {
  return `'${String(raw ?? '').replace(/'/g, `'\\''`)}'`;
}

type EnsureContainerDroneDaemonDeps = {
  startContainer: (containerName: string) => Promise<void>;
  execInContainer: (containerName: string, cmd: string, args: string[]) => Promise<RunResult>;
  sessionStart: (containerName: string, session: string, cmd: string, args: string[], reuse: boolean) => Promise<void>;
};

const defaultDeps: EnsureContainerDroneDaemonDeps = {
  startContainer: dvmStart,
  execInContainer: (containerName, cmd, args) => dvmExec(containerName, cmd, args),
  sessionStart: dvmSessionStart,
};

export async function ensureContainerDroneDaemonSession(
  opts: {
    containerName: string;
    containerPort: number;
    sessionName?: string;
    forceRestart?: boolean;
  },
  deps: EnsureContainerDroneDaemonDeps = defaultDeps
): Promise<void> {
  const containerName = String(opts.containerName ?? '').trim();
  if (!containerName) throw new Error('missing container name');

  const containerPort = Number(opts.containerPort);
  if (!Number.isFinite(containerPort) || containerPort <= 0 || Math.floor(containerPort) !== containerPort) {
    throw new Error(`invalid container daemon port: ${opts.containerPort}`);
  }

  const sessionName = String(opts.sessionName ?? DRONE_DAEMON_SESSION_NAME).trim() || DRONE_DAEMON_SESSION_NAME;
  const existingSessionLines = opts.forceRestart
    ? [`  tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`]
    : [
        `  dead="$(tmux display-message -p -t ${bashQuote(`${sessionName}:0.0`)} '#{pane_dead}' 2>/dev/null || echo 0)"`,
        '  if [ "$dead" = "1" ]; then',
        `    tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`,
        '  fi',
      ];
  await deps.startContainer(containerName);

  const prepScript = [
    'set -euo pipefail',
    'test -f /dvm-data/drone/token || { echo "missing /dvm-data/drone/token" 1>&2; exit 20; }',
    'if [ ! -f /dvm-data/drone/dist/daemon.js ] && [ ! -f /dvm-data/drone/daemon.js ]; then',
    '  echo "missing drone daemon runtime (/dvm-data/drone/dist/daemon.js or /dvm-data/drone/daemon.js)" 1>&2',
    '  exit 21',
    'fi',
    `if command -v tmux >/dev/null 2>&1 && tmux has-session -t ${bashQuote(sessionName)} 2>/dev/null; then`,
    ...existingSessionLines,
    'fi',
  ].join('\n');

  const prepared = await deps.execInContainer(containerName, 'bash', ['-lc', prepScript]);
  if (prepared.code !== 0) {
    throw new Error((prepared.stderr || prepared.stdout || `failed preparing ${sessionName} in ${containerName}`).trim());
  }

  await deps.sessionStart(
    containerName,
    sessionName,
    'bash',
    ['-lc', buildContainerDroneDaemonLaunchScript(containerPort)],
    true
  );
}
