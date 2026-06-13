export const PAIRING_PAYLOAD_VERSION = 1;
export const DEFAULT_PAIRING_TTL_MS = 15 * 60 * 1000;

export type PairingPayloadInput = {
  serverUrl: string;
  deviceId: string;
  token: string;
  deviceType: string;
  displayName: string;
  protocolVersion: number;
  expiresAt: string;
  pairingSessionId: string;
  apkUrl?: string | null;
};

export type PairingPayload = PairingPayloadInput & {
  version: number;
  minClientVersion: number;
};

export function minClientVersion(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_MIN_CLIENT_VERSION ?? 1);
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

export function pairingTtlMs(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_PAIRING_TTL_MS ?? DEFAULT_PAIRING_TTL_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PAIRING_TTL_MS;
}

export function pairingExpiresAt(from = Date.now()): string {
  return new Date(from + pairingTtlMs()).toISOString();
}

export function buildPairingPayload(input: PairingPayloadInput): { payload: PairingPayload; payloadUri: string } {
  const payload: PairingPayload = {
    ...input,
    version: PAIRING_PAYLOAD_VERSION,
    minClientVersion: minClientVersion(),
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'apkUrl') {
      if (value) params.set('apk', String(value));
      continue;
    }
    params.set(key, String(value));
  }
  return {
    payload,
    payloadUri: `voicestream://pair?${params.toString()}`,
  };
}

export function buildUpdatePayload(input: { versionCode: number; apkUrl: string }): string {
  const params = new URLSearchParams();
  params.set('versionCode', String(input.versionCode));
  params.set('apk', input.apkUrl);
  return `voicestream://update?${params.toString()}`;
}

export function parseClientVersion(raw: unknown, fallback: number | null = null): number | null {
  if (Number.isInteger(raw)) return Number(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const leading = trimmed.match(/^(\d+)/);
    if (leading) return Number(leading[1]);
  }
  return fallback;
}

export function clientVersionSupported(clientVersion: number | null): boolean {
  if (clientVersion == null) return true;
  return clientVersion >= minClientVersion();
}

export type ParsedPairingPayload = Omit<PairingPayload, 'token'> & {
  token: string;
};

export function parsePairingPayload(raw: string): ParsedPairingPayload {
  const trimmed = raw.trim();
  if (!trimmed) throw Object.assign(new Error('pairing payload is empty'), { statusCode: 400 });

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('pairing payload is not a valid URI'), { statusCode: 400 });
  }

  if (url.protocol !== 'voicestream:' || url.hostname !== 'pair') {
    throw Object.assign(new Error('pairing payload must use voicestream://pair'), { statusCode: 400 });
  }

  const read = (key: keyof PairingPayload): string => {
    const value = url.searchParams.get(key)?.trim() ?? '';
    if (!value) throw Object.assign(new Error(`pairing payload missing ${key}`), { statusCode: 400 });
    return value;
  };

  const version = parseClientVersion(url.searchParams.get('version'), null);
  if (version == null || version < 1) {
    throw Object.assign(new Error('pairing payload missing version'), { statusCode: 400 });
  }

  const protocolVersion = parseClientVersion(url.searchParams.get('protocolVersion'), null);
  if (protocolVersion == null || protocolVersion < 1) {
    throw Object.assign(new Error('pairing payload missing protocolVersion'), { statusCode: 400 });
  }

  const parsedMinClientVersion = parseClientVersion(url.searchParams.get('minClientVersion'), minClientVersion()) ?? minClientVersion();

  return {
    version,
    serverUrl: read('serverUrl').replace(/\/+$/, ''),
    deviceId: read('deviceId'),
    token: read('token'),
    deviceType: read('deviceType'),
    displayName: read('displayName'),
    protocolVersion,
    expiresAt: read('expiresAt'),
    pairingSessionId: read('pairingSessionId'),
    minClientVersion: parsedMinClientVersion,
    apkUrl: url.searchParams.get('apk')?.trim() || null,
  };
}
