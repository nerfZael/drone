import { DvmApi, type DvmRepoSeedTiming } from '../api';

describe('repoSeed checkout target', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates the work branch from the resolved base SHA instead of the short branch name', async () => {
    const execCommand = jest.fn(async () => '');
    const copyToContainer = jest.fn(async () => {});
    const startContainer = jest.fn(async () => {});
    const ensureGit = jest.fn(async () => {});
    const containerExists = jest.fn(async () => true);
    const api = new DvmApi({
      manager: {
        docker: {
          containerExists,
          execCommand,
          copyToContainer,
        },
        startContainer,
        ensureGit,
      } as any,
      baseConfig: {} as any,
    });

    const baseSha = 'c6df507a1f66b3f579507bc5868aff1c32909d3b';
    const baseTreeSha = '9f4a1c0e5fef77278a9a9fc09f02e3f1a950f98d';
    const runLocalSpy = jest
      .spyOn(api as any, 'runLocal')
      .mockImplementation(async (...rawArgs: unknown[]) => {
        const [_cmd, args] = rawArgs as [string, string[]];
        if (args.includes('--is-inside-work-tree')) return 'true\n';
        if (args.includes('remote') && args.includes('get-url'))
          return 'git@github.com:Planet-Mojo/StorySpark.git\n';
        if (args[args.length - 2] === 'rev-parse' && args[args.length - 1] === 'dev')
          return `${baseSha}\n`;
        if (args[args.length - 2] === 'rev-parse' && args[args.length - 1] === `${baseSha}^{tree}`)
          return `${baseTreeSha}\n`;
        if (args.includes('update-ref')) return '';
        if (args.includes('bundle') && args.includes('create')) return '';
        if (args[args.length - 1] === 'remote') return 'origin\n';
        throw new Error(`Unexpected runLocal call: ${args.join(' ')}`);
      });

    let timing: DvmRepoSeedTiming | null = null;
    await api.repoSeed({
      containerName: 'demo',
      hostRepoPath: '/repo',
      destinationPath: '/work/repo',
      baseRef: 'dev',
      branch: 'dvm/work',
      clean: true,
      onTiming: (snapshot) => {
        timing = snapshot;
      },
    });

    expect(timing).toMatchObject({
      outcome: 'completed',
      durationMs: expect.any(Number),
      phases: {
        inspectRepository: expect.any(Number),
        createBundle: expect.any(Number),
        ensureContainer: expect.any(Number),
        ensureGit: expect.any(Number),
        prepareBundleDestination: expect.any(Number),
        copyBundleToContainer: expect.any(Number),
        cloneAndConfigureRepository: expect.any(Number),
        cleanupHostArtifacts: expect.any(Number),
      },
    });

    const cloneCall = (execCommand.mock.calls as unknown[][]).find((call) => {
      const args = call[1] as string[] | undefined;
      if (!Array.isArray(args)) return false;
      return args[0] === 'bash' && args[1] === '-lc' && String(args[2] ?? '').includes('git clone');
    });
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).toEqual([
      'demo',
      ['bash', '-lc', expect.stringContaining(`git checkout -b "dvm/work" "${baseSha}"`)],
    ]);
    expect(cloneCall).toEqual([
      'demo',
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.stringContaining('git clone --branch "dvm-seed/demo-'),
      ]),
    ]);
    expect(cloneCall).toEqual([
      'demo',
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.not.stringContaining('git checkout -b "dvm/work" "dev"'),
      ]),
    ]);
    expect(cloneCall).toEqual([
      'demo',
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.stringContaining('trap "rm -f \\"/tmp/dvm-repo.bundle\\" || true" EXIT'),
      ]),
    ]);
    expect(cloneCall).toEqual([
      'demo',
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.stringContaining('rm -f "/tmp/dvm-repo.bundle"'),
      ]),
    ]);

    const bundleCreateCall = runLocalSpy.mock.calls.find((call) => {
      const args = call[1] as string[] | undefined;
      return Array.isArray(args) && args.includes('bundle') && args.includes('create');
    });
    expect(bundleCreateCall).toBeTruthy();
    const bundleArgs = bundleCreateCall?.[1] as string[];
    expect(bundleArgs).not.toContain('--all');
    expect(bundleArgs[bundleArgs.length - 1]).toMatch(/^refs\/heads\/dvm-seed\/demo-/);
    expect(runLocalSpy).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([
        'update-ref',
        '-d',
        expect.stringMatching(/^refs\/heads\/dvm-seed\/demo-/),
      ]),
    );
  });

  test('skips container discovery when the caller guarantees it is already ready', async () => {
    const execCommand = jest.fn(async () => '');
    const copyToContainer = jest.fn(async () => {});
    const startContainer = jest.fn(async () => {});
    const ensureGit = jest.fn(async () => {});
    const containerExists = jest.fn(async () => true);
    const api = new DvmApi({
      manager: {
        docker: {
          containerExists,
          execCommand,
          copyToContainer,
        },
        startContainer,
        ensureGit,
      } as any,
      baseConfig: {} as any,
    });

    const prepared = {
      version: 1 as const,
      hostRepoPath: '/repo',
      destinationPath: '/work/repo',
      bundlePathInContainer: '/tmp/dvm-repo.bundle',
      baseSha: 'c6df507a1f66b3f579507bc5868aff1c32909d3b',
      baseTreeSha: '9f4a1c0e5fef77278a9a9fc09f02e3f1a950f98d',
      hostRemoteUrl: null,
      temporaryDirectory: '',
      bundlePath: '/tmp/prepared-repo.bundle',
      seedBranch: 'dvm-seed/demo',
      seedRef: 'refs/heads/dvm-seed/demo',
      prepareDurationMs: 0,
      preparePhases: {},
    };
    let timing: DvmRepoSeedTiming | null = null;

    await api.repoSeedPrepared(
      {
        containerName: 'demo',
        hostRepoPath: '/repo',
        containerAlreadyReady: true,
        branch: 'dvm/work',
        clean: true,
        onTiming: (snapshot) => {
          timing = snapshot;
        },
      },
      prepared,
    );

    expect(containerExists).not.toHaveBeenCalled();
    expect(startContainer).not.toHaveBeenCalled();
    expect(timing).toMatchObject({
      outcome: 'completed',
      phases: { ensureContainer: 0 },
    });
  });
});
