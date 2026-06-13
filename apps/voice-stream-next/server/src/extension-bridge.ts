import { randomUUID } from 'node:crypto';
import { extensionToolName, type AssistantExtensionManifest, type AssistantExtensionToolRoute } from './assistant-extensions.js';

export type ExtensionBridgeSocket = {
  send: (data: string) => void;
  close?: (code?: number, reason?: string) => void;
  readyState?: number;
};

export type ExtensionBridgeRegistration = {
  userId: string;
  deviceId: string;
  deviceType: string;
  displayName: string;
  manifests: AssistantExtensionManifest[];
  connectedAt?: string;
};

export type ExtensionToolExecutionInput = {
  userId: string;
  toolName: string;
  args: unknown;
  route: AssistantExtensionToolRoute | null;
  threadId?: string;
  runId?: string | null;
  toolCallId?: string;
};

export type ExtensionBridgeConnection = ExtensionBridgeRegistration & {
  connectedAt: string;
  toolNames: string[];
};

type PendingExtensionToolCall = {
  requestId: string;
  userId: string;
  deviceId: string;
  responseType: 'extension_tool_result' | 'extension_approval_result';
  socket: ExtensionBridgeSocket;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const EXTENSION_TOOL_TIMEOUT_MS = 30_000;
const MAX_EXTENSION_RESULT_BYTES = 512 * 1024;

export class ExtensionBridgeRegistry {
  private readonly sockets = new Map<string, Set<ExtensionBridgeSocket>>();
  private readonly registrations = new Map<ExtensionBridgeSocket, ExtensionBridgeRegistration>();
  private readonly pending = new Map<string, PendingExtensionToolCall>();

  register(socket: ExtensionBridgeSocket, registration: ExtensionBridgeRegistration): void {
    this.unregister(socket);
    const bucket = this.sockets.get(registration.deviceId) ?? new Set<ExtensionBridgeSocket>();
    bucket.add(socket);
    this.sockets.set(registration.deviceId, bucket);
    this.registrations.set(socket, { ...registration, connectedAt: registration.connectedAt ?? new Date().toISOString() });
  }

  unregister(socket: ExtensionBridgeSocket): ExtensionBridgeRegistration | null {
    const registration = this.registrations.get(socket);
    if (!registration) return null;
    this.rejectPendingForSocket(socket, `extension runner disconnected: ${registration.displayName || registration.deviceId}`);
    const bucket = this.sockets.get(registration.deviceId);
    bucket?.delete(socket);
    if (bucket && bucket.size === 0) this.sockets.delete(registration.deviceId);
    this.registrations.delete(socket);
    return registration;
  }

  connectedDevices(userId?: string): ExtensionBridgeConnection[] {
    const rows: ExtensionBridgeConnection[] = [];
    for (const [socket, registration] of this.registrations) {
      if ((socket.readyState ?? 1) !== 1) continue;
      if (userId && registration.userId !== userId) continue;
      rows.push({
        ...registration,
        connectedAt: registration.connectedAt ?? '',
        toolNames: registration.manifests.flatMap((manifest) => manifest.tools.map((tool) => extensionToolName(manifest.id, tool.name))),
      });
    }
    return rows;
  }

  hasConnectedExtension(userId: string, extensionId: string): boolean {
    for (const [socket, registration] of this.registrations) {
      if ((socket.readyState ?? 1) !== 1) continue;
      if (registration.userId !== userId) continue;
      if (registration.manifests.some((manifest) => manifest.id === extensionId)) return true;
    }
    return false;
  }

  closeDevice(deviceId: string, code = 4403, reason = 'device revoked'): void {
    const bucket = this.sockets.get(deviceId);
    if (!bucket) return;
    for (const socket of [...bucket]) {
      socket.close?.(code, reason);
      this.unregister(socket);
    }
  }

  executeTool(input: ExtensionToolExecutionInput): Promise<unknown> {
    const target = this.resolveTarget(input);
    if (!target) {
      throw Object.assign(new Error(`no connected extension runner for ${input.toolName}`), { statusCode: 409 });
    }
    const requestId = randomUUID();
    const payload = JSON.stringify({
      type: 'extension_tool_request',
      requestId,
      toolName: input.toolName,
      args: input.args,
      threadId: input.threadId,
      runId: input.runId ?? null,
      toolCallId: input.toolCallId,
      sentAt: new Date().toISOString(),
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Object.assign(new Error(`extension tool timed out: ${input.toolName}`), { statusCode: 504 }));
      }, EXTENSION_TOOL_TIMEOUT_MS);
      this.pending.set(requestId, {
        requestId,
        userId: input.userId,
        deviceId: target.registration.deviceId,
        responseType: 'extension_tool_result',
        socket: target.socket,
        resolve,
        reject,
        timeout,
      });
      try {
        target.socket.send(payload);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(Object.assign(new Error(error instanceof Error ? error.message : String(error)), { statusCode: 502 }));
      }
    });
  }

  evaluateApproval(input: ExtensionToolExecutionInput): Promise<boolean> {
    const target = this.resolveTarget(input);
    if (!target) {
      throw Object.assign(new Error(`no connected extension runner for ${input.toolName}`), { statusCode: 409 });
    }
    const requestId = randomUUID();
    const payload = JSON.stringify({
      type: 'extension_approval_request',
      requestId,
      toolName: input.toolName,
      args: input.args,
      threadId: input.threadId,
      sentAt: new Date().toISOString(),
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Object.assign(new Error(`extension approval check timed out: ${input.toolName}`), { statusCode: 504 }));
      }, EXTENSION_TOOL_TIMEOUT_MS);
      this.pending.set(requestId, {
        requestId,
        userId: input.userId,
        deviceId: target.registration.deviceId,
        responseType: 'extension_approval_result',
        socket: target.socket,
        resolve: (result) => resolve(Boolean((result as any)?.approvalRequired)),
        reject,
        timeout,
      });
      try {
        target.socket.send(payload);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(Object.assign(new Error(error instanceof Error ? error.message : String(error)), { statusCode: 502 }));
      }
    });
  }

  handleClientMessage(deviceId: string, raw: unknown): boolean {
    const parsed = parseExtensionBridgeMessage(raw);
    if (!parsed || (parsed.type !== 'extension_tool_result' && parsed.type !== 'extension_approval_result')) return false;
    const pending = this.pending.get(parsed.requestId);
    if (!pending || pending.deviceId !== deviceId) return true;
    clearTimeout(pending.timeout);
    this.pending.delete(parsed.requestId);
    if (parsed.type !== pending.responseType) {
      pending.reject(Object.assign(new Error(`unexpected extension response type: ${parsed.type}`), { statusCode: 502 }));
      return true;
    }
    if (!parsed.ok) {
      const fallback = parsed.type === 'extension_approval_result' ? 'extension approval check failed' : 'extension tool failed';
      pending.reject(Object.assign(new Error(parsed.error || fallback), { statusCode: 502 }));
      return true;
    }
    pending.resolve(parsed.type === 'extension_approval_result' ? { approvalRequired: parsed.approvalRequired } : parsed.result);
    return true;
  }

  private resolveTarget(input: ExtensionToolExecutionInput): { socket: ExtensionBridgeSocket; registration: ExtensionBridgeRegistration } | null {
    if (input.route?.targetKind === 'server') return null;
    const targetDeviceId = input.route?.targetKind === 'device' ? input.route.targetDeviceId : null;
    for (const [socket, registration] of this.registrations) {
      if ((socket.readyState ?? 1) !== 1) continue;
      if (registration.userId !== input.userId) continue;
      if (targetDeviceId && registration.deviceId !== targetDeviceId) continue;
      if (!registrationSupportsTool(registration, input.toolName)) continue;
      return { socket, registration };
    }
    return null;
  }

  private rejectPendingForSocket(socket: ExtensionBridgeSocket, message: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      pending.reject(Object.assign(new Error(message), { statusCode: 409 }));
    }
  }
}

