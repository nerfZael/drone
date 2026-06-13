import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import QRCode from "qrcode";
import {
  GroqTranscriptionManager,
  buildTranscriptionConfigFromEnv,
  type TranscriptCommand,
  type TranscriptMessage,
  type TranscriptStatus,
} from "./stt.js";
import {
  buildTtsConfigFromEnv,
  synthesizeApprovalCodeWav,
  synthesizeTextWav,
} from "./tts.js";
import {
  buildHubClientConfigFromEnv,
  beginVoicePatch,
  connectVoiceThread,
  endVoicePatch,
  getVoiceApprovalSettings,
  submitVoicePatchMessage,
  submitVoiceMessage,
} from "./hub-client.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const sampleRateHz = 16_000;
const apkRelativePath = "android/app/build/outputs/apk/debug/app-debug.apk";
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..");
const apkPath = resolve(process.env.APK_PATH ?? resolve(repoRoot, apkRelativePath));
const pairingToken = loadPairingToken();
const pairingAdminPassword = process.env.DRONE_PAIR_PASSWORD?.trim();
const pairingAdminSessions = new Set<string>();
const androidLogPath = resolve(repoRoot, "server/.runtime/android-logs/drone-android.log");
const androidMinVersion = resolveAndroidVersionInfo();
const approvalCodes: ApprovalCodeMessage[] = [];
const defaultApprovalSettings: VoiceApprovalSettings = {
  triggerPhrase: "approval code",
  unlockCode: "1234",
  lockCode: "4321",
  lockedOffCode: "0000",
  minDigits: 4,
  maxDigits: 8,
  stableMs: 900,
  collectTimeoutMs: 5_000,
  duplicateCooldownMs: 4_000,
  finalizeCheckIntervalMs: 250,
};
const defaultActivationSettings: VoiceActivationSettings = {
  normalAliases: ["hey Sebastian", "hay Sebastian"],
  realTimeAliases: ["Sebastian enter real-time mode", "Sebastian enter realtime mode"],
};
let currentApprovalSettings: VoiceApprovalSettings = defaultApprovalSettings;
let currentApprovalSettingsFingerprint = JSON.stringify(defaultApprovalSettings);
let currentActivationSettings: VoiceActivationSettings = defaultActivationSettings;
let currentActivationSettingsFingerprint = JSON.stringify(defaultActivationSettings);

type AndroidVersionInfo = {
  versionCode: number;
  versionName?: string;
  source: string;
};

type VoiceApprovalSettings = {
  triggerPhrase: string;
  unlockCode: string;
  lockCode: string;
  lockedOffCode: string;
  minDigits: number;
  maxDigits: number;
  stableMs: number;
  collectTimeoutMs: number;
  duplicateCooldownMs: number;
  finalizeCheckIntervalMs: number;
};

type VoiceActivationSettings = {
  normalAliases: string[];
  realTimeAliases: string[];
};

type ApprovalCodeMessage = {
  type: "approval_code";
  code: string;
  source: string;
  receivedAt: string;
  detectedAt?: string;
};

type AndroidStatusMessage = {
  type: "android_status";
  mode: string;
  status: string;
  microphone?: string;
  approvalStatus?: string;
  reportedAt?: string;
  receivedAt: string;
  controlClientId?: number;
};

const server = createServer((req, res) => {
  void handleHttpRequest(req, res).catch((error) => {
    console.error("HTTP handler failed", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Internal server error\n");
  });
});

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    await serveDownloadPage(req, res);
    return;
  }

  if (url.pathname === "/pair") {
    await servePairingPage(req, res);
    return;
  }

  if (url.pathname === "/download/app-debug.apk") {
    serveApk(req.method ?? "GET", res);
    return;
  }

  if (url.pathname === "/logs/android") {
    await serveAndroidLogUpload(req, res, url);
    return;
  }

  if (url.pathname === "/approvals") {
    await serveApprovalCode(req, res, url);
    return;
  }

  if (url.pathname === "/internal/approval-settings/reload") {
    await serveApprovalSettingsReload(req, res, url);
    return;
  }

  if (url.pathname === "/speak") {
    await serveSpeak(req, res);
    return;
  }

  if (url.pathname === "/audio") {
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
    res.end("Upgrade required. Connect to this endpoint with WebSocket.\n");
    return;
  }

  if (url.pathname === "/control") {
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
    res.end("Upgrade required. Connect to this endpoint with WebSocket.\n");
    return;
  }

  if (url.pathname === "/monitor") {
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
    res.end("Upgrade required. Connect to this endpoint with WebSocket.\n");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found\n");
}

const wss = new WebSocketServer({ noServer: true });
const controlWss = new WebSocketServer({ noServer: true });
const monitorWss = new WebSocketServer({ noServer: true });
const transcriptionConfig = buildTranscriptionConfigFromEnv(process.env);
const ttsConfig = buildTtsConfigFromEnv(process.env);
const hubClientConfig = buildHubClientConfigFromEnv(process.env);
let latestTranscriptStatus: TranscriptStatus = initialTranscriptStatus();
let latestAndroidStatus: AndroidStatusMessage | null = null;

let nextClientId = 1;
let nextControlClientId = 1;
let nextMonitorId = 1;
const controlClients = new Map<number, WebSocket>();
type VoiceMode = "assistant" | "patch" | "clipboard" | "realtime";

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const target = url.pathname === "/audio" ? wss : url.pathname === "/control" ? controlWss : url.pathname === "/monitor" ? monitorWss : null;

  if (!target) {
    socket.destroy();
    return;
  }

  if ((url.pathname === "/audio" || url.pathname === "/control") && !isAuthorizedAudioRequest(url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    console.warn(`[auth] rejected unauthorized ${url.pathname} websocket`);
    return;
  }

  target.handleUpgrade(req, socket, head, (webSocket) => {
    target.emit("connection", webSocket, req);
  });
});

