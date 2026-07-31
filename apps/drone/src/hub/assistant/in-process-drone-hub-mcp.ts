import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';

import { createDroneHubMcpServer } from '../mcp-server';
import type { McpTokenIdentity } from '../mcp-tokens';
import { resolveEffectiveSpeechSettings } from '../hub-settings';

class LinkedTransport implements Transport {
  peer?: LinkedTransport;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private started = false;

  async start(): Promise<void> { this.started = true; }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.started) throw new Error('MCP transport is not started');
    const peer = this.peer;
    if (!peer) throw new Error('MCP transport is not linked');
    queueMicrotask(() => peer.onmessage?.(message));
  }

  async close(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const peer = this.peer;
    this.peer = undefined;
    if (peer) {
      peer.peer = undefined;
      peer.onclose?.();
    }
    this.onclose?.();
  }
}

function linkedTransports(): [LinkedTransport, LinkedTransport] {
  const client = new LinkedTransport();
  const server = new LinkedTransport();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

export async function createInProcessDroneHubMcpClient(input: {
  correlationId: string;
  allowedDroneRefs: string[];
  allowedWriteDroneRefs: string[];
  allowedDroneIds: string[];
  principal?: McpTokenIdentity;
  nativeThreadId?: string;
}): Promise<Client> {
  const speechSettings = await resolveEffectiveSpeechSettings();
  const principal = input.principal ?? {
    kind: 'host' as const,
    tokenId: `assistant:${input.correlationId}`,
    name: 'Drone Hub assistant',
  };
  const server = createDroneHubMcpServer({
    principal,
    speechEnabled: speechSettings.enabled,
    correlationId: input.correlationId,
    ...(input.nativeThreadId ? { nativeThreadId: input.nativeThreadId } : {}),
    ...(principal.kind === 'chat'
      ? {}
      : {
          allowedDroneRefs: input.allowedDroneRefs,
          allowedWriteDroneRefs: input.allowedWriteDroneRefs,
          allowedDroneIds: input.allowedDroneIds,
        }),
  });
  const client = new Client({ name: 'Drone Hub Blip host', version: '0.1.0' });
  const [clientTransport, serverTransport] = linkedTransports();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}
