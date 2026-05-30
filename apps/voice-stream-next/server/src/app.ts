import path from 'node:path';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { VoiceStreamNextDb, type DeviceRecord, type SpeechPlaybackTarget } from './db.js';
import { requireAdmin, resolveRequestUser, type AuthContext } from './auth.js';
import { synthesizeSpeech, transcribePcm16 } from './assistant-runtime.js';
import {
  StreamingTranscriptionManager,
  buildStreamingTranscriptionConfigFromEnv,
  streamingTranscriptionEnabled,
  type TerminalCommand,
} from './streaming-transcription.js';
import { approvalCodeFromText } from './approval-code.js';
import { parseVoiceApprovalSettings, voiceApprovalSettingsResponse } from './voice-approval-settings.js';
import {
  assistantAvailableToolSummaries,
  assistantSnapshot,
  promptAssistantThread,
  resolveAssistantApproval,
  sanitizeArtifactPath,
  setAssistantExternalToolApprovalEvaluator,
  setAssistantExternalToolExecutor,
} from './assistant-parity.js';
import {
  cleanTargetKind,
  extensionToolName,
  parseAssistantExtensionManifest,
} from './assistant-extensions.js';
import { ExtensionBridgeRegistry, parseExtensionBridgeMessage } from './extension-bridge.js';
import {
  createCodexAuthorizationFlow,
  exchangeCodexAuthorizationCode,
  parseCodexAuthorizationInput,
} from './codex-auth.js';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_STREAM_BYTES,
  MAX_STREAM_DURATION_MS,
  VOICE_STREAM_PROTOCOL_VERSION,
  VoiceCloseCode,
  parseControlClientMessage,
  parseVoiceClientMessage,
  type ControlCommand,
} from './protocol.js';
import { buildPairingPayload, buildUpdatePayload, minClientVersion, pairingExpiresAt, parseClientVersion } from './pairing.js';
import { ControlChannelRegistry, type SpeechAudioCommand } from './control-channel.js';
import type { DeviceAuthResult } from './db.js';

type AppOptions = {
  logger?: boolean;
};

type AndroidApkInfo = {
  available: boolean;
  platform: 'android';
  app: string;
  variant: string | null;
  versionCode: number | null;
  versionName: string | null;
  fileName: string | null;
  size: number | null;
  builtAt: string | null;
  downloadUrl: string | null;
  updatePayload: string | null;
};

type DesktopAppInfo = {
  available: boolean;
  platform: 'desktop';
  app: string;
  variant: string | null;
  fileName: string | null;
  size: number | null;
  builtAt: string | null;
  downloadUrl: string | null;
};

type AppEventType =
  | 'assistant_changed'
  | 'device_changed'
  | 'device_connected'
  | 'device_disconnected'
  | 'client_status_changed'
  | 'settings_changed'
  | 'speech_playback_changed'
  | 'log_created'
  | 'transcript_created'
  | 'approval_code_created'
  | 'release_changed'
  | 'setup_changed';

function parsePort(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function uploadLimitBytes(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_RELEASE_UPLOAD_LIMIT_BYTES ?? 1024 * 1024 * 1024);
  return Number.isInteger(raw) && raw > 0 ? raw : 1024 * 1024 * 1024;
}

function jsonBody(req: FastifyRequest): any {
  return req.body && typeof req.body === 'object' ? (req.body as any) : {};
}

function extensionDefaultTargetDeviceId(defaultTarget: string, deviceId: string): string | null {
  return defaultTarget === 'device' ? deviceId : null;
}

function shouldEnableRegisteredExtensionRoute(
  route: { enabled: boolean; targetKind: string; targetDeviceId: string | null },
  defaultTarget: string,
  defaultTargetDeviceId: string | null,
): boolean {
  if (route.enabled || defaultTarget === 'server') return false;
  if (route.targetKind !== defaultTarget) return false;
  return route.targetKind !== 'device' || route.targetDeviceId === defaultTargetDeviceId;
}

function cleanText(raw: unknown, fallback = ''): string {
  return String(raw ?? fallback).trim();
}

function cleanCode(raw: unknown, label: string): string {
  const value = String(raw ?? '').replace(/\D/g, '');
  if (!value || value.length > 12) throw Object.assign(new Error(`${label} must be 1-12 digits`), { statusCode: 400 });
  return value;
}

function cleanVoiceStreamMode(raw: string): 'assistant' | 'patch' | 'clipboard' {
  return raw === 'patch' || raw === 'clipboard' ? raw : 'assistant';
}

function cleanSpeechPlaybackTarget(raw: unknown): SpeechPlaybackTarget {
  const value = cleanText(raw, 'auto').toLowerCase();
  return value === 'web' || value === 'desktop' || value === 'android' || value === 'auto' ? value : 'auto';
}

function cleanPairableDeviceType(raw: unknown, fallback: 'desktop' | 'android'): 'desktop' | 'android' {
  const value = cleanText(raw, fallback).toLowerCase();
  return value === 'android' || value === 'desktop' ? value : fallback;
}

function speakTextFromResult(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  return cleanText((result as any).text);
}

function speakTextFromArgsJson(raw: unknown): string {
  try {
    return speakTextFromResult(JSON.parse(String(raw ?? '{}')));
  } catch {
    return '';
  }
}

function cleanDeviceMode(raw: unknown): string {
  const mode = cleanText(raw, 'off').toLowerCase();
  return ['off', 'awake', 'sleeping', 'recording', 'transcribing', 'error'].includes(mode) ? mode : 'error';
}

function desktopAuthExpiresAt(from = Date.now()): string {
  const raw = Number(process.env.VOICE_STREAM_NEXT_DESKTOP_AUTH_TTL_MS ?? 10 * 60 * 1000);
  const ttlMs = Number.isInteger(raw) && raw > 0 ? raw : 10 * 60 * 1000;
  return new Date(from + ttlMs).toISOString();
}

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function voiceStreamDataDir(): string {
  return path.resolve(
    process.env.VOICE_STREAM_NEXT_DATA_DIR?.trim() ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ||
      path.join(process.cwd(), 'server', 'data'),
  );
}

function androidApkDir(): string {
  return path.join(voiceStreamDataDir(), 'mobile', 'Android');
}

function androidApkDownloadPath(): string {
  return '/api/mobile/android/apk';
}

function desktopAppDir(): string {
  return process.env.VOICE_STREAM_NEXT_DESKTOP_DOWNLOAD_DIR?.trim() || path.join(voiceStreamDataDir(), 'desktop');
}

function desktopAppDownloadPath(): string {
  return '/api/desktop/download';
}