export function parseExtensionBridgeMessage(raw: unknown):
  | { type: 'extension_hello'; manifests: AssistantExtensionManifest[] }
  | { type: 'client_ping'; sentAt?: string }
  | { type: 'extension_tool_result'; requestId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'extension_approval_result'; requestId: string; ok: boolean; approvalRequired?: boolean; error?: string }
  | null {
  if (typeof raw !== 'string') return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.type === 'extension_hello') {
    return { type: 'extension_hello', manifests: Array.isArray(parsed.manifests) ? parsed.manifests : [] };
  }
  if (parsed.type === 'client_ping') {
    return { type: 'client_ping', sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : undefined };
  }
  if (parsed.type === 'extension_tool_result') {
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';
    if (!requestId) return null;
    const resultJson = parsed.result == null ? '' : JSON.stringify(parsed.result);
    if (Buffer.byteLength(resultJson, 'utf8') > MAX_EXTENSION_RESULT_BYTES) {
      return { type: 'extension_tool_result', requestId, ok: false, error: 'extension result is too large' };
    }
    return {
      type: 'extension_tool_result',
      requestId,
      ok: parsed.ok !== false,
      result: parsed.result,
      error: typeof parsed.error === 'string' ? parsed.error.slice(0, 1000) : undefined,
    };
  }
  if (parsed.type === 'extension_approval_result') {
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';
    if (!requestId) return null;
    return {
      type: 'extension_approval_result',
      requestId,
      ok: parsed.ok !== false,
      approvalRequired: parsed.approvalRequired !== false,
      error: typeof parsed.error === 'string' ? parsed.error.slice(0, 1000) : undefined,
    };
  }
  return null;
}

function registrationSupportsTool(registration: ExtensionBridgeRegistration, toolName: string): boolean {
  return registration.manifests.some((manifest) =>
    manifest.tools.some((tool) => extensionToolName(manifest.id, tool.name) === toolName),
  );
}
