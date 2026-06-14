import path from 'node:path';
import crypto from 'node:crypto';
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { VoiceStreamNextDb, type DeviceRecord, type SpeechPlaybackTarget, type VoiceRecordingRecord } from './db.js';
import { requireAdmin, resolveRequestUser, type AuthContext } from './auth.js';
import { hasGroqSpeechRuntime, hasGroqTtsRuntime, synthesizeSpeech, transcribePcm16, type GroqCredentialSource, type RuntimeResult } from './assistant-runtime.js';
import {
  StreamingTranscriptionManager,
  buildStreamingTranscriptionConfigFromEnv,
  streamingTranscriptionEnabled,
  type TerminalCommand,
} from './streaming-transcription.js';
import { approvalCodeFromText } from './approval-code.js';
import { pcm16ToWav, wavPcm16Data } from './wav.js';
import { parseVoiceApprovalSettings, voiceApprovalSettingsResponse } from './voice-approval-settings.js';
import {
  assistantAvailableToolSummaries,
  assistantSnapshot,
  promptAssistantThread,
  resolveAssistantApproval,
  sanitizeArtifactPath,
  setAssistantExecutionTargetProvider,
  setAssistantExternalToolApprovalEvaluator,
  setAssistantExternalToolExecutor,
  setAssistantSpeakPlaybackResolver,
  type AssistantSpeakPlaybackResult,
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

const VOICE_RECORDING_RETENTION_PER_MODE = 10;
const VOICE_RECORDING_SAMPLE_RATE_HZ = 16_000;
const VOICE_RECORDING_CHANNELS = 1;
const LIVE_RECORDING_TARGET_MS = 20_000;
const LIVE_RECORDING_OVERLAP_MS = 3_000;
const LIVE_RECORDING_MIN_FINAL_MS = 1_000;
const MICROCREDITS_PER_CREDIT = 1_000_000;
const USD_MICROS_PER_DOLLAR = 1_000_000;
const MICROCREDITS_PER_DOLLAR = 100 * MICROCREDITS_PER_CREDIT;

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
  | 'voice_recording_changed'
  | 'approval_code_created'
  | 'release_changed'
  | 'setup_changed';

type FileByteRange = {
  start: number;
  end: number;
};

type ReleaseUploadPlatform = 'android' | 'desktop';

type ReleaseUploadSession = {
  token: string;
  platform: ReleaseUploadPlatform;
  ctx: AuthContext;
  createdAt: number;
  expiresAt: number;
};

type LiveRecordingSession = {
  id: string;
  userId: string;
  deviceId: string;
  deviceType: string;
  assistantThreadId: string;
  recordingId: string;
  filePath: string;
  pendingPcm: Uint8Array;
  overlapPcm: Uint8Array;
  totalBytes: number;
  processedBytes: number;
  sequence: number;
  transcriptText: string;
  provider: string | null;
  model: string | null;
  error: string | null;
  stopped: boolean;
  queue: Promise<void>;
};

function parsePort(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function uploadLimitBytes(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_RELEASE_UPLOAD_LIMIT_BYTES ?? 1024 * 1024 * 1024);
  return Number.isInteger(raw) && raw > 0 ? raw : 1024 * 1024 * 1024;
}

function releaseUploadSessionTtlMs(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_RELEASE_UPLOAD_SESSION_TTL_MS ?? 15 * 60 * 1000);
  return Number.isInteger(raw) && raw > 0 ? raw : 15 * 60 * 1000;
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

function cleanCreditGrantAmountMicrocredits(body: any): number {
  if (body?.amountMicrocredits != null && body.amountMicrocredits !== '') {
    const amount = Math.floor(Number(body.amountMicrocredits));
    if (Number.isSafeInteger(amount) && amount > 0) return amount;
  }
  const credits = Number(body?.amountCredits);
  if (Number.isFinite(credits) && credits > 0) {
    const amount = Math.round(credits * MICROCREDITS_PER_CREDIT);
    if (Number.isSafeInteger(amount) && amount > 0) return amount;
  }
  throw Object.assign(new Error('credit grant amount must be positive'), { statusCode: 400 });
}

function creditMarkupMultiplier(): number {
  const value = Number(process.env.VOICE_STREAM_NEXT_CREDIT_MARKUP ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function dollarsToVendorMicros(dollars: number): number {
  return Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * USD_MICROS_PER_DOLLAR));
}

function dollarsToChargedMicrocredits(dollars: number): number {
  return Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * MICROCREDITS_PER_DOLLAR * creditMarkupMultiplier()));
}

function groqSttCostDollars(durationMs: number): number {
  const hourly = Number(process.env.VOICE_STREAM_NEXT_GROQ_STT_DOLLARS_PER_HOUR ?? 0.04);
  const safeHourly = Number.isFinite(hourly) && hourly >= 0 ? hourly : 0.04;
  return (Math.max(0, durationMs) / 3_600_000) * safeHourly;
}

function groqTtsCostDollars(inputCharacters: number): number {
  const perMillion = Number(process.env.VOICE_STREAM_NEXT_GROQ_TTS_DOLLARS_PER_1M_CHARS ?? 22);
  const safePerMillion = Number.isFinite(perMillion) && perMillion >= 0 ? perMillion : 22;
  return (Math.max(0, inputCharacters) / 1_000_000) * safePerMillion;
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

function cleanHttpBaseUrl(raw: unknown): string {
  const value = cleanText(raw).replace(/\/+$/, '');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol');
    if (!url.hostname) throw new Error('missing host');
    return `${url.protocol}//${url.host}`;
  } catch {
    throw Object.assign(new Error('serverUrl must be an http(s) URL'), { statusCode: 400 });
  }
}

function desktopClaimProof(token: string, claim: { serverUrl: string; deviceId: string; displayName: string }): string {
  return crypto
    .createHmac('sha256', token)
    .update(JSON.stringify({
      serverUrl: claim.serverUrl,
      deviceId: claim.deviceId,
      displayName: claim.displayName,
    }))
    .digest('base64url');
}

function cleanDeviceMode(raw: unknown): string {
  const mode = cleanText(raw, 'off').toLowerCase();
  return ['off', 'awake', 'sleeping', 'recording', 'paused', 'transcribing', 'error'].includes(mode) ? mode : 'error';
}

function desktopAuthExpiresAt(from = Date.now()): string {
  const raw = Number(process.env.VOICE_STREAM_NEXT_DESKTOP_AUTH_TTL_MS ?? 10 * 60 * 1000);
  const ttlMs = Number.isInteger(raw) && raw > 0 ? raw : 10 * 60 * 1000;
  return new Date(from + ttlMs).toISOString();
}

function desktopPendingAuthExpiresAt(from = Date.now()): string {
  return new Date(from + 5 * 60 * 1000).toISOString();
}

function webViewHandoffExpiresAt(from = Date.now()): string {
  return new Date(from + 2 * 60 * 1000).toISOString();
}

