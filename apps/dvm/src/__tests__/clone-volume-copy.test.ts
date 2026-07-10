import { ContainerManager } from '../container/manager';

describe('dvm clone persistence behavior', () => {
  test('copies persistence volume contents by default', async () => {
    const manager = new ContainerManager();

    const sourceInspect: any = {
      Config: {
        Env: ['A=B'],
        Labels: {
          'me.drone.dvm.persistence.volume': 'dvm-source-data',
          'me.drone.dvm.persistence.path': '/dvm-data',
        },
      },
      Mounts: [
        { Type: 'volume', Name: 'dvm-source-data', Destination: '/dvm-data' },
        { Type: 'bind', Source: '/host/work', Destination: '/work' },
      ],
    };
    const clonedInspect: any = {
      Config: {
        Labels: {
          'me.drone.dvm.persistence.volume': 'dvm-clone-data',
          'me.drone.dvm.persistence.path': '/dvm-data',
        },
      },
      Mounts: [{ Type: 'volume', Name: 'dvm-clone-data', Destination: '/dvm-data' }],
    };

    const sourceContainer = { inspect: jest.fn(async () => sourceInspect) } as any;
    const clonedContainer = { inspect: jest.fn(async () => clonedInspect) } as any;

    const dockerMock = {
      containerExists: jest.fn(async (name: string) => name === 'source'),
      getContainer: jest.fn(async (name: string) => {
        if (name === 'source') return sourceContainer;
        if (name === 'clone') return clonedContainer;
        return null;
      }),
      getContainerDetails: jest.fn(async () => ({
        ports: [{ containerPort: 7777, hostPort: 31000 }],
      })),
      getContainerNetworkNames: jest.fn(async () => ['primary-net', 'secondary-net']),
      commitContainer: jest.fn(async () => 'dvm-clone-source:clone-tag'),
      volumeExists: jest.fn(async () => true),
      exportVolumeToTarGz: jest.fn(async () => {}),
      importVolumeFromTarGz: jest.fn(async () => {}),
      startContainer: jest.fn(async () => {}),
      connectNetwork: jest.fn(async () => {}),
      removeContainer: jest.fn(async () => {}),
      removeVolume: jest.fn(async () => {}),
    };

    (manager as any).docker = dockerMock;
    const createSpy = jest.spyOn(manager, 'createContainer').mockResolvedValue();

    await manager.cloneContainer('source', 'clone');

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'clone',
        image: 'dvm-clone-source:clone-tag',
        persistence: { enabled: true, path: '/dvm-data' },
      }),
      false,
      { skipProvisioning: true }
    );
    expect(dockerMock.exportVolumeToTarGz).toHaveBeenCalledWith('dvm-source-data', expect.stringMatching(/volume\.tar\.gz$/));
    expect(dockerMock.importVolumeFromTarGz).toHaveBeenCalledWith('dvm-clone-data', expect.stringMatching(/volume\.tar\.gz$/));
    expect(dockerMock.startContainer).toHaveBeenCalledWith('clone');
    expect(dockerMock.connectNetwork).toHaveBeenCalledWith('secondary-net', 'clone');
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ports: [{ containerPort: 7777 }],
      }),
      false,
      { skipProvisioning: true }
    );
  });

  test('can skip persistence volume copy', async () => {
    const manager = new ContainerManager();

    const sourceInspect: any = {
      Config: {
        Labels: {
          'me.drone.dvm.persistence.volume': 'dvm-source-data',
          'me.drone.dvm.persistence.path': '/dvm-data',
        },
      },
      Mounts: [{ Type: 'volume', Name: 'dvm-source-data', Destination: '/dvm-data' }],
    };

    const sourceContainer = { inspect: jest.fn(async () => sourceInspect) } as any;

    const dockerMock = {
      containerExists: jest.fn(async (name: string) => name === 'source'),
      getContainer: jest.fn(async (name: string) => {
        if (name === 'source') return sourceContainer;
        return null;
      }),
      getContainerDetails: jest.fn(async () => ({
        ports: [{ containerPort: 7777, hostPort: 31000 }],
      })),
      getContainerNetworkNames: jest.fn(async () => ['primary-net']),
      commitContainer: jest.fn(async () => 'dvm-clone-source:clone-tag'),
      volumeExists: jest.fn(async () => true),
      exportVolumeToTarGz: jest.fn(async () => {}),
      importVolumeFromTarGz: jest.fn(async () => {}),
      startContainer: jest.fn(async () => {}),
      connectNetwork: jest.fn(async () => {}),
      removeContainer: jest.fn(async () => {}),
      removeVolume: jest.fn(async () => {}),
    };

    (manager as any).docker = dockerMock;
    const createSpy = jest.spyOn(manager, 'createContainer').mockResolvedValue();

    await manager.cloneContainer('source', 'clone', { copyPersistenceVolume: false, start: true });

    expect(createSpy).toHaveBeenCalledWith(expect.any(Object), true, { skipProvisioning: true });
    expect(dockerMock.exportVolumeToTarGz).not.toHaveBeenCalled();
    expect(dockerMock.importVolumeFromTarGz).not.toHaveBeenCalled();
    expect(dockerMock.startContainer).not.toHaveBeenCalled();
  });

  test('preserves no-volume source storage mode by default', async () => {
    const manager = new ContainerManager();

    const sourceInspect: any = {
      Config: {
        Labels: {
          'me.drone.dvm.persistence.volume': '',
          'me.drone.dvm.persistence.path': '',
        },
      },
      Mounts: [],
    };

    const sourceContainer = { inspect: jest.fn(async () => sourceInspect) } as any;

    const dockerMock = {
      containerExists: jest.fn(async (name: string) => name === 'source'),
      getContainer: jest.fn(async (name: string) => {
        if (name === 'source') return sourceContainer;
        return null;
      }),
      getContainerDetails: jest.fn(async () => ({
        ports: [{ containerPort: 7777, hostPort: 31000 }],
      })),
      getContainerNetworkNames: jest.fn(async () => ['primary-net']),
      commitContainer: jest.fn(async () => 'dvm-clone-source:clone-tag'),
      volumeExists: jest.fn(async () => false),
      exportVolumeToTarGz: jest.fn(async () => {}),
      importVolumeFromTarGz: jest.fn(async () => {}),
      importTarGzToContainerPath: jest.fn(async () => {}),
      startContainer: jest.fn(async () => {}),
      connectNetwork: jest.fn(async () => {}),
      removeContainer: jest.fn(async () => {}),
      removeVolume: jest.fn(async () => {}),
    };

    (manager as any).docker = dockerMock;
    const createSpy = jest.spyOn(manager, 'createContainer').mockResolvedValue();

    await manager.cloneContainer('source', 'clone');

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        persistence: { enabled: false, path: '/dvm-data' },
      }),
      false,
      { skipProvisioning: true }
    );
    expect(dockerMock.exportVolumeToTarGz).not.toHaveBeenCalled();
    expect(dockerMock.importVolumeFromTarGz).not.toHaveBeenCalled();
    expect(dockerMock.importTarGzToContainerPath).not.toHaveBeenCalled();
    expect(dockerMock.startContainer).toHaveBeenCalledTimes(1);
    expect(dockerMock.startContainer).toHaveBeenCalledWith('clone');
  });

  test('can clone a volume-backed source into image-layer persistence', async () => {
    const manager = new ContainerManager();

    const sourceInspect: any = {
      Config: {
        Labels: {
          'me.drone.dvm.persistence.volume': 'dvm-source-data',
          'me.drone.dvm.persistence.path': '/dvm-data',
        },
      },
      Mounts: [{ Type: 'volume', Name: 'dvm-source-data', Destination: '/dvm-data' }],
    };

    const sourceContainer = { inspect: jest.fn(async () => sourceInspect) } as any;

    const dockerMock = {
      containerExists: jest.fn(async (name: string) => name === 'source'),
      getContainer: jest.fn(async (name: string) => {
        if (name === 'source') return sourceContainer;
        if (name === 'clone') return { inspect: jest.fn(async () => ({ Config: { Labels: {} }, Mounts: [] })) };
        return null;
      }),
      getContainerDetails: jest.fn(async () => ({
        ports: [{ containerPort: 7777, hostPort: 31000 }],
      })),
      getContainerNetworkNames: jest.fn(async () => ['primary-net']),
      commitContainer: jest.fn(async () => 'dvm-clone-source:clone-tag'),
      volumeExists: jest.fn(async () => true),
      exportVolumeToTarGz: jest.fn(async () => {}),
      importVolumeFromTarGz: jest.fn(async () => {}),
      importTarGzToContainerPath: jest.fn(async () => {}),
      startContainer: jest.fn(async () => {}),
      stopContainer: jest.fn(async () => {}),
      connectNetwork: jest.fn(async () => {}),
      removeContainer: jest.fn(async () => {}),
      removeVolume: jest.fn(async () => {}),
    };

    (manager as any).docker = dockerMock;
    const createSpy = jest.spyOn(manager, 'createContainer').mockResolvedValue();

    await manager.cloneContainer('source', 'clone', { persistVolume: false, start: false });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        persistence: { enabled: false, path: '/dvm-data' },
      }),
      false,
      { skipProvisioning: true }
    );
    expect(dockerMock.exportVolumeToTarGz).toHaveBeenCalledWith('dvm-source-data', expect.stringMatching(/volume\.tar\.gz$/));
    expect(dockerMock.importVolumeFromTarGz).not.toHaveBeenCalled();
    expect(dockerMock.startContainer).toHaveBeenCalledWith('clone');
    expect(dockerMock.importTarGzToContainerPath).toHaveBeenCalledWith('clone', expect.stringMatching(/volume\.tar\.gz$/), '/dvm-data');
    expect(dockerMock.stopContainer).toHaveBeenCalledWith('clone');
  });

  test('uses explicit clone port mappings when provided', async () => {
    const manager = new ContainerManager();

    const sourceInspect: any = {
      Config: {
        Labels: {
          'me.drone.dvm.persistence.volume': 'dvm-source-data',
          'me.drone.dvm.persistence.path': '/dvm-data',
        },
      },
      Mounts: [{ Type: 'volume', Name: 'dvm-source-data', Destination: '/dvm-data' }],
    };

    const sourceContainer = { inspect: jest.fn(async () => sourceInspect) } as any;

    const dockerMock = {
      containerExists: jest.fn(async (name: string) => name === 'source'),
      getContainer: jest.fn(async (name: string) => {
        if (name === 'source') return sourceContainer;
        return null;
      }),
      getContainerDetails: jest.fn(async () => ({
        ports: [{ containerPort: 7777, hostPort: 31000 }],
      })),
      getContainerNetworkNames: jest.fn(async () => ['primary-net']),
      commitContainer: jest.fn(async () => 'dvm-clone-source:clone-tag'),
      volumeExists: jest.fn(async () => false),
      exportVolumeToTarGz: jest.fn(async () => {}),
      importVolumeFromTarGz: jest.fn(async () => {}),
      startContainer: jest.fn(async () => {}),
      connectNetwork: jest.fn(async () => {}),
      removeContainer: jest.fn(async () => {}),
      removeVolume: jest.fn(async () => {}),
    };

    (manager as any).docker = dockerMock;
    const createSpy = jest.spyOn(manager, 'createContainer').mockResolvedValue();

    await manager.cloneContainer('source', 'clone', {
      ports: [
        { containerPort: 7777, hostPort: 41000 },
        { containerPort: 3389, hostPort: 41001 },
        { containerPort: 6080, hostPort: 41002 },
      ],
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'clone',
        ports: [
          { containerPort: 7777, hostPort: 41000 },
          { containerPort: 3389, hostPort: 41001 },
          { containerPort: 6080, hostPort: 41002 },
        ],
      }),
      false,
      { skipProvisioning: true }
    );
  });

  test('copies persistence for legacy source containers without persistence labels', async () => {
    const manager = new ContainerManager();

    const sourceInspect: any = {
      Config: {
        Env: ['A=B'],
        Labels: {},
      },
      Mounts: [
        { Type: 'volume', Name: 'dvm-source-data', Destination: '/dvm-data' },
        { Type: 'bind', Source: '/host/work', Destination: '/work' },
      ],
    };
    const clonedInspect: any = {
      Config: {
        Labels: {
          'me.drone.dvm.persistence.volume': 'dvm-clone-data',
          'me.drone.dvm.persistence.path': '/dvm-data',
        },
      },
      Mounts: [{ Type: 'volume', Name: 'dvm-clone-data', Destination: '/dvm-data' }],
    };

    const sourceContainer = { inspect: jest.fn(async () => sourceInspect) } as any;
    const clonedContainer = { inspect: jest.fn(async () => clonedInspect) } as any;

    const dockerMock = {
      containerExists: jest.fn(async (name: string) => name === 'source'),
      getContainer: jest.fn(async (name: string) => {
        if (name === 'source') return sourceContainer;
        if (name === 'clone') return clonedContainer;
        return null;
      }),
      getContainerDetails: jest.fn(async () => ({
        ports: [{ containerPort: 7777, hostPort: 31000 }],
      })),
      getContainerNetworkNames: jest.fn(async () => ['primary-net']),
      commitContainer: jest.fn(async () => 'dvm-clone-source:clone-tag'),
      volumeExists: jest.fn(async () => true),
      exportVolumeToTarGz: jest.fn(async () => {}),
      importVolumeFromTarGz: jest.fn(async () => {}),
      startContainer: jest.fn(async () => {}),
      connectNetwork: jest.fn(async () => {}),
      removeContainer: jest.fn(async () => {}),
      removeVolume: jest.fn(async () => {}),
    };

    (manager as any).docker = dockerMock;
    jest.spyOn(manager, 'createContainer').mockResolvedValue();

    await manager.cloneContainer('source', 'clone');

    expect(dockerMock.exportVolumeToTarGz).toHaveBeenCalledWith('dvm-source-data', expect.stringMatching(/volume\.tar\.gz$/));
    expect(dockerMock.importVolumeFromTarGz).toHaveBeenCalledWith('dvm-clone-data', expect.stringMatching(/volume\.tar\.gz$/));
  });
});
