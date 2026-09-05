import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type TailscalePeer = {
  id: string;
  name: string;
  dnsName: string;
  ips: string[];
  online: boolean;
};
export type TailscaleStatus = {
  connected: boolean;
  dnsName: string;
  peers: TailscalePeer[];
  error: string | null;
  httpsEnabled?: boolean | null;
};
const execute = promisify(execFile);

export class TailscaleSetupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details = '',
  ) {
    super(message);
  }
}

export function tailscaleSetupError(error: unknown): TailscaleSetupError {
  if (error instanceof TailscaleSetupError) return error;
  const value = error as {
    message?: string;
    stdout?: string;
    stderr?: string;
    code?: string;
    killed?: boolean;
  } | null;
  const details = [value?.message ?? String(error), value?.stdout, value?.stderr]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8192);
  if (value?.code === 'ENOENT')
    return new TailscaleSetupError(
      'TAILSCALE_MISSING',
      'Install Tailscale and make its command-line tool available, then retry.',
      details,
    );
  if (/access denied|permission denied|not permitted|requires root/i.test(details))
    return new TailscaleSetupError(
      'TAILSCALE_PERMISSION_DENIED',
      'DroneHub does not have permission to configure Tailscale Serve. Ask your system administrator to grant Serve access, then retry.',
      details,
    );
  if (/address already in use|port.*already (?:in use|configured|serving)/i.test(details))
    return new TailscaleSetupError(
      'TAILSCALE_PORT_CONFLICT',
      'The Tailscale port is already in use. Resolve the conflicting listener, then retry. DroneHub has not reset your Serve configuration.',
      details,
    );
  if (value?.killed || value?.code === 'ETIMEDOUT')
    return new TailscaleSetupError(
      'TAILSCALE_TIMEOUT',
      'Tailscale setup timed out. Check the Tailscale connection and technical details, then retry.',
      details,
    );
  return new TailscaleSetupError(
    'TAILSCALE_SETUP_FAILED',
    'Could not enable Tailscale access. Check the technical details, then retry.',
    details,
  );
}

export function parseTailscaleStatus(input: unknown): TailscaleStatus {
  const value = input as any;
  if (!value || typeof value !== 'object' || typeof value.BackendState !== 'string') {
    throw new Error('Unsupported Tailscale status response');
  }
  const parsePeer = (peer: any): TailscalePeer => ({
    id: String(peer.ID ?? ''),
    name: String(peer.HostName ?? ''),
    dnsName: String(peer.DNSName ?? '').replace(/\.$/, ''),
    ips: Array.isArray(peer.TailscaleIPs)
      ? peer.TailscaleIPs.filter((ip: unknown) => typeof ip === 'string')
      : [],
    online: peer.Online === true,
  });
  return {
    connected: value.BackendState === 'Running',
    dnsName: parsePeer(value.Self ?? {}).dnsName,
    peers: Object.values(value.Peer ?? {}).map(parsePeer),
    error: null,
    // Missing/unrecognized fields are unknown, not proof that HTTPS is disabled.
    httpsEnabled:
      value.CertDomains === null
        ? false
        : Array.isArray(value.CertDomains)
          ? value.CertDomains.length > 0
          : null,
  };
}

export class DeviceMeshTailscale {
  constructor(
    private readonly run: (args: string[]) => Promise<string> = async (args) => {
      const candidates =
        process.platform === 'darwin'
          ? ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
          : ['tailscale'];
      for (const binary of candidates) {
        try {
          const { stdout } = await execute(binary, args, {
            timeout: 12_000,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
          });
          return stdout;
        } catch (error: any) {
          if (error?.code !== 'ENOENT' || binary === candidates[candidates.length - 1]) throw error;
        }
      }
      throw new Error('Tailscale CLI is unavailable');
    },
  ) {}

  async status(): Promise<TailscaleStatus> {
    try {
      return parseTailscaleStatus(JSON.parse(await this.run(['status', '--json'])));
    } catch (error: any) {
      return { connected: false, dnsName: '', peers: [], error: error?.message ?? String(error) };
    }
  }

  async enable(localPort: number, externalPort = 8791): Promise<string> {
    try {
      const status = parseTailscaleStatus(JSON.parse(await this.run(['status', '--json'])));
      if (!status.connected || !validDnsName(status.dnsName))
        throw new TailscaleSetupError(
          'TAILSCALE_NOT_CONNECTED',
          'Connect Tailscale and enable MagicDNS, then retry.',
        );
      if (status.httpsEnabled === false)
        throw new TailscaleSetupError(
          'TAILSCALE_HTTPS_REQUIRED',
          'Enable HTTPS in Tailscale first. DroneHub needs HTTPS certificates to accept secure connections. Enable HTTPS in your Tailscale DNS settings, then retry.',
          'Tailscale status reports no certificate domains (CertDomains).',
        );
      // Refuse to overwrite another application's listener. Never reset global Serve configuration.
      const config = JSON.parse(await this.run(['serve', 'status', '--json']));
      const host = `${status.dnsName}:${externalPort}`;
      if (config.AllowFunnel?.[host])
        throw new TailscaleSetupError(
          'TAILSCALE_FUNNEL_CONFLICT',
          `Tailscale port ${externalPort} has public Funnel access enabled; disable it before using private DroneHub access`,
        );
      const existing = config.Web?.[host];
      const target = `http://127.0.0.1:${localPort}`;
      if (
        existing &&
        (Object.keys(existing.Handlers ?? {}).length !== 1 ||
          existing.Handlers?.['/']?.Proxy !== target)
      ) {
        throw new TailscaleSetupError(
          'TAILSCALE_PORT_CONFLICT',
          `Tailscale port ${externalPort} is already serving another application. Resolve the conflict, then retry. DroneHub has not reset your Serve configuration.`,
        );
      }
      if (config.TCP?.[String(externalPort)] && !existing)
        throw new TailscaleSetupError(
          'TAILSCALE_PORT_CONFLICT',
          `Tailscale port ${externalPort} is already configured. Resolve the conflict, then retry.`,
        );
      await this.run(['serve', '--bg', `--https=${externalPort}`, target]);
      return `https://${host}`;
    } catch (error) {
      throw tailscaleSetupError(error);
    }
  }
}

export function validDnsName(name: string): boolean {
  return (
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(name) && name.endsWith('.ts.net')
  );
}
