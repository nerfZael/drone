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
      }),
      false,
      { skipProvisioning: true }
    );
    expect(dockerMock.exportVolumeToTarGz).toHaveBeenCalledWith('dvm-source-data', expect.stringMatching(/volume\.tar\.gz$/));
    expect(dockerMock.importVolumeFromTarGz).toHaveBeenCalledWith('dvm-clone-data', expect.stringMatching(/volume\.tar\.gz$/));
    expect(dockerMock.startContainer).toHaveBeenCalledWith('clone');
    expect(dockerMock.connectNetwork).toHaveBeenCalledWith('secondary-net', 'clone');
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
});
