import { randomUUID } from 'node:crypto';
import { captureTerminalSnapshot } from '../terminal-control';
import type { TerminalWebSocketContext } from './terminal-websocket-server';

// Older daemons expose padded text without cursor/mode/color state. Capture that
// state in one tmux command list, once at attachment, until the daemon is upgraded.
export async function captureLegacyTerminalSnapshot(
  context: TerminalWebSocketContext,
  exec: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>,
) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(context.sessionName))
    throw new Error('invalid terminal session');
  const target = `=${context.sessionName}:^`;
  return captureTerminalSnapshot(async (commands) => {
    const marker = `DRONE_SNAPSHOT_${randomUUID()}`;
    const cols = context.cols;
    const rows = context.rows;
    const resize =
      Number.isInteger(cols) &&
      Number.isInteger(rows) &&
      cols! >= 2 &&
      cols! <= 1000 &&
      rows! >= 1 &&
      rows! <= 1000
        ? [`resize-window -t ${target} -x ${cols} -y ${rows}`]
        : [];
    const commandList = [
      ...resize,
      ...commands.flatMap((command) => [command, `display-message -p '${marker}'`]),
    ];
    const result = await exec('bash', ['-c', `tmux ${commandList.join(' \\; ')}`]);
    if (result.code !== 0) throw new Error('Terminal screen capture failed');
    const replies = result.stdout.split(`${marker}\n`);
    if (replies.length !== commands.length + 1) throw new Error('Invalid terminal screen capture');
    return replies.slice(0, -1).map((data) => ({ data: Buffer.from(data), offset: 0 }));
  }, target);
}