wss.on("connection", (socket, request) => {
  const clientId = nextClientId++;
  const remote = `${request.socket.remoteAddress ?? "unknown"}:${request.socket.remotePort ?? ""}`;
  const requestUrl = new URL(request.url ?? "/audio", `http://${request.headers.host ?? "localhost"}`);
  const voiceMode = parseVoiceMode(requestUrl.searchParams.get("mode"));
  const patchSessionId = voiceMode === "patch" ? randomBytes(12).toString("hex") : null;
  const sttManager = new GroqTranscriptionManager(
    {
      ...transcriptionConfig,
      broadcastSegments: voiceMode === "assistant" || voiceMode === "realtime",
      ignoreEmptySleepCommands: voiceMode === "patch",
      ignoreAbortCommands: voiceMode === "realtime",
      finalTranscriptionMode: voiceMode === "realtime" ? "segments" : transcriptionConfig.finalTranscriptionMode,
    },
    (message) => broadcastTranscriptMessage(message),
    (command) => {
      sendAudioCommand(socket, clientId, command);
      void handleTranscriptCommand(clientId, voiceMode, command, patchSessionId);
    },
    (segment) => {
      if (voiceMode !== "realtime") return;
      return submitRealtimeVoiceSegment(clientId, segment.text);
    },
    `client ${clientId}`,
  );
  let bytesIn = 0;
  let framesIn = 0;

  console.log(`[client ${clientId}] connected from ${remote}`);
  void handleVoiceClientConnected(clientId, voiceMode, patchSessionId);

  socket.on("message", (data, isBinary) => {
    if (!isBinary) {
      return;
    }

    const input = normalizeBinary(data);
    bytesIn += input.byteLength;
    framesIn += 1;
    broadcastToMonitors(input);
    sttManager.appendPcm(input);
  });

  const stats = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      console.log(`[client ${clientId}] ${framesIn} frames, ${bytesIn} bytes in`);
    }
  }, 5_000);

  socket.on("close", (code, reason) => {
    sttManager.flushPending();
    sttManager.stop();
    if (voiceMode === "patch") void handlePatchClientClosed(clientId, patchSessionId);
    clearInterval(stats);
    console.log(`[client ${clientId}] closed ${code} ${reason.toString()}`);
  });

  socket.on("error", (error) => {
    console.warn(`[client ${clientId}] error`, error);
  });
});

controlWss.on("connection", (socket, request) => {
  const clientId = nextControlClientId++;
  const remote = `${request.socket.remoteAddress ?? "unknown"}:${request.socket.remotePort ?? ""}`;
  console.log(`[control ${clientId}] connected from ${remote}`);
  controlClients.set(clientId, socket);
  sendApprovalSettings(socket);
  void refreshApprovalSettings("control-connect", true).catch((error) => {
    console.warn("[approval-settings] refresh on control connect failed", error);
  });

  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    handleControlMessage(clientId, data.toString("utf8"));
  });

  socket.on("close", (code, reason) => {
    controlClients.delete(clientId);
    if (latestAndroidStatus?.controlClientId === clientId) {
      latestAndroidStatus = {
        type: "android_status",
        mode: "off",
        status: "Disconnected",
        receivedAt: new Date().toISOString(),
        controlClientId: clientId,
      };
      broadcastMonitorJson(latestAndroidStatus);
    }
    console.log(`[control ${clientId}] closed ${code} ${reason.toString()}`);
  });

  socket.on("error", (error) => {
    console.warn(`[control ${clientId}] error`, error);
  });
});

function handleControlMessage(clientId: number, text: string): void {
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (parsed?.type !== "android_status") return;
  const message: AndroidStatusMessage = {
    type: "android_status",
    mode: String(parsed.mode ?? "").trim() || "unknown",
    status: String(parsed.status ?? "").trim() || "Unknown",
    microphone: String(parsed.microphone ?? "").trim() || undefined,
    approvalStatus: String(parsed.approvalStatus ?? "").trim() || undefined,
    reportedAt: String(parsed.reportedAt ?? "").trim() || undefined,
    receivedAt: new Date().toISOString(),
    controlClientId: clientId,
  };
  latestAndroidStatus = message;
  broadcastMonitorJson(message);
}

async function refreshApprovalSettings(reason: string, forceBroadcast = false): Promise<void> {
  if (!hubClientConfig) {
    if (forceBroadcast) broadcastApprovalSettings();
    return;
  }
  const data = await getVoiceApprovalSettings(hubClientConfig);
  const settings = parseVoiceApprovalSettings(data?.voiceApproval);
  if (!settings) throw new Error("Hub returned invalid voice approval settings");
  const activationSettings = parseVoiceActivationSettings(data?.voiceActivation) ?? defaultActivationSettings;
  const fingerprint = JSON.stringify(settings);
  const activationFingerprint = JSON.stringify(activationSettings);
  const changed = fingerprint !== currentApprovalSettingsFingerprint || activationFingerprint !== currentActivationSettingsFingerprint;
  currentApprovalSettings = settings;
  currentApprovalSettingsFingerprint = fingerprint;
  currentActivationSettings = activationSettings;
  currentActivationSettingsFingerprint = activationFingerprint;
  if (changed || forceBroadcast) {
    console.log(`[approval-settings] ${changed ? "updated" : "sent"} reason=${reason}`);
    broadcastApprovalSettings();
  }
}

function parseVoiceApprovalSettings(raw: any): VoiceApprovalSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const triggerPhrase = String(raw.triggerPhrase ?? "").trim().replace(/\s+/g, " ");
  const unlockCode = String(raw.unlockCode ?? "").replace(/\D/g, "");
  const lockCode = String(raw.lockCode ?? "").replace(/\D/g, "");
  const lockedOffCode = String(raw.lockedOffCode ?? "").replace(/\D/g, "");
  const minDigits = clampInteger(raw.minDigits, 1, 8);
  const maxDigits = clampInteger(raw.maxDigits, 1, 12);
  const stableMs = clampInteger(raw.stableMs, 250, 3_000);
  const collectTimeoutMs = clampInteger(raw.collectTimeoutMs, 1_000, 15_000);
  const duplicateCooldownMs = clampInteger(raw.duplicateCooldownMs, 0, 15_000);
  const finalizeCheckIntervalMs = clampInteger(raw.finalizeCheckIntervalMs, 100, 1_000);
  if (!triggerPhrase || !unlockCode || !lockCode || !lockedOffCode) return null;
  if ([minDigits, maxDigits, stableMs, collectTimeoutMs, duplicateCooldownMs, finalizeCheckIntervalMs].some((value) => value == null)) return null;
  if (maxDigits! < minDigits!) return null;
  return {
    triggerPhrase,
    unlockCode,
    lockCode,
    lockedOffCode,
    minDigits: minDigits!,
    maxDigits: maxDigits!,
    stableMs: stableMs!,
    collectTimeoutMs: collectTimeoutMs!,
    duplicateCooldownMs: duplicateCooldownMs!,
    finalizeCheckIntervalMs: finalizeCheckIntervalMs!,
  };
}

function parseVoiceActivationSettings(raw: any): VoiceActivationSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const normalAliases = parseActivationAliases(raw.normalAliases, defaultActivationSettings.normalAliases);
  const realTimeAliases = parseActivationAliases(raw.realTimeAliases, defaultActivationSettings.realTimeAliases);
  if (normalAliases.length === 0 || realTimeAliases.length === 0) return null;
  return { normalAliases, realTimeAliases };
}

function parseActivationAliases(raw: any, fallback: string[]): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const alias = String(value ?? "").trim().replace(/\s+/g, " ");
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= 12) break;
  }
  return out.length > 0 ? out : fallback;
}

