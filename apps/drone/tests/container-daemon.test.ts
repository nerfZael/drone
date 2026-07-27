import { describe, expect, test } from 'bun:test';

import { ensureContainerDroneDaemonSession } from '../src/host/container-daemon';
import { buildContainerDroneDaemonLaunchScript, DRONE_DAEMON_SESSION_NAME } from '../src/host/runtime';

describe('buildContainerDroneDaemonLaunchScript', () => {
  test('launches the persisted drone daemon runtime with a legacy fallback path', () => {
    const script = buildContainerDroneDaemonLaunchScript(7777);
    expect(script).toContain('/dvm-data/drone/dist/daemon.js');
    expect(script).toContain('/dvm-data/drone/daemon.js');
    expect(script).toContain("--host '0.0.0.0'");
    expect(script).toContain("--port '7777'");
    expect(script).toContain("--token-file '/dvm-data/drone/token'");
  });
});

describe('ensureContainerDroneDaemonSession', () => {
  test('starts the container, validates the persisted runtime, and reuses the standard daemon session', async () => {
    const calls: string[] = [];
    let prepArgs: string[] = [];
    let startedArgs: { containerName: string; session: string; cmd: string; args: string[]; reuse: boolean } | null = null;

    await ensureContainerDroneDaemonSession(
      { containerName: 'demo', containerPort: 7777 },
      {
        startContainer: async (containerName) => {
          calls.push(`start:${containerName}`);
        },
        execInContainer: async (containerName, cmd, args) => {
          calls.push(`exec:${containerName}:${cmd}`);
          prepArgs = args;
          return { code: 0, stdout: '', stderr: '' };
        },
        sessionStart: async (containerName, session, cmd, args, reuse) => {
          calls.push(`session:${containerName}:${session}`);
          startedArgs = { containerName, session, cmd, args, reuse };
        },
      }
    );

    expect(calls).toEqual(['start:demo', 'exec:demo:bash', `session:demo:${DRONE_DAEMON_SESSION_NAME}`]);
    expect(prepArgs[0]).toBe('-lc');
    expect(prepArgs[1]).toContain('missing /dvm-data/drone/token');
    expect(prepArgs[1]).toContain("tmux has-session -t 'drone-daemon'");
    expect(startedArgs).toEqual({
      containerName: 'demo',
      session: DRONE_DAEMON_SESSION_NAME,
      cmd: 'bash',
      args: ['-lc', buildContainerDroneDaemonLaunchScript(7777)],
      reuse: true,
    });
  });

  test('surfaces a clear error when the persisted daemon runtime is missing', async () => {
    await expect(
      ensureContainerDroneDaemonSession(
        { containerName: 'demo', containerPort: 7777 },
        {
          startContainer: async () => {},
          execInContainer: async () => ({
            code: 21,
            stdout: '',
            stderr: 'missing drone daemon runtime (/dvm-data/drone/dist/daemon.js or /dvm-data/drone/daemon.js)',
          }),
          sessionStart: async () => {},
        }
      )
    ).rejects.toThrow(/missing drone daemon runtime/i);
  });

  test('force-restarts an existing daemon session after a failed health probe', async () => {
    let prepScript = '';
    await ensureContainerDroneDaemonSession(
      { containerName: 'demo', containerPort: 7777, forceRestart: true },
      {
        startContainer: async () => {},
        execInContainer: async (_containerName, _cmd, args) => {
          prepScript = args[1] ?? '';
          return { code: 0, stdout: '', stderr: '' };
        },
        sessionStart: async () => {},
      },
    );

    expect(prepScript).toContain("tmux has-session -t 'drone-daemon'");
    expect(prepScript).toContain("tmux kill-session -t 'drone-daemon'");
    expect(prepScript).not.toContain('pane_dead');
  });
});
