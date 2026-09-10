import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureLegacyTerminalSnapshot } from '../../drone/src/hub/terminal-legacy-snapshot';

const exec = promisify(execFile);
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export async function createSnapshotFixture() {
  const dir = await fs.mkdtemp('/tmp/terminal-snapshot-render-');
  const args = ['-S', `${dir}/socket`, '-f', '/dev/null'];
  const tmux = (...command: string[]) => exec('tmux', [...args, ...command]);
  try {
    await tmux(
      'new-session',
      '-d',
      '-s',
      'probe',
      'bash',
      '-c',
      "printf '\\033[32mPROMPT> \\033[0m'; sleep 30",
    );
    for (let i = 0; i < 100; i++) {
      if ((await tmux('capture-pane', '-p', '-t', '=probe:^')).stdout.includes('PROMPT>')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const snapshot = await captureLegacyTerminalSnapshot(
      {
        sessionName: 'probe',
        droneName: 'fixture',
        client: { baseUrl: '', token: '' },
        runtime: 'host',
        cols: 90,
        rows: 50,
        maxBytes: 200000,
      },
      async (_command, commandArgs) => {
        const script = commandArgs[1].replace(/^tmux /, `tmux ${args.map(quote).join(' ')} `);
        const result = await exec('bash', ['-c', script]);
        return { ...result, code: 0 };
      },
    );
    return snapshot.data.toString('base64');
  } finally {
    await tmux('kill-server').catch(() => {});
    await fs.rm(dir, { force: true, recursive: true });
  }
}