function clampInteger(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i < min || i > max ? null : i;
}

function broadcastApprovalSettings(): void {
  for (const socket of controlClients.values()) {
    sendApprovalSettings(socket);
  }
}

function sendApprovalSettings(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "approval_settings", settings: currentApprovalSettings, activation: currentActivationSettings }));
}

function sendAudioCommand(socket: WebSocket, clientId: number, command: TranscriptCommand): void {
  const payload = JSON.stringify(command);
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn(`[command] skipped ${command.type} for closed client ${clientId}`);
    return;
  }
  try {
    socket.send(payload);
    console.log(`[command] sent ${command.type} to client ${clientId}`);
  } catch (error) {
    console.warn(`[command] failed to send ${command.type} to client ${clientId}`, error);
  }
}

function parseVoiceMode(raw: string | null): VoiceMode {
  if (raw === "patch" || raw === "clipboard" || raw === "realtime") return raw;
  return "assistant";
}

async function handleVoiceClientConnected(clientId: number, voiceMode: VoiceMode, patchSessionId: string | null): Promise<void> {
  if (voiceMode === "clipboard") {
    console.log(`[hub] voice client ${clientId} recording Android clipboard transcription`);
    return;
  }
  if (!hubClientConfig) {
    console.warn(`[hub] skipped voice thread connect for client ${clientId}: missing DRONE_HUB_API_URL or DRONE_HUB_API_TOKEN`);
    return;
  }
  if (voiceMode === "patch") {
    try {
      const result = await beginVoicePatch(hubClientConfig, "android", patchSessionId);
      console.log(`[hub] voice client ${clientId} patching ${result.droneId ?? "unknown"}/${result.chatName ?? "default"} session=${patchSessionId ?? "none"}`);
    } catch (error) {
      console.warn(`[hub] voice patch begin failed for client ${clientId}`, error);
    }
    return;
  }
  try {
    const result = await connectVoiceThread(hubClientConfig);
    console.log(`[hub] voice client ${clientId} using assistant thread ${result.threadId}${result.created ? " (created)" : ""}`);
  } catch (error) {
    console.warn(`[hub] voice thread connect failed for client ${clientId}`, error);
  }
}

async function handleTranscriptCommand(clientId: number, voiceMode: VoiceMode, command: TranscriptCommand, patchSessionId: string | null): Promise<void> {
  if (command.type === "abort") {
    if (voiceMode === "patch") await handlePatchAbort(clientId, patchSessionId);
    else if (voiceMode === "realtime") console.log(`[hub] ignored real-time abort command for client ${clientId}`);
    else if (voiceMode === "clipboard") console.log(`[hub] Android clipboard transcription aborted for client ${clientId}`);
    else console.log(`[hub] voice transcript aborted for client ${clientId}`);
    return;
  }
  if (voiceMode === "realtime") {
    console.log(`[hub] real-time voice session ended by ${command.phrase || "sleep"} for client ${clientId}`);
    return;
  }
  const prompt = String(command.transcriptText ?? "").trim();
  if (!prompt) {
    console.warn(`[hub] skipped empty voice transcript for client ${clientId}`);
    if (voiceMode === "patch") await handlePatchAbort(clientId, patchSessionId);
    return;
  }
  if (voiceMode === "clipboard") {
    console.log(`[hub] Android clipboard transcription completed chars=${prompt.length} client=${clientId}`);
    return;
  }
  if (!hubClientConfig) {
    console.warn(`[hub] skipped voice transcript for client ${clientId}: missing DRONE_HUB_API_URL or DRONE_HUB_API_TOKEN`);
    return;
  }
  if (voiceMode === "patch") {
    try {
      const result = await submitVoicePatchMessage(hubClientConfig, prompt, "android", patchSessionId);
      console.log(`[hub] submitted voice patch chars=${prompt.length} target=${result.droneId ?? "unknown"}/${result.chatName ?? "default"} session=${patchSessionId ?? "none"}`);
    } catch (error) {
      console.warn(`[hub] voice patch submit failed for client ${clientId}`, error);
      await handlePatchAbort(clientId, patchSessionId);
    }
    return;
  }
  try {
    const result = await submitVoiceMessage(hubClientConfig, prompt);
    console.log(`[hub] submitted voice transcript chars=${prompt.length} thread=${result.threadId}`);
  } catch (error) {
    console.warn(`[hub] voice transcript submit failed for client ${clientId}`, error);
  }
}

async function submitRealtimeVoiceSegment(clientId: number, prompt: string): Promise<void> {
  const text = String(prompt ?? "").trim();
  if (!text) return;
  if (!hubClientConfig) {
    console.warn(`[hub] skipped real-time voice segment for client ${clientId}: missing DRONE_HUB_API_URL or DRONE_HUB_API_TOKEN`);
    return;
  }
  try {
    const result = await submitVoiceMessage(hubClientConfig, text, "Voice thread", "asap");
    console.log(`[hub] submitted real-time voice segment chars=${text.length} thread=${result.threadId}`);
  } catch (error) {
    console.warn(`[hub] real-time voice segment submit failed for client ${clientId}`, error);
  }
}

async function handlePatchAbort(clientId: number, patchSessionId: string | null): Promise<void> {
  if (!hubClientConfig) return;
  try {
    await endVoicePatch(hubClientConfig, "android", patchSessionId, "aborted");
    console.log(`[hub] voice patch aborted for client ${clientId} session=${patchSessionId ?? "none"}`);
  } catch (error) {
    console.warn(`[hub] voice patch abort failed for client ${clientId}`, error);
  }
}

async function handlePatchClientClosed(clientId: number, patchSessionId: string | null): Promise<void> {
  if (!hubClientConfig) return;
  try {
    await endVoicePatch(hubClientConfig, "android", patchSessionId, "closed");
  } catch (error) {
    console.warn(`[hub] voice patch close cleanup failed for client ${clientId}`, error);
  }
}

function initialTranscriptStatus(): TranscriptStatus {
  if (!transcriptionConfig.apiKey) {
    return {
      type: "transcript_status",
      configured: false,
      status: "disabled",
      message: "Transcription disabled: set GROQ_API_KEY on the server.",
    };
  }

  return {
    type: "transcript_status",
    configured: true,
    status: "ready",
    message: "Transcription ready.",
    model: transcriptionConfig.model,
  };
}

function broadcastTranscriptMessage(message: TranscriptMessage): void {
  if (message.type === "transcript_status") {
    latestTranscriptStatus = message;
  }
  broadcastMonitorJson(message);
}

