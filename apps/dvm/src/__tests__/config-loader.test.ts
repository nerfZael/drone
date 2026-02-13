import { ConfigLoader } from '../config/loader';

describe('ConfigLoader.normalizeConfig', () => {
  test('normalizes a mixed real-world config from yaml/json input', () => {
    const out = ConfigLoader.normalizeConfig({
      name: 'demo',
      image: 'ubuntu:latest',
      network: 'bridge',
      ports: ['3000:3000', 8080, { container: 5173, host: 15173 }],
      environment: ['NODE_ENV=development'],
      volumes: ['/tmp:/work', { source: 'named-vol', target: '/cache', type: 'volume' }],
      persistence: { enabled: true, path: '/dvm-data' },
    });

    expect(out.name).toBe('demo');
    expect(out.image).toBe('ubuntu:latest');
    expect(out.network).toBe('bridge');
    expect(out.ports).toEqual([
      { hostPort: 3000, containerPort: 3000 },
      { containerPort: 8080 },
      { containerPort: 5173, hostPort: 15173 },
    ]);
    expect(out.environment).toEqual(['NODE_ENV=development']);
    expect(out.volumes).toEqual([
      { source: '/tmp', target: '/work', type: 'bind' },
      { source: 'named-vol', target: '/cache', type: 'volume' },
    ]);
    expect(out.persistence).toEqual({ enabled: true, path: '/dvm-data' });
  });

  test('defaults persistence to enabled at /dvm-data when omitted', () => {
    const out = ConfigLoader.normalizeConfig({
      name: 'api',
      image: 'node:20',
    });

    expect(out.persistence).toEqual({ enabled: true, path: '/dvm-data' });
    expect(out.ports).toEqual([]);
    expect(out.volumes).toEqual([]);
  });

  test('accepts short port form when host port is auto-allocated', () => {
    const out = ConfigLoader.normalizeConfig({
      name: 'web',
      image: 'node:20',
      ports: [3000, '5173'],
    });

    expect(out.ports).toEqual([{ containerPort: 3000 }, { containerPort: 5173 }]);
  });

  test('throws on invalid host:container port mapping', () => {
    expect(() =>
      ConfigLoader.normalizeConfig({
        name: 'demo',
        image: 'ubuntu:latest',
        ports: ['abc:3000'],
      } as any),
    ).toThrow(/ports\[0\]\.hostPort/i);
  });

  test('throws when environment values are blank', () => {
    expect(() =>
      ConfigLoader.normalizeConfig({
        name: 'demo',
        image: 'ubuntu:latest',
        environment: ['NODE_ENV=dev', ' '],
      } as any),
    ).toThrow(/environment\[1\]/i);
  });

  test('throws on missing required fields', () => {
    expect(() =>
      ConfigLoader.normalizeConfig({
        image: 'ubuntu:latest',
      } as any),
    ).toThrow(/name/i);

    expect(() =>
      ConfigLoader.normalizeConfig({
        name: 'demo',
      } as any),
    ).toThrow(/image/i);
  });
});
