import { randomUUID } from 'node:crypto';

export type ControlCommand = 'sleep' | 'off' | 'awake' | 'query_status';

export type SpeechAudioCommand = {
  type: 'speech_audio';
  id: string;
  source: string;
  text: string;
  contentType: string;
  audioBase64: string;
  createdAt: string;
  threadId?: string;
  messageId?: string;
};

export type SettingsChangedCommand = {
  type: 'settings_changed';
  settings: string;
  reason?: string;
  sentAt: string;
};

export type ReleaseChangedCommand = {
  type: 'release_changed';
  platform: 'android' | 'desktop';
  versionCode?: number | null;
  apkUrl?: string | null;
  sentAt: string;
};

export type ControlSocket = {
  send: (data: string) => void;
  close?: (code?: number, reason?: string) => void;
  readyState?: number;
};

export type PendingCommand = {
  commandId: string;
  deviceId: string;
  command: ControlCommand;
  reason: string;
  sentAt: string;
  resolve: (result: CommandDeliveryResult) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CommandDeliveryResult = {
  delivered: boolean;
  commandId: string;
  ack?: {
    ok: boolean;
    command: ControlCommand;
    mode?: string;
    status?: string;
    error?: string;
  };
};

const COMMAND_ACK_TIMEOUT_MS = 8_000;

export class ControlChannelRegistry {
  private readonly sockets = new Map<string, Set<ControlSocket>>();
  private readonly pending = new Map<string, PendingCommand>();

  register(deviceId: string, socket: ControlSocket): void {
    const bucket = this.sockets.get(deviceId) ?? new Set<ControlSocket>();
    bucket.add(socket);
    this.sockets.set(deviceId, bucket);
  }

  unregister(deviceId: string, socket: ControlSocket): void {
    const bucket = this.sockets.get(deviceId);
    if (!bucket) return;
    bucket.delete(socket);
    if (bucket.size === 0) this.sockets.delete(deviceId);
  }

  isConnected(deviceId: string): boolean {
    const bucket = this.sockets.get(deviceId);
    if (!bucket) return false;
    for (const socket of bucket) {
      if ((socket.readyState ?? 1) === 1) return true;
    }
    return false;
  }

  connectedDeviceIds(): string[] {
    return [...this.sockets.keys()].filter((deviceId) => this.isConnected(deviceId));
  }

  sendCommand(deviceId: string, command: ControlCommand, reason = 'dashboard'): Promise<CommandDeliveryResult> {
    const commandId = randomUUID();
    const sentAt = new Date().toISOString();
    const payload = JSON.stringify({
      type: 'server_command',
      commandId,
      command,
      reason,
      sentAt,
    });
    const delivered = this.broadcast(deviceId, payload);
    if (!delivered) {
      return Promise.resolve({ delivered: false, commandId });
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ delivered: true, commandId });
      }, COMMAND_ACK_TIMEOUT_MS);
      this.pending.set(commandId, {
        commandId,
        deviceId,
        command,
        reason,
        sentAt,
        resolve,
        timeout,
      });
    });
  }

  handleCommandAck(deviceId: string, message: any): void {
    const commandId = String(message?.commandId ?? '');
    if (!commandId) return;
    const pending = this.pending.get(commandId);
    if (!pending || pending.deviceId !== deviceId) return;
    clearTimeout(pending.timeout);
    this.pending.delete(commandId);
    pending.resolve({
      delivered: true,
      commandId,
      ack: {
        ok: Boolean(message?.ok ?? true),
        command: String(message?.command ?? pending.command) as ControlCommand,
        mode: typeof message?.mode === 'string' ? message.mode : undefined,
        status: typeof message?.status === 'string' ? message.status : undefined,
        error: typeof message?.error === 'string' ? message.error : undefined,
      },
    });
  }

  closeDevice(deviceId: string, code = 4403, reason = 'device revoked'): void {
    const bucket = this.sockets.get(deviceId);
    if (!bucket) return;
    for (const socket of bucket) {
      socket.close?.(code, reason);
    }
    this.sockets.delete(deviceId);
  }

  sendSpeechAudio(deviceId: string, payload: SpeechAudioCommand): boolean {
    return this.broadcast(deviceId, JSON.stringify(payload));
  }

  sendSettingsChanged(deviceId: string, settings: string, reason?: string): boolean {
    const payload: SettingsChangedCommand = {
      type: 'settings_changed',
      settings,
      ...(reason ? { reason } : {}),
      sentAt: new Date().toISOString(),
    };
    return this.broadcast(deviceId, JSON.stringify(payload));
  }

  sendReleaseChanged(deviceId: string, payload: Omit<ReleaseChangedCommand, 'type' | 'sentAt'>): boolean {
    return this.broadcast(deviceId, JSON.stringify({
      type: 'release_changed',
      ...payload,
      sentAt: new Date().toISOString(),
    } satisfies ReleaseChangedCommand));
  }

  private broadcast(deviceId: string, payload: string): boolean {
    const bucket = this.sockets.get(deviceId);
    if (!bucket || bucket.size === 0) return false;
    let sent = false;
    for (const socket of bucket) {
      if ((socket.readyState ?? 1) !== 1) continue;
      try {
        socket.send(payload);
        sent = true;
      } catch {
        bucket.delete(socket);
        socket.close?.();
      }
    }
    if (bucket.size === 0) this.sockets.delete(deviceId);
    return sent;
  }
}