monitorWss.on("connection", (socket, request) => {
  const monitorId = nextMonitorId++;
  const remote = `${request.socket.remoteAddress ?? "unknown"}:${request.socket.remotePort ?? ""}`;
  console.log(`[monitor ${monitorId}] connected from ${remote}`);
  sendMonitorJson(socket, latestTranscriptStatus);
  if (latestAndroidStatus) sendMonitorJson(socket, latestAndroidStatus);

  socket.on("close", (code, reason) => {
    console.log(`[monitor ${monitorId}] closed ${code} ${reason.toString()}`);
  });

  socket.on("error", (error) => {
    console.warn(`[monitor ${monitorId}] error`, error);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Voice stream server listening on ws://0.0.0.0:${port}/audio`);
  console.log(`Android control channel listening on ws://0.0.0.0:${port}/control`);
  console.log(`Browser monitor listening on ws://0.0.0.0:${port}/monitor`);
  console.log(`APK download page listening on http://0.0.0.0:${port}/`);
  console.log(`Groq STT: ${transcriptionConfig.apiKey ? `enabled (${transcriptionConfig.model})` : "disabled (missing GROQ_API_KEY)"}`);
  console.log(`Groq TTS: ${ttsConfig.apiKey ? `enabled (${ttsConfig.model}, voice ${ttsConfig.voice})` : "disabled (missing GROQ_API_KEY or GROQ_TTS_API_KEY)"}`);
  console.log(`Hub voice mode: ${hubClientConfig ? `enabled (${hubClientConfig.apiUrl})` : "disabled (missing DRONE_HUB_API_URL or DRONE_HUB_API_TOKEN)"}`);
  console.log("Audio auth: /audio requires pairing token");
  console.log(`Android log upload: http://0.0.0.0:${port}/logs/android`);
  console.log(`Android log path: ${androidLogPath}`);
  console.log(`Android APK version: ${formatAndroidVersion(androidMinVersion)} (${androidMinVersion.source})`);
  console.log(`Pairing page: ${pairingAdminPassword ? "enabled (/pair)" : "disabled (missing DRONE_PAIR_PASSWORD)"}`);
  console.log(`APK path: ${apkPath}`);
  console.log("Audio format: 16 kHz mono signed 16-bit little-endian PCM");
  void refreshApprovalSettings("startup", false).catch((error) => {
    console.warn("[approval-settings] startup refresh failed", error);
  });
});

async function serveDownloadPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apk = getApkInfo();
  const transcription = latestTranscriptStatus;
  const audioUrl = getWebSocketUrl(req);
  const androidVersionLabel = formatAndroidVersion(androidMinVersion);
  const updatePayload = buildUpdatePayload(req);
  const updateQrDataUrl = await QRCode.toDataURL(updatePayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
  const status = apk.exists
    ? `APK ready: ${formatBytes(apk.size)} built ${apk.modified}`
    : `APK not found at ${apk.path}`;

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drone APK</title>
  <style>
    :root { color-scheme: light; --ink: #172033; --muted: #5b6578; --line: #d8dee9; --panel: #f7f9fc; --accent: #1264a3; --ok: #166534; --bad: #991b1b; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 780px; margin: 44px auto; padding: 0 20px; line-height: 1.5; color: var(--ink); background: #fff; }
    h1 { margin: 0 0 18px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 18px; letter-spacing: 0; }
    a.button, button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; background: var(--accent); color: white; text-decoration: none; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
    button.secondary { background: #334155; }
    label { display: inline-flex; align-items: center; gap: 10px; color: var(--muted); }
    label strong { display: inline-block; min-width: 52px; color: var(--ink); text-align: right; }
    input[type="range"] { width: min(280px, 100%); accent-color: var(--accent); }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; overflow-wrap: anywhere; }
    .status { margin: 16px 0 22px; color: ${apk.exists ? "var(--ok)" : "var(--bad)"}; }
    .panel { border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin: 24px 0; background: var(--panel); }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
    .metric { border: 1px solid var(--line); border-radius: 6px; padding: 10px; background: white; }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; margin-top: 2px; font-size: 18px; }
    .transcript { min-height: 130px; max-height: 280px; overflow: auto; white-space: pre-wrap; border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: white; }
    .qr-row { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; }
    .qr { width: 220px; height: 220px; border: 1px solid var(--line); border-radius: 6px; background: white; }
    .muted { color: var(--muted); }
    @media (max-width: 560px) { body { margin-top: 28px; } .metrics { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Drone APK</h1>
  <p class="status">${escapeHtml(status)}</p>
  <p>Current APK version: <code>${escapeHtml(androidVersionLabel)}</code></p>
  <p><a class="button" href="/download/app-debug.apk">Download debug APK</a></p>
  <p>Android app WebSocket URL for this server: <code>${escapeHtml(audioUrl)}</code></p>
  <section class="panel" aria-labelledby="update-title">
    <h2 id="update-title">Update Android app</h2>
    <div class="qr-row">
      <img class="qr" alt="Drone APK update QR code" src="${updateQrDataUrl}">
      <div>
        <p>Scan this in the Android app to check the installed build against <code>${escapeHtml(androidVersionLabel)}</code>.</p>
        <p class="muted">If the phone has an older build, it opens the APK download. If it is current, it shows an up-to-date message.</p>
      </div>
    </div>
  </section>
  <section class="panel" aria-labelledby="pairing-title">
    <h2 id="pairing-title">Pair Android app</h2>
    <p>Pairing is password-protected. Open the pairing page to unlock the QR code when you are ready to scan it.</p>
    <p><a class="button" href="/pair">Open pairing page</a></p>
  </section>
  <section class="panel" aria-labelledby="monitor-title">
    <h2 id="monitor-title">Live microphone monitor</h2>
    <p>Connect this browser to <code>${escapeHtml(getMonitorWebSocketUrl(req))}</code>, then start the Android session and speak.</p>
    <div class="row">
      <button id="monitor-start" type="button">Start Monitor</button>
      <button id="monitor-stop" class="secondary" type="button" disabled>Stop</button>
    </div>
    <div class="row" style="margin-top: 14px;">
      <label for="monitor-volume">Volume <strong id="monitor-volume-label">4x</strong></label>
      <input id="monitor-volume" type="range" min="0" max="20" step="0.25" value="4">
    </div>
    <div class="metrics" aria-live="polite">
      <div class="metric"><span>Status</span><strong id="monitor-status">Idle</strong></div>
      <div class="metric"><span>Chunks</span><strong id="monitor-chunks">0</strong></div>
      <div class="metric"><span>Bytes</span><strong id="monitor-bytes">0</strong></div>
    </div>
  </section>
  <section class="panel" aria-labelledby="transcript-title">
    <h2 id="transcript-title">Live transcript</h2>
    <p id="transcript-status" class="muted">${escapeHtml(transcription.message)}</p>
    <div id="transcript-text" class="transcript" aria-live="polite"></div>
    <div class="row" style="margin-top: 12px;">
      <button id="transcript-clear" class="secondary" type="button">Clear Transcript</button>
    </div>
  </section>
  <section class="panel" aria-labelledby="approval-title">
    <h2 id="approval-title">Approval codes</h2>
    <p class="muted">Codes detected locally by the Android app after saying <code>approval code</code>.</p>
    <div id="approval-list" class="transcript" aria-live="polite">${renderApprovalCodes()}</div>
    <div class="row" style="margin-top: 12px;">
      <button id="approval-clear" class="secondary" type="button">Clear Display</button>
    </div>
  </section>
  <p>Server expects the APK at <code>${escapeHtml(apk.path)}</code>. Override with <code>APK_PATH=/absolute/path/app-debug.apk</code>.</p>
  <script>
    (function () {
      var sampleRate = ${sampleRateHz};
      var socket = null;
      var audioContext = null;
      var gainNode = null;
      var limiterNode = null;
      var nextPlayTime = 0;
      var chunks = 0;
      var bytes = 0;

      var startButton = document.getElementById("monitor-start");
      var stopButton = document.getElementById("monitor-stop");
      var statusEl = document.getElementById("monitor-status");
      var chunksEl = document.getElementById("monitor-chunks");
      var bytesEl = document.getElementById("monitor-bytes");
      var volumeEl = document.getElementById("monitor-volume");
      var volumeLabelEl = document.getElementById("monitor-volume-label");
      var transcriptStatusEl = document.getElementById("transcript-status");
      var transcriptTextEl = document.getElementById("transcript-text");
      var transcriptClearEl = document.getElementById("transcript-clear");
      var approvalListEl = document.getElementById("approval-list");
      var approvalClearEl = document.getElementById("approval-clear");

      function monitorUrl() {
        var protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
        return protocol + window.location.host + "/monitor";
      }

      function setStatus(value) {
        statusEl.textContent = value;
      }

      function setControls(running) {
        startButton.disabled = running;
        stopButton.disabled = !running;
      }

      function resetCounters() {
        chunks = 0;
        bytes = 0;
        chunksEl.textContent = "0";
        bytesEl.textContent = "0";
      }

      async function startMonitor() {
        if (socket && socket.readyState === WebSocket.OPEN) {
          return;
        }

        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        if (!gainNode) {
          gainNode = audioContext.createGain();
          limiterNode = audioContext.createDynamicsCompressor();
          limiterNode.threshold.value = -6;
          limiterNode.knee.value = 8;
          limiterNode.ratio.value = 12;
          limiterNode.attack.value = 0.003;
          limiterNode.release.value = 0.08;
          gainNode.connect(limiterNode);
          limiterNode.connect(audioContext.destination);
        }
        applyVolume(Number(volumeEl.value), true);
        await audioContext.resume();
        nextPlayTime = audioContext.currentTime + 0.06;
        resetCounters();
        setStatus("Connecting");
        setControls(true);

        socket = new WebSocket(monitorUrl());
        socket.binaryType = "arraybuffer";

        socket.onopen = function () {
          setStatus("Connected");
        };

        socket.onmessage = function (event) {
          if (typeof event.data === "string") {
            handleMonitorJson(event.data);
            return;
          }
          if (!(event.data instanceof ArrayBuffer)) {
            return;
          }
          chunks += 1;
          bytes += event.data.byteLength;
          chunksEl.textContent = String(chunks);
          bytesEl.textContent = String(bytes);
          playPcm(event.data);
        };

        socket.onclose = function () {
          setStatus("Closed");
          setControls(false);
          socket = null;
        };

        socket.onerror = function () {
          setStatus("Error");
        };
      }

      function stopMonitor() {
        if (socket) {
          socket.close(1000, "monitor stopped");
        }
        setControls(false);
        setStatus("Stopped");
      }

      function playPcm(arrayBuffer) {
        if (!audioContext) {
          return;
        }

        var sampleCount = Math.floor(arrayBuffer.byteLength / 2);
        if (sampleCount <= 0) {
          return;
        }

        var view = new DataView(arrayBuffer);
        var audioBuffer = audioContext.createBuffer(1, sampleCount, sampleRate);
        var channel = audioBuffer.getChannelData(0);

        for (var i = 0; i < sampleCount; i += 1) {
          var sample = view.getInt16(i * 2, true);
          channel[i] = sample < 0 ? sample / 32768 : sample / 32767;
        }

        if (nextPlayTime < audioContext.currentTime || nextPlayTime - audioContext.currentTime > 0.45) {
          nextPlayTime = audioContext.currentTime + 0.04;
        }

        var source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode || audioContext.destination);
        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
      }

      function handleMonitorJson(raw) {
        var message;
        try {
          message = JSON.parse(raw);
        } catch (_error) {
          return;
        }

        if (message.type === "transcript_status") {
          transcriptStatusEl.textContent = message.message || "Transcription status updated.";
          return;
        }

        if (message.type === "transcript_segment" && message.text) {
          var prefix = transcriptTextEl.textContent.trim().length > 0 ? "\\n" : "";
          transcriptTextEl.textContent += prefix + message.text;
          transcriptTextEl.scrollTop = transcriptTextEl.scrollHeight;
          return;
        }

        if (message.type === "approval_code" && message.code) {
          appendApprovalCode(message);
        }
      }

      function appendApprovalCode(message) {
        var receivedAt = message.receivedAt ? new Date(message.receivedAt) : new Date();
        var time = Number.isNaN(receivedAt.getTime()) ? "" : receivedAt.toLocaleTimeString();
        var line = "[" + time + "] " + message.code;
        var prefix = approvalListEl.textContent.trim().length > 0 ? "\\n" : "";
        approvalListEl.textContent += prefix + line;
        approvalListEl.scrollTop = approvalListEl.scrollHeight;
      }

      function updateVolumeLabel() {
        var value = clampVolume(Number(volumeEl.value));
        volumeLabelEl.textContent = value.toFixed(value % 1 === 0 ? 0 : 2) + "x";
        applyVolume(value, false);
      }

      function clampVolume(value) {
        if (!Number.isFinite(value)) {
          return 4;
        }
        return Math.min(20, Math.max(0, value));
      }

      function applyVolume(value, immediate) {
        if (!gainNode || !audioContext) {
          return;
        }

        var safeValue = clampVolume(value);
        var now = audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        if (immediate) {
          gainNode.gain.setValueAtTime(safeValue, now);
          return;
        }
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(safeValue, now + 0.025);
      }

      startButton.addEventListener("click", function () {
        startMonitor().catch(function (error) {
          setStatus(error && error.message ? error.message : "Start failed");
          setControls(false);
        });
      });
      stopButton.addEventListener("click", stopMonitor);
      volumeEl.addEventListener("input", updateVolumeLabel);
      transcriptClearEl.addEventListener("click", function () {
        transcriptTextEl.textContent = "";
      });
      approvalClearEl.addEventListener("click", function () {
        approvalListEl.textContent = "";
      });
      updateVolumeLabel();
    }());
  </script>
</body>
</html>`);
}

async function servePairingPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!pairingAdminPassword) {
    renderPairingNotConfiguredPage(res);
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.writeHead(405, {
      "allow": "GET, POST",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed\n");
    return;
  }

  if (req.method === "POST") {
    const body = await readRequestBody(req, 16_384);
    const form = new URLSearchParams(body);
    const password = form.get("password") ?? "";
    if (constantTimeEqual(password, pairingAdminPassword)) {
      const session = randomBytes(32).toString("base64url");
      pairingAdminSessions.add(session);
      res.writeHead(303, {
        "location": "/pair",
        "set-cookie": buildPairingCookie(req, session),
      });
      res.end();
      return;
    }

    renderPairPasswordPage(res, "Wrong password.");
    return;
  }

  if (!isPairingAdmin(req)) {
    renderPairPasswordPage(res);
    return;
  }

  await renderPairQrPage(req, res);
}

function renderPairingNotConfiguredPage(res: ServerResponse): void {
  res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drone Pairing Disabled</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 560px; margin: 44px auto; padding: 0 20px; line-height: 1.5; color: #172033; }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Pairing Disabled</h1>
  <p>Set <code>DRONE_PAIR_PASSWORD</code> on the server and restart it to enable the pairing QR page.</p>
  <p><a href="/">Back to download page</a></p>
</body>
</html>`);
}

function renderPairPasswordPage(res: ServerResponse, error?: string): void {
  res.writeHead(error ? 401 : 200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drone Pairing</title>
  <style>
    :root { color-scheme: light; --ink: #172033; --muted: #5b6578; --line: #d8dee9; --panel: #f7f9fc; --accent: #1264a3; --bad: #991b1b; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 520px; margin: 44px auto; padding: 0 20px; line-height: 1.5; color: var(--ink); background: #fff; }
    h1 { margin: 0 0 18px; font-size: 30px; letter-spacing: 0; }
    form { border: 1px solid var(--line); border-radius: 8px; padding: 18px; background: var(--panel); }
    label { display: block; margin-bottom: 8px; color: var(--muted); }
    input { width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
    button, a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 14px; padding: 0 16px; background: var(--accent); color: white; text-decoration: none; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
    button.secondary { background: #334155; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .error { color: var(--bad); }
    .muted { color: var(--muted); }
  </style>
</head>
<body>
  <h1>Drone Pairing</h1>
  <p class="muted">Enter the server pairing password to show the QR code. The public download page does not expose the pairing token.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="/pair">
    <label for="password">Pairing password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
    <div class="row">
      <button type="submit">Unlock Pairing QR</button>
      <button id="clear-saved-password" class="secondary" type="button">Clear Saved Password</button>
    </div>
  </form>
  <p><a href="/">Back to download page</a></p>
  <script>
    (function () {
      var key = "dronePairPassword";
      var pendingKey = "dronePairPasswordPending";
      var password = document.getElementById("password");
      var clearButton = document.getElementById("clear-saved-password");
      var form = document.querySelector("form");
      var hadError = ${error ? "true" : "false"};

      if (hadError) {
        sessionStorage.removeItem(pendingKey);
      }

      var saved = localStorage.getItem(key);
      if (saved && !password.value) {
        password.value = saved;
      }

      form.addEventListener("submit", function () {
        if (password.value) {
          sessionStorage.setItem(pendingKey, password.value);
        }
      });

      clearButton.addEventListener("click", function () {
        localStorage.removeItem(key);
        sessionStorage.removeItem(pendingKey);
        password.value = "";
        password.focus();
      });
    }());
  </script>
</body>
</html>`);
}

async function renderPairQrPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const authorizedAudioUrl = getWebSocketUrl(req, true);
  const pairingPayload = buildPairingPayload(req, authorizedAudioUrl);
  const qrDataUrl = await QRCode.toDataURL(pairingPayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });

  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drone Pairing QR</title>
  <style>
    :root { color-scheme: light; --ink: #172033; --muted: #5b6578; --line: #d8dee9; --panel: #f7f9fc; --accent: #1264a3; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 560px; margin: 44px auto; padding: 0 20px; line-height: 1.5; color: var(--ink); background: #fff; }
    h1 { margin: 0 0 18px; font-size: 30px; letter-spacing: 0; }
    .panel { border: 1px solid var(--line); border-radius: 8px; padding: 18px; background: var(--panel); }
    .qr { width: 256px; height: 256px; border: 1px solid var(--line); border-radius: 6px; background: white; }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; overflow-wrap: anywhere; }
    .muted { color: var(--muted); }
    a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 14px; padding: 0 16px; background: var(--accent); color: white; text-decoration: none; border-radius: 6px; }
    button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 14px; padding: 0 16px; background: #334155; color: white; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Drone Pairing QR</h1>
  <section class="panel">
    <p class="muted">Scan this QR code in the Android app to save the authenticated server URL.</p>
    <img class="qr" alt="Drone pairing QR code" src="${qrDataUrl}">
    <p>Android app WebSocket URL: <code>${escapeHtml(getWebSocketUrl(req))}</code></p>
    <p>Minimum app build: <code>${escapeHtml(formatAndroidVersion(androidMinVersion))}</code></p>
  </section>
  <p><a class="button" href="/">Back to download page</a></p>
  <p><button id="clear-saved-password" type="button">Clear Saved Pairing Password</button></p>
  <p id="saved-password-status" class="muted"></p>
  <script>
    (function () {
      var key = "dronePairPassword";
      var pendingKey = "dronePairPasswordPending";
      var pending = sessionStorage.getItem(pendingKey);
      var status = document.getElementById("saved-password-status");
      if (pending) {
        localStorage.setItem(key, pending);
        sessionStorage.removeItem(pendingKey);
        status.textContent = "Pairing password saved in this browser.";
      }
      document.getElementById("clear-saved-password").addEventListener("click", function () {
        localStorage.removeItem(key);
        sessionStorage.removeItem(pendingKey);
        status.textContent = "Saved pairing password cleared.";
      });
    }());
  </script>
</body>
</html>`);
}

function serveApk(method: string, res: ServerResponse): void {
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, {
      "allow": "GET, HEAD",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed\n");
    return;
  }

  const apk = getApkInfo();
  if (!apk.exists) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`APK not found at ${apk.path}\n`);
    return;
  }

  res.writeHead(200, {
    "content-type": "application/vnd.android.package-archive",
    "content-disposition": 'attachment; filename="app-debug.apk"',
    "content-length": apk.size,
    "cache-control": "no-store",
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(apk.path).pipe(res);
}

async function serveAndroidLogUpload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "allow": "POST",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed\n");
    return;
  }

  if (!isAuthorizedToken(getRequestToken(req, url))) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unauthorized\n");
    console.warn("[android-log] rejected unauthorized upload");
    return;
  }

  const body = await readRequestBody(req, 1_048_576);
  if (body.trim().length === 0) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Log body is empty\n");
    return;
  }

  saveAndroidLog(body, req);
  res.writeHead(204);
  res.end();
}

function saveAndroidLog(body: string, req: IncomingMessage): void {
  mkdirSync(dirname(androidLogPath), { recursive: true });
  rotateAndroidLogIfNeeded();
  const reason = req.headers["x-drone-log-reason"]?.toString() ?? "unspecified";
  const remote = `${req.socket.remoteAddress ?? "unknown"}:${req.socket.remotePort ?? ""}`;
  const header = [
    "",
    `===== ${new Date().toISOString()} reason=${reason} remote=${remote} bytes=${Buffer.byteLength(body)} =====`,
  ].join("\n");
  appendFileSync(androidLogPath, `${header}\n${body.trimEnd()}\n`, { mode: 0o600 });
  console.log(`[android-log] saved ${Buffer.byteLength(body)} bytes reason=${reason}`);
}

async function serveApprovalSettingsReload(req: IncomingMessage, res: ServerResponse, _url: URL): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "allow": "POST",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed\n");
    return;
  }

  if (!isAuthorizedHubRequest(req)) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unauthorized\n");
    console.warn("[approval-settings] rejected unauthorized reload");
    return;
  }

  try {
    await refreshApprovalSettings("hub-reload", true);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, settings: currentApprovalSettings }));
  } catch (error: any) {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
  }
}