function safeReleaseVariant(raw: unknown, fallback: string): string {
  return cleanText(raw, fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function safeReleaseFileName(raw: unknown, fallback: string): string {
  const baseName = path.basename(cleanText(raw, fallback) || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return baseName || fallback;
}

function headerValue(raw: unknown): string {
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').trim();
}

function releaseUploadMetadata(req: FastifyRequest, platform: 'android' | 'desktop'): Record<string, unknown> {
  const raw = headerValue(req.headers['x-voice-release-metadata']);
  if (!raw) throw Object.assign(new Error(`${platform} release metadata file is required`), { statusCode: 400 });
  let metadata: any = null;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error(`${platform} release metadata must be valid JSON`), { statusCode: 400 });
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw Object.assign(new Error(`${platform} release metadata must be a JSON object`), { statusCode: 400 });
  }
  if (cleanText(metadata.platform).toLowerCase() !== platform) {
    throw Object.assign(new Error(`${platform} release metadata has the wrong platform`), { statusCode: 400 });
  }
  return metadata;
}

function requiredMetadataText(metadata: Record<string, unknown>, key: string, label: string): string {
  const value = cleanText(metadata[key]);
  if (!value) throw Object.assign(new Error(`${label} is required in release metadata`), { statusCode: 400 });
  return value;
}

function releaseUploadFileName(req: FastifyRequest, fallback: string): string {
  return safeReleaseFileName(req.headers['x-voice-release-file-name'], fallback);
}

function publicUrlForPath(req: FastifyRequest, urlPath: string): string {
  return `${serverPublicUrl(req)}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
}

function readAndroidApkInfo(req: FastifyRequest): AndroidApkInfo {
  const metadataFile = path.join(androidApkDir(), 'latest.json');
  const fallback = {
    available: false,
    platform: 'android' as const,
    app: 'voice-stream-next',
    variant: null,
    versionCode: null,
    versionName: null,
    fileName: null,
    size: null,
    builtAt: null,
    downloadUrl: null,
    updatePayload: null,
  };
  if (!existsSync(metadataFile)) return fallback;

  let metadata: any = null;
  try {
    metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  } catch {
    return fallback;
  }

  const fileName = path.basename(cleanText(metadata.fileName, 'voice-stream-next-android-latest.apk'));
  const apkFile = path.join(androidApkDir(), fileName);
  if (!existsSync(apkFile)) return fallback;

  const stat = statSync(apkFile);
  const versionCode = parseClientVersion(metadata.versionCode, null);
  const downloadUrl = publicUrlForPath(req, androidApkDownloadPath());
  return {
    available: true,
    platform: 'android',
    app: cleanText(metadata.app, 'voice-stream-next') || 'voice-stream-next',
    variant: cleanText(metadata.variant) || null,
    versionCode,
    versionName: cleanText(metadata.versionName) || null,
    fileName,
    size: stat.size,
    builtAt: cleanText(metadata.builtAt) || null,
    downloadUrl,
    updatePayload: versionCode ? buildUpdatePayload({ versionCode, apkUrl: downloadUrl }) : null,
  };
}

function writeAndroidApkRelease(req: FastifyRequest, body: unknown): AndroidApkInfo {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body instanceof Uint8Array ? body : []);
  if (buffer.byteLength === 0) throw Object.assign(new Error('APK upload is empty'), { statusCode: 400 });
  const releaseMetadata = releaseUploadMetadata(req, 'android');
  const variant = safeReleaseVariant(requiredMetadataText(releaseMetadata, 'variant', 'Android variant'), 'manual');
  const versionCode = parseClientVersion(releaseMetadata.versionCode, null);
  if (versionCode == null) throw Object.assign(new Error('Android versionCode is required in release metadata'), { statusCode: 400 });
  const versionName = requiredMetadataText(releaseMetadata, 'versionName', 'Android versionName');
  const latestFileName = 'voice-stream-next-android-latest.apk';
  const variantFileName = `voice-stream-next-android-${variant}.apk`;
  const outputDir = androidApkDir();
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, variantFileName), buffer);
  writeFileSync(path.join(outputDir, latestFileName), buffer);
  const metadata = {
    app: 'voice-stream-next',
    platform: 'android',
    variant,
    versionCode,
    versionName,
    fileName: latestFileName,
    variantFileName,
    size: buffer.byteLength,
    builtAt: cleanText(releaseMetadata.builtAt) || new Date().toISOString(),
  };
  writeFileSync(path.join(outputDir, 'latest.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return readAndroidApkInfo(req);
}

function newestDesktopArtifact(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((fileName) => /\.(zip|dmg|exe|appimage|tar\.gz)$/i.test(fileName))
    .map((fileName) => ({ fileName, stat: statSync(path.join(dir, fileName)) }))
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return candidates[0]?.fileName ?? null;
}

function readDesktopAppInfo(req: FastifyRequest): DesktopAppInfo {
  const dir = desktopAppDir();
  const fallback = {
    available: false,
    platform: 'desktop' as const,
    app: 'voice-stream-next',
    variant: null,
    fileName: null,
    size: null,
    builtAt: null,
    downloadUrl: null,
  };

  let metadata: any = null;
  const metadataFile = path.join(dir, 'latest.json');
  if (existsSync(metadataFile)) {
    try {
      metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
    } catch {
      metadata = null;
    }
  }

  const fileName = path.basename(cleanText(metadata?.fileName) || newestDesktopArtifact(dir) || '');
  if (!fileName) return fallback;
  const artifactFile = path.join(dir, fileName);
  if (!existsSync(artifactFile)) return fallback;
  const stat = statSync(artifactFile);
  if (!stat.isFile()) return fallback;

  return {
    available: true,
    platform: 'desktop',
    app: cleanText(metadata?.app, 'voice-stream-next') || 'voice-stream-next',
    variant: cleanText(metadata?.variant) || null,
    fileName,
    size: stat.size,
    builtAt: cleanText(metadata?.builtAt) || stat.mtime.toISOString(),
    downloadUrl: publicUrlForPath(req, desktopAppDownloadPath()),
  };
}

function writeDesktopAppRelease(req: FastifyRequest, body: unknown): DesktopAppInfo {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body instanceof Uint8Array ? body : []);
  if (buffer.byteLength === 0) throw Object.assign(new Error('Desktop upload is empty'), { statusCode: 400 });
  const releaseMetadata = releaseUploadMetadata(req, 'desktop');
  const requestedFileName = releaseUploadFileName(req, safeReleaseFileName(releaseMetadata.fileName, 'voice-stream-next-desktop-latest.tar.gz'));
  if (!/\.(zip|dmg|exe|appimage|tar\.gz|tgz)$/i.test(requestedFileName)) {
    throw Object.assign(new Error('Desktop upload must be .zip, .dmg, .exe, .AppImage, .tgz, or .tar.gz'), { statusCode: 400 });
  }
  const extension = requestedFileName.match(/\.tar\.gz$/i) ? '.tar.gz' : path.extname(requestedFileName);
  const variant = safeReleaseVariant(requiredMetadataText(releaseMetadata, 'variant', 'Desktop variant'), 'manual');
  const latestFileName = `voice-stream-next-desktop-latest${extension}`;
  const variantFileName = `voice-stream-next-desktop-${variant}${extension}`;
  const outputDir = desktopAppDir();
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, variantFileName), buffer);
  writeFileSync(path.join(outputDir, latestFileName), buffer);
  const metadata = {
    app: 'voice-stream-next',
    platform: 'desktop',
    variant,
    fileName: latestFileName,
    variantFileName,
    size: buffer.byteLength,
    builtAt: cleanText(releaseMetadata.builtAt) || new Date().toISOString(),
  };
  writeFileSync(path.join(outputDir, 'latest.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return readDesktopAppInfo(req);
}

function desktopContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.appimage')) return 'application/octet-stream';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
  return 'application/octet-stream';
}

function binarySize(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, item) => total + binarySize(item), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

function binaryChunk(data: unknown): Uint8Array | null {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function serverPublicUrl(req: FastifyRequest): string {
  const configured = process.env.VOICE_STREAM_NEXT_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const origin = originUrl(req.headers.origin);
  if (origin) return origin;
  const proto = forwardedProto || String((req as any).protocol ?? 'http');
  const host = forwardedHost || firstHeaderValue(req.headers.host);
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function firstHeaderValue(raw: unknown): string {
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',')[0].trim();
}

function originUrl(raw: unknown): string {
  const value = firstHeaderValue(raw);
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function deviceAuthFailureMessage(result: Extract<DeviceAuthResult, { ok: false }>): string {
  switch (result.reason) {
    case 'revoked':
      return 'device revoked';
    case 'pairing_expired':
      return 'pairing payload expired';
    case 'client_too_old':
      return `client version below minimum ${result.minClientVersion ?? minClientVersion()}`;
    case 'invalid_token':
      return 'invalid device token';
    default:
      return 'unknown device';
  }
}

function deviceAuthCloseCode(result: Extract<DeviceAuthResult, { ok: false }>): number {
  switch (result.reason) {
    case 'revoked':
      return VoiceCloseCode.Revoked;
    case 'pairing_expired':
      return VoiceCloseCode.PairingExpired;
    case 'client_too_old':
      return VoiceCloseCode.ClientTooOld;
    default:
      return VoiceCloseCode.Unauthorized;
  }
}

function setupFailureStatus(reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed'): number {
  if (reason === 'expired' || reason === 'claimed') return 409;
  if (reason === 'invalid_secret') return 401;
  return 404;
}

function setupFailureMessage(reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed'): string {
  switch (reason) {
    case 'expired':
      return 'Android setup QR expired';
    case 'claimed':
      return 'Android setup QR was already used';
    case 'invalid_secret':
      return 'invalid Android setup QR';
    default:
      return 'unknown Android setup QR';
  }
}

function verifyDeviceAuth(
  db: VoiceStreamNextDb,
  deviceId: string,
  token: string,
  clientVersion?: number | null,
): DeviceAuthResult {
  return db.verifyDeviceToken(deviceId, token, {
    clientVersion,
    minClientVersion: minClientVersion(),
  });
}

function resolveDeviceInstallation(
  db: VoiceStreamNextDb,
  device: DeviceRecord,
  installationId: string | null,
  token: string,
): DeviceRecord {
  return installationId ? db.assignDeviceInstallationId(device.userId, device.id, installationId, token) ?? device : device;
}

function cleanControlCommand(raw: unknown): ControlCommand {
  const value = cleanText(raw).toLowerCase();
  if (value === 'sleep' || value === 'off' || value === 'awake' || value === 'query_status') return value;
  throw Object.assign(new Error('command must be sleep, off, awake, or query_status'), { statusCode: 400 });
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function withUser<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  db: VoiceStreamNextDb,
  clerkEnabled: boolean,
  fn: (ctx: AuthContext) => Promise<T> | T,
): Promise<T | undefined> {
  try {
    const ctx = await resolveRequestUser(req, db, clerkEnabled);
    return await fn(ctx);
  } catch (error: any) {
    const status = Number(error?.statusCode ?? 0) || 500;
    reply.code(status).send({ ok: false, error: error?.message ?? String(error) });
    return undefined;
  }
}

export async function buildApp(options: AppOptions = {}): Promise<{ app: FastifyInstance; db: VoiceStreamNextDb; port: number }> {
  const app = Fastify({ logger: options.logger ?? true });
  const db = new VoiceStreamNextDb();
  const controlChannels = new ControlChannelRegistry();
  const extensionBridges = new ExtensionBridgeRegistry();
  const appEventClients = new Set<{ res: any; userId: string; admin: boolean }>();
  const speechEventClients = new Set<{ id: string; res: any; userId: string; connectedAt: string }>();
  let appEventSequence = 0;
  const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY?.trim());
  const port = parsePort(process.env.VOICE_STREAM_NEXT_API_PORT ?? process.env.PORT, 3299);

  db.clearAssistantExtensionManifests();

  setAssistantExternalToolExecutor(async (input) => {
    if (input.route?.targetKind === 'server') {
      throw Object.assign(new Error(`${input.toolName} is configured for server execution, but no server-side extension runner is installed`), { statusCode: 501 });
    }
    return extensionBridges.executeTool({
      userId: input.userId,
      toolName: input.toolName,
      args: input.args,
      route: input.route,
      threadId: input.thread.id,
      runId: input.runId,
      toolCallId: input.toolCallId,
    });
  });
  setAssistantExternalToolApprovalEvaluator(async (input) => {
    if (input.route?.targetKind === 'server') return true;
    return extensionBridges.evaluateApproval({
      userId: input.userId,
      toolName: input.toolName,
      args: input.args,
      route: input.route,
      threadId: input.thread.id,
    });
  });

  const writeSseEvent = (res: any, event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const emitAppEvent = (userId: string | null, type: AppEventType, data: Record<string, unknown> = {}) => {
    const event = {
      type,
      sequence: ++appEventSequence,
      at: new Date().toISOString(),
      ...(userId ? { userId } : {}),
      ...data,
    };
    for (const client of [...appEventClients]) {
      if (client.res.destroyed || client.res.writableEnded) {
        appEventClients.delete(client);
        continue;
      }
      if (userId && client.userId !== userId && !client.admin) continue;
      writeSseEvent(client.res, 'app_event', event);
    }
  };

  const emitAssistantChange = (reason: string, threadId?: string, userId?: string) => {
    emitAppEvent(userId ?? null, 'assistant_changed', { reason, ...(threadId ? { threadId } : {}) });
  };

  const addLog = (
    userId: string,
    input: { deviceId?: string | null; source: string; level: string; message: string; detailsJson?: string | null },
  ) => {
    const log = db.addLog(userId, input);
    emitAppEvent(userId, 'log_created', { logId: log.id, deviceId: log.deviceId });
    return log;
  };

  const addApprovalCode = (
    userId: string,
    input: { voiceSessionId?: string | null; code: string; source: string },
  ) => {
    const approvalCode = db.addApprovalCode(userId, input);
    emitAppEvent(userId, 'approval_code_created', { approvalCodeId: approvalCode.id, voiceSessionId: approvalCode.voiceSessionId });
    return approvalCode;
  };

  const addTranscript = (userId: string, voiceSessionId: string, text: string) => {
    db.addTranscript(userId, voiceSessionId, text);
    emitAppEvent(userId, 'transcript_created', { voiceSessionId });
  };

  type SpeechSurface = 'web' | 'desktop' | 'android';
  type SpeechDestination = {
    surface: SpeechSurface;
    deviceId?: string;
    clientId?: string;
    activityAt: string;
  };
  const speechQueues = new Map<string, Promise<void>>();

  const latestSpeechClientForUser = (userId: string): SpeechDestination | null => {
    let latest: SpeechDestination | null = null;
    for (const client of [...speechEventClients]) {
      if (client.res.destroyed || client.res.writableEnded) {
        speechEventClients.delete(client);
        continue;
      }
      if (client.userId !== userId) continue;
      if (!latest || Date.parse(client.connectedAt) > Date.parse(latest.activityAt)) {
        latest = { surface: 'web', clientId: client.id, activityAt: client.connectedAt };
      }
    }
    return latest;
  };

  const connectedSpeechDestinations = (userId: string): SpeechDestination[] => {
    const destinations: SpeechDestination[] = [];
    const web = latestSpeechClientForUser(userId);
    if (web) destinations.push(web);
    const clientStatuses = new Map(db.listClientStatuses(userId).map((status) => [status.deviceId, status]));
    for (const deviceId of controlChannels.connectedDeviceIds()) {
      const device = db.deviceForUser(userId, deviceId);
      if (!device || device.revokedAt) continue;
      const surface = device.deviceType === 'android' ? 'android' : device.deviceType === 'desktop' ? 'desktop' : null;
      if (!surface) continue;
      const destination: SpeechDestination = { surface, deviceId, activityAt: clientStatuses.get(deviceId)?.updatedAt ?? device.lastSeenAt };
      const existingIndex = destinations.findIndex((item) => item.surface === surface);
      if (existingIndex < 0) {
        destinations.push(destination);
      } else if (Date.parse(destination.activityAt) >= Date.parse(destinations[existingIndex]!.activityAt)) {
        destinations[existingIndex] = destination;
      }
    }
    return destinations;
  };

  const selectSpeechDestination = (userId: string): SpeechDestination | null => {
    const destinations = connectedSpeechDestinations(userId);
    if (destinations.length === 0) return null;
    if (destinations.length === 1) return destinations[0]!;
    const preferred = db.ensureVoiceSettings(userId).speechPlaybackTarget;
    if (preferred !== 'auto') {
      const preferredDestination = destinations.find((destination) => destination.surface === preferred);
      if (preferredDestination) return preferredDestination;
    }
    return destinations
      .slice()
      .sort((a, b) => Date.parse(b.activityAt) - Date.parse(a.activityAt))[0]!;
  };

  const speechPlaybackStatus = (userId: string) => {
    const destinations = connectedSpeechDestinations(userId);
    const selected = selectSpeechDestination(userId);
    return {
      preferredTarget: db.ensureVoiceSettings(userId).speechPlaybackTarget,
      connectedTargets: destinations.map((destination) => destination.surface),
      resolvedTarget: selected?.surface ?? null,
    };
  };

  const sendSpeechToWeb = (clientId: string, payload: SpeechAudioCommand): boolean => {
    const client = [...speechEventClients].find((item) => item.id === clientId);
    if (!client || client.res.destroyed || client.res.writableEnded) {
      if (client) speechEventClients.delete(client);
      return false;
    }
    writeSseEvent(client.res, 'speech_audio', payload);
    return true;
  };

  const emitSpeechAudio = async (
    userId: string,
    text: string,
    metadata: { source: string; threadId?: string; messageId?: string },
  ): Promise<void> => {
    const clean = cleanText(text).slice(0, 4096);
    if (!clean) return;
    const destination = selectSpeechDestination(userId);
    if (!destination) {
      addLog(userId, {
        source: 'speech',
        level: 'warn',
        message: 'Speech playback skipped: no connected playback target',
        detailsJson: JSON.stringify({ source: metadata.source, chars: clean.length }),
      });
      return;
    }
    try {
      const speech = await synthesizeSpeech(clean);
      if (!speech.audio) {
        addLog(userId, {
          source: 'speech',
          level: 'warn',
          message: 'Speech playback skipped: TTS is not configured',
          detailsJson: JSON.stringify({ source: metadata.source, target: destination.surface, chars: clean.length }),
        });
        return;
      }
      const payload: SpeechAudioCommand = {
        type: 'speech_audio',
        id: `speech_${crypto.randomUUID().replace(/-/g, '')}`,
        source: metadata.source,
        text: clean,
        contentType: 'audio/wav',
        audioBase64: Buffer.from(speech.audio).toString('base64'),
        createdAt: new Date().toISOString(),
        ...(metadata.threadId ? { threadId: metadata.threadId } : {}),
        ...(metadata.messageId ? { messageId: metadata.messageId } : {}),
      };
      const delivered = destination.surface === 'web'
        ? Boolean(destination.clientId && sendSpeechToWeb(destination.clientId, payload))
        : Boolean(destination.deviceId && controlChannels.sendSpeechAudio(destination.deviceId, payload));
      addLog(userId, {
        deviceId: destination.deviceId ?? null,
        source: 'speech',
        level: delivered ? 'info' : 'warn',
        message: delivered ? `Speech playback queued on ${destination.surface}` : `Speech playback failed for ${destination.surface}`,
        detailsJson: JSON.stringify({ source: metadata.source, target: destination.surface, chars: clean.length, bytes: speech.audio.byteLength }),
      });
    } catch (error: any) {
      addLog(userId, {
        deviceId: destination.deviceId ?? null,
        source: 'speech',
        level: 'error',
        message: 'Speech synthesis failed',
        detailsJson: JSON.stringify({ source: metadata.source, target: destination.surface, error: error?.message ?? String(error) }),
      });
    }
  };

  const enqueueSpeechAudio = (
    userId: string,
    text: string,
    metadata: { source: string; threadId?: string; messageId?: string },
  ): void => {
    const previous = speechQueues.get(userId) ?? Promise.resolve();
    let next: Promise<void>;
    next = previous
      .catch(() => undefined)
      .then(() => emitSpeechAudio(userId, text, metadata))
      .finally(() => {
        if (speechQueues.get(userId) === next) speechQueues.delete(userId);
      });
    speechQueues.set(userId, next);
  };

  const handleSpeakToolResult = (userId: string, threadId: string, event: any) => {
    if (event?.type !== 'tool_result' || event.toolCall?.toolName !== 'speak') return;
    const text = speakTextFromResult(event.result);
    if (!text) return;
    enqueueSpeechAudio(userId, text, { source: 'assistant', threadId, messageId: String(event.toolCall?.id ?? '') || undefined });
  };

  app.addHook('onClose', async () => {
    setAssistantExternalToolExecutor(null);
  });

  const handleAssistantPromptEvent = (userId: string, threadId: string, event: any) => {
    handleSpeakToolResult(userId, threadId, event);
    if (['snapshot', 'message', 'queued', 'tool_call', 'tool_result', 'approval_pending', 'done', 'error'].includes(String(event?.type ?? ''))) {
      emitAssistantChange(`assistant_${String(event.type)}`, threadId, userId);
    }
  };

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(websocket);

  app.addContentTypeParser(
    [
      'application/octet-stream',
      'application/vnd.android.package-archive',
      'application/gzip',
      'application/zip',
      'application/x-apple-diskimage',
      'application/vnd.microsoft.portable-executable',
    ],
    { parseAs: 'buffer', bodyLimit: uploadLimitBytes() },
    (_req, body, done) => done(null, body),
  );

  if (clerkEnabled) {
    await app.register(clerkPlugin);
  }

  app.get('/api/health', async () => ({
    ok: true,
    app: 'voice-stream-next',
    clerk: clerkEnabled ? 'enabled' : 'dev-fallback',
    dbPath: db.path,
  }));

  app.get('/api/mobile/android', async (req) => ({
    ok: true,
    android: readAndroidApkInfo(req),
  }));

  app.get('/api/desktop', async (req) => ({
    ok: true,
    desktop: readDesktopAppInfo(req),
  }));

  app.put('/api/admin/releases/android', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      const android = writeAndroidApkRelease(req, req.body);
      addLog(ctx.user.id, {
        source: 'admin',
        level: 'info',
        message: `Android release uploaded: ${android.fileName ?? 'latest APK'}`,
        detailsJson: JSON.stringify({ variant: android.variant, versionCode: android.versionCode, size: android.size }),
      });
      emitAppEvent(null, 'release_changed', { platform: 'android' });
      return { ok: true, android };
    }),
  );

  app.put('/api/admin/releases/desktop', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      const desktop = writeDesktopAppRelease(req, req.body);
      addLog(ctx.user.id, {
        source: 'admin',
        level: 'info',
        message: `Desktop release uploaded: ${desktop.fileName ?? 'latest app'}`,
        detailsJson: JSON.stringify({ variant: desktop.variant, size: desktop.size }),
      });
      emitAppEvent(null, 'release_changed', { platform: 'desktop' });
      return { ok: true, desktop };
    }),
  );

  app.post('/api/mobile/android/setup', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const expiresAt = pairingExpiresAt();
      const created = db.createAndroidSetupSession(ctx.user.id, expiresAt);
      const setupPath = `/api/mobile/android/setup/${encodeURIComponent(created.session.id)}?secret=${encodeURIComponent(created.secret)}`;
      emitAppEvent(ctx.user.id, 'setup_changed', { setupId: created.session.id });
      return {
        ok: true,
        android: readAndroidApkInfo(req),
        setup: {
          id: created.session.id,
          expiresAt: created.session.expiresAt,
          setupUrl: publicUrlForPath(req, setupPath),
        },
      };
    }),
  );

  app.get('/api/mobile/android/setup/:setupId', async (req, reply) => {
    const setupId = cleanText((req.params as any).setupId);
    const secret = queryValue((req.query as any).secret).trim();
    const checked = db.androidSetupSession(setupId, secret);
    if (!checked.ok) {
      reply.code(setupFailureStatus(checked.reason)).type('text/plain').send(setupFailureMessage(checked.reason));
      return;
    }
    const android = readAndroidApkInfo(req);
    if (!android.available || !android.downloadUrl) {
      reply.code(404).type('text/plain').send('Android APK has not been built yet');
      return;
    }
    reply.redirect(android.downloadUrl);
  });

  app.post('/api/mobile/android/setup/:setupId/redeem', async (req, reply) => {
    const setupId = cleanText((req.params as any).setupId);
    const body = jsonBody(req);
    const secret = cleanText(body.secret || (req.query as any).secret);
    const checked = db.androidSetupSession(setupId, secret);
    if (!checked.ok) {
      reply.code(setupFailureStatus(checked.reason)).send({ ok: false, error: setupFailureMessage(checked.reason), reason: checked.reason });
      return;
    }

    const android = readAndroidApkInfo(req);
    const clientVersion = parseClientVersion(body.clientVersion, null);
    if (android.available && android.versionCode != null && clientVersion != null && clientVersion < android.versionCode) {
      return {
        ok: true,
        paired: false,
        updateAvailable: true,
        currentVersionCode: clientVersion,
        android,
      };
    }

    const expiresAt = pairingExpiresAt();
    const claimed = db.claimAndroidSetupSession(setupId, secret, {
      displayName: cleanText(body.displayName, 'Android voice client') || 'Android voice client',
      installationId: cleanText(body.installationId) || null,
      expiresAt,
    });
    if (!claimed.ok) {
      reply.code(setupFailureStatus(claimed.reason)).send({ ok: false, error: setupFailureMessage(claimed.reason), reason: claimed.reason });
      return;
    }

    const payload = buildPairingPayload({
      serverUrl: serverPublicUrl(req),
      deviceId: claimed.device.id,
      token: claimed.token,
      deviceType: 'android',
      displayName: claimed.device.displayName,
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      expiresAt,
      pairingSessionId: claimed.pairingSession.id,
      apkUrl: android.downloadUrl,
    });
    addLog(claimed.device.userId, {
      deviceId: claimed.device.id,
      source: 'android',
      level: 'info',
      message: `Android setup QR paired: ${claimed.device.displayName}`,
      detailsJson: JSON.stringify({ androidSetupSessionId: claimed.session.id, expiresAt }),
    });
    emitAppEvent(claimed.device.userId, 'device_changed', { deviceId: claimed.device.id, reason: 'android_setup_redeemed' });
    emitAppEvent(claimed.device.userId, 'setup_changed', { setupId: claimed.session.id, deviceId: claimed.device.id });
    return {
      ok: true,
      paired: true,
      updateAvailable: false,
      currentVersionCode: clientVersion,
      device: claimed.device,
      pairingSession: claimed.pairingSession,
      expiresAt,
      android,
      minClientVersion: minClientVersion(),
      ...payload,
    };
  });

  app.get('/api/mobile/android/apk', async (req, reply) => {
    const info = readAndroidApkInfo(req);
    if (!info.available || !info.fileName) {
      reply.code(404).send({ ok: false, error: 'Android APK has not been built yet' });
      return;
    }
    const apkFile = path.join(androidApkDir(), info.fileName);
    reply
      .type('application/vnd.android.package-archive')
      .header('content-disposition', `attachment; filename="${info.fileName}"`)
      .header('content-length', String(info.size ?? statSync(apkFile).size));
    return reply.send(createReadStream(apkFile));
  });

  app.get('/api/desktop/download', async (req, reply) => {
    const info = readDesktopAppInfo(req);
    if (!info.available || !info.fileName) {
      reply.code(404).send({ ok: false, error: 'Desktop app has not been built yet' });
      return;
    }
    const desktopFile = path.join(desktopAppDir(), info.fileName);
    reply
      .type(desktopContentType(info.fileName))
      .header('content-disposition', `attachment; filename="${info.fileName}"`)
      .header('content-length', String(info.size ?? statSync(desktopFile).size));
    return reply.send(createReadStream(desktopFile));
  });

  app.get('/api/events', async (req, reply) => {
    try {
      const ctx = await resolveRequestUser(req, db, clerkEnabled);
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      (req.raw.socket as any).setTimeout?.(0);
      const client = { res: reply.raw, userId: ctx.user.id, admin: Boolean(ctx.user.admin) };
      appEventClients.add(client);
      writeSseEvent(reply.raw, 'connected', { ok: true, sequence: appEventSequence, at: new Date().toISOString() });
      const keepAlive = setInterval(() => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(': keepalive\n\n');
      }, 25_000);
      (keepAlive as any).unref?.();
      const cleanup = () => {
        clearInterval(keepAlive);
        appEventClients.delete(client);
      };
      req.raw.on('close', cleanup);
      reply.raw.on('close', cleanup);
    } catch (error: any) {
      reply.code(Number(error?.statusCode ?? 401) || 401).send({ ok: false, error: error?.message ?? String(error) });
    }
  });

  app.get('/api/speech/events', async (req, reply) => {
    try {
      const ctx = await resolveRequestUser(req, db, clerkEnabled);
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      (req.raw.socket as any).setTimeout?.(0);
      const connectedAt = new Date().toISOString();
      const client = {
        id: `web_${crypto.randomUUID().replace(/-/g, '')}`,
        res: reply.raw,
        userId: ctx.user.id,
        connectedAt,
      };
      speechEventClients.add(client);
      writeSseEvent(reply.raw, 'connected', { ok: true, target: 'web', at: connectedAt });
      emitAppEvent(ctx.user.id, 'speech_playback_changed', { reason: 'web_speech_connected' });
      const keepAlive = setInterval(() => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(': keepalive\n\n');
      }, 25_000);
      (keepAlive as any).unref?.();
      const cleanup = () => {
        clearInterval(keepAlive);
        if (speechEventClients.delete(client)) {
          emitAppEvent(ctx.user.id, 'speech_playback_changed', { reason: 'web_speech_disconnected' });
        }
      };
      req.raw.on('close', cleanup);
      reply.raw.on('close', cleanup);
    } catch (error: any) {
      reply.code(Number(error?.statusCode ?? 401) || 401).send({ ok: false, error: error?.message ?? String(error) });
    }
  });

  app.get('/api/me', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      authMode: ctx.mode,
      user: ctx.user,
      settings: db.ensureVoiceSettings(ctx.user.id),
      speechPlayback: speechPlaybackStatus(ctx.user.id),
    })),
  );

  app.get('/api/dashboard', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      authMode: ctx.mode,
      ...db.dashboard(ctx.user),
      speechPlayback: speechPlaybackStatus(ctx.user.id),
    })),
  );

  app.patch('/api/settings/voice-codes', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const settings = db.updateVoiceSettings(ctx.user.id, {
        lockCode: cleanCode(body.lockCode, 'lock code'),
      });
      emitAppEvent(ctx.user.id, 'settings_changed', { settings: 'voice_codes' });
      return { ok: true, settings };
    }),
  );

  app.get('/api/settings/voice-approval', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => voiceApprovalSettingsResponse(db.ensureVoiceSettings(ctx.user.id))),
  );

  app.post('/api/settings/voice-approval', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const payload = body.settings ?? body.voiceApproval ?? body;
      const parsed = parseVoiceApprovalSettings(payload);
      if (!parsed) {
        throw Object.assign(new Error('Invalid voice approval settings.'), { statusCode: 400 });
      }
      const settings = db.updateVoiceApprovalSettings(ctx.user.id, parsed);
      emitAppEvent(ctx.user.id, 'settings_changed', { settings: 'voice_approval' });
      return voiceApprovalSettingsResponse(settings);
    }),
  );

  app.patch('/api/settings/speech-playback', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const settings = db.updateSpeechPlaybackTarget(ctx.user.id, cleanSpeechPlaybackTarget(body.target ?? body.speechPlaybackTarget));
      emitAppEvent(ctx.user.id, 'settings_changed', { settings: 'speech_playback' });
      emitAppEvent(ctx.user.id, 'speech_playback_changed', { preferredTarget: settings.speechPlaybackTarget });
      return { ok: true, settings, speechPlayback: speechPlaybackStatus(ctx.user.id) };
    }),
  );

  app.post('/api/desktop-auth/requests', async (req, reply) => {
    try {
      const body = jsonBody(req);
      const displayName = cleanText(body.displayName, 'Desktop voice client') || 'Desktop voice client';
      const installationId = cleanText(body.installationId) || null;
      const deviceType = cleanPairableDeviceType(body.deviceType, 'desktop');
      const expiresAt = desktopAuthExpiresAt();
      const { request, secret, deviceToken } = db.createDesktopAuthRequest({ displayName, expiresAt, installationId, deviceType });
      return {
        ok: true,
        requestId: request.id,
        secret,
        deviceToken,
        expiresAt: request.expiresAt,
        minClientVersion: minClientVersion(),
      };
    } catch (error: any) {
      reply.code(500).send({ ok: false, error: error?.message ?? String(error) });
      return undefined;
    }
  });

  app.post('/api/desktop-auth/claim', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const requestId = cleanText(body.requestId);
      const secret = cleanText(body.secret);
      if (!requestId || !secret) throw Object.assign(new Error('desktop auth request is missing'), { statusCode: 400 });
      const claimed = db.claimDesktopAuthRequest(ctx.user.id, requestId, secret);
      if (!claimed.ok && claimed.reason === 'claimed') {
        return { ok: true, alreadyClaimed: true, minClientVersion: minClientVersion() };
      }
      if (!claimed.ok) {
        const status = claimed.reason === 'expired' ? 409 : 404;
        throw Object.assign(new Error(`desktop auth request ${claimed.reason.replace('_', ' ')}`), { statusCode: status });
      }
      addLog(ctx.user.id, {
        deviceId: claimed.device.id,
        source: 'web',
        level: 'info',
        message: `Desktop auto-connected: ${claimed.device.displayName}`,
        detailsJson: JSON.stringify({ desktopAuthRequestId: claimed.request.id }),
      });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId: claimed.device.id, reason: 'desktop_auth_claimed' });
      return {
        ok: true,
        device: claimed.device,
        minClientVersion: minClientVersion(),
      };
    }),
  );

  app.post('/api/desktop-auth/result', async (req, reply) => {
    try {
      const body = jsonBody(req);
      const requestId = cleanText(body.requestId);
      const secret = cleanText(body.secret);
      if (!requestId || !secret) {
        reply.code(400).send({ ok: false, error: 'desktop auth request is missing' });
        return undefined;
      }
      const result = db.desktopAuthRequestResult(requestId, secret);
      if (!result.ok) {
        const status = result.reason === 'expired' ? 409 : 404;
        reply.code(status).send({ ok: false, error: `desktop auth request ${result.reason.replace('_', ' ')}` });
        return undefined;
      }
      return {
        ok: true,
        status: result.status,
        request: result.request,
        device: result.status === 'claimed' ? result.device : undefined,
        minClientVersion: minClientVersion(),
      };
    } catch (error: any) {
      reply.code(500).send({ ok: false, error: error?.message ?? String(error) });
      return undefined;
    }
  });

  app.post('/api/devices', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const deviceType = cleanPairableDeviceType(body.deviceType, 'desktop');
      const displayName = cleanText(body.displayName, deviceType) || deviceType;
      const installationId = cleanText(body.installationId) || null;
      const result = db.registerDevice(ctx.user.id, { deviceType, displayName, installationId });
      addLog(ctx.user.id, {
        deviceId: result.device.id,
        source: deviceType,
        level: 'info',
        message: `Device paired: ${displayName}`,
        detailsJson: JSON.stringify({ deviceType }),
      });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId: result.device.id, reason: 'device_paired' });
      return { ok: true, ...result };
    }),
  );

  app.post('/api/pairing/payload', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const deviceType = cleanPairableDeviceType(body.deviceType, 'android');
      const displayName = cleanText(body.displayName, deviceType === 'desktop' ? 'Desktop voice client' : 'Android voice client');
      const installationId = cleanText(body.installationId) || null;
      const result = db.registerDevice(ctx.user.id, { deviceType, displayName, installationId });
      const expiresAt = pairingExpiresAt();
      const pairingSession = db.createPairingSession(ctx.user.id, result.device.id, expiresAt);
      const androidApk = readAndroidApkInfo(req);
      const payload = buildPairingPayload({
        serverUrl: serverPublicUrl(req),
        deviceId: result.device.id,
        token: result.token,
        deviceType,
        displayName,
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
        expiresAt,
        pairingSessionId: pairingSession.id,
        apkUrl: deviceType === 'android' ? androidApk.downloadUrl : null,
      });
      addLog(ctx.user.id, {
        deviceId: result.device.id,
        source: 'web',
        level: 'info',
        message: `Pairing payload created: ${displayName}`,
        detailsJson: JSON.stringify({ deviceType, expiresAt, pairingSessionId: pairingSession.id }),
      });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId: result.device.id, reason: 'pairing_payload_created' });
      emitAppEvent(ctx.user.id, 'setup_changed', { deviceId: result.device.id, pairingSessionId: pairingSession.id });
      return {
        ok: true,
        device: result.device,
        token: result.token,
        pairingSession,
        expiresAt,
        minClientVersion: minClientVersion(),
        androidApk,
        ...payload,
      };
    }),
  );

  app.get('/api/devices', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      devices: db.listDevices(ctx.user.id),
      pairingSessions: db.listDevices(ctx.user.id).map((device) => db.pairingSessionForDevice(device.id)).filter(Boolean),
      clientStatuses: db.listClientStatuses(ctx.user.id),
      connectedDeviceIds: controlChannels.connectedDeviceIds().filter((deviceId) => Boolean(db.deviceForUser(ctx.user.id, deviceId))),
      extensionBridgeDevices: extensionBridges.connectedDevices(ctx.user.id),
    })),
  );

  app.get('/api/assistant/extensions', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const connectedDevices = extensionBridges.connectedDevices(ctx.user.id);
      const connectedExtensionIds = new Set(connectedDevices.flatMap((device) => device.manifests.map((manifest) => manifest.id)));
      return {
        ok: true,
        manifests: db.listAssistantExtensionManifests(ctx.user.id).filter((record) => connectedExtensionIds.has(record.extensionId)),
        routes: db.listAssistantExtensionToolRoutes(ctx.user.id),
        connectedDevices,
      };
    }),
  );

  app.patch('/api/devices/:deviceId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const body = jsonBody(req);
      const displayName = cleanText(body.displayName);
      if (!displayName) throw Object.assign(new Error('device name is required'), { statusCode: 400 });
      const device = db.updateDeviceName(ctx.user.id, deviceId, displayName);
      if (!device) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: 'info',
        message: `Device renamed: ${device.displayName}`,
      });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId, reason: 'device_renamed' });
      return { ok: true, device };
    }),
  );

  app.patch('/api/assistant/extensions/tools/:toolName/route', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const toolName = String((req.params as any).toolName ?? '');
      const manifestTool = db.assistantExtensionToolManifest(ctx.user.id, toolName);
      if (!manifestTool) throw Object.assign(new Error('unknown extension tool'), { statusCode: 404 });
      const body = jsonBody(req);
      const targetKind = cleanTargetKind(body.targetKind ?? body.target);
      if (!manifestTool.tool.supportedTargets.includes(targetKind)) {
        throw Object.assign(new Error(`${toolName} does not support ${targetKind} execution`), { statusCode: 400 });
      }
      const targetDeviceId = cleanText(body.targetDeviceId ?? body.deviceId) || null;
      if (targetKind === 'device') {
        if (!targetDeviceId) throw Object.assign(new Error('targetDeviceId is required for device execution'), { statusCode: 400 });
        const device = db.deviceForUser(ctx.user.id, targetDeviceId);
        if (!device || device.revokedAt) throw Object.assign(new Error('unknown target device'), { statusCode: 404 });
      }
      const route = db.upsertAssistantExtensionToolRoute(ctx.user.id, {
        toolName,
        enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
        targetKind,
        targetDeviceId,
      });
      emitAssistantChange('extension_route_updated', undefined, ctx.user.id);
      return { ok: true, route, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.post('/api/devices/:deviceId/revoke', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const device = db.revokeDevice(ctx.user.id, deviceId);
      if (!device) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      controlChannels.closeDevice(deviceId);
      extensionBridges.closeDevice(deviceId);
      db.upsertClientStatus(ctx.user.id, deviceId, {
        mode: 'off',
        status: 'Device revoked',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
      addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: 'info',
        message: `Device revoked: ${device.displayName}`,
      });
      emitAppEvent(ctx.user.id, 'client_status_changed', { deviceId, mode: 'off' });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId, reason: 'device_revoked' });
      emitAppEvent(ctx.user.id, 'speech_playback_changed', { reason: 'device_revoked' });
      return { ok: true, device };
    }),
  );

  app.post('/api/devices/:deviceId/rotate-token', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const rotated = db.rotateDeviceToken(ctx.user.id, deviceId);
      if (!rotated) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      controlChannels.closeDevice(deviceId, VoiceCloseCode.Revoked, 'token rotated');
      extensionBridges.closeDevice(deviceId, VoiceCloseCode.Revoked, 'token rotated');
      const body = jsonBody(req);
      const includePayload = body.includePayload !== false;
      const deviceType = cleanPairableDeviceType(body.deviceType, rotated.device.deviceType === 'android' ? 'android' : 'desktop');
      const displayName = cleanText(body.displayName, rotated.device.displayName) || rotated.device.displayName;
      let payload: ReturnType<typeof buildPairingPayload> | null = null;
      let pairingSession: ReturnType<VoiceStreamNextDb['createPairingSession']> | null = null;
      let expiresAt: string | null = null;
      if (includePayload) {
        expiresAt = pairingExpiresAt();
        pairingSession = db.createPairingSession(ctx.user.id, rotated.device.id, expiresAt);
        const androidApk = readAndroidApkInfo(req);
        payload = buildPairingPayload({
          serverUrl: serverPublicUrl(req),
          deviceId: rotated.device.id,
          token: rotated.token,
          deviceType,
          displayName,
          protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          expiresAt,
          pairingSessionId: pairingSession.id,
          apkUrl: deviceType === 'android' ? androidApk.downloadUrl : null,
        });
      }
      addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: 'info',
        message: `Device token rotated: ${rotated.device.displayName}`,
      });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId, reason: 'device_token_rotated' });
      if (pairingSession) emitAppEvent(ctx.user.id, 'setup_changed', { deviceId, pairingSessionId: pairingSession.id });
      emitAppEvent(ctx.user.id, 'speech_playback_changed', { reason: 'device_token_rotated' });
      return {
        ok: true,
        device: rotated.device,
        token: rotated.token,
        pairingSession,
        expiresAt,
        minClientVersion: minClientVersion(),
        ...(payload ?? {}),
      };
    }),
  );

  app.post('/api/devices/:deviceId/command', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const device = db.deviceForUser(ctx.user.id, deviceId);
      if (!device || device.revokedAt) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      const body = jsonBody(req);
      const command = cleanControlCommand(body.command);
      const reason = cleanText(body.reason, 'dashboard') || 'dashboard';
      const result = await controlChannels.sendCommand(deviceId, command, reason);
      addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: result.delivered ? 'info' : 'warn',
        message: result.delivered ? `Remote command sent: ${command}` : `Remote command not delivered: ${command}`,
        detailsJson: JSON.stringify(result),
      });
      emitAppEvent(ctx.user.id, 'device_changed', { deviceId, reason: 'device_command_sent', command });
      return { ok: true, ...result };
    }),
  );

  app.get('/api/admin/devices', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      return { ok: true, devices: db.listDevices() };
    }),
  );

  app.get('/api/logs', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      logs: db.listLogs(ctx.user.id, 200),
    })),
  );

  app.post('/api/logs', async (req, reply) =>
    {
      const body = jsonBody(req);
      const detailsJson = body.details == null ? null : JSON.stringify(body.details);
      const deviceId = cleanText(body.deviceId) || null;
      const token = cleanText(body.token || req.headers['x-voice-device-token']);
      if (deviceId && token) {
        const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
        if (!auth.ok) {
          reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
            ok: false,
            error: deviceAuthFailureMessage(auth),
            reason: auth.reason,
            minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
          });
          return;
        }
        const device = resolveDeviceInstallation(db, auth.device, cleanText(body.installationId || req.headers['x-voice-installation-id']) || null, token);
        const log = addLog(device.userId, {
          deviceId: device.id,
          source: cleanText(body.source, device.deviceType) || device.deviceType,
          level: cleanText(body.level, 'info') || 'info',
          message: cleanText(body.message, 'Log event') || 'Log event',
          detailsJson,
        });
        return { ok: true, log, device };
      }
      return withUser(req, reply, db, clerkEnabled, async (ctx) => {
        const log = addLog(ctx.user.id, {
          deviceId,
          source: cleanText(body.source, 'web') || 'web',
          level: cleanText(body.level, 'info') || 'info',
          message: cleanText(body.message, 'Log event') || 'Log event',
          detailsJson,
        });
        return { ok: true, log };
      });
    },
  );

  app.get('/api/transcripts', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const deviceId = cleanText(query.deviceId) || undefined;
      const voiceSessionId = cleanText(query.voiceSessionId) || undefined;
      return {
        ok: true,
        transcripts: db.listTranscripts(ctx.user.id, 200, { deviceId, voiceSessionId }),
      };
    }),
  );

  app.post('/api/devices/:deviceId/status', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const body = jsonBody(req);
    const token = cleanText(body.token || req.headers['x-voice-device-token']);
    const clientVersion = parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    const device = resolveDeviceInstallation(db, auth.device, cleanText(body.installationId || req.headers['x-voice-installation-id']) || null, token);
    const status = db.upsertClientStatus(device.userId, device.id, {
      mode: cleanDeviceMode(body.mode),
      status: cleanText(body.status, 'No status') || 'No status',
      microphone: cleanText(body.microphone),
      protocolVersion: Number.isInteger(body.protocolVersion) ? body.protocolVersion : null,
      appVersion: cleanText(body.appVersion) || null,
      lastError: cleanText(body.lastError) || null,
      reportedAt: cleanText(body.reportedAt) || null,
    });
    emitAppEvent(device.userId, 'client_status_changed', { deviceId: device.id, mode: status.mode });
    emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'device_status_reported' });
    return { ok: true, status, device };
  });

  app.get('/api/devices/:deviceId/bootstrap', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const query = (req.query ?? {}) as Record<string, unknown>;
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const installationId = cleanText(req.headers['x-voice-installation-id'] || query.installationId) || null;
    const clientVersion = parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    const device = resolveDeviceInstallation(db, auth.device, installationId, token);
    emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'device_bootstrap' });
    return {
      ok: true,
      device,
      settings: voiceApprovalSettingsResponse(db.ensureVoiceSettings(auth.device.userId)).settings,
      minClientVersion: minClientVersion(),
    };
  });

  app.get('/api/devices/:deviceId/assistant/thread', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const query = (req.query ?? {}) as Record<string, unknown>;
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const clientVersion = parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    const thread = db.latestVoiceThreadOrNull(auth.device.userId);
    if (!thread) {
      return {
        ok: true,
        thread: null,
        runningModel: null,
        pendingApprovalCount: 0,
        artifactsCount: 0,
      };
    }
    const artifactsCount = db.listArtifacts(auth.device.userId, thread.id).length;
    const activeRun = db.listRuns(auth.device.userId, thread.id, 8).find((run) => run.status === 'running' || run.status === 'waiting_for_approval');
    return {
      ok: true,
      thread: {
        ...thread,
        artifactsCount,
      },
      runningModel: activeRun ? {
        provider: activeRun.provider,
        model: activeRun.model,
        thinkingLevel: activeRun.thinkingLevel,
        runId: activeRun.id,
      } : null,
      pendingApprovalCount: db.listApprovals(auth.device.userId, thread.id).filter((approval) => approval.status === 'pending').length,
      artifactsCount,
    };
  });

  app.get('/api/devices/:deviceId/assistant/thread/artifacts', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const query = (req.query ?? {}) as Record<string, unknown>;
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const clientVersion = parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    const thread = db.latestVoiceThreadOrNull(auth.device.userId);
    if (!thread) {
      return {
        ok: true,
        thread: null,
        artifacts: [],
      };
    }
    const artifacts = db.listArtifacts(auth.device.userId, thread.id);
    return {
      ok: true,
      thread: {
        ...thread,
        artifactsCount: artifacts.length,
      },
      artifacts,
    };
  });

  app.get('/api/devices/:deviceId/control', { websocket: true }, (socket, req) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const token = queryValue((req.query as any)?.token);
    const installationId = cleanText((req.query as any)?.installationId) || null;
    const clientVersion = parseClientVersion((req.query as any)?.clientVersion, parseClientVersion((req.query as any)?.protocolVersion, null));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      socket.close(deviceAuthCloseCode(auth), deviceAuthFailureMessage(auth));
      return;
    }
    const device = resolveDeviceInstallation(db, auth.device, installationId, token);
    controlChannels.register(device.id, socket);
    addLog(device.userId, {
      deviceId: device.id,
      source: device.deviceType,
      level: 'info',
      message: 'Device control channel connected',
      detailsJson: JSON.stringify({
        clientVersion,
        connectedDeviceIds: controlChannels.connectedDeviceIds().length,
      }),
    });
    emitAppEvent(device.userId, 'device_connected', { deviceId: device.id, deviceType: device.deviceType });
    emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'control_connected' });
    emitAppEvent(device.userId, 'speech_playback_changed', { reason: 'control_connected' });
    socket.send(JSON.stringify({
      type: 'control_hello',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      minClientVersion: minClientVersion(),
      device,
      commands: ['sleep', 'off', 'awake', 'query_status'],
    }));
    const heartbeat = setInterval(() => {
      if ((socket as any).readyState === 1) {
        socket.send(JSON.stringify({ type: 'server_ping', sentAt: new Date().toISOString() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    socket.on('message', (data) => {
      const parsed = parseControlClientMessage(String(data));
      if (!parsed) {
        socket.close(VoiceCloseCode.InvalidMessage, 'invalid control message');
        return;
      }
      if (parsed.type === 'client_ping') {
        socket.send(JSON.stringify({ type: 'server_pong', sentAt: new Date().toISOString(), clientSentAt: parsed.sentAt }));
        return;
      }
      if (parsed.type === 'client_status') {
        const status = db.upsertClientStatus(device.userId, device.id, {
          mode: cleanDeviceMode(parsed.mode),
          status: cleanText(parsed.status, 'No status') || 'No status',
          microphone: cleanText(parsed.microphone),
          protocolVersion: parsed.protocolVersion ?? null,
          appVersion: cleanText(parsed.appVersion) || null,
          lastError: cleanText(parsed.lastError) || null,
          reportedAt: cleanText(parsed.reportedAt) || null,
        });
        emitAppEvent(device.userId, 'client_status_changed', { deviceId: device.id, mode: status.mode });
        return;
      }
      if (parsed.type === 'command_ack') {
        controlChannels.handleCommandAck(device.id, parsed);
        return;
      }
      socket.close(VoiceCloseCode.InvalidMessage, 'unknown control message');
    });
    socket.on('close', (code: number, reason: Buffer) => {
      clearInterval(heartbeat);
      controlChannels.unregister(device.id, socket);
      addLog(device.userId, {
        deviceId: device.id,
        source: device.deviceType,
        level: 'warn',
        message: 'Device control channel disconnected',
        detailsJson: JSON.stringify({
          code,
          reason: reason?.toString() ?? '',
          connectedDeviceIds: controlChannels.connectedDeviceIds().length,
        }),
      });
      emitAppEvent(device.userId, 'device_disconnected', { deviceId: device.id, deviceType: device.deviceType });
      emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'control_disconnected' });
      emitAppEvent(device.userId, 'speech_playback_changed', { reason: 'control_disconnected' });
    });
  });

  app.get('/api/devices/:deviceId/extensions', { websocket: true }, (socket, req) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const token = queryValue((req.query as any)?.token);
    const clientVersion = parseClientVersion((req.query as any)?.clientVersion, parseClientVersion((req.query as any)?.protocolVersion, null));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      socket.close(deviceAuthCloseCode(auth), deviceAuthFailureMessage(auth));
      return;
    }
    const device = auth.device;
    let registered = false;
    socket.send(JSON.stringify({
      type: 'extension_bridge_hello',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      minClientVersion: minClientVersion(),
    }));
    const heartbeat = setInterval(() => {
      if ((socket as any).readyState === 1) {
        socket.send(JSON.stringify({ type: 'server_ping', sentAt: new Date().toISOString() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    socket.on('message', (data) => {
      try {
        const parsed = parseExtensionBridgeMessage(String(data));
        if (!parsed) {
          socket.close(VoiceCloseCode.InvalidMessage, 'invalid extension bridge message');
          return;
        }
        if (parsed.type === 'client_ping') {
          socket.send(JSON.stringify({ type: 'server_pong', sentAt: new Date().toISOString(), clientSentAt: parsed.sentAt }));
          return;
        }
        if (parsed.type === 'extension_hello') {
          const manifests = parsed.manifests.map((manifest) => parseAssistantExtensionManifest(manifest));
          for (const manifest of manifests) {
            db.upsertAssistantExtensionManifest(device.userId, manifest);
            for (const tool of manifest.tools) {
              const toolName = extensionToolName(manifest.id, tool.name);
              const defaultTargetDeviceId = extensionDefaultTargetDeviceId(tool.defaultTarget, device.id);
              const route = db.assistantExtensionToolRoute(device.userId, toolName);
              if (!route) {
                db.upsertAssistantExtensionToolRoute(device.userId, {
                  toolName,
                  enabled: tool.defaultTarget !== 'server',
                  targetKind: tool.defaultTarget,
                  targetDeviceId: defaultTargetDeviceId,
                });
              } else if (shouldEnableRegisteredExtensionRoute(route, tool.defaultTarget, defaultTargetDeviceId)) {
                db.upsertAssistantExtensionToolRoute(device.userId, {
                  toolName,
                  enabled: true,
                  targetKind: route.targetKind,
                  targetDeviceId: route.targetDeviceId,
                });
              }
            }
          }
          extensionBridges.register(socket, {
            userId: device.userId,
            deviceId: device.id,
            deviceType: device.deviceType,
            displayName: device.displayName,
            manifests,
          });
          registered = true;
          const status = db.upsertClientStatus(device.userId, device.id, {
            mode: 'awake',
            status: manifests.length > 0 ? 'Extension bridge connected' : 'Extension bridge connected without tools',
            protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          });
          emitAppEvent(device.userId, 'client_status_changed', { deviceId: device.id, mode: status.mode });
          emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'extension_bridge_connected' });
          emitAssistantChange('extension_bridge_connected', undefined, device.userId);
          socket.send(JSON.stringify({
            type: 'extension_bridge_registered',
            manifests: manifests.map((manifest) => manifest.id),
            toolNames: manifests.flatMap((manifest) => manifest.tools.map((tool) => extensionToolName(manifest.id, tool.name))),
          }));
          return;
        }
        if (parsed.type === 'extension_tool_result' || parsed.type === 'extension_approval_result') {
          if (!registered) {
            socket.close(VoiceCloseCode.InvalidMessage, 'extension bridge must send hello before results');
            return;
          }
          extensionBridges.handleClientMessage(device.id, String(data));
          return;
        }
        socket.close(VoiceCloseCode.InvalidMessage, 'unknown extension bridge message');
      } catch (error: any) {
        socket.close(VoiceCloseCode.InvalidMessage, error?.message ?? 'invalid extension bridge message');
      }
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      const registration = extensionBridges.unregister(socket);
      if (registration) {
        for (const manifest of registration.manifests) {
          if (!extensionBridges.hasConnectedExtension(registration.userId, manifest.id)) {
            db.deleteAssistantExtensionManifest(registration.userId, manifest.id);
          }
        }
      }
      if (registered) {
        emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'extension_bridge_disconnected' });
        emitAssistantChange('extension_bridge_disconnected', undefined, device.userId);
      }
    });
  });

  app.post('/api/voice/approval-codes', async (req, reply) =>
    {
      const body = jsonBody(req);
      const deviceId = cleanText(body.deviceId);
      const token = cleanText(body.token || req.headers['x-voice-device-token']);
      if (deviceId && token) {
        const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
        if (!auth.ok) {
          reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
            ok: false,
            error: deviceAuthFailureMessage(auth),
            reason: auth.reason,
            minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
          });
          return;
        }
        const code = cleanCode(body.code, 'approval code');
        const approvalCode = addApprovalCode(auth.device.userId, {
          voiceSessionId: cleanText(body.voiceSessionId) || null,
          code,
          source: cleanText(body.source, auth.device.deviceType) || auth.device.deviceType,
        });
        return { ok: true, approvalCode };
      }
      return withUser(req, reply, db, clerkEnabled, async (ctx) => {
        const code = cleanCode(body.code, 'approval code');
        const approvalCode = addApprovalCode(ctx.user.id, {
          voiceSessionId: cleanText(body.voiceSessionId) || null,
          code,
          source: cleanText(body.source, 'client') || 'client',
        });
        return { ok: true, approvalCode };
      });
    },
  );

  app.post('/api/devices/:deviceId/assistant/threads/:threadId/prompt', async (req, reply) => {
    const body = jsonBody(req);
    const deviceId = String((req.params as any).deviceId ?? '');
    const threadId = String((req.params as any).threadId ?? '');
    const token = cleanText(body.token || req.headers['x-voice-device-token']);
    const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    if (!db.thread(auth.device.userId, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
    const prompt = cleanText(body.prompt ?? body.content);
    if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
    const events: unknown[] = [];
    const snapshot = await promptAssistantThread(db, auth.device.userId, threadId, {
      prompt,
      provider: cleanText(body.provider) || undefined,
      model: cleanText(body.model) || undefined,
      thinkingLevel: cleanText(body.thinkingLevel) || undefined,
    }, (event) => {
      events.push(event);
      handleAssistantPromptEvent(auth.device.userId, threadId, event);
    });
    emitAssistantChange('device_thread_prompted', threadId, auth.device.userId);
    return { ok: true, events, snapshot };
  });

  app.get('/api/assistant/threads', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      return assistantSnapshot(db, ctx.user.id, cleanText(query.activeThreadId) || null);
    }),
  );

  app.post('/api/assistant/threads', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const source = cleanText(body.source) === 'voice' || Boolean(body.voiceEnabled) ? 'voice' : 'web';
      const requestedProvider = cleanText(body.provider);
      const thread = db.createThread(ctx.user.id, {
        title: cleanText(body.title, 'Assistant thread') || 'Assistant thread',
        source,
        voiceEnabled: Boolean(body.voiceEnabled) || source === 'voice',
        provider: requestedProvider || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
        promptDeliveryMode: body.promptDeliveryMode === 'asap' ? 'asap' : 'queue',
      });
      emitAssistantChange('thread_created', thread.id, ctx.user.id);
      return { ok: true, thread, snapshot: assistantSnapshot(db, ctx.user.id, thread.id) };
    }),
  );

  app.patch('/api/assistant/threads/:threadId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const patch: Parameters<VoiceStreamNextDb['updateThread']>[2] = {};
      if (body.title !== undefined) patch.title = cleanText(body.title, 'Assistant thread') || 'Assistant thread';
      if (body.provider !== undefined) patch.provider = cleanText(body.provider, 'openai') || 'openai';
      if (body.model !== undefined) patch.model = cleanText(body.model, 'gpt-5.5') || 'gpt-5.5';
      if (body.thinkingLevel !== undefined) patch.thinkingLevel = cleanText(body.thinkingLevel, 'off') || 'off';
      if (body.voiceEnabled !== undefined) patch.voiceEnabled = Boolean(body.voiceEnabled);
      if (body.autoApprove !== undefined) patch.autoApprove = Boolean(body.autoApprove);
      if (body.systemPrompt !== undefined) patch.systemPrompt = cleanText(body.systemPrompt) || null;
      if (Array.isArray(body.enabledTools)) patch.enabledTools = body.enabledTools.map((tool: unknown) => cleanText(tool)).filter(Boolean);
      if (body.promptDeliveryMode !== undefined) patch.promptDeliveryMode = body.promptDeliveryMode === 'asap' ? 'asap' : 'queue';
      const thread = db.updateThread(ctx.user.id, threadId, patch);
      emitAssistantChange('thread_updated', threadId, ctx.user.id);
      return { ok: true, thread, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.delete('/api/assistant/threads/:threadId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      const deleted = db.deleteThread(ctx.user.id, threadId);
      if (!deleted) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      emitAssistantChange('thread_deleted', threadId, ctx.user.id);
      return { ok: true, deleted, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.get('/api/assistant/threads/:threadId/messages', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      return { ok: true, messages: db.listMessages(ctx.user.id, threadId) };
    }),
  );

  app.post('/api/assistant/threads/:threadId/messages', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const content = cleanText(body.content ?? body.prompt);
      if (!content) throw Object.assign(new Error('message content is required'), { statusCode: 400 });
      const events: unknown[] = [];
      const snapshot = await promptAssistantThread(db, ctx.user.id, threadId, {
        prompt: content,
        provider: cleanText(body.provider) || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
      }, (event) => {
        events.push(event);
        handleAssistantPromptEvent(ctx.user.id, threadId, event);
      });
      emitAssistantChange('thread_prompted', threadId, ctx.user.id);
      return { ok: true, events, snapshot, messages: db.listMessages(ctx.user.id, threadId) };
    }),
  );

  app.post('/api/assistant/threads/:threadId/prompt', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const prompt = cleanText(body.prompt ?? body.content);
      if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
      const events: unknown[] = [];
      const snapshot = await promptAssistantThread(db, ctx.user.id, threadId, {
        prompt,
        provider: cleanText(body.provider) || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
      }, (event) => {
        events.push(event);
        handleAssistantPromptEvent(ctx.user.id, threadId, event);
      });
      emitAssistantChange('thread_prompted', threadId, ctx.user.id);
      return { ok: true, events, snapshot };
    }),
  );

  app.post('/api/assistant/threads/:threadId/stream', async (req, reply) => {
    const writeEvent = (event: unknown) => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const ctx = await resolveRequestUser(req, db, clerkEnabled);
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const prompt = cleanText(body.prompt ?? body.content);
      if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      await promptAssistantThread(db, ctx.user.id, threadId, {
        prompt,
        provider: cleanText(body.provider) || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
      }, (event) => {
        writeEvent(event);
        handleAssistantPromptEvent(ctx.user.id, threadId, event);
      });
      emitAssistantChange('thread_prompted', threadId, ctx.user.id);
      reply.raw.end();
    } catch (error: any) {
      const status = Number(error?.statusCode ?? 0) || 500;
      if (!reply.raw.headersSent) {
        reply.code(status).send({ ok: false, error: error?.message ?? String(error) });
        return;
      }
      writeEvent({ type: 'error', error: error?.message ?? String(error) });
      reply.raw.end();
    }
  });

  app.post('/api/assistant/threads/:threadId/stop', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      const run = db.activeRun(ctx.user.id, threadId);
      const pendingApprovals = db.listApprovals(ctx.user.id, threadId).filter((approval) => approval.status === 'pending');
      for (const approval of pendingApprovals) {
        await resolveAssistantApproval(db, ctx.user.id, approval.id, false, ctx.user.email || ctx.user.displayName || 'user');
      }
      if (!run) {
        if (pendingApprovals.length > 0) emitAssistantChange('thread_stopped', threadId, ctx.user.id);
        return { ok: true, stopped: pendingApprovals.length > 0, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
      }
      const at = new Date().toISOString();
      db.updateRun(ctx.user.id, run.id, { status: 'cancelled', cancelledAt: at, error: 'Cancelled by user' });
      db.updateThread(ctx.user.id, threadId, { status: 'idle', error: null });
      emitAssistantChange('thread_stopped', threadId, ctx.user.id);
      return { ok: true, stopped: true, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.delete('/api/assistant/threads/:threadId/queued/:queuedPromptId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      const queuedPromptId = String((req.params as any).queuedPromptId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const queuedPrompt = db.cancelQueuedPrompt(ctx.user.id, threadId, queuedPromptId);
      if (!queuedPrompt) throw Object.assign(new Error('unknown queued prompt'), { statusCode: 404 });
      emitAssistantChange('queued_prompt_cancelled', threadId, ctx.user.id);
      return { ok: true, queuedPrompt, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.get('/api/assistant/tools', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      tools: assistantAvailableToolSummaries(db, ctx.user.id),
    })),
  );

  app.get('/api/assistant/settings', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      settings: db.ensureAssistantSettings(ctx.user.id),
    })),
  );

  app.get('/api/assistant/codex/status', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      codexConnection: db.codexConnectionView(ctx.user.id),
    })),
  );

  app.post('/api/assistant/codex/connect', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const flow = await createCodexAuthorizationFlow();
      db.createCodexOAuthState(ctx.user.id, {
        state: flow.state,
        codeVerifier: flow.verifier,
        redirectUri: flow.redirectUri,
        expiresAt: flow.expiresAt,
      });
      return {
        ok: true,
        state: flow.state,
        authorizationUrl: flow.authorizationUrl,
        redirectUri: flow.redirectUri,
        expiresAt: flow.expiresAt,
      };
    }),
  );

  app.post('/api/assistant/codex/complete', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const parsed = parseCodexAuthorizationInput(cleanText(body.codeOrUrl ?? body.code));
      const state = cleanText(body.state) || parsed.state || '';
      const code = parsed.code || '';
      if (!state || !code) throw Object.assign(new Error('Codex authorization code and state are required'), { statusCode: 400 });
      const oauthState = db.codexOAuthState(state);
      if (!oauthState || oauthState.userId !== ctx.user.id) throw Object.assign(new Error('Unknown Codex authorization state'), { statusCode: 404 });
      if (Date.parse(oauthState.expiresAt) <= Date.now()) {
        db.deleteCodexOAuthState(state);
        throw Object.assign(new Error('Codex authorization state expired'), { statusCode: 400 });
      }
      const tokenSet = await exchangeCodexAuthorizationCode({
        code,
        verifier: oauthState.codeVerifier,
        redirectUri: oauthState.redirectUri,
      });
      db.upsertCodexConnection(ctx.user.id, tokenSet);
      db.deleteCodexOAuthState(state);
      db.updateAssistantSettings(ctx.user.id, {
        defaultProvider: 'codex',
        defaultModel: 'gpt-5.5',
        defaultThinkingLevel: 'medium',
      });
      for (const thread of db.listThreads(ctx.user.id)) {
        if (thread.provider === 'openai' && thread.model === 'gpt-5.2') {
          db.updateThread(ctx.user.id, thread.id, {
            provider: 'codex',
            model: 'gpt-5.5',
            thinkingLevel: thread.thinkingLevel === 'off' ? 'medium' : thread.thinkingLevel,
            status: thread.status === 'error' ? 'idle' : thread.status,
            error: null,
          });
        }
      }
      emitAssistantChange('codex_connected', undefined, ctx.user.id);
      return {
        ok: true,
        codexConnection: db.codexConnectionView(ctx.user.id),
        snapshot: assistantSnapshot(db, ctx.user.id),
      };
    }),
  );

  app.delete('/api/assistant/codex/connection', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deleted = db.deleteCodexConnection(ctx.user.id);
      emitAssistantChange('codex_disconnected', undefined, ctx.user.id);
      return {
        ok: true,
        deleted,
        codexConnection: db.codexConnectionView(ctx.user.id),
        snapshot: assistantSnapshot(db, ctx.user.id),
      };
    }),
  );

  app.patch('/api/assistant/settings', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const settings = db.updateAssistantSettings(ctx.user.id, {
        normalSystemPrompt: body.normalSystemPrompt === undefined ? undefined : cleanText(body.normalSystemPrompt),
        voiceSystemPrompt: body.voiceSystemPrompt === undefined ? undefined : cleanText(body.voiceSystemPrompt),
        defaultProvider: body.defaultProvider === undefined ? undefined : cleanText(body.defaultProvider, 'openai'),
        defaultModel: body.defaultModel === undefined ? undefined : cleanText(body.defaultModel, 'gpt-5.5'),
        defaultThinkingLevel: body.defaultThinkingLevel === undefined ? undefined : cleanText(body.defaultThinkingLevel, 'off'),
        defaultEnabledTools: Array.isArray(body.defaultEnabledTools) ? body.defaultEnabledTools.map((tool: unknown) => cleanText(tool)).filter(Boolean) : undefined,
      });
      emitAssistantChange('assistant_settings_updated', undefined, ctx.user.id);
      return { ok: true, settings, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.get('/api/assistant/keys', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      keys: db.assistantApiKeysView(ctx.user.id),
    })),
  );

  app.get('/api/assistant/keys/:provider', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const provider = (req.params as any)?.provider;
      return {
        ok: true,
        key: db.assistantApiKeyView(ctx.user.id, provider),
      };
    }),
  );

  app.post('/api/assistant/keys/:provider', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const provider = (req.params as any)?.provider;
      const body = jsonBody(req);
      const key = db.upsertAssistantApiKey(ctx.user.id, provider, body.apiKey);
      emitAssistantChange('assistant_api_key_updated', undefined, ctx.user.id);
      return {
        ok: true,
        key,
        keys: db.assistantApiKeysView(ctx.user.id),
        snapshot: assistantSnapshot(db, ctx.user.id),
      };
    }),
  );

  app.delete('/api/assistant/keys/:provider', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const provider = (req.params as any)?.provider;
      const deleted = db.deleteAssistantApiKey(ctx.user.id, provider);
      emitAssistantChange('assistant_api_key_deleted', undefined, ctx.user.id);
      return {
        ok: true,
        deleted,
        keys: db.assistantApiKeysView(ctx.user.id),
        snapshot: assistantSnapshot(db, ctx.user.id),
      };
    }),
  );

  app.post('/api/assistant/approvals/:approvalId/approve', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const approvalId = String((req.params as any).approvalId ?? '');
      const pending = db.pendingApproval(ctx.user.id, approvalId);
      const pendingSpeakText = pending?.toolName === 'speak' ? speakTextFromArgsJson(pending.argsJson) : '';
      const snapshot = await resolveAssistantApproval(db, ctx.user.id, approvalId, true, ctx.user.email || ctx.user.displayName || 'user');
      if (pendingSpeakText && pending) {
        enqueueSpeechAudio(ctx.user.id, pendingSpeakText, { source: 'assistant', threadId: pending.threadId, messageId: pending.toolCallId });
      }
      emitAssistantChange('approval_resolved', snapshot.activeThreadId ?? undefined, ctx.user.id);
      return { ok: true, snapshot };
    }),
  );

  app.post('/api/assistant/approvals/:approvalId/deny', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const approvalId = String((req.params as any).approvalId ?? '');
      const snapshot = await resolveAssistantApproval(db, ctx.user.id, approvalId, false, ctx.user.email || ctx.user.displayName || 'user');
      emitAssistantChange('approval_resolved', snapshot.activeThreadId ?? undefined, ctx.user.id);
      return { ok: true, snapshot };
    }),
  );

  app.get('/api/assistant/threads/:threadId/artifacts', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      return { ok: true, artifacts: db.listArtifacts(ctx.user.id, threadId) };
    }),
  );

  app.get('/api/assistant/threads/:threadId/artifacts/file', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const artifactPath = sanitizeArtifactPath(queryValue((req.query as any)?.path));
      const artifact = db.readArtifact(ctx.user.id, threadId, artifactPath);
      if (!artifact) throw Object.assign(new Error('unknown artifact'), { statusCode: 404 });
      return { ok: true, artifact };
    }),
  );

  app.put('/api/assistant/threads/:threadId/artifacts/file', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const artifactPath = sanitizeArtifactPath(body.path);
      const content = String(body.content ?? '');
      if (Buffer.byteLength(content, 'utf8') > 256 * 1024) {
        throw Object.assign(new Error('artifact content is too large'), { statusCode: 413 });
      }
      const artifact = db.upsertArtifact(ctx.user.id, threadId, { path: artifactPath, content });
      emitAssistantChange('artifact_saved', threadId, ctx.user.id);
      return { ok: true, artifact, artifacts: db.listArtifacts(ctx.user.id, threadId), snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.delete('/api/assistant/threads/:threadId/artifacts/file', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const artifactPath = sanitizeArtifactPath(body.path ?? queryValue((req.query as any)?.path));
      const deleted = db.deleteArtifact(ctx.user.id, threadId, artifactPath);
      emitAssistantChange('artifact_deleted', threadId, ctx.user.id);
      return { ok: true, deleted, artifacts: db.listArtifacts(ctx.user.id, threadId), snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.post('/api/voice/sessions', async (req, reply) => {
    const body = jsonBody(req);
    const deviceId = cleanText(body.deviceId);
    const mode = cleanVoiceStreamMode(cleanText(body.mode));
    if (!deviceId) throw Object.assign(new Error('deviceId is required'), { statusCode: 400 });
    const token = cleanText(body.token || req.headers['x-voice-device-token']);
    if (token) {
      const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
      if (!auth.ok) {
        reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
          ok: false,
          error: deviceAuthFailureMessage(auth),
          reason: auth.reason,
          minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
        });
        return;
      }
      const device = resolveDeviceInstallation(db, auth.device, cleanText(body.installationId || req.headers['x-voice-installation-id']) || null, token);
      const session = db.createVoiceSession(device.userId, device.id, mode);
      return { ok: true, session, device };
    }
    return withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const device = db.deviceForUser(ctx.user.id, deviceId);
      if (!device || device.revokedAt) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      const session = db.createVoiceSession(ctx.user.id, deviceId, mode);
      return { ok: true, session };
    });
  },
  );

  app.get('/api/voice/stream', { websocket: true }, (socket, req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const deviceId = queryValue(query.deviceId);
    const token = queryValue(query.token);
    const installationId = cleanText(query.installationId) || null;
    const requestedSessionId = queryValue(query.sessionId);
    const streamMode = cleanVoiceStreamMode(queryValue(query.mode));
    const ignoreCommands = queryValue(query.ignoreCommands) === '1';
    const verifiedDevice = verifyDeviceAuth(db, deviceId, token, parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    if (!verifiedDevice.ok) {
      socket.close(deviceAuthCloseCode(verifiedDevice), deviceAuthFailureMessage(verifiedDevice));
      return;
    }
    const device = resolveDeviceInstallation(db, verifiedDevice.device, installationId, token);

    let frames = 0;
    let bytes = 0;
    let storedBytes = 0;
    let finalized = false;
    let terminalFinalize: TerminalCommand | null = null;
    const chunks: Uint8Array[] = [];
    const startedAt = Date.now();
    let pausedAt: number | null = null;
    let accumulatedPausedMs = 0;
    let durationLimit: ReturnType<typeof setTimeout> | null = null;
    const streamingEnabled = streamingTranscriptionEnabled();
    const commandDetectionEnabled = streamingEnabled && !ignoreCommands;
    const transcriptionConfig = buildStreamingTranscriptionConfigFromEnv();
    const streamingManager = commandDetectionEnabled
      ? new StreamingTranscriptionManager(transcriptionConfig, (command) => {
          if (finalized || terminalFinalize) return;
          terminalFinalize = command;
          if ((socket as any).readyState === 1) {
            socket.send(
              JSON.stringify({
                type: command.type,
                phrase: command.phrase,
                detectedAt: command.detectedAt,
                transcriptText: command.transcriptText,
                mode: streamMode,
              }),
            );
          }
          db.upsertClientStatus(device.userId, device.id, {
            mode: 'transcribing',
            status: command.type === 'abort'
              ? 'Voice command cancelled'
              : command.type === 'sleep'
                ? 'Voice sleep command detected'
                : 'Voice finish command detected',
            protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          });
          addLog(device.userId, {
            deviceId: device.id,
            source: device.deviceType,
            level: 'info',
            message: command.type === 'abort'
              ? 'Voice stop command detected'
              : command.type === 'sleep'
                ? 'Voice sleep command detected'
                : 'Voice finish command detected',
            detailsJson: JSON.stringify({
              phrase: command.phrase,
              transcriptChars: command.transcriptText.length,
              mode: streamMode,
              detectedAt: command.detectedAt,
            }),
          });
          void finalizeVoiceStream();
        }, (detection) => {
          if (finalized || terminalFinalize) return;
          if ((socket as any).readyState === 1) {
            socket.send(
              JSON.stringify({
                type: 'terminal_detected',
                commandType: detection.type,
                phrase: detection.phrase,
                detectedAt: detection.detectedAt,
                partialTranscriptChars: detection.partialTranscriptText.length,
                mode: streamMode,
              }),
            );
          }
          db.upsertClientStatus(device.userId, device.id, {
            mode: 'transcribing',
            status: detection.type === 'abort'
              ? 'Voice stop phrase detected'
              : detection.type === 'sleep'
                ? 'Voice sleep phrase detected'
                : 'Voice finish phrase detected',
            protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          });
          addLog(device.userId, {
            deviceId: device.id,
            source: device.deviceType,
            level: 'info',
            message: detection.type === 'abort'
              ? 'Voice stop phrase detected'
              : detection.type === 'sleep'
                ? 'Voice sleep phrase detected'
                : 'Voice finish phrase detected',
            detailsJson: JSON.stringify({
              phrase: detection.phrase,
              partialTranscriptChars: detection.partialTranscriptText.length,
              mode: streamMode,
              segmentSequence: detection.segmentSequence,
              segmentReason: detection.segmentReason,
              finalTranscriptionMode: detection.finalTranscriptionMode,
              detectedAt: detection.detectedAt,
            }),
          });
        })
      : null;
    socket.send(JSON.stringify({
      type: 'server_hello',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      maxBytes: MAX_STREAM_BYTES,
      maxDurationMs: MAX_STREAM_DURATION_MS,
    }));
    const heartbeat = setInterval(() => {
      if ((socket as any).readyState === 1) {
        socket.send(JSON.stringify({ type: 'server_ping', sentAt: new Date().toISOString() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    function activeDurationMs(now = Date.now()): number {
      const currentPauseMs = pausedAt === null ? 0 : Math.max(0, now - pausedAt);
      return Math.max(0, now - startedAt - accumulatedPausedMs - currentPauseMs);
    }

    function clearDurationLimit(): void {
      if (!durationLimit) return;
      clearTimeout(durationLimit);
      durationLimit = null;
    }

    function scheduleDurationLimit(): void {
      clearDurationLimit();
      if (finalized || pausedAt !== null) return;
      const remainingMs = Math.max(0, MAX_STREAM_DURATION_MS - activeDurationMs());
      durationLimit = setTimeout(() => {
        if ((socket as any).readyState === 1) {
          socket.close(VoiceCloseCode.TooLong, 'stream active duration limit exceeded');
        }
      }, remainingMs);
    }

    function pauseVoiceStream(reason = ''): void {
      if (pausedAt !== null) return;
      pausedAt = Date.now();
      clearDurationLimit();
      db.upsertClientStatus(device.userId, device.id, {
        mode: 'paused',
        status: 'Voice stream paused',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
      emitAppEvent(device.userId, 'client_status_changed', { deviceId: device.id, mode: 'paused' });
      emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'voice_stream_paused' });
      addLog(device.userId, {
        deviceId: device.id,
        source: device.deviceType,
        level: 'info',
        message: 'Voice stream paused',
        detailsJson: JSON.stringify({ mode: streamMode, reason }),
      });
    }

    function resumeVoiceStream(reason = ''): void {
      if (pausedAt === null) return;
      accumulatedPausedMs += Math.max(0, Date.now() - pausedAt);
      pausedAt = null;
      scheduleDurationLimit();
      db.upsertClientStatus(device.userId, device.id, {
        mode: 'recording',
        status: 'Voice stream resumed',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
      emitAppEvent(device.userId, 'client_status_changed', { deviceId: device.id, mode: 'recording' });
      emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'voice_stream_resumed' });
      addLog(device.userId, {
        deviceId: device.id,
        source: device.deviceType,
        level: 'info',
        message: 'Voice stream resumed',
        detailsJson: JSON.stringify({ mode: streamMode, reason }),
      });
    }

    scheduleDurationLimit();
    addLog(device.userId, {
      deviceId: device.id,
      source: device.deviceType,
      level: streamingEnabled ? 'info' : 'warn',
      message: 'Voice stream connected',
      detailsJson: JSON.stringify({
        deviceId: device.id,
        streamingTranscriptionEnabled: streamingEnabled,
        commandDetection: commandDetectionEnabled
          ? 'enabled'
          : ignoreCommands
            ? 'disabled: shortcut transcription mode'
            : 'disabled: missing speech transcription runtime',
      }),
    });
    db.upsertClientStatus(device.userId, device.id, {
      mode: 'recording',
      status: 'Voice stream connected',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
    });
    emitAppEvent(device.userId, 'client_status_changed', { deviceId: device.id, mode: 'recording' });
    emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'voice_stream_connected' });

    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        const parsed = parseVoiceClientMessage(String(data));
        if (!parsed) {
          socket.close(VoiceCloseCode.InvalidMessage, 'invalid protocol message');
          return;
        }
        if (parsed.type === 'client_ping') {
          socket.send(JSON.stringify({ type: 'server_pong', sentAt: new Date().toISOString(), clientSentAt: parsed.sentAt }));
          return;
        }
        if (parsed.type === 'pause') {
          pauseVoiceStream(parsed.reason);
          return;
        }
        if (parsed.type === 'resume') {
          resumeVoiceStream(parsed.reason);
          return;
        }
        if (parsed.type === 'end') {
          void finalizeVoiceStream();
        }
        return;
      }
      if (pausedAt !== null) return;
      frames += 1;
      const size = binarySize(data);
      bytes += size;
      if (bytes > MAX_STREAM_BYTES) {
        socket.close(VoiceCloseCode.TooLarge, 'stream byte limit exceeded');
        return;
      }
      const chunk = binaryChunk(data);
      if (chunk) {
        const copy = new Uint8Array(chunk);
        chunks.push(copy);
        storedBytes += copy.byteLength;
        streamingManager?.appendPcm(copy);
      }
    });

    socket.on('close', () => {
      streamingManager?.flushPending();
      void finalizeVoiceStream();
    });

    async function finalizeVoiceStream(): Promise<void> {
      if (finalized) return;
      finalized = true;
      streamingManager?.stop();
      clearInterval(heartbeat);
      clearDurationLimit();
      const session =
        (requestedSessionId ? db.voiceSessionForDevice(device.userId, device.id, requestedSessionId) : null) ??
        db.latestVoiceSessionForDevice(device.userId, device.id) ??
        db.createVoiceSession(device.userId, device.id, streamMode);
      let transcript = '';
      let assistantText = '';
      let runtime = 'fallback';
      try {
        if (terminalFinalize?.type === 'abort') {
          transcript = '';
        } else if (terminalFinalize?.transcriptText) {
          transcript = terminalFinalize.transcriptText.trim();
        } else {
          const transcription = await transcribePcm16(concatChunks(chunks, storedBytes));
          transcript = transcription.text;
          runtime = transcription.provider;
        }
        if (transcript) {
          addTranscript(device.userId, session.id, transcript);
          const approvalCode = approvalCodeFromText(transcript);
          if (approvalCode) {
            addApprovalCode(device.userId, { voiceSessionId: session.id, code: approvalCode, source: device.deviceType });
          }
          if (streamMode === 'clipboard') {
            if ((socket as any).readyState === 1) {
              if (terminalFinalize?.type !== 'finish') {
                socket.send(JSON.stringify({ type: 'finish', mode: streamMode, transcriptText: transcript }));
              }
            }
          } else {
            if (streamMode === 'patch') {
              db.addMessage(device.userId, session.assistantThreadId, { role: 'user', content: transcript });
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({ type: 'transcript_result', mode: streamMode, transcript, status: 'Transcript patched into chat.' }));
              }
            } else {
              let assistantError = '';
              let pendingStatus = '';
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({
                  type: 'assistant_status',
                  phase: 'thinking',
                  status: 'Assistant is thinking.',
                  threadId: session.assistantThreadId,
                }));
              }
              await promptAssistantThread(db, device.userId, session.assistantThreadId, { prompt: transcript }, (event) => {
                handleAssistantPromptEvent(device.userId, session.assistantThreadId, event);
                if ((event as any)?.type === 'queued') {
                  pendingStatus = 'Queued voice prompt.';
                  if ((socket as any).readyState === 1) {
                    socket.send(JSON.stringify({
                      type: 'assistant_status',
                      phase: 'queued',
                      status: pendingStatus,
                      threadId: session.assistantThreadId,
                    }));
                  }
                }
                if ((event as any)?.type === 'approval_pending') {
                  pendingStatus = 'Assistant is waiting for approval.';
                  if ((socket as any).readyState === 1) {
                    socket.send(JSON.stringify({
                      type: 'assistant_status',
                      phase: 'approval_pending',
                      status: pendingStatus,
                      threadId: session.assistantThreadId,
                    }));
                  }
                }
                if ((event as any)?.type === 'message' && (event as any).message?.role === 'assistant') {
                  const message = (event as any).message;
                  if (message.isError) {
                    assistantError = String(message.content ?? 'Voice assistant failed.').trim();
                    return;
                  }
                  assistantText = String(message.content ?? '').trim();
                }
                if ((event as any)?.type === 'error') {
                  assistantError = String((event as any).error ?? 'Voice assistant failed.');
                }
              });
              const thread = db.thread(device.userId, session.assistantThreadId);
              runtime = thread ? `${thread.provider}:${thread.model}` : 'assistant';
              emitAssistantChange('voice_thread_prompted', session.assistantThreadId, device.userId);
              if (!assistantText && assistantError) {
                throw new Error(assistantError);
              }
              if (!assistantText && pendingStatus) {
                if ((socket as any).readyState === 1) {
                  socket.send(JSON.stringify({ type: 'transcript_result', mode: streamMode, transcript, status: pendingStatus }));
                }
                return;
              }
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({ type: 'assistant_result', transcript, assistantText, runtime }));
              }
            }
          }
        } else if (terminalFinalize?.type === 'abort' && (socket as any).readyState === 1) {
          socket.send(JSON.stringify({ type: 'abort', mode: streamMode, transcriptText: '' }));
        } else if (!terminalFinalize && streamMode === 'clipboard' && (socket as any).readyState === 1) {
          socket.send(JSON.stringify({ type: 'finish', mode: streamMode, transcriptText: '' }));
        }
      } catch (error: any) {
        addLog(device.userId, {
          deviceId: device.id,
          source: device.deviceType,
          level: 'error',
          message: 'Voice runtime failed',
          detailsJson: JSON.stringify({ error: error?.message ?? String(error) }),
        });
        if ((socket as any).readyState === 1) {
          socket.send(JSON.stringify({ type: 'assistant_error', error: error?.message ?? String(error) }));
        }
      } finally {
        db.endVoiceSession(device.userId, session.id);
      }
      db.upsertClientStatus(device.userId, device.id, {
        mode: terminalFinalize?.type === 'sleep' ? 'sleeping' : 'awake',
        status: terminalFinalize?.type === 'sleep' ? 'Sleeping.' : 'Voice stream disconnected',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
      emitAppEvent(device.userId, 'client_status_changed', {
        deviceId: device.id,
        mode: terminalFinalize?.type === 'sleep' ? 'sleeping' : 'awake',
      });
      emitAppEvent(device.userId, 'device_changed', { deviceId: device.id, reason: 'voice_stream_disconnected' });
      const endedAt = Date.now();
      const activeMs = activeDurationMs(endedAt);
      const wallMs = Math.max(0, endedAt - startedAt);
      addLog(device.userId, {
        deviceId: device.id,
        source: device.deviceType,
        level: 'info',
        message: 'Voice stream disconnected',
        detailsJson: JSON.stringify({
          frames,
          bytes,
          durationMs: activeMs,
          wallDurationMs: wallMs,
          pausedMs: Math.max(0, wallMs - activeMs),
          transcriptChars: transcript.length,
          assistantChars: assistantText.length,
          runtime,
          mode: streamMode,
        }),
      });
      if ((socket as any).readyState === 1) {
        setTimeout(() => {
          if ((socket as any).readyState === 1) {
            socket.close(1000, 'finalized');
          }
        }, 150);
      }
    }
  });

  const webDist = path.resolve(process.cwd(), 'dist', 'web');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ ok: false, error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return { app, db, port };
}
