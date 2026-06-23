export const VOICE_STREAM_PROTOCOL_VERSION = 1;
export const MAX_STREAM_BYTES = 32 * 1024 * 1024;
export const MAX_STREAM_DURATION_MS = 15 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 15_000;

export const VoiceCloseCode = {
  InvalidMessage: 4400,
  Unauthorized: 4401,
  Revoked: 4403,
  ClientTooOld: 4406,
  PairingExpired: 4408,
  TooLarge: 4409,
  TooLong: 4410,
} as const;

export type ControlCommand = 'sleep' | 'off' | 'awake' | 'query_status';

export type ControlClientMessage =
  | { type: 'client_ping'; sentAt?: string }
  | { type: 'client_status'; mode?: string; status?: string; microphone?: string; protocolVersion?: number; clientVersion?: number; appVersion?: string; lastError?: string; reportedAt?: string }
  | { type: 'command_ack'; commandId?: string; ok?: boolean; command?: ControlCommand; mode?: string; status?: string; error?: string };

export type VoiceClientMessage =
  | { type: 'client_hello'; protocolVersion?: number; client?: string; mode?: string }
  | { type: 'client_ping'; sentAt?: string }
  | { type: 'pause'; reason?: string }
  | { type: 'resume'; reason?: string }
  | { type: 'cancel'; reason?: string }
  | { type: 'end'; reason?: string };

export function parseControlClientMessage(raw: unknown): ControlClientMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.type === 'client_ping') {
    return {
      type: 'client_ping',
      sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : undefined,
    };
  }
  if (parsed.type === 'client_status') {
    return {
      type: 'client_status',
      mode: typeof parsed.mode === 'string' ? parsed.mode.slice(0, 40) : undefined,
      status: typeof parsed.status === 'string' ? parsed.status.slice(0, 240) : undefined,
      microphone: typeof parsed.microphone === 'string' ? parsed.microphone.slice(0, 120) : undefined,
      protocolVersion: Number.isInteger(parsed.protocolVersion) ? parsed.protocolVersion : undefined,
      clientVersion: Number.isInteger(parsed.clientVersion) ? parsed.clientVersion : undefined,
      appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion.slice(0, 80) : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError.slice(0, 240) : undefined,
      reportedAt: typeof parsed.reportedAt === 'string' ? parsed.reportedAt : undefined,
    };
  }
  if (parsed.type === 'command_ack') {
    const command = parsed.command;
    const allowed: ControlCommand[] = ['sleep', 'off', 'awake', 'query_status'];
    return {
      type: 'command_ack',
      commandId: typeof parsed.commandId === 'string' ? parsed.commandId : undefined,
      ok: typeof parsed.ok === 'boolean' ? parsed.ok : undefined,
      command: allowed.includes(command) ? command : undefined,
      mode: typeof parsed.mode === 'string' ? parsed.mode.slice(0, 40) : undefined,
      status: typeof parsed.status === 'string' ? parsed.status.slice(0, 240) : undefined,
      error: typeof parsed.error === 'string' ? parsed.error.slice(0, 240) : undefined,
    };
  }
  return null;
}

export function parseVoiceClientMessage(raw: unknown): VoiceClientMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.type === 'client_hello') {
    return {
      type: 'client_hello',
      protocolVersion: Number.isInteger(parsed.protocolVersion) ? parsed.protocolVersion : undefined,
      client: typeof parsed.client === 'string' ? parsed.client.slice(0, 80) : undefined,
      mode: typeof parsed.mode === 'string' ? parsed.mode.slice(0, 40) : undefined,
    };
  }
  if (parsed.type === 'client_ping') {
    return {
      type: 'client_ping',
      sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : undefined,
    };
  }
  if (parsed.type === 'pause' || parsed.type === 'resume' || parsed.type === 'cancel') {
    return {
      type: parsed.type,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : undefined,
    };
  }
  if (parsed.type === 'end') {
    return {
      type: 'end',
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : undefined,
    };
  }
  return null;
}