async function serveApprovalCode(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "allow": "POST",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed\n");
    return;
  }

  if (!isAuthorizedToken(getRequestToken(req, url))) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unauthorized\n");
    console.warn("[approval] rejected unauthorized code upload");
    return;
  }

  const body = await readRequestBody(req, 16_384);
  const parsed = parseApprovalCodeBody(body);
  if (!parsed) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Expected JSON body with a 4-8 digit code\n");
    return;
  }

  const message: ApprovalCodeMessage = {
    type: "approval_code",
    code: parsed.code,
    source: parsed.source,
    receivedAt: new Date().toISOString(),
    detectedAt: parsed.detectedAt,
  };
  approvalCodes.push(message);
  if (approvalCodes.length > 50) {
    approvalCodes.splice(0, approvalCodes.length - 50);
  }
  broadcastMonitorJson(message);
  console.log(`[approval] received code length=${message.code.length} source=${message.source}`);

  if (!ttsConfig.apiKey) {
    res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, tts: false }));
    return;
  }

  try {
    const wav = await synthesizeApprovalCodeWav(parsed.code, ttsConfig);
    res.writeHead(200, {
      "content-type": "audio/wav",
      "content-length": wav.byteLength,
      "cache-control": "no-store",
    });
    res.end(wav);
    console.log(`[approval] returned tts bytes=${wav.byteLength}`);
  } catch (error) {
    console.warn("[approval] tts failed", error);
    res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, tts: false }));
  }
}

