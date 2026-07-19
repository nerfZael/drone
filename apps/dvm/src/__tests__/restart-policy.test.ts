import { DockerClient } from '../docker/client';

describe('docker restart policy defaults', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates managed containers with unless-stopped restart policy', async () => {
    const client = new DockerClient();
    const createContainer = jest.fn(async () => ({}) as any);
    (client as any).docker = { createContainer };
    jest.spyOn(client, 'ensureImage').mockResolvedValue();

    await client.createContainer({
      name: 'demo',
      image: 'ubuntu:latest',
      ports: [{ containerPort: 7777, hostPort: 31000 }],
      persistence: { enabled: true, path: '/dvm-data' },
    });

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          RestartPolicy: { Name: 'unless-stopped' },
        }),
      })
    );
  });

  test('creates managed containers with host.docker.internal mapped to host gateway', async () => {
    const client = new DockerClient();
    const createContainer = jest.fn(async () => ({}) as any);
    (client as any).docker = { createContainer };
    jest.spyOn(client, 'ensureImage').mockResolvedValue();

    await client.createContainer({
      name: 'demo',
      image: 'ubuntu:latest',
      ports: [{ containerPort: 7777, hostPort: 31000 }],
      persistence: { enabled: true, path: '/dvm-data' },
    });

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          ExtraHosts: [DockerClient.HOST_GATEWAY_EXTRA_HOST],
        }),
      })
    );
  });

  test('binds an explicitly local port mapping to loopback', async () => {
    const client = new DockerClient();
    const createContainer = jest.fn(async () => ({}) as any);
    (client as any).docker = { createContainer };
    jest.spyOn(client, 'ensureImage').mockResolvedValue();

    await client.createContainer({
      name: 'demo',
      image: 'ubuntu:latest',
      ports: [{ containerPort: 7777, hostPort: 31000, hostIp: '127.0.0.1' }],
      persistence: { enabled: true, path: '/dvm-data' },
    });

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          PortBindings: {
            '7777/tcp': [{ HostIp: '127.0.0.1', HostPort: '31000' }],
          },
        }),
      }),
    );
  });

  test('updates existing containers to unless-stopped when started', async () => {
    const client = new DockerClient();
    const update = jest.fn(async () => ({}));
    const start = jest.fn(async () => ({}));
    const inspect = jest
      .fn()
      .mockResolvedValueOnce({
        HostConfig: { RestartPolicy: { Name: 'no' } },
      })
      .mockResolvedValueOnce({
        State: { Running: false },
      });
    const container = { inspect, update, start } as any;
    jest.spyOn(client, 'getContainer').mockResolvedValue(container);

    await client.startContainer('demo');

    expect(update).toHaveBeenCalledWith({ RestartPolicy: { Name: 'unless-stopped' } });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
