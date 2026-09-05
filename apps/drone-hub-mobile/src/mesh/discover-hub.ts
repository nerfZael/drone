import { throwIfAborted } from '@drone/device-protocol';
import { canonicalJson, readBoundedHttpText } from '@drone/device-protocol';
import { verifyP256Signature } from '../security/p256-signature';

export type DiscoveredHub = { id: string; name: string; endpoint: string };

export function hubDiscoveryEndpoints(address: string): string[] {
  const input = address.trim();
  if (!input) throw new Error('Enter the desktop’s Tailscale name or HTTPS address.');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Use a Tailscale name or HTTPS address without a path or credentials.');
  // An explicit HTTPS origin is exact; bare names probe only our two supported ports.
  if (input.includes('://') || url.port) return [url.origin];
  return [`${url.origin}:8791`, url.origin];
}

export async function discoverHub(
  address: string,
  options: {
    nonce: string;
    signal: AbortSignal;
    keyId(key: JsonWebKey): Promise<string>;
    fetchImpl?: typeof fetch;
  },
): Promise<DiscoveredHub> {
  const endpoints = hubDiscoveryEndpoints(address);
  for (const endpoint of endpoints) {
    throwIfAborted(options.signal);
    try {
      const response = await (options.fetchImpl ?? fetch)(
        `${endpoint}/.well-known/dronehub?nonce=${encodeURIComponent(options.nonce)}`,
        {
          redirect: 'error',
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(5000)]),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const { signature, ...descriptor } = JSON.parse(
        await readBoundedHttpText(response, 16 * 1024),
      );
      const device = descriptor.device;
      if (
        descriptor.protocol !== 'dronehub-device-mesh' ||
        descriptor.protocolVersion !== 2 ||
        descriptor.nonce !== options.nonce ||
        descriptor.endpoint !== endpoint ||
        !device?.id ||
        typeof device.name !== 'string' ||
        !device.name.trim() ||
        (await options.keyId(device.publicKey)) !== device.id ||
        !verifyP256Signature(device.publicKey, canonicalJson(descriptor), signature)
      )
        throw new Error('Invalid Hub discovery proof');
      return { id: device.id, name: device.name, endpoint };
    } catch {
      throwIfAborted(options.signal);
    }
  }
  throw new Error(
    'No verified DroneHub found at that address. Check that both devices are connected to Tailscale and that Tailscale access is enabled on the desktop.',
  );
}