function webViewSessionExpiresAt(from = Date.now()): string {
  return new Date(from + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function webViewSessionMaxAgeSeconds(expiresAt: string): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function parseFileByteRange(rawRange: unknown, fileSize: number): FileByteRange | null | 'invalid' {
  const range = String(Array.isArray(rawRange) ? rawRange[0] : rawRange ?? '').trim();
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || fileSize <= 0) return 'invalid';
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= fileSize) {
    return 'invalid';
  }
  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
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

function releaseUploadLogDetails(req: FastifyRequest, platform: ReleaseUploadPlatform): Record<string, unknown> {
  const metadataHeader = headerValue(req.headers['x-voice-release-metadata']);
  const fileNameFallback = platform === 'android' ? 'voice-stream-next-android-latest.apk' : 'voice-stream-next-desktop-latest.tar.gz';
  return {
    platform,
    reqId: req.id,
    method: req.method,
    url: req.url,
    host: headerValue(req.headers.host),
    contentType: headerValue(req.headers['content-type']) || null,
    contentLength: parseHeaderInteger(req.headers['content-length']),
    releaseFileName: releaseUploadFileName(req, fileNameFallback),
    metadataPresent: metadataHeader.length > 0,
    metadataBytes: Buffer.byteLength(metadataHeader),
    outputDir: platform === 'android' ? androidApkDir() : desktopAppDir(),
    dataDir: voiceStreamDataDir(),
  };
}

function releaseInfoLogDetails(info: AndroidApkInfo | DesktopAppInfo): Record<string, unknown> {
  return {
    variant: info.variant,
    fileName: info.fileName,
    size: info.size,
    downloadUrl: info.downloadUrl,
    ...('versionCode' in info ? { versionCode: info.versionCode, versionName: info.versionName } : {}),
  };
}

function parseHeaderInteger(raw: unknown): number | null {
  const value = Number(headerValue(raw));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function releaseUploadPlatformForRequest(req: FastifyRequest): ReleaseUploadPlatform | null {
  if (req.method.toUpperCase() !== 'PUT') return null;
  const pathOnly = req.url.split('?')[0];
  if (pathOnly === '/api/admin/releases/android') return 'android';
  if (pathOnly === '/api/admin/releases/desktop') return 'desktop';
  return null;
}

function releaseUploadToken(req: FastifyRequest): string {
  return headerValue(req.headers['x-voice-release-upload-token']);
}

function pruneReleaseUploadSessions(sessions: Map<string, ReleaseUploadSession>, now = Date.now()): void {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
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

export function binarySize(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, item) => total + binarySize(item), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

export function binaryChunk(data: unknown): Uint8Array | null {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const chunks = data.map((item) => binaryChunk(item)).filter((item): item is Uint8Array => Boolean(item));
    if (chunks.length === 0) return null;
    const output = new Uint8Array(chunks.reduce((total, item) => total + item.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
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

function safeWebViewRedirectUrl(req: FastifyRequest, raw: unknown): string {
  const fallback = serverPublicUrl(req);
  const value = cleanText(raw, fallback) || fallback;
  try {
    const redirect = new URL(value);
    const server = new URL(fallback);
    if (redirect.protocol !== 'http:' && redirect.protocol !== 'https:') return fallback;
    const allowedOrigins = new Set([server.origin]);
    if (server.port === '3299') {
      const dashboard = new URL(server.toString());
      dashboard.port = '5185';
      allowedOrigins.add(dashboard.origin);
    }
    if (!allowedOrigins.has(redirect.origin)) return fallback;
    redirect.username = '';
    redirect.password = '';
    redirect.hash = '';
    return redirect.toString();
  } catch {
    return fallback;
  }
}

function webViewSessionCookie(token: string, expiresAt: string, req: FastifyRequest): string {
  const secure =
    firstHeaderValue(req.headers['x-forwarded-proto']) === 'https' ||
    String((req as any).protocol ?? '').toLowerCase() === 'https';
  return [
    `voice_stream_webview_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${webViewSessionMaxAgeSeconds(expiresAt)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
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

function voiceRecordingMode(mode: string): 'assistant' | 'clipboard' | null {
  return mode === 'assistant' || mode === 'clipboard' ? mode : null;
}

type GroqCredential = {
  apiKey: string;
  source: GroqCredentialSource;
};

function resolveGroqCredential(db: VoiceStreamNextDb, userId: string): GroqCredential | null {
  const userKey = db.assistantApiKey(userId, 'groq');
  if (userKey) return { apiKey: userKey, source: 'user_groq_key' };
  return hasGroqSpeechRuntime() ? { apiKey: '', source: 'platform_groq_key' } : null;
}

function resolveGroqTtsCredential(db: VoiceStreamNextDb, userId: string): GroqCredential | null {
  const userKey = db.assistantApiKey(userId, 'groq');
  if (userKey) return { apiKey: userKey, source: 'user_groq_key' };
  return hasGroqTtsRuntime() ? { apiKey: '', source: 'platform_groq_key' } : null;
}

function requireVoiceSessionSpeechReadiness(db: VoiceStreamNextDb, userId: string, mode: string): void {
  if (mode !== 'assistant' && mode !== 'clipboard') return;
  const credential = resolveGroqCredential(db, userId);
  if (!credential || credential.source !== 'platform_groq_key') return;
  if (db.creditBalanceMicrocredits(userId) > 0) return;
  throw Object.assign(
    new Error('Voice transcription needs credits before recording can start. Ask an admin to grant credits.'),
    {
      statusCode: 402,
      reason: 'insufficient_credits',
    },
  );
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120) || 'unknown';
}

function voiceRecordingDir(db: VoiceStreamNextDb, userId: string, mode: string): string {
  return path.join(path.dirname(db.path), 'voice-recordings', safePathPart(userId), mode);
}

function voiceRecordingFilePath(db: VoiceStreamNextDb, userId: string, mode: string, sessionId: string): string {
  return path.join(voiceRecordingDir(db, userId, mode), `${safePathPart(sessionId)}.wav`);
}

function pcmDurationMs(bytes: number, sampleRateHz = VOICE_RECORDING_SAMPLE_RATE_HZ, channels = VOICE_RECORDING_CHANNELS): number {
  const bytesPerSample = 2;
  return Math.round((Math.max(0, bytes) / (sampleRateHz * channels * bytesPerSample)) * 1000);
}

function deleteRecordingFile(filePath: string): void {
  if (!filePath) return;
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Best-effort retention cleanup; stale DB rows have already been removed.
  }
}

function saveVoiceRecording(opts: {
  db: VoiceStreamNextDb;
  userId: string;
  sessionId: string;
  deviceId: string;
  assistantThreadId: string;
  mode: 'assistant' | 'clipboard';
  pcm: Uint8Array;
}): { recording: VoiceRecordingRecord; pruned: VoiceRecordingRecord[] } | null {
  if (opts.pcm.byteLength === 0) return null;
  const filePath = voiceRecordingFilePath(opts.db, opts.userId, opts.mode, opts.sessionId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const wav = pcm16ToWav(opts.pcm, VOICE_RECORDING_SAMPLE_RATE_HZ, VOICE_RECORDING_CHANNELS);
  writeFileSync(filePath, wav);
  const recording = opts.db.addVoiceRecording(opts.userId, {
    voiceSessionId: opts.sessionId,
    deviceId: opts.deviceId,
    assistantThreadId: opts.assistantThreadId,
    mode: opts.mode,
    filePath,
    mimeType: 'audio/wav',
    sizeBytes: wav.byteLength,
    durationMs: pcmDurationMs(opts.pcm.byteLength),
    sampleRateHz: VOICE_RECORDING_SAMPLE_RATE_HZ,
    channels: VOICE_RECORDING_CHANNELS,
  });
  const pruned = opts.db.pruneVoiceRecordings(opts.userId, opts.mode, VOICE_RECORDING_RETENTION_PER_MODE);
  for (const recording of pruned) deleteRecordingFile(recording.filePath);
  return { recording, pruned };
}

function saveVoiceRecordingWav(opts: {
  db: VoiceStreamNextDb;
  userId: string;
  sessionId: string;
  deviceId: string;
  assistantThreadId: string;
  mode: string;
  wav: Uint8Array;
  durationMs: number;
  sampleRateHz: number;
  channels: number;
  pruneKeep?: number | null;
}): { recording: VoiceRecordingRecord; pruned: VoiceRecordingRecord[] } | null {
  if (opts.wav.byteLength === 0) return null;
  const filePath = voiceRecordingFilePath(opts.db, opts.userId, opts.mode, opts.sessionId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, opts.wav);
  const recording = opts.db.addVoiceRecording(opts.userId, {
    voiceSessionId: opts.sessionId,
    deviceId: opts.deviceId,
    assistantThreadId: opts.assistantThreadId,
    mode: opts.mode,
    filePath,
    mimeType: 'audio/wav',
    sizeBytes: opts.wav.byteLength,
    durationMs: opts.durationMs,
    sampleRateHz: opts.sampleRateHz,
    channels: opts.channels,
  });
  const pruned = opts.pruneKeep == null ? [] : opts.db.pruneVoiceRecordings(opts.userId, opts.mode, opts.pruneKeep);
  for (const recording of pruned) deleteRecordingFile(recording.filePath);
  return { recording, pruned };
}

function wavHeader(dataSize: number, sampleRate = VOICE_RECORDING_SAMPLE_RATE_HZ, channels = VOICE_RECORDING_CHANNELS): Uint8Array {
  const bytesPerSample = 2;
  const safeDataSize = Math.min(0xffffffff - 36, Math.max(0, Math.floor(dataSize)));
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + safeDataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, safeDataSize, true);
  return new Uint8Array(buffer);
}

function rewriteWavHeader(filePath: string, dataSize: number): void {
  const fd = openSync(filePath, 'r+');
  try {
    writeSync(fd, wavHeader(dataSize), 0, 44, 0);
  } finally {
    closeSync(fd);
  }
}

function appendLiveRecordingPcm(state: LiveRecordingSession, pcm: Uint8Array): void {
  if (pcm.byteLength === 0) return;
  appendFileSync(state.filePath, pcm);
  state.totalBytes += pcm.byteLength;
  rewriteWavHeader(state.filePath, state.totalBytes);
}

function concatPcm(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function appendPcm(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice();
  if (right.byteLength === 0) return left.slice();
  return concatPcm([left, right]);
}

function pcmBytesForMs(ms: number): number {
  const bytes = Math.max(0, Math.floor((VOICE_RECORDING_SAMPLE_RATE_HZ * VOICE_RECORDING_CHANNELS * 2 * ms) / 1000));
  return bytes - (bytes % 2);
}

function tailPcm(pcm: Uint8Array, maxBytes: number): Uint8Array {
  const safeBytes = Math.max(0, maxBytes - (maxBytes % 2));
  if (safeBytes <= 0 || pcm.byteLength <= safeBytes) return pcm.slice();
  return pcm.slice(pcm.byteLength - safeBytes);
}

function splitPcmAt(pcm: Uint8Array, byteOffset: number): { head: Uint8Array; tail: Uint8Array } {
  const safeOffset = Math.max(0, Math.min(pcm.byteLength, byteOffset - (byteOffset % 2)));
  return {
    head: pcm.slice(0, safeOffset),
    tail: pcm.slice(safeOffset),
  };
}

function quietCutByteOffset(pcm: Uint8Array, targetBytes: number): number {
  const safeTarget = Math.max(0, Math.min(pcm.byteLength, targetBytes - (targetBytes % 2)));
  const searchBytes = pcmBytesForMs(5_000);
  const windowBytes = pcmBytesForMs(200);
  const start = Math.max(0, safeTarget - searchBytes);
  const end = Math.min(pcm.byteLength, safeTarget + Math.floor(searchBytes / 2));
  if (end - start < windowBytes) return safeTarget;

  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bestOffset = safeTarget;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let offset = start; offset + windowBytes <= end; offset += windowBytes) {
    let sum = 0;
    for (let sampleOffset = offset; sampleOffset + 1 < offset + windowBytes; sampleOffset += 2) {
      sum += Math.abs(view.getInt16(sampleOffset, true));
    }
    const score = sum / Math.max(1, windowBytes / 2);
    const distancePenalty = Math.abs(offset - safeTarget) / Math.max(1, searchBytes);
    const adjusted = score * (1 + distancePenalty);
    if (adjusted < bestScore) {
      bestScore = adjusted;
      bestOffset = offset;
    }
  }
  return Math.max(pcmBytesForMs(5_000), bestOffset - (bestOffset % 2));
}

function mergeTranscriptText(existing: string, next: string): string {
  const cleanExisting = existing.trim();
  const cleanNext = next.trim();
  if (!cleanExisting) return cleanNext;
  if (!cleanNext) return cleanExisting;

  const existingWords = cleanExisting.split(/\s+/);
  const nextWords = cleanNext.split(/\s+/);
  const maxOverlap = Math.min(24, existingWords.length, nextWords.length);
  const normalize = (word: string) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  for (let count = maxOverlap; count >= 3; count -= 1) {
    const left = existingWords.slice(existingWords.length - count).map(normalize).join(' ');
    const right = nextWords.slice(0, count).map(normalize).join(' ');
    if (left && left === right) {
      return `${cleanExisting} ${nextWords.slice(count).join(' ')}`.trim();
    }
  }
  return `${cleanExisting} ${cleanNext}`.trim();
}

function liveRecordingPayload(recording: VoiceRecordingRecord): Record<string, unknown> {
  return {
    recordingId: recording.id,
    voiceSessionId: recording.voiceSessionId,
    deviceId: recording.deviceId,
    mode: recording.mode,
    sizeBytes: recording.sizeBytes,
    durationMs: recording.durationMs,
    transcriptLength: recording.transcriptText?.length ?? 0,
    live: recording.sessionEndedAt == null,
    prunedCount: 0,
  };
}

function pcmBody(req: FastifyRequest): Uint8Array {
  const body = req.body;
  const bytes = Buffer.isBuffer(body)
    ? new Uint8Array(body)
    : body instanceof Uint8Array
      ? body
      : new Uint8Array(0);
  return bytes.byteLength % 2 === 0 ? bytes : bytes.slice(0, bytes.byteLength - 1);
}

async function withUser<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  db: VoiceStreamNextDb,
  clerkEnabled: boolean,
  fn: (ctx: AuthContext) => Promise<T> | T,
  onError?: (error: any, status: number) => void,
): Promise<T | undefined> {
  try {
    const ctx = await resolveRequestUser(req, db, clerkEnabled);
    return await fn(ctx);
  } catch (error: any) {
    const status = Number(error?.statusCode ?? 0) || 500;
    onError?.(error, status);
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
  const releaseUploadSessions = new Map<string, ReleaseUploadSession>();
  const liveRecordingSessions = new Map<string, LiveRecordingSession>();
  let appEventSequence = 0;
  const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY?.trim());
  const port = parsePort(process.env.PORT ?? process.env.VOICE_STREAM_NEXT_API_PORT, 3299);

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
  setAssistantExecutionTargetProvider(async (input) => ({
    devices: extensionBridges.connectedDevices(input.userId).map((device) => ({
      deviceId: device.deviceId,
      deviceType: device.deviceType,
      displayName: device.displayName,
      connected: true,
      connectedAt: device.connectedAt,
      manifests: device.manifests
        .filter((manifest) => !input.extensionId || manifest.id === input.extensionId)
        .map((manifest) => ({
          id: manifest.id,
          name: manifest.name,
          toolNames: manifest.tools
            .filter((tool) => !input.slot || tool.targetSlot === input.slot)
            .map((tool) => extensionToolName(manifest.id, tool.name)),
          slots: [...new Set(manifest.tools.map((tool) => tool.targetSlot).filter(Boolean) as string[])],
        }))
        .filter((manifest) => manifest.toolNames.length > 0 || manifest.slots.length > 0),
      })),
  }));

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

  const emitDeviceSettingsChanged = (userId: string, settings: string, reason?: string) => {
    for (const device of db.listDevices(userId)) {
      if (device.revokedAt) continue;
      controlChannels.sendSettingsChanged(device.id, settings, reason);
    }
  };

  const emitAndroidReleaseChanged = (android: AndroidApkInfo) => {
    for (const device of db.listDevices()) {
      if (device.revokedAt || device.deviceType !== 'android') continue;
      controlChannels.sendReleaseChanged(device.id, {
        platform: 'android',
        versionCode: android.versionCode,
        apkUrl: android.downloadUrl,
      });
    }
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

  const setLiveTranscript = (state: LiveRecordingSession, final: boolean) => {
    if (!state.transcriptText.trim()) return;
    db.setTranscript(state.userId, state.id, state.transcriptText, final);
    emitAppEvent(state.userId, 'transcript_created', { voiceSessionId: state.id, recordingId: state.recordingId, live: !final });
  };

  const refreshLiveRecording = (state: LiveRecordingSession) => {
    const recording = db.updateVoiceRecordingMetrics(state.userId, state.recordingId, {
      sizeBytes: 44 + state.totalBytes,
      durationMs: pcmDurationMs(state.totalBytes),
    });
    if (recording) emitAppEvent(state.userId, 'voice_recording_changed', liveRecordingPayload(recording));
    return recording;
  };

  const processLiveRecording = async (state: LiveRecordingSession, final = false) => {
    const targetBytes = pcmBytesForMs(LIVE_RECORDING_TARGET_MS);
    const overlapBytes = pcmBytesForMs(LIVE_RECORDING_OVERLAP_MS);
    const minFinalBytes = pcmBytesForMs(LIVE_RECORDING_MIN_FINAL_MS);

    while (state.pendingPcm.byteLength >= targetBytes || (final && state.pendingPcm.byteLength >= minFinalBytes)) {
      const cutBytes = final && state.pendingPcm.byteLength < targetBytes
        ? state.pendingPcm.byteLength
        : quietCutByteOffset(state.pendingPcm, targetBytes);
      const { head, tail } = splitPcmAt(state.pendingPcm, cutBytes);
      state.pendingPcm = tail;
      if (head.byteLength < minFinalBytes) break;

      const windowPcm = appendPcm(state.overlapPcm, head);
      const startMs = Math.max(0, pcmDurationMs(state.processedBytes) - pcmDurationMs(state.overlapPcm.byteLength));
      state.processedBytes += head.byteLength;
      const endMs = pcmDurationMs(state.processedBytes);
      state.overlapPcm = tailPcm(head, overlapBytes);

      const groqCredential = resolveGroqCredential(db, state.userId);
      if (groqCredential?.source === 'platform_groq_key' && windowPcm.byteLength >= 1600) {
        db.requirePositiveCreditBalance(state.userId, 'Groq live recording transcription');
      }
      const transcription = await transcribePcm16(windowPcm, {
        apiKey: groqCredential?.apiKey,
        credentialSource: groqCredential?.source,
      });
      state.provider = transcription.provider;
      state.model = transcription.model;
      state.sequence += 1;
      const segmentText = transcription.text.trim();
      if (segmentText) {
        state.transcriptText = mergeTranscriptText(state.transcriptText, segmentText);
        db.addVoiceRecordingSegment(state.userId, {
          recordingId: state.recordingId,
          voiceSessionId: state.id,
          sequence: state.sequence,
          startMs,
          endMs,
          text: segmentText,
          provider: transcription.provider,
          model: transcription.model,
          final,
        });
        setLiveTranscript(state, final && state.pendingPcm.byteLength < minFinalBytes);
      }
      recordGroqTranscriptionUsage(state.userId, transcription, {
        deviceId: state.deviceId,
        voiceSessionId: state.id,
        assistantThreadId: state.assistantThreadId,
        source: 'desktop_live_recording',
      });
      refreshLiveRecording(state);
    }

    if (final) {
      setLiveTranscript(state, true);
      db.endVoiceSession(state.userId, state.id);
      const recording = refreshLiveRecording(state);
      if (recording) emitAppEvent(state.userId, 'voice_recording_changed', liveRecordingPayload(recording));
    }
  };

  const enqueueLiveRecordingProcessing = (state: LiveRecordingSession, final = false) => {
    state.queue = state.queue
      .then(() => processLiveRecording(state, final))
      .catch((error: any) => {
        state.error = error?.message ?? String(error);
        addLog(state.userId, {
          deviceId: state.deviceId,
          source: state.deviceType,
          level: 'error',
          message: 'Desktop live recording transcription failed',
          detailsJson: JSON.stringify({ error: state.error, recordingId: state.recordingId, voiceSessionId: state.id }),
        });
        emitAppEvent(state.userId, 'voice_recording_changed', {
          recordingId: state.recordingId,
          voiceSessionId: state.id,
          deviceId: state.deviceId,
          mode: 'computer',
          error: state.error,
        });
      });
    return state.queue;
  };

  const recordGroqTranscriptionUsage = (
    userId: string,
    result: RuntimeResult,
    metadata: { deviceId?: string | null; voiceSessionId?: string | null; assistantThreadId?: string | null; source: string },
  ) => {
    if (result.provider !== 'groq') return;
    if (result.credentialSource !== 'platform_groq_key') return;
    const costDollars = groqSttCostDollars(result.audioDurationMs);
    db.recordBillableUsage({
      userId,
      threadId: metadata.assistantThreadId ?? null,
      service: 'groq',
      provider: 'groq',
      credentialSource: result.credentialSource,
      model: result.model,
      operation: 'speech_to_text',
      unitCount: result.audioDurationMs,
      vendorCostMicros: dollarsToVendorMicros(costDollars),
      chargedMicrocredits: dollarsToChargedMicrocredits(costDollars),
      status: 'succeeded',
      metadata,
    });
    emitAppEvent(userId, 'settings_changed', { reason: 'credits_charged' });
  };

  const recordGroqTtsUsage = (
    userId: string,
    speech: { provider: 'groq' | 'fallback'; credentialSource: GroqCredentialSource | null; model: string | null; inputCharacters: number },
    metadata: { source: string; threadId?: string; messageId?: string },
  ) => {
    if (speech.provider !== 'groq') return;
    if (speech.credentialSource !== 'platform_groq_key') return;
    const costDollars = groqTtsCostDollars(speech.inputCharacters);
    db.recordBillableUsage({
      userId,
      threadId: metadata.threadId ?? null,
      service: 'groq',
      provider: 'groq',
      credentialSource: speech.credentialSource,
      model: speech.model,
      operation: 'text_to_speech',
      unitCount: speech.inputCharacters,
      vendorCostMicros: dollarsToVendorMicros(costDollars),
      chargedMicrocredits: dollarsToChargedMicrocredits(costDollars),
      status: 'succeeded',
      metadata,
    });
    emitAppEvent(userId, 'settings_changed', { reason: 'credits_charged' });
  };

  type SpeechSurface = 'web' | 'desktop' | 'android';
  type SpeechDestination = {
    surface: SpeechSurface;
    deviceId?: string;
    clientId?: string;
    activityAt: string;
  };
  const speechQueues = new Map<string, Promise<AssistantSpeakPlaybackResult>>();

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

  const speechDestinationResult = (
    userId: string,
    destination: SpeechDestination | null,
    delivered: boolean,
    error?: string | null,
  ): AssistantSpeakPlaybackResult => {
    if (!destination) {
      return { surface: null, label: 'No target', delivered, error: error ?? null };
    }
    if (destination.surface === 'web') return { surface: 'web', label: 'App', delivered, error: error ?? null };
    const device = destination.deviceId ? db.deviceForUser(userId, destination.deviceId) : null;
    const fallback = destination.surface === 'android' ? 'Android' : 'Desktop';
    return {
      surface: destination.surface,
      label: device?.displayName || fallback,
      deviceId: destination.deviceId ?? null,
      deviceName: device?.displayName ?? null,
      delivered,
      error: error ?? null,
    };
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
  ): Promise<AssistantSpeakPlaybackResult> => {
    const clean = cleanText(text).slice(0, 4096);
    if (!clean) return { surface: null, label: 'No speech', delivered: false, error: 'empty speech text' };
    const destination = selectSpeechDestination(userId);
    if (!destination) {
      addLog(userId, {
        source: 'speech',
        level: 'warn',
        message: 'Speech playback skipped: no connected playback target',
        detailsJson: JSON.stringify({ source: metadata.source, chars: clean.length }),
      });
      return speechDestinationResult(userId, null, false, 'no connected playback target');
    }
    try {
      const thread = metadata.threadId ? db.thread(userId, metadata.threadId) : null;
      const profile = thread?.assistantProfileId ? db.assistantProfile(userId, thread.assistantProfileId) : db.defaultAssistantProfile(userId);
      const groqCredential = resolveGroqTtsCredential(db, userId);
      if (groqCredential?.source === 'platform_groq_key') db.requirePositiveCreditBalance(userId, 'Groq speech synthesis');
      const speech = await synthesizeSpeech(clean, {
        voice: profile?.ttsVoice,
        apiKey: groqCredential?.apiKey,
        credentialSource: groqCredential?.source,
      });
      if (!speech.audio) {
        addLog(userId, {
          source: 'speech',
          level: 'warn',
          message: 'Speech playback skipped: TTS is not configured',
          detailsJson: JSON.stringify({ source: metadata.source, target: destination.surface, chars: clean.length }),
        });
        return speechDestinationResult(userId, destination, false, 'TTS is not configured');
      }
      recordGroqTtsUsage(userId, speech, metadata);
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
        detailsJson: JSON.stringify({ source: metadata.source, target: destination.surface, assistantProfileId: profile?.id ?? null, ttsVoice: profile?.ttsVoice ?? null, chars: clean.length, bytes: speech.audio.byteLength }),
      });
      return speechDestinationResult(userId, destination, delivered, delivered ? null : 'playback delivery failed');
    } catch (error: any) {
      addLog(userId, {
        deviceId: destination.deviceId ?? null,
        source: 'speech',
        level: 'error',
        message: 'Speech synthesis failed',
        detailsJson: JSON.stringify({ source: metadata.source, target: destination.surface, error: error?.message ?? String(error) }),
      });
      return speechDestinationResult(userId, destination, false, error?.message ?? String(error));
    }
  };

  const enqueueSpeechAudio = (
    userId: string,
    text: string,
    metadata: { source: string; threadId?: string; messageId?: string },
  ): Promise<AssistantSpeakPlaybackResult> => {
    const previous = speechQueues.get(userId) ?? Promise.resolve({ surface: null, label: 'No target', delivered: false });
    let next: Promise<AssistantSpeakPlaybackResult>;
    next = previous
      .catch(() => ({ surface: null, label: 'No target', delivered: false }))
      .then(() => emitSpeechAudio(userId, text, metadata))
      .finally(() => {
        if (speechQueues.get(userId) === next) speechQueues.delete(userId);
      });
    speechQueues.set(userId, next);
    return next;
  };

  setAssistantSpeakPlaybackResolver(async (input) =>
    enqueueSpeechAudio(input.userId, input.text, {
      source: 'assistant',
      threadId: input.thread.id,
      messageId: input.toolCallId,
    }));

  app.addHook('onClose', async () => {
    setAssistantExternalToolExecutor(null);
    setAssistantExternalToolApprovalEvaluator(null);
    setAssistantSpeakPlaybackResolver(null);
    setAssistantExecutionTargetProvider(null);
  });

  const handleAssistantPromptEvent = (userId: string, threadId: string, event: any) => {
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

  app.addHook('onRequest', async (req, reply) => {
    const platform = releaseUploadPlatformForRequest(req);
    if (!platform) return;
    const uploadLog = releaseUploadLogDetails(req, platform);
    const label = platform === 'android' ? 'Android' : 'Desktop';
    req.log.info(uploadLog, `${label} release upload started`);
    req.raw.once('aborted', () => {
      req.log.warn(uploadLog, `${label} release upload aborted while reading request body`);
    });
    req.raw.once('close', () => {
      if (req.raw.complete || req.raw.destroyed) return;
      req.log.warn(uploadLog, `${label} release upload connection closed before request completed`);
    });

    const token = releaseUploadToken(req);
    const now = Date.now();
    pruneReleaseUploadSessions(releaseUploadSessions, now);
    const session = token ? releaseUploadSessions.get(token) : null;
    releaseUploadSessions.delete(token);
    try {
      if (!session) throw Object.assign(new Error('release upload session is missing or expired'), { statusCode: 401 });
      if (session.platform !== platform) throw Object.assign(new Error('release upload session platform mismatch'), { statusCode: 400 });
      if (session.expiresAt <= now) throw Object.assign(new Error('release upload session expired'), { statusCode: 401 });
      const ctx = session.ctx;
      req.log.info({
        ...uploadLog,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        admin: ctx.user.admin,
        sessionAgeMs: now - session.createdAt,
      }, `${label} release upload session accepted before body`);
      requireAdmin(ctx);
      (req as FastifyRequest & { releaseUploadAuth?: AuthContext }).releaseUploadAuth = ctx;
    } catch (error: any) {
      const status = Number(error?.statusCode ?? 0) || 500;
      const log = {
        ...uploadLog,
        status,
        error: error?.message ?? String(error),
        errorName: error?.name ?? null,
        stack: status >= 500 ? error?.stack : undefined,
      };
      if (status >= 500) req.log.error(log, `${label} release upload failed before body`);
      else req.log.warn(log, `${label} release upload rejected before body`);
      reply.code(status).send({ ok: false, error: error?.message ?? String(error) });
      return reply;
    }
  });

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

  app.post('/api/admin/releases/upload-session', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      const body = jsonBody(req);
      const platform = cleanText(body.platform).toLowerCase();
      if (platform !== 'android' && platform !== 'desktop') {
        throw Object.assign(new Error('release upload platform must be android or desktop'), { statusCode: 400 });
      }
      pruneReleaseUploadSessions(releaseUploadSessions);
      const token = `rel_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
      const now = Date.now();
      const expiresAt = now + releaseUploadSessionTtlMs();
      releaseUploadSessions.set(token, {
        token,
        platform,
        ctx,
        createdAt: now,
        expiresAt,
      });
      req.log.info({
        platform,
        reqId: req.id,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        expiresAt: new Date(expiresAt).toISOString(),
      }, `${platform === 'android' ? 'Android' : 'Desktop'} release upload session created`);
      return { ok: true, uploadToken: token, expiresAt: new Date(expiresAt).toISOString() };
    }),
  );

  app.put('/api/admin/releases/android', async (req, reply) => {
    const uploadLog = releaseUploadLogDetails(req, 'android');
    req.log.info(uploadLog, 'Android release upload received');
    const preAuth = (req as FastifyRequest & { releaseUploadAuth?: AuthContext }).releaseUploadAuth;
    const handleUpload = async (ctx: AuthContext) => {
      req.log.info({
        ...uploadLog,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        admin: ctx.user.admin,
      }, 'Android release upload authenticated');
      requireAdmin(ctx);
      const android = writeAndroidApkRelease(req, req.body);
      req.log.info({
        ...uploadLog,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        ...releaseInfoLogDetails(android),
      }, 'Android release upload stored');
      addLog(ctx.user.id, {
        source: 'admin',
        level: 'info',
        message: `Android release uploaded: ${android.fileName ?? 'latest APK'}`,
        detailsJson: JSON.stringify({ variant: android.variant, versionCode: android.versionCode, size: android.size }),
      });
      emitAppEvent(null, 'release_changed', { platform: 'android' });
      emitAndroidReleaseChanged(android);
      return { ok: true, android };
    };
    if (preAuth) return handleUpload(preAuth);
    return withUser(req, reply, db, clerkEnabled, handleUpload, (error, status) => {
      const log = {
        ...uploadLog,
        status,
        error: error?.message ?? String(error),
        errorName: error?.name ?? null,
        stack: status >= 500 ? error?.stack : undefined,
      };
      if (status >= 500) req.log.error(log, 'Android release upload failed');
      else req.log.warn(log, 'Android release upload rejected');
    });
  });

  app.put('/api/admin/releases/desktop', async (req, reply) => {
    const uploadLog = releaseUploadLogDetails(req, 'desktop');
    req.log.info(uploadLog, 'Desktop release upload received');
    const preAuth = (req as FastifyRequest & { releaseUploadAuth?: AuthContext }).releaseUploadAuth;
    const handleUpload = async (ctx: AuthContext) => {
      req.log.info({
        ...uploadLog,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        admin: ctx.user.admin,
      }, 'Desktop release upload authenticated');
      requireAdmin(ctx);
      const desktop = writeDesktopAppRelease(req, req.body);
      req.log.info({
        ...uploadLog,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        ...releaseInfoLogDetails(desktop),
      }, 'Desktop release upload stored');
      addLog(ctx.user.id, {
        source: 'admin',
        level: 'info',
        message: `Desktop release uploaded: ${desktop.fileName ?? 'latest app'}`,
        detailsJson: JSON.stringify({ variant: desktop.variant, size: desktop.size }),
      });
      emitAppEvent(null, 'release_changed', { platform: 'desktop' });
      return { ok: true, desktop };
    };
    if (preAuth) return handleUpload(preAuth);
    return withUser(req, reply, db, clerkEnabled, handleUpload, (error, status) => {
      const log = {
        ...uploadLog,
        status,
        error: error?.message ?? String(error),
        errorName: error?.name ?? null,
        stack: status >= 500 ? error?.stack : undefined,
      };
      if (status >= 500) req.log.error(log, 'Desktop release upload failed');
      else req.log.warn(log, 'Desktop release upload rejected');
    });
  });

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
      emitDeviceSettingsChanged(ctx.user.id, 'voice_codes', 'voice_codes_updated');
      return { ok: true, settings };
    }),
  );

  app.get('/api/settings/voice-approval', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) =>
      voiceApprovalSettingsResponse(db.ensureVoiceSettings(ctx.user.id), { assistantProfiles: db.listAssistantProfiles(ctx.user.id) }),
    ),
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
      emitDeviceSettingsChanged(ctx.user.id, 'voice_approval', 'voice_approval_updated');
      return voiceApprovalSettingsResponse(settings, { assistantProfiles: db.listAssistantProfiles(ctx.user.id) });
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

  app.post('/api/desktop-auth/remote-claim', async (req, reply) => {
    const body = jsonBody(req);
    const requestId = cleanText(body.requestId);
    const secret = cleanText(body.secret);
    const serverUrl = cleanHttpBaseUrl(body.serverUrl);
    const deviceId = cleanText(body.deviceId);
    const displayName = cleanText(body.displayName, 'Desktop voice client') || 'Desktop voice client';
    const deviceToken = cleanText(body.deviceToken);
    const claimProof = cleanText(body.claimProof);
    if (!requestId || !secret || !deviceId) {
      reply.code(400).send({ ok: false, error: 'desktop auth request, secret, and device id are required' });
      return undefined;
    }
    const result = db.completeRemoteDesktopAuthRequest({ requestId, secret, serverUrl, deviceId, displayName, deviceToken, claimProof });
    if (!result.ok) {
      const status = result.reason === 'expired' || result.reason === 'claimed' ? 409 : result.reason === 'invalid_secret' || result.reason === 'invalid_claim' ? 401 : 404;
      reply.code(status).send({ ok: false, error: `desktop auth request ${result.reason.replace('_', ' ')}` });
      return undefined;
    }
    if (result.status !== 'claimed') {
      reply.code(409).send({ ok: false, error: 'desktop auth request was not claimed' });
      return undefined;
    }
    return { ok: true, status: result.status, device: result.device, serverUrl: result.serverUrl, minClientVersion: minClientVersion() };
  });

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
        serverUrl: result.status === 'claimed' ? result.serverUrl : undefined,
        minClientVersion: minClientVersion(),
      };
    } catch (error: any) {
      reply.code(500).send({ ok: false, error: error?.message ?? String(error) });
      return undefined;
    }
  });

  app.post('/api/devices/:deviceId/webview-handoff', async (req, reply) => {
    const deviceId = cleanText((req.params as any).deviceId);
    const token = cleanText(req.headers['x-voice-device-token'] || (jsonBody(req) as any).token);
    if (!deviceId || !token) {
      reply.code(401).send({ ok: false, error: 'device token required' });
      return;
    }
    const body = jsonBody(req);
    const auth = verifyDeviceAuth(
      db,
      deviceId,
      token,
      parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(body.clientVersion, null)),
    );
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    const device = resolveDeviceInstallation(db, auth.device, cleanText(req.headers['x-voice-installation-id'] || body.installationId) || null, token);
    const redirectUrl = safeWebViewRedirectUrl(req, body.redirectUrl);
    const { handoff, secret } = db.createWebViewHandoff({
      userId: device.userId,
      deviceId: device.id,
      redirectUrl,
      expiresAt: webViewHandoffExpiresAt(),
    });
    const claimUrl = new URL('/api/android-webview/claim', serverPublicUrl(req));
    claimUrl.searchParams.set('id', handoff.id);
    claimUrl.searchParams.set('secret', secret);
    return { ok: true, url: claimUrl.toString(), expiresAt: handoff.expiresAt };
  });

  app.get('/api/android-webview/claim', async (req, reply) => {
    const query = req.query as any;
    const id = cleanText(query.id);
    const secret = cleanText(query.secret);
    if (!id || !secret) {
      reply.code(400).send({ ok: false, error: 'webview handoff is missing' });
      return;
    }
    const result = db.claimWebViewHandoff(id, secret, webViewSessionExpiresAt());
    if (!result.ok) {
      const status = result.reason === 'expired' || result.reason === 'claimed' ? 409 : result.reason === 'invalid_secret' ? 401 : 404;
      reply.code(status).send({ ok: false, error: `webview handoff ${result.reason.replace('_', ' ')}` });
      return;
    }
    reply
      .header('set-cookie', webViewSessionCookie(result.sessionToken, result.expiresAt, req))
      .redirect(result.handoff.redirectUrl);
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

  app.post('/api/devices/:deviceId/desktop-auth/claims', async (req, reply) => {
    const body = jsonBody(req);
    const sourceDeviceId = cleanText((req.params as any).deviceId);
    const sourceToken = cleanText(req.headers['x-voice-device-token'] || body.token);
    const auth = verifyDeviceAuth(db, sourceDeviceId, sourceToken, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({ ok: false, error: deviceAuthFailureMessage(auth), reason: auth.reason, minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined });
      return undefined;
    }
    const displayName = cleanText(body.displayName, 'Desktop voice client') || 'Desktop voice client';
    const desktopToken = cleanText(body.deviceToken);
    const installationId = cleanText(body.installationId) || null;
    const serverUrl = cleanHttpBaseUrl(body.serverUrl || serverPublicUrl(req));
    if (!desktopToken) {
      reply.code(400).send({ ok: false, error: 'desktop device token is required' });
      return undefined;
    }
    const device = db.registerDeviceWithToken(auth.device.userId, {
      deviceType: 'desktop',
      displayName,
      token: desktopToken,
      installationId,
      pendingAuthExpiresAt: desktopPendingAuthExpiresAt(),
    });
    addLog(auth.device.userId, {
      deviceId: device.id,
      source: 'android',
      level: 'info',
      message: `Desktop QR connected: ${displayName}`,
      detailsJson: JSON.stringify({ sourceDeviceId: auth.device.id, installationId, pendingAuth: true }),
    });
    emitAppEvent(auth.device.userId, 'device_changed', { deviceId: device.id, reason: 'desktop_qr_claimed' });
    return {
      ok: true,
      device,
      claimProof: desktopClaimProof(desktopToken, { serverUrl, deviceId: device.id, displayName: device.displayName }),
      minClientVersion: minClientVersion(),
    };
  });

  app.post('/api/devices/:deviceId/desktop-auth/claims/:desktopDeviceId/revoke', async (req, reply) => {
    const body = jsonBody(req);
    const sourceDeviceId = cleanText((req.params as any).deviceId);
    const desktopDeviceId = cleanText((req.params as any).desktopDeviceId);
    const sourceToken = cleanText(req.headers['x-voice-device-token'] || body.token);
    const auth = verifyDeviceAuth(db, sourceDeviceId, sourceToken, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({ ok: false, error: deviceAuthFailureMessage(auth), reason: auth.reason, minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined });
      return undefined;
    }
    const revoked = db.revokeDevice(auth.device.userId, desktopDeviceId);
    if (!revoked) {
      reply.code(404).send({ ok: false, error: 'desktop device not found' });
      return undefined;
    }
    addLog(auth.device.userId, {
      deviceId: revoked.id,
      source: 'android',
      level: 'warn',
      message: `Desktop QR claim rolled back: ${revoked.displayName}`,
      detailsJson: JSON.stringify({ sourceDeviceId: auth.device.id }),
    });
    emitAppEvent(auth.device.userId, 'device_changed', { deviceId: revoked.id, reason: 'desktop_qr_claim_rolled_back' });
    return { ok: true, device: revoked, minClientVersion: minClientVersion() };
  });

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

  app.get('/api/admin/users', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      return { ok: true, users: db.listAdminUsersWithBilling(), pendingCreditGrants: db.listPendingCreditGrants() };
    }),
  );

  app.get('/api/admin/users/:userId/credits', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      const userId = cleanText((req.params as any).userId);
      const summary = db.adminUserBillingSummary(userId);
      if (!summary) throw Object.assign(new Error('unknown user'), { statusCode: 404 });
      return {
        ok: true,
        user: summary,
        ledger: db.listCreditLedger(userId, 120),
        usageEvents: db.listBillableUsageEvents(userId, 120),
      };
    }),
  );

  app.post('/api/admin/credits/email-grants', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      const body = jsonBody(req);
      const result = db.grantCreditsByEmail(ctx.user.id, {
        email: cleanText(body.email),
        amountMicrocredits: cleanCreditGrantAmountMicrocredits(body),
        reason: cleanText(body.reason, 'Admin credit grant') || 'Admin credit grant',
        metadata: { source: 'admin_email_page' },
      });
      if (result.user?.user.id) emitAppEvent(result.user.user.id, 'settings_changed', { reason: 'credits_granted' });
      return {
        ok: true,
        ...result,
        users: db.listAdminUsersWithBilling(),
        pendingCreditGrants: db.listPendingCreditGrants(),
      };
    }),
  );

  app.post('/api/admin/users/:userId/credits/grants', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      const targetUserId = cleanText((req.params as any).userId);
      const body = jsonBody(req);
      const ledgerEntry = db.grantCredits(ctx.user.id, targetUserId, {
        amountMicrocredits: cleanCreditGrantAmountMicrocredits(body),
        reason: cleanText(body.reason, 'Admin credit grant') || 'Admin credit grant',
        metadata: { source: 'admin_page' },
      });
      const summary = db.adminUserBillingSummary(targetUserId);
      emitAppEvent(targetUserId, 'settings_changed', { reason: 'credits_granted' });
      return {
        ok: true,
        ledgerEntry,
        user: summary,
        users: db.listAdminUsersWithBilling(),
      };
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

  app.get('/api/voice/recordings', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const mode = cleanText(query.mode).toLowerCase();
      const validMode = mode === 'assistant' || mode === 'clipboard' || mode === 'computer' ? mode : undefined;
      const limitRaw = Number(query.limit);
      const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 40) : 20;
      const offsetRaw = Number(query.offset);
      const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
      const recordings = validMode
        ? db.listVoiceRecordings(ctx.user.id, limit, { mode: validMode, offset })
        : db.listVoiceRecordings(ctx.user.id, limit, { offset });
      const total = validMode ? db.countVoiceRecordings(ctx.user.id, { mode: validMode }) : db.countVoiceRecordings(ctx.user.id);
      return {
        ok: true,
        retentionPerMode: VOICE_RECORDING_RETENTION_PER_MODE,
        limit,
        offset,
        total,
        recordings,
      };
    }),
  );

  app.get('/api/voice/recordings/:recordingId/audio', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const recordingId = cleanText((req.params as any).recordingId);
      const recording = db.voiceRecording(ctx.user.id, recordingId);
      if (!recording || !existsSync(recording.filePath)) {
        reply.code(404).send({ ok: false, error: 'recording not found' });
        return;
      }
      const download = queryValue((req.query as any)?.download) === '1';
      const stat = statSync(recording.filePath);
      const range = parseFileByteRange(req.headers.range, stat.size);
      reply.header('content-type', recording.mimeType || 'audio/wav');
      reply.header('accept-ranges', 'bytes');
      reply.header('cache-control', 'private, max-age=60');
      if (download) {
        const fileName = `voice-${recording.mode}-${recording.createdAt.replace(/[^0-9T-]+/g, '-')}.wav`;
        reply.header('content-disposition', `attachment; filename="${fileName}"`);
      }
      if (range === 'invalid') {
        reply.header('content-range', `bytes */${stat.size}`);
        reply.header('content-length', '0');
        reply.code(416);
        return reply.send();
      }
      if (range) {
        reply.code(206);
        reply.header('content-range', `bytes ${range.start}-${range.end}/${stat.size}`);
        reply.header('content-length', String(range.end - range.start + 1));
        return reply.send(createReadStream(recording.filePath, { start: range.start, end: range.end }));
      }
      reply.header('content-length', String(stat.size));
      return reply.send(createReadStream(recording.filePath));
    }),
  );

  app.get('/api/voice/recordings/:recordingId/transcript', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const recordingId = cleanText((req.params as any).recordingId);
      const recording = db.voiceRecording(ctx.user.id, recordingId);
      const transcriptText = recording?.transcriptText?.trim();
      if (!recording || !transcriptText) {
        reply.code(404).send({ ok: false, error: 'transcript not found' });
        return;
      }
      const download = queryValue((req.query as any)?.download) === '1';
      reply.header('content-type', 'text/plain; charset=utf-8');
      reply.header('cache-control', 'private, max-age=60');
      if (download) {
        const fileName = `voice-${recording.mode}-${recording.createdAt.replace(/[^0-9T-]+/g, '-')}.txt`;
        reply.header('content-disposition', `attachment; filename="${fileName}"`);
      }
      return `${transcriptText}\n`;
    }),
  );

  app.post('/api/voice/live-recordings/start', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const deviceId = cleanText(req.headers['x-voice-device-id'] || query.deviceId);
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
    const existing = [...liveRecordingSessions.values()].find((session) => session.userId === device.userId && session.deviceId === device.id && !session.stopped);
    if (existing) {
      reply.code(409).send({ ok: false, error: 'A live recording is already active for this desktop device.' });
      return;
    }

    try {
      const session = db.createVoiceSession(device.userId, device.id, 'computer');
      const filePath = voiceRecordingFilePath(db, device.userId, 'computer', session.id);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, wavHeader(0));
      const recording = db.addVoiceRecording(device.userId, {
        voiceSessionId: session.id,
        deviceId: device.id,
        assistantThreadId: session.assistantThreadId,
        mode: 'computer',
        filePath,
        mimeType: 'audio/wav',
        sizeBytes: 44,
        durationMs: 0,
        sampleRateHz: VOICE_RECORDING_SAMPLE_RATE_HZ,
        channels: VOICE_RECORDING_CHANNELS,
      });
      const liveSession: LiveRecordingSession = {
        id: session.id,
        userId: device.userId,
        deviceId: device.id,
        deviceType: device.deviceType,
        assistantThreadId: session.assistantThreadId,
        recordingId: recording.id,
        filePath,
        pendingPcm: new Uint8Array(0),
        overlapPcm: new Uint8Array(0),
        totalBytes: 0,
        processedBytes: 0,
        sequence: 0,
        transcriptText: '',
        provider: null,
        model: null,
        error: null,
        stopped: false,
        queue: Promise.resolve(),
      };
      liveRecordingSessions.set(session.id, liveSession);
      emitAppEvent(device.userId, 'voice_recording_changed', liveRecordingPayload(recording));
      return {
        ok: true,
        sessionId: session.id,
        recording,
        chunkTargetMs: LIVE_RECORDING_TARGET_MS,
        overlapMs: LIVE_RECORDING_OVERLAP_MS,
      };
    } catch (error: any) {
      const message = error?.message ?? String(error);
      const status = Number(error?.statusCode) || 500;
      reply.code(status >= 400 && status < 600 ? status : 500).send({ ok: false, error: message });
    }
  });

  app.post('/api/voice/live-recordings/:sessionId/chunk', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const sessionId = cleanText((req.params as any).sessionId);
    const deviceId = cleanText(req.headers['x-voice-device-id'] || query.deviceId);
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const clientVersion = parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({ ok: false, error: deviceAuthFailureMessage(auth), reason: auth.reason });
      return;
    }
    const state = liveRecordingSessions.get(sessionId);
    if (!state || state.userId !== auth.device.userId || state.deviceId !== auth.device.id) {
      reply.code(404).send({ ok: false, error: 'live recording session not found' });
      return;
    }
    if (state.stopped) {
      reply.code(409).send({ ok: false, error: 'live recording session has already stopped' });
      return;
    }
    const pcm = pcmBody(req);
    if (pcm.byteLength > 0) {
      appendLiveRecordingPcm(state, pcm);
      state.pendingPcm = appendPcm(state.pendingPcm, pcm);
      refreshLiveRecording(state);
      if (state.pendingPcm.byteLength >= pcmBytesForMs(LIVE_RECORDING_TARGET_MS)) {
        void enqueueLiveRecordingProcessing(state, false);
      }
    }
    return {
      ok: true,
      sessionId: state.id,
      recordingId: state.recordingId,
      durationMs: pcmDurationMs(state.totalBytes),
      bufferedMs: pcmDurationMs(state.pendingPcm.byteLength),
      transcriptText: state.transcriptText,
      error: state.error,
    };
  });

  app.post('/api/voice/live-recordings/:sessionId/stop', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const sessionId = cleanText((req.params as any).sessionId);
    const deviceId = cleanText(req.headers['x-voice-device-id'] || query.deviceId);
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const clientVersion = parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({ ok: false, error: deviceAuthFailureMessage(auth), reason: auth.reason });
      return;
    }
    const state = liveRecordingSessions.get(sessionId);
    if (!state || state.userId !== auth.device.userId || state.deviceId !== auth.device.id) {
      reply.code(404).send({ ok: false, error: 'live recording session not found' });
      return;
    }
    if (state.stopped) {
      await state.queue.catch(() => null);
      const recording = db.voiceRecording(state.userId, state.recordingId);
      if (state.error) reply.code(502);
      return {
        ok: !state.error,
        recording,
        text: recording?.transcriptText ?? '',
        provider: state.provider,
        model: state.model,
        audioUrl: `/api/voice/recordings/${encodeURIComponent(state.recordingId)}/audio`,
        transcriptUrl: recording?.transcriptText ? `/api/voice/recordings/${encodeURIComponent(state.recordingId)}/transcript?download=1` : null,
        error: state.error,
      };
    }
    const pcm = pcmBody(req);
    if (pcm.byteLength > 0) {
      appendLiveRecordingPcm(state, pcm);
      state.pendingPcm = appendPcm(state.pendingPcm, pcm);
      refreshLiveRecording(state);
    }
    state.stopped = true;
    await enqueueLiveRecordingProcessing(state, true);
    liveRecordingSessions.delete(state.id);
    const recording = db.voiceRecording(state.userId, state.recordingId);
    if (state.error) {
      reply.code(502).send({ ok: false, error: state.error, recording });
      return;
    }
    return {
      ok: true,
      recording,
      text: recording?.transcriptText ?? '',
      provider: state.provider,
      model: state.model,
      audioUrl: `/api/voice/recordings/${encodeURIComponent(state.recordingId)}/audio`,
      transcriptUrl: recording?.transcriptText ? `/api/voice/recordings/${encodeURIComponent(state.recordingId)}/transcript?download=1` : null,
    };
  });

  app.post('/api/voice/local-recordings/transcribe', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const deviceId = cleanText(req.headers['x-voice-device-id'] || query.deviceId);
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
    const body = req.body;
    const wav = Buffer.isBuffer(body)
      ? new Uint8Array(body)
      : body instanceof Uint8Array
        ? body
        : null;
    if (!wav || wav.byteLength === 0) {
      reply.code(400).send({ ok: false, error: 'audio upload is empty' });
      return;
    }

    try {
      const { pcm, sampleRate, channels } = wavPcm16Data(wav);
      const groqCredential = resolveGroqCredential(db, device.userId);
      if (groqCredential?.source === 'platform_groq_key' && pcm.byteLength >= 1600) {
        db.requirePositiveCreditBalance(device.userId, 'Groq local recording transcription');
      }
      const transcription = await transcribePcm16(pcm, {
        apiKey: groqCredential?.apiKey,
        credentialSource: groqCredential?.source,
      });
      const session = db.createVoiceSession(device.userId, device.id, 'computer');
      const transcriptText = cleanText(transcription.text);
      if (transcriptText) addTranscript(device.userId, session.id, transcriptText);
      db.endVoiceSession(device.userId, session.id);
      const saved = saveVoiceRecordingWav({
        db,
        userId: device.userId,
        sessionId: session.id,
        deviceId: device.id,
        assistantThreadId: session.assistantThreadId,
        mode: 'computer',
        wav,
        durationMs: transcription.audioDurationMs || pcmDurationMs(pcm.byteLength, sampleRate, channels),
        sampleRateHz: sampleRate,
        channels,
        pruneKeep: null,
      });
      if (!saved) throw new Error('Recording upload is empty.');
      emitAppEvent(device.userId, 'voice_recording_changed', {
        recordingId: saved.recording.id,
        voiceSessionId: session.id,
        deviceId: device.id,
        mode: 'computer',
        prunedCount: 0,
      });
      recordGroqTranscriptionUsage(device.userId, transcription, {
        deviceId: device.id,
        voiceSessionId: session.id,
        assistantThreadId: session.assistantThreadId,
        source: 'desktop_local_recording',
      });
      addLog(device.userId, {
        deviceId: device.id,
        source: 'desktop',
        level: transcription.text ? 'info' : 'warn',
        message: transcription.text ? 'Desktop local recording transcribed' : 'Desktop local recording transcription returned no text',
        detailsJson: JSON.stringify({
          bytes: wav.byteLength,
          pcmBytes: pcm.byteLength,
          durationMs: transcription.audioDurationMs,
          provider: transcription.provider,
          model: transcription.model,
          recordingId: saved.recording.id,
        }),
      });
      return {
        ok: true,
        text: transcriptText,
        provider: transcription.provider,
        credentialSource: transcription.credentialSource,
        model: transcription.model,
        audioDurationMs: transcription.audioDurationMs,
        sampleRateHz: sampleRate,
        channels,
        recording: saved.recording,
        audioUrl: `/api/voice/recordings/${encodeURIComponent(saved.recording.id)}/audio`,
        transcriptUrl: transcriptText ? `/api/voice/recordings/${encodeURIComponent(saved.recording.id)}/transcript?download=1` : null,
      };
    } catch (error: any) {
      const message = error?.message ?? String(error);
      const explicitStatus = Number(error?.statusCode);
      const status = explicitStatus >= 400 && explicitStatus < 600
        ? explicitStatus
        : /credit/i.test(message)
          ? 402
          : /wav|audio|pcm|sample|mono|chunk/i.test(message)
            ? 400
            : 502;
      addLog(device.userId, {
        deviceId: device.id,
        source: 'desktop',
        level: 'error',
        message: 'Desktop local recording transcription failed',
        detailsJson: JSON.stringify({ error: message, bytes: wav.byteLength }),
      });
      reply.code(status).send({ ok: false, error: message });
    }
  });

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
      settings: voiceApprovalSettingsResponse(db.ensureVoiceSettings(auth.device.userId), { assistantProfiles: db.listAssistantProfiles(auth.device.userId) }).settings,
      assistantProfiles: db.listAssistantProfiles(auth.device.userId),
      minClientVersion: minClientVersion(),
    };
  });

  app.get('/api/devices/:deviceId/assistant/thread', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const query = (req.query ?? {}) as Record<string, unknown>;
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const assistantProfileId = queryValue(query.assistantProfileId) || null;
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
    const thread = db.latestVoiceThreadOrNull(auth.device.userId, assistantProfileId);
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
    const assistantProfileId = queryValue(query.assistantProfileId) || null;
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
    const thread = db.latestVoiceThreadOrNull(auth.device.userId, assistantProfileId);
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
      const requestedProvider = cleanText(body.provider);
      const thread = db.createThread(ctx.user.id, {
        title: cleanText(body.title, 'New thread') || 'New thread',
        source: 'voice',
        assistantProfileId: cleanText(body.assistantProfileId) || null,
        voiceEnabled: true,
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
      if (body.title !== undefined) patch.title = cleanText(body.title, 'New thread') || 'New thread';
      if (body.assistantProfileId !== undefined) patch.assistantProfileId = cleanText(body.assistantProfileId) || null;
      if (body.provider !== undefined) patch.provider = cleanText(body.provider, 'openai') || 'openai';
      if (body.model !== undefined) patch.model = cleanText(body.model, 'gpt-5.5') || 'gpt-5.5';
      if (body.thinkingLevel !== undefined) patch.thinkingLevel = cleanText(body.thinkingLevel, 'off') || 'off';
      if (body.voiceEnabled !== undefined) patch.voiceEnabled = true;
      if (body.autoApprove !== undefined) patch.autoApprove = Boolean(body.autoApprove);
      if (body.handsFreeMode !== undefined) patch.handsFreeMode = Boolean(body.handsFreeMode);
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

  app.get('/api/assistant/skills', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      skills: db.listAssistantSkills(ctx.user.id),
    })),
  );

  app.post('/api/assistant/skills', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const skill = db.createAssistantSkill(ctx.user.id, {
        name: cleanText(body.name),
        slug: cleanText(body.slug) || undefined,
        description: cleanText(body.description),
        markdownBody: cleanText(body.markdownBody ?? body.content),
        toolNames: Array.isArray(body.toolNames) ? body.toolNames : cleanText(body.toolNames),
        disableModelInvocation: Boolean(body.disableModelInvocation),
      });
      emitAssistantChange('assistant_skill_created', undefined, ctx.user.id);
      return { ok: true, skill, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.patch('/api/assistant/skills/:skillId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const skillId = String((req.params as any).skillId ?? '');
      const body = jsonBody(req);
      const patch: Parameters<VoiceStreamNextDb['updateAssistantSkill']>[2] = {};
      if (body.name !== undefined) patch.name = cleanText(body.name);
      if (body.slug !== undefined) patch.slug = cleanText(body.slug);
      if (body.description !== undefined) patch.description = cleanText(body.description);
      if (body.markdownBody !== undefined || body.content !== undefined) patch.markdownBody = cleanText(body.markdownBody ?? body.content);
      if (body.toolNames !== undefined) patch.toolNames = Array.isArray(body.toolNames) ? body.toolNames : cleanText(body.toolNames);
      if (body.disableModelInvocation !== undefined) patch.disableModelInvocation = Boolean(body.disableModelInvocation);
      const skill = db.updateAssistantSkill(ctx.user.id, skillId, patch);
      if (!skill) throw Object.assign(new Error('unknown skill'), { statusCode: 404 });
      emitAssistantChange('assistant_skill_updated', undefined, ctx.user.id);
      return { ok: true, skill, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.delete('/api/assistant/skills/:skillId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const skillId = String((req.params as any).skillId ?? '');
      const deleted = db.deleteAssistantSkill(ctx.user.id, skillId);
      if (!deleted) throw Object.assign(new Error('unknown skill'), { statusCode: 404 });
      emitAssistantChange('assistant_skill_deleted', undefined, ctx.user.id);
      return { ok: true, deleted, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
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

  app.get('/api/assistant/profiles', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({ ok: true, profiles: db.listAssistantProfiles(ctx.user.id) })),
  );

  app.post('/api/assistant/profiles', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const profile = db.createAssistantProfile(ctx.user.id, {
        name: body.name,
        wakePhrase: body.wakePhrase,
        wakePhraseAliases: body.wakePhraseAliases,
        ttsVoice: body.ttsVoice,
        baseProfileId: body.baseProfileId,
        systemPrompt: body.systemPrompt,
        enabledTools: body.enabledTools,
        defaultHandsFreeMode: Boolean(body.defaultHandsFreeMode),
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      });
      emitAssistantChange('assistant_profile_created', undefined, ctx.user.id);
      emitAppEvent(ctx.user.id, 'settings_changed', { settings: 'assistant_profiles' });
      emitDeviceSettingsChanged(ctx.user.id, 'assistant_profiles', 'assistant_profile_created');
      return { ok: true, profile, profiles: db.listAssistantProfiles(ctx.user.id), snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.patch('/api/assistant/profiles/:profileId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const profileId = String((req.params as any).profileId ?? '');
      const body = jsonBody(req);
      const profile = db.updateAssistantProfile(ctx.user.id, profileId, {
        ...(body.name !== undefined ? { name: cleanText(body.name, 'Assistant') || 'Assistant' } : {}),
        ...(body.wakePhrase !== undefined ? { wakePhrase: body.wakePhrase } : {}),
        ...(body.wakePhraseAliases !== undefined ? { wakePhraseAliases: body.wakePhraseAliases } : {}),
        ...(body.ttsVoice !== undefined ? { ttsVoice: body.ttsVoice } : {}),
        ...(body.baseProfileId !== undefined ? { baseProfileId: cleanText(body.baseProfileId) || null } : {}),
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
        ...(body.systemPrompt !== undefined ? { systemPrompt: cleanText(body.systemPrompt) } : {}),
        ...(body.enabledTools !== undefined ? { enabledTools: Array.isArray(body.enabledTools) ? body.enabledTools.map((tool: unknown) => cleanText(tool)).filter(Boolean) : null } : {}),
        ...(body.defaultHandsFreeMode !== undefined ? { defaultHandsFreeMode: Boolean(body.defaultHandsFreeMode) } : {}),
      });
      if (!profile) throw Object.assign(new Error('unknown assistant profile'), { statusCode: 404 });
      emitAssistantChange('assistant_profile_updated', undefined, ctx.user.id);
      emitAppEvent(ctx.user.id, 'settings_changed', { settings: 'assistant_profiles' });
      emitDeviceSettingsChanged(ctx.user.id, 'assistant_profiles', 'assistant_profile_updated');
      return { ok: true, profile, profiles: db.listAssistantProfiles(ctx.user.id), snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.get('/api/assistant/keys', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      keys: db.assistantApiKeysView(ctx.user.id),
    })),
  );

  app.get('/api/assistant/keys/:provider/reveal', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const provider = (req.params as any)?.provider;
      const key = db.assistantApiKey(ctx.user.id, provider);
      if (!key) {
        throw Object.assign(new Error('API key is not configured.'), { statusCode: 404 });
      }
      return {
        ok: true,
        provider,
        apiKey: key,
      };
    }),
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
      const snapshot = await resolveAssistantApproval(db, ctx.user.id, approvalId, true, ctx.user.email || ctx.user.displayName || 'user');
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
    const assistantProfileId = cleanText(body.assistantProfileId) || null;
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
      try {
        requireVoiceSessionSpeechReadiness(db, device.userId, mode);
      } catch (error: any) {
        reply.code(Number(error?.statusCode ?? 402) || 402).send({
          ok: false,
          error: error?.message ?? String(error),
          reason: error?.reason ?? 'voice_session_unavailable',
        });
        return;
      }
      const session = db.createVoiceSession(device.userId, device.id, mode, { assistantProfileId });
      return { ok: true, session, device };
    }
    return withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const device = db.deviceForUser(ctx.user.id, deviceId);
      if (!device || device.revokedAt) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      requireVoiceSessionSpeechReadiness(db, ctx.user.id, mode);
      const session = db.createVoiceSession(ctx.user.id, deviceId, mode, { assistantProfileId });
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
    const assistantProfileId = queryValue(query.assistantProfileId) || null;
    const ignoreCommands = queryValue(query.ignoreCommands) === '1';
    const verifiedDevice = verifyDeviceAuth(db, deviceId, token, parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    if (!verifiedDevice.ok) {
      socket.close(deviceAuthCloseCode(verifiedDevice), deviceAuthFailureMessage(verifiedDevice));
      return;
    }
    const device = resolveDeviceInstallation(db, verifiedDevice.device, installationId, token);
    const groqSpeechCredential = resolveGroqCredential(db, device.userId);

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
    const streamingEnabled = streamingTranscriptionEnabled() || Boolean(groqSpeechCredential);
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
        }, {
          transcribe: (pcm) => transcribePcm16(pcm, {
            apiKey: groqSpeechCredential?.apiKey,
            credentialSource: groqSpeechCredential?.source,
          }),
          beforeTranscription: (pcm) => {
            if (groqSpeechCredential?.source === 'platform_groq_key' && pcm.byteLength >= 1600) {
              db.requirePositiveCreditBalance(device.userId, 'Groq streaming transcription');
            }
          },
          onTranscription: (result, source) => {
            recordGroqTranscriptionUsage(device.userId, result, {
              deviceId: device.id,
              source: `voice_stream_${source}`,
            });
          },
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
      const requestedSession = requestedSessionId ? db.voiceSessionForDevice(device.userId, device.id, requestedSessionId) : null;
      const profileMatchedRequestedSession = requestedSession && (!assistantProfileId || requestedSession.assistantProfileId === assistantProfileId)
        ? requestedSession
        : null;
      const session =
        profileMatchedRequestedSession ??
        (assistantProfileId ? null : db.latestVoiceSessionForDevice(device.userId, device.id)) ??
        db.createVoiceSession(device.userId, device.id, streamMode, { assistantProfileId });
      const recordingMode = voiceRecordingMode(streamMode);
      const recordingPcm = recordingMode ? concatChunks(chunks, storedBytes) : new Uint8Array(0);
      let transcript = '';
      let assistantText = '';
      let runtime = 'fallback';
      try {
        if (terminalFinalize?.type === 'abort') {
          transcript = '';
        } else if (terminalFinalize?.transcriptText) {
          transcript = terminalFinalize.transcriptText.trim();
        } else {
          if (groqSpeechCredential?.source === 'platform_groq_key' && recordingPcm.byteLength >= 1600) {
            db.requirePositiveCreditBalance(device.userId, 'Groq speech transcription');
          }
          const transcription = await transcribePcm16(recordingPcm, {
            apiKey: groqSpeechCredential?.apiKey,
            credentialSource: groqSpeechCredential?.source,
          });
          transcript = transcription.text;
          runtime = transcription.provider;
          recordGroqTranscriptionUsage(device.userId, transcription, {
            deviceId: device.id,
            voiceSessionId: session.id,
            assistantThreadId: session.assistantThreadId,
            source: 'voice_final',
          });
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
        if (recordingMode) {
          try {
            const saved = saveVoiceRecording({
              db,
              userId: device.userId,
              sessionId: session.id,
              deviceId: device.id,
              assistantThreadId: session.assistantThreadId,
              mode: recordingMode,
              pcm: recordingPcm,
            });
            if (saved) {
              emitAppEvent(device.userId, 'voice_recording_changed', {
                recordingId: saved.recording.id,
                voiceSessionId: session.id,
                deviceId: device.id,
                mode: recordingMode,
                prunedCount: saved.pruned.length,
              });
            }
          } catch (error: any) {
            addLog(device.userId, {
              deviceId: device.id,
              source: device.deviceType,
              level: 'error',
              message: 'Voice recording save failed',
              detailsJson: JSON.stringify({ error: error?.message ?? String(error), mode: streamMode }),
            });
          }
        }
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