async function serveSpeak(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "allow": "POST",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed\n");
    return;
  }

  if (!isAuthorizedHubRequest(req)) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unauthorized\n");
    console.warn("[speak] rejected unauthorized request");
    return;
  }

  const body = await readRequestBody(req, 32_768);
  const payload = safeJsonParse(body);
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Expected JSON body with text\n");
    return;
  }

  const clients = [...controlClients.entries()].filter(([, socket]) => socket.readyState === WebSocket.OPEN);
  if (clients.length === 0) {
    res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "No Android control client is connected." }));
    return;
  }

  try {
    const wav = await synthesizeTextWav(text.slice(0, 4_000), ttsConfig);
    for (const [, socket] of clients) {
      socket.send(wav, { binary: true });
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, clients: clients.length, bytes: wav.byteLength }));
    console.log(`[speak] sent tts chars=${text.length} bytes=${wav.byteLength} clients=${clients.length}`);
  } catch (error) {
    console.warn("[speak] tts failed", error);
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

function parseApprovalCodeBody(body: string): { code: string; source: string; detectedAt?: string } | null {
  const payload = safeJsonParse(body);
  if (!payload) {
    return null;
  }
  const code = String(payload.code ?? "").replace(/\D/g, "");
  if (code.length < 4 || code.length > 8) {
    return null;
  }
  const source = typeof payload.source === "string" && payload.source.trim()
    ? payload.source.trim().slice(0, 40)
    : "unknown";
  const detectedAt = typeof payload.detectedAt === "string" && payload.detectedAt.trim()
    ? payload.detectedAt.trim().slice(0, 80)
    : undefined;
  return { code, source, detectedAt };
}

function safeJsonParse(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as { code?: unknown; source?: unknown; detectedAt?: unknown };
  } catch {
    return null;
  }
}

