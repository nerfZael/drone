import { WebSocket } from 'ws';
import { decodeLiveAudioFrame, sendLiveAudioFrame, type LiveAudioFrame, type LiveAudioSocket } from '@drone/device-protocol';
import { EventEmitter } from 'node:events';
import { gzip } from 'node:zlib';
import type http from 'node:http';
import { retainHubRequestTiming } from '../hub-performance-diagnostics';
import {
  DeviceHttpEventClient,
  DEVICE_HTTP_MAX_JSON_BYTES,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';

/** Duplex logical messages carried by HTTP replies and a server event subscription. */
export class DeviceHttpChannel extends EventEmitter {
  static readonly OPEN = 1;
  readyState = DeviceHttpChannel.OPEN;
  get bufferedAmount(): number {
    return this.client?.bufferedAmount ?? this.stream?.writableLength ?? 0;
  }
  private client?: DeviceHttpEventClient;
  audioAuthorized = false;
  private audioSocket?: LiveAudioSocket;
  private audioOpening?: Promise<void>;
  private audioReadyWaiters: Array<{ resolve(): void; reject(error: Error): void }> = [];

  attachLiveAudio(socket: LiveAudioSocket): void {
    if (!this.audioAuthorized || this.audioSocket || this.readyState !== 1) throw new Error('Live audio channel is unavailable');
    this.audioSocket = socket; socket.binaryType = 'arraybuffer';
    socket.onmessage = ({ data }) => {
      try { this.emit('liveAudio', decodeLiveAudioFrame(data)); }
      catch { socket.close(); }
    };
    socket.onclose = () => { this.audioSocket = undefined; this.audioOpening = undefined; this.emit('liveAudioClosed'); };
    socket.onerror = () => socket.close();
    for (const waiter of this.audioReadyWaiters.splice(0)) waiter.resolve();
  }

  async ensureLiveAudio(): Promise<void> {
    if (this.audioSocket?.readyState === 1) return;
    if (this.audioOpening) return this.audioOpening;
    if (this.client) {
      this.audioOpening = this.client.openLiveAudioSocket((url) => new WebSocket(url) as unknown as LiveAudioSocket)
        .then((socket) => this.attachLiveAudio(socket));
    } else {
      this.audioOpening = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.audioReadyWaiters = this.audioReadyWaiters.filter((item) => item !== waiter); reject(new Error('Live audio channel timed out')); }, 10_000);
        const waiter = { resolve: () => { clearTimeout(timer); resolve(); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
        this.audioReadyWaiters.push(waiter);
      });
    }
    const opening = this.audioOpening;
    try { await opening; }
    catch (error) { if (this.audioOpening === opening) this.audioOpening = undefined; throw error; }
  }

  closeLiveAudio(): void { this.audioSocket?.close(); }

  async sendLiveAudio(frame: LiveAudioFrame, active: () => boolean = () => true): Promise<void> {
    if ((frame.closed || frame.aborted) && this.audioSocket?.readyState !== 1) return;
    await this.ensureLiveAudio();
    if (!this.audioSocket) return Promise.reject(new Error('Live audio channel unavailable'));
    return sendLiveAudioFrame(this.audioSocket, frame, active);
  }

  private readonly replies = new Map<string, http.ServerResponse>();
  private readonly compressedReplies = new WeakSet<http.ServerResponse>();
  private readonly pendingResults = new Map<string, SignedCapabilityRequest>();
  takeResultRequest(id: string, source: string): SignedCapabilityRequest | undefined {
    const key = `${source}:${id}`;
    const request = this.pendingResults.get(key);
    this.pendingResults.delete(key);
    return request && Date.parse(request.expiresAt) > Date.now() ? request : undefined;
  }
  get lastEventId(): string {
    return this.client?.lastEventId ?? '';
  }
  isHttpMessage(data: string): boolean {
    if (this.client) return true;
    const message = JSON.parse(data);
    return (
      message.type === 'capability.response' &&
      this.replies.has(`${message.targetDeviceId}:${message.requestId}`)
    );
  }

  constructor(private readonly stream?: http.ServerResponse) {
    super();
  }

  static connect(endpoint: string, deviceId: string, lastEventId = ''): DeviceHttpChannel {
    const channel = new DeviceHttpChannel();
    const client = new DeviceHttpEventClient(endpoint, deviceId, fetch, lastEventId);
    channel.client = client;
    client.onmessage = ({ data }) => channel.emit('message', data);
    client.onerror = (error) => {
      if (channel.listenerCount('error')) channel.emit('error', error);
    };
    client.onclose = () => channel.close();
    return channel;
  }

  receive(data: string, response: http.ServerResponse, acceptsGzip = false): void {
    const message = JSON.parse(data);
    if (message?.type === 'capability.response')
      this.pendingResults.delete(`${message.targetDeviceId}:${message.requestId}`);
    if (message?.type === 'capability.request') {
      if (message.capability === 'drone-control' && ['chat.read', 'files.list', 'file.preview'].includes(message.operation))
        retainHubRequestTiming(response);
      const key = `${message.sourceDeviceId}:${message.requestId}`;
      if (this.replies.has(key) || this.replies.size >= 100) {
        response.writeHead(409).end();
        return;
      }
      this.replies.set(key, response);
      if (acceptsGzip) this.compressedReplies.add(response);
      const timer = setTimeout(() => {
        this.replies.delete(key);
        if (!response.writableEnded) response.writeHead(504).end();
      }, 65_000);
      timer.unref?.();
      response.once('close', () => {
        clearTimeout(timer);
        if (this.replies.get(key) === response) this.replies.delete(key);
      });
    } else {
      response.writeHead(204).end();
    }
    this.emit('message', data);
  }

  send(data: string, callback?: (error?: Error) => void, cursor?: string): void {
    if (this.readyState !== DeviceHttpChannel.OPEN) throw new Error('Device channel is closed');
    if (this.client) {
      this.client.send(data, callback);
      return;
    }
    const message = JSON.parse(data);
    if (
      message.type === 'capability.request' &&
      message.capability === 'drone-control' &&
      message.operation === 'file.preview'
    ) {
      for (const [id, pending] of this.pendingResults)
        if (Date.parse(pending.expiresAt) <= Date.now()) this.pendingResults.delete(id);
      if (this.pendingResults.size < 100)
        this.pendingResults.set(`${message.sourceDeviceId}:${message.requestId}`, message);
    }
    const key = `${message.targetDeviceId}:${message.requestId}`;
    const reply = message.type === 'capability.response' ? this.replies.get(key) : undefined;
    if (reply) {
      this.replies.delete(key);
      if (this.compressedReplies.has(reply) && Buffer.byteLength(data) > 1024) {
        gzip(data, (error, body) => {
          if (error) {
            reply.destroy(error);
            callback?.(error);
            return;
          }
          if (!reply.destroyed)
            reply
              .writeHead(200, {
                'content-type': 'application/json',
                'cache-control': 'no-store',
                'content-encoding': 'gzip',
                vary: 'Accept-Encoding',
              })
              .end(body);
          callback?.();
        });
        return;
      }
      reply
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(data);
    } else {
      if (!this.stream || this.stream.destroyed) throw new Error('Device event stream is closed');
      if (this.stream.writableLength + Buffer.byteLength(data) > DEVICE_HTTP_MAX_JSON_BYTES) {
        this.close();
        throw new Error('Device event subscriber is too slow');
      }
      this.stream.write(`${cursor ? `id: ${cursor}\n` : ''}data: ${data}\n\n`);
    }
    callback?.();
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.client?.close();
    this.audioSocket?.close();
    for (const waiter of this.audioReadyWaiters.splice(0)) waiter.reject(new Error('Device disconnected'));
    this.stream?.end();
    for (const response of this.replies.values())
      if (!response.writableEnded) response.writeHead(503).end();
    this.replies.clear();
    this.pendingResults.clear();
    this.emit('close');
  }
}
