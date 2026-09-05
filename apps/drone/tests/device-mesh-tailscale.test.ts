import { describe, expect, test } from 'bun:test';
import {
  DeviceMeshTailscale,
  parseTailscaleStatus,
  tailscaleSetupError,
} from '../src/hub/device-mesh/device-mesh-tailscale';

describe('Tailscale device transport', () => {
  test('checks explicit HTTPS prerequisites before invoking Serve', async () => {
    for (const CertDomains of [null, []]) {
      const calls: string[][] = [];
      const adapter = new DeviceMeshTailscale(async (args) => {
        calls.push(args);
        return JSON.stringify({
          BackendState: 'Running',
          Self: { DNSName: 'self.tail.ts.net' },
          CertDomains,
        });
      });
      await expect(adapter.enable(8791)).rejects.toMatchObject({
        code: 'TAILSCALE_HTTPS_REQUIRED',
      });
      expect(calls).toEqual([['status', '--json']]);
    }
  });

  test('missing certificate status is unknown, and enabled HTTPS proceeds', async () => {
    for (const certificates of [{}, { CertDomains: ['self.tail.ts.net'] }]) {
      const calls: string[][] = [];
      const adapter = new DeviceMeshTailscale(async (args) => {
        calls.push(args);
        return args[0] === 'status'
          ? JSON.stringify({
              BackendState: 'Running',
              Self: { DNSName: 'self.tail.ts.net' },
              ...certificates,
            })
          : '{}';
      });
      expect(await adapter.enable(8791)).toBe('https://self.tail.ts.net:8791');
      expect(calls.at(-1)).toEqual(['serve', '--bg', '--https=8791', 'http://127.0.0.1:8791']);
    }
    expect(parseTailscaleStatus({ BackendState: 'Running' }).httpsEnabled).toBeNull();
  });

  test('classifies command failures without guessing that HTTPS is disabled', () => {
    expect(tailscaleSetupError({ code: 'ENOENT' }).code).toBe('TAILSCALE_MISSING');
    expect(tailscaleSetupError({ stderr: 'Access denied', killed: true }).code).toBe(
      'TAILSCALE_PERMISSION_DENIED',
    );
    expect(tailscaleSetupError({ stderr: 'bind: address already in use' }).code).toBe(
      'TAILSCALE_PORT_CONFLICT',
    );
    const timeout = tailscaleSetupError({
      message: 'Command failed',
      killed: true,
      stdout: 'Setup instructions',
      stderr: 'diagnostics',
    });
    expect(timeout.code).toBe('TAILSCALE_TIMEOUT');
    expect(timeout.details).toContain('Setup instructions');
    expect(timeout.details).toContain('diagnostics');
    expect(tailscaleSetupError(new Error('unexpected')).code).toBe('TAILSCALE_SETUP_FAILED');
  });
  test('reads explicit peers without scanning address ranges', () => {
    const status = parseTailscaleStatus({
      BackendState: 'Running',
      Self: { DNSName: 'self.tail.ts.net.' },
      Peer: {
        key: {
          ID: 'peer',
          DNSName: 'other.tail.ts.net.',
          HostName: 'Other',
          Online: true,
          TailscaleIPs: ['100.1.2.3'],
        },
      },
    });
    expect(status.connected).toBe(true);
    expect(status.dnsName).toBe('self.tail.ts.net');
    expect(status.peers).toEqual([
      { id: 'peer', name: 'Other', dnsName: 'other.tail.ts.net', ips: ['100.1.2.3'], online: true },
    ]);
  });

  test('refuses to replace an unrelated Serve handler', async () => {
    const calls: string[][] = [];
    const adapter = new DeviceMeshTailscale(async (args) => {
      calls.push(args);
      if (args[0] === 'status')
        return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'self.tail.ts.net' } });
      return JSON.stringify({
        Web: { 'self.tail.ts.net:8791': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } } },
      });
    });
    await expect(adapter.enable(8791)).rejects.toThrow('another application');
    expect(calls).toHaveLength(2);
  });

  test('reports unavailable Tailscale as connectivity failure', async () => {
    const adapter = new DeviceMeshTailscale(async () => {
      throw new Error('client missing');
    });
    expect(await adapter.status()).toMatchObject({
      connected: false,
      peers: [],
      error: 'client missing',
    });
  });
  test('refuses a public Funnel listener rather than treating it as private Serve access', async () => {
    const adapter = new DeviceMeshTailscale(async (args) =>
      args[0] === 'status'
        ? JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'self.tail.ts.net' } })
        : JSON.stringify({ AllowFunnel: { 'self.tail.ts.net:8791': true } }),
    );
    await expect(adapter.enable(8791)).rejects.toThrow('public Funnel');
  });
});