function renderApprovalCodes(): string {
  return approvalCodes
    .map((approval) => {
      const date = new Date(approval.receivedAt);
      const time = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-US", { hour12: false });
      return escapeHtml(`[${time}] ${approval.code}`);
    })
    .join("\n");
}

function rotateAndroidLogIfNeeded(): void {
  if (!existsSync(androidLogPath)) return;
  const stat = statSync(androidLogPath);
  if (stat.size <= 5 * 1024 * 1024) return;
  writeFileSync(androidLogPath, "", { mode: 0o600 });
}

function getApkInfo(): { exists: true; path: string; size: number; modified: string } | { exists: false; path: string } {
  if (!existsSync(apkPath)) {
    return { exists: false, path: apkPath };
  }

  const stat = statSync(apkPath);
  if (!stat.isFile()) {
    return { exists: false, path: apkPath };
  }

  return {
    exists: true,
    path: apkPath,
    size: stat.size,
    modified: stat.mtime.toISOString(),
  };
}

function getWebSocketUrl(req: IncomingMessage, includeToken = false): string {
  const url = new URL(`${getWebSocketBaseUrl(req)}/audio`);
  if (includeToken) {
    url.searchParams.set("token", pairingToken);
  }
  return url.toString();
}

function getMonitorWebSocketUrl(req: IncomingMessage): string {
  return `${getWebSocketBaseUrl(req)}/monitor`;
}

function getApkDownloadUrl(req: IncomingMessage): string {
  return `${getHttpBaseUrl(req)}/download/app-debug.apk`;
}

