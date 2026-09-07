import { PassThrough } from 'node:stream';
import { DockerClient } from '../docker/client';

describe('Docker exec diagnostics', () => {
  test.each([false, true])('resolved container skips discovery and observer failure is harmless: %s', async (throwObserver) => {
    const client = new DockerClient();
    const discovery = jest.spyOn(client, 'getContainer');
    const phases: string[] = [];
    const exec = {
      start: (_options: unknown, callback: (err: null, stream: PassThrough) => void) => {
        const stream = new PassThrough();
        callback(null, stream);
        setImmediate(() => stream.end('hello'));
      },
      inspect: jest.fn(async () => ({ ExitCode: 0 })),
    };
    const getContainer = jest.fn(() => ({ exec: jest.fn(async () => exec) }));
    (client as any).docker = { getContainer, modem: { demuxStream: (stream: PassThrough, stdout: PassThrough) => stream.pipe(stdout) } };
    const result = await client.execCommandDetailed('exact-container', ['cat', '/file'], {
      containerAlreadyReady: true,
      onTiming: (phase, duration) => {
        phases.push(phase);
        expect(duration).toBeGreaterThanOrEqual(0);
        if (throwObserver) throw new Error('diagnostics unavailable');
      },
    });
    expect(discovery).not.toHaveBeenCalled();
    expect(getContainer).toHaveBeenCalledWith('exact-container');
    expect(result).toEqual({ code: 0, stdout: 'hello', stderr: '' });
    expect(phases).toEqual(['docker_lookup', 'docker_create_exec', 'docker_start_stream', 'docker_stream', 'docker_inspect_exec']);
    discovery.mockRestore();
  });
});
