import { CompanionLiveSocket } from '../companion/CompanionLiveSocket';
import { companionLiveSettingsResponse, readCompanionLiveSettings, writeCompanionLiveSettings } from '../companion/companion-live-settings';

type Session = { id: string; socket: Pick<CompanionLiveSocket, 'handle' | 'close'>; events: Promise<void>; queuedBytes: number; congested: boolean };
type Options = {
  emit(deviceId: string, payload: Record<string, unknown>): Promise<void>;
  createSocket?(send: (message: unknown) => void): Session['socket'];
};

/** Device-owned Live sessions. PCM clients relay ordered audio over the mesh. */
export class CompanionLiveMeshSessions {
  private sessions = new Map<string, Session>();
  private retired = new Map<string, Set<string>>();
  private closed = false;

  constructor(private readonly options: Options) {}

  async invoke(deviceId: string, operation: string, payload: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error('Companion is shutting down.');
    if (operation === 'live.settings.get') return { enabled: (await readCompanionLiveSettings()).enabled };
    if (operation === 'live.settings.update') return {
      enabled: (await writeCompanionLiveSettings({ enabled: payload.enabled })).enabled,
    };
    if (operation === 'live.prompt.get') return companionLiveSettingsResponse(await readCompanionLiveSettings());
    if (operation === 'live.prompt.update') return companionLiveSettingsResponse(await writeCompanionLiveSettings({
      systemPrompt: payload.systemPrompt,
    }));
    const id = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!id || id.length > 200) throw new Error('A valid Live sessionId is required.');
    let session = this.sessions.get(deviceId);
    if (operation === 'live.close') {
      this.retire(deviceId, id);
      if (session?.id === id) { session.socket.close(); this.sessions.delete(deviceId); }
      return { ok: true };
    }
    if (operation === 'live.start') {
      if (this.retired.get(deviceId)?.has(id)) return { accepted: false };
      if (session?.id === id) return { accepted: true };
      if (session) { this.retire(deviceId, session.id); session.socket.close(); }
      let created!: Session;
      const socket = (this.options.createSocket ?? ((send) => new CompanionLiveSocket(send)))((message) => {
        if (this.sessions.get(deviceId) !== created) return;
        const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
        const isAudio = (message as { event?: { type?: string } })?.event?.type === 'session.output_audio.delta';
        if (isAudio && (created.congested || created.queuedBytes + bytes > 512_000)) {
          if (!created.congested) { created.congested = true; created.socket.close(); }
          return;
        }
        created.queuedBytes += bytes;
        created.events = created.events.catch(() => undefined).then(async () => {
          if (this.sessions.get(deviceId) !== created) return;
          await this.options.emit(deviceId, { sessionId: id, ...(message as Record<string, unknown>) });
        }).catch(() => { created.socket.close(); }).finally(() => { created.queuedBytes -= bytes; });
      });
      created = { id, socket, events: Promise.resolve(), queuedBytes: 0, congested: false };
      this.sessions.set(deviceId, created);
      socket.handle({ type: 'live_start', sdp: payload.sdp, transport: payload.transport });
      return { accepted: true };
    }
    if (session?.id !== id) return { ok: true };
    if (operation === 'live.event') session.socket.handle({ type: 'live_event', event: payload.event });
    else if (operation === 'live.ping') session.socket.handle({ type: 'live_ping' });
    else throw new Error(`Unsupported Live operation: ${operation}`);
    return { ok: true };
  }

  revokeDevice(deviceId: string): void {
    this.sessions.get(deviceId)?.socket.close();
    this.sessions.delete(deviceId);
    this.retired.delete(deviceId);
  }

  close(): void {
    this.closed = true;
    for (const deviceId of this.sessions.keys()) this.revokeDevice(deviceId);
  }

  private retire(deviceId: string, id: string): void {
    const ids = this.retired.get(deviceId) ?? new Set<string>();
    ids.add(id);
    if (ids.size > 64) ids.delete(ids.values().next().value!);
    this.retired.set(deviceId, ids);
  }
}