function getHttpBaseUrl(req: IncomingMessage): string {
  const host = req.headers["x-forwarded-host"]?.toString() ?? req.headers.host ?? `localhost:${port}`;
  const forwardedProto = req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

function getWebSocketBaseUrl(req: IncomingMessage): string {
  const host = req.headers["x-forwarded-host"]?.toString() ?? req.headers.host ?? `localhost:${port}`;
  const forwardedProto = req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim();
  const protocol = forwardedProto === "https" ? "wss" : "ws";
  return `${protocol}://${host}`;
}

function buildPairingPayload(req: IncomingMessage, authorizedAudioUrl: string): string {
  const payload = new URL("voicestream://pair");
  payload.searchParams.set("audio", authorizedAudioUrl);
  payload.searchParams.set("token", pairingToken);
  payload.searchParams.set("monitor", getMonitorWebSocketUrl(req));
  payload.searchParams.set("apk", getApkDownloadUrl(req));
  payload.searchParams.set("minVersionCode", String(androidMinVersion.versionCode));
  return payload.toString();
}

function buildUpdatePayload(req: IncomingMessage): string {
  const payload = new URL("voicestream://update");
  payload.searchParams.set("versionCode", String(androidMinVersion.versionCode));
  payload.searchParams.set("apk", getApkDownloadUrl(req));
  return payload.toString();
}

function isAuthorizedAudioRequest(url: URL): boolean {
  return isAuthorizedToken(url.searchParams.get("token") ?? "");
}

function isAuthorizedHubRequest(req: IncomingMessage): boolean {
  const expected = hubClientConfig?.apiToken ?? "";
  const authorization = req.headers.authorization?.toString() ?? "";
  const bearerPrefix = "Bearer ";
  const token = authorization.startsWith(bearerPrefix) ? authorization.slice(bearerPrefix.length).trim() : "";
  if (!expected || !token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function getRequestToken(req: IncomingMessage, url: URL): string {
  const authorization = req.headers.authorization?.toString() ?? "";
  const bearerPrefix = "Bearer ";
  if (authorization.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length).trim();
  }
  return url.searchParams.get("token") ?? "";
}

function isAuthorizedToken(token: string): boolean {
  if (!token || token.length !== pairingToken.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(token), Buffer.from(pairingToken));
}

function resolveAndroidVersionInfo(): AndroidVersionInfo {
  const envValue = process.env.DRONE_ANDROID_MIN_VERSION_CODE?.trim();
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== envValue) {
      throw new Error(`DRONE_ANDROID_MIN_VERSION_CODE must be a positive integer, got "${envValue}"`);
    }
    return { versionCode: parsed, source: "DRONE_ANDROID_MIN_VERSION_CODE" };
  }

  const apkVersion = readApkVersionInfo();
  if (apkVersion != null) {
    return { ...apkVersion, source: "APK metadata" };
  }

  if (existsSync(apkPath)) {
    throw new Error(`Could not read version metadata from served APK at ${apkPath}. Set AAPT_PATH or rebuild the APK.`);
  }

  return { versionCode: 1, source: "APK missing" };
}

function readApkVersionInfo(): Omit<AndroidVersionInfo, "source"> | null {
  if (!existsSync(apkPath)) return null;
  for (const candidate of aaptCandidates()) {
    if (!existsSync(candidate)) continue;
    const output = runAaptBadging(candidate);
    const codeMatch = output?.match(/versionCode='(\d+)'/);
    if (codeMatch?.[1]) {
      const parsed = Number.parseInt(codeMatch[1], 10);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        const versionName = output?.match(/versionName='([^']+)'/)?.[1]?.trim();
        return versionName ? { versionCode: parsed, versionName } : { versionCode: parsed };
      }
    }
  }
  return null;
}

function aaptCandidates(): string[] {
  const sdkRoots = [
    process.env.ANDROID_HOME?.trim() ?? "",
    process.env.ANDROID_SDK_ROOT?.trim() ?? "",
    resolve(homedir(), "Android/Sdk"),
  ].filter(Boolean);
  const sdkAaptCandidates = sdkRoots.flatMap((sdkRoot) => {
    const buildToolsDir = resolve(sdkRoot, "build-tools");
    if (!existsSync(buildToolsDir)) return [];
    return runCatchingArray(() => readdirSync(buildToolsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => resolve(buildToolsDir, version, "aapt")));
  });
  return uniqueStrings([
    process.env.AAPT_PATH?.trim() ?? "",
    ...sdkAaptCandidates,
    resolve(repoRoot, "tools/android-sdk/build-tools/35.0.0/aapt"),
    resolve(repoRoot, "tools/android-sdk/build-tools/34.0.0/aapt"),
  ].filter(Boolean));
}

function runAaptBadging(aaptPath: string): string | null {
  return runCatchingString(() => execFileSync(aaptPath, ["dump", "badging", apkPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }));
}

function formatAndroidVersion(info: AndroidVersionInfo): string {
  return info.versionName ? `${info.versionName} (versionCode ${info.versionCode})` : `versionCode ${info.versionCode}`;
}

function runCatchingString(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function runCatchingArray<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isPairingAdmin(req: IncomingMessage): boolean {
  const session = parseCookies(req.headers.cookie ?? "")["drone_pair_session"] ?? "";
  return session.length > 0 && pairingAdminSessions.has(session);
}

function buildPairingCookie(req: IncomingMessage, session: string): string {
  const forwardedProto = req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim();
  const secure = forwardedProto === "https" ? "; Secure" : "";
  return `drone_pair_session=${session}; HttpOnly; SameSite=Lax; Path=/pair; Max-Age=3600${secure}`;
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function loadPairingToken(): string {
  if (process.env.VOICE_STREAM_PAIRING_TOKEN?.trim()) {
    return process.env.VOICE_STREAM_PAIRING_TOKEN.trim();
  }

  const runtimeDir = resolve(repoRoot, "server/.runtime");
  const tokenPath = resolve(runtimeDir, "pairing-token");
  mkdirSync(runtimeDir, { recursive: true });
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing.length >= 24) {
      return existing;
    }
  }

  const token = randomBytes(32).toString("base64url");
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeBinary(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.concat(data);
}

function broadcastToMonitors(data: Buffer): void {
  for (const monitor of monitorWss.clients) {
    if (monitor.readyState === WebSocket.OPEN) {
      monitor.send(data, { binary: true });
    }
  }
}

function broadcastMonitorJson(message: TranscriptMessage | ApprovalCodeMessage | AndroidStatusMessage): void {
  const payload = JSON.stringify(message);
  for (const monitor of monitorWss.clients) {
    sendMonitorText(monitor, payload);
  }
}

function sendMonitorJson(socket: WebSocket, message: TranscriptMessage | ApprovalCodeMessage | AndroidStatusMessage): void {
  sendMonitorText(socket, JSON.stringify(message));
}

function sendMonitorText(socket: WebSocket, payload: string): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  }
}
