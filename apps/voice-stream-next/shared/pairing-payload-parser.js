const DESKTOP_CLIENT_VERSION = 1;

function parseQuery(rawQuery) {
  if (!rawQuery) return {};
  const params = {};
  for (const pair of String(rawQuery).split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator < 0) {
      params[decodeURIComponent(pair)] = '';
    } else {
      params[decodeURIComponent(pair.slice(0, separator))] = decodeURIComponent(pair.slice(separator + 1));
    }
  }
  return params;
}

function webSocketToHttpUrl(rawUrl) {
  const url = new URL(String(rawUrl).trim());
  const scheme = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : null;
  if (!scheme) throw new Error('Server URL must use ws:// or wss://');
  if (!url.hostname) throw new Error('Server URL is missing a host');
  const portPart = url.port ? `:${url.port}` : '';
  return `${scheme}//${url.hostname}${portPart}`;
}

function parseVoiceStreamPairing(payload) {
  const url = new URL(payload.trim());
  if (url.protocol !== 'voicestream:' || url.hostname !== 'pair') {
    throw new Error('QR does not contain VoiceStream pairing data');
  }

  const params = parseQuery(url.search.slice(1));
  const serverUrl = params.serverUrl?.trim().replace(/\/+$/, '');
  if (!serverUrl) throw new Error('QR does not contain a server URL');
  const deviceId = params.deviceId?.trim() || '';
  const token = params.token?.trim();
  if (!token) throw new Error('QR does not contain a device token');

  return {
    serverUrl,
    deviceId,
    token,
    deviceName: params.displayName?.trim() || null,
    deviceType: params.deviceType?.trim() || null,
    minClientVersion: params.minClientVersion ? Number(params.minClientVersion) : null,
    expiresAt: params.expiresAt?.trim() || null,
    pairingSessionId: params.pairingSessionId?.trim() || null,
    apkUrl: params.apk?.trim() || null,
  };
}

function parseWebSocketUrl(rawUrl) {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Server URL must use ws:// or wss://');
  }
  if (!url.hostname) throw new Error('Server URL is missing a host');

  const params = parseQuery(url.search.slice(1));
  const token = params.token?.trim();
  if (!token) throw new Error('QR does not contain a pairing token');

  return {
    serverUrl: webSocketToHttpUrl(rawUrl),
    deviceId: params.deviceId?.trim() || '',
    token,
    deviceName: params.displayName?.trim() || null,
    deviceType: params.deviceType?.trim() || null,
    minClientVersion: params.minClientVersion
      ? Number(params.minClientVersion)
      : params.minVersionCode
        ? Number(params.minVersionCode)
        : null,
    expiresAt: null,
    pairingSessionId: null,
    apkUrl: params.apk?.trim() || null,
  };
}

function parsePairingPayload(payload) {
  const trimmed = String(payload || '').trim();
  if (!trimmed) throw new Error('Pairing text is empty');

  if (trimmed.toLowerCase().startsWith('voicestream://')) {
    return parseVoiceStreamPairing(trimmed);
  }
  if (trimmed.toLowerCase().startsWith('ws://') || trimmed.toLowerCase().startsWith('wss://')) {
    return parseWebSocketUrl(trimmed);
  }
  throw new Error('Paste a VoiceStream pairing payload or ws:// server URL');
}

function isUpdatePayload(payload) {
  try {
    const url = new URL(String(payload || '').trim());
    return url.protocol === 'voicestream:' && url.hostname === 'update';
  } catch {
    return false;
  }
}

function parseUpdatePayload(payload) {
  const trimmed = String(payload || '').trim();
  if (!trimmed) throw new Error('Update QR is empty');

  const url = new URL(trimmed);
  if (url.protocol !== 'voicestream:' || url.hostname !== 'update') {
    throw new Error('QR does not contain VoiceStream update data');
  }

  const params = parseQuery(url.search.slice(1));
  const versionCode = Number(params.versionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('QR does not contain an app version');
  }

  return {
    versionCode,
    apkUrl: params.apk?.trim() || null,
  };
}

function pairingPayloadExpired(expiresAt) {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return false;
  return expiry < Date.now();
}

function clientVersionSupported(minClientVersion, clientVersion = DESKTOP_CLIENT_VERSION) {
  if (minClientVersion == null || !Number.isFinite(minClientVersion)) return true;
  return clientVersion >= minClientVersion;
}

if (typeof globalThis !== 'undefined') {
  globalThis.DESKTOP_CLIENT_VERSION = DESKTOP_CLIENT_VERSION;
  globalThis.clientVersionSupported = clientVersionSupported;
  globalThis.isUpdatePayload = isUpdatePayload;
  globalThis.parsePairingPayload = parsePairingPayload;
  globalThis.parseUpdatePayload = parseUpdatePayload;
  globalThis.pairingPayloadExpired = pairingPayloadExpired;
  globalThis.webSocketToHttpUrl = webSocketToHttpUrl;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DESKTOP_CLIENT_VERSION,
    clientVersionSupported,
    isUpdatePayload,
    parsePairingPayload,
    parseUpdatePayload,
    pairingPayloadExpired,
    webSocketToHttpUrl,
  };
}
